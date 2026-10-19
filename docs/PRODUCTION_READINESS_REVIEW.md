# Production readiness review (rechecked 2026-10-19, quality gate)

Review and procedures only — nothing in production was changed. Production Supabase `aevqhgksniqahqrntzxv` has 50
migrations (last `20261016120000`); **14 are pending** (MIGRATION_REVIEW.md). Vercel production is an older deploy that
predates `rebuild/v1`; `origin/main` is `2a3f426` (untouched).

## 1. Verdict
**Not ready for paying customers.** The code is verified on the local replica; the blockers are operational decisions
and infrastructure only the owner can provide (backups/restore on production, hosting, email, payments, providers).

## 2. Pending migrations (in order) and how each is verified
| # | Migration | Local verification |
|---|---|---|
| 1–11 | rate limits … V1 video policy | backend e2e (224), render (72), publish (63), SQL tests, rollback dry run |
| 12 | `20261018120000_limo_ai_generation_v1` | generate e2e (24), browser AI spec |
| 13 | `20261018150000_limo_ai_spend_guard_v1` | `ai-spend-guard-test.sql` (23), 20-session concurrency test |
| 14 | `20261019090000_limo_animation_studio_v1` | `animation-studio-test.sql` (37), animation e2e (15), browser spec, render e2e with nullable `render_jobs.project_id` |
All 14 rollback scripts are dry-run in one transaction (`scripts/sql/rollback-dry-run.sh`). Behaviour changes to review
before G1: #2 payments via `submit_payment`; #5 approved scripts read-only; #6/#7/#10 direct client writes replaced by
functions; #11 30 s and credit rules; #14 `render_jobs.project_id` / `script_revision_id` nullable for animation exports
(check constraint keeps every studio export complete).

## 3. Blockers
| Area | State | Needed | Gate |
|---|---|---|---|
| Backups + real restore | procedure rehearsed locally (§5); production not done | confirm PITR/backup tier, dump production, restore into a scratch project, run the checks | G2, G3 |
| Migrations | 14 pending, verified locally | written approval, window, run in order, verify flags off | G1, G7, G9 |
| App promotion | `rebuild/v1` not deployed | approval; check the old deploy's direct writes | G4, G8 |
| Workers (render, publisher, generator) | images/examples prepared, nothing hosted | §6 | W1–W7 |
| Monitoring and alerts | health endpoints + SQL queries exist; nothing connected | §7 | W6 |
| Auth and email | email confirmation on; built-in sender only reaches team addresses | §8 | NEXT_STEPS blockers 2–3 |
| Payments and subscriptions | manual payment flow built; no real destinations | §9 | G10 |
| AI providers | all disabled; prices unverified; spend guard + job queue ready | AI_PILOT_PLAN.md | — |
| Facebook | mock publisher only | Meta app review | W8 |

## 4. Recommended order
G2/G3 restore drill → G1 migrations in a window → G9 flags verified off → W1–W7 workers → G8 app promotion →
monitoring → auth/SMTP → payments → (separately) the AI pilot on the local replica, then production AI decisions.

## 5. Backup and restore test procedure
Rehearsal (done 2026-10-19 on the local replica): `scripts/sql/restore-drill.sh <local db container>` — `pg_dump -Fc`
of `public` (2.0 MB), restore into a new scratch database (dependency schemas + `auth.users` first; platform-managed
objects restore with warnings), then checks: identical row counts for 19 key tables, 7 key functions present, every
public table has RLS, pilot spend guard intact; scratch database dropped. Result: **PASS**, 8 s end to end; re-run at the quality gate: PASS (19 table counts identical, 7/7 functions, RLS on every public table).
Production drill (owner, before G1): (1) note the backup tier and PITR window in the dashboard; (2)
`supabase db dump --linked` (schema) and `--data-only` (data) to an encrypted location outside Git; (3) create a
**separate scratch Supabase project**, restore schema then data; (4) run the same checks (row counts against
production, functions, RLS, a sign-in with a test account); (5) record time to restore and any manual step; (6) delete
the scratch project. Never restore into production.

## 6. Worker hosting configuration
| Worker | Image | Env (secrets in the host's secret store) | Health | Resources |
|---|---|---|---|---|
| render | `worker/Dockerfile` | SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WORKER_ID, LEASE_SECONDS, RENDER_TMP, HEALTH_PORT | `/livez`, `/healthz` | 2 vCPU / 2 GB, temp disk ≥ 5 GB |
| publisher | `worker/Dockerfile.publisher` | SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WORKER_ID, HEALTH_PORT (Facebook live off) | same | 0.25 vCPU / 256 MB |
| generator (AI pipeline + `ai_jobs`) | `worker/Dockerfile.generator` | SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, LIMO_GENERATION_MODE (off), LIMO_ENABLE_PAID_GENERATION, LIMO_AI_SPEND_SCOPE, LIMO_AI_KILL_SWITCH, LIMO_AI_MAX_ATTEMPTS, provider keys only at activation | same | 0.5 vCPU / 512 MB |
One instance of each first; test-named workers refuse non-local databases (`worker/src/lock.ts`). Stuck AI jobs are
quarantined (never silently re-run); stuck render jobs follow their lease. Details: WORKER_HOSTING_PLAN.md.

## 7. Error monitoring and alerts (to connect at hosting time)
| Alert | Signal (SQL or endpoint) |
|---|---|
| Worker down | `/healthz` not 200 for 2 min (each worker) |
| Render queue | oldest `render_jobs.status='queued'` older than 15 min; > 3 failed in 15 min |
| AI jobs failing | `select count(*) from ai_jobs where status='failed' and completed_at > now() - interval '15 minutes'` > 3 |
| AI jobs stuck | `ai_jobs` `processing` older than 15 min (quarantine runs, alert anyway) or `waiting_provider` older than 30 min |
| Spend | `ai_spend_guards.spent_cents + reserved_cents` > 80 % of `limit_cents`; any `ai_spend_entries.needs_reconciliation` |
| Facebook guard | `blocked facebook calls` > 0 in publisher logs |
| App errors | Vercel function errors / 5xx rate (error tracker to choose: owner decision) |

## 8. SMTP readiness checklist
- [ ] Choose a provider (owner) and verify the sending domain (SPF, DKIM, DMARC).
- [ ] Supabase Auth → SMTP settings with the provider's credentials (dashboard only, never in Git).
- [ ] Site URL + redirect allow-list (production, previews, `/auth/confirm`).
- [ ] Templates from `supabase/templates` (confirm, recovery, email change) in all four languages.
- [ ] Test: sign-up confirmation, resend, password recovery from another device (as `email-flows.spec.ts` does locally).
- [ ] Rate limits for emails reviewed; bounce/complaint handling in the provider.

## 9. Subscription and payment readiness checklist
- [ ] Migration #2 applied (payments through `submit_payment`, receipts in private storage).
- [ ] Real payment destinations entered (Admin → Payment methods); test with one real transfer.
- [ ] Plans and prices confirmed (credits per plan; 30 s / one credit per video).
- [ ] Admin review flow tested with a real receipt (approve → subscription active → credits).
- [ ] Test subscription balance decision (G10); refunds/cancellation policy written.
- [ ] No card processor is integrated; adding one is a separate decision.

## 10. Rollback and recovery
- Database: each migration has a rollback in `supabase/rollback/` (dry-run tested); data-loss notes per script in
  MIGRATION_REVIEW.md (e.g. #13 export `ai_spend_entries` first; #14 removes animation exports from `render_jobs`).
  For anything beyond a script, restore from the pre-window dump (§5).
- App: keep the previous Vercel deployment; promote back if the new build misbehaves.
- Workers: stop the worker (jobs stay queued); render jobs resume by lease, AI jobs are quarantined, not re-run.
- AI spend: kill switch (`admin_set_ai_spend_guard(scope, false, reason)` or `LIMO_AI_KILL_SWITCH=on`).
