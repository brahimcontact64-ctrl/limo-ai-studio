-- LIMO Milestone 10: AI provider integration foundation. ALL PROVIDERS STAY DISABLED.
-- Status: PENDING OWNER APPROVAL for production (12th pending migration). See docs/MIGRATION_REVIEW.md.
-- Depends on 20261018090000 (V1 video policy) and the production generation orchestration
-- (generation_runs / generation_run_stages / ai_provider_registry and their service-role functions).
--
--  * media_assets.provenance: who/what produced a generated file (provider, model, request key, prompt hash,
--    references, SynthID…), shown in the library; AI files get their own kinds (ai_image / ai_video / ai_audio).
--  * A per-workspace index on provenance.request_key lets the generator reuse an identical earlier result instead
--    of paying the provider twice (retries, a new run after a failure, other export formats).
--  * generation_proposal_decisions: the customer applies or rejects each generated scene asset; nothing generated
--    is ever applied to a project automatically and approved scripts are never touched.
--  * ai_provider_registry: rows for the providers selected in Milestone 10, DISABLED, not default and NOT verified
--    (verified_at stays null until the owner confirms the price). Existing rows are not modified, except that the
--    internal LIMO render/export rows become the default for the render/export stages (the FFmpeg worker exists
--    since Milestone 7); they stay disabled.

-- 1. Provenance of generated files --------------------------------------------------------------------------
alter table public.media_assets add column if not exists provenance jsonb;
alter table public.media_assets drop constraint if exists media_assets_provenance_check;
alter table public.media_assets add constraint media_assets_provenance_check
  check (provenance is null or (jsonb_typeof(provenance) = 'object' and pg_column_size(provenance) < 16384));
alter table public.media_assets drop constraint if exists media_assets_kind_check;
alter table public.media_assets add constraint media_assets_kind_check
  check (kind = any (array['product', 'logo', 'background', 'reference', 'photo', 'video', 'audio', 'render', 'design', 'other', 'ai_image', 'ai_video', 'ai_audio']));
create index if not exists media_assets_provenance_key_idx on public.media_assets (organization_id, (provenance ->> 'request_key')) where provenance is not null;

-- 2. Customer decisions on generated proposals --------------------------------------------------------------
create table if not exists public.generation_proposal_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  run_id uuid not null references public.generation_runs(id) on delete cascade,
  scene_number integer not null check (scene_number between 1 and 25),
  asset_id uuid not null references public.media_assets(id) on delete cascade,
  decision text not null check (decision in ('applied', 'rejected')),
  decided_by uuid not null,
  decided_at timestamptz not null default now(),
  unique (run_id, scene_number, asset_id)
);
create index if not exists generation_proposal_decisions_run_idx on public.generation_proposal_decisions(run_id);
alter table public.generation_proposal_decisions enable row level security;
drop policy if exists generation_proposal_decisions_read on public.generation_proposal_decisions;
create policy generation_proposal_decisions_read on public.generation_proposal_decisions for select to authenticated using (public.is_org_member(organization_id));
revoke all on public.generation_proposal_decisions from anon, authenticated;
grant select on public.generation_proposal_decisions to authenticated;
grant all on public.generation_proposal_decisions to service_role;

-- Records the customer's decision. Applying the media to the Video step is a separate, explicit save of the video
-- settings by the customer (save_video_settings validates the media again); this function changes nothing else.
create or replace function public.decide_generation_proposal(p_run_id uuid, p_scene_number integer, p_asset_id uuid, p_decision text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_run public.generation_runs%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_decision not in ('applied', 'rejected') then raise exception 'Invalid decision'; end if;
  select * into v_run from public.generation_runs where id = p_run_id;
  if not found or not public.is_org_member(v_run.organization_id) then raise exception 'Generation not found'; end if;
  if not public.can_edit_org(v_run.organization_id) then raise exception 'Not authorized'; end if;
  if not exists (
    select 1 from public.generation_run_stages s
    where s.run_id = p_run_id and s.status = 'completed'
      and (s.output_asset_id = p_asset_id
           or s.output_payload -> 'scenes' @> jsonb_build_array(jsonb_build_object('scene_number', p_scene_number, 'asset_id', p_asset_id::text)))
  ) then
    raise exception 'This file was not produced by that generation';
  end if;
  insert into public.generation_proposal_decisions(organization_id, run_id, scene_number, asset_id, decision, decided_by)
  values (v_run.organization_id, p_run_id, p_scene_number, p_asset_id, p_decision, auth.uid())
  on conflict (run_id, scene_number, asset_id) do update set decision = excluded.decision, decided_by = excluded.decided_by, decided_at = now();
  return jsonb_build_object('run_id', p_run_id, 'scene_number', p_scene_number, 'asset_id', p_asset_id, 'decision', p_decision);
end;
$$;
revoke all on function public.decide_generation_proposal(uuid, integer, uuid, text) from public, anon;
grant execute on function public.decide_generation_proposal(uuid, integer, uuid, text) to authenticated;

-- 3. Provider registry (disabled, unverified) ------------------------------------------------------------------
insert into public.ai_provider_registry(code, provider, stage_type, model_id, credential_env_key, enabled, is_default, pricing_unit, pricing_metadata, official_reference, verified_at)
values
  ('anthropic_script_v1', 'anthropic', 'script', 'claude-opus-5-5', 'ANTHROPIC_API_KEY', false, false, 'token',
   '{"researched_at":"2026-10-18","usd_per_1m_input_tokens":4,"usd_per_1m_output_tokens":20}'::jsonb, 'https://platform.claude.com/docs/en/about-claude/pricing', null),
  ('google_image_v1', 'google', 'scene_image', 'gemini-nano-banana-2.1', 'GEMINI_API_KEY', false, false, 'request',
   '{"researched_at":"2026-10-18","usd_per_image":{"1K":0.0336,"2K":0.0504,"4K":0.113},"usd_per_1m_input_tokens":1.5}'::jsonb, 'https://ai.google.dev/gemini-api/docs/pricing', null),
  ('google_character_image_v1', 'google', 'scene_image', 'gemini-3-pro-image', 'GEMINI_API_KEY', false, false, 'request',
   '{"researched_at":"2026-10-18","usd_per_image":{"1K":0.134,"2K":0.134,"4K":0.24},"usd_per_1m_input_tokens":2}'::jsonb, 'https://ai.google.dev/gemini-api/docs/pricing', null),
  ('google_video_fast_v1', 'google', 'scene_video', 'veo-3.1-fast-generate-preview', 'GEMINI_API_KEY', false, false, 'second',
   '{"researched_at":"2026-10-18","usd_per_second":{"720p":0.10,"1080p":0.12,"4k":0.30},"with_audio":true}'::jsonb, 'https://ai.google.dev/gemini-api/docs/pricing', null),
  ('google_video_lite_v1', 'google', 'scene_video', 'veo-3.1-lite-generate-preview', 'GEMINI_API_KEY', false, false, 'second',
   '{"researched_at":"2026-10-18","usd_per_second":{"720p":0.05,"1080p":0.08},"with_audio":true}'::jsonb, 'https://ai.google.dev/gemini-api/docs/pricing', null)
on conflict (code) do nothing;

update public.ai_provider_registry set is_default = false where stage_type in ('render', 'export') and code not in ('limo_render_v1', 'limo_export_v1') and is_default;
update public.ai_provider_registry set is_default = true where code in ('limo_render_v1', 'limo_export_v1');

-- 4. Availability and estimate shown to the customer BEFORE confirming (read-only) ---------------------------
-- Same formula as request_studio_generation (production function): the API refuses a request whose confirmed
-- amount differs from this estimate, so the customer always confirms exactly what will be reserved.
create or replace function public.generation_availability(p_project_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_p public.studio_projects%rowtype;
  v_policy public.generation_cost_policies%rowtype;
  v_scenes integer;
  v_seconds integer;
  v_voice_minutes integer;
  v_base bigint;
  v_ai boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_p from public.studio_projects where id = p_project_id;
  if not found or not public.is_org_member(v_p.organization_id) then raise exception 'Project not found'; end if;
  if v_p.script_status is distinct from 'approved' or v_p.approved_revision_id is null then
    return jsonb_build_object('available', false, 'reason', 'script_not_approved');
  end if;
  select count(*), coalesce(sum(duration_seconds), 0) into v_scenes, v_seconds from public.project_scenes where project_id = p_project_id;
  if v_seconds * 1000 > public.limo_video_max_duration_ms(v_p.organization_id) then
    return jsonb_build_object('available', false, 'reason', 'video_too_long');
  end if;
  select * into v_policy from public.generation_cost_policies where code = 'standard_v1';
  if not found or not v_policy.enabled or v_policy.verified_at is null then
    return jsonb_build_object('available', false, 'reason', 'not_enabled');
  end if;
  select ai_enabled into v_ai from public.organizations where id = v_p.organization_id;
  if not coalesce(v_ai, false) then return jsonb_build_object('available', false, 'reason', 'not_enabled_for_workspace'); end if;
  if v_p.status in ('queued', 'generating') then return jsonb_build_object('available', false, 'reason', 'busy'); end if;
  if v_p.status not in ('draft', 'ready') then return jsonb_build_object('available', false, 'reason', 'already_generated'); end if;
  v_voice_minutes := greatest(1, ceil(v_seconds::numeric / 60)::integer);
  v_base := v_policy.script_flat_cents::bigint + v_voice_minutes::bigint * v_policy.voice_per_minute_cents + v_scenes::bigint * v_policy.image_per_scene_cents
          + v_seconds::bigint * v_policy.video_per_second_cents + v_policy.render_flat_cents;
  return jsonb_build_object('available', true, 'reason', null, 'seconds', v_seconds, 'scenes', v_scenes,
    'estimate_cents', ceil((v_base::numeric * (100 + v_policy.retry_buffer_percent)) / 100)::integer);
end;
$$;
revoke all on function public.generation_availability(uuid) from public, anon;
grant execute on function public.generation_availability(uuid) to authenticated;
