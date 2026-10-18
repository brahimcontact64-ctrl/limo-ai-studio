-- Rollback of 20261018150000_limo_ai_spend_guard_v1 (AI spend guard for the $10 pilot).
-- Drops the guard and its ledger (export ai_spend_entries first if any real call was ever made: it is the
-- record of provider spend) and removes the two pilot registry rows.
drop function if exists public.admin_set_ai_spend_guard(text, boolean, text);
drop function if exists public.ai_spend_reconcile(text, text, integer, text);
drop function if exists public.ai_spend_release(text, text, text);
drop function if exists public.ai_spend_settle(text, text, integer, text, boolean, text);
drop function if exists public.ai_spend_reserve(text, text, text, text, text, uuid, integer, boolean);
drop function if exists public.ai_spend_bucket(text);
drop table if exists public.ai_spend_entries;
drop table if exists public.ai_spend_guards;
delete from public.ai_provider_registry where code in ('google_tts_v1', 'anthropic_safety_v1');
