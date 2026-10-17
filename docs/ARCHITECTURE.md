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
| Characters | `character_catalog` (18 variants + 3 family records), `character_design_specs` (versioned written specs), `character_reference_assets` + `character_reference_views` (files, review), `character_voice_profiles`, workspace `characters` (+ spec, reference status); bucket `character-library` (`canonical/<id>/v<n>/…`, `<org>/custom/<id>/v<n>/…`) |
| Story | `content_series` (+ `current_bible_version`), `story_bible_versions`, `story_seasons`, `content_episodes` (+ project link, checkpoint, approved checkpoint + fingerprint, review status/reasons/history), `story_checkpoint_versions`, `story_events`; `create_story_series`, `save_story_bible`, `restore_story_bible`, `create_story_season`, `create_story_episode`, `save_episode_checkpoint`, `approve_story_episode`, `reopen_story_episode`, `resolve_episode_review` (legacy `create_series_episode_draft`, `get_next_episode_context` unused) |
| Media | `media_assets`; buckets `generated-media`, `character-library`, `payment-receipts` |
| Generation | `generation_runs`, `generation_run_stages`, `generation_cost_policies`, `ai_provider_registry`, `content_jobs` (all providers disabled) |
| Social | `social_connections`, `facebook_pages`, `social_oauth_states`, `publishing_approvals`; vault-backed `store_oauth_secret`/`read_oauth_secret` |
| Images | `image_projects` (layered document JSON, purpose, aspect, style, brief, status, approved revision, series/project links), `image_revisions`, `image_exports` (→ `media_assets` kind `design`, files in `workspace-assets/<org>/exports/`); `save_image_project`, `restore_image_revision`, `approve_image_project`, `remove_image_approval`, `register_image_export` |
| Social posts | `social_posts` (caption, hashtags, image project + media asset, status); `save_social_post`, `set_social_post_approval` |
| Platform | `platform_audit_events`, `feature_flags`, `rate_limit_hits` |

## Migrations
`supabase/migrations/` mirrors production history plus pending files. Pending (not in production): `20261016140000` rate limits, `20261016150000` subscription activation + admin MFA helper, `20261017090000` admin hardening, `20261017100000` universal creation, `20261017120000` script revisions, `20261017140000` character system, `20261017160000` Story Engine, `20261017180000` Image Studio and social posts. Review, backups, verification and rollback: `docs/MIGRATION_REVIEW.md`; rollback scripts in `supabase/rollback/`. Local verification: schema-only dump of production + pending migrations on a local Supabase stack (ports 564xx, project id `limo-local-e2e`; moved from 554xx after Windows reserved 55375–55474).

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

## Characters (Milestone 4)
- Canon: `lib/characters/canon.ts` is the source of truth for the 18 written design specs; `scripts/gen-character-specs-sql.ts` generates the migration seed and a unit test fails if the two drift apart.
- A spec version is approved by a platform admin (two-factor) after reading it. Reference files belong to one spec version; a new version makes older references stop counting.
- Reference kinds are distinct: `rendered_reference` (PNG/JPEG/WebP picture of a view, expression or outfit), `rigged_model` (glTF/GLB/FBX file with a rig, never an image), `turntable_video`. Each file records its provenance (own artwork, commissioned, AI-generated, 3D render).
- Review: the reviewer must open the file (recorded in `character_reference_views`, valid 24 h) and confirm every checklist item; the database enforces both. One approved file per slot; approving a new one supersedes the old; "withdraw" retires an approval. All decisions are audited.
- Readiness (`character_catalog.reference_status`, mirrored in `lib/characters/references.ts`): `approved` only when the latest spec is approved and front, side and three-quarter images of that version are approved; then `visual_ref` points at the approved front image and the generation gate stops reporting `missing_character_reference`.
- Prompts use the spec's identity text (`identity_prompt`) instead of the short catalog description.
- Workspace characters: `save_custom_character` builds the spec server-side (`lib/characters/custom.ts`); cast id `custom:<uuid>`; references reviewed by workspace owners/admins; usable only in their own workspace.
- The family illustrations in the UI are identity markers, labelled as "not a reference".

## Story Engine (Milestone 5)
- Canon: the Story Bible (`lib/story/types.ts`) is versioned in `story_bible_versions`; every change is an explicit save (diff shown first, optimistic `base_version`), history can be restored as a new version, and characters used by approved episodes cannot be removed. A character's identity (`ref`) is fixed.
- Episodes: each episode is a studio project (script, revisions, script approval from Milestone 3) plus an ending checkpoint (`checkpoint`, versioned in `story_checkpoint_versions`). Approving an episode requires the approved script, a checkpoint that only refers to canon and to this episode's scenes, and approved, reviewed earlier episodes. Approval stores `approved_checkpoint`, its `md5` fingerprint, the approved script revision, writes the timeline (`story_events`) and turns opened/resolved threads into a new Story Bible version.
- Continue Story (`POST /api/stories/[id]/episodes`): the draft is built by the deterministic Mock AI (`lib/story/continue.ts`) from the latest approved ending (location, who is present, their states, the ending hook) and the open threads; new events are visible `[placeholders]`. `create_story_episode` refuses unless the base is the latest episode, approved, reviewed and its fingerprint matches.
- Changes propagate as reviews, never as rewrites: removing an approved episode's script approval (trigger) or reopening it flags every later episode; re-approving with a different ending adds a "changed" reason with the changed characters/threads and marks each later episode `direct` or `downstream` (`limo_flag_later_episodes`, mirrored by `affectedEpisodes`). Re-approving an identical ending clears its own reopen flags. Reviews are resolved in order with a note (kept in `review_history`).
- Studio integration: projects of a series get continuity checks against the bible and the previous approved ending (`lib/story/continuity.ts`) and an episode banner linking back to the story page.

## Image Studio and social posts (Milestone 6)
- Document model (`lib/images/types.ts`): canvas size from the aspect, a background and ordered layers (image → workspace asset id + fit + crop fractions; text with font/colour/tag; shape). The original files are never modified. `lib/images/doc.ts` normalises untrusted documents (system fonts only, hex colours, UUID asset ids, limits) and provides single-layer edits; the database re-checks size, limits and that every image belongs to the workspace (`limo_check_image_doc`).
- One renderer (`lib/images/render.ts`) draws the document in the editor, in thumbnails and in exports (canvas 2D; RTL text direction set per line). Exports are produced in the browser (`canvas.toBlob`), uploaded to `workspace-assets/<org>/exports/`, then `POST /api/images/[id]/exports` downloads the object with the user's own access, decodes the real format and pixel size from the bytes (`lib/images/formats.ts`) and only then registers it.
- Mock generation (`lib/images/mock.ts`, `POST /api/images/generate`) is deterministic layout, not image synthesis; it is the adapter point for a real provider in Milestone 10.
- Revisions follow the script editor rules: optimistic concurrency, autosave coalescing, restore as a new revision, approval enforced in the database, `[placeholders]` block approval.
- Social posts reference an approved design's export (or a library image). `facebookDraftPayload` is the hand-off format for the Milestone 8 adapter; `published` is always false.
- Unauthorized detail pages: `middleware.ts` checks `/app/(stories|projects|images|posts)/<uuid>` with the user's session (RLS) and rewrites to the not-found page with HTTP 404 before the page streams.
