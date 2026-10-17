# Implementation status

Verified state only. "Implemented" means working end to end with tests; "Partial" means some of the spec exists; "Blocked" names the external dependency.
Last updated: 2026-10-17 (Milestone 5 complete locally; character artwork pending; production migrations pending approval, see MIGRATION_REVIEW.md).

## Baseline (verified 2026-10-16)
- Branch `rebuild/v1` @ `fa406a1`, clean. `design/original-restore` is merged into it. `main` @ `2a3f426` (old static prototype), untouched.
- Production Supabase `aevqhgksniqahqrntzxv`: 50 migrations applied (49 historical + `20261016120000`). Pending, verified locally, **not applied**: `20261016140000`, `20261016150000`, `20261017090000`, `20261017100000`, `20261017120000`, `20261017140000`, `20261017160000`.
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
| Universal Create Content (§3) | Implemented locally / Blocked (prod migration approval) | `/app/create`: 8 modes; per-mode brief fields; starter scenes copy only user text; mode + brief editable in the studio. Story opens the cast wizard. |
| Character-free projects (§16) | Implemented locally / Blocked (prod migration approval) | `save_studio_project_v2`: characters required only for story mode; cast 0–18. |
| Product advertising engine (§7) | Partial | Product ad brief (name, description, selling points, price/offer flagged as claims, CTA, visual direction), product photos placed in starter scenes. Missing: AI script drafting (M3), image/video generation (M6/M7). |
| Workspace asset library / brand kit | Implemented locally / Blocked (prod migration approval) | Private `workspace-assets` bucket (org folders, 100 MB, image/video/audio); upload, list (signed URLs), delete (refused while used by a scene); brand kit (name, tagline, colours, logo, CTA, tone); per-scene media picker. |
| Script & scene editor (§4) | Implemented locally / Blocked (prod migration approval) | All 8 project types. Whole-script view (Script step) and per-scene editor: narration, dialogue, on-screen text, visual description, camera direction, duration, order. Undo/redo, autosave, conflict detection, revision history with word-diff comparison and restore, script approval (database-enforced lock), Mock AI draft/rewrite/shorten/expand/translate/tone/regenerate-scene as reviewed proposals. Real AI providers: Milestone 10. |
| Characters & references (§5) | Implemented locally (system) / **Artwork pending** | 18 canonical design specs v1 (LIMO tomato, NOVA strawberry, ADAM potato; 6 age/gender variants each): head, crown, surface, face, body, proportions, palette, signature details, 2 outfits, 8 expressions, consistency text and negative rules; seeded as *proposed*. Versioned reference assets per view (front, side, three-quarter, back), expression and outfit; rendered 3D-style images, rigged 3D model files and turntables are separate kinds. Private storage, admin (two-factor) review with recorded viewing + checklist, withdraw. Character details in the library and the studio cast. Workspace characters with their own references and review, usable in casts. Generation readiness requires an approved spec + three approved views. **No reference image or 3D model exists yet; no character is approved.** |
| Story engine (§6) | Implemented locally / Blocked (prod migration approval) | Series with optional seasons; versioned Story Bible (characters with fixed identities, relationships, locations, world rules incl. forbidden content, plot threads) with explicit canon changes, conflict detection, history and restore; episodes = studio projects with approved scripts (M3) + ending checkpoints (location, time, per-character presence/feeling/physical state/goal, events tied to scenes, threads progressed/resolved/opened), versioned; Continue Story only from the latest approved, reviewed ending (fingerprint); timeline from approved episodes only; reopening/changing an episode flags later episodes (direct/downstream) for ordered review instead of rewriting; continuity checks in the studio; deterministic Mock AI drafts and ending suggestions. Real AI writing: Milestone 10. |
| Image Studio (§8) | Missing | |
| Video export MP4 (§9) | Missing | No worker, no FFmpeg. |
| Voice/audio (§10) | Missing | Provider registry rows exist, all disabled. |
| Social Post Studio (§11) | Missing | |
| Facebook publishing/automation (§12) | Partial (DB only) | Connection/page tables, vault secret functions, page selection RPC; no OAuth, no adapter, no UI. |
| Content calendar (§13) | Missing | |
| Provider architecture (§17) | Partial | Adapter contract, mock provider, cost estimator, paid-generation gate (unit tested). Generation runs require an approved script (DB trigger, M3). Script assistant: mock only. |
| Persistent docs (§22) | Implemented | This folder + root `CLAUDE.md`. |
