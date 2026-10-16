# Decisions

Approved product and technical decisions, newest first. Owner = project owner. "Pending" items need explicit owner approval before they touch production.

## Owner decisions
| Date | Decision |
|---|---|
| 2026-10-16 | Master product specification (`PRODUCT_SPEC.md`) approved as canonical scope. |
| 2026-10-16 | Restored original lavender/white/purple LIMO design approved; merged into `rebuild/v1`. Metricool-inspired organisation for the app. |
| 2026-10-16 | Pricing cards must not mention Facebook posting or social publishing until implemented and tested. |
| 2026-10-16 | "Story continuity" copy must distinguish scene-to-scene continuity (available) from cross-episode continuity (future). |
| 2026-10-16 | Never merge into `main` or promote to production without explicit approval. |
| 2026-10-16 | Never touch, restart or reconfigure MagicFlux, the trading platform or unrelated Docker containers. |
| 2026-10-16 | Migration `20261016120000_limo_studio_project_lifecycle_v1` approved and applied to production (cast 1–18 fix, archive/restore/delete, workspace rename). |
| 2026-10-16 | Two production test accounts approved: `e2e-a@limo.test` (test workspace A with a 30-day creator subscription) and `e2e-b@limo.test`. |
| 2026-10-16 | Release flow: PR `rebuild/v1` → `main` for owner review; production unchanged until approval. |

## Pending owner approval
- Apply migration `20261016150000_limo_subscription_activation_v1` and later migrations to production.
- Supabase Auth settings: site URL, redirect allow-list, branded templates (`supabase/templates`), custom SMTP provider.
- Real payment destinations (entered by the owner in Admin → Payment methods).
- Paid AI providers, real Facebook/Meta integration, production promotion.

## Technical decisions
- **Stack:** Next.js 15 App Router, strict TypeScript, Supabase (Auth, Postgres, Storage), plain CSS tokens. No extra UI framework.
- **Security boundary is the database:** every query runs as the signed-in user under RLS; writes go through `SECURITY DEFINER` functions that re-check membership/roles; API routes never accept an organisation id from the browser.
- **Additive migrations only.** New behaviour gets new functions (e.g. `save_studio_project_v2`) instead of changing signatures in place; existing functions stay for compatibility.
- **Production migration history is not self-contained** (base tables predate it). Local verification uses a schema-only dump of production as the baseline plus the pending migrations.
- **Email links use `token_hash`** via `/auth/confirm` so they work on any device; PKCE `code` links remain supported.
- **Manual payments are priced in the database** (`submit_payment`); clients cannot write amounts.
- **Mock providers are visibly labelled** ("Mock AI", "Simulated publish") and never presented as real output.
- **Heavy rendering runs in a separate worker process** (FFmpeg), never inside a Vercel request. Outputs are stored in private Storage and downloaded through short-lived signed URLs.
- **Reuse before adding:** `content_series`/`content_episodes`, `media_assets`, `characters`, `social_connections`/`facebook_pages` and vault-backed token storage are extended rather than duplicated.
