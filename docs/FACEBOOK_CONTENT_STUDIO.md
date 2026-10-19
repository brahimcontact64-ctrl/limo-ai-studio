# Facebook Content Studio — architecture and status (2026-10-19)

Part of the full LIMO platform (PRODUCT_SPEC §1, §11–§13). Real Meta OAuth, Page permissions and live publishing stay
**disabled** until the owner approves them and Meta's app review is done (FACEBOOK_INFRASTRUCTURE.md). Real AI is
connected behind **disabled-by-default flags**; no paid call has been made.

## 1. How AI content is produced
Composer / Image Studio → `POST /api/ai-jobs` (kind `social_caption`, `social_rewrite` or `social_image`; the server
adds the workspace's Brand Kit name, CTA, tone and colours) → `request_social_ai_job` (flag `ai_social_text` or
`ai_social_images`, editor of the workspace, language ar/fr/en/de) → table `ai_jobs` → generator worker
(`worker/src/ai-jobs.ts`) → provider or labelled mock → result as a **proposal** → the customer reviews, edits and
accepts it field by field (captions) or adds the picture to the design's photos (images). Nothing is applied, saved
as a post, approved or published automatically.

Real provider path (when the owner activates it): Claude `post_caption` / `rewrite` (facts only, invented numbers
flagged), Gemini image (no text in the pixels; headlines and prices stay editable layers). Each call needs
`paid_generation` + the kind's flag, an enabled registry row with an owner-verified price, the confirmed amount, the
workspace AI budget (`reserve_ai_budget` → `settle_ai_budget`) and the platform spend guard (`LIMO_AI_SPEND_SCOPE`).
Outputs are stored privately in `workspace-assets/<org>/generated/jobs/<job>/…` with provenance (provider, model,
request key, prompt hash, mock/AI label). Workspace isolation: RLS on `ai_jobs` and `media_assets`, editor role for
requests, service role for the worker; tested in SQL, backend and browser.

## 2. Status by feature
| # | Feature | Status |
|---|---|---|
| 1 | AI captions, titles, descriptions, hashtags | **Real AI connected behind `ai_social_text` (off)**; Mock AI drafts remain the default; mock job results labelled "no AI was used" |
| 2 | AI caption rewriting | **Real AI connected behind `ai_social_text` (off)** (shorter / longer / warmer / professional / translate); existing mock paragraph tools kept |
| 3 | AI promotional images | **Real AI connected behind `ai_social_images` (off)** in Image Studio → New image (added to the design's photos) |
| 4 | Product / restaurant marketing content | business types, facts and purposes feed both mock and real requests |
| 5 | Brand Kit | name, CTA, tone, colours sent with every AI request; logo/colours in Image Studio; brand fonts not stored in the kit |
| 6 | Human review and editing | every AI result is a proposal; per-field acceptance never overwrites edited fields silently |
| 7 | Calendar and scheduling | implemented (month calendar, time-zone-aware scheduling, durable queue) |
| 8 | Multilingual ar / fr / en / de | implemented (UI and generation language; translation mode) |
| 9 | Isolation and usage accounting | RLS + editor role; AI costs via workspace AI budget + platform spend guard; job ledger in `ai_jobs` |
| 10 | Secure storage and provenance | private bucket, signed URLs (10 min), provenance on every generated file |
| 11 | Multi-Page management | data model + simulated Pages; real Page connection **blocked** (Meta review, owner approval) |
| 12 | Automated publishing via Meta APIs | **mock publisher only** (state machine, retries, history preserved) |
| 13 | Bulk content planning | **prepared, not built**: the job queue already accepts many independent requests with idempotent keys; a bulk planner would create N caption/image jobs + N draft posts for calendar slots and reuse the same review and approval flow |

## 2a. Verified workflow (browser, 2026-10-19, `tests/e2e/facebook-flow.spec.ts`, desktop + mobile)
Brand Kit → simulated Page → AI promotional image proposal (mock job) added to the design's photos → business brief +
facts → AI caption proposal (mock job, uses the Brand Kit name and call to action) → per-field acceptance → the
"[Mock …]" markers block approval until a person rewrites them → library image attached → review → approval →
calendar → scheduled → simulated publishing by the publisher ("Nothing was posted on Facebook") → revision history.
Paid AI (`paid_generation`) stayed off; the two AI flags were switched on only for the test and restored.

## 3. Turning it on (owner decisions, in order)
1. Pilot first (AI_PILOT_PLAN.md): accounts, deposits, keys in the generator environment, verified prices.
2. Enable `paid_generation`, then `ai_social_text` and/or `ai_social_images` (Admin → feature flags), and the
   workspace's AI budget. Generator in live mode with `LIMO_AI_SPEND_SCOPE`.
3. Watch `ai_jobs` failures and the spend ledger (PRODUCTION_READINESS_REVIEW.md §7).
