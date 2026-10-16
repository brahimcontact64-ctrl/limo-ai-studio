-- Exported read-only from live project aevqhgksniqahqrntzxv (supabase_migrations.schema_migrations).
-- Already applied in production. Do not re-run.

update public.ai_provider_registry
set is_default=false,updated_at=now()
where stage_type in ('render','export') and is_default=true;

insert into public.ai_provider_registry(
 code,provider,stage_type,model_id,credential_env_key,enabled,is_default,
 pricing_unit,pricing_metadata,official_reference,verified_at
) values
(
 'shotstack_render_v1',
 'shotstack',
 'render',
 'edit-api',
 'SHOTSTACK_API_KEY',
 false,
 true,
 'second',
 '{"payg_cents_per_minute":20,"sandbox_render_free":true,"sandbox":"stage","production":"v1"}'::jsonb,
 'https://shotstack.io/pricing/',
 now()
),
(
 'shotstack_export_v1',
 'shotstack',
 'export',
 'edit-api-reframe',
 'SHOTSTACK_API_KEY',
 false,
 true,
 'second',
 '{"payg_cents_per_minute":20,"sandbox_render_free":true,"mode":"platform_reframe_v1"}'::jsonb,
 'https://shotstack.io/pricing/',
 now()
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
 is_default=true,
 updated_at=now();
