/**
 * Provider adapter contracts (Milestone 9). Capability-level interfaces for every external AI service
 * LIMO will use, plus the pure rules every adapter must go through: metering, cost per operation from an
 * owner-verified price sheet, retries and fallback, provenance, and the authorisation gate before any
 * paid call.
 *
 * Nothing here calls a provider. No adapter implementing these interfaces is registered or enabled;
 * prices are never hard-coded (the owner enters and verifies them at decision time, see
 * docs/PROVIDER_INTEGRATION_PLAN.md). The stage-level `ProviderAdapter` in lib/generation/types.ts is
 * the orchestration layer on top of these capabilities.
 */

export const CAPABILITIES = ['text', 'story', 'image', 'character_image', 'video', 'voice', 'transcription', 'translation'] as const;
export type Capability = (typeof CAPABILITIES)[number];
export type Locale = 'en' | 'fr' | 'ar' | 'de';

// ---------------------------------------------------------------------------------------------------
// Metering and price sheets
// ---------------------------------------------------------------------------------------------------

/** Billable units used by the candidates' public price lists. */
export const UNITS = ['input_tokens_1m', 'output_tokens_1m', 'image', 'video_second', 'characters_1k', 'audio_minute', 'request'] as const;
export type Unit = (typeof UNITS)[number];

/** Measured (or estimated) usage of one operation, in raw quantities. */
export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  images?: number;
  videoSeconds?: number;
  characters?: number;
  audioSeconds?: number;
  requests?: number;
}

/** Quantity of a unit in a usage record. */
export function quantity(u: Usage, unit: Unit): number {
  switch (unit) {
    case 'input_tokens_1m':
      return (u.inputTokens ?? 0) / 1_000_000;
    case 'output_tokens_1m':
      return (u.outputTokens ?? 0) / 1_000_000;
    case 'image':
      return u.images ?? 0;
    case 'video_second':
      return u.videoSeconds ?? 0;
    case 'characters_1k':
      return (u.characters ?? 0) / 1000;
    case 'audio_minute':
      return (u.audioSeconds ?? 0) / 60;
    case 'request':
      return u.requests ?? 0;
  }
}

/**
 * One provider model's prices, entered by the owner from the provider's official price page.
 * Amounts are integer micro-units of `currency` (1 USD = 1 000 000) per unit, to avoid float drift.
 * A sheet that is not `verified` (or whose verification is older than `maxAgeDays`) blocks paid calls.
 */
export interface PriceSheet {
  provider: string;
  model: string;
  currency: 'USD' | 'EUR';
  prices: Partial<Record<Unit, number>>;
  /** Minimum billed quantity per operation, when the provider rounds up (e.g. 1 request, 5 s of video). */
  minimums?: Partial<Record<Unit, number>>;
  source: string;
  verifiedAt: string | null;
  verifiedBy: string | null;
}

export class PriceSheetError extends Error {
  readonly reason: 'unverified' | 'stale' | 'unit_not_priced';
  constructor(reason: PriceSheetError['reason'], detail: string) {
    super(`${reason}: ${detail}`);
    this.reason = reason;
  }
}

export interface OperationCost {
  micros: number;
  /** Rounded up to whole cents of the sheet's currency (what budgets and ledgers store). */
  cents: number;
  lines: Array<{ unit: Unit; quantity: number; micros: number }>;
}

/**
 * Cost of one operation = Σ max(quantity, minimum) × price, rounded up per line to whole micro-units.
 * Throws when the sheet is unverified, stale, or lacks a price for a unit the usage consumes —
 * an unknown price must never be treated as free.
 */
export function operationCost(sheet: PriceSheet, usage: Usage, opts: { now?: Date; maxAgeDays?: number } = {}): OperationCost {
  if (!sheet.verifiedAt || !sheet.verifiedBy) throw new PriceSheetError('unverified', `${sheet.provider}/${sheet.model}`);
  const age = ((opts.now ?? new Date()).getTime() - new Date(sheet.verifiedAt).getTime()) / 86_400_000;
  if (!(age <= (opts.maxAgeDays ?? 30))) throw new PriceSheetError('stale', `${sheet.provider}/${sheet.model} verified ${sheet.verifiedAt}`);
  const lines: OperationCost['lines'] = [];
  for (const unit of UNITS) {
    const q = quantity(usage, unit);
    if (q <= 0) continue;
    const price = sheet.prices[unit];
    if (price === undefined) throw new PriceSheetError('unit_not_priced', `${sheet.provider}/${sheet.model} ${unit}`);
    const billed = Math.max(q, sheet.minimums?.[unit] ?? 0);
    lines.push({ unit, quantity: billed, micros: Math.ceil(billed * price) });
  }
  const micros = lines.reduce((s, l) => s + l.micros, 0);
  return { micros, cents: Math.ceil(micros / 10_000), lines };
}

/** Amount to reserve before a call: estimate + retry buffer (attempts that may be billed). */
export function reservation(cost: OperationCost, retryBufferPercent: number): number {
  return Math.ceil((cost.cents * (100 + Math.max(0, retryBufferPercent))) / 100);
}

/** Rough token estimate for budgeting text calls before the provider reports real usage (~4 chars/token, Arabic denser). */
export function estimateTokens(text: string, locale: Locale = 'en'): number {
  return Math.ceil(text.length / (locale === 'ar' ? 2.5 : 4));
}

// ---------------------------------------------------------------------------------------------------
// Errors, timeouts, retries, fallback
// ---------------------------------------------------------------------------------------------------

export type ProviderErrorCode = 'rate_limited' | 'timeout' | 'unavailable' | 'quota_exceeded' | 'content_refused' | 'invalid_request' | 'auth' | 'unknown';

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly retryAfterMs?: number;
  constructor(code: ProviderErrorCode, message: string, retryAfterMs?: number) {
    super(message);
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

/** Normalizes an HTTP status from any provider. */
export function classifyHttp(status: number): ProviderErrorCode {
  if (status === 429) return 'rate_limited';
  if (status === 408 || status === 504) return 'timeout';
  if (status === 401 || status === 403) return 'auth';
  if (status === 402) return 'quota_exceeded';
  if (status >= 500) return 'unavailable';
  if (status >= 400) return 'invalid_request';
  return 'unknown';
}

export interface RetryPolicy {
  timeoutMs: number;
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

/**
 * Defaults per capability. Synchronous calls get short timeouts; video is asynchronous (submit + poll),
 * so its timeout is per HTTP call and the job itself is bounded by `pollDeadlineMs`.
 */
export const DEFAULT_RETRY: Record<Capability, RetryPolicy & { pollDeadlineMs?: number }> = {
  text: { timeoutMs: 60_000, maxAttempts: 3, baseDelayMs: 2_000, maxDelayMs: 30_000 },
  story: { timeoutMs: 90_000, maxAttempts: 3, baseDelayMs: 2_000, maxDelayMs: 30_000 },
  translation: { timeoutMs: 60_000, maxAttempts: 3, baseDelayMs: 2_000, maxDelayMs: 30_000 },
  image: { timeoutMs: 120_000, maxAttempts: 2, baseDelayMs: 5_000, maxDelayMs: 60_000 },
  character_image: { timeoutMs: 120_000, maxAttempts: 2, baseDelayMs: 5_000, maxDelayMs: 60_000 },
  voice: { timeoutMs: 120_000, maxAttempts: 3, baseDelayMs: 3_000, maxDelayMs: 60_000 },
  transcription: { timeoutMs: 300_000, maxAttempts: 2, baseDelayMs: 5_000, maxDelayMs: 60_000 },
  video: { timeoutMs: 60_000, maxAttempts: 2, baseDelayMs: 30_000, maxDelayMs: 300_000, pollDeadlineMs: 30 * 60_000 },
};

/**
 * Delay before the next attempt, or null when the error must not be retried (refusals, bad requests,
 * auth and quota problems need a person, and retrying them only burns budget). `attempt` is 1-based.
 */
export function nextRetryDelay(policy: RetryPolicy, attempt: number, code: ProviderErrorCode, retryAfterMs?: number): number | null {
  if (attempt >= policy.maxAttempts) return null;
  if (!(code === 'rate_limited' || code === 'timeout' || code === 'unavailable' || code === 'unknown')) return null;
  const exp = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
  return Math.min(policy.maxDelayMs, Math.max(exp, retryAfterMs ?? 0));
}

export interface ProviderOption {
  code: string;
  paid: boolean;
  enabled: boolean;
  /** Open circuit = recent failures/outage reported by monitoring; skip until it closes. */
  circuitOpen: boolean;
  /** Estimated cost in cents for this request (null = no verified price → cannot be used for paid calls). */
  estimateCents: number | null;
}

/**
 * Fallback choice after a failure. Never falls back after `content_refused` (another provider must not be
 * used to get around a safety refusal), after `invalid_request` (the request itself is wrong), or to a
 * provider whose estimate exceeds the approved cap.
 */
export function chooseFallback(chain: ProviderOption[], failed: string, code: ProviderErrorCode, approvedCapCents: number): ProviderOption | null {
  if (code === 'content_refused' || code === 'invalid_request') return null;
  for (const o of chain) {
    if (o.code === failed || !o.enabled || o.circuitOpen) continue;
    if (o.paid && (o.estimateCents === null || o.estimateCents > approvedCapCents)) continue;
    return o;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------------------------------

/** Stored with every produced asset (asset metadata + generation_run_stages), shown in the library. */
export interface Provenance {
  capability: Capability;
  provider: string;
  model: string;
  modelVersion: string | null;
  requestKey: string;
  /** SHA-256 of the final prompt/instructions sent (the text itself stays in the run record). */
  promptSha256: string;
  inputAssetIds: string[];
  referenceAssetIds: string[];
  /** Character spec versions used (identity locks) for story/character_image/video. */
  characterSpecVersions: Record<string, number>;
  approvedBy: string | null;
  createdAt: string;
  costMicros: number | null;
  currency: PriceSheet['currency'] | null;
  /** Always disclosed in the UI and in exported metadata. */
  aiGenerated: true;
  /** C2PA / SynthID or similar marker reported by the provider, when present. */
  contentCredentials: string | null;
  mock: boolean;
}

// ---------------------------------------------------------------------------------------------------
// Authorisation gate before paid calls
// ---------------------------------------------------------------------------------------------------

export type BlockReason =
  | 'paid_generation_disabled'
  | 'capability_not_approved'
  | 'provider_disabled'
  | 'price_unverified'
  | 'budget_exceeded'
  | 'user_confirmation_required'
  | 'missing_character_reference'
  | 'content_not_approved';

export interface PaidCallContext {
  env: Record<string, string | undefined>;
  capability: Capability;
  /** Owner's per-capability activation (admin feature flag `provider_<capability>`). */
  capabilityApproved: boolean;
  providerEnabledInRegistry: boolean;
  priceVerified: boolean;
  estimateCents: number | null;
  /** Remaining budget of the workspace for this period (from the reservation ledger). */
  remainingBudgetCents: number;
  /** Above this estimate the user must confirm the exact amount in the UI first. */
  confirmAboveCents: number;
  userConfirmedCents: number | null;
  /** Characters that appear without an approved canonical reference (visual capabilities only). */
  missingReferences: string[];
  /** Video/voice of a story or product script: the script revision must be approved. */
  sourceApproved: boolean;
}

/** All reasons that block the call; empty = allowed. Mock adapters skip this gate (`paid: false`). */
export function paidCallBlockers(c: PaidCallContext): BlockReason[] {
  const out: BlockReason[] = [];
  const visual = c.capability === 'image' || c.capability === 'character_image' || c.capability === 'video';
  if (c.env.LIMO_ENABLE_PAID_GENERATION !== 'true') out.push('paid_generation_disabled');
  if (!c.capabilityApproved) out.push('capability_not_approved');
  if (!c.providerEnabledInRegistry) out.push('provider_disabled');
  if (!c.priceVerified || c.estimateCents === null) out.push('price_unverified');
  else {
    if (c.estimateCents > c.remainingBudgetCents) out.push('budget_exceeded');
    if (c.estimateCents > c.confirmAboveCents && (c.userConfirmedCents === null || c.userConfirmedCents < c.estimateCents)) out.push('user_confirmation_required');
  }
  if (visual && c.missingReferences.length > 0) out.push('missing_character_reference');
  if ((c.capability === 'video' || c.capability === 'voice') && !c.sourceApproved) out.push('content_not_approved');
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Capability requests and adapter interface
// ---------------------------------------------------------------------------------------------------

interface Base {
  requestKey: string;
  organizationId: string;
  locale: Locale;
}

export interface TextRequest extends Base {
  kind: 'text';
  task: 'script_draft' | 'rewrite' | 'post_caption' | 'safety_review';
  instructions: string;
  /** User-entered facts: the model may phrase them but must not add facts (prices, claims, offers). */
  facts: Record<string, string>;
  maxOutputTokens: number;
}

export interface StoryRequest extends Base {
  kind: 'story';
  task: 'continue_episode' | 'continuity_check' | 'suggest_checkpoint';
  /** Locked Story Bible version and the previous approved checkpoint: the only canon the model may use. */
  bibleVersion: number;
  bible: string;
  previousCheckpoint: { episode: number; summary: string; endingHook: string } | null;
  characterSpecVersions: Record<string, number>;
  maxOutputTokens: number;
}

export interface ImageRequest extends Base {
  kind: 'image';
  task: 'generate' | 'edit' | 'background_remove' | 'upscale';
  prompt: string;
  inputAssetIds: string[];
  size: { width: number; height: number };
  count: number;
}

export interface CharacterImageRequest extends Base {
  kind: 'character_image';
  prompt: string;
  /** Canonical approved references per character (front/three-quarter/side, expressions). Must be non-empty. */
  references: Array<{ character: string; specVersion: number; assetIds: string[] }>;
  size: { width: number; height: number };
  count: number;
}

export interface VideoRequest extends Base {
  kind: 'video';
  prompt: string;
  firstFrameAssetId: string | null;
  references: CharacterImageRequest['references'];
  durationSeconds: number;
  aspect: '9:16' | '16:9' | '1:1' | '4:5';
  scriptRevisionId: string;
}

export interface VoiceRequest extends Base {
  kind: 'voice';
  text: string;
  voiceId: string;
  /** The character's approved voice profile, so the same voice is used in every episode. */
  voiceProfileVersion: number | null;
  scriptRevisionId: string;
}

export interface TranscriptionRequest extends Base {
  kind: 'transcription';
  audioAssetId: string;
  durationSeconds: number;
  wantWordTimings: boolean;
}

export interface TranslationRequest extends Base {
  kind: 'translation';
  source: Locale;
  text: string;
  /** Brand/character names and prices that must stay untouched. */
  lockedTerms: string[];
}

export type CapabilityRequest = TextRequest | StoryRequest | ImageRequest | CharacterImageRequest | VideoRequest | VoiceRequest | TranscriptionRequest | TranslationRequest;

export interface CapabilityResult {
  /** Text output, or storage paths of produced files (uploaded by the adapter into workspace-assets). */
  text?: string;
  assetPaths?: string[];
  subtitles?: Array<{ startMs: number; endMs: number; text: string }>;
  usage: Usage;
  provenance: Provenance;
}

/** What every concrete adapter (OpenAI, Anthropic, ElevenLabs, …) implements for one capability. */
export interface CapabilityAdapter<R extends CapabilityRequest = CapabilityRequest> {
  readonly provider: string;
  readonly model: string;
  readonly capability: R['kind'];
  readonly paid: boolean;
  readonly locales: Locale[];
  /** Usage estimate before the call (for reservation and the confirmation dialog). */
  estimateUsage(req: R): Usage;
  /** Runs the call. Must honour `signal`, use `req.requestKey` as the provider's idempotency key where supported,
   *  and report the provider's measured usage (not the estimate). */
  run(req: R, signal: AbortSignal): Promise<CapabilityResult>;
}

/** Structural checks done before estimating (cheap, provider-independent). */
export function validateRequest(r: CapabilityRequest): string[] {
  const e: string[] = [];
  if (!r.requestKey) e.push('requestKey required');
  if (r.kind === 'character_image' && (r.references.length === 0 || r.references.some((x) => x.assetIds.length === 0))) e.push('approved character references required');
  if (r.kind === 'video' && (r.durationSeconds < 1 || r.durationSeconds > 15)) e.push('video duration 1–15 s per scene');
  if ((r.kind === 'image' || r.kind === 'character_image') && (r.count < 1 || r.count > 4)) e.push('1–4 images per call');
  if (r.kind === 'translation' && r.lockedTerms.some((t) => t && !r.text.includes(t))) e.push('locked term not present in source');
  if (r.kind === 'story' && r.bibleVersion < 1) e.push('approved Story Bible version required');
  return e;
}
