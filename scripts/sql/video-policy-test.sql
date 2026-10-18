-- V1 video policy test for migration 20261018090000 (local stack only; one transaction, always rolled back).
-- Usage: docker exec -i <db container> psql -U postgres -q < scripts/sql/video-policy-test.sql
-- Covers the database boundary directly (as the owner / service role would): approval trigger, render_jobs
-- trigger (direct inserts and status changes), a legacy over-limit job, and the AI-generation path (budget
-- only, no video credit, nothing to refund). Customer flows through the RPCs are in scripts/e2e-render.ts.
begin;
-- Isolate the generation path from the provider/cost gates that keep it disabled (rolled back below).
alter table public.generation_runs disable trigger trg_generation_cost_policy_completeness;
alter table public.generation_runs disable trigger trg_generation_provider_readiness;
alter table public.generation_runs disable trigger trg_generation_pressure;
do $$
declare
  v_user uuid;
  v_org uuid;
  v_ct text;
  v_p uuid;
  v_rev uuid;
  v_job public.render_jobs%rowtype;
  v_new uuid;
  v_used_before integer;
  v_used_after integer;
  v_run uuid;
  v_cj public.content_jobs%rowtype;
  v_ok boolean;
  v_msg text;
  v_spec jsonb;
begin
  select u.id, m.organization_id into v_user, v_org from auth.users u join public.organization_members m on m.user_id = u.id where u.email = 'alpha@limo.test';
  select code into v_ct from public.content_type_catalog where active limit 1;

  -- 1. Policy functions --------------------------------------------------------------------------------
  raise notice 'POLICY max 30 s for this workspace: %', public.limo_video_max_duration_ms(v_org) = 30000;
  raise notice 'POLICY 10 s, 20 s and 30 s each use exactly one credit: %',
    public.limo_video_export_credits(v_org, 10000) = 1 and public.limo_video_export_credits(v_org, 20000) = 1 and public.limo_video_export_credits(v_org, 30000) = 1;
  v_ok := false;
  begin perform public.limo_video_export_credits(v_org, 30001); exception when others then v_ok := sqlerrm = 'Videos are limited to 30 seconds'; end;
  raise notice 'POLICY 30.001 s refused: %', v_ok;

  -- 2. Approval: a 31 s script cannot be approved; saving it is allowed; 30 s can be approved ------------
  insert into public.studio_projects(organization_id, created_by, title, content_type, creation_mode, project_cast)
  values (v_org, v_user, 'SQL policy test', v_ct, 'product_ad', '[]'::jsonb) returning id into v_p;
  insert into public.project_scenes(organization_id, project_id, scene_number, title, duration_seconds)
  values (v_org, v_p, 1, 'A', 15), (v_org, v_p, 2, 'B', 15), (v_org, v_p, 3, 'C', 1);
  raise notice 'APPROVAL a 31 s draft is saved (not truncated): %', (select sum(duration_seconds) from public.project_scenes where project_id = v_p) = 31;
  v_rev := (public.limo_record_revision(v_p, 'approval', 'policy test')).id;
  v_ok := false;
  begin
    update public.studio_projects set script_status = 'approved', approved_revision_id = v_rev where id = v_p;
  exception when others then v_ok := sqlerrm like 'Videos are limited to 30 seconds%'; end;
  raise notice 'APPROVAL 31 s refused: %', v_ok;
  update public.project_scenes set duration_seconds = 14 where project_id = v_p and scene_number = 2;
  v_rev := (public.limo_record_revision(v_p, 'approval', 'policy test 30 s')).id;
  update public.studio_projects set script_status = 'approved', approved_revision_id = v_rev where id = v_p;
  raise notice 'APPROVAL exactly 30 s approved: %', (select script_status = 'approved' from public.studio_projects where id = v_p);

  -- 3. render_jobs boundary (direct writes, e.g. service role) -----------------------------------------
  v_spec := jsonb_build_object('version', 1, 'width', 480, 'height', 854, 'scenes',
    jsonb_build_array(jsonb_build_object('scene_number', 1, 'duration_ms', 15000), jsonb_build_object('scene_number', 2, 'duration_ms', 15001)));
  v_ok := false;
  begin
    insert into public.render_jobs(organization_id, project_id, requested_by, idempotency_key, script_revision_id, script_revision_number, aspect, width, height, quality, spec, total_duration_ms)
    values (v_org, v_p, v_user, 'sqltest-over-limit', v_rev, 2, '9:16', 480, 854, 'draft', v_spec, 30001);
  exception when others then v_ok := sqlerrm = 'Videos are limited to 30 seconds'; end;
  raise notice 'RENDER direct insert of a 30.001 s job refused: %', v_ok;
  v_ok := false;
  begin
    insert into public.render_jobs(organization_id, project_id, requested_by, idempotency_key, script_revision_id, script_revision_number, aspect, width, height, quality, spec, total_duration_ms)
    values (v_org, v_p, v_user, 'sqltest-inconsistent', v_rev, 2, '9:16', 480, 854, 'draft', v_spec, 20000);
  exception when others then v_ok := sqlerrm = 'Render timeline is inconsistent'; end;
  raise notice 'RENDER total that does not match the scenes refused: %', v_ok;
  v_spec := jsonb_set(v_spec, '{scenes,1,duration_ms}', '15000');
  insert into public.render_jobs(organization_id, project_id, requested_by, idempotency_key, script_revision_id, script_revision_number, aspect, width, height, quality, spec, total_duration_ms)
  values (v_org, v_p, v_user, 'sqltest-30s', v_rev, 2, '9:16', 480, 854, 'draft', v_spec, 30000) returning id into v_new;
  raise notice 'RENDER exactly 30 s accepted: %', v_new is not null;

  -- A legacy job (created before the policy) over 30 s: cannot be queued again or claimed.
  update public.render_jobs set status = 'failed', total_duration_ms = 45000,
    spec = jsonb_set(spec, '{scenes,1,duration_ms}', '30000') where id = v_new;
  v_ok := false;
  begin update public.render_jobs set status = 'queued' where id = v_new; exception when others then v_ok := sqlerrm = 'Videos are limited to 30 seconds'; end;
  raise notice 'RENDER legacy 45 s job cannot be queued again: %', v_ok;
  raise notice 'RENDER legacy job and its data are kept: %', (select status = 'failed' and total_duration_ms = 45000 from public.render_jobs where id = v_new);

  -- Credit state machine on a valid job (reserve -> release -> reserve -> consume; consume once).
  update public.render_jobs set status = 'cancelled', total_duration_ms = 30000, spec = v_spec, charge_state = 'none', charged = false where id = v_new;
  select used_video_slots into v_used_before from public.usage_balances where organization_id = v_org;
  perform public.limo_charge_render(v_new);
  perform public.limo_charge_render(v_new);
  select used_video_slots into v_used_after from public.usage_balances where organization_id = v_org;
  raise notice 'CREDIT reserve is idempotent (1 credit for 2 calls): %', v_used_after = v_used_before + 1 and (select charge_state from public.render_jobs where id = v_new) = 'reserved';
  perform public.limo_settle_render_charge(v_new);
  perform public.limo_settle_render_charge(v_new);
  select used_video_slots into v_used_after from public.usage_balances where organization_id = v_org;
  raise notice 'CREDIT release refunds once: %', v_used_after = v_used_before and (select charge_state from public.render_jobs where id = v_new) = 'released';
  perform public.limo_charge_render(v_new);
  perform public.limo_consume_render_charge(v_new);
  perform public.limo_consume_render_charge(v_new);
  perform public.limo_settle_render_charge(v_new);
  select used_video_slots into v_used_after from public.usage_balances where organization_id = v_org;
  raise notice 'CREDIT re-reserve then consume: exactly 1 used, consumed credits are never refunded: %',
    v_used_after = v_used_before + 1 and (select charge_state from public.render_jobs where id = v_new) = 'consumed';
  raise notice 'CREDIT ledger for this job sums to -1 (reserved, refund, reserved, consumed once): %',
    (select sum(delta) = -1 and count(*) filter (where reason = 'render_consumed') = 1 from public.usage_ledger where reference_type = 'render_job' and reference_id = v_new);

  -- 4. AI generation: same 30 s limit, budget in cents only, no video credit ---------------------------
  update public.generation_cost_policies set enabled = true, verified_at = now() where code = 'standard_v1';
  update public.organizations set ai_enabled = true, monthly_budget_cents = greatest(coalesce(monthly_budget_cents, 0), 1000000) where id = v_org;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_user::text, true);
  select used_video_slots into v_used_before from public.usage_balances where organization_id = v_org;
  v_run := public.request_studio_generation(v_p, 'sql-policy-gen-30', 'standard_v1');
  select * into v_cj from public.content_jobs where id = (select root_job_id from public.generation_runs where id = v_run);
  select used_video_slots into v_used_after from public.usage_balances where organization_id = v_org;
  raise notice 'GENERATION a 30 s run is created with an AI budget reservation: %', v_run is not null and (select ai_reservation_id is not null from public.generation_runs where id = v_run);
  raise notice 'GENERATION does not consume a video credit: %', v_used_after = v_used_before and (v_cj.payload ->> 'export_credit_reserved') = 'false'
    and not exists (select 1 from public.usage_ledger where reference_type = 'content_job' and reference_id = v_cj.id);
  perform public.fail_content_job(v_cj.id, 'test', 0, true);
  raise notice 'GENERATION failure refunds no credit it never took: %', (select used_video_slots from public.usage_balances where organization_id = v_org) = v_used_before
    and not exists (select 1 from public.usage_ledger where reference_type = 'content_job' and reference_id = v_cj.id);
  raise notice 'GENERATION refund_generation_usage_once is a no-op: %', public.refund_generation_usage_once(v_cj.id) = false;

  update public.studio_projects set script_status = 'changed' where id = v_p;
  update public.project_scenes set duration_seconds = 15 where project_id = v_p and scene_number = 2;
  update public.studio_projects set total_duration_seconds = 31, status = 'draft' where id = v_p;
  v_ok := false;
  begin perform public.request_studio_generation(v_p, 'sql-policy-gen-31', 'standard_v1');
  exception when others then v_msg := sqlerrm; v_ok := sqlerrm = 'Videos are limited to 30 seconds'; end;
  raise notice 'GENERATION a 31 s project is refused: % (%)', v_ok, v_msg;
end $$;
rollback;
