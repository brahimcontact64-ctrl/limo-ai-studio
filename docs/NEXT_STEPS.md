# Next steps

## Exact next action
Milestone 6 — Image Studio: image projects (posts, thumbnails, scene stills) using the mock image provider only, clearly labelled, with the approved-script and character-reference gates; workspace asset reuse; no paid image API.

Then: Milestone 7 real MP4 export (worker + FFmpeg), Milestone 8 Facebook publishing with mock adapters and calendar.

Push: Milestone 5 commits are local; push only after the owner approves.

## Character artwork (pending, owner decision)
The character system is complete, but **no reference image or rigged 3D model exists**. No image-generation provider is enabled and no artwork was fabricated. To finish the characters:
Production guide: `docs/CHARACTER_REFERENCE_GUIDE.md` (one visual direction, deliverables, review checklist, per-character briefs; generated from the canon).
1. The owner reads and approves the 18 written design specs (Admin → Characters → Open → Approve spec).
2. Artwork is produced outside the app (illustrator/3D artist) or with an image provider the owner approves (Milestone 10).
3. A platform admin uploads front, side and three-quarter images per character, records the source, opens each file and approves it with the checklist. Only then does a character become ready for generation.

## Git
`origin/rebuild/v1` was pushed on 2026-10-17 at `1779feb` (Milestone 4, owner-authorized, full-history secret scan clean). The GitHub repository is public. Vercel has no Git connection (pushes create no deployments), there are no GitHub Actions, and Supabase branching is off. Later commits are local until the next authorized push. `main` is not touched.

## Blockers (owner)
1. Approve applying pending migrations to production (`20261016140000`, `20261016150000`, `20261017090000`, `20261017100000`, `20261017120000`, `20261017140000`, `20261017160000`); review in `MIGRATION_REVIEW.md`.
2. Supabase Auth settings: site URL, redirect allow-list (production + previews + `/auth/confirm`), templates from `supabase/templates`, custom SMTP provider choice and credentials. TOTP must stay enabled (default on hosted projects).
3. The existing platform admin must turn on two-factor authentication (Workspace → Two-factor authentication) before using the admin area once the migrations are live.
4. Real payment destinations (Admin → Payment methods), after the migration.
5. Later: provider selection and budgets (Milestone 10), Meta app review for Facebook (Milestone 8 real adapter), production promotion.

## Known risks
- Vercel production is a 3-day-old deployment that predates `rebuild/v1`; confirm what it uses before migration `20261016150000` (it removes direct payment inserts).
- Local `main` points at an older rebuild commit (`49be1ec`) that was never pushed; `origin/main` is still the original prototype (`2a3f426`). Do not push local `main`.
- Supabase built-in email sender only reaches project team addresses; customers will not receive emails until SMTP is configured.
- The render/publish worker needs a host outside Vercel (Milestone 7).
- Rate limits use fixed windows per user; IP-based throttling for anonymous endpoints relies on Supabase Auth's own limits.
