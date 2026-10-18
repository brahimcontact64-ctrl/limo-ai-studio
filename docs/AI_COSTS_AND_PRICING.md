# AI costs, controls and pricing recommendations (Milestone 10)

Prices: researched **2026-10-18** on the official pricing pages (sources in `AI_PROVIDERS.md`); not yet verified by
the owner, so they are blocked in code until verified. Token counts, file sizes and attempt counts below are
**assumptions** (marked *assumed*), chosen to be realistic for LIMO's 30-second videos; real usage is measured per
call and settled against the reservation. Nothing here changes a plan, a price or an entitlement.

## 1. Cost per operation (USD)
| Operation | Provider / model | Assumed size | Cost |
|---|---|---|---|
| Script draft (30 s, 5 scenes) | Claude Opus 5.5 ($4 / $20 per M tokens) | 2,500 in + 1,500 out tokens | $0.040 |
| Rewrite one paragraph | Claude Opus 5.5 | 1,200 in + 400 out | $0.013 |
| Facebook caption (3 proposals) | Claude Opus 5.5 | 1,000 in + 500 out | $0.014 |
| Story continuation with Story Bible | Claude Opus 5.5 | 6,000 in + 2,000 out | $0.064 |
| Translation of a 30 s script | Claude Opus 5.5 | 1,000 in + 1,200 out | $0.028 |
| Scene prompts for generation (5 scenes) | Claude Opus 5.5 | 2,000 in + 1,700 out | $0.042 |
| Same text work on Claude Sonnet 5.5 ($2 / $10) | | | half of the above |
| Safety pre-check (text + images) | OpenAI omni-moderation | — | $0 (free) |
| Image 1K (product scene) | Gemini Nano Banana 2.1 | + ~300 prompt tokens | ≈ $0.034 |
| Image 2K | Gemini Nano Banana 2.1 | | ≈ $0.051 |
| Image edit with 1 product photo | Gemini Nano Banana 2.1 1K | + ~900 input tokens | ≈ $0.035 |
| Character sheet 2K (canonical artwork) | Gemini 3 Pro Image | + ~1,500 input tokens | ≈ $0.137 |
| Video clip, per second | Veo 3.1 Lite 720p / Fast 720p / Fast 1080p / Standard 720p | — | $0.05 / $0.10 / $0.12 / $0.40 |
| Narration of a 30 s video | ElevenLabs Flash v2.5 ($0.04 per 1k chars) | ~450 characters | $0.018 |
| Same on Multilingual v2 ($0.08 per 1k) | | | $0.036 |
| Transcription of 30 s | OpenAI whisper-1 ($0.006 / min) | | $0.003 |
| MP4 assembly (FFmpeg worker) | LIMO render worker | 30 s at 1080p ≈ 45 CPU-seconds (measured) | host price × CPU time (host not chosen) |
| Storage of one exported video | Supabase Pro ($0.0213 / GB-month over 100 GB) | ~10 MB *assumed* | ≈ $0.0002 per month |
| One download of that video | Supabase egress ($0.09 / GB over 250 GB) | ~10 MB *assumed* | ≈ $0.0009 |

Veo clips are 4, 6 or 8 s (8 s with character references or above 720p); a 30 s video is generated as clips per
scene, so the generated seconds can exceed 30 (e.g. 5 × 8 s = 40 s with references). Google does not charge for
videos it blocks.

## 2. Sample totals for one 30-second video (5 scenes)
| Variant | Script prompts | Images (5) | Video | Voice | Provider total | Reserved (+25 % retry buffer) |
|---|---|---|---|---|---|---|
| Assembly only (customer media, no AI) | — | — | — | — | $0 | $0 (1 video credit) |
| AI pictures only (stills animated by the renderer) | $0.042 | $0.17 | — | $0.018 | ≈ $0.23 | ≈ $0.29 |
| AI clips, Veo Lite 720p, 5 × 6 s | $0.042 | $0.17 | $1.50 | $0.018 | ≈ $1.73 | ≈ $2.16 |
| AI clips, Veo Fast 720p, 5 × 6 s | $0.042 | $0.17 | $3.00 | $0.018 | ≈ $3.23 | ≈ $4.04 |
| AI clips with characters, Veo Fast 720p, 5 × 8 s | $0.042 | $0.18 | $4.00 | $0.018 | ≈ $4.24 | ≈ $5.30 |
| Same at Veo Standard 720p | $0.042 | $0.18 | $16.00 | $0.018 | ≈ $16.24 | ≈ $20.30 |
The video credit (one per finished export) is separate from these provider costs and is consumed only by the
MP4 export (V1 video policy).

One-off: canonical character artwork — 54 required sheets × $0.137 ≈ $7.40 per pass; with an assumed 3 attempts per
accepted sheet ≈ $22; the full 252-sheet set ≈ $34.50 per pass (≈ $104 at 3 attempts).

## 3. What the current plans would cost if AI video were included (they are not)
Current plans (catalog, unchanged): Starter 5,900 DZD / 23 USDT (6 video credits, 10 AI images); Creator
12,900 DZD / 50 USDT (15 credits, 30 AI images); Business 24,900 DZD / 95 USDT (30 credits, 80 AI images).
- Included AI images cost ≈ $0.34 / $1.02 / $2.72 per month — sustainable.
- If every video credit were a Veo Fast AI video: ≈ $19 / $48 / $97 per month against prices of 23 / 50 / 95 USDT —
  **not sustainable** (no margin before infrastructure). Video credits must stay "assembly exports", and AI video
  must be a separate, limited allowance.

## 4. Recommendation (owner decision — nothing activated or changed)
Principles: AI provider cost ≤ 30 % of the plan price; AI video sold in seconds of generated footage; every paid
call pre-estimated, reserved, confirmed and settled; unknown prices block.
| Plan (the request calls it Starter / Pro / Business; the catalog has starter / creator / business) | Video credits (exports ≤ 30 s) | AI images | AI text help | AI video included | Est. AI cost / month | Share of price |
|---|---|---|---|---|---|---|
| Starter (23 USDT) | 6 (unchanged) | 10 (unchanged) | fair use ≈ 50 actions | 0 s (add-on only) | ≈ $1.0 | ≈ 4 % |
| Creator / Pro (50 USDT) | 15 (unchanged) | 30 (unchanged) | ≈ 150 actions | 60 s Veo Lite | ≈ $6.0 | ≈ 12 % |
| Business (95 USDT) | 30 (unchanged) | 80 (unchanged) | ≈ 400 actions | 180 s Veo Fast | ≈ $25 | ≈ 26 % |
Add-on proposal: "AI video pack" of 30 s Veo Fast at ≈ $10 (≈ 3× its ≈ $3.23 provider cost; ≈ 2,560 DZD at the
catalog's own 5,900 DZD = 23 USDT ratio). Character videos (8-second clips) count their real generated seconds.
These numbers must be re-checked with verified prices and the chosen worker host before any price change.

## 5. Cost controls in code (all implemented and tested; providers disabled)
| Control | Where |
|---|---|
| Verified provider price (unknown or > 30 days old ⇒ blocked) | `operationCost`, `sheetFromRegistry` (registry `verified_at`) |
| Pre-flight estimate per operation and per run | `buildPlan` (operations, costs, retry buffer), `preflight` |
| Exact amount shown and confirmed by the customer | `generation_availability` + confirm-cents check in `POST /api/projects/[id]/generation` |
| Workspace entitlement and budget reservation | `request_studio_generation` → `reserve_ai_budget` (monthly AI budget per workspace) |
| Maximum spend per run | per-operation check: remaining reservation (`gateFor` → `paidCallBlockers`) |
| Idempotency | operation keys (revision + scene + prompt + model); identical results reused, provider task ids stored before polling |
| Usage logging | stage `actual_cost_cents`, provenance on every file, run totals, AI budget settlement |
| Failure / refund | `fail_generation_stage` settles the budget (release when nothing was spent); video credit untouched |
| Explicit activation | `LIMO_GENERATION_MODE=live` + `LIMO_ENABLE_PAID_GENERATION=true` + `paid_generation` flag + provider rows enabled and verified |
| No silent fallback after refusals; bounded retries | `nextRetryDelay`, `chooseFallback`, executor tests |

## 6. Spending alerts (prepared; no paid monitoring service activated)
SQL the owner can schedule or run from the admin dashboard:
```sql
-- AI spend this month per workspace vs budget (alert at 50 / 80 / 100 %)
select o.id, o.name, o.monthly_budget_cents,
       coalesce(sum(r.committed_cost_cents), 0) as committed_cents,
       round(100.0 * coalesce(sum(r.committed_cost_cents), 0) / nullif(o.monthly_budget_cents, 0)) as pct
from organizations o
left join ai_cost_reservations r on r.organization_id = o.id and r.billing_month = date_trunc('month', now() at time zone 'UTC')::date
  and r.status in ('reserved', 'completed', 'needs_reconciliation')
where o.monthly_budget_cents > 0
group by o.id having coalesce(sum(r.committed_cost_cents), 0) >= 0.5 * max(o.monthly_budget_cents);

-- Runs whose actual cost could not be settled automatically
select id, organization_id, estimated_cost_cents, actual_cost_cents, failure_code from generation_runs where status = 'needs_reconciliation';
```
Platform-wide caps already exist in `platform_generation_limits` (active runs per workspace, request rate).
