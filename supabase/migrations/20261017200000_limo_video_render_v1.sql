-- LIMO Milestone 7: video assembly, rendering and MP4 export.
-- Status: PENDING OWNER APPROVAL for production. See docs/MIGRATION_REVIEW.md.
-- Depends on 20261017100000 (media_assets metadata, workspace-assets bucket, brand kits),
-- 20261017120000 (project_revisions, script approval) and 20261017160000 (story episodes / checkpoints).
--
-- render_jobs: one MP4 export of one APPROVED script revision. The scene list (order, durations, text,
-- media) is copied from that revision into `spec` when the job is created, in the database, so the
-- worker renders exactly what was approved. Presentation choices (format, quality, transitions, music,
-- subtitles, overlay style, logo, per-scene media) come from video_settings / the request and are
-- validated here (media must be this workspace's files of the right type).
-- Rendering happens in a separate worker (service role) that claims jobs with a lease, reports progress
-- (heartbeat + cancellation), uploads <org>/renders/<job>.mp4 to the private workspace-assets bucket and
-- registers it as a library item. Usage: one video slot per approved script revision, refunded when
-- every render of that revision failed or was cancelled.

-- 1. Tables -------------------------------------------------------------------------------------------
create table if not exists public.video_settings (
  project_id uuid primary key references public.studio_projects(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) < 65536),
  updated_by uuid,
  updated_at timestamptz not null default now()
);

create table if not exists public.render_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.studio_projects(id) on delete cascade,
  requested_by uuid,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 120),
  script_revision_id uuid not null references public.project_revisions(id) on delete restrict,
  script_revision_number integer not null,
  episode_id uuid references public.content_episodes(id) on delete set null,
  checkpoint_fingerprint text,
  aspect text not null check (aspect in ('9:16', '16:9', '1:1', '4:5')),
  width integer not null check (width between 240 and 1920 and width % 2 = 0),
  height integer not null check (height between 240 and 1920 and height % 2 = 0),
  quality text not null check (quality in ('draft', 'standard', 'high')),
  fps integer not null default 30 check (fps in (24, 25, 30)),
  spec jsonb not null check (pg_column_size(spec) < 262144),
  total_duration_ms integer not null check (total_duration_ms between 1000 and 600000),
  notes text[] not null default '{}',
  status text not null default 'queued' check (status in ('queued', 'processing', 'completed', 'failed', 'cancelled')),
  cancel_requested boolean not null default false,
  progress numeric(5, 2) not null default 0 check (progress between 0 and 100),
  stage text,
  attempt_count integer not null default 0,
  max_attempts integer not null default 3 check (max_attempts between 1 and 5),
  available_at timestamptz not null default now(),
  locked_by text,
  locked_at timestamptz,
  heartbeat_at timestamptz,
  error_code text,
  error_detail text,
  output_object_path text,
  output_media_asset_id uuid references public.media_assets(id) on delete set null,
  output_size_bytes bigint,
  output_duration_ms integer,
  output_meta jsonb,
  charged boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  unique (organization_id, idempotency_key)
);
create index if not exists render_jobs_project_idx on public.render_jobs(project_id, created_at desc);
create index if not exists render_jobs_queue_idx on public.render_jobs(status, available_at) where status in ('queued', 'processing');
create index if not exists render_jobs_revision_idx on public.render_jobs(script_revision_id);

alter table public.video_settings enable row level security;
alter table public.render_jobs enable row level security;
drop policy if exists video_settings_read on public.video_settings;
create policy video_settings_read on public.video_settings for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists render_jobs_read on public.render_jobs;
create policy render_jobs_read on public.render_jobs for select to authenticated using (public.is_org_member(organization_id));
revoke all on public.video_settings, public.render_jobs from anon, authenticated;
grant select on public.video_settings, public.render_jobs to authenticated;
grant all on public.video_settings, public.render_jobs to service_role;

-- 2. Helpers ------------------------------------------------------------------------------------------
-- Output size per format and resolution (short side 480 / 720 / 1080). Even numbers for H.264.
create or replace function public.limo_render_size(p_aspect text, p_resolution integer)
returns integer[] language sql immutable set search_path = '' as $$
  select case p_aspect
    when '9:16' then array[p_resolution, case p_resolution when 480 then 854 when 720 then 1280 else 1920 end]
    when '16:9' then array[case p_resolution when 480 then 854 when 720 then 1280 else 1920 end, p_resolution]
    when '1:1' then array[p_resolution, p_resolution]
    else array[p_resolution, case p_resolution when 480 then 600 when 720 then 900 else 1350 end]
  end
$$;

-- A workspace media file usable by the renderer (or null): {asset_id, path, media_type, mime}.
create or replace function public.limo_render_media(p_organization_id uuid, p_asset_id uuid, p_types text[])
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('asset_id', m.id, 'path', m.object_path, 'media_type', m.media_type, 'mime', m.mime_type, 'width', m.width, 'height', m.height, 'duration_ms', m.duration_ms)
  from public.media_assets m
  where m.id = p_asset_id and m.organization_id = p_organization_id and m.bucket_id = 'workspace-assets' and m.media_type = any(p_types)
$$;

-- Moves this job's video-slot charge to another live job of the same approved revision, or refunds it.
create or replace function public.limo_settle_render_charge(p_job_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_job public.render_jobs%rowtype;
  v_other uuid;
begin
  select * into v_job from public.render_jobs where id = p_job_id for update;
  if not found or not v_job.charged then return; end if;
  select id into v_other from public.render_jobs
  where script_revision_id = v_job.script_revision_id and id <> v_job.id and status in ('queued', 'processing', 'completed')
  order by created_at limit 1 for update;
  update public.render_jobs set charged = false where id = v_job.id;
  if v_other is not null then
    update public.render_jobs set charged = true where id = v_other;
    return;
  end if;
  perform 1 from public.usage_balances where organization_id = v_job.organization_id for update;
  update public.usage_balances set used_video_slots = greatest(0, used_video_slots - 1), updated_at = now() where organization_id = v_job.organization_id;
  insert into public.usage_ledger(organization_id, resource, delta, reason, reference_type, reference_id, created_by)
  values (v_job.organization_id, 'video', 1, 'render_refund', 'render_job', v_job.id, null);
end;
$$;

-- Charges one video slot unless another live job of the same approved revision already holds it.
create or replace function public.limo_charge_render(p_job_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_job public.render_jobs%rowtype;
  v_usage public.usage_balances%rowtype;
begin
  select * into v_job from public.render_jobs where id = p_job_id for update;
  if v_job.charged then return true; end if;
  if exists (select 1 from public.render_jobs where script_revision_id = v_job.script_revision_id and id <> v_job.id and charged and status in ('queued', 'processing', 'completed')) then
    return false;
  end if;
  perform 1 from public.organization_subscriptions where organization_id = v_job.organization_id and status = 'active' and renews_at > now();
  if not found then raise exception 'Active subscription required'; end if;
  select * into v_usage from public.usage_balances where organization_id = v_job.organization_id for update;
  if not found or v_usage.cycle_end <= now() then raise exception 'Billing cycle unavailable'; end if;
  if (v_usage.base_video_slots + v_usage.extra_video_slots) - v_usage.used_video_slots < 1 then raise exception 'Video slot limit reached'; end if;
  update public.usage_balances set used_video_slots = used_video_slots + 1, updated_at = now() where organization_id = v_job.organization_id;
  insert into public.usage_ledger(organization_id, resource, delta, reason, reference_type, reference_id, created_by)
  values (v_job.organization_id, 'video', -1, 'render_reserved', 'render_job', v_job.id, auth.uid());
  update public.render_jobs set charged = true where id = p_job_id;
  return true;
end;
$$;

-- 3. Customer functions -------------------------------------------------------------------------------
create or replace function public.save_video_settings(p_project_id uuid, p_settings jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_row public.video_settings%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select organization_id into v_org from public.studio_projects where id = p_project_id;
  if v_org is null then raise exception 'Project not found'; end if;
  if not public.can_edit_org(v_org) then raise exception 'Not authorized'; end if;
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' or pg_column_size(p_settings) >= 65536 then raise exception 'Invalid video settings'; end if;
  insert into public.video_settings(project_id, organization_id, settings, updated_by, updated_at)
  values (p_project_id, v_org, p_settings, auth.uid(), now())
  on conflict (project_id) do update set settings = excluded.settings, updated_by = excluded.updated_by, updated_at = now()
  returning * into v_row;
  return jsonb_build_object('project_id', v_row.project_id, 'updated_at', v_row.updated_at);
end;
$$;

/*
 * Creates (or returns, for the same idempotency key) a render job for the project's APPROVED script
 * revision. p_settings: { transition, transition_seconds, music_asset_id, music_volume, subtitles
 * ('off'|'narration'|'dialogue'), text_position ('top'|'center'|'bottom'), text_size ('small'|'medium'|'large'),
 * logo (bool), scenes: { "<scene_number>": { media_asset_id, fit ('cover'|'contain'), show_text (bool),
 * transition } } }.
 */
create or replace function public.enqueue_render_job(p_project_id uuid, p_idempotency_key text, p_aspect text, p_resolution integer, p_quality text, p_settings jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_p public.studio_projects%rowtype;
  v_rev public.project_revisions%rowtype;
  v_existing public.render_jobs%rowtype;
  v_ep public.content_episodes%rowtype;
  v_size integer[];
  v_settings jsonb := coalesce(p_settings, '{}'::jsonb);
  v_scene jsonb;
  v_scenes jsonb := '[]'::jsonb;
  v_ss jsonb;
  v_visual jsonb;
  v_audio jsonb;
  v_aid text;
  v_total integer := 0;
  v_dur integer;
  v_transition text;
  v_default_transition text;
  v_tsec numeric;
  v_music jsonb;
  v_logo jsonb;
  v_kit_logo uuid;
  v_kit_primary text;
  v_kit_secondary text;
  v_notes text[] := '{}';
  v_has_people boolean := false;
  v_text_cards integer := 0;
  v_job uuid;
  v_charged boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 120 then raise exception 'Invalid idempotency key'; end if;
  select * into v_p from public.studio_projects where id = p_project_id;
  if not found then raise exception 'Project not found'; end if;
  if not public.can_edit_org(v_p.organization_id) then raise exception 'Not authorized'; end if;

  select * into v_existing from public.render_jobs where organization_id = v_p.organization_id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('id', v_existing.id, 'status', v_existing.status, 'existing', true);
  end if;

  if v_p.script_status is distinct from 'approved' or v_p.approved_revision_id is null then
    raise exception 'Approve the script before exporting a video';
  end if;
  select * into v_rev from public.project_revisions where id = v_p.approved_revision_id and project_id = v_p.id;
  if not found then raise exception 'Approved revision not found'; end if;
  if p_aspect not in ('9:16', '16:9', '1:1', '4:5') then raise exception 'Invalid aspect'; end if;
  if p_resolution not in (480, 720, 1080) then raise exception 'Invalid resolution'; end if;
  if p_quality not in ('draft', 'standard', 'high') then raise exception 'Invalid quality'; end if;
  if jsonb_typeof(v_settings) <> 'object' or pg_column_size(v_settings) >= 65536 then raise exception 'Invalid video settings'; end if;

  -- Serialized stories: only an approved, reviewed episode is exported, with its ending checkpoint.
  select * into v_ep from public.content_episodes where project_id = v_p.id;
  if found then
    if v_ep.checkpoint_status is distinct from 'approved' then raise exception 'Approve the episode before exporting a video'; end if;
    if v_ep.review_status is distinct from 'ok' then raise exception 'This episode needs review before exporting a video'; end if;
  end if;

  if (select count(*) from public.render_jobs where organization_id = v_p.organization_id and status in ('queued', 'processing')) >= 3 then
    raise exception 'Too many videos are rendering; wait for one to finish';
  end if;

  v_size := public.limo_render_size(p_aspect, p_resolution);
  v_default_transition := coalesce(nullif(v_settings ->> 'transition', ''), 'fade');
  if v_default_transition not in ('cut', 'fade', 'crossfade', 'slide', 'wipe') then raise exception 'Invalid transition'; end if;
  v_tsec := coalesce((v_settings ->> 'transition_seconds')::numeric, 0.5);
  if v_tsec < 0.2 or v_tsec > 1.5 then raise exception 'Invalid transition length'; end if;

  -- Scenes exactly as approved: order, durations, text. Media must be this workspace's files.
  for v_scene in select s from jsonb_array_elements(v_rev.snapshot -> 'scenes') s order by (s ->> 'scene_number')::integer loop
    v_ss := coalesce(v_settings -> 'scenes' -> (v_scene ->> 'scene_number'), '{}'::jsonb);
    v_dur := round(coalesce((v_scene ->> 'duration_seconds')::numeric, 0) * 1000);
    if v_dur < 1000 then raise exception 'Scene % has no duration', v_scene ->> 'scene_number'; end if;
    v_visual := null;
    if v_ss ? 'media_asset_id' and nullif(v_ss ->> 'media_asset_id', '') is not null then
      v_visual := public.limo_render_media(v_p.organization_id, (v_ss ->> 'media_asset_id')::uuid, array['image', 'video']);
      if v_visual is null then raise exception 'Scene media must be an image or video of this workspace'; end if;
    else
      for v_aid in select jsonb_array_elements_text(coalesce(v_scene -> 'asset_ids', '[]'::jsonb)) loop
        v_visual := public.limo_render_media(v_p.organization_id, v_aid::uuid, array['image', 'video']);
        exit when v_visual is not null;
      end loop;
    end if;
    v_audio := null;
    for v_aid in select jsonb_array_elements_text(coalesce(v_scene -> 'asset_ids', '[]'::jsonb)) loop
      v_audio := public.limo_render_media(v_p.organization_id, v_aid::uuid, array['audio']);
      exit when v_audio is not null;
    end loop;
    v_transition := coalesce(nullif(v_ss ->> 'transition', ''), nullif(lower(v_scene ->> 'transition_out'), ''), v_default_transition);
    if v_transition not in ('cut', 'fade', 'crossfade', 'slide', 'wipe') then v_transition := v_default_transition; end if;
    if v_visual is null then v_text_cards := v_text_cards + 1; end if;
    if jsonb_array_length(coalesce(v_scene -> 'participants', '[]'::jsonb)) > 0 then v_has_people := true; end if;
    v_scenes := v_scenes || jsonb_build_object(
      'scene_number', (v_scene ->> 'scene_number')::integer,
      'title', coalesce(v_scene ->> 'title', ''),
      'duration_ms', v_dur,
      'start_ms', v_total,
      'on_screen_text', coalesce(v_scene ->> 'on_screen_text', ''),
      'narration', coalesce(v_scene ->> 'narration', ''),
      'dialogue', coalesce(v_scene ->> 'dialogue', ''),
      'transition', v_transition,
      'visual', v_visual,
      'audio', v_audio,
      'fit', case when v_ss ->> 'fit' = 'contain' then 'contain' else 'cover' end,
      'show_text', coalesce((v_ss ->> 'show_text')::boolean, true),
      'participants', coalesce(v_scene -> 'participants', '[]'::jsonb)
    );
    v_total := v_total + v_dur;
  end loop;
  if jsonb_array_length(v_scenes) = 0 then raise exception 'The approved script has no scenes'; end if;
  if v_total > 600000 then raise exception 'Videos are limited to 10 minutes'; end if;

  if nullif(v_settings ->> 'music_asset_id', '') is not null then
    v_music := public.limo_render_media(v_p.organization_id, (v_settings ->> 'music_asset_id')::uuid, array['audio']);
    if v_music is null then raise exception 'Background music must be an audio file of this workspace'; end if;
  end if;
  select logo_asset_id, primary_color, secondary_color into v_kit_logo, v_kit_primary, v_kit_secondary from public.brand_kits where organization_id = v_p.organization_id;
  if coalesce((v_settings ->> 'logo')::boolean, false) then
    if v_kit_logo is null then raise exception 'Add a logo to the brand kit first'; end if;
    v_logo := public.limo_render_media(v_p.organization_id, v_kit_logo, array['image']);
  end if;

  if v_has_people then v_notes := array_append(v_notes, 'characters_not_animated'); end if;
  if v_text_cards > 0 then v_notes := array_append(v_notes, 'text_card_scenes'); end if;

  insert into public.render_jobs(organization_id, project_id, requested_by, idempotency_key, script_revision_id, script_revision_number,
    episode_id, checkpoint_fingerprint, aspect, width, height, quality, spec, total_duration_ms, notes)
  values (v_p.organization_id, v_p.id, auth.uid(), p_idempotency_key, v_rev.id, v_rev.revision_number,
    v_ep.id, v_ep.checkpoint_fingerprint, p_aspect, v_size[1], v_size[2], p_quality,
    jsonb_build_object(
      'version', 1,
      'title', v_p.title,
      'language_code', v_p.language_code,
      'width', v_size[1], 'height', v_size[2], 'fps', 30, 'quality', p_quality,
      'transition_seconds', v_tsec,
      'subtitles', case when v_settings ->> 'subtitles' in ('narration', 'dialogue') then v_settings ->> 'subtitles' else 'off' end,
      'text_position', case when v_settings ->> 'text_position' in ('top', 'center') then v_settings ->> 'text_position' else 'bottom' end,
      'text_size', case when v_settings ->> 'text_size' in ('small', 'large') then v_settings ->> 'text_size' else 'medium' end,
      'music', case when v_music is null then null else v_music || jsonb_build_object('volume', least(1, greatest(0, coalesce((v_settings ->> 'music_volume')::numeric, 0.3)))) end,
      'logo', v_logo,
      'brand', jsonb_build_object('primary', coalesce(v_kit_primary, '#7157ef'), 'secondary', coalesce(v_kit_secondary, '#211e2b')),
      'scenes', v_scenes
    ),
    v_total, v_notes)
  returning id into v_job;

  v_charged := public.limo_charge_render(v_job);
  return jsonb_build_object('id', v_job, 'status', 'queued', 'existing', false, 'charged', v_charged);
exception when unique_violation then
  select * into v_existing from public.render_jobs where organization_id = v_p.organization_id and idempotency_key = p_idempotency_key;
  if found then return jsonb_build_object('id', v_existing.id, 'status', v_existing.status, 'existing', true); end if;
  raise;
end;
$$;

create or replace function public.cancel_render_job(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_job public.render_jobs%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_job from public.render_jobs where id = p_job_id for update;
  if not found or not public.is_org_member(v_job.organization_id) then raise exception 'Render not found'; end if;
  if not public.can_edit_org(v_job.organization_id) then raise exception 'Not authorized'; end if;
  if v_job.status = 'queued' then
    update public.render_jobs set status = 'cancelled', stage = null, updated_at = now() where id = p_job_id;
    perform public.limo_settle_render_charge(p_job_id);
    return jsonb_build_object('id', p_job_id, 'status', 'cancelled');
  elsif v_job.status = 'processing' then
    update public.render_jobs set cancel_requested = true, updated_at = now() where id = p_job_id;
    return jsonb_build_object('id', p_job_id, 'status', 'processing', 'cancel_requested', true);
  end if;
  raise exception 'This render has already finished';
end;
$$;

-- Recovers a failed or cancelled render: same job, same approved spec, same output path (idempotent).
create or replace function public.retry_render_job(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_job public.render_jobs%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_job from public.render_jobs where id = p_job_id for update;
  if not found or not public.is_org_member(v_job.organization_id) then raise exception 'Render not found'; end if;
  if not public.can_edit_org(v_job.organization_id) then raise exception 'Not authorized'; end if;
  if v_job.status not in ('failed', 'cancelled') then raise exception 'Only failed or cancelled renders can be retried'; end if;
  -- A retry renders the same frozen spec, so that revision must still be the approved one.
  if (select approved_revision_id from public.studio_projects where id = v_job.project_id and script_status = 'approved') is distinct from v_job.script_revision_id then
    raise exception 'The script approval changed; start a new export';
  end if;
  if (select count(*) from public.render_jobs where organization_id = v_job.organization_id and status in ('queued', 'processing')) >= 3 then
    raise exception 'Too many videos are rendering; wait for one to finish';
  end if;
  update public.render_jobs
  set status = 'queued', cancel_requested = false, progress = 0, stage = null, attempt_count = 0, available_at = now(),
      locked_by = null, locked_at = null, heartbeat_at = null, error_code = null, error_detail = null, updated_at = now()
  where id = p_job_id;
  perform public.limo_charge_render(p_job_id);
  return jsonb_build_object('id', p_job_id, 'status', 'queued');
end;
$$;

-- 4. Worker functions (service role only) -------------------------------------------------------------
-- Claims the oldest available job. A processing job whose heartbeat is older than the lease is taken
-- over (the previous worker died); jobs that used all attempts are failed and their charge settled.
create or replace function public.claim_render_job(p_worker_id text, p_lease_seconds integer default 120)
returns setof public.render_jobs language plpgsql security definer set search_path = '' as $$
declare
  v_dead uuid;
begin
  if p_worker_id is null or btrim(p_worker_id) = '' then raise exception 'Worker id required'; end if;
  for v_dead in
    select id from public.render_jobs
    where status = 'processing' and heartbeat_at < now() - make_interval(secs => p_lease_seconds) and attempt_count >= max_attempts
    for update skip locked
  loop
    update public.render_jobs set status = 'failed', error_code = 'worker_lost', stage = null, updated_at = now() where id = v_dead;
    perform public.limo_settle_render_charge(v_dead);
  end loop;
  return query
  with picked as (
    select id from public.render_jobs
    where (status = 'queued' and available_at <= now())
       or (status = 'processing' and heartbeat_at < now() - make_interval(secs => p_lease_seconds) and attempt_count < max_attempts)
    order by available_at, created_at
    for update skip locked
    limit 1
  )
  update public.render_jobs j
  set status = 'processing', locked_by = left(p_worker_id, 120), locked_at = now(), heartbeat_at = now(),
      attempt_count = j.attempt_count + 1, started_at = coalesce(j.started_at, now()), progress = 0, stage = 'preparing',
      error_code = null, error_detail = null, updated_at = now()
  from picked where j.id = picked.id
  returning j.*;
end;
$$;

-- Heartbeat + progress. Returns 'continue', 'cancel' (the user asked to stop) or 'lost' (lease taken over).
create or replace function public.report_render_progress(p_job_id uuid, p_worker_id text, p_progress numeric, p_stage text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_job public.render_jobs%rowtype;
begin
  select * into v_job from public.render_jobs where id = p_job_id for update;
  if not found or v_job.status <> 'processing' or v_job.locked_by is distinct from p_worker_id then return 'lost'; end if;
  update public.render_jobs set progress = least(99.99, greatest(0, coalesce(p_progress, 0))), stage = left(p_stage, 40), heartbeat_at = now(), updated_at = now()
  where id = p_job_id;
  return case when v_job.cancel_requested then 'cancel' else 'continue' end;
end;
$$;

create or replace function public.complete_render_job(p_job_id uuid, p_worker_id text, p_object_path text, p_size_bytes bigint, p_duration_ms integer, p_meta jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_job public.render_jobs%rowtype;
  v_asset uuid;
  v_title text;
begin
  select * into v_job from public.render_jobs where id = p_job_id for update;
  if not found then raise exception 'Render not found'; end if;
  if v_job.status = 'completed' and v_job.output_object_path = p_object_path then
    return jsonb_build_object('id', v_job.id, 'status', 'completed', 'media_asset_id', v_job.output_media_asset_id);
  end if;
  if v_job.status <> 'processing' or v_job.locked_by is distinct from p_worker_id then raise exception 'Render is not held by this worker'; end if;
  if p_object_path <> v_job.organization_id::text || '/renders/' || v_job.id::text || '.mp4' then raise exception 'Invalid render path'; end if;
  if not exists (select 1 from storage.objects where bucket_id = 'workspace-assets' and name = p_object_path) then raise exception 'Uploaded render not found'; end if;
  if p_size_bytes is null or p_size_bytes < 1 or p_size_bytes > 104857600 then raise exception 'Invalid render size'; end if;
  if p_duration_ms is null or abs(p_duration_ms - v_job.total_duration_ms) > 1500 then raise exception 'Render duration does not match the approved timeline'; end if;
  select title into v_title from public.studio_projects where id = v_job.project_id;
  insert into public.media_assets(organization_id, content_project_id, episode_id, bucket_id, object_path, media_type, source, kind, file_name, mime_type, size_bytes, width, height, duration_ms, label, created_by)
  values (v_job.organization_id, null, v_job.episode_id, 'workspace-assets', p_object_path, 'video', 'generated', 'render',
          left(coalesce(v_title, 'video'), 150) || '-' || replace(v_job.aspect, ':', 'x') || '.mp4', 'video/mp4', p_size_bytes, v_job.width, v_job.height, p_duration_ms,
          left(coalesce(v_title, 'Video'), 100) || ' · ' || v_job.aspect, v_job.requested_by)
  returning id into v_asset;
  update public.render_jobs
  set status = 'completed', progress = 100, stage = 'done', output_object_path = p_object_path, output_media_asset_id = v_asset,
      output_size_bytes = p_size_bytes, output_duration_ms = p_duration_ms, output_meta = coalesce(p_meta, '{}'::jsonb),
      completed_at = now(), heartbeat_at = now(), updated_at = now()
  where id = p_job_id;
  return jsonb_build_object('id', v_job.id, 'status', 'completed', 'media_asset_id', v_asset);
end;
$$;

-- Retryable failures go back to the queue with a growing delay until max_attempts; then the job fails.
create or replace function public.fail_render_job(p_job_id uuid, p_worker_id text, p_error_code text, p_detail text, p_retryable boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_job public.render_jobs%rowtype;
begin
  select * into v_job from public.render_jobs where id = p_job_id for update;
  if not found or v_job.status <> 'processing' or v_job.locked_by is distinct from p_worker_id then return 'lost'; end if;
  if p_error_code = 'cancelled' then
    update public.render_jobs set status = 'cancelled', stage = null, error_code = null, locked_by = null, updated_at = now() where id = p_job_id;
    perform public.limo_settle_render_charge(p_job_id);
    return 'cancelled';
  end if;
  if p_retryable and v_job.attempt_count < v_job.max_attempts then
    update public.render_jobs
    set status = 'queued', available_at = now() + make_interval(secs => 15 * v_job.attempt_count), locked_by = null, stage = null,
        error_code = left(p_error_code, 80), error_detail = left(p_detail, 500), updated_at = now()
    where id = p_job_id;
    return 'retry';
  end if;
  update public.render_jobs set status = 'failed', stage = null, locked_by = null, error_code = left(p_error_code, 80), error_detail = left(p_detail, 500), updated_at = now()
  where id = p_job_id;
  perform public.limo_settle_render_charge(p_job_id);
  return 'failed';
end;
$$;

revoke all on function public.limo_render_size(text, integer) from public, anon;
revoke all on function public.limo_render_media(uuid, uuid, text[]) from public, anon, authenticated;
revoke all on function public.limo_settle_render_charge(uuid) from public, anon, authenticated;
revoke all on function public.limo_charge_render(uuid) from public, anon, authenticated;
revoke all on function public.save_video_settings(uuid, jsonb) from public, anon;
revoke all on function public.enqueue_render_job(uuid, text, text, integer, text, jsonb) from public, anon;
revoke all on function public.cancel_render_job(uuid) from public, anon;
revoke all on function public.retry_render_job(uuid) from public, anon;
revoke all on function public.claim_render_job(text, integer) from public, anon, authenticated;
revoke all on function public.report_render_progress(uuid, text, numeric, text) from public, anon, authenticated;
revoke all on function public.complete_render_job(uuid, text, text, bigint, integer, jsonb) from public, anon, authenticated;
revoke all on function public.fail_render_job(uuid, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.save_video_settings(uuid, jsonb) to authenticated;
grant execute on function public.enqueue_render_job(uuid, text, text, integer, text, jsonb) to authenticated;
grant execute on function public.cancel_render_job(uuid) to authenticated;
grant execute on function public.retry_render_job(uuid) to authenticated;
grant execute on function public.limo_render_size(text, integer) to authenticated, service_role;
grant execute on function public.claim_render_job(text, integer) to service_role;
grant execute on function public.report_render_progress(uuid, text, numeric, text) to service_role;
grant execute on function public.complete_render_job(uuid, text, text, bigint, integer, jsonb) to service_role;
grant execute on function public.fail_render_job(uuid, text, text, text, boolean) to service_role;
