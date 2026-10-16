-- Exported read-only from live project aevqhgksniqahqrntzxv (supabase_migrations.schema_migrations).
-- Already applied in production. Do not re-run.

drop policy if exists payment_method_authenticated_read on public.payment_method_settings;
create policy payment_method_authenticated_read on public.payment_method_settings
for select to authenticated
using (enabled = true or public.is_platform_admin());
