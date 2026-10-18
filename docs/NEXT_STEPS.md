# Next steps

## Exact next action
V1 video policy (30 s per video on every plan, one credit per completed video) is implemented and verified locally (VIDEO_POLICY.md; pending migration #11 `20261018090000`), committed locally, not pushed. Milestone 10 starts after the owner has reviewed it.

Milestone 9 (audit) is committed locally; push only with owner approval. Read `docs/AUDIT_M9.md` §4 (blockers before paying customers) and decide the gates in `docs/PRODUCTION_ROLLOUT_PLAN.md` §9 (G1–G10) and `docs/WORKER_HOSTING_PLAN.md` §12 (W1–W8).

Then, in order (each needs owner approval): production rollout (migrations → app promotion → workers → monitoring → restore drill); text provider (first `CapabilityAdapter`, `lib/providers/contracts.ts`); character artwork (`docs/CHARACTER_ARTWORK_PLAN.md`); image/voice/subtitle providers; video clips; live Facebook. Provider details: `docs/PROVIDER_INTEGRATION_PLAN.md` §8–§12. Nothing is activated.

Real Facebook (owner decision, later): Meta app + app review (pages_manage_posts, pages_read_engagement), OAuth callback storing Page tokens in Vault via the service role, webhook processor, then unlock `facebook_live_publishing` for a pilot Page.

Push: `origin/rebuild/v1` is at the Milestone 8 commit `1cd8c20` (pushed in Milestone 9 Phase A, approved). The Milestone 9 commit is local.

## Video worker hosting (owner decision before production)
The render worker and the publisher must run on a host outside Vercel. Plan, sizing (measured), secrets, health checks, alerts, scaling, cost variables and gates: `docs/WORKER_HOSTING_PLAN.md`. Images (`worker/Dockerfile`, `worker/Dockerfile.publisher`) and examples (`worker/deploy/`) are prepared but not built or deployed. Until a worker runs, production exports stay "Waiting" and scheduled posts stay "Scheduled".

## Character artwork (pending, owner decision)
The character system is complete, but **no reference image or rigged 3D model exists**. No image-generation provider is enabled and no artwork was fabricated. To finish the characters:
Production guide: `docs/CHARACTER_REFERENCE_GUIDE.md` (one visual direction, deliverables, review checklist, per-character briefs; generated from the canon). Readiness plan with exact counts (54 required images, 252 for full sheets) and acceptance checklist: `docs/CHARACTER_ARTWORK_PLAN.md`.
1. The owner reads and approves the 18 written design specs (Admin → Characters → Open → Approve spec).
2. Artwork is produced outside the app (illustrator/3D artist) or with an image provider the owner approves (Milestone 10).
3. A platform admin uploads front, side and three-quarter images per character, records the source, opens each file and approves it with the checklist. Only then does a character become ready for generation.

## Git
`origin/rebuild/v1` was pushed on 2026-10-18 at `1cd8c20` (Milestone 8, owner-authorized in Milestone 9 Phase A; earlier `3b26d67` for Milestone 7). The GitHub repository is public. Vercel has no Git connection (pushes create no deployments), there are no GitHub Actions, and Supabase branching is off. Later commits are local until the next authorized push. `main` is not touched.

## Blockers (owner)
1. Approve applying pending migrations to production (`20261016140000`, `20261016150000`, `20261017090000`, `20261017100000`, `20261017120000`, `20261017140000`, `20261017160000`, `20261017180000`, `20261017200000`, `20261017220000`); review in `MIGRATION_REVIEW.md`.
2. Supabase Auth settings: site URL, redirect allow-list (production + previews + `/auth/confirm`), templates from `supabase/templates`, custom SMTP provider choice and credentials. TOTP must stay enabled (default on hosted projects).
3. The existing platform admin must turn on two-factor authentication (Workspace → Two-factor authentication) before using the admin area once the migrations are live.
4. Real payment destinations (Admin → Payment methods), after the migration.
5. Later: provider selection and budgets (Milestone 10), Meta app review for Facebook (Milestone 8 real adapter), production promotion.

## Known risks
- Vercel production is a 3-day-old deployment that predates `rebuild/v1`; confirm what it uses before migration `20261016150000` (it removes direct payment inserts).
- Local `main` points at an older rebuild commit (`49be1ec`) that was never pushed; `origin/main` is still the original prototype (`2a3f426`). Do not push local `main`.
- Supabase built-in email sender only reaches project team addresses; customers will not receive emails until SMTP is configured.
- The render worker and the publisher need a host outside Vercel (see "Video worker hosting"); without a running publisher, scheduled posts stay "Scheduled".
- Rate limits use fixed windows per user; IP-based throttling for anonymous endpoints relies on Supabase Auth's own limits.
