-- LIMO Animation Studio — owner media, timed overlays, freeze frames, transitions (v1).
-- Status: PENDING OWNER APPROVAL for production (15th pending migration). Additive; does not edit earlier files.
-- Depends on 20261019090000 (animation tables and functions; this file replaces two of its functions).
--
--   * A shot can use the owner's own media (screen recording, product capture, logo, photo) from the private workspace
--     library instead of an AI clip: set_animation_shot_media. Same workspace only, image or video, never a mock file;
--     the shot goes to review and is approved by a person like any clip (no automatic approval).
--   * Post-production per shot, applied by the existing FFmpeg render worker: up to 5 timed text overlays (Arabic and
--     Latin, positions top/center/bottom, styles plain/price/tagline), a freeze frame at the end (≤ half the shot) and a
--     transition into the next shot (cut/fade/crossfade/slide/wipe). Changing them never resets an approved clip.
--   * Exports: images and videos as shot media; overlays/freeze/transitions in the render spec; same credit rules
--     (one credit, identical re-export free, failed render refunded).

alter table public.animation_shots add column if not exists overlays jsonb not null default '[]'::jsonb;
alter table public.animation_shots add column if not exists freeze_ms integer not null default 0;
alter table public.animation_shots add column if not exists transition_out text not null default 'cut';
alter table public.animation_shots add column if not exists media_source text not null default 'ai';
alter table public.animation_shots drop constraint if exists animation_shots_post_check;
alter table public.animation_shots add constraint animation_shots_post_check check (
  jsonb_typeof(overlays) = 'array' and jsonb_array_length(overlays) <= 5 and pg_column_size(overlays) < 8192
  and freeze_ms between 0 and 4000 and transition_out in ('cut', 'fade', 'crossfade', 'slide', 'wipe') and media_source in ('ai', 'owner'));
alter table public.animation_shot_events drop constraint if exists animation_shot_events_event_check;
alter table public.animation_shot_events add constraint animation_shot_events_event_check
  check (event in ('created', 'edited', 'job_requested', 'keyframe_ready', 'clip_ready', 'voice_ready', 'approved', 'rejected', 'failed', 'frames_set', 'media_set'));

/** Uses (or removes, with null) the owner's own image/video as the shot's media; the shot then waits for review. */
create or replace function public.set_animation_shot_media(p_shot_id uuid, p_asset_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.animation_shots%rowtype;
  m public.media_assets%rowtype;
begin
  select * into s from public.animation_shots where id = p_shot_id for update;
  if not found then raise exception 'Shot not found'; end if;
  if not public.can_edit_org(s.organization_id) then raise exception 'Not authorized'; end if;
  if s.status in ('keyframe_queued', 'clip_queued') then raise exception 'Shot % is being generated', s.shot_number; end if;
  if p_asset_id is null then
    if s.media_source <> 'owner' then raise exception 'This shot does not use your own media'; end if;
    update public.animation_shots set clip_asset_id = null, media_source = 'ai', status = 'draft', updated_at = now() where id = s.id returning * into s;
    perform public.animation_log(s, 'media_set', 'clip', 'own media removed', null);
    return jsonb_build_object('id', s.id, 'status', s.status);
  end if;
  select * into m from public.media_assets where id = p_asset_id;
  if not found or m.organization_id <> s.organization_id then raise exception 'Media must be a file of this workspace'; end if;
  if m.media_type not in ('image', 'video') then raise exception 'Media must be an image or a video'; end if;
  if m.bucket_id <> 'workspace-assets' then raise exception 'Media must be a file of this workspace'; end if;
  if coalesce((m.provenance ->> 'mock')::boolean, false) then raise exception 'Mock files cannot be used as shot media'; end if;
  if m.size_bytes is not null and m.size_bytes > 104857600 then raise exception 'Media is larger than 100 MB'; end if;
  update public.animation_shots set clip_asset_id = m.id, media_source = 'owner', status = 'clip_review', last_error = null,
    identity_review = jsonb_set(identity_review, '{clip}', jsonb_build_object('automated', jsonb_build_object(
      'kind', 'clip', 'verdict', 'needs_human_review', 'animated', m.media_type = 'video',
      'disclaimer', 'Your own media: check that it is genuine, current and allowed to be used.',
      'checks', jsonb_build_array(jsonb_build_object('code', 'owner_media', 'status', 'pass', 'detail', m.media_type || ' from your library'))))),
    updated_at = now()
  where id = s.id returning * into s;
  perform public.animation_log(s, 'media_set', 'clip', left(coalesce(m.file_name, m.label, 'own media'), 200), m.id);
  return jsonb_build_object('id', s.id, 'status', s.status);
end;
$$;

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
  v_ov jsonb;
  v_dur integer;
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
    -- Post-production: timed text overlays (≤ 5), freeze frame (≤ half the shot), transition into the next shot.
    v_dur := (s ->> 'duration_seconds')::integer * 1000;
    if jsonb_typeof(coalesce(s -> 'overlays', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(s -> 'overlays', '[]'::jsonb)) > 5 then raise exception 'At most 5 text overlays per shot'; end if;
    for v_ov in select * from jsonb_array_elements(coalesce(s -> 'overlays', '[]'::jsonb)) loop
      if char_length(btrim(coalesce(v_ov ->> 'text', ''))) not between 1 and 120 then raise exception 'Overlay text must be 1 to 120 characters'; end if;
      if coalesce((v_ov ->> 'start_ms')::integer, -1) < 0 or coalesce((v_ov ->> 'end_ms')::integer, 0) <= (v_ov ->> 'start_ms')::integer or (v_ov ->> 'end_ms')::integer > v_dur then
        raise exception 'Overlay times must be inside the shot';
      end if;
      if coalesce(v_ov ->> 'position', 'bottom') not in ('top', 'center', 'bottom') or coalesce(v_ov ->> 'size', 'medium') not in ('small', 'medium', 'large')
         or coalesce(v_ov ->> 'style', 'plain') not in ('plain', 'price', 'tagline') then raise exception 'Invalid overlay style'; end if;
    end loop;
    if coalesce((s ->> 'freeze_ms')::integer, 0) < 0 or coalesce((s ->> 'freeze_ms')::integer, 0) > v_dur / 2 then raise exception 'A freeze frame lasts at most half the shot'; end if;
    if coalesce(s ->> 'transition_out', 'cut') not in ('cut', 'fade', 'crossfade', 'slide', 'wipe') then raise exception 'Invalid transition'; end if;
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
                                         dialogue, narration, sound, continuity, reference_asset_ids, clip_audio, overlays, freeze_ms, transition_out)
      values (p.id, p.organization_id, v_n, (s ->> 'duration_seconds')::integer, coalesce(s ->> 'description', ''), coalesce(s ->> 'environment', ''), coalesce(s ->> 'camera', ''),
              v_chars, coalesce(s -> 'actions', '{}'::jsonb), coalesce(s -> 'expressions', '{}'::jsonb), coalesce(s -> 'dialogue', '[]'::jsonb), coalesce(s ->> 'narration', ''),
              coalesce(s ->> 'sound', ''), coalesce(s -> 'continuity', '{}'::jsonb), v_refs, coalesce(nullif(s ->> 'clip_audio', ''), 'keep'),
              coalesce(s -> 'overlays', '[]'::jsonb), coalesce((s ->> 'freeze_ms')::integer, 0), coalesce(nullif(s ->> 'transition_out', ''), 'cut'))
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
        overlays = coalesce(s -> 'overlays', '[]'::jsonb), freeze_ms = coalesce((s ->> 'freeze_ms')::integer, 0),
        transition_out = coalesce(nullif(s ->> 'transition_out', ''), 'cut'),
        media_source = case when v_changed then 'ai' else media_source end,
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
    v_visual := public.limo_render_media(p.organization_id, s.clip_asset_id, array['video', 'image']);
    if v_visual is null then raise exception 'Clip of shot % is missing', s.shot_number; end if;
    select coalesce(jsonb_agg(public.limo_render_media(p.organization_id, (t ->> 'asset_id')::uuid, array['audio'])
                             || jsonb_build_object('offset_ms', greatest(0, coalesce((t ->> 'offset_ms')::integer, 0)), 'volume', 1.0)), '[]'::jsonb)
      into v_layers from jsonb_array_elements(s.voice_tracks) t where public.limo_render_media(p.organization_id, (t ->> 'asset_id')::uuid, array['audio']) is not null;
    v_scenes := v_scenes || jsonb_build_object(
      'scene_number', s.shot_number, 'title', left(s.description, 80), 'duration_ms', s.duration_seconds * 1000, 'start_ms', v_start,
      'on_screen_text', '', 'narration', s.narration,
      'dialogue', coalesce((select string_agg((d ->> 'speaker') || ': ' || (d ->> 'text'), ' ') from jsonb_array_elements(s.dialogue) d), ''),
      'transition', s.transition_out, 'visual', v_visual, 'audio', null, 'fit', 'cover', 'show_text', false, 'participants', to_jsonb(s.characters),
      'clip_audio', jsonb_build_object('volume', case when s.clip_audio = 'keep' then 1.0 else 0 end), 'audio_layers', v_layers,
      'overlays', s.overlays, 'freeze_ms', s.freeze_ms);
    v_start := v_start + s.duration_seconds * 1000;
  end loop;
  v_total := v_start;
  if v_total > public.limo_video_max_duration_ms(p.organization_id) then raise exception 'Videos are limited to % seconds', public.limo_video_max_duration_ms(p.organization_id) / 1000; end if;
  v_size := public.limo_render_size(p.aspect, p_resolution);
  v_music := case when p.music_asset_id is null then null else public.limo_render_media(p.organization_id, p.music_asset_id, array['audio']) || jsonb_build_object('volume', 0.25) end;
  v_spec := jsonb_build_object('version', 1, 'title', p.title, 'language_code', p.language_code, 'width', v_size[1], 'height', v_size[2], 'fps', 24, 'quality', p_quality,
                               'transition_seconds', case when exists (select 1 from public.animation_shots x where x.project_id = p.id and x.transition_out <> 'cut') then 0.5 else 0 end, 'subtitles', 'off', 'text_position', 'bottom', 'text_size', 'medium', 'music', v_music, 'logo', null,
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

revoke all on function public.set_animation_shot_media(uuid, uuid) from public, anon;
grant execute on function public.set_animation_shot_media(uuid, uuid) to authenticated;
