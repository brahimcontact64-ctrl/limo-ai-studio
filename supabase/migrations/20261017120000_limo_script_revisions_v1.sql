-- LIMO Milestone 3: script revisions, approval and protection of approved scripts.
-- Status: PENDING OWNER APPROVAL for production. See docs/MIGRATION_REVIEW.md.
-- Additive: new table, new columns, new functions and triggers. Existing functions keep their signatures.
--   * project_revisions: immutable snapshots (manual save, autosave, Mock AI, restore, approval).
--   * save_studio_project_v3: optimistic concurrency (p_base_updated_at) + revision + approval handling,
--     delegating validation and writes to save_studio_project_v2.
--   * Approved scripts cannot be changed by ANY entry point (v1/v2/v3/direct writes) until approval is
--     explicitly removed (triggers below). Generation runs require an approved, unchanged script.
-- Depends on 20261017100000 (save_studio_project_v2, creation columns).

-- 1. Project columns ------------------------------------------------------------------------------
alter table public.studio_projects
  add column if not exists script_status text not null default 'draft',
  add column if not exists approved_revision_id uuid,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references auth.users(id) on delete set null;
alter table public.studio_projects drop constraint if exists studio_projects_script_status_check;
alter table public.studio_projects add constraint studio_projects_script_status_check check (script_status in ('draft', 'approved', 'changed'));

-- 2. Revisions ------------------------------------------------------------------------------------
create table if not exists public.project_revisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.studio_projects(id) on delete cascade,
  revision_number integer not null check (revision_number > 0),
  source text not null check (source in ('created', 'manual', 'autosave', 'mock_ai', 'restore', 'approval')),
  label text check (label is null or char_length(label) <= 200),
  snapshot jsonb not null,
  scene_count integer not null default 0,
  total_duration_seconds integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, revision_number)
);
create index if not exists project_revisions_project_idx on public.project_revisions(project_id, revision_number desc);
create index if not exists project_revisions_org_idx on public.project_revisions(organization_id, created_at desc);
alter table public.project_revisions enable row level security;
drop policy if exists project_revisions_read on public.project_revisions;
create policy project_revisions_read on public.project_revisions for select to authenticated using (public.is_org_member(organization_id));
revoke all on public.project_revisions from public, anon, authenticated;
grant select on public.project_revisions to authenticated;
grant all on public.project_revisions to service_role;

alter table public.studio_projects drop constraint if exists studio_projects_approved_revision_fkey;
alter table public.studio_projects add constraint studio_projects_approved_revision_fkey
  foreign key (approved_revision_id) references public.project_revisions(id) on delete set null;

alter table public.generation_runs add column if not exists script_revision_id uuid references public.project_revisions(id) on delete set null;

-- 3. Snapshot in the exact save_studio_project_v2 input format (so a restore is a normal save) ---------
create or replace function public.limo_project_snapshot(p_project_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select jsonb_build_object(
    'title', p.title, 'creation_mode', p.creation_mode, 'creation_brief', p.creation_brief,
    'content_type', p.content_type, 'language_code', p.language_code,
    'brief', coalesce(p.brief, ''), 'goal', coalesce(p.goal, ''), 'visual_style', coalesce(p.visual_style, ''),
    'project_cast', p.project_cast,
    'export_presets', coalesce((select jsonb_agg(c.preset_code order by c.preset_code) from public.project_export_choices c where c.project_id = p.id), '[]'::jsonb),
    'scenes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'scene_number', s.scene_number, 'title', coalesce(s.title, ''), 'duration_seconds', s.duration_seconds,
        'participants', to_jsonb(s.participants), 'location_prompt', coalesce(s.location_prompt, ''),
        'environment_prompt', coalesce(s.environment_prompt, ''), 'camera_prompt', coalesce(s.camera_prompt, ''),
        'lighting_prompt', coalesce(s.lighting_prompt, ''), 'action_prompt', coalesce(s.action_prompt, ''),
        'dialogue', coalesce(s.dialogue, ''), 'on_screen_text', coalesce(s.on_screen_text, ''),
        'effects_prompt', coalesce(s.effects_prompt, ''), 'music_prompt', coalesce(s.music_prompt, ''),
        'transition_out', coalesce(s.transition_out, ''), 'continuity_notes', coalesce(s.continuity_notes, ''),
        'narration', coalesce(s.narration, ''), 'visual_prompt', coalesce(s.visual_prompt, ''),
        'asset_ids', to_jsonb(s.asset_ids)
      ) order by s.scene_number)
      from public.project_scenes s where s.project_id = p.id
    ), '[]'::jsonb)
  )
  from public.studio_projects p where p.id = p_project_id;
$function$;
revoke all on function public.limo_project_snapshot(uuid) from public, anon, authenticated;

-- Records a revision. Consecutive autosaves by the same user within 10 minutes update one revision.
create or replace function public.limo_record_revision(p_project_id uuid, p_source text, p_label text)
returns public.project_revisions
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_snapshot jsonb := public.limo_project_snapshot(p_project_id);
  v_org uuid;
  v_last public.project_revisions%rowtype;
  v_rev public.project_revisions%rowtype;
  v_scenes integer := jsonb_array_length(v_snapshot->'scenes');
  v_duration integer;
begin
  select organization_id into v_org from public.studio_projects where id = p_project_id;
  select coalesce(sum((x->>'duration_seconds')::integer), 0) into v_duration from jsonb_array_elements(v_snapshot->'scenes') x;
  select * into v_last from public.project_revisions where project_id = p_project_id order by revision_number desc limit 1;
  if p_source = 'autosave' and v_last.id is not null and v_last.source = 'autosave'
     and v_last.created_by = auth.uid() and v_last.updated_at > now() - interval '10 minutes' then
    update public.project_revisions
      set snapshot = v_snapshot, scene_count = v_scenes, total_duration_seconds = v_duration, updated_at = now()
      where id = v_last.id returning * into v_rev;
    return v_rev;
  end if;
  insert into public.project_revisions(organization_id, project_id, revision_number, source, label, snapshot, scene_count, total_duration_seconds, created_by)
  values (v_org, p_project_id, coalesce(v_last.revision_number, 0) + 1, p_source, nullif(left(btrim(coalesce(p_label, '')), 200), ''), v_snapshot, v_scenes, v_duration, auth.uid())
  returning * into v_rev;
  -- Keep the 30 most recent autosaves per project; other revisions are kept.
  delete from public.project_revisions r
  where r.project_id = p_project_id and r.source = 'autosave'
    and r.id not in (select id from public.project_revisions where project_id = p_project_id and source = 'autosave' order by revision_number desc limit 30)
    and r.id is distinct from (select approved_revision_id from public.studio_projects where id = p_project_id);
  return v_rev;
end;
$function$;
revoke all on function public.limo_record_revision(uuid, text, text) from public, anon, authenticated;

-- 4. Approved scripts are read-only for every write path ---------------------------------------------
-- Project row: script fields are frozen while approved (status changes such as archive stay possible).
create or replace function public.limo_guard_approved_project()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if old.script_status = 'approved' and new.script_status = 'approved'
     and (new.title, new.brief, new.goal, new.visual_style, new.creation_mode, new.creation_brief, new.project_cast, new.content_type, new.language_code)
         is distinct from (old.title, old.brief, old.goal, old.visual_style, old.creation_mode, old.creation_brief, old.project_cast, old.content_type, old.language_code) then
    raise exception 'Script is approved; remove approval before editing' using errcode = 'P0001';
  end if;
  return new;
end;
$function$;

-- Scenes: no insert/update/delete while the project's script is approved. When the project itself is
-- being deleted its row is already gone, so the cascade is allowed.
create or replace function public.limo_guard_approved_scenes()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  v_status text;
begin
  select script_status into v_status from public.studio_projects
    where id = case when tg_op = 'DELETE' then old.project_id else new.project_id end;
  if v_status = 'approved' then
    raise exception 'Script is approved; remove approval before editing' using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

drop trigger if exists trg_guard_approved_project on public.studio_projects;
create trigger trg_guard_approved_project before update on public.studio_projects
  for each row execute function public.limo_guard_approved_project();
drop trigger if exists trg_guard_approved_scenes on public.project_scenes;
create trigger trg_guard_approved_scenes before insert or update or delete on public.project_scenes
  for each row execute function public.limo_guard_approved_scenes();

-- Generation needs an approved script; the run records which revision it used.
create or replace function public.limo_require_approved_script()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  v_status text;
  v_rev uuid;
begin
  select script_status, approved_revision_id into v_status, v_rev from public.studio_projects where id = new.project_id;
  if v_status is distinct from 'approved' or v_rev is null then
    raise exception 'Approve the script before generating' using errcode = 'P0001';
  end if;
  new.script_revision_id := v_rev;
  return new;
end;
$function$;
drop trigger if exists trg_require_approved_script on public.generation_runs;
create trigger trg_require_approved_script before insert on public.generation_runs
  for each row execute function public.limo_require_approved_script();

-- 5. Save with concurrency check + revision ---------------------------------------------------------
create or replace function public.save_studio_project_v3(
  p_organization_id uuid, p_project_id uuid, p_base_updated_at timestamptz, p_revision_source text, p_revision_label text,
  p_remove_approval boolean, p_title text, p_creation_mode text, p_content_type text, p_language_code text,
  p_brief text, p_goal text, p_visual_style text, p_creation_brief jsonb, p_project_cast jsonb, p_scenes jsonb,
  p_export_presets text[]
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_project public.studio_projects%rowtype;
  v_id uuid;
  v_rev public.project_revisions%rowtype;
  v_source text := coalesce(p_revision_source, 'manual');
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.can_edit_org(p_organization_id) then raise exception 'Not authorized'; end if;
  if v_source not in ('manual', 'autosave', 'mock_ai') then raise exception 'Invalid revision source'; end if;

  if p_project_id is not null then
    select * into v_project from public.studio_projects
      where id = p_project_id and organization_id = p_organization_id for update;
    if not found then raise exception 'Project not found or no longer editable'; end if;
    if p_base_updated_at is null or date_trunc('milliseconds', v_project.updated_at) <> date_trunc('milliseconds', p_base_updated_at) then
      raise exception 'Project changed since it was loaded' using errcode = 'P0001';
    end if;
    if v_project.script_status = 'approved' then
      if not coalesce(p_remove_approval, false) then raise exception 'Script is approved; remove approval before editing'; end if;
      update public.studio_projects set script_status = 'changed' where id = p_project_id;
    end if;
  end if;

  v_id := public.save_studio_project_v2(
    p_organization_id, p_project_id, p_title, p_creation_mode, p_content_type, p_language_code,
    p_brief, p_goal, p_visual_style, p_creation_brief, p_project_cast, p_scenes, p_export_presets
  );
  v_rev := public.limo_record_revision(v_id, case when p_project_id is null then 'created' else v_source end, p_revision_label);
  select * into v_project from public.studio_projects where id = v_id;
  return jsonb_build_object(
    'project_id', v_id, 'updated_at', v_project.updated_at, 'script_status', v_project.script_status,
    'revision_id', v_rev.id, 'revision_number', v_rev.revision_number
  );
end;
$function$;

-- Restore = save the revision's snapshot as a new revision (history is never rewritten).
create or replace function public.restore_project_revision(p_revision_id uuid, p_base_updated_at timestamptz, p_remove_approval boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_rev public.project_revisions%rowtype;
  v_s jsonb;
  v_result jsonb;
  v_new public.project_revisions%rowtype;
  v_project public.studio_projects%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_rev from public.project_revisions where id = p_revision_id;
  if not found or not public.can_edit_org(v_rev.organization_id) then raise exception 'Revision not found'; end if;
  v_s := v_rev.snapshot;
  v_result := public.save_studio_project_v3(
    v_rev.organization_id, v_rev.project_id, p_base_updated_at, 'manual', null, p_remove_approval,
    v_s->>'title', v_s->>'creation_mode', v_s->>'content_type', v_s->>'language_code',
    v_s->>'brief', v_s->>'goal', v_s->>'visual_style', v_s->'creation_brief', v_s->'project_cast', v_s->'scenes',
    coalesce((select array_agg(x) from jsonb_array_elements_text(v_s->'export_presets') x), array[]::text[])
  );
  -- Relabel the revision just written as a restore.
  update public.project_revisions set source = 'restore', label = 'Restored revision ' || v_rev.revision_number
    where id = (v_result->>'revision_id')::uuid returning * into v_new;
  select * into v_project from public.studio_projects where id = v_rev.project_id;
  return v_result || jsonb_build_object('revision_number', v_new.revision_number);
end;
$function$;

-- 6. Approval ---------------------------------------------------------------------------------------
create or replace function public.approve_project_script(p_project_id uuid, p_base_updated_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_project public.studio_projects%rowtype;
  v_rev public.project_revisions%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_project from public.studio_projects where id = p_project_id for update;
  if not found or not public.can_edit_org(v_project.organization_id) then raise exception 'Project not found'; end if;
  if v_project.status not in ('draft', 'ready') then raise exception 'Project is not editable'; end if;
  if p_base_updated_at is null or date_trunc('milliseconds', v_project.updated_at) <> date_trunc('milliseconds', p_base_updated_at) then
    raise exception 'Project changed since it was loaded' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.project_scenes where project_id = p_project_id) then raise exception 'Project has no scenes'; end if;
  v_rev := public.limo_record_revision(p_project_id, 'approval', 'Approved script');
  update public.studio_projects
    set script_status = 'approved', approved_revision_id = v_rev.id, approved_at = now(), approved_by = auth.uid(), updated_at = now()
    where id = p_project_id returning * into v_project;
  insert into public.platform_audit_events(organization_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (v_project.organization_id, auth.uid(), 'script.approved', 'studio_project', p_project_id, jsonb_build_object('revision_number', v_rev.revision_number));
  return jsonb_build_object('script_status', 'approved', 'updated_at', v_project.updated_at, 'revision_id', v_rev.id, 'revision_number', v_rev.revision_number);
end;
$function$;

create or replace function public.remove_script_approval(p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_project public.studio_projects%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_project from public.studio_projects where id = p_project_id for update;
  if not found or not public.can_edit_org(v_project.organization_id) then raise exception 'Project not found'; end if;
  if v_project.script_status <> 'approved' then
    return jsonb_build_object('script_status', v_project.script_status, 'updated_at', v_project.updated_at);
  end if;
  update public.studio_projects set script_status = 'changed', updated_at = now() where id = p_project_id returning * into v_project;
  insert into public.platform_audit_events(organization_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (v_project.organization_id, auth.uid(), 'script.approval_removed', 'studio_project', p_project_id, '{}'::jsonb);
  return jsonb_build_object('script_status', v_project.script_status, 'updated_at', v_project.updated_at);
end;
$function$;

revoke all on function public.save_studio_project_v3(uuid, uuid, timestamptz, text, text, boolean, text, text, text, text, text, text, text, jsonb, jsonb, jsonb, text[]) from public, anon;
revoke all on function public.restore_project_revision(uuid, timestamptz, boolean) from public, anon;
revoke all on function public.approve_project_script(uuid, timestamptz) from public, anon;
revoke all on function public.remove_script_approval(uuid) from public, anon;
grant execute on function public.save_studio_project_v3(uuid, uuid, timestamptz, text, text, boolean, text, text, text, text, text, text, text, jsonb, jsonb, jsonb, text[]) to authenticated;
grant execute on function public.restore_project_revision(uuid, timestamptz, boolean) to authenticated;
grant execute on function public.approve_project_script(uuid, timestamptz) to authenticated;
grant execute on function public.remove_script_approval(uuid) to authenticated;

-- 7. Baseline revision for existing projects (one "created" snapshot each) ---------------------------
insert into public.project_revisions(organization_id, project_id, revision_number, source, label, snapshot, scene_count, total_duration_seconds, created_by)
select p.organization_id, p.id, 1, 'created', 'Baseline before revisions', public.limo_project_snapshot(p.id),
  (select count(*) from public.project_scenes s where s.project_id = p.id), coalesce(p.total_duration_seconds, 0), p.created_by
from public.studio_projects p
where not exists (select 1 from public.project_revisions r where r.project_id = p.id);
