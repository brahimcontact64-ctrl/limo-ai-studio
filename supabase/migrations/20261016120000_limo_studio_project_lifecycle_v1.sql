-- LIMO AI Studio — studio project lifecycle v1
-- Status: PENDING OWNER APPROVAL. Not yet applied to production.
--
-- Additive / corrective only. No table, column or row is dropped.
--
-- 1. Fix: studio_projects_project_cast_check1 still limits project_cast to 1..3
--    entries although save_studio_project (migration 20261016061058) accepts 1..18.
--    Any save with 4+ characters currently fails at the table constraint.
-- 2. Add archive/restore/delete RPCs. Clients have no UPDATE/DELETE policy on
--    studio_projects, so lifecycle changes must go through SECURITY DEFINER functions.
--    Delete is refused once a project has generation history (generation_runs and
--    export_jobs cascade from studio_projects and hold cost/audit records); such
--    projects can only be archived.
-- 3. Add rename_organization for workspace owners/admins (organizations has no
--    UPDATE policy; bootstrap_limo_user names every workspace 'My workspace').

alter table public.studio_projects drop constraint if exists studio_projects_project_cast_check1;
alter table public.studio_projects add constraint studio_projects_project_cast_check1
  check (jsonb_array_length(project_cast) between 1 and 18);

create or replace function public.archive_studio_project(p_project_id uuid)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_project public.studio_projects%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_project from public.studio_projects where id=p_project_id for update;
  if not found then raise exception 'Project not found'; end if;
  if not public.can_edit_org(v_project.organization_id) then raise exception 'Not authorized'; end if;
  if v_project.status in ('queued','generating') then
    raise exception 'Project has an active generation and cannot be archived';
  end if;
  update public.studio_projects set status='archived',updated_at=now() where id=p_project_id;
  return 'archived';
end;
$function$;

create or replace function public.restore_studio_project(p_project_id uuid)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_project public.studio_projects%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_project from public.studio_projects where id=p_project_id for update;
  if not found then raise exception 'Project not found'; end if;
  if not public.can_edit_org(v_project.organization_id) then raise exception 'Not authorized'; end if;
  if v_project.status<>'archived' then raise exception 'Project is not archived'; end if;
  update public.studio_projects set status='draft',updated_at=now() where id=p_project_id;
  return 'draft';
end;
$function$;

create or replace function public.delete_studio_project(p_project_id uuid)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_project public.studio_projects%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_project from public.studio_projects where id=p_project_id for update;
  if not found then raise exception 'Project not found'; end if;
  if not public.can_edit_org(v_project.organization_id) then raise exception 'Not authorized'; end if;
  if v_project.status not in ('draft','ready','archived') then
    raise exception 'Only draft, ready or archived projects can be deleted';
  end if;
  if exists(select 1 from public.generation_runs where project_id=p_project_id)
     or exists(select 1 from public.export_jobs where project_id=p_project_id) then
    raise exception 'Project has generation history; archive it instead';
  end if;
  delete from public.studio_projects where id=p_project_id;
  return 'deleted';
end;
$function$;

create or replace function public.rename_organization(p_organization_id uuid, p_name text)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_name text := btrim(coalesce(p_name,''));
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.is_org_admin(p_organization_id) then raise exception 'Not authorized'; end if;
  if char_length(v_name) not between 1 and 120 then raise exception 'Workspace name must be 1 to 120 characters'; end if;
  update public.organizations set name=v_name where id=p_organization_id;
  return v_name;
end;
$function$;

revoke all on function public.archive_studio_project(uuid) from public, anon;
revoke all on function public.restore_studio_project(uuid) from public, anon;
revoke all on function public.delete_studio_project(uuid) from public, anon;
revoke all on function public.rename_organization(uuid, text) from public, anon;
grant execute on function public.archive_studio_project(uuid) to authenticated;
grant execute on function public.restore_studio_project(uuid) to authenticated;
grant execute on function public.delete_studio_project(uuid) to authenticated;
grant execute on function public.rename_organization(uuid, text) to authenticated;
