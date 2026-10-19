# Pending production migration review

Status: **for owner review, not applied.** Prepared 2026-10-17 on branch `rebuild/v1`; updated for Milestone 8 (migration 10) and Milestone 9 (privilege hardening below). The gated rollout procedure is in `PRODUCTION_ROLLOUT_PLAN.md`.
Production Supabase project: `aevqhgksniqahqrntzxv` (50 migrations applied, last `20261016120000`).
Nothing in this document has been run against production.

## 1. What is pending

| # | Migration | Milestone | Kind | Depends on |
|---|---|---|---|---|
| 1 | `20261016140000_limo_rate_limits_v1` | M1 | additive: table `rate_limit_hits`, function `hit_rate_limit` | none |
| 2 | `20261016150000_limo_subscription_activation_v1` | M1 | **behaviour change**: replaces direct payment inserts with `submit_payment`; admin review/list/method functions; receipt Storage policies | 1 |
| 3 | `20261017090000_limo_admin_hardening_v1` | M1 | additive: `feature_flags`, `admin_list_workspaces`, `admin_set_subscription`, provider registry admin read policy | 2 (`is_platform_admin_mfa`) |
| 4 | `20261017100000_limo_universal_creation_v1` | M2 | additive columns + **cast rule relaxed to 0–18**; bucket `workspace-assets`; asset/brand-kit functions; `save_studio_project_v2` | none (v1 save unchanged) |
| 5 | `20261017120000_limo_script_revisions_v1` | M3 | additive table/columns/functions + **triggers** (approved scripts read-only; generation needs approval); one baseline revision per existing project | 4 (`save_studio_project_v2`, creation columns) |
| 7 | `20261017160000_limo_story_engine_v1` | M5 | Story Engine: Story Bible versions, seasons, episode endings (checkpoints) and versions, timeline events, review flags; **replaces direct client writes on `content_series` / `content_episodes` with functions**; trigger on `studio_projects` (removing an approved episode's script approval reopens the episode) | 5 (v3, revisions, approval), 6 (workspace characters) |
| 10 | `20261017220000_limo_social_publishing_v1` | M8 | **extends `social_posts`** (status list widened, workflow columns), **replaces** `save_social_post`, `set_social_post_approval`, `remove_image_approval` (same signatures, compatible behaviour); new tables `social_post_revisions`, `publish_jobs`, `publishing_controls`, `automation_policies`, `automation_policy_versions`, `mock_facebook_publications`, `social_webhook_events`; extends `social_connections` / `facebook_pages`; trigger on `studio_projects` (script approval change withdraws dependent video posts) | 8 (`social_posts`), 9 (`render_jobs`), 3 (`feature_flags`) |
| 9 | `20261017200000_limo_video_render_v1` | M7 | additive: tables `video_settings`, `render_jobs`; export/cancel/retry/settings functions for users, claim/progress/complete/fail functions for the worker (service role only); usage ledger entries `render_reserved` / `render_refund` | 4 (`media_assets`, `workspace-assets`, `brand_kits`), 5 (`project_revisions`, script approval), 7 (`content_episodes`) |
| 8 | `20261017180000_limo_image_studio_v1` | M6 | additive: tables `image_projects`, `image_revisions`, `image_exports`, `social_posts`; save/restore/approve/export/post functions | 4 (`media_assets` metadata, `workspace-assets`), 7 (`content_series`) |
| 11 | `20261018090000_limo_video_policy_v1` | V1 policy | **behaviour change**: 30 s per video on every plan, one credit per completed video (reserved/consumed/released) instead of one slot per approved revision; identical exports de-duplicated; triggers on `render_jobs` (duration + consistent timeline) and `studio_projects` (approval ≤ 30 s); replaces `limo_charge_render`, `limo_settle_render_charge`, `enqueue_render_job`, `retry_render_job`, `complete_render_job` and the production functions `request_studio_generation` (30 s, no video credits), `fail_content_job`, `refund_generation_usage_once` (skip jobs that never reserved), `normalize_studio_project_slots` (1 credit) | 9 (`render_jobs`), production generation functions |
| 12 | `20261018120000_limo_ai_generation_v1` | M10 | additive: `media_assets.provenance` + AI kinds (`ai_image`, `ai_video`, `ai_audio`), reuse index, table `generation_proposal_decisions` + `decide_generation_proposal`, read-only `generation_availability`; provider registry rows (Claude, Gemini image, Veo Fast/Lite) **disabled and unverified**; LIMO render/export rows become the (disabled) defaults instead of Shotstack | 11, production generation orchestration |
| 13 | `20261018150000_limo_ai_spend_guard_v1` | AI pilot prep | additive: tables `ai_spend_guards`, `ai_spend_entries` (service role only, RLS on, no policies), functions `ai_spend_reserve` / `settle` / `release` / `reconcile` (service role), `admin_set_ai_spend_guard` (MFA admin, audited), `ai_spend_bucket`; seeds scope `pilot` **disabled** ($10, $1/op, text/image/video/voice caps); registry rows `google_tts_v1`, `anthropic_safety_v1` **disabled and unverified** | 3 (`is_platform_admin_mfa`), 12 |
| 14 | `20261019090000_limo_animation_studio_v1` | Animation + Facebook AI | additive tables `animation_projects`, `animation_shots`, `animation_shot_events`, `ai_jobs` (RLS read for members, writes only through functions); customer functions (save/decide/frames/readiness/request jobs/cancel/export), worker functions (claim/defer/complete/fail/quarantine, service role); flags `animation_generation`, `ai_social_text`, `ai_social_images` **off**; shot identity review (owner confirmation required for shots with characters) and attempt cap (5 per job kind and shot version); mock clips refused at approval and export; animation exports de-duplicated by fingerprint (no second credit); **`render_jobs.project_id`, `script_revision_id`, `script_revision_number` become nullable** with a check constraint (studio export = all three; animation export = `animation_project_id`) | 9 (`render_jobs`), 11 (credit policy), 12 (AI kinds), 6 (references), 3 (flags) |
| 6 | `20261017140000_limo_character_system_v1` | M4 | design specs (18 seeded as **proposed**), reference assets + review, workspace characters; **replaces `save_studio_project_v2`** (same signature, also accepts `custom:<uuid>` cast ids); **removes direct client writes on `characters`**; updates the `character-library` bucket limits and adds its policies | 3 (`is_platform_admin_mfa`), 4 (v2), 5 only by order |

They must be applied **in this order** (dependencies above); #11 then #12 last.

No migration approves a design spec or marks any character reference as approved. In production every character stays "Reference pending" until real artwork is uploaded and reviewed.

## 2. Production impact

What production currently runs: the Vercel production deployment is 3 days old and predates the `rebuild/v1` work. Before applying, confirm which tables and functions that deployment uses. The only migration that can break an existing client is #2 (see below).

| # | Effect on existing data | Effect on existing clients | Locks / duration |
|---|---|---|---|
| 1 | none | none | new objects only |
| 2 | none (payment rows and receipts kept) | **Clients that insert into `payment_submissions` directly stop working.** The rebuild app uses `submit_payment` and answers 501 "unavailable" before the migration. | brief lock on `payment_submissions` (policy swap) |
| 3 | inserts default feature flags (paid generation and live Facebook publishing **locked off**) | none | new objects only |
| 4 | existing projects get `creation_mode='story'`, empty brief; scenes get empty narration/visual/assets | old `save_studio_project` keeps working; character-free projects become possible only through v2 | `ALTER TABLE ... ADD COLUMN` with constant defaults (metadata-only in Postgres 11+); constraint swaps validate existing rows (small tables) |
| 5 | adds one "created" revision per existing project (snapshot of current data); `script_status='draft'` for all | old saves keep working on non-approved projects; **any write to an approved script is refused**, from any client; generation runs need an approved script (generation is disabled in production anyway) | adds triggers on `studio_projects`, `project_scenes`, `generation_runs`; baseline insert is O(projects) |
| 7 | existing series get Story Bible v1 from their old JSON fields (kept under `legacy`); existing episodes get `checkpoint_status='none'`, `review_status='ok'` | clients that wrote `content_series` / `content_episodes` directly must use the functions (the rebuild app does; check the current production deployment) | new tables; small `ALTER TABLE ... ADD COLUMN` with constant defaults |
| 10 | existing posts keep their status (draft/approved) and get defaults; existing Pages/connections get `is_mock = false`, `status = active` | Milestone 6 clients keep working (same function signatures); scheduling/publishing exist only through the new functions; real Pages cannot be scheduled while `facebook_live_publishing` is off | `ALTER TABLE … ADD COLUMN` with constant defaults on small tables; constraint swap on `social_posts.status` |
| 9 | none (new tables only) | none; finished videos add rows to `media_assets` (kind `render`) and files under `workspace-assets/<org>/renders/`; exports use `used_video_slots` (one per approved revision) | new objects only |
| 8 | none (new tables only) | none; exports add rows to `media_assets` (kind `design`) and files under `workspace-assets/<org>/exports/` | new objects only |
| 11 | none deleted or truncated. `render_jobs` gains `credits`, `charge_state`, `render_fingerprint` (existing rows mapped: charged + finished = consumed, charged + running = reserved); running jobs over 30 s are cancelled and refunded, uncharged running jobs reserve their own credit or are cancelled | scripts over 30 s can no longer be approved (saving still works); exports over 30 s refused with "Videos are limited to 30 seconds"; each format uses its own credit | small `ALTER TABLE … ADD COLUMN` with constant defaults; two triggers; production has no render jobs and no projects today |
| 6 | 18 design-spec rows (proposed); `characters` gains columns with defaults; `character_catalog.reference_status` recomputed (stays `pending`: nothing is approved) | clients that wrote `characters` directly must use `save_custom_character` (the rebuild app does); `character-library` bucket gets a 100 MB limit and an image/model/video allow-list | new tables and policies; `characters` is small |

### RLS and permission changes
- #1 `rate_limit_hits`: RLS on, no client grants (written only by the SECURITY DEFINER function).
- #2 drops policy `payment_member_insert` (clients can no longer choose amounts). Adds Storage policies `payment_receipts_insert` (own workspace folder, owner/admin) and `payment_receipts_read` (own workspace or platform admin). All admin functions require `is_platform_admin()` **and** an aal2 (TOTP) session.
- #3 `feature_flags`: read for signed-in users, writes only through the MFA admin function. `provider_registry_admin_read`: MFA platform admins only.
- #4 Storage policies `workspace_assets_insert/read/delete`: the first path segment must be a workspace the user can edit (insert/delete) or belongs to (read). `brand_kits`: read for members, writes via `save_brand_kit` only.
- #5 `project_revisions`: read for workspace members, no direct client writes. Approval and restore functions check `can_edit_org`. Triggers use no elevated privileges.
- #7 `story_seasons`, `story_bible_versions`, `story_checkpoint_versions`, `story_events`: read for workspace members, no client writes. `content_series_write` / `content_episodes_write` policies dropped and write grants revoked; reads unchanged. All story functions check `can_edit_org`; continuation, approval and review rules are enforced in the database.
- #6 `character_design_specs`: read for signed-in users; changes only through MFA admin functions. `character_reference_assets`: canonical rows visible to members only when approved (all for MFA admins); workspace rows to members. `character_reference_views`: no client access. `characters`: insert/update policies dropped and write grants revoked (writes via functions; `TRUNCATE` and `anon` grants removed). Storage `character-library`: `canonical/…` upload by MFA admins only and read by members only for approved files; `<org>/custom/…` upload by workspace editors, read by members. Approving a reference requires a recorded viewing of the file by the reviewer (24 h) and a complete checklist; canonical references are reviewed by MFA platform admins, workspace references by workspace owners/admins.
- #10 New tables: read for workspace members, no client writes; `publish_jobs.simulate` (test-only failure injection) is not readable by customers (column grants). Worker functions (`claim_publish_job`, `report_publish_heartbeat`, `complete_publish_job`, `fail_publish_job`, `mock_facebook_publish`, `automation_create_post`, `record_social_webhook`) are executable by `service_role` only and check the lease holder. Authorising automation requires owner/admin of the workspace and the platform flag. Vault token functions unchanged (service role only).
- #9 `video_settings`, `render_jobs`: read for workspace members, no client writes (user functions check `can_edit_org`; media must be this workspace's files of the right type). Worker functions are executable by `service_role` only; they check the job's lease holder. No new Storage policy (the worker writes with the service role; users read through signed URLs created with their own session).
- #8 `image_projects`, `image_revisions`, `image_exports`, `social_posts`: read for workspace members, no client writes (functions check `can_edit_org`). Image layers and post images must be image assets of the same workspace. Exports must be uploaded under `<org>/exports/` (existing `workspace-assets` Storage policies) and match the design size; no new Storage policy.
- Milestone 9 privilege hardening (appended to the files, re-verified locally): #1 `rate_limit_hits` service_role only; #3 `feature_flags` and #4 `brand_kits` select-only for authenticated, nothing for anon; #7 trigger function `limo_episode_script_unapproved()` not executable by clients. Older production tables keep Supabase's default TRUNCATE/REFERENCES/TRIGGER grants — proposed cleanup `scripts/sql/proposed-grant-cleanup.sql` (separate owner decision).
- #11 adds no table access: new columns of `render_jobs` are readable by workspace members like the rest of the row; the policy, credit and trigger functions are not executable by clients (`limo_video_max_duration_ms` / `limo_video_export_credits` by `service_role` only).
- No existing policy is loosened. `anon` gets no new grants.

## 3. Before applying (backups)
1. Confirm the Supabase plan's automatic backups / point-in-time recovery in the dashboard (Database → Backups) and note the latest restore point.
2. Take a manual snapshot with the Supabase CLI (linked project):
   - `supabase db dump --linked -f backup/schema-<date>.sql`
   - `supabase db dump --linked --data-only -f backup/data-<date>.sql`
   The data dump contains customer data: keep it **outside the repository**, encrypted, and delete it after the retention period.
3. Record `supabase migration list --linked` output.
4. Owner approval in writing for this list (and for the production promotion it belongs to).

## 4. Applying
1. Deploy nothing to production yet. Apply migrations 1→5 with `supabase db push --linked` (it applies only pending files, in order) or one by one in the SQL editor.
2. Run the verification below after **each** migration; stop at the first failure.
3. Only after all checks pass, and with separate approval, promote the matching app build.

## 5. Verification (each step has been run on the local replica)
| After | Check | How |
|---|---|---|
| 1 | `hit_rate_limit` exists; 4th call in window refused | backend e2e "rate limit allows 3 calls then refuses the 4th" |
| 2 | direct insert into `payment_submissions` refused; `submit_payment` prices from the catalog; receipt isolation; admin functions refuse aal1 sessions | backend e2e payments + admin two-factor sections |
| 3 | flags readable, paid flags locked; customers cannot list workspaces or change subscriptions | backend e2e admin hardening section |
| 4 | character-free product ad saves; story still needs characters; asset isolation (Storage + RPC); in-use asset cannot be deleted | backend e2e universal creation section (16 checks) |
| 5 | conflict detection; revisions; autosave coalescing; approval lock across v2/v3/direct writes; restore; cross-workspace refusal; approved project deletion; generation gate | backend e2e script section (18 checks) + `scripts/sql/generation-gate-test.sql` (local only; disables cost triggers inside a rolled-back transaction) |
| 7 | three consecutive episodes; continuation only from the latest approved, reviewed ending with a matching fingerprint; endings limited to canon and to the episode's scenes; reopening/changing an episode flags later ones (direct/downstream) instead of rewriting; reviews in order; canon versions, conflicts, restore and removal protection; concurrency; isolation and anonymous refusal | backend e2e Story Engine section (55 checks) + browser `story.spec.ts` |
| 10 | workflow and approval rules; placeholders; media approval and invalidation; scheduling rules (Page ownership, time zone, future time, pause, live flag); duplicate and concurrent scheduling; restarts, retries, takeover idempotency, expired connections, cancellation; automation authorisation/versioning/revocation; isolation, admin and anonymous refusal | `node scripts/e2e-publish.ts` (local only: service role + publisher) + backend e2e (Milestone 6 social checks) + browser `social.spec.ts` |
| 9 | approved script required; episodes approved and reviewed; foreign media refused; idempotency; active-render limit; one slot per approved revision with refund; frozen approved timeline; worker functions not callable by users; isolation of jobs and files; failure, retry, lease takeover, cancellation | `node scripts/e2e-render.ts` (55 checks, local only: needs the service role and the worker) + backend e2e episode checks (4) + browser `video.spec.ts` |
| 8 | size/aspect check; foreign images refused; conflict, revisions, autosave, restore; placeholders block approval; approved lock; export path/size rules and library registration; post approval rules; removing image approval returns posts to draft; isolation and anonymous refusal | backend e2e Image Studio section (33 checks) + browser `images.spec.ts` |
| 11 | 30 s boundary, credits and generation | `scripts/sql/video-policy-test.sql` (20 checks, rolled back) + `node scripts/e2e-render.ts` (17 policy checks) + browser `video-policy.spec.ts`; see `VIDEO_POLICY.md` |
| 6 | 18 specs, none approved; no character approved; isolation of workspace characters and files; image cannot be registered as a rigged model; review needs viewing + checklist; customers cannot upload/see pending canonical files; custom cast ids only in their own workspace | backend e2e character sections (32 checks) + `scripts/sql/character-spec-approval-test.sql` (rolled back) |

Against production, use the backend e2e with the approved production test accounts (e2e-a / e2e-b). It creates "E2E …" projects in the test workspace only and deletes them at the end. It needs no service-role key and never touches customer workspaces. Admin sections run only when admin credentials and a TOTP secret are supplied.

Smoke checks in the dashboard after #5: `select count(*) from project_revisions` equals the number of projects; `select count(*) from studio_projects where script_status <> 'draft'` is 0.

## 6. Rollback
Rollback scripts are in `supabase/rollback/` (one per migration, newest first). They were dry-run together on the local replica inside a rolled-back transaction (`scripts/sql/rollback-dry-run.sh`).

| Undo | Loses | Precondition |
|---|---|---|
| #11 | the credit state and fingerprint columns (ledger rows stay); restores one slot per approved revision and the 10-minute limit, and the production generation functions (video slots reserved by generation again) | none |
| #10 | publish jobs, post revisions, automation policies, pause setting, simulated Pages/connections and their publications; post workflow fields (posts become draft/approved) | restores the Milestone 6 functions; post credits already used are not returned |
| #9 | render jobs and video settings | none; finished MP4s stay in the library (`media_assets` kind `render`); slots already used are not returned |
| #8 | image designs, revisions, export records, social post drafts | none; exported files stay in the library (`media_assets` kind `design`) |
| #7 | Story Bible versions, seasons, episode endings and reviews, timeline | none (episode projects and scripts stay); restores the old direct-write policies |
| #6 | design specs, reference records and review history, workspace character designs | projects casting workspace characters must be resolved first (the script stops otherwise); files stay in `character-library` |
| #5 | revision history, approval state | export `project_revisions` if needed |
| #4 | modes, briefs, narration, visual prompts, scene media links, brand kits, asset metadata | character-free projects must be resolved first (the script stops otherwise). Files in `workspace-assets` are left in place and must be exported and removed through the Storage API |
| #3 | feature flags | none |
| #2 | none (restores the old direct-insert policy, which reintroduces client-chosen amounts) | prefer fixing forward |
| #1 | rate-limit counters | #2 rolled back first |

If a migration fails halfway: apply each file wrapped in `begin; … commit;` (as was done locally with `psql -1`) so a failure leaves the database at the previous migration. Fix the cause and re-run. The files use `if not exists` / `create or replace` and were re-applied locally without errors.

## 7. Decisions needed from the owner
1. Approve applying migrations 1–14 (all, or up to a chosen number; order is fixed; #11 is the V1 video policy, #12 the AI generation foundation, #13 the AI spend guard, #14 Animation Studio + creative AI jobs). Effect of #14 on existing data: none deleted; existing render jobs keep their values (the check constraint validates them); rollback removes animation exports from `render_jobs` and restores NOT NULL. Effect of #13 on existing data and clients: none (new objects only; rollback `supabase/rollback/20261018150000_down.sql` drops them — export `ai_spend_entries` first if any real call was made).
2. Confirm what the current production deployment uses (impact of #2).
3. Backup retention and where the manual dump is stored.
4. Timing: a low-traffic window. Expected duration is seconds (small tables).

### Milestone 10 changes to unapplied files
- #3 `admin_list_workspaces` takes an optional search (workspace name, owner email or id; `%`/`_` literal): the list is capped at the 500 newest workspaces and older ones could not be found otherwise. The old no-argument version is dropped first (no ambiguous overload); calls without arguments behave as before.
- #4 creates `media_assets_kind_check` only when it is absent, so re-running #4 after #12 cannot narrow the kind list (first apply in production is unchanged).

### Migration 12 (Milestone 10) — impact, privileges, verification, rollback
- Data: none changed except that the new registry rows are inserted and the default render/export provider flips to
  the internal LIMO rows (all disabled). Existing assets keep kind/provenance (provenance null).
- Privileges: `generation_proposal_decisions` readable by workspace members, writes only via
  `decide_generation_proposal` (can_edit_org, file must come from that run); `generation_availability` is read-only
  for members. No new anon grants.
- Verification (local): applied twice (idempotent); `scripts/e2e-generate.ts` (24 checks), browser
  `ai-generation.spec.ts`, rollback dry run (12 scripts) and #12 alone.
- Rollback (`supabase/rollback/20261018120000_down.sql`): drops the decision table and functions, relabels AI files to
  `other` and drops provenance (files stay), removes the new registry rows and restores the Shotstack defaults.
