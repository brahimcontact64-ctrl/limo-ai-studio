# Next steps

## Exact next action
Milestone 4 — Canonical characters: reference asset upload/review workflow for the 18 variants (front/side/expression sheets as private assets), approval states that the generation gate already checks (`missing_character_reference`), clearly marked placeholders where no approved reference exists. No generated images are invented.

Then, per the approved roadmap: Milestone 5 Story Engine (series UI, facts, Continue Story with 3 episodes + a revision), Milestone 6 Image Studio, Milestone 7 real MP4 export (worker + FFmpeg), Milestone 8 Facebook publishing with mock adapters and calendar.

## Git
`rebuild/v1` is ahead of `origin/rebuild/v1`; commits are local until pushed. A push is a fast-forward (checked with `git push --dry-run`), the secret scan of the unpushed commits is clean, and only `.env.example` (placeholders) is tracked. Pushing `rebuild/v1` may create a Vercel **preview** deployment (not production). `main` is not touched.

## Blockers (owner)
1. Approve applying pending migrations to production (`20261016140000`, `20261016150000`, `20261017090000`, `20261017100000`, `20261017120000`); review in `MIGRATION_REVIEW.md`.
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
