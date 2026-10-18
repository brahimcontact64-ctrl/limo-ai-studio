/**
 * Application-level spend guard (pilot safeguard, Phase 4 of the $10 AI pilot preparation).
 *
 * Every PAID provider call reserves its worst-case cost in a guard scope BEFORE the request leaves the process,
 * and settles (actual cost) or releases (provably not billed) it afterwards. The authoritative guard lives in the
 * database (migration 20261018150000: ai_spend_guards / ai_spend_entries, row lock per scope, unique operation key),
 * so concurrent workers cannot overspend; `memorySpendGuard` is the same rule set for unit tests.
 *
 * Rules (identical in SQL and here):
 *   - the scope must exist and be enabled (enabled = false is the immediate kill switch)
 *   - the reservation must be > 0 (an unknown price never reaches this point: preflight blocks it)
 *   - per operation: cents <= max_operation_cents
 *   - per bucket (text / image / video / voice): reserved + spent + cents <= bucket cap; a capability without a
 *     bucket cap is refused
 *   - total: reserved + spent + cents <= limit_cents (the contingency is the limit minus the bucket caps; it absorbs
 *     settlements above the reservation and is never handed out to new operations)
 *   - one entry per operation key: an operation already reserved is refused (concurrency), one already settled is
 *     refused (never paid twice), one released may be reserved again only with an explicit retry approval
 *
 * Failure settlement (`failureSettlement`): an error the provider certainly did not bill is released; a refusal that
 * reports billed usage is settled at that usage; an outcome we cannot know (timeout, connection loss, unknown) is
 * settled at the full reservation and flagged for reconciliation against the provider's usage page.
 */
import { operationCost, type Capability, type PriceSheet, type ProviderError, type Usage } from './contracts.ts';

export type SpendBucket = 'text' | 'image' | 'video' | 'voice';

export const SPEND_BUCKET: Record<Capability, SpendBucket> = {
  text: 'text', story: 'text', translation: 'text', safety: 'text',
  image: 'image', character_image: 'image',
  video: 'video',
  voice: 'voice', transcription: 'voice',
};

/** The $10 pilot allocation (cents). Contingency = 1000 - (200 + 200 + 300 + 100) = 200. */
export const PILOT_GUARD = { limitCents: 1000, maxOperationCents: 100, caps: { text: 200, image: 200, video: 300, voice: 100 } as Record<SpendBucket, number> };

export type SpendRefusal =
  | 'no_guard'
  | 'kill_switch'
  | 'invalid_amount'
  | 'operation_cap'
  | 'bucket_not_allowed'
  | 'bucket_cap'
  | 'budget_exceeded'
  | 'already_reserved'
  | 'already_settled'
  | 'retry_requires_approval';

export interface SpendReservation {
  opKey: string;
  capability: Capability;
  provider: string;
  model: string;
  cents: number;
  organizationId?: string | null;
  /** The owner approved re-running an operation whose earlier reservation was released. */
  retryApproved?: boolean;
}

export interface SpendGuard {
  readonly scope: string;
  /** Throws SpendBlockedError when the reservation is refused (nothing is sent to the provider). */
  reserve(r: SpendReservation): Promise<void>;
  /** `actualCents` null = charge the full reservation (outcome unknown, or an async job that failed after submit). */
  settle(opKey: string, actualCents: number | null, detail?: { providerRequestId?: string | null; needsReconciliation?: boolean; note?: string }): Promise<void>;
  release(opKey: string, reason: string): Promise<void>;
}

export class SpendBlockedError extends Error {
  readonly reason: SpendRefusal | string;
  constructor(reason: SpendRefusal | string) {
    super(`spend guard refused: ${reason}`);
    this.reason = reason;
  }
}

export interface GuardConfig {
  enabled: boolean;
  limitCents: number;
  maxOperationCents: number;
  caps: Partial<Record<SpendBucket, number>>;
}

interface Entry { bucket: SpendBucket; status: 'reserved' | 'settled' | 'released'; reserved: number; actual: number | null; reconcile: boolean }

/** In-memory guard with the SQL rules (tests; never used by a worker). */
export function memorySpendGuard(cfg: GuardConfig, scope = 'memory') {
  const entries = new Map<string, Entry>();
  const used = (b?: SpendBucket) => [...entries.values()].filter((e) => !b || e.bucket === b).reduce((s, e) => s + (e.status === 'reserved' ? e.reserved : e.status === 'settled' ? (e.actual ?? 0) : 0), 0);
  const guard: SpendGuard & { config: GuardConfig; entries: Map<string, Entry>; total: () => number } = {
    scope, config: cfg, entries, total: () => used(),
    async reserve(r) {
      if (!cfg.enabled) throw new SpendBlockedError('kill_switch');
      if (!Number.isInteger(r.cents) || r.cents <= 0) throw new SpendBlockedError('invalid_amount');
      const prev = entries.get(r.opKey);
      if (prev?.status === 'reserved') throw new SpendBlockedError('already_reserved');
      if (prev?.status === 'settled') throw new SpendBlockedError('already_settled');
      if (prev?.status === 'released' && !r.retryApproved) throw new SpendBlockedError('retry_requires_approval');
      if (r.cents > cfg.maxOperationCents) throw new SpendBlockedError('operation_cap');
      const bucket = SPEND_BUCKET[r.capability];
      const cap = cfg.caps[bucket];
      if (cap === undefined) throw new SpendBlockedError('bucket_not_allowed');
      if (used(bucket) + r.cents > cap) throw new SpendBlockedError('bucket_cap');
      if (used() + r.cents > cfg.limitCents) throw new SpendBlockedError('budget_exceeded');
      entries.set(r.opKey, { bucket, status: 'reserved', reserved: r.cents, actual: null, reconcile: false });
    },
    async settle(opKey, actualCents, d) {
      const e = entries.get(opKey);
      if (!e) throw new SpendBlockedError('unknown_operation');
      if (e.status === 'settled') return;
      if (e.status !== 'reserved') throw new SpendBlockedError('not_reserved');
      Object.assign(e, { status: 'settled', actual: actualCents === null ? e.reserved : Math.max(0, Math.ceil(actualCents)), reconcile: actualCents === null || !!d?.needsReconciliation });
    },
    async release(opKey) {
      const e = entries.get(opKey);
      if (!e || e.status !== 'reserved') return;
      e.status = 'released';
    },
  };
  return guard;
}

/** Codes that prove the provider did not bill the request (rejected before any work, or nothing was sent). */
const NOT_BILLED = new Set(['disabled', 'auth', 'invalid_request', 'quota_exceeded', 'rate_limited']);

/**
 * What to do with a reservation after the call failed. `content_refused` is released unless the provider reported
 * billed usage (priced with the same verified sheet); unknown outcomes are charged at the reservation.
 */
export function failureSettlement(err: ProviderError, price: PriceSheet | null, reservedCents: number, now?: Date): { action: 'release' } | { action: 'settle'; cents: number; needsReconciliation: boolean } {
  if (NOT_BILLED.has(err.code)) return { action: 'release' };
  if (err.code === 'content_refused') {
    if (!err.billedUsage || !hasUsage(err.billedUsage)) return { action: 'release' };
    if (!price) return { action: 'settle', cents: reservedCents, needsReconciliation: true };
    try {
      return { action: 'settle', cents: operationCost(price, err.billedUsage, { now }).cents, needsReconciliation: false };
    } catch {
      return { action: 'settle', cents: reservedCents, needsReconciliation: true };
    }
  }
  // timeout / unavailable / unknown: the request may have been processed.
  return { action: 'settle', cents: reservedCents, needsReconciliation: true };
}

const hasUsage = (u: Usage) => Object.values(u).some((v) => typeof v === 'number' && v > 0);

/** Worst case reserved for one operation: the estimate for every attempt the retry policy allows. */
export function reservationCents(estimateMicros: number, maxAttempts: number): number {
  return Math.ceil(estimateMicros / 10_000) * Math.max(1, maxAttempts);
}
