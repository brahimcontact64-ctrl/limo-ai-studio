-- Rollback of 20261017200000_limo_video_render_v1. Run first (newest migration).
-- Removes render jobs and saved video settings. Finished MP4 files stay in the workspace library
-- (media_assets kind 'render' and their objects under workspace-assets/<org>/renders/): they are ordinary
-- library videos and are not deleted here. Video slots already used this cycle are not given back; refund
-- queued jobs first (cancel them in the app) if that matters.
drop function if exists public.fail_render_job(uuid, text, text, text, boolean);
drop function if exists public.complete_render_job(uuid, text, text, bigint, integer, jsonb);
drop function if exists public.report_render_progress(uuid, text, numeric, text);
drop function if exists public.claim_render_job(text, integer);
drop function if exists public.retry_render_job(uuid);
drop function if exists public.cancel_render_job(uuid);
drop function if exists public.enqueue_render_job(uuid, text, text, integer, text, jsonb);
drop function if exists public.save_video_settings(uuid, jsonb);
drop function if exists public.limo_charge_render(uuid);
drop function if exists public.limo_settle_render_charge(uuid);
drop function if exists public.limo_render_media(uuid, uuid, text[]);
drop function if exists public.limo_render_size(text, integer);

drop table if exists public.render_jobs;
drop table if exists public.video_settings;
