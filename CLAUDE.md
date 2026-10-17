# LIMO AI Studio — instructions for Claude Code

Before editing, read in this order:
1. `docs/PRODUCT_SPEC.md` — approved scope (canonical).
2. `docs/DECISIONS.md` — owner decisions and pending approvals.
3. `docs/IMPLEMENTATION_STATUS.md` — what is verified to work.
4. `docs/NEXT_STEPS.md` — the exact next action and blockers.
5. `docs/ARCHITECTURE.md`, `docs/TEST_REPORT.md` and `docs/MIGRATION_REVIEW.md` (pending production migrations, backups, rollback) as needed.

Hard rules (details in the docs):
- Work on `rebuild/v1`; never merge into `main` or promote to production without explicit owner approval.
- Never apply migrations to production Supabase (`aevqhgksniqahqrntzxv`) without owner approval. Migrations are additive only; verify on the local replica first.
- Keep the approved lavender/white/purple LIMO design. No redesigns.
- No paid AI providers, no real social publishing, no invented test results, media or credentials. Mock output must be labelled.
- Never touch MagicFlux, the trading platform or other Docker containers; the local replica uses project id `limo-local-e2e` on ports 564xx (554xx is reserved by Windows on this machine).
- Never commit secrets or `.env*` files (except `.env.example`).
- Update `docs/IMPLEMENTATION_STATUS.md`, `docs/TEST_REPORT.md` and `docs/NEXT_STEPS.md` after each milestone.

Checks: `npm run typecheck`, `npm test`, `npm run build`, backend e2e `node scripts/e2e-backend.ts`, browser e2e `npx playwright test`.
Run the browser suite against a production build (`next build` + `next start`) for timing-sensitive results: `next dev` compiles routes on first visit (a cold run of one test took 99.6 s on dev vs 21.1 s on the production build).
Rollback scripts for pending migrations live in `supabase/rollback/` (never in `supabase/migrations/`); dry-run them with `scripts/sql/rollback-dry-run.sh <local db container>`.
