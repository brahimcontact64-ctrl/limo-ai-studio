# AI generation — architecture, safety and activation (Milestone 10)

Status (2026-10-18): **implemented and tested with mocks; every real provider is disabled.** No API key was
requested or used and no paid call was made. Real adapters were verified only against mocked HTTP responses
built from the providers' documented request/response shapes — **none is live-tested**.

## 1. Pieces
| Layer | Files | What it does |
|---|---|---|
| Contracts | `lib/providers/contracts.ts` | capability requests/results, metering, `operationCost` (verified prices only), retry/fallback rules, provenance, `paidCallBlockers`, sync and async adapter interfaces |
| HTTP guard | `lib/providers/http.ts` | `blockedFetch` refuses every AI provider host unless live; timeouts, `retry-after`, error normalisation |
| Real adapters | `lib/providers/adapters/*` | Claude (text, story, translation; official SDK, `maxRetries: 0`), Gemini images (generation, editing with product photos, character references), Veo 3.1 video (submit / poll / download), ElevenLabs voice (with timestamps → subtitles), OpenAI moderation (free) and whisper-1 transcription |
| Mock adapters | `lib/providers/mocks.ts` | same contracts, no network, labelled "Mock — not AI" (plain PNG, tone WAV, still instead of clip) |
| Registry | `lib/providers/registry.ts` | mode `off` (default) / `mock` / `live`; live needs `LIMO_GENERATION_MODE=live` **and** `LIMO_ENABLE_PAID_GENERATION=true` **and** the provider key |
| Executor | `lib/providers/execute.ts` | the only path to a provider: validate → verified price → authorisation → bounded transient retries → actual cost |
| Prices | `lib/providers/prices.ts` (researched, unverified), `registry-prices.ts` (runtime: `ai_provider_registry` with the owner's `verified_at`) |
| Planner | `lib/generation/plan.ts` | approved revision → operations, costs, idempotency keys; 30 s limit; character references; footage generated once (9:16 / 16:9) and reused for every export format |
| Worker | `worker/src/generator.ts` | executes `generation_runs` stages with the database's existing orchestration functions (service role) |
| Customer UI | `components/studio/GenerationPanel.tsx`, `GET/POST /api/projects/[id]/generation`, `POST /api/generation/decide` | availability + exact estimate → explicit confirmation → proposals per scene → use or reject |
| Database | migration `20261018120000_limo_ai_generation_v1` (pending) | media provenance + AI kinds, reuse index, proposal decisions, `generation_availability`, disabled/unverified provider rows |
| Characters | `lib/characters/artwork.ts` | canonical sheet prompts (front → three-quarter/side → back, 8 expressions, 2 outfits), work order, identity checks |

## 2. Flow (approved script → MP4)
1. The customer opens the Video step. `generation_availability` says whether AI scenes are available and returns
   the exact amount `request_studio_generation` would reserve (or why not: not enabled, script not approved,
   over 30 s, budget/workspace off, already generated).
2. The customer confirms that amount. The API re-checks it (refuses `estimate_changed`), then
   `request_studio_generation` reserves the AI budget (cents) — **no video credit**.
3. The generator runs the stages in the database's order: safety (moderation; block → run ends, review → waits
   for a person) → scene prompts (from the approved script; the script never changes) → narration → scene
   images (customer media kept as is) → scene clips (submit, task id stored, polled, downloaded and copied to
   private storage at once — Google keeps videos only 2 days) → proposal → export note.
4. Every file is stored in `workspace-assets/<org>/generated/<run>/…` with provenance (provider, model, operation
   key, prompt hash, references, character spec versions, SynthID, mock/AI label).
5. The Video step lists the proposals; "Use for scene N" records the decision and sets that scene's media (the
   customer's own save); "Reject" hides it. Nothing is applied automatically.
6. The MP4 is the normal export (render worker, one video credit, ≤ 30 s). Other formats reuse the same footage.

Failures: transient errors are retried within the policy; a refusal, invalid request, auth/quota problem or a
disabled provider is never retried or sent to another provider; a stage failure ends the run and settles the
budget (released if nothing was spent). A new run reuses every result whose operation key matches (never paid
twice). Stale stages are quarantined by the database.

## 3. Security
- Provider keys only in the worker's secret store (server env); never `NEXT_PUBLIC_*`, never in the browser bundle,
  never logged. The web app needs no provider key at all (it only calls database functions).
- Network guard: outside live mode no request can reach a provider host; tests prove a real adapter on the blocked
  network fails as `disabled` without a request.
- Workspace isolation: all runs/stages/decisions/files are RLS-protected; the worker loads inputs only from the
  run's workspace (or approved canonical references); `decide_generation_proposal` accepts only files produced by
  that run; other workspaces get nothing (e2e).
- Customer data sent to providers: script text, chosen photos and approved references only. Paid tiers do not
  train on it (Anthropic commercial terms, Gemini paid services); see AI_PROVIDERS.md.
- Test workers (`e2e-*`, `local-*`) refuse to run against a non-local database; e2e scripts refuse to start while
  another worker targets the same database (orphan-process fix).
- Rate limit on generation requests (10 per hour per user) on top of the database's platform limits.

## 4. Required credentials (owner, at activation only)
| Env var (worker only) | Provider | Used for |
|---|---|---|
| `ANTHROPIC_API_KEY` | Anthropic | scripts, rewrites, translation, story continuation, scene prompts |
| `GEMINI_API_KEY` | Google AI (paid tier, billing account) | images, character sheets, Veo video |
| `ELEVENLABS_API_KEY` | ElevenLabs (paid plan for commercial use) | narration |
| `OPENAI_API_KEY` | OpenAI | moderation (free), transcription |
| `LIMO_NARRATOR_VOICE_ID` | ElevenLabs voice id, or a Gemini voice name (`Kore` default with Google TTS) | default narrator voice (per-character voices later via `character_voice_profiles`) |
| `LIMO_VOICE_PROVIDER` / `LIMO_SAFETY_PROVIDER` | selectors | `elevenlabs` (default) or `google` (Gemini TTS); `openai` (default) or `anthropic` (Claude review) |
| `LIMO_AI_SPEND_SCOPE` | LIMO | spend-guard scope (`ai_spend_guards`); without it every paid call is blocked |
| `LIMO_AI_KILL_SWITCH` / `LIMO_AI_MAX_ATTEMPTS` | LIMO | `on` blocks all paid calls of the process; `1` = no paid retries |
| `LIMO_VEO_RESOLUTION` | LIMO | `720p` (default) or `1080p` for Animation Studio clips (price tier) |
None is configured anywhere. Do not send keys in chat; put them in the worker host's secret store.

## 5. Activation checklist (each step is an owner decision)
0. First run the internal $10 pilot on the local replica: docs/AI_PILOT_PLAN.md (spend guard, kill switch, approvals).
1. Apply the pending migrations (1–13) with the production rollout plan.
2. Legal check: Gemini API terms bar apps "directed at or likely accessed by" under-18s — confirm LIMO's audience
   (accounts are 18+, content is family-friendly) or choose another image/video provider.
3. Re-check each price on the official page and record it in `ai_provider_registry.pricing_metadata`, then set
   `verified_at` (prices older than 30 days block again).
4. Choose defaults per stage in `ai_provider_registry` (today the old rows — OpenAI script, Runway image/video,
   Shotstack — are default; this milestone recommends Claude, Gemini, Veo, ElevenLabs, LIMO render) and enable them.
5. Enable and verify the `standard_v1` cost policy with cents that cover the plan (see AI_COSTS_AND_PRICING.md).
6. Put the provider keys in the generator's secret store; deploy the generator (WORKER_HOSTING_PLAN gates).
7. Turn on the `paid_generation` flag, `ai_enabled` and a monthly budget for ONE pilot workspace; set
   `LIMO_GENERATION_MODE=live` and `LIMO_ENABLE_PAID_GENERATION=true` on the generator.
8. First live test (owner-authorised, small budget): one product ad, one story scene with an approved character;
   compare the requests with the mocked contract tests; record results in TEST_REPORT.
9. Spending alerts (AI_COSTS_AND_PRICING §6) scheduled; then widen to more workspaces.

## 6. Monitoring and health
- Generator `/livez` and `/healthz` (HEALTH_PORT) like the other workers; log line per stage with cost in cents and
  `blocked provider calls` on stop.
- Database views for operators: runs `needs_reconciliation`, stages failed by code, spend vs budget (SQL in
  AI_COSTS_AND_PRICING §6). Provider status pages are not polled automatically; a provider outage shows as
  transient failures → runs fail after the retry policy and the budget is released.
- Error monitoring service: not chosen/activated (no paid service without approval).

## 7. Mock versus real (what is proven)
| Capability | Real adapter | Mock | Proven by |
|---|---|---|---|
| Text, story, translation (Claude) | implemented | deterministic text | mocked-HTTP contract tests (request shape, JSON schema output, refusals, 429/529, invented numbers, locked terms) |
| Images, character images (Gemini) | implemented | plain PNG | mocked-HTTP tests (Interactions request, references, output parsing, safety 400, limits) |
| Video (Veo 3.1) | implemented (async) | still image, not animated | mocked-HTTP tests (predictLongRunning body, polling, download, host checks); mock run end to end |
| Voice (ElevenLabs) | implemented | tone WAV | mocked-HTTP tests (with-timestamps request, alignment → subtitles) |
| Moderation, transcription (OpenAI) | implemented | allow / empty | mocked-HTTP tests |
| Whole pipeline | — | mock providers | `scripts/e2e-generate.ts` (24 checks) + `tests/e2e/ai-generation.spec.ts` (desktop + phone + Arabic) |
| Live provider behaviour, quality, latency, real costs | **not tested** | — | requires the owner-authorised activation above |
