-- Rollback of 20261018090000_limo_video_policy_v1 (V1 video duration and credit policy).
-- Restores the Milestone 7 render charging (one slot per approved revision, 10-minute limit) and the
-- production generation functions. Render jobs keep their rows; the credit columns are dropped (the
-- `charged` flag the old functions use is kept in sync by the policy functions). Ledger rows stay.
drop trigger if exists trg_render_job_duration on public.render_jobs;
drop trigger if exists trg_script_approval_duration on public.studio_projects;
drop function if exists public.limo_guard_render_job_duration();
drop function if exists public.limo_guard_script_approval_duration();
drop function if exists public.limo_consume_render_charge(uuid);

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

CREATE OR REPLACE FUNCTION "public"."normalize_studio_project_slots"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  new.estimated_slots := greatest(1,ceil(new.total_duration_seconds::numeric/30)::integer);
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."request_studio_generation"("p_project_id" "uuid", "p_request_key" "text", "p_policy_code" "text" DEFAULT 'standard_v1'::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_project public.studio_projects%rowtype;
  v_policy public.generation_cost_policies%rowtype;
  v_existing uuid;
  v_run_id uuid;
  v_job_id uuid;
  v_reservation_id uuid;
  v_slots integer;
  v_voice_minutes integer;
  v_scene_count integer;
  v_base_cost bigint;
  v_estimated_cost integer;
  v_scene record;
  v_export record;
  v_has_dialogue boolean;
  v_order integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_project_id is null then raise exception 'Project required'; end if;
  if p_request_key is null or btrim(p_request_key)='' or char_length(p_request_key)>160 then
    raise exception 'Invalid request key';
  end if;

  select * into v_project
  from public.studio_projects
  where id=p_project_id
  for update;

  if not found then raise exception 'Project not found'; end if;
  if not public.can_edit_org(v_project.organization_id) then raise exception 'Not authorized'; end if;

  select id into v_existing
  from public.generation_runs
  where organization_id=v_project.organization_id and request_key=p_request_key;
  if found then return v_existing; end if;

  perform 1 from public.organization_subscriptions
  where organization_id=v_project.organization_id
    and status='active' and renews_at>now();
  if not found then raise exception 'Active subscription required'; end if;

  if v_project.status not in ('draft','ready') then
    raise exception 'Project is not ready for a new generation request';
  end if;

  select count(*) into v_scene_count
  from public.project_scenes where project_id=p_project_id;
  if v_scene_count<1 then raise exception 'Project has no scenes'; end if;

  v_slots:=greatest(1,ceil(v_project.total_duration_seconds::numeric/30)::integer);
  if v_slots>100 then raise exception 'Project exceeds generation slot limit'; end if;

  select * into v_policy
  from public.generation_cost_policies
  where code=p_policy_code;
  if not found then raise exception 'Generation cost policy not found'; end if;
  if not v_policy.enabled or v_policy.verified_at is null then
    raise exception 'Generation providers are not enabled yet';
  end if;

  v_voice_minutes:=greatest(1,ceil(v_project.total_duration_seconds::numeric/60)::integer);
  v_base_cost :=
      v_policy.script_flat_cents::bigint
    + (v_voice_minutes::bigint*v_policy.voice_per_minute_cents::bigint)
    + (v_scene_count::bigint*v_policy.image_per_scene_cents::bigint)
    + (v_project.total_duration_seconds::bigint*v_policy.video_per_second_cents::bigint)
    + v_policy.render_flat_cents::bigint;

  if v_base_cost<=0 then raise exception 'Generation cost policy is invalid'; end if;

  v_estimated_cost:=ceil(
    (v_base_cost::numeric*(100+v_policy.retry_buffer_percent)::numeric)/100
  )::integer;
  if v_estimated_cost<=0 then raise exception 'Invalid generation estimate'; end if;

  v_reservation_id:=public.reserve_ai_budget(
    v_project.organization_id,'gen:'||p_request_key,v_estimated_cost
  );

  v_job_id:=public.enqueue_content_job(
    v_project.organization_id,'gen:'||p_request_key,'video',v_slots,
    'studio_video_generation',
    jsonb_build_object(
      'project_id',v_project.id,
      'language_code',v_project.language_code,
      'total_duration_seconds',v_project.total_duration_seconds,
      'slots_reserved',v_slots,
      'continuation_mode',v_project.continuation_mode,
      'series_id',v_project.series_id,
      'scene_count',v_scene_count
    )
  );

  insert into public.generation_runs(
    organization_id,project_id,requested_by,request_key,status,cost_policy_code,
    slots_reserved,estimated_cost_cents,ai_reservation_id,root_job_id
  )
  values(
    v_project.organization_id,v_project.id,auth.uid(),p_request_key,'awaiting_safety',
    v_policy.code,v_slots,v_estimated_cost,v_reservation_id,v_job_id
  )
  returning id into v_run_id;

  update public.content_jobs
  set payload=payload||jsonb_build_object('generation_run_id',v_run_id)
  where id=v_job_id;

  insert into public.generation_run_stages(
    run_id,organization_id,stage_key,stage_type,sort_order,status,estimated_cost_cents
  ) values(v_run_id,v_project.organization_id,'safety','safety',0,'ready',0);

  insert into public.generation_run_stages(
    run_id,organization_id,stage_key,stage_type,sort_order,status,estimated_cost_cents
  ) values(
    v_run_id,v_project.organization_id,'script','script',10,'pending',
    v_policy.script_flat_cents
  );

  select exists(
    select 1 from public.project_scenes
    where project_id=p_project_id
      and nullif(btrim(coalesce(dialogue,'')),'') is not null
  ) into v_has_dialogue;

  insert into public.generation_run_stages(
    run_id,organization_id,stage_key,stage_type,sort_order,status,estimated_cost_cents
  ) values(
    v_run_id,v_project.organization_id,'voice','voice',20,
    case when v_has_dialogue then 'pending' else 'skipped' end,
    case when v_has_dialogue then v_voice_minutes*v_policy.voice_per_minute_cents else 0 end
  );

  for v_scene in
    select scene_number,duration_seconds
    from public.project_scenes
    where project_id=p_project_id
    order by scene_number
  loop
    insert into public.generation_run_stages(
      run_id,organization_id,stage_key,stage_type,sort_order,status,
      scene_number,estimated_cost_cents
    ) values(
      v_run_id,v_project.organization_id,
      'scene-image:'||v_scene.scene_number::text,
      'scene_image',50+v_scene.scene_number,'pending',
      v_scene.scene_number,v_policy.image_per_scene_cents
    );

    insert into public.generation_run_stages(
      run_id,organization_id,stage_key,stage_type,sort_order,status,
      scene_number,estimated_cost_cents
    ) values(
      v_run_id,v_project.organization_id,
      'scene-video:'||v_scene.scene_number::text,
      'scene_video',100+v_scene.scene_number,'pending',
      v_scene.scene_number,v_scene.duration_seconds*v_policy.video_per_second_cents
    );
  end loop;

  insert into public.generation_run_stages(
    run_id,organization_id,stage_key,stage_type,sort_order,status,estimated_cost_cents
  ) values(
    v_run_id,v_project.organization_id,'render','render',500,'pending',
    v_policy.render_flat_cents
  );

  v_order:=0;
  for v_export in
    select preset_code from public.project_export_choices
    where project_id=p_project_id order by preset_code
  loop
    v_order:=v_order+1;
    insert into public.generation_run_stages(
      run_id,organization_id,stage_key,stage_type,sort_order,status,
      preset_code,estimated_cost_cents
    ) values(
      v_run_id,v_project.organization_id,
      'export:'||v_export.preset_code,'export',600+v_order,'pending',
      v_export.preset_code,0
    );
  end loop;

  update public.studio_projects
  set status='queued',last_generation_run_id=v_run_id,
      estimated_slots=v_slots,updated_at=now()
  where id=p_project_id;

  return v_run_id;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."fail_content_job"("p_job_id" "uuid", "p_error_code" "text", "p_provider_cost_cents" integer DEFAULT 0, "p_refund_usage" boolean DEFAULT false) RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_job public.content_jobs%rowtype;
begin
  if p_provider_cost_cents < 0 then raise exception 'Invalid provider cost'; end if;

  select * into v_job from public.content_jobs where id=p_job_id for update;
  if not found then raise exception 'Job not found'; end if;
  if v_job.status not in ('queued','processing') then raise exception 'Job already settled'; end if;
  if p_refund_usage and p_provider_cost_cents > 0 then raise exception 'Cannot refund usage after provider cost'; end if;

  update public.content_jobs
  set status='failed',
      error_code=left(coalesce(p_error_code,'provider_failure'),120),
      provider_cost_cents=p_provider_cost_cents,
      updated_at=now()
  where id=p_job_id;

  if p_refund_usage then
    perform 1 from public.usage_balances where organization_id=v_job.organization_id for update;
    if v_job.resource='video' then
      update public.usage_balances
      set used_video_slots=greatest(0,used_video_slots-v_job.units),updated_at=now()
      where organization_id=v_job.organization_id;
    elsif v_job.resource='post' then
      update public.usage_balances
      set used_posts=greatest(0,used_posts-v_job.units),updated_at=now()
      where organization_id=v_job.organization_id;
    else
      update public.usage_balances
      set used_images=greatest(0,used_images-v_job.units),updated_at=now()
      where organization_id=v_job.organization_id;
    end if;

    insert into public.usage_ledger(organization_id,resource,delta,reason,reference_type,reference_id,created_by)
    values(v_job.organization_id,v_job.resource,v_job.units,'job_refund','content_job',v_job.id,null);
  end if;

  return 'failed';
end;
$$;

CREATE OR REPLACE FUNCTION "public"."refund_generation_usage_once"("p_job_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_job public.content_jobs%rowtype;
begin
  select * into v_job
  from public.content_jobs
  where id=p_job_id
  for update;

  if not found then raise exception 'Job not found'; end if;

  if exists(
    select 1 from public.usage_ledger
    where organization_id=v_job.organization_id
      and reference_type='content_job'
      and reference_id=v_job.id
      and reason='generation_refund'
  ) then
    return false;
  end if;

  perform 1
  from public.usage_balances
  where organization_id=v_job.organization_id
  for update;

  if v_job.resource='video' then
    update public.usage_balances
    set used_video_slots=greatest(0,used_video_slots-v_job.units),updated_at=now()
    where organization_id=v_job.organization_id;
  elsif v_job.resource='post' then
    update public.usage_balances
    set used_posts=greatest(0,used_posts-v_job.units),updated_at=now()
    where organization_id=v_job.organization_id;
  elsif v_job.resource='image' then
    update public.usage_balances
    set used_images=greatest(0,used_images-v_job.units),updated_at=now()
    where organization_id=v_job.organization_id;
  else
    raise exception 'Unsupported resource';
  end if;

  insert into public.usage_ledger(
    organization_id,resource,delta,reason,reference_type,reference_id,created_by
  )
  values(
    v_job.organization_id,v_job.resource,v_job.units,'generation_refund',
    'content_job',v_job.id,null
  );

  return true;
end;
$$;

drop function if exists public.limo_video_export_credits(uuid, integer);
drop function if exists public.limo_video_max_duration_ms(uuid);
drop index if exists public.render_jobs_fingerprint_idx;
alter table public.render_jobs drop column if exists render_fingerprint;
alter table public.render_jobs drop column if exists charge_state;
alter table public.render_jobs drop column if exists credits;
