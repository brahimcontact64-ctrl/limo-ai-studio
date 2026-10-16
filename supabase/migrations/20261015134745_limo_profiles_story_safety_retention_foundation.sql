-- Exported read-only from live project aevqhgksniqahqrntzxv (supabase_migrations.schema_migrations).
-- Already applied in production. Do not re-run.

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null check (char_length(btrim(first_name)) between 1 and 80),
  last_name text not null check (char_length(btrim(last_name)) between 1 and 80),
  country_code text not null check (char_length(country_code) between 2 and 3),
  state_region text not null check (char_length(btrim(state_region)) between 1 and 120),
  date_of_birth date not null,
  account_type text not null default 'creator' check (account_type in ('creator','business','agency')),
  terms_version text not null,
  safety_policy_version text not null,
  accepted_at timestamptz not null default now(),
  registration_completed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (date_of_birth <= (current_date - interval '18 years')::date)
);

alter table public.user_profiles enable row level security;
drop policy if exists user_profile_self_read on public.user_profiles;
create policy user_profile_self_read on public.user_profiles
for select to authenticated using (user_id=(select auth.uid()));
revoke all on public.user_profiles from public,anon,authenticated;
grant select on public.user_profiles to authenticated;
grant all on public.user_profiles to service_role;

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
    left(btrim(p_terms_version),40),left(btrim(p_safety_policy_version),40),now(),now(),now()
  )
  on conflict (user_id) do update set
    first_name=excluded.first_name,
    last_name=excluded.last_name,
    country_code=excluded.country_code,
    state_region=excluded.state_region,
    account_type=excluded.account_type,
    terms_version=excluded.terms_version,
    safety_policy_version=excluded.safety_policy_version,
    accepted_at=now(),
    updated_at=now()
  where public.user_profiles.date_of_birth=excluded.date_of_birth;

  if not found then raise exception 'Date of birth cannot be changed after registration without support review'; end if;
end;
$$;
revoke all on function public.complete_registration_profile(text,text,text,text,date,text,text,text) from public,anon;
grant execute on function public.complete_registration_profile(text,text,text,text,date,text,text,text) to authenticated,service_role;

create table if not exists public.content_type_catalog (
  code text primary key,
  label text not null,
  description text not null,
  active boolean not null default true,
  sort_order integer not null default 100
);

insert into public.content_type_catalog(code,label,description,sort_order) values
('business','Business & services','Offers, services, company updates and customer education',10),
('education','Educational','Lessons, explainers, tutorials and learning content',20),
('storytelling','Stories & serial Reels','Short stories, episodic narratives and cliffhangers',30),
('entertainment','Entertainment','Humor, lifestyle, commentary and audience-first content',40),
('product_ads','Products & ads','Product demonstrations, offers, launches and ads',50),
('food','Food & restaurants','Menus, recipes, dishes, restaurant and hospitality content',60),
('fashion','Fashion & beauty','Looks, products, trends, styling and beauty content',70),
('real_estate','Real estate','Listings, walkthroughs and property marketing',80),
('gaming','Gaming','Game clips, guides, stories and gaming creator content',90),
('fitness','Fitness & coaching','Training, coaching and wellness creator content',100),
('travel','Travel','Destinations, itineraries and travel creator content',110),
('news_commentary','News & commentary','Commentary, summaries and current-topic content',120),
('motivation','Motivation','Motivational, personal development and inspirational content',130),
('ugc','UGC & creator ads','Creator-style product content and testimonials',140),
('podcast_clips','Podcast & interviews','Clips, highlights and discussion content',150),
('custom','Custom','A custom content format defined by the creator',999)
on conflict (code) do update set label=excluded.label,description=excluded.description,sort_order=excluded.sort_order;

alter table public.content_type_catalog enable row level security;
drop policy if exists content_type_read on public.content_type_catalog;
create policy content_type_read on public.content_type_catalog for select to anon,authenticated using(active=true);
revoke all on public.content_type_catalog from public,anon,authenticated;
grant select on public.content_type_catalog to anon,authenticated;
grant all on public.content_type_catalog to service_role;

create table if not exists public.organization_content_preferences (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  content_types text[] not null default array['custom']::text[],
  target_audience text,
  default_tone text,
  creator_goal text,
  typical_duration_seconds integer check (typical_duration_seconds is null or typical_duration_seconds between 5 and 600),
  preferred_languages text[] not null default array['ar']::text[],
  serial_story_mode boolean not null default false,
  publishing_cadence jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.organization_content_preferences enable row level security;
drop policy if exists org_content_pref_read on public.organization_content_preferences;
create policy org_content_pref_read on public.organization_content_preferences
for select to authenticated using(public.is_org_member(organization_id));
drop policy if exists org_content_pref_write on public.organization_content_preferences;
create policy org_content_pref_write on public.organization_content_preferences
for all to authenticated using(public.can_edit_org(organization_id)) with check(public.can_edit_org(organization_id));
revoke all on public.organization_content_preferences from public,anon,authenticated;
grant select,insert,update on public.organization_content_preferences to authenticated;
grant all on public.organization_content_preferences to service_role;

create table if not exists public.content_series (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  series_type text not null default 'storytelling',
  premise text,
  genre text,
  language_code text not null default 'ar',
  status text not null default 'active' check (status in ('active','paused','completed','archived')),
  continuity_mode text not null default 'strict' check (continuity_mode in ('strict','flexible')),
  visual_style jsonb not null default '{}'::jsonb,
  cast_bible jsonb not null default '{}'::jsonb,
  world_bible jsonb not null default '{}'::jsonb,
  story_rules jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists content_series_org_idx on public.content_series(organization_id,updated_at desc);

create table if not exists public.content_episodes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  series_id uuid not null references public.content_series(id) on delete cascade,
  episode_number integer not null check (episode_number > 0),
  title text,
  summary text,
  script text,
  ending_hook text,
  last_scene_state jsonb not null default '{}'::jsonb,
  last_frame_path text,
  previous_episode_id uuid references public.content_episodes(id) on delete set null,
  status text not null default 'draft' check (status in ('draft','queued','generated','approved','published','failed')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(series_id,episode_number)
);
create index if not exists content_episodes_series_idx on public.content_episodes(series_id,episode_number desc);
create index if not exists content_episodes_org_idx on public.content_episodes(organization_id,created_at desc);

alter table public.content_series enable row level security;
alter table public.content_episodes enable row level security;
drop policy if exists content_series_read on public.content_series;
create policy content_series_read on public.content_series for select to authenticated using(public.is_org_member(organization_id));
drop policy if exists content_series_write on public.content_series;
create policy content_series_write on public.content_series for all to authenticated using(public.can_edit_org(organization_id)) with check(public.can_edit_org(organization_id) and created_by=(select auth.uid()));
drop policy if exists content_episodes_read on public.content_episodes;
create policy content_episodes_read on public.content_episodes for select to authenticated using(public.is_org_member(organization_id));
drop policy if exists content_episodes_write on public.content_episodes;
create policy content_episodes_write on public.content_episodes for all to authenticated using(public.can_edit_org(organization_id)) with check(public.can_edit_org(organization_id) and created_by=(select auth.uid()));

revoke all on public.content_series,public.content_episodes from public,anon,authenticated;
grant select,insert,update,delete on public.content_series,public.content_episodes to authenticated;
grant all on public.content_series,public.content_episodes to service_role;

create or replace function public.get_next_episode_context(p_series_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_series public.content_series%rowtype;
  v_episode public.content_episodes%rowtype;
begin
  select * into v_series from public.content_series where id=p_series_id;
  if not found then raise exception 'Series not found'; end if;
  if not public.is_org_member(v_series.organization_id) then raise exception 'Not authorized'; end if;
  select * into v_episode from public.content_episodes
  where series_id=p_series_id
  order by episode_number desc
  limit 1;

  return jsonb_build_object(
    'series',jsonb_build_object(
      'id',v_series.id,'title',v_series.title,'premise',v_series.premise,'genre',v_series.genre,
      'language_code',v_series.language_code,'continuity_mode',v_series.continuity_mode,
      'visual_style',v_series.visual_style,'cast_bible',v_series.cast_bible,
      'world_bible',v_series.world_bible,'story_rules',v_series.story_rules
    ),
    'previous_episode',case when v_episode.id is null then null else jsonb_build_object(
      'id',v_episode.id,'episode_number',v_episode.episode_number,'summary',v_episode.summary,
      'ending_hook',v_episode.ending_hook,'last_scene_state',v_episode.last_scene_state,
      'last_frame_path',v_episode.last_frame_path
    ) end
  );
end;
$$;
revoke all on function public.get_next_episode_context(uuid) from public,anon;
grant execute on function public.get_next_episode_context(uuid) to authenticated,service_role;

create table if not exists public.content_safety_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  target_type text not null check (target_type in ('prompt','script','image','video','publish')),
  target_id uuid,
  stage text not null check (stage in ('input','output','pre_publish')),
  decision text not null check (decision in ('pending','allow','review','block')),
  categories jsonb not null default '[]'::jsonb,
  rationale text,
  provider text,
  provider_ref text,
  created_at timestamptz not null default now()
);
create index if not exists safety_reviews_org_idx on public.content_safety_reviews(organization_id,created_at desc);
alter table public.content_safety_reviews enable row level security;
drop policy if exists safety_reviews_member_read on public.content_safety_reviews;
create policy safety_reviews_member_read on public.content_safety_reviews
for select to authenticated using(public.is_org_member(organization_id));
revoke all on public.content_safety_reviews from public,anon,authenticated;
grant select on public.content_safety_reviews to authenticated;
grant all on public.content_safety_reviews to service_role;

alter table public.content_jobs add column if not exists safety_status text not null default 'pending';
alter table public.content_jobs drop constraint if exists content_jobs_safety_status_check;
alter table public.content_jobs add constraint content_jobs_safety_status_check check (safety_status in ('pending','approved','review','blocked'));
alter table public.content_jobs add column if not exists safety_review_id uuid references public.content_safety_reviews(id) on delete set null;
create index if not exists content_jobs_safety_review_idx on public.content_jobs(safety_review_id);

create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  content_project_id uuid,
  episode_id uuid references public.content_episodes(id) on delete cascade,
  bucket_id text not null,
  object_path text not null,
  media_type text not null check (media_type in ('image','video','audio','other')),
  source text not null default 'generated' check (source in ('generated','uploaded')),
  created_at timestamptz not null default now(),
  unique(bucket_id,object_path)
);
create index if not exists media_assets_org_idx on public.media_assets(organization_id,created_at desc);
alter table public.media_assets enable row level security;
drop policy if exists media_assets_member_read on public.media_assets;
create policy media_assets_member_read on public.media_assets
for select to authenticated using(public.is_org_member(organization_id));
revoke all on public.media_assets from public,anon,authenticated;
grant select on public.media_assets to authenticated;
grant all on public.media_assets to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values(
  'generated-media','generated-media',false,536870912,
  array['image/jpeg','image/png','image/webp','video/mp4','video/webm','audio/mpeg','audio/wav','audio/mp4']::text[]
)
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types,updated_at=now();

create table if not exists public.workspace_retention (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  status text not null default 'active' check (status in ('active','grace','purge_due','purged')),
  past_due_since timestamptz,
  purge_after timestamptz,
  purged_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  channel text not null default 'email' check (channel in ('email')),
  template_key text not null,
  scheduled_for timestamptz not null,
  status text not null default 'pending' check (status in ('pending','processing','sent','failed','canceled')),
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text not null unique,
  attempts integer not null default 0,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notification_outbox_due_idx on public.notification_outbox(status,scheduled_for);

alter table public.workspace_retention enable row level security;
alter table public.notification_outbox enable row level security;
drop policy if exists retention_member_read on public.workspace_retention;
create policy retention_member_read on public.workspace_retention for select to authenticated using(public.is_org_member(organization_id));
drop policy if exists notification_self_read on public.notification_outbox;
create policy notification_self_read on public.notification_outbox
for select to authenticated using(user_id=(select auth.uid()) and public.is_org_member(organization_id));
revoke all on public.workspace_retention,public.notification_outbox from public,anon,authenticated;
grant select on public.workspace_retention,public.notification_outbox to authenticated;
grant all on public.workspace_retention,public.notification_outbox to service_role;
