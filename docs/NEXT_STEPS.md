# Next steps

## Exact next action
Next integration phase (owner decision): real AI text, image, video and voice providers — see `docs/PROVIDER_INTEGRATION_PLAN.md` (capabilities, selection criteria, cost model, quotas, safety, failover, activation checklist). Nothing is activated.

Real Facebook (owner decision, later): Meta app + app review (pages_manage_posts, pages_read_engagement), OAuth callback storing Page tokens in Vault via the service role, webhook processor, then unlock `facebook_live_publishing` for a pilot Page.

Push: the Milestone 8 commit is local; push only after the owner approves.

## Video worker hosting (owner decision before production)
The render worker (`worker/`) must run on a host outside Vercel with FFmpeg (e.g. a small VM or container service), the Supabase service role key in its secret store, and enough temporary disk. `worker/Dockerfile` is prepared but was not built or deployed. Until a worker runs, production exports would stay "Waiting".

## Character artwork (pending, owner decision)
The character system is complete, but **no reference image or rigged 3D model exists**. No image-generation provider is enabled and no artwork was fabricated. To finish the characters:
Production guide: `docs/CHARACTER_REFERENCE_GUIDE.md` (one visual direction, deliverables, review checklist, per-character briefs; generated from the canon).
1. The owner reads and approves the 18 written design specs (Admin → Characters → Open → Approve spec).
2. Artwork is produced outside the app (illustrator/3D artist) or with an image provider the owner approves (Milestone 10).
3. A platform admin uploads front, side and three-quarter images per character, records the source, opens each file and approves it with the checklist. Only then does a character become ready for generation.

## Git
`origin/rebuild/v1` was pushed on 2026-10-18 at `3b26d67` (Milestone 7, owner-authorized, full-history secret scan clean). The GitHub repository is public. Vercel has no Git connection (pushes create no deployments), there are no GitHub Actions, and Supabase branching is off. Later commits are local until the next authorized push. `main` is not touched.

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
