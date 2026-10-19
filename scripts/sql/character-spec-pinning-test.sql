-- Spec version per shot (migration 20261019210000). LOCAL stack only; one transaction, always rolled back, so no
-- spec version is proposed or approved permanently and no reference is kept (all files are SQL fixtures).
-- Usage: docker exec -i <db container> psql -U postgres -q < scripts/sql/character-spec-pinning-test.sql
begin;
do $$
declare
  v_admin uuid := (select user_id from public.platform_admins limit 1);
  v_a uuid; v_org uuid;
  v_p uuid; v_s uuid; v_ref1 uuid; v_ref uuid; v_path text; v_view text;
  ok boolean; v_rev integer; v_other integer;
  checklist jsonb := '{"identity_matches_spec":true,"proportions_match":true,"palette_matches":true,"family_friendly":true,"view_correct":true,"no_text_or_watermark":true}';
  boy jsonb := '{"duration_seconds":4,"description":"[d]","environment":"[e]","characters":["adam_boy"],"actions":{"adam_boy":"[a]"}}';
begin
  select u.id, m.organization_id into v_a, v_org from auth.users u join public.organization_members m on m.user_id = u.id where u.email = 'alpha@limo.test';
  select count(*) into v_other from public.character_design_specs where character_id <> 'adam_boy';

  -- Admin: a v1 fixture reference, then propose adam_boy v2 (two-factor).
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  -- v1 fixture reference (inserted directly: uploads always go to the latest version), then v2 proposed if absent.
  insert into public.character_reference_assets(catalog_character_id, spec_version, asset_kind, view, object_path, mime_type, size_bytes, provenance, status)
  values ('adam_boy', 1, 'rendered_reference', 'front', 'canonical/adam_boy/v1/sqltest-front.png', 'image/png', 10, 'uploaded_artwork', 'approved') returning id into v_ref1;
  if not exists (select 1 from public.character_design_specs where character_id = 'adam_boy' and version = 2) then
    perform public.admin_propose_character_spec('adam_boy', '{"spec_version":2,"note":"sql test"}'::jsonb, 'sql test');
  end if;
  raise notice 'PIN v1 kept next to the proposed v2: %', (select count(*) = 2 from public.character_design_specs where character_id = 'adam_boy' and status <> 'superseded');
  raise notice 'PIN other characters untouched: %', (select count(*) from public.character_design_specs where character_id <> 'adam_boy') = v_other;

  -- Storyboard (member of workspace A).
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_a::text, true);
  v_p := public.save_animation_project(v_org, null, '[pins]', 'ar', '9:16', null, '', '{}');
  perform public.save_animation_shots(v_p, jsonb_build_array(boy, boy || '{"characters":["adam_man"],"actions":{"adam_man":"[a]"}}'), null);
  select id into v_s from public.animation_shots where project_id = v_p and shot_number = 1;
  raise notice 'PIN default = latest proposed version when none is approved (adam_boy → 2): %', (select character_spec_versions = '{"adam_boy": 2}'::jsonb from public.animation_shots where id = v_s);
  raise notice 'PIN other characters stay on their version (adam_man → 1): %', (select character_spec_versions = '{"adam_man": 1}'::jsonb from public.animation_shots where project_id = v_p and shot_number = 2);
  begin perform public.save_animation_shots(v_p, jsonb_build_array(boy || '{"character_spec_versions":{"adam_boy":9}}'), null); ok := false; exception when others then ok := sqlerrm like 'Spec version 9 of adam_boy does not exist%'; end;
  raise notice 'PIN unknown version refused: %', ok;
  begin perform public.save_animation_shots(v_p, jsonb_build_array(boy || jsonb_build_object('id', v_s, 'reference_asset_ids', jsonb_build_array(v_ref1))), null); ok := false;
  exception when others then ok := sqlerrm like 'References must match the spec version%'; end;
  raise notice 'PIN a v1 reference cannot be attached to a shot on v2: %', ok;
  perform public.save_animation_shots(v_p, jsonb_build_array(boy || jsonb_build_object('id', v_s, 'character_spec_versions', jsonb_build_object('adam_boy', 1), 'reference_asset_ids', jsonb_build_array(v_ref1))), null);
  raise notice 'PIN explicit v1 with its own reference accepted: %', (select character_spec_versions ->> 'adam_boy' = '1' and reference_asset_ids = array[v_ref1] from public.animation_shots where id = v_s);
  select revision into v_rev from public.animation_shots where id = v_s;
  perform public.save_animation_shots(v_p, jsonb_build_array(boy || jsonb_build_object('id', v_s, 'character_spec_versions', jsonb_build_object('adam_boy', 2))), null);
  raise notice 'PIN changing the version is an identity change (revision + 1, draft): %', (select revision = v_rev + 1 and status = 'draft' from public.animation_shots where id = v_s);

  -- The owner's composite design sheet is registered as a v2 "school" outfit reference without view or expression:
  -- even if it were approved by mistake it never counts as the canonical front / three-quarter / side.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  v_path := 'canonical/adam_boy/v2/sqltest-design-sheet.jpg';
  insert into storage.objects(bucket_id, name, owner) values ('character-library', v_path, v_admin);
  v_ref := public.register_character_reference('adam_boy', null, v_path, 'rendered_reference', null, null, 'school', 'image/jpeg', 240424, 1145, 1374, 'ai_generated', 'ChatGPT Image Generation — owner-approved composite design sheet; design source only, not a view', '{}'::jsonb);
  raise notice 'SOURCE composite registered as pending v2 school-outfit reference, no view: %', (select status = 'pending_review' and spec_version = 2 and view is null and expression_key is null and outfit_key = 'school' and provenance = 'ai_generated' from public.character_reference_assets where id = v_ref);
  perform public.record_character_reference_view(v_ref);
  perform public.review_character_reference(v_ref, true, null, checklist);
  raise notice 'SOURCE even if approved, it fills no view slot (front/three-quarter/side still missing for v2): %', (select array['missing_front', 'missing_three_quarter', 'missing_side'] <@ public.animation_character_gaps(v_org, 'adam_boy', 2));
  update public.character_reference_assets set status = 'pending_review', reviewed_at = null where id = v_ref;
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_a::text, true);

  -- Generation needs the pinned version approved.
  update public.feature_flags set enabled = true where key = 'animation_generation';
  begin perform public.request_animation_job(v_s, 'animation_keyframe', 'sqltest-pin-1', 0); ok := false; exception when others then ok := sqlerrm like '%spec_v2_not_approved%'; end;
  raise notice 'JOB refused while the pinned v2 is only proposed: %', ok;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform public.admin_approve_character_spec('adam_boy', 2);
  foreach v_view in array array['front', 'three_quarter', 'side'] loop
    v_path := 'canonical/adam_boy/v2/sqltest-' || v_view || '.png';
    insert into storage.objects(bucket_id, name, owner) values ('character-library', v_path, v_admin);
    v_ref := public.register_character_reference('adam_boy', null, v_path, 'rendered_reference', v_view, null, null, 'image/png', 68, 1, 1, 'uploaded_artwork', 'SQL fixture', '{}'::jsonb);
    perform public.record_character_reference_view(v_ref);
    perform public.review_character_reference(v_ref, true, null, checklist);
  end loop;
  -- Approval supersedes an earlier APPROVED version only; adam_boy v1 was never approved, so it stays in history as proposed.
  raise notice 'APPROVE v2 approved, v1 kept in history (not deleted, not approved): %', (select bool_and(case version when 1 then status in ('proposed', 'superseded') when 2 then status = 'approved' end) and count(*) = 2 from public.character_design_specs where character_id = 'adam_boy');
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_a::text, true);
  raise notice 'JOB queued once v2 and its three views are approved: %', public.request_animation_job(v_s, 'animation_keyframe', 'sqltest-pin-2', 0) ->> 'status' = 'queued';
  update public.ai_jobs set status = 'cancelled' where request_key = 'sqltest-pin-2';
  raise notice 'READINESS a shot pinned to the superseded v1 is not ready: %', 'spec_v1_not_approved' = any(public.animation_character_gaps(v_org, 'adam_boy', 1));
  raise notice 'READINESS 2-argument form = current approved version (v2, ready): %', cardinality(public.animation_character_gaps(v_org, 'adam_boy')) = 0;
  raise notice 'READINESS adam_man unaffected (still spec_not_approved on v1): %', 'spec_not_approved' = any(public.animation_character_gaps(v_org, 'adam_man'));
end $$;
rollback;
