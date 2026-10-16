-- Exported read-only from live project aevqhgksniqahqrntzxv (supabase_migrations.schema_migrations).
-- Already applied in production. Do not re-run.

create table if not exists public.policy_acceptance_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  policy_key text not null check (policy_key in ('terms','safety','age_attestation','content_rights')),
  version text not null,
  source text not null check (source in ('signup','onboarding','policy_update')),
  accepted_at timestamptz not null default now()
);
create index if not exists policy_acceptance_user_idx on public.policy_acceptance_events(user_id,accepted_at desc);
alter table public.policy_acceptance_events enable row level security;
drop policy if exists policy_acceptance_self_read on public.policy_acceptance_events;
create policy policy_acceptance_self_read on public.policy_acceptance_events
for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.policy_acceptance_events from public,anon,authenticated;
grant select on public.policy_acceptance_events to authenticated;
grant all on public.policy_acceptance_events to service_role;

create table if not exists public.safety_policy_rules (
  code text primary key,
  label text not null,
  description text not null,
  enforcement text not null check (enforcement in ('block','review','allow')),
  active boolean not null default true,
  sort_order integer not null default 100
);

insert into public.safety_policy_rules(code,label,description,enforcement,sort_order) values
('sexual_minors','Sexual content involving minors','Any sexualized, exploitative, grooming or intimate content involving minors is prohibited.','block',10),
('nonconsensual_intimate','Non-consensual intimate content','Non-consensual sexual or intimate imagery, including manipulated intimate media, is prohibited.','block',20),
('explicit_sexual','Explicit sexual content','Pornographic or explicit sexual content is not supported by LIMO at launch.','block',30),
('violent_wrongdoing','Violent or dangerous wrongdoing','Content that meaningfully facilitates serious violent or dangerous wrongdoing is prohibited.','block',40),
('hate_harassment','Hate and targeted harassment','Content attacking protected groups or facilitating targeted harassment is prohibited.','block',50),
('fraud_impersonation','Fraud and deceptive impersonation','Scams, credential theft, fraudulent impersonation and deceptive identity misuse are prohibited.','block',60),
('extremism','Extremist support or recruitment','Praise, recruitment or operational support for violent extremist organizations is prohibited.','block',70),
('graphic_violence','Graphic violence','Highly graphic violence may be blocked or routed to manual review depending on context.','review',80),
('regulated_goods','Regulated or illegal goods','Illegal trafficking or unsafe promotion of regulated goods is prohibited or reviewed.','review',90),
('copyright_privacy','Rights, privacy and likeness','Users must have the rights and permissions needed for uploaded media, voices, likenesses and copyrighted material.','review',100),
('political_deception','Deceptive civic or political media','Deceptive impersonation or materially misleading synthetic political media is reviewed or blocked.','review',110)
on conflict (code) do update set
 label=excluded.label,description=excluded.description,enforcement=excluded.enforcement,sort_order=excluded.sort_order;

alter table public.safety_policy_rules enable row level security;
drop policy if exists safety_policy_rules_read on public.safety_policy_rules;
create policy safety_policy_rules_read on public.safety_policy_rules
for select to anon,authenticated using(active=true);
revoke all on public.safety_policy_rules from public,anon,authenticated;
grant select on public.safety_policy_rules to anon,authenticated;
grant all on public.safety_policy_rules to service_role;

create or replace function public.complete_registration_profile(
  p_first_name text,
  p_last_name text,
  p_country_code text,
  p_state_region text,
  p_date_of_birth date,
  p_account_type text,
  p_terms_version text,
  p_safety_policy_version text
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_now timestamptz:=now();
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_date_of_birth is null or p_date_of_birth > (current_date - interval '18 years')::date then
    raise exception 'LIMO launch accounts are restricted to users age 18 or older';
  end if;
  if btrim(coalesce(p_first_name,''))='' or btrim(coalesce(p_last_name,''))='' then raise exception 'Name required'; end if;
  if char_length(coalesce(p_country_code,'')) not between 2 and 3 then raise exception 'Invalid country code'; end if;
  if btrim(coalesce(p_state_region,''))='' then raise exception 'State/region required'; end if;
  if p_account_type not in ('creator','business','agency') then raise exception 'Invalid account type'; end if;
  if btrim(coalesce(p_terms_version,''))='' or btrim(coalesce(p_safety_policy_version,''))='' then raise exception 'Policy acceptance required'; end if;

  insert into public.user_profiles(
    user_id,first_name,last_name,country_code,state_region,date_of_birth,account_type,
    terms_version,safety_policy_version,accepted_at,registration_completed_at,updated_at
  )
  values(
    auth.uid(),left(btrim(p_first_name),80),left(btrim(p_last_name),80),upper(btrim(p_country_code)),
    left(btrim(p_state_region),120),p_date_of_birth,p_account_type,
    left(btrim(p_terms_version),40),left(btrim(p_safety_policy_version),40),v_now,v_now,v_now
  )
  on conflict (user_id) do update set
    first_name=excluded.first_name,last_name=excluded.last_name,country_code=excluded.country_code,
    state_region=excluded.state_region,account_type=excluded.account_type,
    terms_version=excluded.terms_version,safety_policy_version=excluded.safety_policy_version,
    accepted_at=v_now,updated_at=v_now
  where public.user_profiles.date_of_birth=excluded.date_of_birth;

  if not found then raise exception 'Date of birth cannot be changed after registration without support review'; end if;

  insert into public.policy_acceptance_events(user_id,policy_key,version,source,accepted_at)
  values
    (auth.uid(),'terms',left(p_terms_version,40),'onboarding',v_now),
    (auth.uid(),'safety',left(p_safety_policy_version,40),'onboarding',v_now),
    (auth.uid(),'age_attestation','18plus-v1','onboarding',v_now),
    (auth.uid(),'content_rights','rights-v1','onboarding',v_now);
end;
$$;

create or replace function public.claim_content_jobs(p_worker_id text,p_limit integer default 5)
returns setof public.content_jobs
language plpgsql
security definer
set search_path=''
as $$
begin
  if p_worker_id is null or btrim(p_worker_id)='' then raise exception 'Worker id required'; end if;
  if p_limit<1 or p_limit>25 then raise exception 'Invalid claim limit'; end if;

  return query
  with picked as (
    select j.id
    from public.content_jobs j
    where j.status='queued'
      and j.available_at<=now()
      and j.safety_status='approved'
    order by j.created_at
    for update skip locked
    limit p_limit
  )
  update public.content_jobs j
  set status='processing',locked_at=now(),locked_by=left(p_worker_id,120),
      attempt_count=j.attempt_count+1,updated_at=now()
  from picked
  where j.id=picked.id
  returning j.*;
end;
$$;
revoke all on function public.claim_content_jobs(text,integer) from public,anon,authenticated;
grant execute on function public.claim_content_jobs(text,integer) to service_role;

create or replace function public.set_content_job_safety_decision(
  p_job_id uuid,
  p_decision text,
  p_categories jsonb default '[]'::jsonb,
  p_rationale text default null,
  p_provider text default null,
  p_provider_ref text default null
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_job public.content_jobs%rowtype;
  v_review uuid;
begin
  if p_decision not in ('allow','review','block') then raise exception 'Invalid safety decision'; end if;
  select * into v_job from public.content_jobs where id=p_job_id for update;
  if not found then raise exception 'Job not found'; end if;
  if v_job.status<>'queued' then raise exception 'Job is not awaiting safety review'; end if;

  insert into public.content_safety_reviews(
    organization_id,user_id,target_type,target_id,stage,decision,categories,rationale,provider,provider_ref
  )
  values(
    v_job.organization_id,v_job.requested_by,'prompt',v_job.id,'input',p_decision,
    coalesce(p_categories,'[]'::jsonb),left(coalesce(p_rationale,''),2000),
    left(coalesce(p_provider,''),80),left(coalesce(p_provider_ref,''),200)
  )
  returning id into v_review;

  update public.content_jobs
  set safety_status=case p_decision when 'allow' then 'approved' when 'review' then 'review' else 'blocked' end,
      safety_review_id=v_review,
      updated_at=now()
  where id=p_job_id;

  return v_review;
end;
$$;
revoke all on function public.set_content_job_safety_decision(uuid,text,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function public.set_content_job_safety_decision(uuid,text,jsonb,text,text,text) to service_role;

create table if not exists public.media_deletion_queue (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  bucket_id text not null,
  object_path text not null,
  status text not null default 'pending' check(status in ('pending','processing','deleted','failed')),
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique(bucket_id,object_path)
);
create index if not exists media_deletion_queue_due_idx on public.media_deletion_queue(status,created_at);
alter table public.media_deletion_queue enable row level security;
revoke all on public.media_deletion_queue from public,anon,authenticated;
grant all on public.media_deletion_queue to service_role;

create or replace function public.purge_workspace_database_content(p_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_projects integer:=0;
  v_jobs integer:=0;
  v_series integer:=0;
  v_media integer:=0;
begin
  if not exists(
    select 1 from public.workspace_retention r
    where r.organization_id=p_organization_id
      and r.status='purge_due'
      and r.purge_after<=now()
  ) then
    raise exception 'Workspace is not due for purge';
  end if;

  insert into public.media_deletion_queue(organization_id,bucket_id,object_path)
  select organization_id,bucket_id,object_path
  from public.media_assets
  where organization_id=p_organization_id
  on conflict(bucket_id,object_path) do nothing;

  delete from public.publishing_approvals where organization_id=p_organization_id;
  delete from public.video_jobs where organization_id=p_organization_id;
  delete from public.content_projects where organization_id=p_organization_id;
  get diagnostics v_projects=row_count;

  delete from public.content_jobs where organization_id=p_organization_id;
  get diagnostics v_jobs=row_count;

  delete from public.content_series where organization_id=p_organization_id;
  get diagnostics v_series=row_count;

  delete from public.media_assets where organization_id=p_organization_id;
  get diagnostics v_media=row_count;

  update public.workspace_retention
  set status='purged',purged_at=now(),updated_at=now()
  where organization_id=p_organization_id;

  insert into public.notification_outbox(
    organization_id,user_id,template_key,scheduled_for,payload,dedupe_key
  )
  select p_organization_id,m.user_id,'content_deleted_after_nonpayment',now(),
    jsonb_build_object('purged_at',now()),
    p_organization_id::text||':'||m.user_id::text||':content_deleted_after_nonpayment'
  from public.organization_members m
  where m.organization_id=p_organization_id and m.role='owner'
  on conflict(dedupe_key) do nothing;

  return jsonb_build_object(
    'content_projects',v_projects,'content_jobs',v_jobs,
    'content_series',v_series,'media_asset_rows',v_media
  );
end;
$$;

create or replace function public.purge_due_workspaces()
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare
  v_org uuid;
  v_count integer:=0;
begin
  for v_org in
    select r.organization_id
    from public.workspace_retention r
    where r.status='purge_due' and r.purge_after<=now()
    order by r.purge_after
    for update skip locked
  loop
    perform public.purge_workspace_database_content(v_org);
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.purge_due_workspaces() from public,anon,authenticated;
grant execute on function public.purge_due_workspaces() to service_role;

do $$
declare v_id bigint;
begin
  select jobid into v_id from cron.job where jobname='limo-purge-due-workspaces' limit 1;
  if v_id is not null then perform cron.unschedule(v_id); end if;
end $$;

select cron.schedule(
  'limo-purge-due-workspaces',
  '55 * * * *',
  'select public.purge_due_workspaces();'
);
