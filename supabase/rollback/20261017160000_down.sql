-- Rollback of 20261017160000_limo_story_engine_v1. Run first (newest migration).
-- Removes Story Bible versions, seasons, episode endings/checkpoints, review state and the timeline.
-- Studio projects of episodes are kept (with their scripts and revisions); series and episode rows are kept.
drop trigger if exists trg_episode_script_unapproved on public.studio_projects;
drop function if exists public.limo_episode_script_unapproved();
drop function if exists public.resolve_episode_review(uuid, text);
drop function if exists public.reopen_story_episode(uuid);
drop function if exists public.approve_story_episode(uuid, integer);
drop function if exists public.save_episode_checkpoint(uuid, jsonb, timestamptz);
drop function if exists public.create_story_episode(uuid, uuid, uuid, text, text, text, jsonb, jsonb, text[]);
drop function if exists public.create_story_season(uuid, text, text);
drop function if exists public.restore_story_bible(uuid, integer, integer);
drop function if exists public.save_story_bible(uuid, integer, jsonb, text);
drop function if exists public.create_story_series(uuid, text, text, text, jsonb);
drop function if exists public.limo_reopen_episode(uuid, text);
drop function if exists public.limo_flag_later_episodes(public.content_episodes, text, text[], text[]);
drop function if exists public.limo_write_bible(public.content_series, jsonb, text, text);
drop function if exists public.limo_check_bible_removals(uuid, jsonb);
drop function if exists public.limo_check_bible(uuid, jsonb);

drop table if exists public.story_events;
drop table if exists public.story_checkpoint_versions;
drop table if exists public.story_bible_versions;

drop index if exists public.content_episodes_project_uidx;
alter table public.content_episodes drop constraint if exists content_episodes_checkpoint_status_check;
alter table public.content_episodes drop constraint if exists content_episodes_review_status_check;
alter table public.content_episodes drop constraint if exists content_episodes_checkpoint_check;
alter table public.content_episodes
  drop column if exists season_id,
  drop column if exists project_id,
  drop column if exists checkpoint,
  drop column if exists checkpoint_status,
  drop column if exists checkpoint_updated_at,
  drop column if exists approved_checkpoint,
  drop column if exists checkpoint_fingerprint,
  drop column if exists approved_project_revision_id,
  drop column if exists approved_at,
  drop column if exists approved_by,
  drop column if exists based_on_episode_id,
  drop column if exists based_on_fingerprint,
  drop column if exists bible_version_used,
  drop column if exists review_status,
  drop column if exists review_reasons,
  drop column if exists review_history;
drop table if exists public.story_seasons;
alter table public.content_series drop column if exists current_bible_version, drop column if exists updated_by;

-- Previous direct-write policies (20261015134745_limo_profiles_story_safety_retention_foundation).
grant insert, update, delete on public.content_series, public.content_episodes to authenticated;
drop policy if exists content_series_write on public.content_series;
create policy content_series_write on public.content_series for all to authenticated
  using (public.can_edit_org(organization_id)) with check (public.can_edit_org(organization_id) and created_by = (select auth.uid()));
drop policy if exists content_episodes_write on public.content_episodes;
create policy content_episodes_write on public.content_episodes for all to authenticated
  using (public.can_edit_org(organization_id)) with check (public.can_edit_org(organization_id) and created_by = (select auth.uid()));
