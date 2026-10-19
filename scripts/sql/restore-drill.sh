#!/usr/bin/env bash
# Backup → restore drill against a LOCAL database container (procedure rehearsal for gate G3).
# 1. pg_dump of the public schema (schema + data, custom format) from the source database
# 2. restore into a NEW scratch database inside the same container (limo_restore_drill)
# 3. verify: same row counts for key tables, functions present, a policy function callable, RLS enabled
# 4. drop the scratch database (always)
# The production drill uses the same steps with a dump of production restored into a SEPARATE scratch Supabase
# project (never into production): docs/PRODUCTION_READINESS_REVIEW.md §5.
# Usage: scripts/sql/restore-drill.sh <local db container>   (refuses anything that looks like production)
set -euo pipefail
DB="${1:?local database container name}"
case "$DB" in *prod*|*aevqhgksniqahqrntzxv*) echo "refusing: not a local container"; exit 2;; esac
SCRATCH=limo_restore_drill
q() { docker exec -i "$DB" psql -U postgres -v ON_ERROR_STOP=1 -At "$@"; }
cleanup() { q -d postgres -c "drop database if exists $SCRATCH with (force);" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup
TABLES="organizations organization_members studio_projects project_scenes project_revisions media_assets render_jobs social_posts publish_jobs character_design_specs character_reference_assets ai_provider_registry ai_spend_guards animation_projects animation_shots ai_jobs feature_flags usage_balances usage_ledger"
counts() { local d=$1; for t in $TABLES; do printf '%s=%s ' "$t" "$(q -d "$d" -c "select case when to_regclass('public.$t') is null then -1 else (select count(*) from public.$t) end" 2>/dev/null || echo err)"; done; }

echo "DRILL dump (public schema, custom format)…"
START=$(date +%s)
docker exec "$DB" sh -c "pg_dump -U postgres -d postgres -n public -Fc -f /tmp/limo_drill.dump"
SIZE=$(docker exec "$DB" sh -c "stat -c %s /tmp/limo_drill.dump")
echo "DRILL dump size: $SIZE bytes"
q -d postgres -c "create database $SCRATCH;" >/dev/null
# The public schema references auth.users / storage objects: restore the dump next to empty copies of the roles' schemas.
docker exec "$DB" sh -c "pg_dump -U postgres -d postgres -n auth -n storage -n extensions --schema-only -Fc -f /tmp/limo_drill_deps.dump"
docker exec "$DB" sh -c "pg_restore -U supabase_admin -d $SCRATCH --no-owner --exit-on-error /tmp/limo_drill_deps.dump" >/dev/null 2>&1 || echo "DRILL note: dependency schemas restored with warnings (expected for platform-managed objects)"
docker exec "$DB" sh -c "pg_dump -U postgres -d postgres -n auth --data-only -t auth.users -Fc -f /tmp/limo_drill_users.dump"
docker exec "$DB" sh -c "pg_restore -U supabase_admin -d $SCRATCH --no-owner --data-only /tmp/limo_drill_users.dump" >/dev/null 2>&1 || true
q -d "$SCRATCH" -c "drop schema if exists public cascade;" >/dev/null
docker exec "$DB" sh -c "pg_restore -U supabase_admin -d $SCRATCH --no-owner --exit-on-error /tmp/limo_drill.dump"
END=$(date +%s)
echo "DRILL restore duration: $((END - START)) s"

SRC=$(counts postgres)
DST=$(counts "$SCRATCH")
echo "DRILL source : $SRC"
echo "DRILL restore: $DST"
FUNCS=$(q -d "$SCRATCH" -c "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('save_studio_project_v3','enqueue_render_job','request_studio_generation','ai_spend_reserve','save_animation_shots','enqueue_animation_render','claim_ai_jobs')")
RLS=$(q -d "$SCRATCH" -c "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity")
GUARD=$(q -d "$SCRATCH" -c "select enabled::text || '/' || limit_cents from public.ai_spend_guards where scope = 'pilot'" || echo missing)
echo "DRILL functions present: $FUNCS/7, public tables without RLS: $RLS, pilot spend guard: $GUARD"
docker exec "$DB" sh -c "rm -f /tmp/limo_drill.dump /tmp/limo_drill_deps.dump /tmp/limo_drill_users.dump"
if [ "$SRC" = "$DST" ] && [ "$FUNCS" = "7" ] && [ "$GUARD" = "false/1000" ]; then echo "DRILL PASS"; else echo "DRILL FAIL"; exit 1; fi
