# LIMO AI Studio — instructions for Claude Code

Before editing, read in this order:
1. `docs/PRODUCT_SPEC.md` — approved scope (canonical).
2. `docs/DECISIONS.md` — owner decisions and pending approvals.
3. `docs/IMPLEMENTATION_STATUS.md` — what is verified to work.
4. `docs/NEXT_STEPS.md` — the exact next action and blockers.
5. `docs/ARCHITECTURE.md`, `docs/TEST_REPORT.md`, `docs/MIGRATION_REVIEW.md` and `docs/PRODUCTION_ROLLOUT_PLAN.md` (pending production migrations, backups, rollback) as needed.
6. AI work: `docs/VIDEO_POLICY.md` (30 s, one credit per completed video), `docs/AI_GENERATION.md` (modes, gates, activation), `docs/AI_PROVIDERS.md` (researched providers, billing caps), `docs/AI_COSTS_AND_PRICING.md`, `docs/AI_PILOT_PLAN.md` ($10 pilot: safeguards, approvals). Production state: `docs/PRODUCTION_READINESS_REVIEW.md`. Animation: `docs/ANIMATION_PIPELINE.md` (providers, architecture, costs, owner scenario template, §8a status). Facebook: `docs/FACEBOOK_CONTENT_STUDIO.md`.

Product direction (owner, 2026-10-18; PRODUCT_SPEC §1): premium AI creation platform — genuinely animated talking characters (never a slideshow sold as animation) AND the full platform (ads, storytelling, Image Studio, Facebook Content Studio, subscriptions, admin, four languages). Never reduce scope; never invent the flagship scenario (the owner writes it; `docs/ANIMATION_PIPELINE.md`, `lib/animation/scenario.ts`). Tracks: A animated character video, B real AI Facebook posts/images, C production readiness.

Hard rules (details in the docs):
- Work on `rebuild/v1`; never merge into `main` or promote to production without explicit owner approval.
- Never apply migrations to production Supabase (`aevqhgksniqahqrntzxv`) without owner approval. Migrations are additive only; verify on the local replica first.
- Keep the approved lavender/white/purple LIMO design. No redesigns.
- No paid AI providers, no real social publishing, no invented test results, media or credentials. Mock output must be labelled.
- AI generation stays `LIMO_GENERATION_MODE=off` unless the owner activates it. Every provider call goes through `lib/providers/execute.ts` (verified price, authorisation, bounded retries; never retry or switch provider after a safety refusal). Never invent prices: unverified prices must block. Never call a provider live in tests; use mocked HTTP. Every paid call needs a spend guard (`lib/providers/spend.ts`, DB scope via `LIMO_AI_SPEND_SCOPE`): reserve before, settle/release after; never bypass it. The $10 pilot budget is a planning ceiling, not permission to spend. Never claim character artwork exists until the owner approved genuine images.
- Videos are at most 30 s on every plan; one video credit per completed export (see VIDEO_POLICY.md).
- Creative AI work (Animation Studio shots, Facebook captions/images) goes through `ai_jobs` + the generator worker; flags `animation_generation`, `ai_social_text`, `ai_social_images` stay off until the owner approves. Mock outputs are labelled and a mock clip is never presented as animation (DB refuses approving/exporting mock clips). Automated identity checks are deterministic only (`lib/animation/identity.ts`) — never claim they prove identity, motion or lip-sync; approving a shot with characters needs the owner's confirmation. Owner checklist for the first flagship video: `docs/FLAGSHIP_VIDEO_CHECKLIST.md`. Client components must not import modules that use Node APIs (`lib/providers/provenance.ts` uses node:crypto) — use `lib/ai/constants.ts`.
- Never touch MagicFlux, the trading platform or other Docker containers; the local replica uses project id `limo-local-e2e` on ports 564xx (554xx is reserved by Windows on this machine).
- Never commit secrets or `.env*` files (except `.env.example`).
- Update `docs/IMPLEMENTATION_STATUS.md`, `docs/TEST_REPORT.md` and `docs/NEXT_STEPS.md` after each milestone.

Checks: `npm run typecheck`, `npx tsc --noEmit -p worker`, `npm test`, `npm run build`, backend e2e `node scripts/e2e-backend.ts`, local-only e2e `node scripts/e2e-render.ts`, `node scripts/e2e-publish.ts`, `node scripts/e2e-generate.ts`, SQL tests in `scripts/sql/` (incl. `ai-spend-guard-test.sql` and `ai-spend-guard-concurrency.sh <local db>`), pilot dry run `node scripts/ai-pilot.ts --step script`, local-only e2e `node scripts/e2e-animation.ts`, SQL `animation-studio-test.sql`, restore drill `scripts/sql/restore-drill.sh <local db>`, browser e2e `npx playwright test` (render worker + publisher running).
The e2e scripts refuse to start while another LIMO worker targets the same database (`worker/src/lock.ts`); stop leftover worker processes first.
Run the browser suite against a production build (`next build` + `next start`) for timing-sensitive results: `next dev` compiles routes on first visit (a cold run of one test took 99.6 s on dev vs 21.1 s on the production build).
Rollback scripts for pending migrations live in `supabase/rollback/` (never in `supabase/migrations/`); dry-run them with `scripts/sql/rollback-dry-run.sh <local db container>`.
