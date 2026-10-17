-- LIMO Milestone 5: Story Engine.
-- Status: PENDING OWNER APPROVAL for production. See docs/MIGRATION_REVIEW.md.
-- Depends on 20261017120000 (save_studio_project_v3, project revisions, script approval) and
-- 20261017140000 (workspace characters for "custom:<uuid>" cast ids).
--
-- Model: a series has a versioned Story Bible (canon). Each episode is a studio project plus an ending
-- checkpoint. Continue Story creates episode N+1 only from episode N's APPROVED, unflagged ending
-- (matched by fingerprint). Reopening or changing an approved episode flags every later episode for
-- review instead of rewriting it. The timeline holds events of approved episodes only.
-- Existing tables content_series / content_episodes are extended; direct client writes are replaced by
-- functions so these rules cannot be bypassed.

-- 1. Series and seasons ------------------------------------------------------------------------------
alter table public.content_series
  add column if not exists current_bible_version integer not null default 0,
  add column if not exists updated_by uuid references auth.users(id) on delete set null;

create table if not exists public.story_seasons (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  series_id uuid not null references public.content_series(id) on delete cascade,
  season_number integer not null check (season_number > 0),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  summary text check (summary is null or char_length(summary) <= 4000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (series_id, season_number)
);

-- 2. Story Bible versions ----------------------------------------------------------------------------
create table if not exists public.story_bible_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  series_id uuid not null references public.content_series(id) on delete cascade,
  version integer not null check (version > 0),
  bible jsonb not null check (jsonb_typeof(bible) = 'object' and pg_column_size(bible) < 262144),
  source text not null check (source in ('created', 'manual', 'episode_approval', 'restore')),
  note text check (note is null or char_length(note) <= 500),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (series_id, version)
);

-- 3. Episodes ----------------------------------------------------------------------------------------
alter table public.content_episodes
  add column if not exists season_id uuid references public.story_seasons(id) on delete set null,
  add column if not exists project_id uuid references public.studio_projects(id) on delete set null,
  add column if not exists checkpoint jsonb not null default '{}'::jsonb,
  add column if not exists checkpoint_status text not null default 'none',
  add column if not exists checkpoint_updated_at timestamptz not null default now(),
  add column if not exists approved_checkpoint jsonb,
  add column if not exists checkpoint_fingerprint text,
  add column if not exists approved_project_revision_id uuid references public.project_revisions(id) on delete set null,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references auth.users(id) on delete set null,
  add column if not exists based_on_episode_id uuid references public.content_episodes(id) on delete set null,
  add column if not exists based_on_fingerprint text,
  add column if not exists bible_version_used integer,
  add column if not exists review_status text not null default 'ok',
  add column if not exists review_reasons jsonb not null default '[]'::jsonb,
  add column if not exists review_history jsonb not null default '[]'::jsonb;
alter table public.content_episodes drop constraint if exists content_episodes_checkpoint_status_check;
alter table public.content_episodes add constraint content_episodes_checkpoint_status_check check (checkpoint_status in ('none', 'draft', 'approved'));
alter table public.content_episodes drop constraint if exists content_episodes_review_status_check;
alter table public.content_episodes add constraint content_episodes_review_status_check check (review_status in ('ok', 'needs_review'));
alter table public.content_episodes drop constraint if exists content_episodes_checkpoint_check;
alter table public.content_episodes add constraint content_episodes_checkpoint_check check (jsonb_typeof(checkpoint) = 'object' and pg_column_size(checkpoint) < 131072);
create unique index if not exists content_episodes_project_uidx on public.content_episodes(project_id) where project_id is not null;

create table if not exists public.story_checkpoint_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  episode_id uuid not null references public.content_episodes(id) on delete cascade,
  version integer not null check (version > 0),
  checkpoint jsonb not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (episode_id, version)
);

-- 4. Timeline (approved episodes only) ----------------------------------------------------------------
create table if not exists public.story_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  series_id uuid not null references public.content_series(id) on delete cascade,
  episode_id uuid not null references public.content_episodes(id) on delete cascade,
  seq integer not null check (seq > 0),
  text text not null check (char_length(text) between 1 and 500),
  characters text[] not null default '{}',
  scenes integer[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (episode_id, seq)
);
create index if not exists story_events_series_idx on public.story_events(series_id);

-- 5. Access: members read; all writes through the functions below ---------------------------------------
alter table public.story_seasons enable row level security;
alter table public.story_bible_versions enable row level security;
alter table public.story_checkpoint_versions enable row level security;
alter table public.story_events enable row level security;
drop policy if exists story_seasons_read on public.story_seasons;
create policy story_seasons_read on public.story_seasons for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists story_bible_versions_read on public.story_bible_versions;
create policy story_bible_versions_read on public.story_bible_versions for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists story_checkpoint_versions_read on public.story_checkpoint_versions;
create policy story_checkpoint_versions_read on public.story_checkpoint_versions for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists story_events_read on public.story_events;
create policy story_events_read on public.story_events for select to authenticated using (public.is_org_member(organization_id));
revoke all on public.story_seasons, public.story_bible_versions, public.story_checkpoint_versions, public.story_events from public, anon, authenticated;
grant select on public.story_seasons, public.story_bible_versions, public.story_checkpoint_versions, public.story_events to authenticated;
grant all on public.story_seasons, public.story_bible_versions, public.story_checkpoint_versions, public.story_events to service_role;

drop policy if exists content_series_write on public.content_series;
drop policy if exists content_episodes_write on public.content_episodes;
revoke insert, update, delete, truncate on public.content_series, public.content_episodes from authenticated;
revoke all on public.content_series, public.content_episodes from anon;

-- 6. Helpers -----------------------------------------------------------------------------------------
-- Every bible character must be an active catalog character or an active workspace character of this workspace.
create or replace function public.limo_check_bible(p_organization_id uuid, p_bible jsonb)
returns void
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_bad text;
begin
  if jsonb_typeof(p_bible) <> 'object' then raise exception 'Invalid story bible'; end if;
  if jsonb_typeof(coalesce(p_bible -> 'characters', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_bible -> 'characters', '[]'::jsonb)) > 18 then
    raise exception 'Invalid story bible characters';
  end if;
  select c ->> 'ref' into v_bad from jsonb_array_elements(coalesce(p_bible -> 'characters', '[]'::jsonb)) c
  where not exists (select 1 from public.character_catalog k where k.id = c ->> 'ref' and k.active and k.family_code is not null)
    and not exists (select 1 from public.characters w where 'custom:' || w.id::text = c ->> 'ref' and w.organization_id = p_organization_id and w.status = 'active')
  limit 1;
  if v_bad is not null then raise exception 'Unknown character in story bible: %', v_bad; end if;
  if (select count(*) from jsonb_array_elements(coalesce(p_bible -> 'characters', '[]'::jsonb)) c) <>
     (select count(distinct c ->> 'ref') from jsonb_array_elements(coalesce(p_bible -> 'characters', '[]'::jsonb)) c) then
    raise exception 'Duplicate character in story bible';
  end if;
end;
$function$;

-- Characters used by approved episodes cannot disappear from the canon (no silent identity changes).
create or replace function public.limo_check_bible_removals(p_series_id uuid, p_bible jsonb)
returns void
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_used text;
begin
  select r into v_used from (
    select jsonb_array_elements(e.approved_checkpoint -> 'characters') ->> 'ref' as r
    from public.content_episodes e where e.series_id = p_series_id and e.checkpoint_status = 'approved'
    union
    select x ->> 'id' from public.content_episodes e join public.studio_projects p on p.id = e.project_id, jsonb_array_elements(p.project_cast) x
    where e.series_id = p_series_id and e.checkpoint_status = 'approved'
  ) used
  where r is not null and not exists (select 1 from jsonb_array_elements(coalesce(p_bible -> 'characters', '[]'::jsonb)) c where c ->> 'ref' = used.r)
  limit 1;
  if v_used is not null then raise exception 'Character appears in approved episodes: %', v_used; end if;
end;
$function$;

create or replace function public.limo_write_bible(p_series public.content_series, p_bible jsonb, p_source text, p_note text)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_version integer := p_series.current_bible_version + 1;
begin
  insert into public.story_bible_versions(organization_id, series_id, version, bible, source, note, created_by)
  values (p_series.organization_id, p_series.id, v_version, p_bible, p_source, nullif(left(btrim(coalesce(p_note, '')), 500), ''), auth.uid());
  update public.content_series set current_bible_version = v_version, premise = left(coalesce(p_bible ->> 'premise', ''), 4000),
    genre = nullif(left(coalesce(p_bible ->> 'genre', ''), 120), ''), updated_by = auth.uid(), updated_at = now()
  where id = p_series.id;
  return v_version;
end;
$function$;

-- Flags every later episode for review. The next episode starts from this ending, so it is always "direct".
create or replace function public.limo_flag_later_episodes(p_episode public.content_episodes, p_kind text, p_chars text[], p_arcs text[])
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_later public.content_episodes%rowtype;
  v_cast text[];
  v_arcs text[];
  v_count integer := 0;
begin
  for v_later in select * from public.content_episodes where series_id = p_episode.series_id and episode_number > p_episode.episode_number order by episode_number for update loop
    select coalesce(array_agg(x ->> 'id'), '{}') into v_cast from public.studio_projects p, jsonb_array_elements(p.project_cast) x where p.id = v_later.project_id;
    select coalesce(array_agg(a), '{}') into v_arcs from (
      select jsonb_array_elements_text(coalesce(v_later.checkpoint -> 'arcs_progressed', '[]'::jsonb)) a
      union select jsonb_array_elements_text(coalesce(v_later.checkpoint -> 'arcs_resolved', '[]'::jsonb))
    ) s;
    update public.content_episodes set
      review_status = 'needs_review',
      review_reasons = review_reasons || jsonb_build_array(jsonb_build_object(
        'episode_number', p_episode.episode_number, 'kind', p_kind,
        'impact', case when v_later.episode_number = p_episode.episode_number + 1 or v_cast && p_chars or v_arcs && p_arcs then 'direct' else 'downstream' end,
        'characters', to_jsonb(p_chars), 'arcs', to_jsonb(p_arcs), 'at', now()))
    where id = v_later.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$;

create or replace function public.limo_reopen_episode(p_episode_id uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_ep public.content_episodes%rowtype;
  v_chars text[];
begin
  select * into v_ep from public.content_episodes where id = p_episode_id for update;
  if not found or v_ep.checkpoint_status <> 'approved' then return; end if;
  update public.content_episodes set checkpoint_status = 'draft', status = 'draft' where id = p_episode_id;
  delete from public.story_events where episode_id = p_episode_id;
  select coalesce(array_agg(distinct c ->> 'ref'), '{}') into v_chars from jsonb_array_elements(coalesce(v_ep.approved_checkpoint -> 'characters', '[]'::jsonb)) c;
  perform public.limo_flag_later_episodes(v_ep, p_kind, v_chars, '{}');
  insert into public.platform_audit_events(organization_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (v_ep.organization_id, auth.uid(), 'story.episode_reopened', 'content_episode', p_episode_id, jsonb_build_object('episode_number', v_ep.episode_number, 'kind', p_kind));
end;
$function$;

-- Removing the script approval of an approved episode's project reopens the episode (and flags later ones).
create or replace function public.limo_episode_script_unapproved()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_ep uuid;
begin
  if old.script_status = 'approved' and new.script_status <> 'approved' then
    select id into v_ep from public.content_episodes where project_id = new.id and checkpoint_status = 'approved';
    if v_ep is not null then perform public.limo_reopen_episode(v_ep, 'earlier_episode_reopened'); end if;
  end if;
  return new;
end;
$function$;
drop trigger if exists trg_episode_script_unapproved on public.studio_projects;
create trigger trg_episode_script_unapproved after update of script_status on public.studio_projects
  for each row execute function public.limo_episode_script_unapproved();

revoke all on function public.limo_check_bible(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.limo_check_bible_removals(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.limo_write_bible(public.content_series, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.limo_flag_later_episodes(public.content_episodes, text, text[], text[]) from public, anon, authenticated;
revoke all on function public.limo_reopen_episode(uuid, text) from public, anon, authenticated;

-- 7. Series and bible ---------------------------------------------------------------------------------
create or replace function public.create_story_series(p_organization_id uuid, p_title text, p_language_code text, p_continuity_mode text, p_bible jsonb)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_series public.content_series%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.can_edit_org(p_organization_id) then raise exception 'Not authorized'; end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 200 then raise exception 'Series title required'; end if;
  if not exists (select 1 from public.language_catalog where code = p_language_code and active) then raise exception 'Invalid language'; end if;
  if (select count(*) from public.content_series where organization_id = p_organization_id and status <> 'archived') >= 50 then
    raise exception 'A workspace can have at most 50 series';
  end if;
  perform public.limo_check_bible(p_organization_id, p_bible);
  insert into public.content_series(organization_id, title, series_type, premise, genre, language_code, continuity_mode, created_by)
  values (p_organization_id, left(btrim(p_title), 200), 'storytelling', left(coalesce(p_bible ->> 'premise', ''), 4000),
          nullif(left(coalesce(p_bible ->> 'genre', ''), 120), ''), p_language_code,
          case when p_continuity_mode = 'flexible' then 'flexible' else 'strict' end, auth.uid())
  returning * into v_series;
  perform public.limo_write_bible(v_series, p_bible, 'created', null);
  return v_series.id;
end;
$function$;

create or replace function public.save_story_bible(p_series_id uuid, p_base_version integer, p_bible jsonb, p_note text)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_series public.content_series%rowtype;
begin
  select * into v_series from public.content_series where id = p_series_id for update;
  if not found or not public.can_edit_org(v_series.organization_id) then raise exception 'Series not found'; end if;
  if p_base_version is distinct from v_series.current_bible_version then raise exception 'Story bible changed since it was loaded' using errcode = 'P0001'; end if;
  perform public.limo_check_bible(v_series.organization_id, p_bible);
  perform public.limo_check_bible_removals(p_series_id, p_bible);
  return public.limo_write_bible(v_series, p_bible, 'manual', p_note);
end;
$function$;

create or replace function public.restore_story_bible(p_series_id uuid, p_version integer, p_base_version integer)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_series public.content_series%rowtype;
  v_bible jsonb;
begin
  select * into v_series from public.content_series where id = p_series_id for update;
  if not found or not public.can_edit_org(v_series.organization_id) then raise exception 'Series not found'; end if;
  if p_base_version is distinct from v_series.current_bible_version then raise exception 'Story bible changed since it was loaded' using errcode = 'P0001'; end if;
  select bible into v_bible from public.story_bible_versions where series_id = p_series_id and version = p_version;
  if v_bible is null then raise exception 'Bible version not found'; end if;
  perform public.limo_check_bible(v_series.organization_id, v_bible);
  perform public.limo_check_bible_removals(p_series_id, v_bible);
  return public.limo_write_bible(v_series, v_bible, 'restore', 'Restored version ' || p_version);
end;
$function$;

create or replace function public.create_story_season(p_series_id uuid, p_title text, p_summary text)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_series public.content_series%rowtype;
  v_number integer;
begin
  select * into v_series from public.content_series where id = p_series_id for update;
  if not found or not public.can_edit_org(v_series.organization_id) then raise exception 'Series not found'; end if;
  select coalesce(max(season_number), 0) + 1 into v_number from public.story_seasons where series_id = p_series_id;
  insert into public.story_seasons(organization_id, series_id, season_number, title, summary, created_by)
  values (v_series.organization_id, p_series_id, v_number, left(btrim(coalesce(nullif(p_title, ''), 'Season ' || v_number)), 200), nullif(left(coalesce(p_summary, ''), 4000), ''), auth.uid());
  return v_number;
end;
$function$;

-- 8. Episodes -----------------------------------------------------------------------------------------
-- Creates the next episode (and its studio project). With a previous episode, the caller must name it and
-- its approved ending fingerprint: continuation only from the exact approved ending of the latest episode.
create or replace function public.create_story_episode(
  p_series_id uuid, p_season_id uuid, p_based_on_episode_id uuid, p_based_on_fingerprint text,
  p_title text, p_content_type text, p_project_cast jsonb, p_scenes jsonb, p_export_presets text[]
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_series public.content_series%rowtype;
  v_prev public.content_episodes%rowtype;
  v_bible jsonb;
  v_bad text;
  v_save jsonb;
  v_project uuid;
  v_id uuid;
begin
  select * into v_series from public.content_series where id = p_series_id for update;
  if not found or not public.can_edit_org(v_series.organization_id) then raise exception 'Series not found'; end if;
  if p_season_id is not null and not exists (select 1 from public.story_seasons where id = p_season_id and series_id = p_series_id) then raise exception 'Season not found'; end if;
  select * into v_prev from public.content_episodes where series_id = p_series_id order by episode_number desc limit 1;
  if v_prev.id is not null then
    if p_based_on_episode_id is distinct from v_prev.id then raise exception 'Continue from the latest episode' using errcode = 'P0001'; end if;
    if v_prev.checkpoint_status <> 'approved' then raise exception 'Approve episode % first', v_prev.episode_number; end if;
    if v_prev.review_status <> 'ok' then raise exception 'Episode % needs review first', v_prev.episode_number; end if;
    if p_based_on_fingerprint is distinct from v_prev.checkpoint_fingerprint then raise exception 'The previous ending changed since it was loaded' using errcode = 'P0001'; end if;
  elsif p_based_on_episode_id is not null then
    raise exception 'Continue from the latest episode' using errcode = 'P0001';
  end if;

  select bible into v_bible from public.story_bible_versions where series_id = p_series_id and version = v_series.current_bible_version;
  select x ->> 'id' into v_bad from jsonb_array_elements(p_project_cast) x
  where not exists (select 1 from jsonb_array_elements(coalesce(v_bible -> 'characters', '[]'::jsonb)) c where c ->> 'ref' = x ->> 'id') limit 1;
  if v_bad is not null then raise exception 'Character is not in the story bible: %', v_bad; end if;

  v_save := public.save_studio_project_v3(
    v_series.organization_id, null, null, 'manual', null, false,
    coalesce(nullif(btrim(p_title), ''), 'Episode ' || (coalesce(v_prev.episode_number, 0) + 1)), 'story', p_content_type, v_series.language_code,
    '', '', '', '{}'::jsonb, p_project_cast, p_scenes, p_export_presets
  );
  v_project := (v_save ->> 'project_id')::uuid;
  update public.studio_projects set series_id = p_series_id, continuation_mode = v_prev.id is not null where id = v_project;

  insert into public.content_episodes(
    organization_id, series_id, season_id, episode_number, title, previous_episode_id, status, created_by,
    project_id, based_on_episode_id, based_on_fingerprint, bible_version_used
  ) values (
    v_series.organization_id, p_series_id, p_season_id, coalesce(v_prev.episode_number, 0) + 1,
    left(coalesce(nullif(btrim(p_title), ''), 'Episode ' || (coalesce(v_prev.episode_number, 0) + 1)), 200), v_prev.id, 'draft', auth.uid(),
    v_project, v_prev.id, v_prev.checkpoint_fingerprint, v_series.current_bible_version
  ) returning id into v_id;
  return jsonb_build_object('episode_id', v_id, 'project_id', v_project, 'episode_number', coalesce(v_prev.episode_number, 0) + 1);
end;
$function$;

create or replace function public.save_episode_checkpoint(p_episode_id uuid, p_checkpoint jsonb, p_base_updated_at timestamptz)
returns timestamptz
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_ep public.content_episodes%rowtype;
  v_version integer;
begin
  select * into v_ep from public.content_episodes where id = p_episode_id for update;
  if not found or not public.can_edit_org(v_ep.organization_id) then raise exception 'Episode not found'; end if;
  if v_ep.checkpoint_status = 'approved' then raise exception 'Episode is approved; reopen it before editing the ending'; end if;
  if p_base_updated_at is null or date_trunc('milliseconds', v_ep.checkpoint_updated_at) <> date_trunc('milliseconds', p_base_updated_at) then
    raise exception 'Ending changed since it was loaded' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_checkpoint) <> 'object' then raise exception 'Invalid ending'; end if;
  select coalesce(max(version), 0) + 1 into v_version from public.story_checkpoint_versions where episode_id = p_episode_id;
  insert into public.story_checkpoint_versions(organization_id, episode_id, version, checkpoint, created_by)
  values (v_ep.organization_id, p_episode_id, v_version, p_checkpoint, auth.uid());
  update public.content_episodes set checkpoint = p_checkpoint, checkpoint_status = 'draft', checkpoint_updated_at = clock_timestamp(),
    summary = nullif(left(coalesce(p_checkpoint ->> 'summary', ''), 4000), ''), ending_hook = nullif(left(coalesce(p_checkpoint ->> 'ending_hook', ''), 1000), '')
  where id = p_episode_id returning checkpoint_updated_at into v_ep.checkpoint_updated_at;
  return v_ep.checkpoint_updated_at;
end;
$function$;

-- Approves an episode: its script must be approved, the episode before it approved and reviewed, and the
-- ending must only refer to canon and to this episode's scenes. Applies arc changes to the bible.
create or replace function public.approve_story_episode(p_episode_id uuid, p_bible_version integer)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_ep public.content_episodes%rowtype;
  v_series public.content_series%rowtype;
  v_project public.studio_projects%rowtype;
  v_bible jsonb;
  v_cp jsonb;
  v_bad text;
  v_scenes integer;
  v_fp text;
  v_old jsonb;
  v_chars text[];
  v_arcs text[];
  v_new_bible jsonb;
  v_ev jsonb;
  v_seq integer := 0;
begin
  select * into v_ep from public.content_episodes where id = p_episode_id for update;
  if not found or not public.can_edit_org(v_ep.organization_id) then raise exception 'Episode not found'; end if;
  select * into v_series from public.content_series where id = v_ep.series_id for update;
  if p_bible_version is distinct from v_series.current_bible_version then raise exception 'Story bible changed since it was loaded' using errcode = 'P0001'; end if;
  if v_ep.checkpoint_status = 'approved' then raise exception 'Episode is already approved'; end if;
  if v_ep.checkpoint_status = 'none' then raise exception 'Write the episode ending first'; end if;
  if v_ep.review_status <> 'ok' then raise exception 'Review this episode first'; end if;
  if exists (select 1 from public.content_episodes where series_id = v_ep.series_id and episode_number < v_ep.episode_number
             and (checkpoint_status <> 'approved' or review_status <> 'ok')) then
    raise exception 'Approve and review the earlier episodes first';
  end if;
  select * into v_project from public.studio_projects where id = v_ep.project_id;
  if v_project.id is null or v_project.script_status <> 'approved' or v_project.approved_revision_id is null then raise exception 'Approve the episode script first'; end if;

  v_cp := v_ep.checkpoint;
  select bible into v_bible from public.story_bible_versions where series_id = v_ep.series_id and version = v_series.current_bible_version;
  if char_length(btrim(coalesce(v_cp ->> 'summary', ''))) = 0 then raise exception 'Ending summary required'; end if;
  select r into v_bad from (
    select c ->> 'ref' r from jsonb_array_elements(coalesce(v_cp -> 'characters', '[]'::jsonb)) c
    union select jsonb_array_elements_text(e -> 'characters') from jsonb_array_elements(coalesce(v_cp -> 'events', '[]'::jsonb)) e
  ) s where not exists (select 1 from jsonb_array_elements(coalesce(v_bible -> 'characters', '[]'::jsonb)) b where b ->> 'ref' = s.r) limit 1;
  if v_bad is not null then raise exception 'Ending refers to a character outside the canon: %', v_bad; end if;
  select k into v_bad from (
    select v_cp ->> 'location_key' k union select c ->> 'location_key' from jsonb_array_elements(coalesce(v_cp -> 'characters', '[]'::jsonb)) c
  ) s where coalesce(k, '') <> '' and not exists (select 1 from jsonb_array_elements(coalesce(v_bible -> 'locations', '[]'::jsonb)) l where l ->> 'key' = s.k) limit 1;
  if v_bad is not null then raise exception 'Ending refers to an unknown location: %', v_bad; end if;
  select a into v_bad from (
    select jsonb_array_elements_text(coalesce(v_cp -> 'arcs_progressed', '[]'::jsonb)) a union select jsonb_array_elements_text(coalesce(v_cp -> 'arcs_resolved', '[]'::jsonb))
  ) s where not exists (select 1 from jsonb_array_elements(coalesce(v_bible -> 'arcs', '[]'::jsonb)) b where b ->> 'id' = s.a) limit 1;
  if v_bad is not null then raise exception 'Ending refers to an unknown plot thread: %', v_bad; end if;
  select count(*) into v_scenes from public.project_scenes where project_id = v_project.id;
  if exists (select 1 from jsonb_array_elements(coalesce(v_cp -> 'events', '[]'::jsonb)) e
             where jsonb_array_length(coalesce(e -> 'scenes', '[]'::jsonb)) = 0
                or exists (select 1 from jsonb_array_elements_text(e -> 'scenes') n where n::integer < 1 or n::integer > v_scenes)) then
    raise exception 'Every event must come from a scene of this episode';
  end if;

  v_fp := md5(v_cp::text);
  v_old := v_ep.approved_checkpoint;
  update public.content_episodes set
    checkpoint_status = 'approved', status = 'approved', approved_checkpoint = v_cp, checkpoint_fingerprint = v_fp,
    approved_project_revision_id = v_project.approved_revision_id, approved_at = now(), approved_by = auth.uid(),
    last_scene_state = jsonb_build_object('location', v_cp ->> 'location_key', 'characters', v_cp -> 'characters')
  where id = p_episode_id;

  delete from public.story_events where episode_id = p_episode_id;
  for v_ev in select value from jsonb_array_elements(coalesce(v_cp -> 'events', '[]'::jsonb)) loop
    v_seq := v_seq + 1;
    insert into public.story_events(organization_id, series_id, episode_id, seq, text, characters, scenes)
    values (v_ep.organization_id, v_ep.series_id, p_episode_id, v_seq, left(coalesce(v_ev ->> 'text', ''), 500),
            coalesce((select array_agg(x) from jsonb_array_elements_text(v_ev -> 'characters') x), '{}'),
            coalesce((select array_agg(x::integer) from jsonb_array_elements_text(v_ev -> 'scenes') x), '{}'));
  end loop;

  -- Re-approval: an identical ending clears the "reopened" flags it caused; a different ending flags later episodes.
  if v_old is not null then
    if md5(v_old::text) = v_fp then
      update public.content_episodes set
        review_reasons = coalesce((select jsonb_agg(r) from jsonb_array_elements(review_reasons) r
                                   where not ((r ->> 'episode_number')::integer = v_ep.episode_number and r ->> 'kind' = 'earlier_episode_reopened')), '[]'::jsonb)
      where series_id = v_ep.series_id and episode_number > v_ep.episode_number;
      update public.content_episodes set review_status = 'ok'
      where series_id = v_ep.series_id and episode_number > v_ep.episode_number and review_status = 'needs_review' and jsonb_array_length(review_reasons) = 0;
    else
      select coalesce(array_agg(distinct ref), '{}') into v_chars from (
        select coalesce(n.v ->> 'ref', o.v ->> 'ref') ref from jsonb_array_elements(coalesce(v_cp -> 'characters', '[]'::jsonb)) as n(v)
        full join jsonb_array_elements(coalesce(v_old -> 'characters', '[]'::jsonb)) as o(v) on o.v ->> 'ref' = n.v ->> 'ref'
        where n.v is distinct from o.v
        union select jsonb_array_elements_text(e -> 'characters') from jsonb_array_elements(coalesce(v_cp -> 'events', '[]'::jsonb)) e where (v_cp -> 'events') is distinct from (v_old -> 'events')
        union select jsonb_array_elements_text(e -> 'characters') from jsonb_array_elements(coalesce(v_old -> 'events', '[]'::jsonb)) e where (v_cp -> 'events') is distinct from (v_old -> 'events')
      ) s where ref is not null;
      select coalesce(array_agg(distinct a), '{}') into v_arcs from (
        select jsonb_array_elements_text(coalesce(v_cp -> 'arcs_progressed', '[]'::jsonb)) a union select jsonb_array_elements_text(coalesce(v_cp -> 'arcs_resolved', '[]'::jsonb))
        union select jsonb_array_elements_text(coalesce(v_old -> 'arcs_progressed', '[]'::jsonb)) union select jsonb_array_elements_text(coalesce(v_old -> 'arcs_resolved', '[]'::jsonb))
      ) s where (v_cp -> 'arcs_progressed', v_cp -> 'arcs_resolved', v_cp -> 'arcs_opened') is distinct from (v_old -> 'arcs_progressed', v_old -> 'arcs_resolved', v_old -> 'arcs_opened');
      select * into v_ep from public.content_episodes where id = p_episode_id;
      perform public.limo_flag_later_episodes(v_ep, 'earlier_episode_changed', v_chars, v_arcs);
    end if;
  end if;

  -- Arc changes recorded in the approved ending become canon (a new bible version the user can restore).
  if jsonb_array_length(coalesce(v_cp -> 'arcs_resolved', '[]'::jsonb)) > 0 or jsonb_array_length(coalesce(v_cp -> 'arcs_opened', '[]'::jsonb)) > 0 then
    v_new_bible := jsonb_set(v_bible, '{arcs}', (
      select coalesce(jsonb_agg(case when (v_cp -> 'arcs_resolved') ? (a ->> 'id')
                                      then a || jsonb_build_object('status', 'resolved', 'resolved_in', v_ep.episode_number) else a end), '[]'::jsonb)
      from jsonb_array_elements(coalesce(v_bible -> 'arcs', '[]'::jsonb)) a
    ) || coalesce((
      select jsonb_agg(jsonb_build_object('id', n ->> 'id', 'title', n ->> 'title', 'description', coalesce(n ->> 'description', ''), 'status', 'open', 'opened_in', v_ep.episode_number, 'resolved_in', null))
      from jsonb_array_elements(coalesce(v_cp -> 'arcs_opened', '[]'::jsonb)) n
      where not exists (select 1 from jsonb_array_elements(coalesce(v_bible -> 'arcs', '[]'::jsonb)) a where a ->> 'id' = n ->> 'id')
    ), '[]'::jsonb));
    perform public.limo_write_bible(v_series, v_new_bible, 'episode_approval', 'Plot threads from episode ' || v_ep.episode_number);
  end if;

  insert into public.platform_audit_events(organization_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (v_ep.organization_id, auth.uid(), 'story.episode_approved', 'content_episode', p_episode_id, jsonb_build_object('episode_number', v_ep.episode_number, 'fingerprint', v_fp));
  return jsonb_build_object('fingerprint', v_fp, 'bible_version', (select current_bible_version from public.content_series where id = v_ep.series_id));
end;
$function$;

create or replace function public.reopen_story_episode(p_episode_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.content_episodes where id = p_episode_id;
  if v_org is null or not public.can_edit_org(v_org) then raise exception 'Episode not found'; end if;
  perform public.limo_reopen_episode(p_episode_id, 'earlier_episode_reopened');
end;
$function$;

-- The writer confirms a flagged episode still fits (after reviewing it). Earlier episodes must be settled first.
create or replace function public.resolve_episode_review(p_episode_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_ep public.content_episodes%rowtype;
begin
  select * into v_ep from public.content_episodes where id = p_episode_id for update;
  if not found or not public.can_edit_org(v_ep.organization_id) then raise exception 'Episode not found'; end if;
  if v_ep.review_status <> 'needs_review' then return; end if;
  if char_length(btrim(coalesce(p_note, ''))) < 5 then raise exception 'Describe what you checked (at least 5 characters)'; end if;
  if exists (select 1 from public.content_episodes where series_id = v_ep.series_id and episode_number < v_ep.episode_number
             and (checkpoint_status <> 'approved' or review_status <> 'ok')) then
    raise exception 'Approve and review the earlier episodes first';
  end if;
  update public.content_episodes set review_status = 'ok', review_reasons = '[]'::jsonb,
    review_history = review_history || jsonb_build_array(jsonb_build_object('reasons', review_reasons, 'note', left(btrim(p_note), 500), 'by', auth.uid(), 'at', now()))
  where id = p_episode_id;
  insert into public.platform_audit_events(organization_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (v_ep.organization_id, auth.uid(), 'story.episode_reviewed', 'content_episode', p_episode_id, jsonb_build_object('episode_number', v_ep.episode_number));
end;
$function$;

revoke all on function public.create_story_series(uuid, text, text, text, jsonb) from public, anon;
revoke all on function public.save_story_bible(uuid, integer, jsonb, text) from public, anon;
revoke all on function public.restore_story_bible(uuid, integer, integer) from public, anon;
revoke all on function public.create_story_season(uuid, text, text) from public, anon;
revoke all on function public.create_story_episode(uuid, uuid, uuid, text, text, text, jsonb, jsonb, text[]) from public, anon;
revoke all on function public.save_episode_checkpoint(uuid, jsonb, timestamptz) from public, anon;
revoke all on function public.approve_story_episode(uuid, integer) from public, anon;
revoke all on function public.reopen_story_episode(uuid) from public, anon;
revoke all on function public.resolve_episode_review(uuid, text) from public, anon;
grant execute on function public.create_story_series(uuid, text, text, text, jsonb) to authenticated;
grant execute on function public.save_story_bible(uuid, integer, jsonb, text) to authenticated;
grant execute on function public.restore_story_bible(uuid, integer, integer) to authenticated;
grant execute on function public.create_story_season(uuid, text, text) to authenticated;
grant execute on function public.create_story_episode(uuid, uuid, uuid, text, text, text, jsonb, jsonb, text[]) to authenticated;
grant execute on function public.save_episode_checkpoint(uuid, jsonb, timestamptz) to authenticated;
grant execute on function public.approve_story_episode(uuid, integer) to authenticated;
grant execute on function public.reopen_story_episode(uuid) to authenticated;
grant execute on function public.resolve_episode_review(uuid, text) to authenticated;

-- Existing series (created before this migration) get bible version 1 from their old JSON fields.
do $$
declare
  v_s public.content_series%rowtype;
begin
  for v_s in select * from public.content_series where current_bible_version = 0 loop
    insert into public.story_bible_versions(organization_id, series_id, version, bible, source, note, created_by)
    values (v_s.organization_id, v_s.id, 1,
            jsonb_build_object('premise', coalesce(v_s.premise, ''), 'genre', coalesce(v_s.genre, ''), 'tone', '', 'characters', '[]'::jsonb,
                               'relationships', '[]'::jsonb, 'locations', '[]'::jsonb, 'world_rules', '[]'::jsonb, 'arcs', '[]'::jsonb,
                               'legacy', jsonb_build_object('cast_bible', v_s.cast_bible, 'world_bible', v_s.world_bible, 'story_rules', v_s.story_rules)),
            'created', 'Imported from the series fields', v_s.created_by);
    update public.content_series set current_bible_version = 1 where id = v_s.id;
  end loop;
end $$;
