# Facebook infrastructure — inspection findings (Milestone 8, Part B)

Inspected on 2026-10-18 before building the Facebook workflow: the local replica of the production
schema (all applied production migrations + pending ones), the `app/` repository (including `legacy-v1/`
and `supabase/legacy/`), and the parent folder of this checkout. No other project was opened.

## What existed

| Object | Origin | State | Decision |
|---|---|---|---|
| `social_connections` (org, provider = facebook only, external user id, `token_secret_ref`, status connected/expired/revoked, `expires_at`) | production migration `20261015133509_limo_oauth_vault_foundation` | table + member read policy, **0 rows**, no client writes | **Reused** and extended (`is_mock`, `scopes`, `last_error`, `disconnected_at`) |
| `facebook_pages` (org, connection, page id/name, `token_secret_ref`, `selected`) | `20261015133612_limo_facebook_selection_limits` | 0 rows | **Reused** and extended (`is_mock`, `status`, `max_posts_per_hour`) |
| `select_facebook_pages(org, page_ids)` | same | enforces the plan's Page limit (`usage_balances.base/extra_facebook_pages`) | Kept unchanged; the same limit is applied to simulated Pages |
| `store_oauth_secret` / `update_oauth_secret` / `read_oauth_secret` | `20261015133509` | Supabase Vault wrappers, **execute granted to `service_role` only** | Kept as the token store for real Pages (never readable by customers or platform admins through the API) |
| `social_oauth_states`, `consume_social_oauth_state`, `cleanup_expired_social_oauth_states` | `20261015133509` | one-time OAuth state, service role only | Kept for the future OAuth flow; not used yet |
| `publishing_approvals` | production base | references the legacy `content_projects` table, 0 rows | **Not reused** (tied to the legacy model); left untouched |
| `feature_flags`: `facebook_live_publishing` (locked in the admin UI), `auto_publishing` (off) | `20261017090000` (pending) | both `false` | Used as the platform gates for live publishing and automation |
| `social_posts` (caption, hashtags, image, draft/approved) | `20261017180000` (Milestone 6, pending) | — | **Extended** into the full workflow; its functions keep working |
| `content_jobs` + `claim/complete/fail_content_job` | production | built for AI generation (safety review, provider cost) | Not used for publishing; a dedicated `publish_jobs` queue fits the lease/retry/idempotency needs |
| `usage_balances.used_posts`, `usage_ledger` | production | plan allowance for posts | Reused: one post credit per scheduled publication, refunded when it does not happen |
| `platform_audit_events` | production | admin audit log | Reused for every workflow step |

## No existing Facebook automation
- No code in this repository calls the Graph API. `legacy-v1/` only shows a disabled "Connect Facebook
  (OAuth next)" button and an environment check for `META_APP_ID` / `META_APP_SECRET` / `META_REDIRECT_URI`.
- `SECURITY.md` states that OAuth stays disabled until token storage is reviewed.
- No Meta app credentials are configured in the environment of this checkout, and no external automation
  service was found. The design therefore assumes none exists.

## Consequences for Milestone 8
- Real Pages will come from a Meta OAuth flow (not built): tokens go to Vault through the service role;
  only the publisher (service role) reads them; customers and platform admins never receive them.
- Until owner approval and Meta app review, Pages are **simulated** (`is_mock`) and published through the
  mock adapter, which writes to `mock_facebook_publications` and makes no network call.
