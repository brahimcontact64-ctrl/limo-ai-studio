-- Exported read-only from live project aevqhgksniqahqrntzxv (supabase_migrations.schema_migrations).
-- Already applied in production. Do not re-run.

create table if not exists public.studio_projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  content_type text not null references public.content_type_catalog(code),
  language_code text not null default 'ar' references public.language_catalog(code),
  brief text not null default '',
  goal text,
  visual_style text,
  series_id uuid references public.content_series(id) on delete set null,
  continuation_mode boolean not null default false,
  project_cast jsonb not null default '[]'::jsonb,
  status text not null default 'draft' check (status in ('draft','ready','queued','generating','generated','approved','archived')),
  master_asset_id uuid references public.media_assets(id) on delete set null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(project_cast)='array'),
  check (jsonb_array_length(project_cast) between 1 and 3)
);
create index if not exists studio_projects_org_idx on public.studio_projects(organization_id,updated_at desc);
create index if not exists studio_projects_series_idx on public.studio_projects(series_id);
create index if not exists studio_projects_creator_idx on public.studio_projects(created_by);
create index if not exists studio_projects_master_asset_idx on public.studio_projects(master_asset_id);

create table if not exists public.project_scenes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.studio_projects(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  scene_number integer not null check (scene_number between 1 and 100),
  title text,
  duration_seconds integer not null default 8 check (duration_seconds between 1 and 120),
  location_prompt text,
  environment_prompt text,
  camera_prompt text,
  lighting_prompt text,
  action_prompt text,
  dialogue text,
  on_screen_text text,
  effects_prompt text,
  music_prompt text,
  participants text[] not null default '{}'::text[],
  transition_out text,
  continuity_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id,scene_number)
);
create index if not exists project_scenes_project_idx on public.project_scenes(project_id,scene_number);
create index if not exists project_scenes_org_idx on public.project_scenes(organization_id);

create table if not exists public.export_presets (
  code text primary key,
  label text not null,
  aspect_ratio text not null,
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  recommended_for text[] not null default '{}'::text[],
  active boolean not null default true,
  sort_order integer not null default 100
);
insert into public.export_presets(code,label,aspect_ratio,width,height,recommended_for,sort_order) values
 ('vertical_9_16','Vertical 9:16','9:16',1080,1920,array['Instagram Reels','TikTok','YouTube Shorts','Facebook Reels'],10),
 ('portrait_4_5','Portrait 4:5','4:5',1080,1350,array['Instagram Feed','Facebook Feed'],20),
 ('square_1_1','Square 1:1','1:1',1080,1080,array['Instagram Feed','Facebook Feed','LinkedIn'],30),
 ('landscape_16_9','Landscape 16:9','16:9',1920,1080,array['YouTube','Facebook Video','Web'],40)
on conflict(code) do update set
 label=excluded.label,aspect_ratio=excluded.aspect_ratio,width=excluded.width,height=excluded.height,
 recommended_for=excluded.recommended_for,sort_order=excluded.sort_order,active=true;

create table if not exists public.project_export_choices (
  project_id uuid not null references public.studio_projects(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  preset_code text not null references public.export_presets(code),
  subtitles boolean not null default true,
  watermark boolean not null default false,
  quality text not null default '1080p' check (quality in ('720p','1080p')),
  smart_reframe boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(project_id,preset_code)
);
create index if not exists project_export_choices_org_idx on public.project_export_choices(organization_id);

create table if not exists public.export_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.studio_projects(id) on delete cascade,
  preset_code text not null references public.export_presets(code),
  master_asset_id uuid not null references public.media_assets(id) on delete cascade,
  output_asset_id uuid references public.media_assets(id) on delete set null,
  subtitles boolean not null default true,
  watermark boolean not null default false,
  quality text not null default '1080p' check (quality in ('720p','1080p')),
  smart_reframe boolean not null default true,
  status text not null default 'queued' check(status in ('queued','processing','ready','failed')),
  error_code text,
  requested_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists export_jobs_org_idx on public.export_jobs(organization_id,created_at desc);
create index if not exists export_jobs_project_idx on public.export_jobs(project_id,created_at desc);
create index if not exists export_jobs_requested_by_idx on public.export_jobs(requested_by);

alter table public.studio_projects enable row level security;
alter table public.project_scenes enable row level security;
alter table public.export_presets enable row level security;
alter table public.project_export_choices enable row level security;
alter table public.export_jobs enable row level security;

drop policy if exists studio_projects_read on public.studio_projects;
create policy studio_projects_read on public.studio_projects for select to authenticated using(public.is_org_member(organization_id));
drop policy if exists scenes_read on public.project_scenes;
create policy scenes_read on public.project_scenes for select to authenticated using(public.is_org_member(organization_id));
drop policy if exists export_presets_read on public.export_presets;
create policy export_presets_read on public.export_presets for select to anon,authenticated using(active=true);
drop policy if exists export_choices_read on public.project_export_choices;
create policy export_choices_read on public.project_export_choices for select to authenticated using(public.is_org_member(organization_id));
drop policy if exists export_jobs_read on public.export_jobs;
create policy export_jobs_read on public.export_jobs for select to authenticated using(public.is_org_member(organization_id));

revoke all on public.studio_projects,public.project_scenes,public.project_export_choices,public.export_jobs from public,anon,authenticated;
grant select on public.studio_projects,public.project_scenes,public.project_export_choices,public.export_jobs to authenticated;
revoke all on public.export_presets from public,anon,authenticated;
grant select on public.export_presets to anon,authenticated;
grant all on public.studio_projects,public.project_scenes,public.export_presets,public.project_export_choices,public.export_jobs to service_role;
