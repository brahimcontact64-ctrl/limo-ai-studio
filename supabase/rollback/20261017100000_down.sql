-- Rollback of 20261017100000_limo_universal_creation_v1. Requires 20261017120000_down.sql first.
-- Removes creation modes/briefs, narration, visual prompts, scene media links, brand kits and asset metadata.
--
-- PRE-CHECK: the old cast rule requires 1..18 characters. Character-free projects must be resolved
-- (exported and deleted, or given a character) by the owner before this rollback; otherwise it stops here.
do $$
begin
  if exists (select 1 from public.studio_projects where jsonb_array_length(project_cast) = 0) then
    raise exception 'Rollback stopped: % character-free projects exist; resolve them first',
      (select count(*) from public.studio_projects where jsonb_array_length(project_cast) = 0);
  end if;
end $$;

drop function if exists public.save_studio_project_v2(uuid, uuid, text, text, text, text, text, text, text, jsonb, jsonb, jsonb, text[]);
drop function if exists public.save_brand_kit(uuid, jsonb);
drop function if exists public.delete_media_asset(uuid);
drop function if exists public.register_media_asset(uuid, text, text, text, bigint, text, integer, integer, integer, text);
drop table if exists public.brand_kits;

drop policy if exists workspace_assets_insert on storage.objects;
drop policy if exists workspace_assets_read on storage.objects;
drop policy if exists workspace_assets_delete on storage.objects;
-- The private bucket "workspace-assets" and its files are left in place on purpose: Storage objects
-- must be removed through the Storage API (or dashboard) after exporting them, not with SQL.

alter table public.media_assets drop constraint if exists media_assets_kind_check;
alter table public.media_assets
  drop column if exists kind,
  drop column if exists file_name,
  drop column if exists mime_type,
  drop column if exists size_bytes,
  drop column if exists width,
  drop column if exists height,
  drop column if exists duration_ms,
  drop column if exists label,
  drop column if exists created_by;

alter table public.project_scenes
  drop column if exists narration,
  drop column if exists visual_prompt,
  drop column if exists asset_ids;

alter table public.studio_projects drop constraint if exists studio_projects_project_cast_check1;
alter table public.studio_projects add constraint studio_projects_project_cast_check1
  check (jsonb_array_length(project_cast) between 1 and 18);
alter table public.studio_projects drop constraint if exists studio_projects_creation_mode_check;
alter table public.studio_projects drop constraint if exists studio_projects_creation_brief_check;
alter table public.studio_projects
  drop column if exists creation_mode,
  drop column if exists creation_brief;
