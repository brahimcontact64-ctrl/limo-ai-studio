-- Rollback of 20261017090000_limo_admin_hardening_v1. Subscription changes already made through
-- admin_set_subscription stay (they are audited in platform_audit_events).
drop function if exists public.admin_set_subscription(uuid, text, text, integer, text);
drop function if exists public.admin_list_workspaces();
drop function if exists public.admin_set_feature_flag(text, boolean);
drop policy if exists provider_registry_admin_read on public.ai_provider_registry;
drop policy if exists feature_flags_read on public.feature_flags;
drop table if exists public.feature_flags;
