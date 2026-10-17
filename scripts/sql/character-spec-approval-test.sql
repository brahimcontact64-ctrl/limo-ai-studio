-- Spec approval and readiness test for migration 20261017140000 (local stack only).
-- Impersonates the first platform admin with an aal2 session inside a transaction that is always
-- rolled back, so no spec or reference is approved permanently.
-- Usage: docker exec -i <db container> psql -U postgres -q < scripts/sql/character-spec-approval-test.sql
begin;
do $$
declare
  v_admin uuid := (select user_id from public.platform_admins limit 1);
  v_status text;
  v_ok boolean;
  v_path text;
  v_view text;
  v_id uuid;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  v_ok := false;
  begin
    perform public.admin_approve_character_spec('nova_girl', 1);
  exception when others then
    v_ok := sqlerrm like 'Not authorized%';
  end;
  raise notice 'SPEC aal1 admin refused: %', v_ok;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  v_ok := false;
  begin
    perform public.admin_approve_character_spec('nova_girl', 2);
  exception when others then
    v_ok := sqlerrm like 'Only the latest%';
  end;
  raise notice 'SPEC only the latest version can be approved: %', v_ok;

  v_status := public.admin_approve_character_spec('nova_girl', 1);
  raise notice 'SPEC approved spec alone does not make the character ready: %', v_status = 'pending';

  -- Three approved views for the approved spec: the character becomes ready (fixture rows, rolled back).
  foreach v_view in array array['front', 'side', 'three_quarter'] loop
    v_path := 'canonical/nova_girl/v1/sqltest-' || v_view || '.png';
    insert into storage.objects(bucket_id, name, owner) values ('character-library', v_path, v_admin);
    v_id := public.register_character_reference('nova_girl', null, v_path, 'rendered_reference', v_view, null, null, 'image/png', 68, 1, 1, 'uploaded_artwork', 'SQL test fixture', '{}'::jsonb);
    perform public.record_character_reference_view(v_id);
    v_status := public.review_character_reference(v_id, true, null,
      '{"identity_matches_spec":true,"proportions_match":true,"palette_matches":true,"family_friendly":true,"view_correct":true,"no_text_or_watermark":true}'::jsonb);
  end loop;
  raise notice 'SPEC approved spec + three approved views = ready: %', v_status = 'approved';
  raise notice 'SPEC catalog visual_ref points at the approved front: %',
    (select visual_ref from public.character_catalog where id = 'nova_girl') = 'canonical/nova_girl/v1/sqltest-front.png';

  -- A new proposed spec version makes the old references stop counting.
  perform public.admin_propose_character_spec('nova_girl', '{"note":"v2 test"}'::jsonb, 'test');
  raise notice 'SPEC new spec version resets readiness: %', (select reference_status from public.character_catalog where id = 'nova_girl') = 'pending';
end $$;
rollback;
