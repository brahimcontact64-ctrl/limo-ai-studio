-- Exported read-only from live project aevqhgksniqahqrntzxv (supabase_migrations.schema_migrations).
-- Already applied in production. Do not re-run.

create table if not exists public.notification_templates (
    template_key text primary key,
    subject_template text not null,
    body_template text not null,
    active boolean not null default true,
    updated_at timestamptz not null default now()
  );
  alter table public.notification_templates enable row level security;
  revoke all on public.notification_templates from public,anon,authenticated;
  grant all on public.notification_templates to service_role;
