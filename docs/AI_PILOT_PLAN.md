# $10 internal AI pilot — plan, safeguards and approvals

Status: **prepared, not executed** (2026-10-18). No account was opened, no deposit made, no key created, no paid
request sent. $10 is a **planning ceiling**, not permission to spend: every step below needs the owner's go.
Prices are the researched list prices of 2026-10-18 (docs/AI_PROVIDERS.md) and must be re-verified on the day.

## 1. Scope
- **One isolated internal workspace** (e.g. "LIMO AI pilot (internal)") on the **local replica** (`limo-local-e2e`),
  owned by the owner's admin account. No customer workspace, no production database, no production deploy, no
  Facebook publishing. Running it locally means pending migrations #12/#13 never touch production for the pilot.
- **Output:** one French restaurant advertisement, **≤ 30 s** (V1 policy), 9:16, exported as MP4 by the existing
  render worker (one video credit in the pilot workspace; AI generation never uses export credits).

## 2. Providers for the pilot (two accounts only, both with hard caps)
| Need | Pilot provider / model | Why (instead of the M10 default) |
|---|---|---|
| Script, rewrite, Arabic translation, scene prompts | Anthropic `claude-opus-5-5` | prepaid credits + a user-set spend limit that is a hard stop |
| Safety pre-check | Anthropic (same model, `LIMO_SAFETY_PROVIDER=anthropic`) | avoids a third (OpenAI) account; OpenAI moderation stays the production default |
| Scene images | Google `gemini-nano-banana-2.1`, 1K | per-image price, same Google account |
| One AI clip | Google `veo-3.1-lite-generate-preview` 720p (Fast only if Lite is not good enough) | cheapest documented Veo tier |
| Narration | Google `gemini-3.8-flash-tts` (`LIMO_VOICE_PROVIDER=google`, voice `Kore`) | ElevenLabs has no documented hard spend cap and needs a subscription for commercial use |
| Character front view | Google `gemini-3-pro-image` | most reference capacity for later sheets |

## 3. Steps, estimated cost and permitted requests
| # | Step | Runs through | Est. cost (list price) | Bucket |
|---|---|---|---|---|
| 1 | French script draft from the owner's facts | `node scripts/ai-pilot.ts --step script` | $0.043 | text |
| 2a | Rewrite (warmer, ≤ 30 s spoken) | `--step rewrite` | ≈ $0.02 | text |
| 2b | Arabic translation of the approved French text | `--step translate` | ≈ $0.01–0.03 | text |
| — | Owner enters the reviewed script in the pilot project and approves it (app) | UI | $0 | — |
| 3 | Safety review + scene prompts | Video step → Generate (generator worker) | ≈ $0.014 + $0.042 | text |
| 3 | 2–3 scene images, 1K | generator worker | $0.034 each → ≤ $0.10 | image |
| 4 | One clip, 4–8 s, 720p (only if the verified price fits) | generator worker | Lite $0.20–0.40 · Fast $0.40–0.80 | video |
| 5 | French narration (≈ 30 s) | generator worker | ≈ $0.01 | voice |
| 6 | Apply proposals, export the MP4 | app + render worker | $0 provider | — |
| 7 | (separate approval) LIMO front view, see §6 | `--step character-front` | $0.24 per attempt, max 3 | image |

**Expected total:** ≈ $0.66 (Veo Lite) to ≈ $1.06 (Veo Fast) for the ad, + ≤ $0.72 for the character = **≤ $1.78**.

**What the caps allow** (whole cents per operation, as the guard counts):
text $2 ≈ 40 calls at ≤ 5 ¢ · images $2 = 50 Nano Banana images at 4 ¢ or 8 Pro 4K images at 25 ¢ ·
video $3 = 7 Lite 8 s clips (40 ¢), 15 Lite 4 s clips or 3 Fast 8 s clips (80 ¢) · voice $1 ≥ 50 narrations
(2 ¢ reserved each) · $2 contingency = never handed out to new operations, it absorbs bills above the reservation.

## 4. Safeguards (implemented and tested, all inactive)
| Requirement | Implementation | Test |
|---|---|---|
| Hard $10 application limit | `ai_spend_guards` scope `pilot` (migration 20261018150000, seeded **disabled**); reservations refused above `limit_cents`; reaching it switches the scope off | SQL test, unit tests |
| Per-operation and per-provider-capability limits | `max_operation_cents` = 100; bucket caps text 200 / image 200 / video 300 / voice 100 | SQL + unit |
| Reservation before every paid call | `executeOperation` / `submitOperation` reserve the worst case (estimate × allowed attempts) before the first byte; settle at actual cost or release | unit (`reservedAtSend`) |
| Unknown prices blocked | unverified/stale/expired sheet → `price_unverified` (no estimate, no call); Gemini TTS price ends 2026-12-31 → stale after | unit |
| No unapproved paid retries or fallback | `LIMO_AI_MAX_ATTEMPTS=1` (forced by the runner); a released key needs `retry_requires_approval`; no fallback after a refusal (M10 rule) | SQL + unit |
| Concurrency | scope row `FOR UPDATE` + unique `(scope, op_key)` | 20 real DB sessions → exactly 10 × $1 accepted; same key ×5 → 1 |
| Immediate kill switch | DB: `admin_set_ai_spend_guard(scope, false, reason)` (MFA admin, audited) — next reservation refused by every worker; env: `LIMO_AI_KILL_SWITCH=on` per process | SQL + unit |
| Failed/refused calls | not-billed errors released; billed Claude refusals (bio, frontier_llm, reasoning_extraction, or after partial output) settled at their usage; timeouts/unknown charged at the reservation and flagged `needs_reconciliation` | unit |
| Secrets outside Git and the browser | keys only in the generator/runner process env (server, never `NEXT_PUBLIC_*`); `.env*` ignored; web app never calls providers | grep: only `worker/src/generator.ts` and `scripts/ai-pilot.ts` build live adapters |
| Usage/billing reconciliation | `ai_spend_entries` (op key, provider request id, reserved, actual, flag); `ai_spend_reconcile` after checking the provider's usage page | SQL |
| Human approval of assets | results are proposals (applied/rejected per scene); runner output is written to a local folder for review; character art only via admin upload + checklist + MFA approval | existing M10 tests |
| No customer access | pilot runs on the local replica; production keeps `paid_generation` off and providers disabled | — |

## 5. Provider-side caps and the safer setup
| Provider | Hard external cap | Notes (verified 2026-10-18) |
|---|---|---|
| Google Gemini API | **Prepay**: requests stop at a $0 balance (HTTP 402). Minimum top-up **$5**, max $5,000; tier caps also stop traffic | project spend caps exist but are experimental and enforced with ≈ 10 min delay; failed 400/500 requests are not charged; blocked Veo videos are not charged; credits non-refundable, expire after 1 year |
| Anthropic | A **user-set spend limit** below the tier cap is a hard stop; prepaid credits | minimum purchase **not confirmed** on the pages read; credits non-refundable, expire after 1 year; failed requests not billed |
| OpenAI (not in the pilot) | hard spend limits exist; alerts are notification-only | prepaid minimum unverified |
| ElevenLabs (not in the pilot) | **no documented hard cap / overage switch** (help page not readable) | Starter $6/month (first month $1); commercial use needs a paid plan |

**Recommended setup:** a dedicated Google Cloud project + billing account on **prepay with $5 and no auto-reload**,
and an Anthropic workspace with prepaid credits and a **spend limit of $3**. Then the most money that can ever leave is
what was deposited (≈ $5 + the Anthropic minimum), even if a key leaked, and the LIMO guard keeps actual usage under
$10. **Cash vs budget:** deposits are paid up front and are non-refundable; unused credit stays unused but is not
returned (it expires after a year). If the Anthropic minimum is $5 the outlay is ≈ $10 for ≈ $1–2 of usage.

**Worst-case exposure:** prepaid deposits (hard) — Google $5 + Anthropic deposit. Within LIMO: $10 total, ≤ $1 per
operation; the only way past an operation's reservation is a provider billing more than estimated, which is recorded,
absorbed by the $2 contingency and stops the scope at the limit.

## 6. Character artwork pilot — ONE canonical LIMO front view
- **Character:** `limo_man` (LIMO family, adult male) — the order of work in `lib/characters/artwork.ts`. All 18 specs
  stay as they are (status *proposed*); the owner first reads and approves `limo_man` spec v1 in Admin → Characters.
- **Visual direction** (CHARACTER_REFERENCE_GUIDE §1): premium stylized 3D, no photorealism; glossy tomato head (four
  lobes, wider than tall), five-point green calyx with stem tilted right; key 45° left-above, fill 40 % right, rim
  behind; background `#EFECF7`; 50 mm at chest height, centred, 8 % margin; neutral standing pose, arms ≈ 15°;
  everyday outfit (blue `#2F6FDB` shirt, rolled sleeves, `#F4F1EA` chinos); neutral expression.
- **Workflow:** `node scripts/ai-pilot.ts --step character-front` (dry run shows the exact prompt and estimate) →
  live run after approval (Gemini 3 Pro Image, text-only, 3:4, 4K tier for ≥ 2048 × 2730 px; SynthID) → file saved
  locally → owner reviews → if accepted, a platform admin uploads it as `rendered_reference`, view `front`, source
  "AI-generated (Gemini 3 Pro Image)", and approves with the checklist (MFA). Rejected → adjust the prompt wording
  only (never the spec) and run the next attempt; **stop after 3 attempts** ($0.72).
- **Consistency requirements** for the later views: the approved front becomes the identity reference for
  three-quarter and side (`geminiCharacterAdapter`, ≤ 5 character references); same light rig, camera, outfit and
  palette; heights in head units (adult 3.4).
- **Human acceptance checklist** (app-enforced + pilot extras): matches spec (crown, face, colours) · proportions
  (≈ 3.4 heads, head 1.15× shoulders) · palette (`#E8412C` skin, `#3E9B3F` crown, `#3B2A20` iris) · family-friendly ·
  front view · no text/logos/watermarks · four fingers, no hair · resolution ≥ 2048 × 2730 · would work as the identity
  lock for side/three-quarter.
- **Cost:** $0.24 per attempt at 4K (+ ≈ $0.001 prompt tokens); if a 2K output already meets 2048 × 2730 the owner may
  choose 2K at $0.134 (the 2K pixel size for 3:4 is **unverified**).

## 7. Environment variables (names only; values never in Git)
Required for the pilot: `LIMO_GENERATION_MODE=live`, `LIMO_ENABLE_PAID_GENERATION=true`, `ANTHROPIC_API_KEY`,
`GEMINI_API_KEY`, `LIMO_AI_SPEND_SCOPE=pilot`, `LIMO_AI_MAX_ATTEMPTS=1`, `LIMO_VOICE_PROVIDER=google`,
`LIMO_SAFETY_PROVIDER=anthropic`, `LIMO_VEO_TIER=lite`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (local replica).
Optional: `LIMO_CLAUDE_MODEL`, `LIMO_NARRATOR_VOICE_ID` (default `Kore` with Google TTS), `LIMO_AI_KILL_SWITCH`.
Not used by the pilot: `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`.

## 8. Test order and success criteria
1. Dry run every runner step (no network) — prompt and estimate reviewed.
2. Step 1 live — valid JSON scenes, ≤ 30 s, no invented numbers (`invented_facts` empty), cost ≤ 5 ¢ settled.
3. Steps 2a/2b — natural French; Arabic reviewed by a fluent reader; business name unchanged.
4. Owner approves the script in the pilot project; Generate with images + voice only (video off) — 2–3 images
   without text in the image, narration audible and in sync (estimated subtitle timing checked by eye).
5. One clip (Lite 4 s first) — plays, matches the scene, cost = seconds × verified price.
6. Apply proposals, export MP4 — ≤ 30 s, one credit consumed, AI provenance shown.
7. Reconcile: `ai_spend_entries` totals = Google and Anthropic usage pages (± 1 ¢ per op); no entry left `reserved`.
8. (Separate approval) character front view, ≤ 3 attempts.
**Pilot passes** when the MP4 is acceptable to the owner, total spend ≤ $10 (expected < $2), every call is in the
ledger and reconciled, and no safeguard was bypassed. Any surprise (bill above estimate, refusal, wrong output) →
kill switch, write it down, decide before continuing.

## 9. Approvals needed before the first real AI call
1. Approve this plan and the provider choice (Anthropic + Google only).
2. Owner opens the accounts and pays the deposits (Google prepay $5, no auto-reload; Anthropic prepaid + $3 limit),
   accepting that deposits are non-refundable; legal check of the Gemini terms (18+, not for apps directed at
   minors) for the LIMO audience.
3. Keys created by the owner and placed only in the local runner/worker environment.
4. Apply migrations #12 and #13 **on the local replica only** (already applied locally for testing).
5. Re-verify the prices on the official pages and record them (registry `pricing_metadata` + `verified_at`) for
   `anthropic_script_v1`, `anthropic_safety_v1`, `google_image_v1`, `google_video_lite_v1`, `google_tts_v1`
   (and `google_character_image_v1` for step 7).
6. Enable those registry rows, the `paid_generation` flag and the `pilot` spend scope (local replica).
7. Provide the real facts for the ad (brief file) and a go for each step in §8.
