-- LIMO Animation Studio + creative AI jobs v1.
-- Status: PENDING OWNER APPROVAL for production (14th pending migration). Additive, except that render_jobs gains an
-- animation source (project_id / script_revision_id become nullable when animation_project_id is set).
-- Depends on 20261017090000 (feature_flags, is_platform_admin_mfa), 20261017140000 (character references),
-- 20261017200000 (render_jobs), 20261018090000 (30 s / one-credit policy), 20261018120000 (AI kinds, provenance).
--
--   * animation_projects / animation_shots / animation_shot_events: the owner's scenario as a persisted storyboard
--     (≤ 30 s, shots of 4/6/8 s = Veo clip lengths), canonical or workspace characters, attached APPROVED reference
--     images, continuity metadata, first/last frame, dialogue + narration timeline, per-shot keyframe and clip with
--     approve / reject / revise and a full event history.
--   * ai_jobs: one queue for creative AI work processed by the generator worker (service role): animation keyframe,
--     clip and voice; Facebook Content Studio caption, rewrite and promotional image. Users only REQUEST jobs; the
--     worker computes the verified price, reserves the workspace AI budget and the platform spend guard, calls the
--     provider (or the mock), stores outputs with provenance and settles. Nothing runs while the flags are off.
--   * flags (all OFF): animation_generation, ai_social_text, ai_social_images — on top of paid_generation.
--   * enqueue_animation_render: approved shots → render spec → the existing render worker (one video credit,
--     V1 policy: ≤ 30 s), so the flagship MP4 comes out of the same pipeline as every export.

-- 0. Flags ---------------------------------------------------------------------------------------------------------
insert into public.feature_flags(key, enabled, description) values
  ('animation_generation', false, 'AI keyframes, clips and voices for Animation Studio shots. Owner approval required.'),
  ('ai_social_text', false, 'AI captions and rewrites in the Facebook composer. Owner approval required.'),
  ('ai_social_images', false, 'AI promotional images for posts and Image Studio. Owner approval required.')
on conflict (key) do nothing;

-- 1. Tables -------------------------------------------------------------------------------------------------------
create table if not exists public.animation_projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 150),
  language_code text not null default 'fr' check (language_code in ('en', 'fr', 'ar', 'de')),
  aspect text not null default '9:16' check (aspect in ('9:16', '16:9')),
  music_asset_id uuid references public.media_assets(id) on delete set null,
  music_note text not null default '' check (char_length(music_note) <= 500),
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) < 8192),
  status text not null default 'draft' check (status in ('draft', 'in_production', 'ready', 'archived')),
  revision integer not null default 1,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists animation_projects_org_idx on public.animation_projects(organization_id, updated_at desc);

create table if not exists public.animation_shots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.animation_projects(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  shot_number integer not null check (shot_number between 1 and 15),
  duration_seconds integer not null check (duration_seconds in (4, 6, 8)),
  description text not null default '' check (char_length(description) <= 2000),
  environment text not null default '' check (char_length(environment) <= 1000),
  camera text not null default '' check (char_length(camera) <= 500),
  characters text[] not null default '{}' check (cardinality(characters) <= 5),
  actions jsonb not null default '{}'::jsonb check (jsonb_typeof(actions) = 'object' and pg_column_size(actions) < 8192),
  expressions jsonb not null default '{}'::jsonb check (jsonb_typeof(expressions) = 'object'),
  dialogue jsonb not null default '[]'::jsonb check (jsonb_typeof(dialogue) = 'array' and pg_column_size(dialogue) < 16384),
  narration text not null default '' check (char_length(narration) <= 1000),
  sound text not null default '' check (char_length(sound) <= 500),
  continuity jsonb not null default '{}'::jsonb check (jsonb_typeof(continuity) = 'object' and pg_column_size(continuity) < 4096),
  reference_asset_ids uuid[] not null default '{}' check (cardinality(reference_asset_ids) <= 5),
  status text not null default 'draft' check (status in ('draft', 'keyframe_queued', 'keyframe_review', 'keyframe_approved', 'clip_queued', 'clip_review', 'approved')),
  keyframe_asset_id uuid references public.media_assets(id) on delete set null,
  first_frame_asset_id uuid references public.media_assets(id) on delete set null,
  last_frame_asset_id uuid references public.media_assets(id) on delete set null,
  clip_asset_id uuid references public.media_assets(id) on delete set null,
  voice_tracks jsonb not null default '[]'::jsonb check (jsonb_typeof(voice_tracks) = 'array' and pg_column_size(voice_tracks) < 16384),
  clip_audio text not null default 'keep' check (clip_audio in ('keep', 'mute')),
  revision integer not null default 1,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, shot_number) deferrable initially deferred
);
create index if not exists animation_shots_project_idx on public.animation_shots(project_id, shot_number);
-- Identity review per stage: automated deterministic checks (never proof of identity) + the human confirmation.
alter table public.animation_shots add column if not exists identity_review jsonb not null default '{}'::jsonb;
-- Generation attempts per job kind (all revisions; the per-revision cap is enforced from ai_jobs).
alter table public.animation_shots add column if not exists attempts jsonb not null default '{}'::jsonb;

create table if not exists public.animation_shot_events (
  id uuid primary key default gen_random_uuid(),
  shot_id uuid not null references public.animation_shots(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid,
  event text not null check (event in ('created', 'edited', 'job_requested', 'keyframe_ready', 'clip_ready', 'voice_ready', 'approved', 'rejected', 'failed', 'frames_set')),
  stage text check (stage in ('keyframe', 'clip', 'voice')),
  note text check (char_length(note) <= 1000),
  asset_id uuid,
  revision integer,
  created_at timestamptz not null default now()
);
create index if not exists animation_shot_events_shot_idx on public.animation_shot_events(shot_id, created_at desc);

create table if not exists public.ai_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  requested_by uuid,
  kind text not null check (kind in ('animation_keyframe', 'animation_clip', 'animation_voice', 'social_caption', 'social_rewrite', 'social_image')),
  shot_id uuid references public.animation_shots(id) on delete cascade,
  shot_revision integer,
  request_key text not null check (char_length(request_key) between 8 and 160),
  input jsonb not null default '{}'::jsonb check (jsonb_typeof(input) = 'object' and pg_column_size(input) < 32768),
  confirmed_cents integer not null default 0 check (confirmed_cents between 0 and 100000),
  status text not null default 'queued' check (status in ('queued', 'processing', 'waiting_provider', 'completed', 'failed', 'cancelled')),
  attempts integer not null default 0,
  locked_by text,
  locked_at timestamptz,
  poll_after timestamptz,
  provider text,
  provider_job_id text,
  provider_payload jsonb not null default '{}'::jsonb,
  estimate_cents integer,
  actual_cost_cents integer,
  budget_reservation_id uuid,
  output jsonb not null default '{}'::jsonb check (pg_column_size(output) < 65536),
  output_asset_ids uuid[] not null default '{}',
  error_code text,
  error_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (organization_id, request_key)
);
create index if not exists ai_jobs_claim_idx on public.ai_jobs(status, poll_after, created_at);
create index if not exists ai_jobs_org_idx on public.ai_jobs(organization_id, created_at desc);

alter table public.animation_projects enable row level security;
alter table public.animation_shots enable row level security;
alter table public.animation_shot_events enable row level security;
alter table public.ai_jobs enable row level security;
drop policy if exists animation_projects_read on public.animation_projects;
create policy animation_projects_read on public.animation_projects for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists animation_shots_read on public.animation_shots;
create policy animation_shots_read on public.animation_shots for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists animation_shot_events_read on public.animation_shot_events;
create policy animation_shot_events_read on public.animation_shot_events for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists ai_jobs_read on public.ai_jobs;
create policy ai_jobs_read on public.ai_jobs for select to authenticated using (public.is_org_member(organization_id));
revoke insert, update, delete on public.animation_projects, public.animation_shots, public.animation_shot_events, public.ai_jobs from anon, authenticated;
grant select on public.animation_projects, public.animation_shots, public.animation_shot_events, public.ai_jobs to authenticated;
grant all on public.animation_projects, public.animation_shots, public.animation_shot_events, public.ai_jobs to service_role;

-- 2. Render jobs: an animation project can be the source of an export ----------------------------------------------
alter table public.render_jobs add column if not exists animation_project_id uuid references public.animation_projects(id) on delete cascade;
alter table public.render_jobs alter column project_id drop not null;
alter table public.render_jobs alter column script_revision_id drop not null;
alter table public.render_jobs alter column script_revision_number drop not null;
alter table public.render_jobs drop constraint if exists render_jobs_source_check;
alter table public.render_jobs add constraint render_jobs_source_check
  check ((project_id is not null and script_revision_id is not null and script_revision_number is not null and animation_project_id is null)
      or (animation_project_id is not null and project_id is null));

-- 3. Helpers ------------------------------------------------------------------------------------------------------
create or replace function public.animation_flag(p_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select enabled from public.feature_flags where key = p_key), false)
$$;

/** Missing items before a character may be animated: approved spec (catalog) and approved front/three-quarter/side. */
create or replace function public.animation_character_gaps(p_organization_id uuid, p_character text)
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare
  v_out text[] := '{}';
  v_custom uuid;
  v_version integer;
  v_view text;
begin
  if p_character like 'custom:%' then
    begin
      v_custom := substring(p_character from 8)::uuid;
    exception when others then return array['unknown_character'];
    end;
    select spec_version into v_version from public.characters where id = v_custom and organization_id = p_organization_id;
    if not found then return array['unknown_character']; end if;
  else
    if not exists (select 1 from public.character_catalog where id = p_character) or p_character in ('limo', 'nova', 'adam') then return array['unknown_character']; end if;
    select max(version) into v_version from public.character_design_specs where character_id = p_character and status = 'approved';
    if v_version is null then v_out := array_append(v_out, 'spec_not_approved'); end if;
  end if;
  foreach v_view in array array['front', 'three_quarter', 'side'] loop
    if not exists (
      select 1 from public.character_reference_assets r
      where r.status = 'approved' and r.asset_kind = 'rendered_reference' and r.view = v_view
        and (v_version is null or r.spec_version = v_version)
        and ((v_custom is not null and r.custom_character_id = v_custom and r.organization_id = p_organization_id)
          or (v_custom is null and r.catalog_character_id = p_character))
    ) then v_out := array_append(v_out, 'missing_' || v_view); end if;
  end loop;
  return v_out;
end;
$$;

create or replace function public.animation_log(p_shot public.animation_shots, p_event text, p_stage text, p_note text, p_asset uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.animation_shot_events(shot_id, organization_id, actor_user_id, event, stage, note, asset_id, revision)
  values (p_shot.id, p_shot.organization_id, auth.uid(), p_event, p_stage, left(p_note, 1000), p_asset, p_shot.revision)
$$;

-- 4. Customer functions -------------------------------------------------------------------------------------------
create or replace function public.save_animation_project(p_organization_id uuid, p_project_id uuid, p_title text, p_language text, p_aspect text,
                                                         p_music_asset_id uuid, p_music_note text, p_settings jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if not public.can_edit_org(p_organization_id) then raise exception 'Not authorized'; end if;
  if p_music_asset_id is not null and not exists (select 1 from public.media_assets where id = p_music_asset_id and organization_id = p_organization_id and media_type = 'audio') then
    raise exception 'Music must be an audio file of this workspace';
  end if;
  if p_project_id is null then
    insert into public.animation_projects(organization_id, title, language_code, aspect, music_asset_id, music_note, settings, created_by)
    values (p_organization_id, btrim(p_title), p_language, coalesce(p_aspect, '9:16'), p_music_asset_id, coalesce(p_music_note, ''), coalesce(p_settings, '{}'::jsonb), auth.uid())
    returning id into v_id;
  else
    update public.animation_projects set title = btrim(p_title), language_code = p_language, aspect = coalesce(p_aspect, aspect), music_asset_id = p_music_asset_id,
      music_note = coalesce(p_music_note, ''), settings = coalesce(p_settings, settings), updated_at = now()
    where id = p_project_id and organization_id = p_organization_id
    returning id into v_id;
    if v_id is null then raise exception 'Animation project not found'; end if;
  end if;
  return v_id;
end;
$$;

/**
 * Replaces the storyboard (shots identified by id; new shots without id). Content changes to a shot that already has a
 * keyframe or clip send it back to draft (revision + 1; earlier files stay in the library). Shots being generated
 * cannot be changed or removed. Validates the V1 limit, Veo shot lengths, characters, speakers, expressions and that
 * attached references are APPROVED references of the shot's characters.
 */
create or replace function public.save_animation_shots(p_project_id uuid, p_shots jsonb, p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  p public.animation_projects%rowtype;
  s jsonb;
  cur public.animation_shots%rowtype;
  v_ids uuid[] := '{}';
  v_total integer := 0;
  v_chars text[];
  v_refs uuid[];
  v_line jsonb;
  v_ch text;
  v_e text;
  v_changed boolean;
  v_n integer := 0;
  v_expr text[] := array['neutral', 'happy', 'laughing', 'surprised', 'sad', 'thinking', 'determined', 'worried'];
begin
  select * into p from public.animation_projects where id = p_project_id for update;
  if not found then raise exception 'Animation project not found'; end if;
  if not public.can_edit_org(p.organization_id) then raise exception 'Not authorized'; end if;
  if p_expected_revision is not null and p_expected_revision <> p.revision then raise exception 'The storyboard changed in another window; reload'; end if;
  if jsonb_typeof(p_shots) <> 'array' or jsonb_array_length(p_shots) > 15 then raise exception 'At most 15 shots'; end if;
  for s in select * from jsonb_array_elements(p_shots) loop
    v_n := v_n + 1;
    v_total := v_total + coalesce((s ->> 'duration_seconds')::integer, 0);
    if (s ->> 'duration_seconds')::integer not in (4, 6, 8) then raise exception 'Each shot lasts 4, 6 or 8 seconds'; end if;
    v_chars := coalesce(array(select jsonb_array_elements_text(coalesce(s -> 'characters', '[]'::jsonb))), '{}');
    if cardinality(v_chars) > 5 then raise exception 'At most 5 characters per shot'; end if;
    foreach v_ch in array v_chars loop
      if 'unknown_character' = any(public.animation_character_gaps(p.organization_id, v_ch)) then raise exception 'Unknown character %', v_ch; end if;
    end loop;
    for v_line in select * from jsonb_array_elements(coalesce(s -> 'dialogue', '[]'::jsonb)) loop
      if not ((v_line ->> 'speaker') = any(v_chars)) then raise exception 'A speaker must be in the shot'; end if;
      if nullif(btrim(coalesce(v_line ->> 'text', '')), '') is null then raise exception 'Empty dialogue line'; end if;
      if v_line ? 'emotion' and nullif(v_line ->> 'emotion', '') is not null and not ((v_line ->> 'emotion') = any(v_expr)) then raise exception 'Unknown expression'; end if;
    end loop;
    for v_ch, v_e in select key, value #>> '{}' from jsonb_each(coalesce(s -> 'expressions', '{}'::jsonb)) loop
      if not (v_ch = any(v_chars)) or not (v_e = any(v_expr)) then raise exception 'Invalid expression'; end if;
    end loop;
    v_refs := coalesce(array(select jsonb_array_elements_text(coalesce(s -> 'reference_asset_ids', '[]'::jsonb))::uuid), '{}');
    if exists (
      select 1 from unnest(v_refs) rid
      where not exists (
        select 1 from public.character_reference_assets r
        where r.id = rid and r.status = 'approved'
          and ((r.catalog_character_id is not null and r.catalog_character_id = any(v_chars))
            or (r.custom_character_id is not null and r.organization_id = p.organization_id and ('custom:' || r.custom_character_id::text) = any(v_chars)))
      )
    ) then raise exception 'References must be approved references of the shot''s characters'; end if;
    if s ? 'id' and nullif(s ->> 'id', '') is not null then v_ids := v_ids || (s ->> 'id')::uuid; end if;
  end loop;
  if v_total > public.limo_video_max_duration_ms(p.organization_id) / 1000 then
    raise exception 'Videos are limited to % seconds', public.limo_video_max_duration_ms(p.organization_id) / 1000;
  end if;
  if exists (select 1 from public.animation_shots where project_id = p.id and status in ('keyframe_queued', 'clip_queued') and not (id = any(v_ids))) then
    raise exception 'A shot that is being generated cannot be removed';
  end if;
  delete from public.animation_shots where project_id = p.id and not (id = any(v_ids));

  v_n := 0;
  for s in select * from jsonb_array_elements(p_shots) loop
    v_n := v_n + 1;
    v_chars := coalesce(array(select jsonb_array_elements_text(coalesce(s -> 'characters', '[]'::jsonb))), '{}');
    v_refs := coalesce(array(select jsonb_array_elements_text(coalesce(s -> 'reference_asset_ids', '[]'::jsonb))::uuid), '{}');
    cur := null;
    if s ? 'id' and nullif(s ->> 'id', '') is not null then
      select * into cur from public.animation_shots where id = (s ->> 'id')::uuid and project_id = p.id for update;
      if cur.id is null then raise exception 'Shot not found'; end if;
    end if;
    if cur.id is null then
      insert into public.animation_shots(project_id, organization_id, shot_number, duration_seconds, description, environment, camera, characters, actions, expressions,
                                         dialogue, narration, sound, continuity, reference_asset_ids, clip_audio)
      values (p.id, p.organization_id, v_n, (s ->> 'duration_seconds')::integer, coalesce(s ->> 'description', ''), coalesce(s ->> 'environment', ''), coalesce(s ->> 'camera', ''),
              v_chars, coalesce(s -> 'actions', '{}'::jsonb), coalesce(s -> 'expressions', '{}'::jsonb), coalesce(s -> 'dialogue', '[]'::jsonb), coalesce(s ->> 'narration', ''),
              coalesce(s ->> 'sound', ''), coalesce(s -> 'continuity', '{}'::jsonb), v_refs, coalesce(nullif(s ->> 'clip_audio', ''), 'keep'))
      returning * into cur;
      perform public.animation_log(cur, 'created', null, null, null);
    else
      v_changed := cur.duration_seconds <> (s ->> 'duration_seconds')::integer or cur.description <> coalesce(s ->> 'description', '') or cur.environment <> coalesce(s ->> 'environment', '')
        or cur.camera <> coalesce(s ->> 'camera', '') or cur.characters <> v_chars or cur.actions <> coalesce(s -> 'actions', '{}'::jsonb)
        or cur.expressions <> coalesce(s -> 'expressions', '{}'::jsonb) or cur.dialogue <> coalesce(s -> 'dialogue', '[]'::jsonb) or cur.narration <> coalesce(s ->> 'narration', '')
        or cur.sound <> coalesce(s ->> 'sound', '') or cur.continuity <> coalesce(s -> 'continuity', '{}'::jsonb) or cur.reference_asset_ids <> v_refs;
      if v_changed and cur.status in ('keyframe_queued', 'clip_queued') then raise exception 'Shot % is being generated', cur.shot_number; end if;
      update public.animation_shots set shot_number = v_n, duration_seconds = (s ->> 'duration_seconds')::integer, description = coalesce(s ->> 'description', ''),
        environment = coalesce(s ->> 'environment', ''), camera = coalesce(s ->> 'camera', ''), characters = v_chars, actions = coalesce(s -> 'actions', '{}'::jsonb),
        expressions = coalesce(s -> 'expressions', '{}'::jsonb), dialogue = coalesce(s -> 'dialogue', '[]'::jsonb), narration = coalesce(s ->> 'narration', ''),
        sound = coalesce(s ->> 'sound', ''), continuity = coalesce(s -> 'continuity', '{}'::jsonb), reference_asset_ids = v_refs,
        clip_audio = coalesce(nullif(s ->> 'clip_audio', ''), clip_audio),
        status = case when v_changed then 'draft' else status end,
        keyframe_asset_id = case when v_changed then null else keyframe_asset_id end,
        first_frame_asset_id = case when v_changed then null else first_frame_asset_id end,
        clip_asset_id = case when v_changed then null else clip_asset_id end,
        voice_tracks = case when v_changed then '[]'::jsonb else voice_tracks end,
        revision = revision + case when v_changed then 1 else 0 end,
        updated_at = now()
      where id = cur.id returning * into cur;
      if v_changed then perform public.animation_log(cur, 'edited', null, null, null); end if;
    end if;
  end loop;
  update public.animation_projects set revision = revision + 1, updated_at = now(),
    status = case when status = 'archived' then status when exists (select 1 from public.animation_shots where project_id = p.id and status <> 'draft') then 'in_production' else 'draft' end
  where id = p.id returning * into p;
  return jsonb_build_object('id', p.id, 'revision', p.revision, 'total_seconds', v_total);
end;
$$;

/** Approve or reject the keyframe or the clip of one shot (reject = revise: the shot goes back one step). */
/**
 * Approve or reject (revise) the keyframe or the clip of one shot. Approving a shot that shows characters needs the
 * owner's explicit identity confirmation (deterministic checks cannot prove identity); mock clips are never approvable.
 */
drop function if exists public.decide_animation_shot(uuid, text, text, text);
create or replace function public.decide_animation_shot(p_shot_id uuid, p_stage text, p_decision text, p_note text, p_identity_confirmed boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.animation_shots%rowtype;
begin
  select * into s from public.animation_shots where id = p_shot_id for update;
  if not found then raise exception 'Shot not found'; end if;
  if not public.can_edit_org(s.organization_id) then raise exception 'Not authorized'; end if;
  if p_decision not in ('approve', 'reject') or p_stage not in ('keyframe', 'clip') then raise exception 'Invalid decision'; end if;
  if p_decision = 'reject' and nullif(btrim(coalesce(p_note, '')), '') is null then raise exception 'Say what should change'; end if;
  if p_decision = 'approve' and cardinality(s.characters) > 0 and not coalesce(p_identity_confirmed, false) then
    raise exception 'Confirm the character identity against the approved references';
  end if;
  if p_stage = 'keyframe' then
    if s.status <> 'keyframe_review' then raise exception 'No keyframe waiting for review'; end if;
    update public.animation_shots set status = case when p_decision = 'approve' then 'keyframe_approved' else 'draft' end,
      first_frame_asset_id = case when p_decision = 'approve' then coalesce(first_frame_asset_id, keyframe_asset_id) else null end,
      keyframe_asset_id = case when p_decision = 'approve' then keyframe_asset_id else null end, updated_at = now()
    where id = s.id returning * into s;
  else
    if s.status <> 'clip_review' then raise exception 'No clip waiting for review'; end if;
    -- A mock run produces no animation (no file): it can be rejected, never approved as a clip.
    if p_decision = 'approve' and s.clip_asset_id is null then raise exception 'No generated clip to approve'; end if;
    if p_decision = 'approve' and exists (select 1 from public.media_assets m where m.id = s.clip_asset_id and coalesce((m.provenance ->> 'mock')::boolean, false)) then
      raise exception 'Mock clips cannot be approved as animation';
    end if;
    update public.animation_shots set status = case when p_decision = 'approve' then 'approved' else 'keyframe_approved' end,
      clip_asset_id = case when p_decision = 'approve' then clip_asset_id else null end, updated_at = now()
    where id = s.id returning * into s;
  end if;
  if p_decision = 'approve' then
    update public.animation_shots set identity_review = jsonb_set(identity_review, array[p_stage],
      coalesce(identity_review -> p_stage, '{}'::jsonb) || jsonb_build_object('confirmed_by', auth.uid(), 'confirmed_at', now(), 'manual', cardinality(characters) > 0))
    where id = s.id returning * into s;
  end if;
  perform public.animation_log(s, case when p_decision = 'approve' then 'approved' else 'rejected' end, p_stage, p_note, case when p_stage = 'keyframe' then s.keyframe_asset_id else s.clip_asset_id end);
  return jsonb_build_object('id', s.id, 'status', s.status);
end;
$$;

/** First frame (approved keyframe by default, or another workspace image) and optional last frame (Veo interpolation). */
create or replace function public.set_animation_shot_frames(p_shot_id uuid, p_first_frame_asset_id uuid, p_last_frame_asset_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.animation_shots%rowtype;
begin
  select * into s from public.animation_shots where id = p_shot_id for update;
  if not found then raise exception 'Shot not found'; end if;
  if not public.can_edit_org(s.organization_id) then raise exception 'Not authorized'; end if;
  if s.status in ('clip_queued', 'clip_review', 'approved') then raise exception 'The clip already exists; reject it first'; end if;
  if p_last_frame_asset_id is not null and p_first_frame_asset_id is null then raise exception 'A last frame needs a first frame'; end if;
  if exists (select 1 from unnest(array[p_first_frame_asset_id, p_last_frame_asset_id]) a
             where a is not null and not exists (select 1 from public.media_assets m where m.id = a and m.organization_id = s.organization_id and m.media_type = 'image')) then
    raise exception 'Frames must be images of this workspace';
  end if;
  update public.animation_shots set first_frame_asset_id = p_first_frame_asset_id, last_frame_asset_id = p_last_frame_asset_id, updated_at = now() where id = s.id returning * into s;
  perform public.animation_log(s, 'frames_set', 'clip', null, p_first_frame_asset_id);
  return jsonb_build_object('id', s.id, 'first_frame_asset_id', s.first_frame_asset_id, 'last_frame_asset_id', s.last_frame_asset_id);
end;
$$;

/** Readiness of every character used in a project (for the editor). */
create or replace function public.animation_readiness(p_project_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  p public.animation_projects%rowtype;
  v_out jsonb := '{}'::jsonb;
  v_ch text;
begin
  select * into p from public.animation_projects where id = p_project_id;
  if not found or not public.is_org_member(p.organization_id) then raise exception 'Animation project not found'; end if;
  for v_ch in select distinct unnest(characters) from public.animation_shots where project_id = p.id loop
    v_out := v_out || jsonb_build_object(v_ch, jsonb_build_object(
      'gaps', to_jsonb(public.animation_character_gaps(p.organization_id, v_ch)),
      'voice', (select jsonb_build_object('provider', provider, 'voice_ref', voice_ref) from public.character_voice_profiles where character_id = v_ch and language_code = p.language_code and active)));
  end loop;
  return jsonb_build_object('flags', jsonb_build_object('animation_generation', public.animation_flag('animation_generation'), 'paid_generation', public.animation_flag('paid_generation')), 'characters', v_out);
end;
$$;

/** Requests a keyframe, clip or voice for one shot. Refused while the flag is off or a character is not ready. */
create or replace function public.request_animation_job(p_shot_id uuid, p_kind text, p_request_key text, p_confirmed_cents integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.animation_shots%rowtype;
  p public.animation_projects%rowtype;
  j public.ai_jobs%rowtype;
  v_ch text;
  v_gaps text[];
begin
  select * into s from public.animation_shots where id = p_shot_id for update;
  if not found then raise exception 'Shot not found'; end if;
  if not public.can_edit_org(s.organization_id) then raise exception 'Not authorized'; end if;
  if p_kind not in ('animation_keyframe', 'animation_clip', 'animation_voice') then raise exception 'Invalid job'; end if;
  select * into j from public.ai_jobs where organization_id = s.organization_id and request_key = p_request_key;
  if found then return jsonb_build_object('id', j.id, 'status', j.status, 'reused', true); end if;
  if not public.animation_flag('animation_generation') then raise exception 'AI animation is not enabled'; end if;
  select * into p from public.animation_projects where id = s.project_id;
  foreach v_ch in array s.characters loop
    v_gaps := public.animation_character_gaps(s.organization_id, v_ch);
    if cardinality(v_gaps) > 0 then raise exception 'Character % is not ready: %', v_ch, array_to_string(v_gaps, ', '); end if;
  end loop;
  if p_kind = 'animation_keyframe' and s.status not in ('draft', 'keyframe_review') then raise exception 'This shot already has an approved keyframe'; end if;
  if p_kind = 'animation_clip' and (s.status <> 'keyframe_approved' or s.first_frame_asset_id is null) then raise exception 'Approve the keyframe first'; end if;
  if p_kind = 'animation_voice' and jsonb_array_length(s.dialogue) = 0 and s.narration = '' then raise exception 'Nothing to speak in this shot'; end if;
  if exists (select 1 from public.ai_jobs where shot_id = s.id and kind = p_kind and status in ('queued', 'processing', 'waiting_provider')) then raise exception 'Already in progress'; end if;
  -- Cost control: at most 5 attempts per job kind for one revision of a shot (edit the shot to start a new revision).
  if (select count(*) from public.ai_jobs where shot_id = s.id and kind = p_kind and shot_revision = s.revision and status <> 'cancelled') >= 5 then
    raise exception 'Attempt limit reached for this shot (5)';
  end if;
  update public.animation_shots set attempts = jsonb_set(attempts, array[p_kind], to_jsonb(coalesce((attempts ->> p_kind)::integer, 0) + 1)) where id = s.id returning * into s;
  insert into public.ai_jobs(organization_id, requested_by, kind, shot_id, shot_revision, request_key, input, confirmed_cents)
  values (s.organization_id, auth.uid(), p_kind, s.id, s.revision, p_request_key,
          jsonb_build_object('project_id', p.id, 'language', p.language_code, 'aspect', p.aspect), greatest(0, coalesce(p_confirmed_cents, 0)))
  returning * into j;
  if p_kind = 'animation_keyframe' then update public.animation_shots set status = 'keyframe_queued', last_error = null, updated_at = now() where id = s.id returning * into s;
  elsif p_kind = 'animation_clip' then update public.animation_shots set status = 'clip_queued', last_error = null, updated_at = now() where id = s.id returning * into s;
  end if;
  perform public.animation_log(s, 'job_requested', replace(p_kind, 'animation_', ''), null, null);
  return jsonb_build_object('id', j.id, 'status', j.status, 'reused', false);
end;
$$;

/** Facebook Content Studio: AI caption / rewrite / promotional image request (worker generates; the user reviews). */
create or replace function public.request_social_ai_job(p_organization_id uuid, p_kind text, p_input jsonb, p_request_key text, p_confirmed_cents integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  j public.ai_jobs%rowtype;
begin
  if not public.can_edit_org(p_organization_id) then raise exception 'Not authorized'; end if;
  if p_kind not in ('social_caption', 'social_rewrite', 'social_image') then raise exception 'Invalid job'; end if;
  select * into j from public.ai_jobs where organization_id = p_organization_id and request_key = p_request_key;
  if found then return jsonb_build_object('id', j.id, 'status', j.status, 'reused', true); end if;
  if not public.animation_flag(case when p_kind = 'social_image' then 'ai_social_images' else 'ai_social_text' end) then raise exception 'AI content is not enabled'; end if;
  if jsonb_typeof(p_input) <> 'object' or (p_input ->> 'language') not in ('en', 'fr', 'ar', 'de') then raise exception 'Invalid request'; end if;
  if nullif(btrim(coalesce(p_input ->> 'prompt', p_input ->> 'text', '')), '') is null then raise exception 'Describe the content'; end if;
  insert into public.ai_jobs(organization_id, requested_by, kind, request_key, input, confirmed_cents)
  values (p_organization_id, auth.uid(), p_kind, p_request_key, p_input, greatest(0, coalesce(p_confirmed_cents, 0)))
  returning * into j;
  return jsonb_build_object('id', j.id, 'status', j.status, 'reused', false);
end;
$$;

create or replace function public.cancel_ai_job(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  j public.ai_jobs%rowtype;
begin
  select * into j from public.ai_jobs where id = p_job_id for update;
  if not found then raise exception 'Job not found'; end if;
  if not public.can_edit_org(j.organization_id) then raise exception 'Not authorized'; end if;
  if j.status <> 'queued' then raise exception 'Only queued jobs can be cancelled'; end if;
  update public.ai_jobs set status = 'cancelled', updated_at = now(), completed_at = now() where id = j.id;
  update public.animation_shots set status = case status when 'keyframe_queued' then 'draft' when 'clip_queued' then 'keyframe_approved' else status end, updated_at = now() where id = j.shot_id;
  return jsonb_build_object('id', j.id, 'status', 'cancelled');
end;
$$;

-- 5. Worker functions (service role) ------------------------------------------------------------------------------
create or replace function public.claim_ai_jobs(p_worker_id text, p_limit integer)
returns setof public.ai_jobs language plpgsql security definer set search_path = '' as $$
begin
  return query
  update public.ai_jobs j set status = 'processing', attempts = j.attempts + 1, locked_by = p_worker_id, locked_at = now(), updated_at = now()
  where j.id in (
    select id from public.ai_jobs
    where status = 'queued' or (status = 'waiting_provider' and poll_after <= now())
    order by created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 1), 10))
  )
  returning j.*;
end;
$$;

create or replace function public.defer_ai_job(p_job_id uuid, p_worker_id text, p_provider text, p_provider_job_id text, p_payload jsonb, p_delay_seconds integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.ai_jobs set status = 'waiting_provider', provider = coalesce(p_provider, provider), provider_job_id = coalesce(p_provider_job_id, provider_job_id),
    provider_payload = provider_payload || coalesce(p_payload, '{}'::jsonb), poll_after = now() + make_interval(secs => greatest(2, least(coalesce(p_delay_seconds, 15), 600))),
    locked_by = null, updated_at = now()
  where id = p_job_id and status = 'processing' and locked_by = p_worker_id;
  if not found then raise exception 'Job is not held by this worker'; end if;
end;
$$;

create or replace function public.complete_ai_job(p_job_id uuid, p_worker_id text, p_provider text, p_output jsonb, p_asset_ids uuid[], p_estimate_cents integer, p_actual_cost_cents integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  j public.ai_jobs%rowtype;
  s public.animation_shots%rowtype;
begin
  select * into j from public.ai_jobs where id = p_job_id for update;
  if not found then raise exception 'Job not found'; end if;
  if j.status = 'completed' then return jsonb_build_object('id', j.id, 'status', 'completed', 'already', true); end if;
  if j.status <> 'processing' or j.locked_by is distinct from p_worker_id then raise exception 'Job is not held by this worker'; end if;
  if exists (select 1 from unnest(coalesce(p_asset_ids, '{}')) a where not exists (select 1 from public.media_assets m where m.id = a and m.organization_id = j.organization_id)) then
    raise exception 'Output files must belong to the workspace';
  end if;
  update public.ai_jobs set status = 'completed', provider = coalesce(p_provider, provider), output = coalesce(p_output, '{}'::jsonb), output_asset_ids = coalesce(p_asset_ids, '{}'),
    estimate_cents = p_estimate_cents, actual_cost_cents = p_actual_cost_cents, completed_at = now(), updated_at = now(), locked_by = null
  where id = j.id returning * into j;
  if j.shot_id is not null then
    select * into s from public.animation_shots where id = j.shot_id for update;
    -- A result for an older revision of the shot is kept in the library but never attached to the edited shot.
    if s.id is not null and s.revision = j.shot_revision then
      if j.kind = 'animation_keyframe' then
        update public.animation_shots set keyframe_asset_id = j.output_asset_ids[1], status = 'keyframe_review', updated_at = now(),
          identity_review = jsonb_set(identity_review, '{keyframe}', jsonb_build_object('automated', coalesce(j.output -> 'identity_check', 'null'::jsonb)))
        where id = s.id returning * into s;
        perform public.animation_log(s, 'keyframe_ready', 'keyframe', null, j.output_asset_ids[1]);
      elsif j.kind = 'animation_clip' then
        update public.animation_shots set clip_asset_id = j.output_asset_ids[1], status = 'clip_review', updated_at = now(),
          identity_review = jsonb_set(identity_review, '{clip}', jsonb_build_object('automated', coalesce(j.output -> 'clip_check', 'null'::jsonb)))
        where id = s.id returning * into s;
        perform public.animation_log(s, 'clip_ready', 'clip', null, j.output_asset_ids[1]);
      elsif j.kind = 'animation_voice' then
        update public.animation_shots set voice_tracks = coalesce(j.output -> 'tracks', '[]'::jsonb), updated_at = now() where id = s.id returning * into s;
        perform public.animation_log(s, 'voice_ready', 'voice', null, null);
      end if;
    end if;
  end if;
  return jsonb_build_object('id', j.id, 'status', 'completed');
end;
$$;

create or replace function public.fail_ai_job(p_job_id uuid, p_worker_id text, p_error_code text, p_detail text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  j public.ai_jobs%rowtype;
  s public.animation_shots%rowtype;
begin
  select * into j from public.ai_jobs where id = p_job_id for update;
  if not found then raise exception 'Job not found'; end if;
  if j.status in ('completed', 'failed', 'cancelled') then return jsonb_build_object('id', j.id, 'status', j.status); end if;
  if p_worker_id is not null and j.locked_by is distinct from p_worker_id and j.status = 'processing' then raise exception 'Job is not held by this worker'; end if;
  update public.ai_jobs set status = 'failed', error_code = left(p_error_code, 120), error_detail = left(p_detail, 500), completed_at = now(), updated_at = now(), locked_by = null
  where id = j.id returning * into j;
  if j.shot_id is not null then
    update public.animation_shots set status = case status when 'keyframe_queued' then 'draft' when 'clip_queued' then 'keyframe_approved' else status end,
      last_error = left(p_error_code, 120), updated_at = now()
    where id = j.shot_id returning * into s;
    if s.id is not null then perform public.animation_log(s, 'failed', replace(j.kind, 'animation_', ''), p_error_code, null); end if;
  end if;
  return jsonb_build_object('id', j.id, 'status', 'failed');
end;
$$;

/** Jobs left 'processing' by a dead worker are failed (never silently re-run: a provider may have billed them). */
create or replace function public.quarantine_stale_ai_jobs(p_limit integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_n integer := 0;
begin
  for v_id in select id from public.ai_jobs where status = 'processing' and locked_at < now() - interval '15 minutes' order by locked_at limit greatest(1, least(coalesce(p_limit, 20), 100)) loop
    perform public.fail_ai_job(v_id, null, 'worker_lost', 'The worker stopped while processing; check the provider usage before retrying');
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- 6. Export through the existing render pipeline (one video credit, ≤ 30 s) ---------------------------------------
create or replace function public.enqueue_animation_render(p_project_id uuid, p_idempotency_key text, p_resolution integer, p_quality text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  p public.animation_projects%rowtype;
  v_job public.render_jobs%rowtype;
  v_size integer[];
  v_scenes jsonb := '[]'::jsonb;
  v_start integer := 0;
  s public.animation_shots%rowtype;
  v_visual jsonb;
  v_layers jsonb;
  v_music jsonb;
  v_total integer;
  v_spec jsonb;
  v_fp text;
  v_dup public.render_jobs%rowtype;
begin
  select * into p from public.animation_projects where id = p_project_id;
  if not found then raise exception 'Animation project not found'; end if;
  if not public.can_edit_org(p.organization_id) then raise exception 'Not authorized'; end if;
  select * into v_job from public.render_jobs where organization_id = p.organization_id and idempotency_key = p_idempotency_key;
  if found then return jsonb_build_object('id', v_job.id, 'status', v_job.status, 'reused', true); end if;
  if p_resolution not in (480, 720, 1080) or p_quality not in ('draft', 'standard', 'high') then raise exception 'Invalid export settings'; end if;
  if not exists (select 1 from public.animation_shots where project_id = p.id) then raise exception 'The storyboard is empty'; end if;
  if exists (select 1 from public.animation_shots where project_id = p.id and (status <> 'approved' or clip_asset_id is null)) then raise exception 'Approve every shot''s clip first'; end if;
  if exists (select 1 from public.animation_shots sh join public.media_assets m on m.id = sh.clip_asset_id
             where sh.project_id = p.id and coalesce((m.provenance ->> 'mock')::boolean, false)) then
    raise exception 'Mock clips cannot be exported as animation';
  end if;
  for s in select * from public.animation_shots where project_id = p.id order by shot_number loop
    v_visual := public.limo_render_media(p.organization_id, s.clip_asset_id, array['video']);
    if v_visual is null then raise exception 'Clip of shot % is missing', s.shot_number; end if;
    select coalesce(jsonb_agg(public.limo_render_media(p.organization_id, (t ->> 'asset_id')::uuid, array['audio'])
                             || jsonb_build_object('offset_ms', greatest(0, coalesce((t ->> 'offset_ms')::integer, 0)), 'volume', 1.0)), '[]'::jsonb)
      into v_layers from jsonb_array_elements(s.voice_tracks) t where public.limo_render_media(p.organization_id, (t ->> 'asset_id')::uuid, array['audio']) is not null;
    v_scenes := v_scenes || jsonb_build_object(
      'scene_number', s.shot_number, 'title', left(s.description, 80), 'duration_ms', s.duration_seconds * 1000, 'start_ms', v_start,
      'on_screen_text', '', 'narration', s.narration,
      'dialogue', coalesce((select string_agg((d ->> 'speaker') || ': ' || (d ->> 'text'), ' ') from jsonb_array_elements(s.dialogue) d), ''),
      'transition', 'cut', 'visual', v_visual, 'audio', null, 'fit', 'cover', 'show_text', false, 'participants', to_jsonb(s.characters),
      'clip_audio', jsonb_build_object('volume', case when s.clip_audio = 'keep' then 1.0 else 0 end), 'audio_layers', v_layers);
    v_start := v_start + s.duration_seconds * 1000;
  end loop;
  v_total := v_start;
  if v_total > public.limo_video_max_duration_ms(p.organization_id) then raise exception 'Videos are limited to % seconds', public.limo_video_max_duration_ms(p.organization_id) / 1000; end if;
  v_size := public.limo_render_size(p.aspect, p_resolution);
  v_music := case when p.music_asset_id is null then null else public.limo_render_media(p.organization_id, p.music_asset_id, array['audio']) || jsonb_build_object('volume', 0.25) end;
  v_spec := jsonb_build_object('version', 1, 'title', p.title, 'language_code', p.language_code, 'width', v_size[1], 'height', v_size[2], 'fps', 24, 'quality', p_quality,
                               'transition_seconds', 0, 'subtitles', 'off', 'text_position', 'bottom', 'text_size', 'medium', 'music', v_music, 'logo', null,
                               'brand', jsonb_build_object('primary', '#6d4aff', 'secondary', '#efecf7'), 'scenes', v_scenes);
  -- Same approved shots + same output settings = the same video: return it instead of charging again (V1 policy).
  v_fp := md5(concat_ws('|', 'animation', p.id::text, p.aspect, p_resolution::text, p_quality, v_spec::text));
  select * into v_dup from public.render_jobs
  where animation_project_id = p.id and render_fingerprint = v_fp
    and (status in ('queued', 'processing') or (status = 'completed' and output_media_asset_id is not null))
  order by created_at desc limit 1;
  if found then return jsonb_build_object('id', v_dup.id, 'status', v_dup.status, 'reused', true, 'duplicate', true, 'charged', false); end if;
  if (select count(*) from public.render_jobs where organization_id = p.organization_id and status in ('queued', 'processing')) >= 3 then
    raise exception 'Too many videos are rendering; wait for one to finish';
  end if;
  begin
    insert into public.render_jobs(organization_id, project_id, animation_project_id, requested_by, idempotency_key, script_revision_id, script_revision_number, aspect, width, height, quality, fps, spec, total_duration_ms, render_fingerprint)
    values (p.organization_id, null, p.id, auth.uid(), p_idempotency_key, null, null, p.aspect, v_size[1], v_size[2], p_quality, 24, v_spec, v_total, v_fp)
    returning * into v_job;
  exception when unique_violation then
    select * into v_job from public.render_jobs where organization_id = p.organization_id and idempotency_key = p_idempotency_key;
    return jsonb_build_object('id', v_job.id, 'status', v_job.status, 'reused', true);
  end;
  perform public.limo_charge_render(v_job.id);
  update public.animation_projects set status = 'ready', updated_at = now() where id = p.id;
  return jsonb_build_object('id', v_job.id, 'status', 'queued', 'reused', false, 'charged', true, 'credits', 1);
end;
$$;

-- 7. Grants -------------------------------------------------------------------------------------------------------
revoke all on function public.animation_flag(text) from public, anon;
revoke all on function public.animation_character_gaps(uuid, text) from public, anon, authenticated;
revoke all on function public.animation_log(public.animation_shots, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.save_animation_project(uuid, uuid, text, text, text, uuid, text, jsonb) from public, anon;
revoke all on function public.save_animation_shots(uuid, jsonb, integer) from public, anon;
revoke all on function public.decide_animation_shot(uuid, text, text, text, boolean) from public, anon;
revoke all on function public.set_animation_shot_frames(uuid, uuid, uuid) from public, anon;
revoke all on function public.animation_readiness(uuid) from public, anon;
revoke all on function public.request_animation_job(uuid, text, text, integer) from public, anon;
revoke all on function public.request_social_ai_job(uuid, text, jsonb, text, integer) from public, anon;
revoke all on function public.cancel_ai_job(uuid) from public, anon;
revoke all on function public.enqueue_animation_render(uuid, text, integer, text) from public, anon;
grant execute on function public.save_animation_project(uuid, uuid, text, text, text, uuid, text, jsonb) to authenticated;
grant execute on function public.save_animation_shots(uuid, jsonb, integer) to authenticated;
grant execute on function public.decide_animation_shot(uuid, text, text, text, boolean) to authenticated;
grant execute on function public.set_animation_shot_frames(uuid, uuid, uuid) to authenticated;
grant execute on function public.animation_readiness(uuid) to authenticated;
grant execute on function public.request_animation_job(uuid, text, text, integer) to authenticated;
grant execute on function public.request_social_ai_job(uuid, text, jsonb, text, integer) to authenticated;
grant execute on function public.cancel_ai_job(uuid) to authenticated;
grant execute on function public.enqueue_animation_render(uuid, text, integer, text) to authenticated;
revoke all on function public.claim_ai_jobs(text, integer) from public, anon, authenticated;
revoke all on function public.defer_ai_job(uuid, text, text, text, jsonb, integer) from public, anon, authenticated;
revoke all on function public.complete_ai_job(uuid, text, text, jsonb, uuid[], integer, integer) from public, anon, authenticated;
revoke all on function public.fail_ai_job(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.quarantine_stale_ai_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_ai_jobs(text, integer) to service_role;
grant execute on function public.defer_ai_job(uuid, text, text, text, jsonb, integer) to service_role;
grant execute on function public.complete_ai_job(uuid, text, text, jsonb, uuid[], integer, integer) to service_role;
grant execute on function public.fail_ai_job(uuid, text, text, text) to service_role;
grant execute on function public.quarantine_stale_ai_jobs(integer) to service_role;
grant execute on function public.animation_character_gaps(uuid, text) to service_role;
