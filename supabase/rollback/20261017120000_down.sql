-- Rollback of 20261017120000_limo_script_revisions_v1. Removes revision history and approval state.
-- Export project_revisions first if the history must be kept (see docs/MIGRATION_REVIEW.md).
drop trigger if exists trg_require_approved_script on public.generation_runs;
drop trigger if exists trg_guard_approved_scenes on public.project_scenes;
drop trigger if exists trg_guard_approved_project on public.studio_projects;
drop function if exists public.limo_require_approved_script();
drop function if exists public.limo_guard_approved_scenes();
drop function if exists public.limo_guard_approved_project();
drop function if exists public.remove_script_approval(uuid);
drop function if exists public.approve_project_script(uuid, timestamptz);
drop function if exists public.restore_project_revision(uuid, timestamptz, boolean);
drop function if exists public.save_studio_project_v3(uuid, uuid, timestamptz, text, text, boolean, text, text, text, text, text, text, text, jsonb, jsonb, jsonb, text[]);
drop function if exists public.limo_record_revision(uuid, text, text);
drop function if exists public.limo_project_snapshot(uuid);
alter table public.generation_runs drop column if exists script_revision_id;
alter table public.studio_projects drop constraint if exists studio_projects_approved_revision_fkey;
alter table public.studio_projects drop constraint if exists studio_projects_script_status_check;
alter table public.studio_projects
  drop column if exists approved_by,
  drop column if exists approved_at,
  drop column if exists approved_revision_id,
  drop column if exists script_status;
drop table if exists public.project_revisions;
