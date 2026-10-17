# Architecture

## Components
```
Browser ── Next.js 15 (Vercel) ──┬── Supabase Auth (email+password, TOTP MFA)
  React UI, i18n, studio         ├── Postgres (RLS + SECURITY DEFINER functions)   ← security boundary
                                 └── Storage (private buckets, signed URLs)
Render/publish worker (Node, FFmpeg) ── service-role access to jobs + Storage      [Milestone 7/8]
Provider adapters (text, image, video, voice, render, Facebook) — mock first        [lib/generation, lib/providers]
```

## Request rules
- Every page and API route runs as the signed-in user (`lib/supabase/server.ts`). No service-role key in the web app.
- Organisation ids are never taken from the browser: updates use the row's own organisation (visible only through RLS); creates use the caller's verified active workspace (`lib/data/context.ts`).
- State-changing API routes: same-origin check, size-limited JSON, per-user rate limit (`lib/api/rateLimit.ts` → `hit_rate_limit`).
- Admin: `app/admin/layout.tsx` (is_platform_admin → 404 otherwise; aal2 gate) **and** database functions guarded by `is_platform_admin_mfa()`.

## Data model (main tables)
| Area | Tables / functions |
|---|---|
| Tenancy | `organizations`, `organization_members` (owner/admin/editor/viewer), `user_profiles`, `platform_admins` |
| Billing | `plan_definitions`, `addon_definitions`, `organization_subscriptions`, `usage_balances`, `usage_ledger`, `payment_submissions`, `payment_method_settings`; `submit_payment`, `admin_review_payment`, `approve_payment_submission`, `admin_set_subscription` |
| Studio | `studio_projects` (+ `creation_mode`, `creation_brief`, `script_status`, `approved_revision_id`), `project_scenes` (+ `narration`, `visual_prompt`, `asset_ids`), `project_export_choices`, `export_presets`, `project_revisions`; `save_studio_project` (v1) → `save_studio_project_v2` (modes, assets) → `save_studio_project_v3` (concurrency + revision + approval), `restore_project_revision`, `approve_project_script`, `remove_script_approval`, archive/restore/delete |
| Assets | `media_assets` (+ upload metadata), `brand_kits`; bucket `workspace-assets` (`<org>/…` folders); `register_media_asset`, `delete_media_asset`, `save_brand_kit` |
| Characters | `character_catalog` (18 variants + 3 family records), `character_voice_profiles`, workspace `characters` |
| Story | `content_series`, `content_episodes`; `create_series_episode_draft`, `get_next_episode_context` |
| Media | `media_assets`; buckets `generated-media`, `character-library`, `payment-receipts` |
| Generation | `generation_runs`, `generation_run_stages`, `generation_cost_policies`, `ai_provider_registry`, `content_jobs` (all providers disabled) |
| Social | `social_connections`, `facebook_pages`, `social_oauth_states`, `publishing_approvals`; vault-backed `store_oauth_secret`/`read_oauth_secret` |
| Platform | `platform_audit_events`, `feature_flags`, `rate_limit_hits` |

## Migrations
`supabase/migrations/` mirrors production history plus pending files. Pending (not in production): `20261016140000` rate limits, `20261016150000` subscription activation + admin MFA helper, `20261017090000` admin hardening, `20261017100000` universal creation, `20261017120000` script revisions. Review, backups, verification and rollback: `docs/MIGRATION_REVIEW.md`; rollback scripts in `supabase/rollback/`. Local verification: schema-only dump of production + pending migrations on a local Supabase stack (ports 554xx, project id `limo-local-e2e`).

## Email
Templates in `supabase/templates/` link to `/auth/confirm` with `token_hash` (works across devices). `lib/auth/callback.ts` handles token_hash and PKCE codes.

## Providers
`lib/generation`: adapter contract, deterministic mock provider, cost estimator mirroring `request_studio_generation`, paid-generation gate (env flag + DB policy + registry + approved character references). Mock output is labelled.

## Script editing (Milestone 3)
- Editor state is an undo/redo history (`lib/studio/history.ts`); typing bursts merge into one step. Ctrl/Cmd+Z / Shift+Z / Y outside text fields.
- Saves send `base_updated_at`; the database refuses a save based on an older version (`conflict`), so two tabs or two teammates never overwrite each other silently.
- Autosave: 3 s after the last change, valid drafts of existing projects only; consecutive autosaves by the same user within 10 minutes update one revision.
- Revisions (`project_revisions`) store a full snapshot in the `save_studio_project_v2` input format; restore = save the snapshot as a new revision. History is append-only (old autosaves pruned to 30).
- Approval: `approve_project_script` snapshots the script as an "approval" revision and sets `approved_revision_id`. Triggers refuse every write to an approved script's text from any entry point until approval is removed (audited). `generation_runs` inserts require an approved script and record `script_revision_id`.
- Mock AI (`lib/ai/script.ts`, `POST /api/assist`): deterministic, no external calls, only facts from the brief, missing facts as visible `[placeholders]`. Output is a proposal reviewed field by field with a word diff before it is applied; pre-selection never includes user text for whole-script drafts.
- Series continuity (`lib/story/continuity.ts`): for projects with `series_id`, edits are checked against the series cast bible, story rules and the previous episode's end state; rule violations block saving. Full Story Engine: Milestone 5.
