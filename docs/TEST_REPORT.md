# Test report

Actual results only. Newest first.

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
