-- Character variants (migration 20261019180000). LOCAL stack only; one transaction, always rolled back, so no
-- variant, spec or reference is approved permanently (all images here are SQL fixtures, never artwork).
-- Usage: docker exec -i <db container> psql -U postgres -q < scripts/sql/character-variants-test.sql
begin;
do $$
declare
  v_admin uuid := (select user_id from public.platform_admins limit 1);
  v_a uuid; v_org uuid; v_b uuid;
  v_var uuid; v_prop uuid; v_ref uuid; v_p uuid; v_s uuid;
  v_path text; v_view text;
  ok boolean; n integer;
  checklist jsonb := '{"identity_matches_spec":true,"proportions_match":true,"palette_matches":true,"family_friendly":true,"view_correct":true,"no_text_or_watermark":true}';
  father jsonb;
begin
  select u.id, m.organization_id into v_a, v_org from auth.users u join public.organization_members m on m.user_id = u.id where u.email = 'alpha@limo.test';
  select u.id into v_b from auth.users u where u.email = 'beta@limo.test';
  select id into v_var from public.character_variants where variant_key = 'adam_man.formal_angry' and version = 1;

  raise notice 'VARIANT seeded approved with the owner note: %', (select status = 'approved' and approval_note like 'Approved by the owner in writing on 2026-10-19%' from public.character_variants where id = v_var);
  raise notice 'VARIANT canonical spec unchanged (adam_man v1 only, not approved by the variant): %', (select count(*) = 1 and bool_and(status = 'proposed') from public.character_design_specs where character_id = 'adam_man');
  raise notice 'VARIANT no artwork approved by the seed: %', not exists (select 1 from public.character_reference_assets where variant_id = v_var);

  -- Upload rules (platform admin with two-factor uploads canonical files).
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  v_path := 'canonical/adam_man/v1/sqltest-angry.png';
  insert into storage.objects(bucket_id, name, owner) values ('character-library', v_path, v_admin);
  begin perform public.register_character_reference('adam_man', null, v_path, 'rendered_reference', null, 'angry', null, 'image/png', 68, 1, 1, 'uploaded_artwork', 'SQL fixture', '{}'::jsonb); ok := false;
  exception when others then ok := sqlerrm like 'Expression is not canonical%'; end;
  raise notice 'UPLOAD "angry" refused without the variant: %', ok;
  begin perform public.register_character_reference('adam_man', null, v_path, 'rendered_reference', null, 'happy', null, 'image/png', 68, 1, 1, 'uploaded_artwork', 'SQL fixture', '{}'::jsonb, v_var); ok := false;
  exception when others then ok := sqlerrm like 'Expression is not part of this variant%'; end;
  raise notice 'UPLOAD other expression refused inside the variant: %', ok;
  begin perform public.register_character_reference('adam_man', null, v_path, 'rendered_reference', 'front', null, 'special', 'image/png', 68, 1, 1, 'uploaded_artwork', 'SQL fixture', '{}'::jsonb, v_var); ok := false;
  exception when others then ok := sqlerrm like 'Outfit is not part of this variant%'; end;
  raise notice 'UPLOAD other outfit refused inside the variant: %', ok;
  begin perform public.register_character_reference('adam_boy', null, 'canonical/adam_boy/v1/x.png', 'rendered_reference', null, 'angry', null, 'image/png', 68, 1, 1, 'uploaded_artwork', 'SQL fixture', '{}'::jsonb, v_var); ok := false;
  exception when others then ok := sqlerrm like 'Variant belongs to another character%'; end;
  raise notice 'UPLOAD variant of another character refused: %', ok;
  v_ref := public.register_character_reference('adam_man', null, v_path, 'rendered_reference', null, 'angry', 'formal', 'image/png', 68, 1, 1, 'uploaded_artwork', 'SQL fixture', '{}'::jsonb, v_var);
  raise notice 'UPLOAD "angry" accepted with the approved variant, pending review: %', (select status = 'pending_review' and variant_id = v_var from public.character_reference_assets where id = v_ref);

  insert into public.character_variants(variant_key, version, catalog_character_id, base_spec_version, status, outfit, expression)
  values ('adam_man.sqltest', 1, 'adam_man', 1, 'proposed', '{"key":"robe"}', '{"key":"angry"}') returning id into v_prop;
  begin perform public.register_character_reference('adam_man', null, v_path, 'rendered_reference', null, 'angry', null, 'image/png', 68, 1, 1, 'uploaded_artwork', 'SQL fixture', '{}'::jsonb, v_prop); ok := false;
  exception when others then ok := sqlerrm like 'Variant not approved%'; end;
  raise notice 'UPLOAD proposed variant refused: %', ok;

  -- Variant approval is admin + two-factor, audited.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  begin perform public.admin_set_character_variant_status(v_prop, 'approved', 'test'); ok := false; exception when others then ok := sqlerrm like 'Not authorized%'; end;
  raise notice 'APPROVAL aal1 admin refused: %', ok;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform public.admin_set_character_variant_status(v_prop, 'rejected', 'SQL test rejection');
  raise notice 'APPROVAL decision audited: %', exists (select 1 from public.platform_audit_events where entity_id = v_prop and event_type = 'character.variant_rejected');

  -- Canonical readiness never counts variant files: approve the spec and a VARIANT front only → front still missing.
  perform public.admin_approve_character_spec('adam_man', 1);
  v_path := 'canonical/adam_man/v1/sqltest-variant-front.png';
  insert into storage.objects(bucket_id, name, owner) values ('character-library', v_path, v_admin);
  v_ref := public.register_character_reference('adam_man', null, v_path, 'rendered_reference', 'front', 'angry', 'formal', 'image/png', 68, 1, 1, 'uploaded_artwork', 'SQL fixture', '{}'::jsonb, v_var);
  perform public.record_character_reference_view(v_ref);
  perform public.review_character_reference(v_ref, true, null, checklist);
  raise notice 'READINESS variant front does not count as the canonical front: %', 'missing_front' = any(public.animation_character_gaps(v_org, 'adam_man'));
  foreach v_view in array array['front', 'three_quarter', 'side'] loop
    v_path := 'canonical/adam_man/v1/sqltest-' || v_view || '.png';
    insert into storage.objects(bucket_id, name, owner) values ('character-library', v_path, v_admin);
    v_ref := public.register_character_reference('adam_man', null, v_path, 'rendered_reference', v_view, null, null, 'image/png', 68, 1, 1, 'uploaded_artwork', 'SQL fixture', '{}'::jsonb);
    perform public.record_character_reference_view(v_ref);
    perform public.review_character_reference(v_ref, true, null, checklist);
  end loop;
  raise notice 'READINESS canonical views approved → canonical ready: %', cardinality(public.animation_character_gaps(v_org, 'adam_man')) = 0;
  raise notice 'READINESS approving the canonical front did not supersede the variant front: %', exists (select 1 from public.character_reference_assets where variant_id = v_var and view = 'front' and status = 'approved');

  -- Storyboard: the variant is selected per shot; its expression is allowed only with it.
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_a::text, true);
  father := '{"duration_seconds":4,"description":"[d]","environment":"[e]","characters":["adam_man"],"actions":{"adam_man":"[a]"}}';
  v_p := public.save_animation_project(v_org, null, '[variants]', 'ar', '9:16', null, '', '{}');
  begin perform public.save_animation_shots(v_p, jsonb_build_array(father || '{"expressions":{"adam_man":"angry"}}'), null); ok := false; exception when others then ok := sqlerrm = 'Invalid expression'; end;
  raise notice 'SHOT "angry" refused without the variant: %', ok;
  begin perform public.save_animation_shots(v_p, jsonb_build_array(father || '{"dialogue":[{"speaker":"adam_man","text":"[x]","emotion":"angry"}]}'), null); ok := false; exception when others then ok := sqlerrm = 'Unknown expression'; end;
  raise notice 'SHOT "angry" line emotion refused without the variant: %', ok;
  begin perform public.save_animation_shots(v_p, jsonb_build_array(father || '{"character_variants":{"adam_man":"adam_man.sqltest"}}'), null); ok := false; exception when others then ok := sqlerrm like 'Variant is not approved%'; end;
  raise notice 'SHOT rejected variant refused: %', ok;
  begin perform public.save_animation_shots(v_p, jsonb_build_array(father || '{"characters":["adam_boy"],"actions":{},"character_variants":{"adam_boy":"adam_man.formal_angry"}}'), null); ok := false; exception when others then ok := sqlerrm like 'Variant is not approved%'; end;
  raise notice 'SHOT variant on another character refused: %', ok;
  perform public.save_animation_shots(v_p, jsonb_build_array(father || '{"expressions":{"adam_man":"angry"},"character_variants":{"adam_man":"adam_man.formal_angry"},"dialogue":[{"speaker":"adam_man","text":"[x]","emotion":"angry"}]}'), null);
  select id into v_s from public.animation_shots where project_id = v_p;
  raise notice 'SHOT variant + its expression saved: %', (select character_variants ->> 'adam_man' = 'adam_man.formal_angry' and expressions ->> 'adam_man' = 'angry' from public.animation_shots where id = v_s);

  -- Generation needs the variant's own approved front (here: approved fixture above) — remove it to check the guard.
  update public.feature_flags set enabled = true where key = 'animation_generation';
  update public.character_reference_assets set status = 'superseded' where variant_id = v_var and view = 'front';
  begin perform public.request_animation_job(v_s, 'animation_keyframe', 'sqltest-variant-1', 0); ok := false; exception when others then ok := sqlerrm like '%missing_variant_front%'; end;
  raise notice 'JOB refused without the variant''s approved front: %', ok;
  update public.character_reference_assets set status = 'approved' where variant_id = v_var and view = 'front';
  raise notice 'JOB queued once the variant front is approved: %', public.request_animation_job(v_s, 'animation_keyframe', 'sqltest-variant-2', 0) ->> 'status' = 'queued';

  -- Customers cannot create or approve variants.
  execute 'set local role authenticated';
  begin insert into public.character_variants(variant_key, catalog_character_id, base_spec_version) values ('adam_man.hack', 'adam_man', 1); ok := false; exception when insufficient_privilege then ok := true; end;
  raise notice 'SECURITY customers cannot create variants: %', ok;
  begin perform public.admin_set_character_variant_status(v_var, 'rejected', 'hack'); ok := false; exception when others then ok := sqlerrm like 'Not authorized%'; end;
  raise notice 'SECURITY customers cannot approve or reject variants: %', ok;
  select count(*) into n from public.character_variants where variant_key = 'adam_man.formal_angry';
  raise notice 'SECURITY members can read canonical variants: %', n = 1;
  execute 'reset role';
end $$;
rollback;
