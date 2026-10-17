# Decisions

Approved product and technical decisions, newest first. Owner = project owner. "Pending" items need explicit owner approval before they touch production.

## Owner decisions
| Date | Decision |
|---|---|
| 2026-10-17 | Milestone 6 accepted for continued development; secure push of `20583e1` authorized and done. Milestone 7 (real video assembly, rendering and MP4 export) requested: background worker, approved script revision, real verified MP4s, no paid providers; Milestone 7 must not be pushed without approval. |
| 2026-10-17 | Milestone 5 accepted for continued development; secure push of the four Milestone 5 commits authorized and done (`eb441b2`). Milestone 6 (Image Studio and social post editor) requested: mock generation clearly labelled, no invented product facts, nothing published, characters not approved; Milestone 6 must not be pushed without approval. |
| 2026-10-17 | Milestone 4 accepted as a technical foundation only; the 18 characters are not visually complete or approved. Secure push of the Milestone 4 commits authorized and done (full-history secret scan clean). Milestone 5 (Story Engine) requested; Milestone 5 commits must not be pushed without approval. |
| 2026-10-17 | Milestone 3 accepted for continued development. Safe push of `rebuild/v1` authorized (only that branch, no force, no `main`, no production); pushed after checks (Vercel has no Git link, no CI, Supabase branching off). |
| 2026-10-17 | Milestone 4 requested: canonical 3D character system; no approval without visual review; no fabricated images; no paid image generation. |
| 2026-10-17 | Milestone 2 accepted for continued local development only (not production, not production migrations, not payment activation). Milestone 3 requested: full script/dialogue/scene editing with revisions, approval and labelled Mock AI. |
| 2026-10-17 | Pending production migrations stay unapplied; a separate migration review is required first (`MIGRATION_REVIEW.md`). |
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
- **Render jobs freeze the approved timeline in the database** (`spec` built by `enqueue_render_job` from the approved revision); the browser only chooses presentation (format, music, transitions, per-scene media), validated against the workspace's own files.
- **Rendering runs in a dedicated worker with a lease/heartbeat queue** on Postgres (no extra paid queue service). FFmpeg for video, the Image Studio renderer for text overlays (proper Arabic shaping).
- **One video slot per approved script revision**: extra formats of the same approved version are free; the slot is refunded when every render of that version fails or is cancelled.
- **Images are layered documents, not flattened pixels**: text stays editable, photos keep a reference to the untouched original, and the same renderer produces the preview and the download.
- **Exports are verified from the bytes** on the server (format and pixel size) before they enter the library; a mislabelled browser fallback (e.g. no WebP encoder) is refused in the browser too.
- **Mock image generation produces layouts only** from the customer's own photos and text; it never draws products or characters and never invents prices, offers or claims.
- **Unauthorized detail pages return HTTP 404** from the middleware (RLS check) instead of a streamed 200 not-found page.
- **Story continuity is enforced in the database**: continuation only from the latest approved, reviewed ending (fingerprint), endings limited to canon and the episode's own scenes, the timeline built only from approved episodes.
- **Earlier changes create reviews, not rewrites**: later episodes are flagged (direct/downstream) and must be confirmed in order by the writer.
- **Canon is user-controlled**: Story Bible changes are explicit, versioned and restorable; character identities never change; approved episodes protect the characters they use.
- **Character artwork is never generated or invented by the app.** Without an approved image-generation provider, the character system ships with written specs and empty reference slots marked "Artwork pending".
- **Approval requires evidence of review**: a recorded viewing of the file by the reviewer and a full checklist, enforced in the database.
- **Rendered images and rigged 3D models are different asset kinds** with separate file-type rules; an image can never count as a model.
- **Approved scripts are enforced in the database** (triggers), not only in the UI, so older clients (v1/v2 saves) cannot overwrite them. Removing approval is an explicit, audited action.
- **Optimistic concurrency** on saves (`base_updated_at`) instead of locks: the second writer gets a conflict and reloads; every saved version is in the history.
- **Restore never rewrites history**: it saves the old snapshot as a new revision.
- **Mock AI is a proposal engine**: it cannot change content without a field-by-field review, never invents facts, and marks fake translations as "[Mock translation → XX]".
- **Stack:** Next.js 15 App Router, strict TypeScript, Supabase (Auth, Postgres, Storage), plain CSS tokens. No extra UI framework.
- **Security boundary is the database:** every query runs as the signed-in user under RLS; writes go through `SECURITY DEFINER` functions that re-check membership/roles; API routes never accept an organisation id from the browser.
- **Additive migrations only.** New behaviour gets new functions (e.g. `save_studio_project_v2`) instead of changing signatures in place; existing functions stay for compatibility.
- **Production migration history is not self-contained** (base tables predate it). Local verification uses a schema-only dump of production as the baseline plus the pending migrations.
- **Email links use `token_hash`** via `/auth/confirm` so they work on any device; PKCE `code` links remain supported.
- **Manual payments are priced in the database** (`submit_payment`); clients cannot write amounts.
- **Mock providers are visibly labelled** ("Mock AI", "Simulated publish") and never presented as real output.
- **Heavy rendering runs in a separate worker process** (FFmpeg), never inside a Vercel request. Outputs are stored in private Storage and downloaded through short-lived signed URLs.
- **Reuse before adding:** `content_series`/`content_episodes`, `media_assets`, `characters`, `social_connections`/`facebook_pages` and vault-backed token storage are extended rather than duplicated.
