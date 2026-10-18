-- AI spend guard rules (migration 20261018150000). LOCAL stack only; one transaction that is always rolled back.
-- Usage: docker exec -i <db container> psql -U postgres -q < scripts/sql/ai-spend-guard-test.sql
-- Concurrency across real sessions: scripts/sql/ai-spend-guard-concurrency.sh
begin;
do $$
declare
  r jsonb;
  ok boolean;
  reason text;
  g public.ai_spend_guards%rowtype;
begin
  insert into public.ai_spend_guards(scope, enabled, limit_cents, max_operation_cents, bucket_caps)
  values ('sqltest', true, 1000, 100, '{"text":200,"image":200,"video":300,"voice":100}');

  raise notice 'GUARD pilot scope seeded disabled: %', (select not enabled and limit_cents = 1000 from public.ai_spend_guards where scope = 'pilot');
  raise notice 'GUARD unknown scope refused: %', (public.ai_spend_reserve('nope', 'a', 'text', 'p', 'm', null, 1)->>'reason') = 'no_guard';
  raise notice 'GUARD zero/unknown amount refused: %', (public.ai_spend_reserve('sqltest', 'a', 'text', 'p', 'm', null, 0)->>'reason') = 'invalid_amount'
    and (public.ai_spend_reserve('sqltest', 'a', 'text', 'p', 'm', null, null)->>'reason') = 'invalid_amount';
  raise notice 'GUARD operation cap: %', (public.ai_spend_reserve('sqltest', 'a', 'text', 'p', 'm', null, 101)->>'reason') = 'operation_cap';
  raise notice 'GUARD unmapped capability refused: %', (public.ai_spend_reserve('sqltest', 'a', 'telepathy', 'p', 'm', null, 1)->>'reason') = 'bucket_not_allowed';

  r := public.ai_spend_reserve('sqltest', 'a', 'text', 'anthropic', 'claude-opus-5-5', null, 100);
  raise notice 'GUARD reserve ok: %', (r->>'ok')::boolean and (r->>'remaining_cents')::int = 900;
  raise notice 'GUARD duplicate in flight refused: %', (public.ai_spend_reserve('sqltest', 'a', 'text', 'p', 'm', null, 1)->>'reason') = 'already_reserved';
  perform public.ai_spend_reserve('sqltest', 'b', 'translation', 'p', 'm', null, 100);
  raise notice 'GUARD bucket cap (text = text + translation + safety): %', (public.ai_spend_reserve('sqltest', 'c', 'safety', 'p', 'm', null, 1)->>'reason') = 'bucket_cap';

  r := public.ai_spend_settle('sqltest', 'a', 40, 'req_1');
  raise notice 'GUARD settle at actual: %', (r->>'actual_cents')::int = 40 and (select spent_cents = 40 and reserved_cents = 100 from public.ai_spend_guards where scope = 'sqltest');
  raise notice 'GUARD settle is idempotent: %', (public.ai_spend_settle('sqltest', 'a', 99)->>'already')::boolean and (select spent_cents = 40 from public.ai_spend_guards where scope = 'sqltest');
  raise notice 'GUARD settled key never re-sent: %', (public.ai_spend_reserve('sqltest', 'a', 'text', 'p', 'm', null, 1)->>'reason') = 'already_settled';
  perform public.ai_spend_release('sqltest', 'b', 'auth');
  raise notice 'GUARD release frees the reservation: %', (select reserved_cents = 0 from public.ai_spend_guards where scope = 'sqltest');
  -- One call per statement: the evaluation order inside a single expression is not guaranteed.
  reason := public.ai_spend_reserve('sqltest', 'b', 'text', 'p', 'm', null, 10)->>'reason';
  ok := (public.ai_spend_reserve('sqltest', 'b', 'text', 'p', 'm', null, 10, true)->>'ok')::boolean;
  raise notice 'GUARD retry needs approval: %', reason = 'retry_requires_approval' and ok
    and (select attempts = 2 from public.ai_spend_entries where scope = 'sqltest' and op_key = 'b');
  r := public.ai_spend_settle('sqltest', 'b', null);
  raise notice 'GUARD unknown outcome charged at reservation + reconcile flag: %', (r->>'actual_cents')::int = 10
    and (select needs_reconciliation from public.ai_spend_entries where scope = 'sqltest' and op_key = 'b');
  perform public.ai_spend_reconcile('sqltest', 'b', 3, 'provider usage page 2026-10-18');
  raise notice 'GUARD reconcile corrects spent: %', (select spent_cents = 43 from public.ai_spend_guards where scope = 'sqltest')
    and not (select needs_reconciliation from public.ai_spend_entries where scope = 'sqltest' and op_key = 'b');

  -- Fill video (3 × 100) and check the total limit with an over-run absorbed by the contingency.
  perform public.ai_spend_reserve('sqltest', 'v' || i, 'video', 'google', 'veo', null, 100) from generate_series(1, 3) i;
  raise notice 'GUARD video bucket full: %', (public.ai_spend_reserve('sqltest', 'v4', 'video', 'p', 'm', null, 1)->>'reason') = 'bucket_cap';
  perform public.ai_spend_reserve('sqltest', 'i' || i, 'image', 'google', 'img', null, 100) from generate_series(1, 2) i;
  perform public.ai_spend_reserve('sqltest', 's1', 'voice', 'google', 'tts', null, 100);
  perform public.ai_spend_settle('sqltest', 'v1', 420);  -- provider charged more than reserved
  select * into g from public.ai_spend_guards where scope = 'sqltest';
  raise notice 'GUARD over-run recorded: % (spent %, reserved %)', g.spent_cents = 463 and g.reserved_cents = 500, g.spent_cents, g.reserved_cents;
  raise notice 'GUARD total limit refuses: %', (public.ai_spend_reserve('sqltest', 't9', 'text', 'p', 'm', null, 50)->>'reason') = 'budget_exceeded';
  -- 463 + 100 + 100 + 100 + 100 + 137 = 1000 ¢: the limit is reached exactly.
  perform public.ai_spend_settle('sqltest', k, 100) from unnest(array['v2', 'v3', 'i1', 'i2']) k;
  perform public.ai_spend_settle('sqltest', 's1', 137);
  raise notice 'GUARD limit reached switches the scope off: %', (select not enabled and spent_cents >= limit_cents from public.ai_spend_guards where scope = 'sqltest');
  raise notice 'GUARD kill switch refuses: %', (public.ai_spend_reserve('sqltest', 'z', 'voice', 'p', 'm', null, 1)->>'reason') = 'kill_switch';

  ok := false;
  begin
    perform public.admin_set_ai_spend_guard('sqltest', true, 'test');
  exception when others then ok := sqlerrm like 'Not authorized%'; end;
  raise notice 'GUARD admin switch needs platform admin with MFA: %', ok;
end $$;

-- Customers (authenticated) can neither call the service functions nor read the ledger.
set local role authenticated;
do $$
declare ok boolean := false; n int;
begin
  begin
    perform public.ai_spend_reserve('sqltest', 'x', 'text', 'p', 'm', null, 1);
  exception when insufficient_privilege then ok := true; end;
  raise notice 'GUARD reserve not callable by customers: %', ok;
  ok := false;
  begin
    select count(*) into n from public.ai_spend_entries;
  exception when insufficient_privilege then ok := true; end;
  raise notice 'GUARD ledger not readable by customers: %', ok;
end $$;
rollback;
