-- Exported read-only from live project aevqhgksniqahqrntzxv (supabase_migrations.schema_migrations).
-- Already applied in production. Do not re-run.

create table if not exists public.platform_generation_limits (
  id integer primary key default 1 check(id=1),
  max_active_runs_per_org integer not null default 3 check(max_active_runs_per_org between 1 and 50),
  request_window_seconds integer not null default 600 check(request_window_seconds between 60 and 86400),
  max_requests_per_window integer not null default 10 check(max_requests_per_window between 1 and 500),
  worker_lease_timeout_minutes integer not null default 15 check(worker_lease_timeout_minutes between 5 and 240),
  provider_task_timeout_minutes integer not null default 120 check(provider_task_timeout_minutes between 15 and 1440),
  updated_at timestamptz not null default now()
);

insert into public.platform_generation_limits(id)
values(1)
on conflict(id) do nothing;

create table if not exists public.generation_rate_windows (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  window_start timestamptz not null,
  request_count integer not null default 0 check(request_count>=0),
  updated_at timestamptz not null default now(),
  primary key(organization_id,window_start)
);

create index if not exists generation_rate_windows_time_idx
on public.generation_rate_windows(window_start);

create table if not exists public.platform_audit_events (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists platform_audit_events_org_time_idx
on public.platform_audit_events(organization_id,created_at desc);

create index if not exists platform_audit_events_entity_idx
on public.platform_audit_events(entity_type,entity_id,created_at desc);

alter table public.platform_generation_limits enable row level security;
alter table public.generation_rate_windows enable row level security;
alter table public.platform_audit_events enable row level security;

revoke all on public.platform_generation_limits,public.generation_rate_windows,public.platform_audit_events
from public,anon,authenticated;

grant all on public.platform_generation_limits,public.generation_rate_windows,public.platform_audit_events
to service_role;

grant select on public.platform_audit_events to authenticated;

drop policy if exists platform_audit_admin_read on public.platform_audit_events;
create policy platform_audit_admin_read
on public.platform_audit_events
for select to authenticated
using(exists(
  select 1 from public.platform_admins a where a.user_id=auth.uid()
));

create or replace function public.guard_generation_pressure()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_limits public.platform_generation_limits%rowtype;
  v_active integer;
  v_window_start timestamptz;
  v_count integer;
begin
  if new.status<>'awaiting_safety' then return new; end if;

  select * into v_limits
  from public.platform_generation_limits
  where id=1;

  if not found then
    raise exception 'Generation operational limits are not configured';
  end if;

  select count(*) into v_active
  from public.generation_runs
  where organization_id=new.organization_id
    and status in ('awaiting_safety','queued','processing');

  if v_active>=v_limits.max_active_runs_per_org then
    raise exception 'Too many active generation jobs for this workspace';
  end if;

  v_window_start:=to_timestamp(
    floor(extract(epoch from now())/v_limits.request_window_seconds)
    * v_limits.request_window_seconds
  );

  insert into public.generation_rate_windows(
    organization_id,window_start,request_count,updated_at
  )
  values(new.organization_id,v_window_start,1,now())
  on conflict(organization_id,window_start)
  do update set
    request_count=public.generation_rate_windows.request_count+1,
    updated_at=now()
  returning request_count into v_count;

  if v_count>v_limits.max_requests_per_window then
    raise exception 'Generation request rate limit reached';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_generation_pressure on public.generation_runs;
create trigger trg_generation_pressure
before insert on public.generation_runs
for each row execute function public.guard_generation_pressure();

revoke execute on function public.guard_generation_pressure()
from public,anon,authenticated;

create or replace function public.audit_generation_run_change()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if tg_op='INSERT' then
    insert into public.platform_audit_events(
      organization_id,actor_user_id,event_type,entity_type,entity_id,metadata
    )
    values(
      new.organization_id,
      new.requested_by,
      'generation.requested',
      'generation_run',
      new.id,
      jsonb_build_object(
        'project_id',new.project_id,
        'slots_reserved',new.slots_reserved,
        'estimated_cost_cents',new.estimated_cost_cents,
        'status',new.status
      )
    );
    return new;
  end if;

  if old.status is distinct from new.status then
    insert into public.platform_audit_events(
      organization_id,actor_user_id,event_type,entity_type,entity_id,metadata
    )
    values(
      new.organization_id,
      null,
      'generation.status_changed',
      'generation_run',
      new.id,
      jsonb_build_object(
        'project_id',new.project_id,
        'from_status',old.status,
        'to_status',new.status,
        'failure_code',new.failure_code,
        'actual_cost_cents',new.actual_cost_cents
      )
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_audit_generation_run_insert on public.generation_runs;
create trigger trg_audit_generation_run_insert
after insert on public.generation_runs
for each row execute function public.audit_generation_run_change();

drop trigger if exists trg_audit_generation_run_status on public.generation_runs;
create trigger trg_audit_generation_run_status
after update of status on public.generation_runs
for each row execute function public.audit_generation_run_change();

revoke execute on function public.audit_generation_run_change()
from public,anon,authenticated;

create or replace function public.cleanup_generation_rate_windows()
returns integer
language sql
security definer
set search_path=''
as $$
  with deleted as (
    delete from public.generation_rate_windows
    where window_start < now()-interval '2 days'
    returning 1
  )
  select count(*)::integer from deleted;
$$;

revoke all on function public.cleanup_generation_rate_windows()
from public,anon,authenticated;
grant execute on function public.cleanup_generation_rate_windows() to service_role;
