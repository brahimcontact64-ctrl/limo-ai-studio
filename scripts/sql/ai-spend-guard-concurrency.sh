#!/usr/bin/env bash
# Concurrency test of the AI spend guard (migration 20261018150000) with REAL parallel database sessions.
# 20 sessions each try to reserve $1 for a different operation against a $10 scope at the same moment:
# exactly 10 must succeed, the reserved total must be exactly $10, and the same operation key reserved by 5
# sessions at once must succeed exactly once. LOCAL stack only; the test scope is removed at the end.
# Usage: scripts/sql/ai-spend-guard-concurrency.sh <local db container>   (never point this at production)
set -euo pipefail
DB="${1:?local database container name}"
case "$DB" in *prod*|*aevqhgksniqahqrntzxv*) echo "refusing: not a local container"; exit 2;; esac
psqlq() { docker exec -i "$DB" psql -U postgres -v ON_ERROR_STOP=1 -q -At "$@"; }
cleanup() { psqlq -c "delete from public.ai_spend_entries where scope in ('conctest', 'conckey'); delete from public.ai_spend_guards where scope in ('conctest', 'conckey');" >/dev/null; }
trap cleanup EXIT
cleanup
psqlq -c "insert into public.ai_spend_guards(scope, enabled, limit_cents, max_operation_cents, bucket_caps) values ('conctest', true, 1000, 100, '{\"video\":2000}'), ('conckey', true, 1000, 100, '{\"text\":1000}');"
OUT="$(mktemp -d)"
# Each session waits until a shared start time so the 20 calls overlap.
START=$(( $(date +%s) + 3 ))
for i in $(seq 1 20); do
  ( psqlq -c "select pg_sleep(greatest(0, $START - extract(epoch from clock_timestamp()))); select coalesce(public.ai_spend_reserve('conctest', 'op-$i', 'video', 'google', 'veo', null, 100)->>'ok', 'error');" | tail -1 > "$OUT/$i" ) &
done
for i in $(seq 1 5); do
  ( psqlq -c "select pg_sleep(greatest(0, $START - extract(epoch from clock_timestamp()))); select coalesce(public.ai_spend_reserve('conckey', 'same-key', 'text', 'anthropic', 'claude', null, 1)->>'ok', 'error');" | tail -1 > "$OUT/same-$i" ) &
done
wait
OK=$(cat "$OUT"/[0-9]* | grep -c '^true$' || true)
SAME=$(cat "$OUT"/same-* | grep -c '^true$' || true)
TOTALS=$(psqlq -c "select reserved_cents || '/' || (select count(*) from public.ai_spend_entries where scope = 'conctest' and status = 'reserved') from public.ai_spend_guards where scope = 'conctest';")
rm -rf "$OUT"
echo "CONCURRENCY parallel \$1 reservations accepted: $OK of 20 (expected 10)"
echo "CONCURRENCY same operation key accepted: $SAME of 5 (expected 1)"
echo "CONCURRENCY reserved cents / open entries: $TOTALS"
if [ "$OK" = "10" ] && [ "$SAME" = "1" ] && [ "$TOTALS" = "1000/10" ]; then
  echo "CONCURRENCY PASS"
else
  echo "CONCURRENCY FAIL"; exit 1
fi
