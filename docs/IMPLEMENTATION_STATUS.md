# Implementation status

Verified state only. "Implemented" means working end to end with tests; "Partial" means some of the spec exists; "Blocked" names the external dependency.
Last updated: 2026-10-16 (Milestone 1 complete locally; production migrations pending approval).

## Baseline (verified 2026-10-16)
- Branch `rebuild/v1` @ `fa406a1`, clean. `design/original-restore` is merged into it. `main` @ `2a3f426` (old static prototype), untouched.
- Production Supabase `aevqhgksniqahqrntzxv`: 50 migrations applied (49 historical + `20261016120000`). `20261016150000` written, verified locally, **not applied**.
- Production Auth: email confirmation ON (`mailer_autoconfirm=false`), email provider only.
- Storage buckets: `payment-receipts`, `generated-media`, `character-library` (all private). No Storage policies in production yet (pending migration adds receipts policies).
- Characters: 18 active variants + 3 family base records; all `reference_status = pending`; **no reference images, no 3D models exist**.
- FFmpeg not installed on the dev machine.

## Matrix
| Area (spec §) | Status | Notes |
|---|---|---|
| Design restore (§2) | Implemented | Lavender/purple identity, dark sidebar, four languages, RTL. |
| Sign-up / sign-in / sign-out (§15) | Implemented | Supabase Auth, safe redirects. |
| Email confirmation & recovery (§15) | Implemented (code) / Blocked (prod config) | Verified locally with real emails; production needs Auth URL/template/SMTP settings. |
| Onboarding profile 18+ (§15) | Implemented | `complete_registration_profile_v2`. |
| Workspaces, roles, isolation (§16) | Implemented | RLS verified by backend e2e. |
| Subscription activation (§15) | Implemented locally / Blocked (prod migration approval) | Server-priced claims, admin review, receipts. |
| Usage metering & quotas (§15) | Partial | Usage balances exist; generation not live. |
| Expiry & grace period (§15) | Partial | Existing cron + retention functions in DB; no UI. |
| Platform admin (§14) | Implemented locally / Blocked (prod migration approval) | 404 for non-admins; TOTP two-factor required in UI and in every admin DB function (aal2); workspace overview; audited subscription changes with reason; feature flags (paid/live locked); payment queue; audit log; provider registry admin-only. |
| Rate limiting (§14) | Implemented locally | Per-user DB-backed limits (project saves, payment submission). |
| Universal Create Content (§3) | Missing | Studio is story-oriented; characters required. |
| Character-free projects (§16) | Missing | DB requires ≥1 character. |
| Product advertising engine (§7) | Missing | |
| Workspace asset library / brand kit | Missing | `media_assets`, `brands` tables exist (unused). |
| Script & scene editor (§4) | Partial | Scene fields, reorder/duplicate/delete, durations exist. Missing: narration field, AI drafts/rewrite, versions, approval, autosave. |
| Characters & references (§5) | Partial | Catalog, library UI, appearance specs. Missing: reference assets, review workflow, custom characters. |
| Story engine (§6) | Partial (DB only) | `content_series`, `content_episodes`, `create_series_episode_draft`, `get_next_episode_context` exist; no UI, no facts/conflicts. |
| Image Studio (§8) | Missing | |
| Video export MP4 (§9) | Missing | No worker, no FFmpeg. |
| Voice/audio (§10) | Missing | Provider registry rows exist, all disabled. |
| Social Post Studio (§11) | Missing | |
| Facebook publishing/automation (§12) | Partial (DB only) | Connection/page tables, vault secret functions, page selection RPC; no OAuth, no adapter, no UI. |
| Content calendar (§13) | Missing | |
| Provider architecture (§17) | Partial | Adapter contract, mock provider, cost estimator, paid-generation gate (unit tested). |
| Persistent docs (§22) | Implemented | This folder + root `CLAUDE.md`. |
