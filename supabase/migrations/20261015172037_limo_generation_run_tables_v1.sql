-- Exported read-only from live project aevqhgksniqahqrntzxv (supabase_migrations.schema_migrations).
-- Already applied in production. Do not re-run.

create table public.generation_cost_policies (
  code text primary key,
  display_name text not null,
  enabled boolean not null default false,
  verified_at timestamptz,
  script_flat_cents integer not null default 0 check(script_flat_cents>=0),
  voice_per_minute_cents integer not null default 0 check(voice_per_minute_cents>=0),
  video_per_second_cents integer not null default 0 check(video_per_second_cents>=0),
  render_flat_cents integer not null default 0 check(render_flat_cents>=0),
  retry_buffer_percent integer not null default 0 check(retry_buffer_percent between 0 and 200),
  updated_at timestamptz not null default now()
);

insert into public.generation_cost_policies(
  code,display_name,enabled,verified_at,
  script_flat_cents,voice_per_minute_cents,video_per_second_cents,render_flat_cents,retry_buffer_percent
) values ('standard_v1','Standard video cost policy',false,null,0,0,0,0,0);

create table public.generation_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.studio_projects(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete restrict,
  request_key text not null,
  status text not null default 'awaiting_safety'
    check(status in ('awaiting_safety','queued','processing','completed','failed','blocked','canceled','needs_reconciliation')),
  cost_policy_code text not null references public.generation_cost_policies(code),
  slots_reserved integer not null check(slots_reserved between 1 and 10),
  estimated_cost_cents integer not null check(estimated_cost_cents>0),
  actual_cost_cents integer check(actual_cost_cents is null or actual_cost_cents>=0),
  ai_reservation_id uuid references public.ai_cost_reservations(id) on delete restrict,
  root_job_id uuid references public.content_jobs(id) on delete restrict,
  failure_code text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,request_key)
);

create table public.generation_run_stages (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.generation_runs(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stage_key text not null,
  stage_type text not null
    check(stage_type in ('safety','script','voice','scene_video','render','export')),
  sort_order integer not null check(sort_order>=0),
  status text not null default 'pending'
    check(status in ('pending','ready','processing','completed','failed','blocked','skipped')),
  scene_number integer,
  preset_code text references public.export_presets(code),
  provider text,
  provider_job_id text,
  estimated_cost_cents integer not null default 0 check(estimated_cost_cents>=0),
  actual_cost_cents integer check(actual_cost_cents is null or actual_cost_cents>=0),
  attempt_count integer not null default 0 check(attempt_count>=0),
  locked_at timestamptz,
  locked_by text,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(run_id,stage_key)
);

create index generation_runs_org_idx on public.generation_runs(organization_id,created_at desc);
create index generation_runs_project_idx on public.generation_runs(project_id,created_at desc);
create index generation_runs_job_idx on public.generation_runs(root_job_id);
create index generation_runs_reservation_idx on public.generation_runs(ai_reservation_id);
create index generation_runs_requested_by_idx on public.generation_runs(requested_by);
create index generation_stages_claim_idx on public.generation_run_stages(status,sort_order,created_at);
create index generation_stages_run_idx on public.generation_run_stages(run_id,sort_order);
create index generation_stages_org_idx on public.generation_run_stages(organization_id,created_at desc);

alter table public.generation_cost_policies enable row level security;
alter table public.generation_runs enable row level security;
alter table public.generation_run_stages enable row level security;

create policy generation_runs_read on public.generation_runs
for select to authenticated using(public.is_org_member(organization_id));

create policy generation_stages_read on public.generation_run_stages
for select to authenticated using(public.is_org_member(organization_id));

revoke all on public.generation_cost_policies from public,anon,authenticated;
grant all on public.generation_cost_policies to service_role;

revoke all on public.generation_runs,public.generation_run_stages from public,anon,authenticated;
grant select on public.generation_runs,public.generation_run_stages to authenticated;
grant all on public.generation_runs,public.generation_run_stages to service_role;
