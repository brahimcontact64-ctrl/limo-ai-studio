-- Rollback of 20261017180000_limo_image_studio_v1. Run first (newest migration).
-- Removes image designs, their revisions and export records, and social post drafts.
-- Exported files stay in the workspace library (media_assets kind 'design' and their storage objects):
-- they are ordinary library images and are not deleted by this script.
drop function if exists public.set_social_post_approval(uuid, boolean, timestamptz);
drop function if exists public.save_social_post(uuid, uuid, timestamptz, text, text, text[], uuid, uuid);
drop function if exists public.register_image_export(uuid, text, text, integer, integer, bigint, integer);
drop function if exists public.remove_image_approval(uuid);
drop function if exists public.approve_image_project(uuid, timestamptz);
drop function if exists public.restore_image_revision(uuid, timestamptz);
drop function if exists public.save_image_project(uuid, uuid, timestamptz, text, text, text, text, text, jsonb, jsonb, text, text, uuid, uuid);
drop function if exists public.limo_record_image_revision(uuid, text, text);
drop function if exists public.limo_check_image_doc(uuid, text, jsonb);

drop table if exists public.social_posts;
drop table if exists public.image_exports;
alter table if exists public.image_projects drop constraint if exists image_projects_approved_revision_fkey;
drop table if exists public.image_revisions;
drop table if exists public.image_projects;
