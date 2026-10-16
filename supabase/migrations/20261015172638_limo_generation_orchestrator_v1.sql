-- Exported read-only from live project aevqhgksniqahqrntzxv (supabase_migrations.schema_migrations).
-- Already applied in production. Do not re-run.

alter table public.generation_run_stages
  drop constraint if exists generation_run_stages_status_check;
alter table public.generation_run_stages
  add constraint generation_run_stages_status_check
  check(status in ('pending','ready','processing','completed','failed','blocked','review','skipped'));

alter table public.generation_run_stages
  add column if not exists output_asset_id uuid references public.media_assets(id) on delete set null;
alter table public.generation_run_stages
  add column if not exists output_payload jsonb not null default '{}'::jsonb;

create index if not exists generation_stages_output_asset_idx
  on public.generation_run_stages(output_asset_id);

create unique index if not exists usage_ledger_generation_refund_once_idx
  on public.usage_ledger(organization_id,reference_id,reason)
  where reference_type='content_job'
    and reference_id is not null
    and reason='generation_refund';

create or replace function public.refund_generation_usage_once(p_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare
  v_job public.content_jobs%rowtype;
begin
  select * into v_job
  from public.content_jobs
  where id=p_job_id
  for update;

  if not found then raise exception 'Job not found'; end if;

  if exists(
    select 1 from public.usage_ledger
    where organization_id=v_job.organization_id
      and reference_type='content_job'
      and reference_id=v_job.id
      and reason='generation_refund'
  ) then
    return false;
  end if;

  perform 1
  from public.usage_balances
  where organization_id=v_job.organization_id
  for update;

  if v_job.resource='video' then
    update public.usage_balances
    set used_video_slots=greatest(0,used_video_slots-v_job.units),updated_at=now()
    where organization_id=v_job.organization_id;
  elsif v_job.resource='post' then
    update public.usage_balances
    set used_posts=greatest(0,used_posts-v_job.units),updated_at=now()
    where organization_id=v_job.organization_id;
  elsif v_job.resource='image' then
    update public.usage_balances
    set used_images=greatest(0,used_images-v_job.units),updated_at=now()
    where organization_id=v_job.organization_id;
  else
    raise exception 'Unsupported resource';
  end if;

  insert into public.usage_ledger(
    organization_id,resource,delta,reason,reference_type,reference_id,created_by
  )
  values(
    v_job.organization_id,v_job.resource,v_job.units,'generation_refund',
    'content_job',v_job.id,null
  );

  return true;
end;
$$;

revoke all on function public.refund_generation_usage_once(uuid) from public,anon,authenticated;
grant execute on function public.refund_generation_usage_once(uuid) to service_role;

create or replace function public.claim_generation_stages(
  p_worker_id text,
  p_stage_type text default null,
  p_limit integer default 5
)
returns setof public.generation_run_stages
language plpgsql
security definer
set search_path=''
as $$
begin
  if p_worker_id is null or btrim(p_worker_id)='' then raise exception 'Worker id required'; end if;
  if p_limit<1 or p_limit>25 then raise exception 'Invalid claim limit'; end if;
  if p_stage_type is not null
     and p_stage_type not in ('safety','script','voice','scene_video','render','export')
  then raise exception 'Invalid stage type'; end if;

  return query
  with picked as (
    select s.id
    from public.generation_run_stages s
    join public.generation_runs r on r.id=s.run_id
    where s.status='ready'
      and (p_stage_type is null or s.stage_type=p_stage_type)
      and (
        (s.stage_type='safety' and r.status='awaiting_safety')
        or
        (s.stage_type<>'safety' and r.status='processing')
      )
    order by s.sort_order,s.created_at
    for update of s skip locked
    limit p_limit
  )
  update public.generation_run_stages s
  set status='processing',
      locked_at=now(),
      locked_by=left(p_worker_id,120),
      attempt_count=s.attempt_count+1,
      updated_at=now()
  from picked
  where s.id=picked.id
  returning s.*;
end;
$$;

revoke all on function public.claim_generation_stages(text,text,integer) from public,anon,authenticated;
grant execute on function public.claim_generation_stages(text,text,integer) to service_role;

create or replace function public.apply_generation_safety_decision(
  p_run_id uuid,
  p_decision text,
  p_categories jsonb default '[]'::jsonb,
  p_rationale text default null,
  p_provider text default null,
  p_provider_ref text default null,
  p_provider_cost_cents integer default 0
)
returns text
language plpgsql
security definer
set search_path=''
as $$
declare
  v_run public.generation_runs%rowtype;
  v_review uuid;
  v_budget_result text;
begin
  if p_decision not in ('allow','review','block') then raise exception 'Invalid decision'; end if;
  if p_provider_cost_cents<0 then raise exception 'Invalid provider cost'; end if;

  select * into v_run
  from public.generation_runs
  where id=p_run_id
  for update;

  if not found then raise exception 'Generation run not found'; end if;
  if v_run.status<>'awaiting_safety' then raise exception 'Run is not awaiting safety'; end if;

  v_review:=public.set_content_job_safety_decision(
    v_run.root_job_id,p_decision,coalesce(p_categories,'[]'::jsonb),
    p_rationale,p_provider,p_provider_ref
  );

  if p_decision='allow' then
    update public.generation_run_stages
    set status='completed',
        actual_cost_cents=p_provider_cost_cents,
        provider=left(coalesce(p_provider,''),80),
        provider_job_id=left(coalesce(p_provider_ref,''),200),
        output_payload=jsonb_build_object('safety_review_id',v_review),
        updated_at=now()
    where run_id=p_run_id and stage_type='safety'
      and status in ('processing','ready','review');

    update public.content_jobs
    set status='processing',
        locked_at=now(),
        locked_by='generation-orchestrator',
        attempt_count=attempt_count+1,
        provider_cost_cents=p_provider_cost_cents,
        updated_at=now()
    where id=v_run.root_job_id and status='queued';

    update public.generation_run_stages
    set status='ready',updated_at=now()
    where run_id=p_run_id and stage_type='script' and status='pending';

    update public.generation_runs
    set status='processing',started_at=coalesce(started_at,now()),updated_at=now()
    where id=p_run_id;

    update public.studio_projects
    set status='generating',updated_at=now()
    where id=v_run.project_id;

    return 'allowed';

  elsif p_decision='review' then
    update public.generation_run_stages
    set status='review',
        actual_cost_cents=p_provider_cost_cents,
        provider=left(coalesce(p_provider,''),80),
        provider_job_id=left(coalesce(p_provider_ref,''),200),
        output_payload=jsonb_build_object('safety_review_id',v_review),
        updated_at=now()
    where run_id=p_run_id and stage_type='safety';

    return 'review';

  else
    update public.generation_run_stages
    set status='blocked',
        actual_cost_cents=p_provider_cost_cents,
        provider=left(coalesce(p_provider,''),80),
        provider_job_id=left(coalesce(p_provider_ref,''),200),
        output_payload=jsonb_build_object('safety_review_id',v_review),
        updated_at=now()
    where run_id=p_run_id and stage_type='safety';

    update public.content_jobs
    set status='failed',
        error_code='safety_blocked',
        provider_cost_cents=p_provider_cost_cents,
        updated_at=now()
    where id=v_run.root_job_id and status='queued';

    perform public.refund_generation_usage_once(v_run.root_job_id);

    if p_provider_cost_cents=0 then
      v_budget_result:=public.settle_ai_budget(v_run.ai_reservation_id,'released',0);
    else
      v_budget_result:=public.settle_ai_budget(
        v_run.ai_reservation_id,'completed',p_provider_cost_cents
      );
    end if;

    update public.generation_run_stages
    set status='skipped',updated_at=now()
    where run_id=p_run_id and status in ('pending','ready');

    update public.generation_runs
    set status=case when v_budget_result='needs_reconciliation'
                    then 'needs_reconciliation' else 'blocked' end,
        actual_cost_cents=p_provider_cost_cents,
        failure_code='safety_blocked',
        completed_at=now(),
        updated_at=now()
    where id=p_run_id;

    update public.studio_projects
    set status='ready',updated_at=now()
    where id=v_run.project_id;

    return case when v_budget_result='needs_reconciliation'
                then 'blocked_needs_reconciliation' else 'blocked' end;
  end if;
end;
$$;

revoke all on function public.apply_generation_safety_decision(uuid,text,jsonb,text,text,text,integer)
from public,anon,authenticated;
grant execute on function public.apply_generation_safety_decision(uuid,text,jsonb,text,text,text,integer)
to service_role;

create or replace function public.complete_generation_stage(
  p_stage_id uuid,
  p_provider text,
  p_provider_job_id text,
  p_actual_cost_cents integer default 0,
  p_output_asset_id uuid default null,
  p_output_payload jsonb default '{}'::jsonb
)
returns text
language plpgsql
security definer
set search_path=''
as $$
declare
  v_stage public.generation_run_stages%rowtype;
  v_run public.generation_runs%rowtype;
  v_total_actual integer;
  v_budget_result text;
  v_incomplete integer;
  v_export_count integer;
begin
  if p_actual_cost_cents<0 then raise exception 'Invalid provider cost'; end if;

  select * into v_stage
  from public.generation_run_stages
  where id=p_stage_id
  for update;

  if not found then raise exception 'Stage not found'; end if;
  if v_stage.status<>'processing' then raise exception 'Stage not processing'; end if;
  if v_stage.stage_type='safety' then raise exception 'Use safety decision function'; end if;

  select * into v_run
  from public.generation_runs
  where id=v_stage.run_id
  for update;

  if v_run.status<>'processing' then raise exception 'Run not processing'; end if;

  if p_output_asset_id is not null and not exists(
    select 1 from public.media_assets
    where id=p_output_asset_id and organization_id=v_run.organization_id
  ) then
    raise exception 'Output asset does not belong to this workspace';
  end if;

  update public.generation_run_stages
  set status='completed',
      provider=left(coalesce(p_provider,''),80),
      provider_job_id=left(coalesce(p_provider_job_id,''),200),
      actual_cost_cents=p_actual_cost_cents,
      output_asset_id=p_output_asset_id,
      output_payload=coalesce(p_output_payload,'{}'::jsonb),
      updated_at=now()
  where id=p_stage_id;

  if v_stage.stage_type='script' then
    update public.generation_run_stages
    set status='ready',updated_at=now()
    where run_id=v_run.id and stage_type='voice' and status='pending';

    if not exists(
      select 1 from public.generation_run_stages
      where run_id=v_run.id and stage_type='voice' and status<>'skipped'
    ) then
      update public.generation_run_stages
      set status='ready',updated_at=now()
      where run_id=v_run.id and stage_type='scene_video' and status='pending';
    end if;

  elsif v_stage.stage_type='voice' then
    update public.generation_run_stages
    set status='ready',updated_at=now()
    where run_id=v_run.id and stage_type='scene_video' and status='pending';

  elsif v_stage.stage_type='scene_video' then
    select count(*) into v_incomplete
    from public.generation_run_stages
    where run_id=v_run.id
      and stage_type='scene_video'
      and status not in ('completed','skipped');

    if v_incomplete=0 then
      update public.generation_run_stages
      set status='ready',updated_at=now()
      where run_id=v_run.id and stage_type='render' and status='pending';
    end if;

  elsif v_stage.stage_type='render' then
    if p_output_asset_id is not null then
      update public.studio_projects
      set master_asset_id=p_output_asset_id,updated_at=now()
      where id=v_run.project_id;
    end if;

    update public.generation_run_stages
    set status='ready',updated_at=now()
    where run_id=v_run.id and stage_type='export' and status='pending';

  end if;

  select count(*) into v_incomplete
  from public.generation_run_stages
  where run_id=v_run.id
    and stage_type<>'safety'
    and status not in ('completed','skipped');

  if v_incomplete=0 then
    select coalesce(sum(actual_cost_cents),0)::integer
    into v_total_actual
    from public.generation_run_stages
    where run_id=v_run.id;

    perform public.complete_content_job(
      v_run.root_job_id,'limo-orchestrator',v_run.id::text,v_total_actual
    );

    v_budget_result:=public.settle_ai_budget(
      v_run.ai_reservation_id,'completed',v_total_actual
    );

    update public.generation_runs
    set status=case when v_budget_result='needs_reconciliation'
                    then 'needs_reconciliation' else 'completed' end,
        actual_cost_cents=v_total_actual,
        completed_at=now(),
        updated_at=now()
    where id=v_run.id;

    update public.studio_projects
    set status='generated',updated_at=now()
    where id=v_run.project_id;

    return case when v_budget_result='needs_reconciliation'
                then 'completed_needs_reconciliation' else 'run_completed' end;
  end if;

  return 'stage_completed';
end;
$$;

revoke all on function public.complete_generation_stage(uuid,text,text,integer,uuid,jsonb)
from public,anon,authenticated;
grant execute on function public.complete_generation_stage(uuid,text,text,integer,uuid,jsonb)
to service_role;

create or replace function public.fail_generation_stage(
  p_stage_id uuid,
  p_error_code text,
  p_provider text default null,
  p_provider_job_id text default null,
  p_actual_cost_cents integer default 0
)
returns text
language plpgsql
security definer
set search_path=''
as $$
declare
  v_stage public.generation_run_stages%rowtype;
  v_run public.generation_runs%rowtype;
  v_total_actual integer;
  v_budget_result text;
begin
  if p_actual_cost_cents<0 then raise exception 'Invalid provider cost'; end if;

  select * into v_stage
  from public.generation_run_stages
  where id=p_stage_id
  for update;

  if not found then raise exception 'Stage not found'; end if;
  if v_stage.status not in ('processing','ready') then raise exception 'Stage cannot fail from current status'; end if;

  select * into v_run
  from public.generation_runs
  where id=v_stage.run_id
  for update;

  if v_run.status not in ('processing','awaiting_safety') then
    raise exception 'Run cannot fail from current status';
  end if;

  update public.generation_run_stages
  set status='failed',
      error_code=left(coalesce(p_error_code,'provider_failure'),120),
      provider=left(coalesce(p_provider,''),80),
      provider_job_id=left(coalesce(p_provider_job_id,''),200),
      actual_cost_cents=p_actual_cost_cents,
      updated_at=now()
  where id=p_stage_id;

  update public.generation_run_stages
  set status='skipped',updated_at=now()
  where run_id=v_run.id and status in ('pending','ready');

  select coalesce(sum(actual_cost_cents),0)::integer
  into v_total_actual
  from public.generation_run_stages
  where run_id=v_run.id;

  if (select status from public.content_jobs where id=v_run.root_job_id) in ('queued','processing') then
    perform public.fail_content_job(
      v_run.root_job_id,
      left(coalesce(p_error_code,'provider_failure'),120),
      v_total_actual,
      false
    );
  end if;

  perform public.refund_generation_usage_once(v_run.root_job_id);

  if v_total_actual=0 then
    v_budget_result:=public.settle_ai_budget(v_run.ai_reservation_id,'released',0);
  else
    v_budget_result:=public.settle_ai_budget(
      v_run.ai_reservation_id,'completed',v_total_actual
    );
  end if;

  update public.generation_runs
  set status=case when v_budget_result='needs_reconciliation'
                  then 'needs_reconciliation' else 'failed' end,
      actual_cost_cents=v_total_actual,
      failure_code=left(coalesce(p_error_code,'provider_failure'),120),
      completed_at=now(),
      updated_at=now()
  where id=v_run.id;

  update public.studio_projects
  set status='ready',updated_at=now()
  where id=v_run.project_id;

  return case when v_budget_result='needs_reconciliation'
              then 'failed_needs_reconciliation' else 'failed' end;
end;
$$;

revoke all on function public.fail_generation_stage(uuid,text,text,text,integer)
from public,anon,authenticated;
grant execute on function public.fail_generation_stage(uuid,text,text,text,integer)
to service_role;
