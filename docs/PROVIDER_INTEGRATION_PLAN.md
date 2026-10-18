# Next phase — real AI providers (text, image, video, voice)

Status: **plan for owner decision. Nothing here is activated.** Paid generation stays behind the locked
`paid_generation` flag and the cost/provider gates already in the database.

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
- Customer quotas map to plan allowances already in `usage_balances` (video slots, AI images, posts);
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
