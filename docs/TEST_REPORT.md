# Test report

Actual results only. Newest first.

## 2026-10-17 — Milestone 3 (script, dialogue and scene editing), branch `rebuild/v1`
Environment: local Supabase replica (production schema dump + pending migrations through `20261017120000`), app as a **production build** (`next build` + `next start` on :3200) unless noted.

| Suite | Command | Result |
|---|---|---|
| Unit | `npm test` | 66/66 pass (9 new: undo history, word diff, revision comparison, snapshot restore, Mock AI for all 8 modes, no invented facts, transforms, continuity) |
| Type check | `npm run typecheck` | pass |
| Production build | `npm run build` | pass |
| Backend e2e | `node scripts/e2e-backend.ts` | 97/97 pass (18 new script checks) |
| Generation gate (SQL) | `scripts/sql/generation-gate-test.sql` (rolled back) | 4/4: unapproved run refused; approved run records its revision; direct scene write refused while approved; status changes still allowed |
| Rollback dry run | `scripts/sql/rollback-dry-run.sh` (rolled back) | all 5 rollbacks run newest-first; pending objects removed, previous payment policy and v1 save present; database unchanged afterwards. The first dry run found an ordering bug (policy dropped after the function it uses); fixed |
| Browser, full suite | `npx playwright test` (desktop + Pixel 7) | **26/26 pass** |

New browser coverage (desktop + mobile): Mock AI whole-script draft reviewed in a dialog then applied; per-scene shorten with "Replaces your text" marking; undo/redo; autosave; history list, comparison and restore of revision 1; approval lock (fields and Mock AI disabled, survives reload); explicit removal of approval; Arabic RTL editor with Mock AI dialog and no horizontal overflow; two tabs editing the same project (second save refused with a reload option, no silent overwrite); another workspace gets an empty history and 404 for snapshot, restore and approval.

Backend coverage added: v3 create (character-free) → revision 1; stale save refused (conflict); revisions 2–3; consecutive autosaves coalesced; snapshots hold saved text; revisions invisible to another workspace; restore/approve refused for another workspace; approval → approval revision; approved script refused through v2, through v3 without removing approval, and content unchanged; approval removal → "changed"; restore of revision 2 as revision 5; approved project deletable.

Fixed during verification:
- On phones, the fifth step tab widened the whole studio (grid `min-width:auto`): the tab strip now scrolls inside itself.
- The History button had no accessible name on phones (label hidden): added.
- After a restore the editor jumped back to the Scenes step: the open step is kept per tab.
- Guard trigger referenced a column of the other table (PL/pgSQL resolves both branches): split into two trigger functions.

### Investigation: Milestone 2 browser timeout
The desktop product-ad test timed out once (90 s) in the full Milestone 2 run. Measured per step (`test.step`, JSON reporter), same test, same database:

| Run | Total | Sign up | Upload | Create | Reload | Edit + save | List |
|---|---|---|---|---|---|---|---|
| `next dev`, cold (fresh `.next`) | 99.6 s | 23.3 | 11.1 | 24.6 | 6.5 | 5.6 | 7.2 |
| `next dev`, warm | 47.3 s | 14.7 | 5.3 | 7.1 | 6.6 | 4.6 | 3.1 |
| production build, 1st run | 21.1 s | 4.4 | 3.2 | 4.4 | 3.5 | 2.5 | 0.8 |
| production build, 2nd run | 18.7 s | 4.1 | 2.6 | 4.8 | 2.7 | 1.5 | 0.9 |

The dev server log shows each route compiled on first request (1–10 s each, e.g. `/` 9.6 s, `/app/projects/[id]` 3.6 s) and recompiled after file changes. The production build has no cold penalty and every step stays under 5 s. Conclusion: the timeout came from on-demand compilation in `next dev`, not from a functional or performance regression. The full suite now runs against a production build; the 150 s budget on that test only covers cold dev runs.

## 2026-10-16 — Milestone 2 (universal creation), branch `rebuild/v1`
Environment: local Supabase replica (production schema dump + pending migrations through `20261017100000`, Storage, Mailpit, TOTP on), `next dev` on :3200.

| Suite | Command | Result |
|---|---|---|
| Unit | `npm test` | 57/57 pass |
| Type check | `npm run typecheck` | pass |
| Production build | `npm run build` | pass |
| Backend e2e | `node scripts/e2e-backend.ts` (local, with admin + TOTP secret) | 79/79 pass |
| Browser, full suite | `npx playwright test` (desktop + Pixel 7) | 22/22 pass (21 in the full run; the desktop product-ad test timed out on a cold dev compile, then passed on rerun with a 150 s budget) |

New coverage:
- Backend (16 checks): workspace-assets Storage isolation (upload, read, foreign folder); registration refused for another workspace's file; asset invisible to other workspaces; character-free product ad saved with mode, brief, narration and scene assets; story mode still requires characters; foreign asset refused in a scene; deleting an asset used by a scene refused; brand kit refuses a foreign logo; unused asset deleted.
- Browser: product ad without characters, with an uploaded product photo. Covers upload → Create content → brief and selling points → media picker → create → reload (mode, brief, scenes, media) → edit and save → listed with its type.

Fixed during verification: on phones, wide admin tables widened the whole page and blocked taps. Grid stack children now get `min-width: 0`, and the workspace "Manage plan" action moved to the first column.

## 2026-10-16 — Milestone 1 (security and onboarding), branch `rebuild/v1`
Environment: local Supabase replica (production schema dump + pending migrations, email confirmation on, TOTP on, Mailpit), `next dev` on :3200.

| Suite | Command | Result |
|---|---|---|
| Unit | `npm test` | 48/48 pass |
| Type check | `npm run typecheck` | pass |
| Backend e2e | `node scripts/e2e-backend.ts` (local, with admin + TOTP secret) | 63/63 pass |
| Browser: security & admin | `npx playwright test security-admin --project=desktop` | 3/3 pass |
| Browser: payments | `npx playwright test payments --project=desktop` | 1/1 pass |

Backend coverage: save/reload/edit, DB limits, tenant isolation, anonymous access, lifecycle, payments (server pricing, blocked direct insert, receipt isolation, admin-only review, single review, audit), admin two-factor (wrong code rejected, aal1 refused, aal2 accepted), workspace administration (reason required, customers refused, audited), feature flags, provider registry privacy, rate limiting (3 allowed, 4th refused).

## 2026-10-16 — Email flows and activation (commit `c4bbca3`)
Browser e2e 14/14 (desktop + mobile): email confirmation across devices in French, resend with cooldown, password recovery (old password refused, link not replayable), payments approve/reject, studio journey, signed-in smoke. Backend e2e 47/47. Production-database smoke (desktop + mobile) 2/2 against the production build.

## 2026-10-16 — Design restore (commit `50622d9`)
Unit 43/43, browser 4/4 + smoke 2/2, backend 26/26 (local) and 26/26 (production).

## How to run locally
1. Start the local replica (see `ARCHITECTURE.md`), export `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
2. `E2E_* … E2E_ADMIN_TOTP_FILE=<file> node scripts/e2e-local-setup.ts`
3. `E2E_ADMIN_TOTP_SECRET=$(cat <file>) node scripts/e2e-backend.ts`
4. Run the app with the replica's public env on :3200, then `E2E_BASE_URL=http://localhost:3200 E2E_MAILPIT_URL=http://127.0.0.1:58024 … npx playwright test`.
