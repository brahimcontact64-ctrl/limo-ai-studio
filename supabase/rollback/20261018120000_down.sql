-- Rollback of 20261018120000_limo_ai_generation_v1 (Milestone 10 AI generation foundation).
-- Generated files stay in storage and in media_assets (their kind becomes "other", their provenance is dropped);
-- proposal decisions are deleted; the Milestone 10 registry rows are removed and the previous render/export
-- defaults (shotstack) are restored. All providers were disabled before and stay disabled.
drop function if exists public.generation_availability(uuid);
drop function if exists public.decide_generation_proposal(uuid, integer, uuid, text);
drop table if exists public.generation_proposal_decisions;
drop index if exists public.media_assets_provenance_key_idx;
update public.media_assets set kind = 'other' where kind in ('ai_image', 'ai_video', 'ai_audio');
alter table public.media_assets drop constraint if exists media_assets_kind_check;
alter table public.media_assets add constraint media_assets_kind_check
  check (kind = any (array['product', 'logo', 'background', 'reference', 'photo', 'video', 'audio', 'render', 'design', 'other']));
alter table public.media_assets drop constraint if exists media_assets_provenance_check;
alter table public.media_assets drop column if exists provenance;
delete from public.ai_provider_registry where code in ('anthropic_script_v1', 'google_image_v1', 'google_character_image_v1', 'google_video_fast_v1', 'google_video_lite_v1');
update public.ai_provider_registry set is_default = false where code in ('limo_render_v1', 'limo_export_v1');
update public.ai_provider_registry set is_default = true where code in ('shotstack_render_v1', 'shotstack_export_v1');
