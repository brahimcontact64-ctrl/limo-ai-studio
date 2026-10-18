-- Generation gate test for migration 20261017120000 (local stack only; runs in a transaction that is rolled back).
-- Usage: docker exec -i <db container> psql -U postgres -q < scripts/sql/generation-gate-test.sql
begin;
-- Isolate the approval trigger: the existing cost/provider gates refuse runs while generation is disabled.
alter table public.generation_runs disable trigger trg_generation_cost_policy_completeness;
alter table public.generation_runs disable trigger trg_generation_provider_readiness;
alter table public.generation_runs disable trigger trg_generation_pressure;
do $$
declare
  p public.studio_projects%rowtype;
  v_policy text;
  v_rev uuid;
  v_run uuid;
  v_ok boolean := false;
begin
  -- A project within the V1 30 s video limit (migration 20261018090000 refuses approving longer scripts).
  select * into p from public.studio_projects where exists (select 1 from public.project_scenes s where s.project_id = studio_projects.id) and script_status <> 'approved'
    and (select sum(s.duration_seconds) from public.project_scenes s where s.project_id = studio_projects.id) <= 30 limit 1;
  select code into v_policy from public.generation_cost_policies limit 1;
  begin
    insert into public.generation_runs(organization_id, project_id, requested_by, request_key, cost_policy_code, slots_reserved, estimated_cost_cents)
    values (p.organization_id, p.id, p.created_by, 'gate-test-1', v_policy, 1, 1);
  exception when others then
    v_ok := sqlerrm like 'Approve the script%';
  end;
  raise notice 'GATE unapproved run refused: %', v_ok;

  v_rev := (public.limo_record_revision(p.id, 'approval', 'gate test')).id;
  update public.studio_projects set script_status = 'approved', approved_revision_id = v_rev where id = p.id;
  insert into public.generation_runs(organization_id, project_id, requested_by, request_key, cost_policy_code, slots_reserved, estimated_cost_cents)
  values (p.organization_id, p.id, p.created_by, 'gate-test-2', v_policy, 1, 1) returning id into v_run;
  raise notice 'GATE approved run records revision: %', (select script_revision_id = v_rev from public.generation_runs where id = v_run);

  v_ok := false;
  begin
    update public.project_scenes set narration = 'direct write' where project_id = p.id;
  exception when others then
    v_ok := sqlerrm like 'Script is approved%';
  end;
  raise notice 'GATE direct scene write refused while approved: %', v_ok;

  v_ok := false;
  begin
    update public.studio_projects set status = 'archived' where id = p.id;
    v_ok := true;
  exception when others then
    v_ok := false;
  end;
  raise notice 'GATE status change still allowed while approved: %', v_ok;
end $$;
rollback;
