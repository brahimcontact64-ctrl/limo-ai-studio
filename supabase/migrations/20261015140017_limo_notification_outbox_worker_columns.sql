-- Exported read-only from live project aevqhgksniqahqrntzxv (supabase_migrations.schema_migrations).
-- Already applied in production. Do not re-run.

alter table public.notification_outbox add column if not exists locked_at timestamptz;
  alter table public.notification_outbox add column if not exists locked_by text;
  alter table public.notification_outbox add column if not exists provider_message_id text;
