# Next phase — real AI providers (text, image, video, voice)

Status: **plan for owner decision. Nothing here is activated.** Paid generation stays behind the locked
`paid_generation` flag and the cost/provider gates already in the database.

> Milestone 10 implemented this plan: provider research and selection in `AI_PROVIDERS.md`, the architecture,
> safety rules and activation checklist in `AI_GENERATION.md`, costs and pricing in `AI_COSTS_AND_PRICING.md`.
> The sections below remain the original criteria.

## 1. What already exists (reuse)
- Provider contract `lib/generation/types.ts` (`ProviderAdapter`: capabilities, `estimate`, `submit`,
  `poll`, idempotent request keys), the free `MockProvider`, the cost estimator `lib/generation/cost.ts`
  and the live-generation gate `lib/generation/gate.ts`.
- Database: `ai_provider_registry` (all providers disabled), `generation_cost_policies`, `generation_runs`
  / `generation_run_stages`, `content_jobs` (safety review state, provider cost), `reserve_ai_budget`,
  usage balances and ledger, `feature_flags.paid_generation` (locked).
- Mock adapters in the product: script assistant (`lib/ai/script.ts`), image layouts
  (`lib/images/mock.ts`), Facebook composer (`lib/social/compose.ts`). Each real adapter replaces one of
  these behind the same interface; the mock stays for tests and as the fallback when budgets are exhausted.
- Rendering (Milestone 7) and publishing (Milestone 8) workers show the job pattern to follow: durable
  queue, lease + heartbeat, retries with back-off, idempotency keys, cancellation, audit.

## 2. Capabilities needed per area

| Area | Needed for | Must support | Output checks before use |
|---|---|---|---|
| Text (LLM) | captions, scripts, rewrites, translations | AR/FR/EN/DE quality incl. Algerian/Maghrebi context, structured JSON output, refusal of invented facts (prompted with the customer's facts only) | placeholder rule unchanged; facts not in the brief are rejected or turned into `[placeholders]` |
| Image | product scenes, illustrations | reference images (product photo kept recognisable), character reference images (18 canonical characters once approved), text-free outputs (text stays as editable layers) | safety classification; character consistency review; never overwrite the original photo |
| Video | scene clips | image-to-video from approved stills, 9:16/16:9/1:1/4:5, ≤10 s clips, async jobs | duration and resolution checks (as the render worker already probes) |
| Voice | narration, character voices | AR/FR/EN/DE voices, per-character voice identity, SSML or pacing control, no cloning of real people without written consent | loudness normalisation; subtitles from the same text |

## 3. Selection criteria (to fill per candidate before signing)
For each candidate provider record: capabilities vs. the table above; quality on a fixed LIMO test set
(10 prompts per language, 5 product photos, the approved character references); consistency across
runs; languages; latency (p50/p95); reliability/SLA; rate limits; data-use terms (no training on customer
content); content policy fit; commercial terms; region/compliance; and **current prices taken from the
provider's official pricing page on the decision date** (prices are not quoted here because they change
and must not be assumed).

## 4. Cost model and quotas
- Every paid call is estimated before submission (`estimate`) and reserved against the workspace budget
  (`reserve_ai_budget`) and the platform monthly cap; actual cost is recorded per stage
  (`generation_run_stages`) and settled in `usage_ledger`.
- Customer quotas map to plan allowances already in `usage_balances` (video credits, AI images, posts);
  text assistance gets a soft daily cap per workspace.
- Hard limits: per-request maximum cost, per-workspace daily cap, platform monthly cap with alerting at
  50/80/100 %. When a cap is reached the product falls back to the mock adapter with a visible label.

## 5. Safety controls
- Input moderation before submission (text and reference images) and output moderation before display;
  results stored in `content_jobs.safety_status` (the existing column) with the reason.
- Children's content rules for the canonical characters (age-appropriate, no real-person likeness).
- No real person's voice or face without recorded consent; synthetic media disclosure on exports.
- Provider keys only in server/worker secret stores; never in the browser or public env variables.
- Audit every paid call (who, workspace, provider, cost, safety result).

## 6. Failover
- Per capability an ordered provider list in `ai_provider_registry` (primary, secondary, mock).
- Retry transient errors with back-off on the same provider; on repeated failure or outage switch to the
  next provider **only if its output type is compatible** (e.g. voice identity cannot silently change for a
  series — then the job waits and the customer is told).
- Circuit breaker per provider (error rate over a window); idempotency keys prevent double charging.

## 7. Activation checklist (owner approval at each step)
1. Choose providers per area (report with the criteria above).
2. Contracts/terms accepted by the owner; keys created in the provider consoles by the owner.
3. Keys stored as server secrets; registry rows enabled in a staging project only.
4. Budgets and caps configured; alerting tested.
5. Staging run of the LIMO test set; quality and safety review by the owner.
6. Owner unlocks `paid_generation` for selected workspaces (pilot), then generally.

---

# Milestone 9 additions: adapter contracts per capability

Code: `lib/providers/contracts.ts` (interfaces + pure rules, no network) and `tests/unit/providers.test.ts`
(7 tests). Nothing is registered, enabled or called. Every concrete adapter (one per provider × capability)
implements `CapabilityAdapter<Request>`: `estimateUsage(req)` → reservation, then `run(req, signal)` →
output + **measured** usage + `Provenance`.

## 8. Shared rules (implemented and tested)
| Rule | Function | Behaviour |
|---|---|---|
| Metering | `Usage`, `quantity` | raw quantities: input/output tokens, images, video seconds, characters, audio seconds, requests |
| Price sheet | `PriceSheet` | owner enters prices per unit (integer micro-units) from the official price page, with source URL, `verifiedAt`, `verifiedBy`; minimum billed quantities |
| Cost per operation | `operationCost` | Σ max(quantity, minimum) × unit price, rounded up; **throws** when the sheet is unverified, older than 30 days, or a consumed unit has no price (unknown ≠ free) |
| Reservation | `reservation` | estimate + retry buffer %, reserved before the call, settled with measured usage |
| Errors | `classifyHttp`, `ProviderError` | rate_limited, timeout, unavailable, quota_exceeded, content_refused, invalid_request, auth, unknown |
| Retries | `DEFAULT_RETRY`, `nextRetryDelay` | only transient errors; exponential back-off; honours Retry-After; bounded attempts; video = submit + poll with a 30 min deadline |
| Fallback | `chooseFallback` | next enabled provider with closed circuit and verified price within the approved cap; **never** after a safety refusal or an invalid request |
| Provenance | `Provenance` | provider, model + version, request key, prompt SHA-256, input/reference assets, character spec versions, approver, cost, `aiGenerated: true`, content credentials (C2PA/SynthID if returned), `mock` |
| Authorisation | `paidCallBlockers` | all must pass: env `LIMO_ENABLE_PAID_GENERATION=true`, owner approved the capability, provider enabled in registry, verified price, within remaining budget, user confirmed the exact amount above a threshold, approved character references (visual), approved script (video/voice) |
| Validation | `validateRequest` | approved references for character images; 1–15 s video per scene; 1–4 images per call; locked terms present for translation; approved Story Bible version |

## 9. Per capability
Candidates are names to evaluate, **not decisions**. Features, Arabic quality, data terms and prices must be
verified on the provider's official pages on the decision date. No price is assumed anywhere.

| Capability | Request type | LIMO needs | Candidates to evaluate | Cost per operation (formula) | Timeout / retries / fallback |
|---|---|---|---|---|---|
| Text / script | `TextRequest` (script_draft, rewrite, post_caption, safety_review) | AR/FR/EN/DE, JSON output, facts-only (prices and claims only from the brief), refusals surfaced | OpenAI (GPT family), Anthropic (Claude), Google (Gemini), Mistral | in_tokens/1M × p_in + out_tokens/1M × p_out (estimate: `estimateTokens`, Arabic denser) | 60 s, 3 attempts; fallback to another LLM is acceptable (output re-validated by the placeholder rule); mock as last resort, labelled |
| Story continuation / continuity | `StoryRequest` | only canon from the locked Story Bible version and the previous approved ending; continuity check lists conflicts instead of rewriting | same LLM candidates (long context, structured output) | same token formula; Bible + checkpoint dominate input tokens | 90 s, 3 attempts; fallback allowed but the result still goes through the database continuation rules (fingerprint, canon) |
| Image generation / editing | `ImageRequest` (generate, edit, background_remove, upscale) | keep the customer's product recognisable, text-free images (text stays as editable layers), sizes for 4 formats | OpenAI Images, Google Imagen, Black Forest Labs (FLUX), Stability AI | images × p_image (+ size/quality tier) or per-request | 120 s, 2 attempts; fallback only for generate (an edit should not silently change style mid-design) |
| Character-consistent image | `CharacterImageRequest` | reference images of approved canon characters; identity locks (crown, colours, face layout); family-friendly | candidates with reference/subject conditioning among the image providers above; fine-tune/LoRA options to verify | images × p_image (+ reference/fine-tune fees if any) | 2 attempts; **no fallback** to a provider not tested against the approved references (identity would drift); job waits and the user is told |
| Video | `VideoRequest` | image-to-video from approved stills, 9:16/16:9/1:1/4:5, ≤ 15 s per scene, async | Runway, Google Veo, Kling, Luma | max(seconds, minimum) × p_second (often by resolution/model tier) | per-call 60 s, poll deadline 30 min, 2 attempts; fallback only with owner-approved style equivalence; the render worker still assembles the final MP4 |
| Voice | `VoiceRequest` | AR/FR/EN/DE voices, one stable voice per character (`voiceProfileVersion`), pacing; no cloning of real people without written consent | ElevenLabs, OpenAI TTS, Google Cloud TTS, Azure Speech | characters/1k × p_char (or audio minutes) | 120 s, 3 attempts; **no fallback** inside a series (voice identity); product ads may fall back |
| Transcription / subtitles | `TranscriptionRequest` | word timings, AR/FR/EN/DE incl. dialectal Arabic tolerance | OpenAI (Whisper / gpt-4o-transcribe), Deepgram, AssemblyAI, Google STT | audio minutes × p_min | 300 s, 2 attempts; fallback allowed; subtitles from the script text are preferred when the script exists (no cost) |
| Translation | `TranslationRequest` | locked terms (brand, character names, prices) unchanged; tone kept | LLM candidates above, DeepL, Google Translate | characters/1k × p_char or token formula | 60 s, 3 attempts; fallback allowed; locked terms re-checked after translation |
| Meta Graph (publishing) | `PublishingAdapter` (`lib/social/adapter.ts`), not this module | Pages publishing, scheduling, insights later | Meta Graph API (only option) | no per-call price; constraints are rate limits and App Review | normalized errors already implemented (`normalizeGraphError`); see FACEBOOK_INFRASTRUCTURE.md; live publishing locked off |

## 10. Quotas and metering per workspace
- Reserve before calling (`reservation`), settle with the provider's measured usage; difference refunded.
- Plan allowances map to `usage_balances` (video credits, AI images, posts); text assistance gets a soft daily cap.
- V1 video policy (VIDEO_POLICY.md): an AI-generated video is at most 30 s like every export (`VideoRequest.videoTotalSeconds`, `request_studio_generation`). Provider costs are reserved and settled in cents; the single video credit is consumed only when the final MP4 is rendered.
- Platform caps: per request, per workspace per day, platform per month (alerts 50/80/100 %).
- Every paid call writes a ledger row with provider, model, units, cost, request key (idempotent).

## 11. Outages
Circuit breaker per provider (error rate in a window → `circuitOpen`); status shown in Admin; jobs needing a
provider with an open circuit and no compatible fallback wait (queued, not failed) and the user sees
"provider unavailable — your budget is not used". The mock adapters never stand in silently for a paid
result: any mock output is labelled.

## 12. Activation order (each step needs explicit owner approval)
1. Text (script + captions) — lowest cost per operation, biggest daily value.
2. Translation (reuses text provider).
3. Image generation/editing for product ads.
4. Voice (narration).
5. Transcription/subtitles.
6. Character-consistent images — only after CHARACTER_ARTWORK_PLAN step 5 for the characters involved.
7. Video clips — last (highest cost per operation; needs approved stills).
