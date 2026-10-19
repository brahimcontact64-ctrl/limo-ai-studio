# Production rollout plan (migrations + app + workers)

Status: **plan only — nothing applied** (Milestone 9, 2026-10-18). Complements `MIGRATION_REVIEW.md`
(per-migration impact, RLS changes, verification and rollback tables), which stays the reference for each file.
Production project `aevqhgksniqahqrntzxv`. Every production statement below was **read-only**.

## 1. Production state (read-only checks, 2026-10-18)
- 50 migrations applied, last `20261016120000_limo_studio_project_lifecycle_v1`. A fresh schema dump differs
  from the baseline used for the local replica only by that migration (archive/restore/delete project,
  rename workspace), which the replica includes.
- Data: 4 users, 4 workspaces, 4 memberships, 1 subscription (active "creator" test subscription, renews
  2026-11-15), 1 platform admin. **Zero** projects, scenes, series, episodes, custom characters, media
  assets, payments, generation runs, content jobs, social connections, Pages, storage objects.
- Buckets: `payment-receipts`, `generated-media`, `character-library` (`workspace-assets` is created by #4).
- Consequence: data-migration risk is minimal now and grows with every real customer. **Apply before
  onboarding customers.**

## 2. Pending migrations and order
Fixed order (dependencies in MIGRATION_REVIEW §1):

| Step | File | Risk class |
|---|---|---|
| 1 | `20261016140000_limo_rate_limits_v1` | additive |
| 2 | `20261016150000_limo_subscription_activation_v1` | **behaviour change** (payment inserts only via `submit_payment`) |
| 3 | `20261017090000_limo_admin_hardening_v1` | additive (flags locked off) |
| 4 | `20261017100000_limo_universal_creation_v1` | additive + constraint swaps, new bucket |
| 5 | `20261017120000_limo_script_revisions_v1` | triggers (approved scripts read-only) |
| 6 | `20261017140000_limo_character_system_v1` | **removes direct writes on `characters`**, bucket limits |
| 7 | `20261017160000_limo_story_engine_v1` | **removes direct writes on series/episodes** |
| 8 | `20261017180000_limo_image_studio_v1` | additive |
| 9 | `20261017200000_limo_video_render_v1` | additive |
| 10 | `20261017220000_limo_social_publishing_v1` | extends/replaces social functions (same signatures) |
| 11 | `20261018090000_limo_video_policy_v1` | **behaviour change** (V1 video policy: 30 s, one credit per completed video; see VIDEO_POLICY.md) |
| 12 | `20261018120000_limo_ai_generation_v1` | additive (AI generation foundation; every provider stays disabled; see AI_GENERATION.md) |
| 13 | `20261018150000_limo_ai_spend_guard_v1` | additive (AI spend guard; pilot scope disabled; see AI_PILOT_PLAN.md) |
| 14 | `20261019090000_limo_animation_studio_v1` | additive + `render_jobs` source columns nullable (Animation Studio, creative AI jobs; flags off; see ANIMATION_PIPELINE.md) |

### Milestone 9 changes to the pending files (privileges)
The audit found that tables created by four pending migrations inherited Supabase's default grants
(`anon`/`authenticated` could hold TRUNCATE etc.; RLS still applied to row access). Grant blocks were added at
the end of the files (still unapplied, so editing them is safe):
- #1 `rate_limit_hits`: revoke all from anon/authenticated; service_role only.
- #3 `feature_flags`, #4 `brand_kits`: revoke all from anon/authenticated; `select` for authenticated (RLS policies unchanged).
- #7 `limo_episode_script_unapproved()` (trigger function): execute revoked from public/anon/authenticated.
Re-verified on the local replica: migrations re-apply cleanly, rollback dry run, SQL tests and backend e2e
(see TEST_REPORT, Milestone 9).

## 3. Compatibility with the running app
The production web deployment predates `rebuild/v1`. Steps 2, 6 and 7 refuse direct table writes that an
older client might use. With zero payments, characters, series and episodes in production, **no customer
action breaks today**, but the old app's corresponding screens would fail after the migration.
Plan: apply all ten in one maintenance window, then promote the `rebuild/v1` build immediately (gate G8).
Do **not** promote the app before the migrations: its API routes answer 501 "unavailable" when a function
is missing, but its server-rendered pages for the new features were never tested against the old schema.

## 4. Backups and recovery
Two different things — do not confuse them:
- **Rollback dry run (done, local):** `scripts/sql/rollback-dry-run.sh` runs all ten down scripts inside a
  transaction on the local replica and rolls back. It proves the scripts execute and in which order. It does
  **not** prove that production can be recovered, and down scripts discard the new data (MIGRATION_REVIEW §6).
- **Verified recovery plan (not done — gate G3):** restore a real backup of production into a separate
  project, then compare table counts and run the backend e2e smoke against it. Only that proves recovery.

Steps:
1. Confirm in the dashboard the plan's backup type (daily vs point-in-time recovery) and the latest restore point.
2. Manual dumps outside the repository, encrypted: `supabase db dump --linked -f schema.sql`,
   `--data-only -f data.sql`, plus `supabase migration list --linked`. Storage objects: none today (re-check).
3. Restore drill into a scratch project (G3), record the time it took (= realistic recovery time).

## 5. Sequencing (maintenance window)
| T | Action | Stop if |
|---|---|---|
| −1 day | G1–G6 complete; announce window (few users, no customers yet) | any gate open |
| 0 | fresh dumps (§4.2); re-run the read-only counts of §1 | counts changed unexpectedly |
| +5 min | apply #1…#12 **one file at a time**, each in a single transaction (`psql -1` or `supabase db push --linked` which applies in order) | any error: stop; the failing file left no change |
| after each | MIGRATION_REVIEW §5 checks for that step (SQL counts; e2e after all ten) | a check fails |
| +20 min | backend e2e against production with the test accounts (no service role, test workspace only) | any failure |
| +30 min | promote the matching `rebuild/v1` build (separate approval) | — |
| +40 min | browser smoke (sign-in, create product ad, approve, image, post draft) in the test workspace | — |
**Never re-run one earlier file on its own** after later ones are applied: several files replace functions
defined by earlier ones (e.g. #6 replaces `save_studio_project_v2` from #4), so re-running #4 alone would
silently restore the older function. If a re-run is ever needed, re-run that file **and every later file in
order** (all ten are idempotent: verified by an in-order re-apply on the replica, M9). This was observed on
the replica during M9 and caught by the backend e2e.
Expected database time: seconds per file (tables are empty or tiny). Locks are brief (constraint/policy
swaps on empty tables). **Downtime: none required**; a short "maintenance" notice is enough while the app is
promoted.

## 6. Data preservation checks
- Before/after: counts of users, organizations, members, subscriptions, admins must be identical.
- After #5: `count(project_revisions) = count(studio_projects)` (both 0 today).
- After #6: 18 design specs, all `proposed`; `character_catalog.reference_status` all `pending`.
- After #3 and #10: feature flags `paid_generation`, `facebook_live_publishing`, `auto_publishing` present and **off** (`custom_characters` as seeded).
- Subscription balance: the active test subscription has **no `usage_balances` row** (it was created before
  activation functions existed). Re-activate it through the admin activation (`admin_set_subscription`) or
  leave it as test-only. Real activations create the row. (Owner decision; not a migration.)

## 7. Privileges (post-apply checks)
- No public table without RLS; every SECURITY DEFINER function has a fixed `search_path` (verified on the replica).
- Worker/Vault functions executable by `service_role` only (`has_function_privilege` checks in the e2e).
- **Proposed, separate:** `scripts/sql/proposed-grant-cleanup.sql` removes TRUNCATE/REFERENCES/TRIGGER
  from anon/authenticated on all public tables (46/49 older tables carry them). Not reachable via the API
  today; defence in depth. Dry-run on the replica inside a rolled-back transaction: 0 such grants left,
  61 SELECT grants untouched. Apply only with approval (gate G6), then run the backend e2e.

## 8. Rollback limits
- Rolling back #10…#4 deletes the new data those features created (publish jobs, renders, designs, story
  canon, revisions, brand kits). With a few hours of real use this is data loss → **prefer fixing forward**.
- #6 and #4 down scripts refuse to run while projects use workspace characters / character-free projects.
- Files in Storage are never deleted by down scripts.
- Rolling back #2 restores client-chosen payment amounts — never acceptable once payments are live.
- Restoring a backup (§4) loses everything written after the restore point.

## 9. Gated checklist
| Gate | Item | Owner | Status |
|---|---|---|---|
| G1 | Written approval to apply migrations 1–14 | owner | open |
| G2 | Backup type/restore point confirmed; manual dumps stored encrypted outside git | owner | open |
| G3 | Restore drill into a scratch project succeeded (verified recovery, not just dry run) | owner + Claude | open |
| G4 | Confirm the old production deployment does not need direct writes (or accept that its screens fail) | owner | open |
| G5 | Local replica green on the final commit: rollback dry run, SQL tests, backend/render/publish e2e, browser | Claude | **done (M9)** |
| G6 | Decision on the proposed grant cleanup | owner | open |
| G7 | Window chosen; nobody onboarding customers during it | owner | open |
| G8 | Approval to promote the `rebuild/v1` build to production (separate from G1) | owner | open |
| G9 | Paid generation, live Facebook, auto-publishing flags verified **off** after apply | Claude | after apply |
| G10 | Test subscription balance decision (§6) | owner | open |
