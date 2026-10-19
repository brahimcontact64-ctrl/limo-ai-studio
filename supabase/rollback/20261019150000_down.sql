-- Rollback of 20261019150000_limo_animation_media_overlays_v1 (owner media, overlays, freeze frames, transitions).
-- Restores the 20261019090000 versions of save_animation_shots and enqueue_animation_render, drops the new function and
-- columns. Shots that used owner media lose it (they go back to draft); the files stay in the library.
update public.animation_shots set clip_asset_id = null, status = 'draft' where media_source = 'owner';
drop function if exists public.set_animation_shot_media(uuid, uuid);
delete from public.animation_shot_events where event = 'media_set';
alter table public.animation_shot_events drop constraint if exists animation_shot_events_event_check;
alter table public.animation_shot_events add constraint animation_shot_events_event_check
  check (event in ('created', 'edited', 'job_requested', 'keyframe_ready', 'clip_ready', 'voice_ready', 'approved', 'rejected', 'failed', 'frames_set'));
alter table public.animation_shots drop constraint if exists animation_shots_post_check;
alter table public.animation_shots drop column if exists overlays;
alter table public.animation_shots drop column if exists freeze_ms;
alter table public.animation_shots drop column if exists transition_out;
alter table public.animation_shots drop column if exists media_source;
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
