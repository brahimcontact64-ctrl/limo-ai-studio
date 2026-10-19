-- Animation Studio + AI jobs (migration 20261019090000). LOCAL stack only; one transaction, always rolled back.
-- Usage: docker exec -i <db container> psql -U postgres -q < scripts/sql/animation-studio-test.sql
begin;
do $$
declare
  v_a uuid; v_org uuid; v_b uuid;
  v_p uuid; v_p2 uuid;
  r jsonb;
  s1 uuid; s2 uuid; sp uuid;
  v_job uuid; v_img uuid; v_vid uuid;
  ok boolean; msg text; n integer;
  v_render public.render_jobs%rowtype;
  shot4 jsonb := '{"duration_seconds":8,"description":"[d]","environment":"[e]","characters":["limo_man"],"actions":{"limo_man":"[a]"},"dialogue":[{"speaker":"limo_man","text":"[line]"}]}';
  product jsonb := '{"duration_seconds":8,"description":"[product]","environment":"[e]","characters":[]}';
begin
  select u.id, m.organization_id into v_a, v_org from auth.users u join public.organization_members m on m.user_id = u.id where u.email = 'alpha@limo.test';
  select u.id into v_b from auth.users u where u.email = 'beta@limo.test';
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_a::text, true);
  update public.feature_flags set enabled = false where key in ('animation_generation', 'ai_social_text', 'ai_social_images');

  v_p := public.save_animation_project(v_org, null, '[title]', 'fr', '9:16', null, '', '{}');
  raise notice 'ANIM project created: %', v_p is not null;
  r := public.save_animation_shots(v_p, jsonb_build_array(shot4, shot4, shot4, shot4 || '{"duration_seconds":6}'), null);
  raise notice 'ANIM 30 s storyboard saved: %', (r ->> 'total_seconds')::int = 30;
  begin perform public.save_animation_shots(v_p, jsonb_build_array(shot4, shot4, shot4, shot4, product || '{"duration_seconds":4}'), null); ok := false;
  exception when others then ok := sqlerrm like 'Videos are limited to 30 seconds%'; end;
  raise notice 'ANIM over 30 s refused: %', ok;
  begin perform public.save_animation_shots(v_p, jsonb_build_array(product || '{"duration_seconds":5}'), null); ok := false; exception when others then ok := sqlerrm like '%4, 6 or 8%'; end;
  raise notice 'ANIM non-Veo shot length refused: %', ok;
  begin perform public.save_animation_shots(v_p, jsonb_build_array(product || '{"characters":["limo_robot"]}'), null); ok := false; exception when others then ok := sqlerrm like 'Unknown character%'; end;
  raise notice 'ANIM unknown character refused: %', ok;
  begin perform public.save_animation_shots(v_p, jsonb_build_array(product || '{"dialogue":[{"speaker":"nova_girl","text":"x"}]}'), null); ok := false; exception when others then ok := sqlerrm like '%speaker%'; end;
  raise notice 'ANIM speaker outside the shot refused: %', ok;
  begin perform public.save_animation_shots(v_p, jsonb_build_array(shot4 || jsonb_build_object('reference_asset_ids', jsonb_build_array(gen_random_uuid()))), null); ok := false; exception when others then ok := sqlerrm like 'References must be approved%'; end;
  raise notice 'ANIM unapproved reference refused: %', ok;
  begin perform public.save_animation_shots(v_p, jsonb_build_array(shot4), 1); ok := false; exception when others then ok := sqlerrm like '%another window%'; end;
  raise notice 'ANIM stale revision refused: %', ok;

  select id into s1 from public.animation_shots where project_id = v_p and shot_number = 1;
  begin perform public.request_animation_job(s1, 'animation_keyframe', 'sqltest-key-0001', 0); ok := false; exception when others then ok := sqlerrm = 'AI animation is not enabled'; end;
  raise notice 'ANIM job refused while the flag is off: %', ok;
  update public.feature_flags set enabled = true where key = 'animation_generation';
  begin perform public.request_animation_job(s1, 'animation_keyframe', 'sqltest-key-0002', 0); ok := false; exception when others then ok := sqlerrm like 'Character limo_man is not ready%'; end;
  raise notice 'ANIM job refused for a character without approved artwork: %', ok;

  -- A product shot (no character) goes through keyframe → clip → approval.
  v_p2 := public.save_animation_project(v_org, null, '[product]', 'fr', '9:16', null, '', '{}');
  perform public.save_animation_shots(v_p2, jsonb_build_array(product), null);
  select id into sp from public.animation_shots where project_id = v_p2;
  r := public.request_animation_job(sp, 'animation_keyframe', 'sqltest-key-0003', 0);
  raise notice 'ANIM keyframe job queued: %', r ->> 'status' = 'queued' and (select status from public.animation_shots where id = sp) = 'keyframe_queued';
  raise notice 'ANIM same request key reused: %', (public.request_animation_job(sp, 'animation_keyframe', 'sqltest-key-0003', 0) ->> 'reused')::boolean;
  begin perform public.save_animation_shots(v_p2, jsonb_build_array(product || jsonb_build_object('id', sp, 'description', 'changed')), null); ok := false; exception when others then ok := sqlerrm like '%being generated%'; end;
  raise notice 'ANIM shot being generated cannot be edited: %', ok;

  insert into public.media_assets(organization_id, bucket_id, object_path, media_type, source, kind, mime_type) values (v_org, 'workspace-assets', v_org || '/generated/sqltest/k.png', 'image', 'generated', 'ai_image', 'image/png') returning id into v_img;
  insert into public.media_assets(organization_id, bucket_id, object_path, media_type, source, kind, mime_type, duration_ms) values (v_org, 'workspace-assets', v_org || '/generated/sqltest/c.mp4', 'video', 'generated', 'ai_video', 'video/mp4', 8000) returning id into v_vid;
  select id into v_job from public.claim_ai_jobs('sqltest-worker', 1);
  perform public.complete_ai_job(v_job, 'sqltest-worker', 'limo-mock', '{}', array[v_img], 0, 0);
  raise notice 'ANIM keyframe attached for review: %', (select status = 'keyframe_review' and keyframe_asset_id = v_img from public.animation_shots where id = sp);
  begin perform public.decide_animation_shot(sp, 'keyframe', 'reject', ''); ok := false; exception when others then ok := sqlerrm like 'Say what should change%'; end;
  raise notice 'ANIM rejection needs a note: %', ok;
  perform public.decide_animation_shot(sp, 'keyframe', 'approve', null);
  raise notice 'ANIM approved keyframe becomes the first frame: %', (select status = 'keyframe_approved' and first_frame_asset_id = v_img from public.animation_shots where id = sp);

  perform public.request_animation_job(sp, 'animation_clip', 'sqltest-key-0004', 0);
  select id into v_job from public.claim_ai_jobs('sqltest-worker', 1);
  perform public.complete_ai_job(v_job, 'sqltest-worker', 'limo-mock', '{"animated":false}', '{}', 0, 0);
  begin perform public.decide_animation_shot(sp, 'clip', 'approve', null); ok := false; exception when others then ok := sqlerrm like 'No generated clip%'; end;
  raise notice 'ANIM mock (not animated) clip cannot be approved: %', ok;
  perform public.decide_animation_shot(sp, 'clip', 'reject', 'needs real motion');
  perform public.request_animation_job(sp, 'animation_clip', 'sqltest-key-0005', 0);
  select id into v_job from public.claim_ai_jobs('sqltest-worker', 1);
  perform public.defer_ai_job(v_job, 'sqltest-worker', 'google', 'models/veo/operations/op1', '{"reserved_cents":0}', 2);
  raise notice 'ANIM async clip waits for the provider: %', (select status = 'waiting_provider' and provider_job_id = 'models/veo/operations/op1' from public.ai_jobs where id = v_job);
  update public.ai_jobs set poll_after = now() - interval '1 second' where id = v_job;
  perform public.claim_ai_jobs('sqltest-worker', 1);
  perform public.complete_ai_job(v_job, 'sqltest-worker', 'google', '{"animated":true}', array[v_vid], 80, 80);
  perform public.decide_animation_shot(sp, 'clip', 'approve', null);
  raise notice 'ANIM real clip approved: %', (select status = 'approved' and clip_asset_id = v_vid from public.animation_shots where id = sp);
  begin perform public.set_animation_shot_frames(sp, v_img, null); ok := false; exception when others then ok := sqlerrm like 'The clip already exists%'; end;
  raise notice 'ANIM frames locked once the clip exists: %', ok;
  raise notice 'ANIM history recorded: %', (select count(*) >= 6 from public.animation_shot_events where shot_id = sp);

  -- Export through the existing render pipeline.
  begin perform public.enqueue_animation_render(v_p, 'sqltest-export-1', 720, 'standard'); ok := false; exception when others then ok := sqlerrm like 'Approve every shot%'; end;
  raise notice 'ANIM export refused until every clip is approved: %', ok;
  begin
    r := public.enqueue_animation_render(v_p2, 'sqltest-export-2', 720, 'standard');
    select * into v_render from public.render_jobs where id = (r ->> 'id')::uuid;
    raise notice 'ANIM export creates an animation render job (8 s, 24 fps, one credit reserved): %',
      v_render.animation_project_id = v_p2 and v_render.project_id is null and v_render.total_duration_ms = 8000 and v_render.fps = 24 and v_render.charge_state = 'reserved'
      and (v_render.spec -> 'scenes' -> 0 -> 'visual' ->> 'asset_id')::uuid = v_vid and (v_render.spec -> 'scenes' -> 0 -> 'clip_audio' ->> 'volume')::numeric = 1;
    raise notice 'ANIM export idempotent: %', (public.enqueue_animation_render(v_p2, 'sqltest-export-2', 720, 'standard') ->> 'reused')::boolean;
  exception when others then
    raise notice 'ANIM export creates an animation render job (8 s, 24 fps, one credit reserved): % (%)', sqlerrm like 'Active subscription required%', sqlerrm;
  end;

  -- Export dedupe and credit release (V1 policy on animation exports).
  declare
    v_used0 integer; v_used1 integer; v_used2 integer; v_r2 jsonb; v_id uuid;
  begin
    select used_video_slots into v_used0 from public.usage_balances where organization_id = v_org;
    v_r2 := public.enqueue_animation_render(v_p2, 'sqltest-export-3', 720, 'standard');
    select used_video_slots into v_used1 from public.usage_balances where organization_id = v_org;
    raise notice 'CREDIT identical export with a new key reuses the queued video, no second credit: %', (v_r2 ->> 'duplicate')::boolean and v_used1 = v_used0;
    v_r2 := public.enqueue_animation_render(v_p2, 'sqltest-export-4', 480, 'draft');
    select used_video_slots into v_used1 from public.usage_balances where organization_id = v_org;
    raise notice 'CREDIT different output settings = a new video, one credit reserved: %', not coalesce((v_r2 ->> 'duplicate')::boolean, false) and v_used1 = v_used0 + 1;
    v_id := (v_r2 ->> 'id')::uuid;
    update public.render_jobs set status = 'queued', available_at = now() - interval '1 second' where status = 'queued' and id <> v_id;
    perform 1 from public.claim_render_job('sqltest-render', 60) c where c.id = v_id;
    if not found then update public.render_jobs set status = 'processing', locked_by = 'sqltest-render', locked_at = now() where id = v_id; end if;
    perform public.fail_render_job(v_id, 'sqltest-render', 'render_failed', 'test', false);
    select used_video_slots into v_used2 from public.usage_balances where organization_id = v_org;
    raise notice 'CREDIT a failed export releases its credit: %', v_used2 = v_used0 and (select charge_state from public.render_jobs where id = v_id) = 'released';
  exception when others then
    raise notice 'CREDIT export checks: % (%)', sqlerrm like 'Active subscription required%', sqlerrm;
  end;

  -- Mock clip guard and identity confirmation on a shot with a (test-fixture) workspace character.
  declare
    v_char uuid; v_ref uuid; v_sc uuid; v_p3 uuid; v_mockclip uuid; v_j uuid; i integer;
  begin
    insert into public.characters(organization_id, name, spec_version) values (v_org, 'sqltest fixture', 1) returning id into v_char;
    insert into public.character_reference_assets(organization_id, custom_character_id, spec_version, asset_kind, view, object_path, mime_type, size_bytes, provenance, status)
    select v_org, v_char, 1, 'rendered_reference', v, 'custom/x/' || v || '.png', 'image/png', 10, 'uploaded_artwork', 'approved' from unnest(array['front', 'three_quarter', 'side']) v;
    select id into v_ref from public.character_reference_assets where custom_character_id = v_char and view = 'front';
    v_p3 := public.save_animation_project(v_org, null, '[c]', 'fr', '9:16', null, '', '{}');
    perform public.save_animation_shots(v_p3, jsonb_build_array(jsonb_build_object('duration_seconds', 8, 'characters', jsonb_build_array('custom:' || v_char), 'reference_asset_ids', jsonb_build_array(v_ref))), null);
    select id into v_sc from public.animation_shots where project_id = v_p3;
    perform public.request_animation_job(v_sc, 'animation_keyframe', 'sqltest-key-0100', 0);
    select id into v_j from public.claim_ai_jobs('sqltest-worker', 1);
    perform public.complete_ai_job(v_j, 'sqltest-worker', 'limo-mock', '{"identity_check":{"verdict":"needs_human_review","checks":[]}}', array[v_img], 0, 0);
    raise notice 'IDENTITY automated review stored with the keyframe: %', (select identity_review -> 'keyframe' -> 'automated' ->> 'verdict' = 'needs_human_review' from public.animation_shots where id = v_sc);
    begin perform public.decide_animation_shot(v_sc, 'keyframe', 'approve', null, false); ok := false; exception when others then ok := sqlerrm like 'Confirm the character identity%'; end;
    raise notice 'IDENTITY approval refused without the owner''s confirmation: %', ok;
    perform public.decide_animation_shot(v_sc, 'keyframe', 'approve', null, true);
    raise notice 'IDENTITY confirmation recorded (who, when, manual): %', (select identity_review -> 'keyframe' ->> 'manual' = 'true' and identity_review -> 'keyframe' ? 'confirmed_at' from public.animation_shots where id = v_sc);
    insert into public.media_assets(organization_id, bucket_id, object_path, media_type, source, kind, mime_type, provenance) values (v_org, 'workspace-assets', v_org || '/generated/sqltest/mock.mp4', 'video', 'generated', 'ai_video', 'video/mp4', '{"mock":true}') returning id into v_mockclip;
    perform public.request_animation_job(v_sc, 'animation_clip', 'sqltest-key-0101', 0);
    select id into v_j from public.claim_ai_jobs('sqltest-worker', 1);
    perform public.complete_ai_job(v_j, 'sqltest-worker', 'limo-mock', '{}', array[v_mockclip], 0, 0);
    begin perform public.decide_animation_shot(v_sc, 'clip', 'approve', null, true); ok := false; exception when others then ok := sqlerrm like 'Mock clips cannot be approved%'; end;
    raise notice 'MOCK a mock-labelled clip file can never be approved as animation: %', ok;
    perform public.decide_animation_shot(v_sc, 'clip', 'reject', 'mock', false);
    -- Attempt cap: 5 clip attempts per shot revision (failed attempts count).
    for i in 2..5 loop
      perform public.request_animation_job(v_sc, 'animation_clip', 'sqltest-key-02' || i, 0);
      select id into v_j from public.claim_ai_jobs('sqltest-worker', 1);
      perform public.fail_ai_job(v_j, 'sqltest-worker', 'unavailable', 'test');
    end loop;
    begin perform public.request_animation_job(v_sc, 'animation_clip', 'sqltest-key-0299', 0); ok := false; exception when others then ok := sqlerrm like 'Attempt limit reached%'; end;
    raise notice 'ATTEMPTS sixth clip attempt for the same shot version refused; counter = 5: %', ok and (select (attempts ->> 'animation_clip')::int = 5 from public.animation_shots where id = v_sc);
  end;

  -- Owner media + post-production (migration 20261019150000).
  declare
    v_pm uuid; v_sm uuid; v_logo uuid; v_audio uuid; v_other uuid; v_mockv uuid; v_r jsonb; v_job2 public.render_jobs%rowtype;
  begin
    v_pm := public.save_animation_project(v_org, null, '[media]', 'ar', '9:16', null, '', '{}');
    perform public.save_animation_shots(v_pm, jsonb_build_array(product || '{"duration_seconds":4,"transition_out":"fade","freeze_ms":500}', product || '{"duration_seconds":4,"overlays":[{"text":"اصنع. برمج. انشر.","start_ms":500,"end_ms":4000,"position":"bottom","size":"large","style":"tagline"}]}'), null);
    select id into v_sm from public.animation_shots where project_id = v_pm and shot_number = 1;
    insert into public.media_assets(organization_id, bucket_id, object_path, media_type, source, kind, mime_type, size_bytes) values (v_org, 'workspace-assets', v_org || '/sqltest-logo.png', 'image', 'uploaded', 'logo', 'image/png', 100) returning id into v_logo;
    insert into public.media_assets(organization_id, bucket_id, object_path, media_type, source, kind, mime_type, size_bytes) values (v_org, 'workspace-assets', v_org || '/sqltest-a.mp3', 'audio', 'uploaded', 'audio', 'audio/mpeg', 100) returning id into v_audio;
    insert into public.media_assets(organization_id, bucket_id, object_path, media_type, source, kind, mime_type, provenance) values (v_org, 'workspace-assets', v_org || '/sqltest-mock.mp4', 'video', 'generated', 'ai_video', 'video/mp4', '{"mock":true}') returning id into v_mockv;
    select id into v_other from public.media_assets where organization_id <> v_org and media_type = 'video' limit 1;
    begin perform public.set_animation_shot_media(v_sm, v_audio); ok := false; exception when others then ok := sqlerrm = 'Media must be an image or a video'; end;
    raise notice 'MEDIA audio refused as shot media: %', ok;
    begin perform public.set_animation_shot_media(v_sm, v_mockv); ok := false; exception when others then ok := sqlerrm like 'Mock files cannot%'; end;
    raise notice 'MEDIA mock file refused as shot media: %', ok;
    if v_other is not null then
      begin perform public.set_animation_shot_media(v_sm, v_other); ok := false; exception when others then ok := sqlerrm like 'Media must be a file of this workspace%'; end;
      raise notice 'MEDIA another workspace''s file refused: %', ok;
    end if;
    v_r := public.set_animation_shot_media(v_sm, v_vid);
    raise notice 'MEDIA own video goes to review (not approved), source = owner: %', v_r ->> 'status' = 'clip_review' and (select media_source = 'owner' and clip_asset_id = v_vid from public.animation_shots where id = v_sm);
    perform public.decide_animation_shot(v_sm, 'clip', 'approve', null, false);
    perform public.set_animation_shot_media((select id from public.animation_shots where project_id = v_pm and shot_number = 2), v_logo);
    perform public.decide_animation_shot((select id from public.animation_shots where project_id = v_pm and shot_number = 2), 'clip', 'approve', null, false);
    -- Post-production edits never reset an approved clip; content edits do.
    perform public.save_animation_shots(v_pm, (select jsonb_agg(jsonb_build_object('id', id, 'duration_seconds', duration_seconds, 'description', description, 'environment', environment, 'characters', '[]'::jsonb,
      'transition_out', 'crossfade', 'freeze_ms', 1000, 'overlays', overlays) order by shot_number) from public.animation_shots where project_id = v_pm), null);
    raise notice 'POST transition/freeze change keeps the approved clip: %', (select status = 'approved' and clip_asset_id = v_vid and freeze_ms = 1000 and transition_out = 'crossfade' from public.animation_shots where id = v_sm);
    begin perform public.save_animation_shots(v_pm, jsonb_build_array(product || '{"duration_seconds":4,"freeze_ms":2500}'), null); ok := false; exception when others then ok := sqlerrm like 'A freeze frame lasts at most half%'; end;
    raise notice 'POST freeze longer than half the shot refused: %', ok;
    begin perform public.save_animation_shots(v_pm, jsonb_build_array(product || '{"duration_seconds":4,"overlays":[{"text":"x","start_ms":3000,"end_ms":5000}]}'), null); ok := false; exception when others then ok := sqlerrm like 'Overlay times must be inside%'; end;
    raise notice 'POST overlay outside the shot refused: %', ok;
    begin perform public.save_animation_shots(v_pm, jsonb_build_array(product || '{"duration_seconds":4,"transition_out":"spin"}'), null); ok := false; exception when others then ok := sqlerrm = 'Invalid transition'; end;
    raise notice 'POST unknown transition refused: %', ok;
    begin
      v_r := public.enqueue_animation_render(v_pm, 'sqltest-export-media', 720, 'standard');
      select * into v_job2 from public.render_jobs where id = (v_r ->> 'id')::uuid;
      raise notice 'EXPORT spec: video + image media, freeze, transition, Arabic overlay, transition seconds: %',
        v_job2.spec -> 'scenes' -> 0 -> 'visual' ->> 'media_type' = 'video' and v_job2.spec -> 'scenes' -> 1 -> 'visual' ->> 'media_type' = 'image'
        and (v_job2.spec -> 'scenes' -> 0 ->> 'freeze_ms')::int = 1000 and v_job2.spec -> 'scenes' -> 0 ->> 'transition' = 'crossfade'
        and v_job2.spec -> 'scenes' -> 1 -> 'overlays' -> 0 ->> 'text' = 'اصنع. برمج. انشر.' and (v_job2.spec ->> 'transition_seconds')::numeric = 0.5 and v_job2.total_duration_ms = 8000;
    exception when others then raise notice 'EXPORT spec: % (%)', sqlerrm like 'Active subscription required%', sqlerrm; end;
  end;

  -- Failure and quarantine.
  begin perform public.request_animation_job(sp, 'animation_voice', 'sqltest-key-0006', 0); ok := false; exception when others then ok := sqlerrm like 'Nothing to speak%'; end;
  raise notice 'ANIM voice refused without dialogue: %', ok;
  perform public.save_animation_shots(v_p2, jsonb_build_array(product || jsonb_build_object('id', sp, 'description', 'changed')), null);
  raise notice 'ANIM editing an approved shot sends it back to draft (revision + 1): %', (select status = 'draft' and revision = 2 and clip_asset_id is null from public.animation_shots where id = sp);
  perform public.request_animation_job(sp, 'animation_keyframe', 'sqltest-key-0007', 0);
  select id into v_job from public.claim_ai_jobs('sqltest-worker', 1);
  update public.ai_jobs set locked_at = now() - interval '20 minutes' where id = v_job;
  n := public.quarantine_stale_ai_jobs(10);
  raise notice 'ANIM stale job quarantined, shot back to draft: %', n >= 1 and (select status = 'failed' and error_code = 'worker_lost' from public.ai_jobs where id = v_job) and (select status = 'draft' from public.animation_shots where id = sp);

  -- Social AI jobs.
  begin perform public.request_social_ai_job(v_org, 'social_caption', '{"language":"fr","prompt":"x"}', 'sqltest-social-1', 0); ok := false; exception when others then ok := sqlerrm = 'AI content is not enabled'; end;
  raise notice 'SOCIAL caption refused while the flag is off: %', ok;
  update public.feature_flags set enabled = true where key = 'ai_social_text';
  raise notice 'SOCIAL caption queued when enabled: %', public.request_social_ai_job(v_org, 'social_caption', '{"language":"fr","prompt":"x"}', 'sqltest-social-2', 0) ->> 'status' = 'queued';
  begin perform public.request_social_ai_job(v_org, 'social_image', '{"language":"fr","prompt":"x"}', 'sqltest-social-3', 0); ok := false; exception when others then ok := sqlerrm = 'AI content is not enabled'; end;
  raise notice 'SOCIAL image needs its own flag: %', ok;
  begin perform public.request_social_ai_job(v_org, 'social_caption', '{"language":"es","prompt":"x"}', 'sqltest-social-4', 0); ok := false; exception when others then ok := sqlerrm = 'Invalid request'; end;
  raise notice 'SOCIAL unsupported language refused: %', ok;

  -- Workspace isolation (beta is not a member of alpha's workspace).
  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_b::text, true);
  begin perform public.save_animation_shots(v_p, jsonb_build_array(product), null); ok := false; exception when others then ok := sqlerrm = 'Not authorized'; end;
  raise notice 'ISOLATION other workspace cannot edit the storyboard: %', ok;
  begin perform public.request_social_ai_job(v_org, 'social_caption', '{"language":"fr","prompt":"x"}', 'sqltest-social-5', 0); ok := false; exception when others then ok := sqlerrm = 'Not authorized'; end;
  raise notice 'ISOLATION other workspace cannot request jobs: %', ok;
  execute 'set local role authenticated';
  select count(*) into n from public.animation_projects where id in (v_p, v_p2);
  raise notice 'ISOLATION other workspace sees no projects (RLS): %', n = 0;
  select count(*) into n from public.ai_jobs where organization_id = v_org;
  raise notice 'ISOLATION other workspace sees no jobs (RLS): %', n = 0;
  begin perform public.claim_ai_jobs('x', 1); ok := false; exception when insufficient_privilege then ok := true; end;
  raise notice 'SECURITY customers cannot claim worker jobs: %', ok;
  begin insert into public.ai_jobs(organization_id, kind, request_key) values (v_org, 'social_caption', 'sqltest-direct'); ok := false; exception when insufficient_privilege then ok := true; end;
  raise notice 'SECURITY no direct job inserts: %', ok;
  execute 'reset role';
end $$;
rollback;
