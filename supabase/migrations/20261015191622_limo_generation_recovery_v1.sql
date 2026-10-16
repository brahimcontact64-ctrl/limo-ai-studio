-- Exported read-only from live project aevqhgksniqahqrntzxv (supabase_migrations.schema_migrations).
-- Already applied in production. Do not re-run.

alter table public.generation_runs
  drop constraint if exists generation_runs_slots_reserved_check;
alter table public.generation_runs
  add constraint generation_runs_slots_reserved_check
  check(slots_reserved between 1 and 100);

create or replace function public.quarantine_stale_generation_stages(
  p_limit integer default 20
)
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare
  v_limits public.platform_generation_limits%rowtype;
  v_stage record;
  v_run public.generation_runs%rowtype;
  v_known_cost integer;
  v_job_status text;
  v_count integer:=0;
begin
  if p_limit<1 or p_limit>100 then raise exception 'Invalid limit'; end if;

  select * into v_limits
  from public.platform_generation_limits
  where id=1;

  if not found then raise exception 'Generation operational limits are not configured'; end if;

  for v_stage in
    select s.id,s.run_id
    from public.generation_run_stages s
    join public.generation_runs r on r.id=s.run_id
    where s.status='processing'
      and s.provider_job_id is null
      and s.locked_at is not null
      and s.locked_at < now()-make_interval(mins=>v_limits.worker_lease_timeout_minutes)
      and r.status in ('awaiting_safety','processing')
    order by s.locked_at
    for update of s skip locked
    limit p_limit
  loop
    select * into v_run
    from public.generation_runs
    where id=v_stage.run_id
    for update;

    update public.generation_run_stages
    set status='failed',
        error_code='worker_lease_expired_unknown_cost',
        updated_at=now()
    where id=v_stage.id;

    update public.generation_run_stages
    set status='skipped',updated_at=now()
    where run_id=v_run.id
      and status in ('pending','ready');

    select coalesce(sum(actual_cost_cents),0)::integer
    into v_known_cost
    from public.generation_run_stages
    where run_id=v_run.id;

    select status into v_job_status
    from public.content_jobs
    where id=v_run.root_job_id
    for update;

    if v_job_status in ('queued','processing') then
      perform public.fail_content_job(
        v_run.root_job_id,
        'worker_lease_expired_unknown_cost',
        v_known_cost,
        false
      );
    end if;

    perform public.refund_generation_usage_once(v_run.root_job_id);

    begin
      perform public.settle_ai_budget(
        v_run.ai_reservation_id,
        'needs_reconciliation',
        v_known_cost
      );
    exception when others then
      null;
    end;

    update public.generation_runs
    set status='needs_reconciliation',
        actual_cost_cents=v_known_cost,
        failure_code='worker_lease_expired_unknown_cost',
        completed_at=now(),
        updated_at=now()
    where id=v_run.id;

    update public.studio_projects
    set status='ready',updated_at=now()
    where id=v_run.project_id;

    v_count:=v_count+1;
  end loop;

  return v_count;
end;
$$;

create or replace function public.quarantine_expired_provider_tasks(
  p_limit integer default 20
)
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare
  v_limits public.platform_generation_limits%rowtype;
  v_stage record;
  v_run public.generation_runs%rowtype;
  v_known_cost integer;
  v_job_status text;
  v_count integer:=0;
begin
  if p_limit<1 or p_limit>100 then raise exception 'Invalid limit'; end if;

  select * into v_limits
  from public.platform_generation_limits
  where id=1;

  if not found then raise exception 'Generation operational limits are not configured'; end if;

  for v_stage in
    select s.id,s.run_id
    from public.generation_run_stages s
    join public.generation_runs r on r.id=s.run_id
    where s.status='processing'
      and s.provider_job_id is not null
      and s.provider_submitted_at is not null
      and s.provider_submitted_at < now()-make_interval(mins=>v_limits.provider_task_timeout_minutes)
      and r.status='processing'
    order by s.provider_submitted_at
    for update of s skip locked
    limit p_limit
  loop
    select * into v_run
    from public.generation_runs
    where id=v_stage.run_id
    for update;

    update public.generation_run_stages
    set status='failed',
        error_code='provider_task_timeout_unknown_cost',
        updated_at=now()
    where id=v_stage.id;

    update public.generation_run_stages
    set status='skipped',updated_at=now()
    where run_id=v_run.id
      and status in ('pending','ready');

    select coalesce(sum(actual_cost_cents),0)::integer
    into v_known_cost
    from public.generation_run_stages
    where run_id=v_run.id;

    select status into v_job_status
    from public.content_jobs
    where id=v_run.root_job_id
    for update;

    if v_job_status in ('queued','processing') then
      perform public.fail_content_job(
        v_run.root_job_id,
        'provider_task_timeout_unknown_cost',
        v_known_cost,
        false
      );
    end if;

    perform public.refund_generation_usage_once(v_run.root_job_id);

    begin
      perform public.settle_ai_budget(
        v_run.ai_reservation_id,
        'needs_reconciliation',
        v_known_cost
      );
    exception when others then
      null;
    end;

    update public.generation_runs
    set status='needs_reconciliation',
        actual_cost_cents=v_known_cost,
        failure_code='provider_task_timeout_unknown_cost',
        completed_at=now(),
        updated_at=now()
    where id=v_run.id;

    update public.studio_projects
    set status='ready',updated_at=now()
    where id=v_run.project_id;

    v_count:=v_count+1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.quarantine_stale_generation_stages(integer)
from public,anon,authenticated;
revoke all on function public.quarantine_expired_provider_tasks(integer)
from public,anon,authenticated;

grant execute on function public.quarantine_stale_generation_stages(integer) to service_role;
grant execute on function public.quarantine_expired_provider_tasks(integer) to service_role;
