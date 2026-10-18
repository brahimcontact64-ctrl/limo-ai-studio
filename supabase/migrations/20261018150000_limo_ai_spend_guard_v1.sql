-- LIMO AI spend guard v1 (safeguards for the $10 internal AI pilot).
-- Status: PENDING OWNER APPROVAL for production (13th pending migration). Additive.
-- Depends on 20261016150000 (is_platform_admin_mfa, platform_audit_events) and 20261018120000 (AI registry rows).
--
-- An application-level hard limit on provider spend, independent of workspace budgets:
--   * ai_spend_guards: one row per scope (e.g. 'pilot'): total limit, per-operation maximum, per-bucket caps
--     (text / image / video / voice), running reserved + spent totals and the kill switch (enabled = false).
--   * ai_spend_entries: one row per provider operation key (unique per scope): reserved → settled | released.
--   * ai_spend_reserve (service role): locks the scope row (FOR UPDATE), so concurrent workers are serialised and
--     can never reserve more than the limit together; refuses unknown/zero amounts, repeated keys, retries without
--     approval, and anything above the operation, bucket or total limit.
--   * ai_spend_settle / ai_spend_release (service role): close a reservation at the actual cost, or release it when
--     the provider provably did not bill. Reaching the total limit switches the scope off automatically.
--   * admin_set_ai_spend_guard (platform admin with MFA, audited): the owner's kill switch; ai_spend_reconcile
--     (service role) corrects a settled amount after checking the provider's usage page.
-- Also adds two DISABLED, UNVERIFIED registry rows used by the pilot: Gemini TTS (voice) and Claude (safety review).
-- The pilot scope is created DISABLED: enabling it is an explicit owner action.

-- 1. Tables -------------------------------------------------------------------------------------------------------
create table if not exists public.ai_spend_guards (
  scope text primary key check (scope ~ '^[a-z0-9_-]{1,40}$'),
  enabled boolean not null default false,
  limit_cents integer not null check (limit_cents between 0 and 100000),
  max_operation_cents integer not null check (max_operation_cents between 1 and 100000),
  bucket_caps jsonb not null default '{}'::jsonb check (jsonb_typeof(bucket_caps) = 'object'),
  reserved_cents integer not null default 0 check (reserved_cents >= 0),
  spent_cents integer not null default 0 check (spent_cents >= 0),
  note text,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table if not exists public.ai_spend_entries (
  id uuid primary key default gen_random_uuid(),
  scope text not null references public.ai_spend_guards(scope) on delete restrict,
  op_key text not null check (char_length(op_key) between 1 and 200),
  capability text not null,
  bucket text not null check (bucket in ('text', 'image', 'video', 'voice')),
  provider text not null,
  model text not null,
  organization_id uuid,
  status text not null check (status in ('reserved', 'settled', 'released')),
  reserved_cents integer not null check (reserved_cents > 0),
  actual_cents integer check (actual_cents >= 0),
  needs_reconciliation boolean not null default false,
  provider_request_id text,
  note text,
  attempts integer not null default 1,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (scope, op_key)
);
create index if not exists ai_spend_entries_scope_status_idx on public.ai_spend_entries(scope, status);

alter table public.ai_spend_guards enable row level security;
alter table public.ai_spend_entries enable row level security;
revoke all on public.ai_spend_guards from anon, authenticated;
revoke all on public.ai_spend_entries from anon, authenticated;
grant all on public.ai_spend_guards to service_role;
grant all on public.ai_spend_entries to service_role;

-- 2. Capability → bucket (same mapping as lib/providers/spend.ts) ----------------------------------------------------
create or replace function public.ai_spend_bucket(p_capability text)
returns text language sql immutable set search_path = '' as $$
  select case p_capability
    when 'text' then 'text' when 'story' then 'text' when 'translation' then 'text' when 'safety' then 'text'
    when 'image' then 'image' when 'character_image' then 'image'
    when 'video' then 'video'
    when 'voice' then 'voice' when 'transcription' then 'voice'
  end
$$;

-- 3. Reserve -------------------------------------------------------------------------------------------------------
create or replace function public.ai_spend_reserve(p_scope text, p_op_key text, p_capability text, p_provider text, p_model text,
                                                   p_organization_id uuid, p_cents integer, p_retry_approved boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  g public.ai_spend_guards%rowtype;
  e public.ai_spend_entries%rowtype;
  v_bucket text := public.ai_spend_bucket(p_capability);
  v_used integer;
  v_refuse text;
begin
  select * into g from public.ai_spend_guards where scope = p_scope for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_guard'); end if;
  select * into e from public.ai_spend_entries where scope = p_scope and op_key = p_op_key for update;
  v_refuse := case
    when not g.enabled then 'kill_switch'
    when p_cents is null or p_cents <= 0 then 'invalid_amount'
    when p_op_key is null or char_length(p_op_key) not between 1 and 200 then 'invalid_operation'
    when e.id is not null and e.status = 'reserved' then 'already_reserved'
    when e.id is not null and e.status = 'settled' then 'already_settled'
    when e.id is not null and not coalesce(p_retry_approved, false) then 'retry_requires_approval'
    when p_cents > g.max_operation_cents then 'operation_cap'
    when v_bucket is null or not (g.bucket_caps ? v_bucket) then 'bucket_not_allowed'
  end;
  if v_refuse is null then
    select coalesce(sum(case status when 'reserved' then reserved_cents when 'settled' then actual_cents else 0 end), 0)::integer into v_used
      from public.ai_spend_entries where scope = p_scope and bucket = v_bucket;
    v_refuse := case
      when v_used + p_cents > (g.bucket_caps ->> v_bucket)::integer then 'bucket_cap'
      when g.reserved_cents + g.spent_cents + p_cents > g.limit_cents then 'budget_exceeded'
    end;
  end if;
  if v_refuse is not null then return jsonb_build_object('ok', false, 'reason', v_refuse); end if;

  if e.id is null then
    insert into public.ai_spend_entries(scope, op_key, capability, bucket, provider, model, organization_id, status, reserved_cents)
    values (p_scope, p_op_key, p_capability, v_bucket, left(p_provider, 80), left(p_model, 120), p_organization_id, 'reserved', p_cents);
  else
    update public.ai_spend_entries set status = 'reserved', reserved_cents = p_cents, actual_cents = null, closed_at = null,
      attempts = attempts + 1, note = 'retry approved' where id = e.id;
  end if;
  update public.ai_spend_guards set reserved_cents = reserved_cents + p_cents, updated_at = now() where scope = p_scope;
  return jsonb_build_object('ok', true, 'reserved_cents', p_cents, 'remaining_cents', g.limit_cents - g.reserved_cents - g.spent_cents - p_cents);
end;
$$;

-- 4. Settle (actual cost; null = the full reservation, outcome unknown) ---------------------------------------------
create or replace function public.ai_spend_settle(p_scope text, p_op_key text, p_actual_cents integer, p_provider_request_id text default null,
                                                  p_needs_reconciliation boolean default false, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  g public.ai_spend_guards%rowtype;
  e public.ai_spend_entries%rowtype;
  v_actual integer;
begin
  select * into g from public.ai_spend_guards where scope = p_scope for update;
  if not found then raise exception 'Unknown spend scope'; end if;
  select * into e from public.ai_spend_entries where scope = p_scope and op_key = p_op_key for update;
  if not found then raise exception 'Unknown spend operation'; end if;
  if e.status = 'settled' then return jsonb_build_object('ok', true, 'already', true, 'actual_cents', e.actual_cents); end if;
  if e.status <> 'reserved' then raise exception 'Spend operation is not reserved'; end if;
  if p_actual_cents is not null and p_actual_cents < 0 then raise exception 'Invalid amount'; end if;
  v_actual := coalesce(p_actual_cents, e.reserved_cents);
  update public.ai_spend_entries set status = 'settled', actual_cents = v_actual, closed_at = now(),
    provider_request_id = left(p_provider_request_id, 200), note = left(p_note, 200),
    needs_reconciliation = p_actual_cents is null or coalesce(p_needs_reconciliation, false)
  where id = e.id;
  update public.ai_spend_guards set reserved_cents = greatest(0, reserved_cents - e.reserved_cents), spent_cents = spent_cents + v_actual,
    -- The total limit is a hard stop: once spent, the scope switches itself off.
    enabled = enabled and spent_cents + v_actual < limit_cents,
    note = case when spent_cents + v_actual >= limit_cents then 'limit reached ' || now()::text else note end,
    updated_at = now()
  where scope = p_scope;
  return jsonb_build_object('ok', true, 'actual_cents', v_actual, 'over_reservation', v_actual > e.reserved_cents);
end;
$$;

-- 5. Release (the provider provably did not bill) -------------------------------------------------------------------
create or replace function public.ai_spend_release(p_scope text, p_op_key text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  e public.ai_spend_entries%rowtype;
begin
  perform 1 from public.ai_spend_guards where scope = p_scope for update;
  select * into e from public.ai_spend_entries where scope = p_scope and op_key = p_op_key for update;
  if not found or e.status <> 'reserved' then return jsonb_build_object('ok', true, 'changed', false); end if;
  update public.ai_spend_entries set status = 'released', closed_at = now(), note = left(p_reason, 200) where id = e.id;
  update public.ai_spend_guards set reserved_cents = greatest(0, reserved_cents - e.reserved_cents), updated_at = now() where scope = p_scope;
  return jsonb_build_object('ok', true, 'changed', true);
end;
$$;

-- 6. Reconcile a settled amount with the provider's usage page (service role, by the owner) ------------------------
create or replace function public.ai_spend_reconcile(p_scope text, p_op_key text, p_actual_cents integer, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  e public.ai_spend_entries%rowtype;
begin
  if p_actual_cents is null or p_actual_cents < 0 then raise exception 'Invalid amount'; end if;
  if nullif(btrim(coalesce(p_note, '')), '') is null then raise exception 'A note (provider usage reference) is required'; end if;
  perform 1 from public.ai_spend_guards where scope = p_scope for update;
  select * into e from public.ai_spend_entries where scope = p_scope and op_key = p_op_key for update;
  if not found or e.status <> 'settled' then raise exception 'Only settled operations can be reconciled'; end if;
  update public.ai_spend_entries set actual_cents = p_actual_cents, needs_reconciliation = false, note = left('reconciled: ' || p_note, 200) where id = e.id;
  update public.ai_spend_guards set spent_cents = greatest(0, spent_cents - e.actual_cents + p_actual_cents), updated_at = now() where scope = p_scope;
  return jsonb_build_object('ok', true, 'before', e.actual_cents, 'after', p_actual_cents);
end;
$$;

-- 7. Owner kill switch (platform admin with MFA, audited) ---------------------------------------------------------
create or replace function public.admin_set_ai_spend_guard(p_scope text, p_enabled boolean, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  g public.ai_spend_guards%rowtype;
begin
  if not public.is_platform_admin_mfa() then raise exception 'Not authorized: platform admin with two-factor authentication required'; end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'A reason is required'; end if;
  select * into g from public.ai_spend_guards where scope = p_scope for update;
  if not found then raise exception 'Unknown spend scope'; end if;
  if p_enabled and g.spent_cents >= g.limit_cents then raise exception 'The spend limit is reached; raise it explicitly first'; end if;
  update public.ai_spend_guards set enabled = p_enabled, updated_at = now(), updated_by = auth.uid(), note = left(p_reason, 500) where scope = p_scope;
  insert into public.platform_audit_events(organization_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (null, auth.uid(), 'ai_spend_guard.updated', 'ai_spend_guard', null,
          jsonb_build_object('scope', p_scope, 'enabled', p_enabled, 'reason', left(btrim(p_reason), 500), 'spent_cents', g.spent_cents, 'reserved_cents', g.reserved_cents));
  return jsonb_build_object('ok', true, 'scope', p_scope, 'enabled', p_enabled);
end;
$$;

revoke all on function public.ai_spend_reserve(text, text, text, text, text, uuid, integer, boolean) from public, anon, authenticated;
revoke all on function public.ai_spend_settle(text, text, integer, text, boolean, text) from public, anon, authenticated;
revoke all on function public.ai_spend_release(text, text, text) from public, anon, authenticated;
revoke all on function public.ai_spend_reconcile(text, text, integer, text) from public, anon, authenticated;
grant execute on function public.ai_spend_reserve(text, text, text, text, text, uuid, integer, boolean) to service_role;
grant execute on function public.ai_spend_settle(text, text, integer, text, boolean, text) to service_role;
grant execute on function public.ai_spend_release(text, text, text) to service_role;
grant execute on function public.ai_spend_reconcile(text, text, integer, text) to service_role;
revoke all on function public.admin_set_ai_spend_guard(text, boolean, text) from public, anon;
grant execute on function public.admin_set_ai_spend_guard(text, boolean, text) to authenticated;

-- 8. Pilot scope: $10 total, $1 per operation, text $2 / images $2 / video $3 / voice $1 (contingency $2). OFF. ------
insert into public.ai_spend_guards(scope, enabled, limit_cents, max_operation_cents, bucket_caps, note)
values ('pilot', false, 1000, 100, '{"text":200,"image":200,"video":300,"voice":100}'::jsonb, 'Internal $10 AI pilot; enabling requires owner approval')
on conflict (scope) do nothing;

-- 9. Pilot registry rows (DISABLED, not default, NOT verified) ------------------------------------------------------
insert into public.ai_provider_registry(code, provider, stage_type, model_id, credential_env_key, enabled, is_default, pricing_unit, pricing_metadata, official_reference, verified_at)
values
  ('google_tts_v1', 'google', 'voice', 'gemini-3.8-flash-tts', 'GEMINI_API_KEY', false, false, 'token',
   '{"researched_at":"2026-10-18","usd_per_1m_input_tokens":0.5,"usd_per_1m_output_tokens":9,"price_valid_until":"2026-12-31"}'::jsonb, 'https://ai.google.dev/gemini-api/docs/pricing', null),
  ('anthropic_safety_v1', 'anthropic', 'safety', 'claude-opus-5-5', 'ANTHROPIC_API_KEY', false, false, 'token',
   '{"researched_at":"2026-10-18","usd_per_1m_input_tokens":4,"usd_per_1m_output_tokens":20}'::jsonb, 'https://platform.claude.com/docs/en/about-claude/pricing', null)
on conflict (code) do nothing;
