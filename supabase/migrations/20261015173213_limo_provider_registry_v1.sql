-- Exported read-only from live project aevqhgksniqahqrntzxv (supabase_migrations.schema_migrations).
-- Already applied in production. Do not re-run.

create table if not exists public.ai_provider_registry (
  code text primary key,
  provider text not null,
  stage_type text not null
    check(stage_type in ('safety','script','voice','scene_video','render','export')),
  model_id text not null,
  credential_env_key text not null,
  enabled boolean not null default false,
  is_default boolean not null default false,
  pricing_unit text not null
    check(pricing_unit in ('free','token','character','second','request','internal')),
  pricing_metadata jsonb not null default '{}'::jsonb,
  official_reference text,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ai_provider_default_stage_idx
on public.ai_provider_registry(stage_type)
where is_default=true;

insert into public.ai_provider_registry(
 code,provider,stage_type,model_id,credential_env_key,enabled,is_default,
 pricing_unit,pricing_metadata,official_reference,verified_at
) values
(
 'openai_moderation_v1','openai','safety','omni-moderation-latest','OPENAI_API_KEY',
 false,true,'free',
 '{"endpoint":"/v1/moderations","accepts":["text","image"]}'::jsonb,
 'https://developers.openai.com/api/docs/guides/moderation',now()
),
(
 'openai_script_sol_v1','openai','script','gpt-6.1-sol','OPENAI_API_KEY',
 false,true,'token',
 '{"endpoint":"/v1/responses","reasoning_effort":"low"}'::jsonb,
 'https://developers.openai.com/api/docs/models',now()
),
(
 'openai_script_luna_v1','openai','script','gpt-6-luna','OPENAI_API_KEY',
 false,false,'token',
 '{"endpoint":"/v1/responses","reasoning_effort":"low","purpose":"economy_fallback"}'::jsonb,
 'https://developers.openai.com/api/docs/models/gpt-6-luna',now()
),
(
 'elevenlabs_voice_v1','elevenlabs','voice','eleven_flash_v2_5','ELEVENLABS_API_KEY',
 false,true,'character',
 '{"mode":"async_flow","endpoint":"/v1/flows/text-to-speech"}'::jsonb,
 'https://elevenlabs.io/docs/api-reference/flows/text-to-speech/create',now()
),
(
 'runway_video_standard_v1','runway','scene_video','gen4_turbo','RUNWAYML_API_SECRET',
 false,true,'second',
 '{"credits_per_second":5,"usd_per_credit":0.01,"api_version":"2024-11-06","strategy":"reference_frame_to_video"}'::jsonb,
 'https://docs.dev.runwayml.com/guides/pricing/',now()
),
(
 'runway_video_quality_v1','runway','scene_video','gen4.5','RUNWAYML_API_SECRET',
 false,false,'second',
 '{"credits_per_second":12,"usd_per_credit":0.01,"api_version":"2024-11-06","purpose":"premium_quality"}'::jsonb,
 'https://docs.dev.runwayml.com/guides/pricing/',now()
),
(
 'limo_render_v1','limo','render','ffmpeg-worker','LIMO_RENDER_WORKER',
 false,true,'internal',
 '{"purpose":"compose_scenes_audio_subtitles"}'::jsonb,
 null,now()
),
(
 'limo_export_v1','limo','export','ffmpeg-smart-reframe','LIMO_RENDER_WORKER',
 false,true,'internal',
 '{"purpose":"platform_presets_downloads"}'::jsonb,
 null,now()
)
on conflict(code) do update set
  provider=excluded.provider,
  stage_type=excluded.stage_type,
  model_id=excluded.model_id,
  credential_env_key=excluded.credential_env_key,
  pricing_unit=excluded.pricing_unit,
  pricing_metadata=excluded.pricing_metadata,
  official_reference=excluded.official_reference,
  verified_at=excluded.verified_at,
  updated_at=now();

alter table public.ai_provider_registry enable row level security;
revoke all on public.ai_provider_registry from public,anon,authenticated;
grant all on public.ai_provider_registry to service_role;

alter table public.generation_runs
  add column if not exists provider_snapshot jsonb not null default '{}'::jsonb;

create or replace function public.get_generation_provider_snapshot()
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  select coalesce(
    jsonb_object_agg(
      p.stage_type,
      jsonb_build_object(
        'code',p.code,
        'provider',p.provider,
        'model_id',p.model_id,
        'pricing_unit',p.pricing_unit,
        'pricing_metadata',p.pricing_metadata
      )
    ),
    '{}'::jsonb
  )
  from public.ai_provider_registry p
  where p.enabled=true and p.is_default=true;
$$;

revoke all on function public.get_generation_provider_snapshot() from public,anon,authenticated;
grant execute on function public.get_generation_provider_snapshot() to service_role;
