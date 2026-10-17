# Pending production migration review

Status: **for owner review, not applied.** Prepared 2026-10-17 on branch `rebuild/v1`.
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

They must be applied **in this order** (dependencies above).

## 2. Production impact

What production currently runs: the Vercel production deployment is 3 days old and predates the `rebuild/v1` work. Before applying, confirm which tables and functions that deployment uses. The only migration that can break an existing client is #2 (see below).

| # | Effect on existing data | Effect on existing clients | Locks / duration |
|---|---|---|---|
| 1 | none | none | new objects only |
| 2 | none (payment rows and receipts kept) | **Clients that insert into `payment_submissions` directly stop working.** The rebuild app uses `submit_payment` and answers 501 "unavailable" before the migration. | brief lock on `payment_submissions` (policy swap) |
| 3 | inserts default feature flags (paid generation and live Facebook publishing **locked off**) | none | new objects only |
| 4 | existing projects get `creation_mode='story'`, empty brief; scenes get empty narration/visual/assets | old `save_studio_project` keeps working; character-free projects become possible only through v2 | `ALTER TABLE ... ADD COLUMN` with constant defaults (metadata-only in Postgres 11+); constraint swaps validate existing rows (small tables) |
| 5 | adds one "created" revision per existing project (snapshot of current data); `script_status='draft'` for all | old saves keep working on non-approved projects; **any write to an approved script is refused**, from any client; generation runs need an approved script (generation is disabled in production anyway) | adds triggers on `studio_projects`, `project_scenes`, `generation_runs`; baseline insert is O(projects) |

### RLS and permission changes
- #1 `rate_limit_hits`: RLS on, no client grants (written only by the SECURITY DEFINER function).
- #2 drops policy `payment_member_insert` (clients can no longer choose amounts). Adds Storage policies `payment_receipts_insert` (own workspace folder, owner/admin) and `payment_receipts_read` (own workspace or platform admin). All admin functions require `is_platform_admin()` **and** an aal2 (TOTP) session.
- #3 `feature_flags`: read for signed-in users, writes only through the MFA admin function. `provider_registry_admin_read`: MFA platform admins only.
- #4 Storage policies `workspace_assets_insert/read/delete`: the first path segment must be a workspace the user can edit (insert/delete) or belongs to (read). `brand_kits`: read for members, writes via `save_brand_kit` only.
- #5 `project_revisions`: read for workspace members, no direct client writes. Approval and restore functions check `can_edit_org`. Triggers use no elevated privileges.
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

Against production, use the backend e2e with the approved production test accounts (e2e-a / e2e-b). It creates "E2E …" projects in the test workspace only and deletes them at the end. It needs no service-role key and never touches customer workspaces. Admin sections run only when admin credentials and a TOTP secret are supplied.

Smoke checks in the dashboard after #5: `select count(*) from project_revisions` equals the number of projects; `select count(*) from studio_projects where script_status <> 'draft'` is 0.

## 6. Rollback
Rollback scripts are in `supabase/rollback/` (one per migration, newest first). They were dry-run together on the local replica inside a rolled-back transaction (`scripts/sql/rollback-dry-run.sh`).

| Undo | Loses | Precondition |
|---|---|---|
| #5 | revision history, approval state | export `project_revisions` if needed |
| #4 | modes, briefs, narration, visual prompts, scene media links, brand kits, asset metadata | character-free projects must be resolved first (the script stops otherwise). Files in `workspace-assets` are left in place and must be exported and removed through the Storage API |
| #3 | feature flags | none |
| #2 | none (restores the old direct-insert policy, which reintroduces client-chosen amounts) | prefer fixing forward |
| #1 | rate-limit counters | #2 rolled back first |

If a migration fails halfway: apply each file wrapped in `begin; … commit;` (as was done locally with `psql -1`) so a failure leaves the database at the previous migration. Fix the cause and re-run. The files use `if not exists` / `create or replace` and were re-applied locally without errors.

## 7. Decisions needed from the owner
1. Approve applying migrations 1–5 (all, or up to a chosen number; order is fixed).
2. Confirm what the current production deployment uses (impact of #2).
3. Backup retention and where the manual dump is stored.
4. Timing: a low-traffic window. Expected duration is seconds (small tables).
