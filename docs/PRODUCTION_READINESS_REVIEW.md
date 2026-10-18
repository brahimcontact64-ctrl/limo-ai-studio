# Production readiness review (2026-10-18)

Review only — nothing in production was changed. Production Supabase `aevqhgksniqahqrntzxv` has 50 migrations
(last `20261016120000`); **13 are pending** (MIGRATION_REVIEW.md). Vercel production is an older deploy that predates
`rebuild/v1`; `origin/main` is `2a3f426` (untouched).

## 1. Verdict
**Not ready for paying customers.** The code is verified on the local replica; the blockers are operational
decisions and infrastructure that only the owner can provide.

## 2. Pending migrations (in order)
1–11 as in MIGRATION_REVIEW.md, 12 `20261018120000_limo_ai_generation_v1` (AI generation foundation, providers
disabled), **13 `20261018150000_limo_ai_spend_guard_v1`** (spend guard; pilot scope disabled; two disabled registry
rows). All have rollback scripts; `scripts/sql/rollback-dry-run.sh` passes for all 13 on the local replica. Behaviour
changes to review before G1: #2 (payments through `submit_payment`), #5 (approved scripts read-only), #7 / #10 /
#6 (direct client writes replaced by functions), #11 (30 s and credit rules).

## 3. Blockers
| Area | State | Needed | Gate |
|---|---|---|---|
| Backups + **real restore test** | not done; only dry runs | confirm backup tier/PITR, take a dump, restore it into a scratch project and run the SQL tests there | G2, G3 |
| Migrations | 13 pending, verified locally | written approval, window, run in order, verify flags off | G1, G7, G9 |
| App promotion | `rebuild/v1` not deployed | approval to promote; check the old deploy's direct writes | G4, G8 |
| Worker hosting (render, publisher, generator) | images/examples prepared, nothing hosted | host + region, build from a tag, secrets store, smoke test | W1–W7 |
| Monitoring and alerts | health endpoints + SQL alert queries exist; nothing connected | uptime checks on health ports, alert on failed jobs/stale workers/spend | W6 |
| Auth and email | email confirmation on; built-in sender only reaches team addresses | site URL + redirects, templates, custom SMTP, admin MFA on | blockers 2–3 in NEXT_STEPS |
| Payments and subscriptions | manual payment flow built; no real destinations | real payment methods after #2; test subscription decision | G10 |
| AI providers | all disabled; prices unverified; spend guard ready | pilot first (AI_PILOT_PLAN.md), then a production decision | — |
| Facebook | mock only | Meta app review | W8 |
| Rollback | scripts for all 13 migrations, dry-run tested | owner keeps the dump from G2; app rollback = keep the old deploy until verified | — |

## 4. Recommended order
G2/G3 restore drill → G1 migrations in a window → G9 flags verified off → W1–W7 workers → G8 app promotion →
monitoring → auth/SMTP → payments → (separately) the AI pilot on the local replica, then production AI decisions.
