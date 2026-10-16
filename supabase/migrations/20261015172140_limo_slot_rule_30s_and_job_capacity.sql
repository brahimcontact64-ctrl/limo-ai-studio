-- Exported read-only from live project aevqhgksniqahqrntzxv (supabase_migrations.schema_migrations).
-- Already applied in production. Do not re-run.

create or replace function public.normalize_studio_project_slots()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  new.estimated_slots := greatest(1,ceil(new.total_duration_seconds::numeric/30)::integer);
  return new;
end;
$$;

drop trigger if exists trg_normalize_studio_project_slots on public.studio_projects;
create trigger trg_normalize_studio_project_slots
before insert or update of total_duration_seconds on public.studio_projects
for each row execute function public.normalize_studio_project_slots();

revoke execute on function public.normalize_studio_project_slots() from public,anon,authenticated;

update public.studio_projects
set estimated_slots=greatest(1,ceil(total_duration_seconds::numeric/30)::integer)
where estimated_slots<>greatest(1,ceil(total_duration_seconds::numeric/30)::integer);

alter table public.content_jobs
  drop constraint if exists content_jobs_units_check;
alter table public.content_jobs
  add constraint content_jobs_units_check check(units>0 and units<=100);

create or replace function public.enqueue_content_job(
  p_organization_id uuid,
  p_idempotency_key text,
  p_resource text,
  p_units integer,
  p_job_type text,
  p_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_existing uuid;
  v_usage public.usage_balances%rowtype;
  v_job_id uuid;
  v_remaining integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.can_edit_org(p_organization_id) then raise exception 'Not authorized'; end if;
  if p_idempotency_key is null or btrim(p_idempotency_key)='' or char_length(p_idempotency_key)>160 then raise exception 'Invalid idempotency key'; end if;
  if p_resource not in ('video','post','image') then raise exception 'Unsupported resource'; end if;
  if p_units<1 or p_units>100 then raise exception 'Invalid units'; end if;

  select id into v_existing
  from public.content_jobs
  where organization_id=p_organization_id and idempotency_key=p_idempotency_key;
  if found then return v_existing; end if;

  perform 1 from public.organization_subscriptions
  where organization_id=p_organization_id and status='active' and renews_at>now();
  if not found then raise exception 'Active subscription required'; end if;

  select * into v_usage
  from public.usage_balances
  where organization_id=p_organization_id
  for update;
  if not found or v_usage.cycle_end<=now() then raise exception 'Billing cycle unavailable'; end if;

  if p_resource='video' then
    v_remaining := (v_usage.base_video_slots+v_usage.extra_video_slots)-v_usage.used_video_slots;
    if v_remaining<p_units then raise exception 'Video slot limit reached'; end if;
    update public.usage_balances
    set used_video_slots=used_video_slots+p_units,updated_at=now()
    where organization_id=p_organization_id;
  elsif p_resource='post' then
    v_remaining := (v_usage.base_posts+v_usage.extra_posts)-v_usage.used_posts;
    if v_remaining<p_units then raise exception 'Post limit reached'; end if;
    update public.usage_balances
    set used_posts=used_posts+p_units,updated_at=now()
    where organization_id=p_organization_id;
  else
    v_remaining := (v_usage.base_images+v_usage.extra_images)-v_usage.used_images;
    if v_remaining<p_units then raise exception 'Image limit reached'; end if;
    update public.usage_balances
    set used_images=used_images+p_units,updated_at=now()
    where organization_id=p_organization_id;
  end if;

  insert into public.content_jobs(
    organization_id,requested_by,idempotency_key,resource,units,job_type,payload
  )
  values(
    p_organization_id,auth.uid(),p_idempotency_key,p_resource,p_units,
    left(p_job_type,100),coalesce(p_payload,'{}'::jsonb)
  )
  returning id into v_job_id;

  insert into public.usage_ledger(
    organization_id,resource,delta,reason,reference_type,reference_id,created_by
  )
  values(
    p_organization_id,p_resource,-p_units,'job_reserved','content_job',v_job_id,auth.uid()
  );

  return v_job_id;
exception when unique_violation then
  select id into v_existing
  from public.content_jobs
  where organization_id=p_organization_id and idempotency_key=p_idempotency_key;
  if v_existing is not null then return v_existing; end if;
  raise;
end;
$$;

revoke all on function public.enqueue_content_job(uuid,text,text,integer,text,jsonb) from public,anon;
grant execute on function public.enqueue_content_job(uuid,text,text,integer,text,jsonb) to authenticated,service_role;
