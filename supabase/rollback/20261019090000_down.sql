-- Rollback of 20261019090000_limo_animation_studio_v1 (Animation Studio + creative AI jobs).
-- Animation exports are removed from render_jobs (their MP4 files stay in storage and media_assets), the animation
-- tables and the AI job queue are dropped (generated files stay in media_assets), render_jobs gets its original
-- NOT NULL source columns back, and the three flags are removed.
delete from public.render_jobs where animation_project_id is not null;
alter table public.render_jobs drop constraint if exists render_jobs_source_check;
alter table public.render_jobs drop column if exists animation_project_id;
alter table public.render_jobs alter column project_id set not null;
alter table public.render_jobs alter column script_revision_id set not null;
alter table public.render_jobs alter column script_revision_number set not null;
drop function if exists public.enqueue_animation_render(uuid, text, integer, text);
drop function if exists public.quarantine_stale_ai_jobs(integer);
drop function if exists public.fail_ai_job(uuid, text, text, text);
drop function if exists public.complete_ai_job(uuid, text, text, jsonb, uuid[], integer, integer);
drop function if exists public.defer_ai_job(uuid, text, text, text, jsonb, integer);
drop function if exists public.claim_ai_jobs(text, integer);
drop function if exists public.cancel_ai_job(uuid);
drop function if exists public.request_social_ai_job(uuid, text, jsonb, text, integer);
drop function if exists public.request_animation_job(uuid, text, text, integer);
drop function if exists public.animation_readiness(uuid);
drop function if exists public.set_animation_shot_frames(uuid, uuid, uuid);
drop function if exists public.decide_animation_shot(uuid, text, text, text);
drop function if exists public.save_animation_shots(uuid, jsonb, integer);
drop function if exists public.save_animation_project(uuid, uuid, text, text, text, uuid, text, jsonb);
drop function if exists public.animation_log(public.animation_shots, text, text, text, uuid);
drop function if exists public.animation_character_gaps(uuid, text);
drop function if exists public.animation_flag(text);
drop table if exists public.ai_jobs;
drop table if exists public.animation_shot_events;
drop table if exists public.animation_shots;
drop table if exists public.animation_projects;
delete from public.feature_flags where key in ('animation_generation', 'ai_social_text', 'ai_social_images');
