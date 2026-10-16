-- Exported read-only from live project aevqhgksniqahqrntzxv (supabase_migrations.schema_migrations).
-- Already applied in production. Do not re-run.

alter table public.generation_run_stages
  add column if not exists provider_submitted_at timestamptz;
alter table public.generation_run_stages
  add column if not exists next_poll_at timestamptz;

create index if not exists generation_stages_provider_poll_idx
on public.generation_run_stages(provider,status,next_poll_at)
where provider_job_id is not null;

create or replace function public.attach_generation_provider_task(
  p_stage_id uuid,
  p_provider text,
  p_provider_job_id text,
  p_output_payload jsonb default '{}'::jsonb,
  p_poll_after_seconds integer default 10
)
returns text
language plpgsql
security definer
set search_path=''
as $$
begin
  if p_provider is null or btrim(p_provider)='' then raise exception 'Provider required'; end if;
  if p_provider_job_id is null or btrim(p_provider_job_id)='' then raise exception 'Provider job id required'; end if;
  if p_poll_after_seconds<5 or p_poll_after_seconds>300 then raise exception 'Invalid poll delay'; end if;

  update public.generation_run_stages
  set provider=left(p_provider,80),
      provider_job_id=left(p_provider_job_id,200),
      provider_submitted_at=coalesce(provider_submitted_at,now()),
      next_poll_at=now()+make_interval(secs=>p_poll_after_seconds),
      locked_at=null,
      locked_by=null,
      output_payload=coalesce(output_payload,'{}'::jsonb)||coalesce(p_output_payload,'{}'::jsonb),
      updated_at=now()
  where id=p_stage_id
    and status='processing'
    and provider_job_id is null;

  if not found then raise exception 'Stage is not awaiting provider task attachment'; end if;
  return 'attached';
end;
$$;

create or replace function public.claim_generation_provider_polls(
  p_worker_id text,
  p_provider text,
  p_limit integer default 10
)
returns setof public.generation_run_stages
language plpgsql
security definer
set search_path=''
as $$
begin
  if p_worker_id is null or btrim(p_worker_id)='' then raise exception 'Worker id required'; end if;
  if p_provider is null or btrim(p_provider)='' then raise exception 'Provider required'; end if;
  if p_limit<1 or p_limit>25 then raise exception 'Invalid claim limit'; end if;

  return query
  with picked as (
    select s.id
    from public.generation_run_stages s
    join public.generation_runs r on r.id=s.run_id
    where s.status='processing'
      and s.provider=p_provider
      and s.provider_job_id is not null
      and coalesce(s.next_poll_at,now())<=now()
      and r.status='processing'
    order by coalesce(s.next_poll_at,s.updated_at),s.created_at
    for update of s skip locked
    limit p_limit
  )
  update public.generation_run_stages s
  set locked_at=now(),
      locked_by=left(p_worker_id,120),
      next_poll_at=now()+interval '30 seconds',
      updated_at=now()
  from picked
  where s.id=picked.id
  returning s.*;
end;
$$;

create or replace function public.defer_generation_provider_poll(
  p_stage_id uuid,
  p_delay_seconds integer default 15,
  p_output_payload jsonb default '{}'::jsonb
)
returns text
language plpgsql
security definer
set search_path=''
as $$
begin
  if p_delay_seconds<5 or p_delay_seconds>300 then raise exception 'Invalid poll delay'; end if;

  update public.generation_run_stages
  set next_poll_at=now()+make_interval(secs=>p_delay_seconds),
      locked_at=null,
      locked_by=null,
      output_payload=coalesce(output_payload,'{}'::jsonb)||coalesce(p_output_payload,'{}'::jsonb),
      updated_at=now()
  where id=p_stage_id and status='processing' and provider_job_id is not null;

  if not found then raise exception 'Stage is not pollable'; end if;
  return 'deferred';
end;
$$;

revoke all on function public.attach_generation_provider_task(uuid,text,text,jsonb,integer)
from public,anon,authenticated;
revoke all on function public.claim_generation_provider_polls(text,text,integer)
from public,anon,authenticated;
revoke all on function public.defer_generation_provider_poll(uuid,integer,jsonb)
from public,anon,authenticated;

grant execute on function public.attach_generation_provider_task(uuid,text,text,jsonb,integer) to service_role;
grant execute on function public.claim_generation_provider_polls(text,text,integer) to service_role;
grant execute on function public.defer_generation_provider_poll(uuid,integer,jsonb) to service_role;
