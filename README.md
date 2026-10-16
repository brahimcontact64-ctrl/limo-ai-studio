# LIMO AI Studio

Multi-tenant AI video studio: workspaces, an 18-character cast, scene-by-scene planning, storyboard prompts and export settings, on top of the existing Supabase backend (`aevqhgksniqahqrntzxv`).

## Stack

- Next.js 15.5 (App Router) · React 19.1 · strict TypeScript
- Supabase Auth + Postgres (RLS) via `@supabase/ssr`
- Plain CSS design system (`styles/`), no UI framework
- i18n: English, French, Arabic (RTL), German (`lib/i18n`)

## Run locally

```bash
npm ci
cp .env.example .env.local   # fill NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
npm run dev
```

| Command | What it does |
| --- | --- |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | unit tests (`node --test`, TypeScript run natively by Node ≥ 22.18) |
| `npm run build` | production build |
| `npm run test:e2e` | backend end-to-end checks (see below) |
| `npx playwright test` | UI end-to-end journey (see below) |
| `npm run db:types` | regenerate `lib/supabase/database.types.ts` from the live schema |

## Structure

```
app/(marketing)     public site: home, pricing, faq, contact, legal
app/(auth)          login, signup, forgot/reset password
app/auth/*          email-link callback, POST sign-out
app/app/onboarding  profile completion (complete_registration_profile_v2)
app/app/(workspace) dashboard, projects, studio editor, characters, billing, settings
app/admin           platform admin (is_platform_admin(), 404 otherwise)
app/api/projects    save (create/update), duplicate, archive/restore/delete
lib/studio          limits, validation, draft mapping, storyboard prompt builder (shared client/server)
lib/generation      provider contract, mock provider, cost estimate, paid-generation gate
lib/data            server data access (workspace context, catalogs, projects)
supabase/migrations exact copy of migrations applied in production + pending ones
legacy-v1/          recovered earlier code, excluded from the build
```

## Security model

- Every query runs as the signed-in user; RLS (`is_org_member`, `can_edit_org`) is the boundary.
- Writes go through `SECURITY DEFINER` RPCs (`save_studio_project`, …) that re-check membership and subscription.
- The API never accepts an organization id from the browser: updates use the project's own organization (visible only through RLS), creates use the caller's verified active workspace.
- State-changing API routes reject cross-origin requests; sign-out is POST-only; post-login redirects are restricted to same-origin paths.
- No service-role key is used by the app. Provider keys stay server-side and paid generation is blocked unless `LIMO_ENABLE_PAID_GENERATION=true` **and** the DB cost policy/provider are verified and enabled.

## Backend facts that shape the UI

- Projects: 1–18 characters, 1–25 scenes, **1–15 s per scene** (trigger `guard_project_scene_duration_v1`, stricter than the RPC's 120 s).
- `project_cast` is `[{ "id": "limo_boy" }]`; content types and languages come from the live catalogs.
- Saving requires an active subscription (`organization_subscriptions.status = 'active' and renews_at > now()`).
- Character references are all `pending`; the storyboard flags this and generation stays blocked.

## Database migration 20261016120000 (applied 2026-10-16)

`supabase/migrations/20261016120000_limo_studio_project_lifecycle_v1.sql` was applied to production with owner approval and recorded in `supabase_migrations.schema_migrations`:

1. fixes `studio_projects_project_cast_check1` (was 1–3 characters, now 1–18);
2. adds `archive_studio_project`, `restore_studio_project`, `delete_studio_project` (refuses projects with generation history);
3. adds `rename_organization` (owner/admin).

Note: the production migration history is not self-contained — the base tables were created outside it. To reproduce the schema locally, use a schema-only dump (`supabase db dump --linked`) as the baseline.

## Email confirmation and password recovery

Production has email confirmation ON. The app:
- sends sign-up and reset links to  and stores the UI language in ;
- handles  links (any device) and PKCE  links (same browser; cross-device failures fall back to a neutral sign-in message);
- shows a check-your-inbox state with a Resend button (60 s cooldown, matching Supabase);
- only shows the new-password form when a recovery session exists.

 and  are branded, four-language templates whose links use .
**Pending owner action in Supabase Auth settings:** site URL, redirect allow-list (production + preview domains + ), the two templates, and a custom SMTP sender (Supabase's built-in sender only delivers to project team members and is heavily rate-limited).

## Subscription activation (manual payments)

Migration  (**pending owner approval for production**):
- : owner/admin submits a claim; amount priced in the database; method must be enabled; max 3 pending; receipt must be in the workspace folder. Replaces the direct INSERT policy.
- : platform admin approves (activates the plan for 30 days via ) or rejects with a reason; audited.
- , ; storage policies for the private  bucket.

UI:  (choose plan → method → pay → reference + receipt),  (queue with signed receipt links), .
All payment methods are disabled in production until an admin enters real destination details.

## End-to-end tests

Backend (`scripts/e2e-backend.ts`) needs two users in different workspaces; user A needs a completed profile and an active subscription:

```bash
SUPABASE_URL=… SUPABASE_ANON_KEY=… \
E2E_A_EMAIL=… E2E_A_PASSWORD=… E2E_B_EMAIL=… E2E_B_PASSWORD=… npm run test:e2e
```

For a local stack, `scripts/e2e-local-setup.ts` creates those users (it refuses non-localhost URLs).

UI (`tests/e2e/signed-in-smoke.spec.ts`) works against any environment with an existing subscribed account (`E2E_EMAIL`, `E2E_PASSWORD`) and deletes the project it creates.

Local-stack suites: `email-flows.spec.ts` and `payments.spec.ts` need `E2E_MAILPIT_URL` (and admin credentials for payments); `scripts/e2e-local-setup.ts` with `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD` creates a local platform admin and a test CCP destination.

Full journey (`tests/e2e/studio.spec.ts`) signs up a fresh user, so it needs a Supabase project without email confirmation (local stack) and `E2E_SUPABASE_URL` + `E2E_SERVICE_ROLE_KEY` to activate a test subscription. Run the app with that project's public env, then `E2E_BASE_URL=http://localhost:3200 npx playwright test`.

## Deployment

Vercel project `limo-ai-studio` (`vercel.json` sets the Next.js framework). Required env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SITE_URL`. Add the deployment URL + `/auth/callback` to Supabase Auth redirect URLs. Deploy to Preview first; promote only after the release checks pass.
