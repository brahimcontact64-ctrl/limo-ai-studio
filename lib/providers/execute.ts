/**
 * The only way an operation reaches a provider (Milestone 10). Order of checks:
 *   1. structural validation (validateRequest)
 *   2. price: a paid adapter needs a VERIFIED price sheet; the estimate is computed from it
 *   3. authorisation: paidCallBlockers (env flag, owner approval of the capability, provider enabled, verified
 *      price, budget, user confirmation of the amount, character references, approved script)
 *   4. call with bounded retries for transient errors only (rate limit, timeout, unavailable); a safety refusal,
 *      an invalid request, auth/quota problems or a disabled provider are never retried and never re-sent elsewhere
 *   5. actual cost from the provider's measured usage and the same verified sheet
 * Paid adapters additionally need a spend guard (spend.ts): the worst case (estimate × allowed attempts) is reserved
 * before the first byte is sent, then settled at the actual cost or released when the provider provably did not bill.
 * LIMO_AI_MAX_ATTEMPTS lowers the retry policy (the pilot uses 1: no paid retries without a new approval).
 * Mock adapters (paid: false, provider "limo-mock") skip 2–3 and the guard, and always cost 0.
 */
import { DEFAULT_RETRY, nextRetryDelay, operationCost, paidCallBlockers, ProviderError, validateRequest, type AsyncCapabilityAdapter, type BlockReason, type Capability, type CapabilityAdapter, type CapabilityRequest, type CapabilityResult, type PaidCallContext, type PriceSheet, type RetryPolicy } from './contracts.ts';
import { failureSettlement, reservationCents, SpendBlockedError, type SpendGuard } from './spend.ts';

export class OperationBlockedError extends Error {
  readonly reasons: Array<BlockReason | string>;
  constructor(reasons: Array<BlockReason | string>) {
    super(`operation blocked: ${reasons.join(', ')}`);
    this.reasons = reasons;
  }
}

/** Gate context without the estimate (filled in here from the verified price). */
export type GateInput = Omit<PaidCallContext, 'capability' | 'estimateCents' | 'priceVerified'>;

export interface ExecuteOptions {
  price: PriceSheet | null;
  gate: GateInput;
  policy?: RetryPolicy;
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
  now?: Date;
  onAttempt?: (attempt: number, error: ProviderError | null) => void;
  /** Required for paid adapters (no guard = blocked). */
  spend?: SpendGuard;
  /** Owner approval to re-run an operation whose earlier reservation was released. */
  retryApproved?: boolean;
}

export interface Executed {
  result: CapabilityResult;
  attempts: number;
  estimateMicros: number;
  actualMicros: number;
  /** Cents reserved in the spend guard (0 for free/mock operations). */
  reservedCents: number;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const isMock = (a: { provider: string; paid: boolean }) => !a.paid && a.provider === 'limo-mock';

/** Steps 1–3: returns the estimate in micros or throws OperationBlockedError (no network). */
export function preflight(adapter: Pick<CapabilityAdapter, 'paid' | 'provider' | 'estimateUsage'> & { capability: string }, req: CapabilityRequest, o: Pick<ExecuteOptions, 'price' | 'gate' | 'now'>): number {
  const problems = validateRequest(req);
  if (problems.length) throw new OperationBlockedError(problems);
  if (isMock(adapter)) return 0;
  if (adapter.provider === 'disabled') throw new OperationBlockedError(['provider_disabled']);
  let estimate: number | null = null;
  if (o.price && o.price.verifiedAt && o.price.verifiedBy) {
    try {
      estimate = operationCost(o.price, adapter.estimateUsage(req as never), { now: o.now }).micros;
    } catch {
      estimate = null;
    }
  }
  if (!adapter.paid && estimate === null && o.price === null) estimate = 0; // free operations (moderation)
  const blockers = paidCallBlockers({ ...o.gate, capability: adapter.capability as Capability, priceVerified: estimate !== null, estimateCents: estimate === null ? null : Math.ceil(estimate / 10_000) });
  if (blockers.length) throw new OperationBlockedError(blockers);
  return estimate ?? 0;
}

function actual(price: PriceSheet | null, result: CapabilityResult, now?: Date): number {
  if (!price || result.provenance.mock) return 0;
  try {
    return operationCost(price, result.usage, { now }).micros;
  } catch {
    // The call already happened: never return "free" silently — the worker records it for reconciliation.
    throw new ProviderError('unknown', 'actual cost could not be priced (needs reconciliation)');
  }
}

/** The retry policy, lowered by LIMO_AI_MAX_ATTEMPTS (never raised). */
export function effectivePolicy(capability: Capability, o: Pick<ExecuteOptions, 'policy' | 'gate'>): RetryPolicy {
  const base = o.policy ?? DEFAULT_RETRY[capability];
  const cap = Number(o.gate.env.LIMO_AI_MAX_ATTEMPTS);
  return Number.isInteger(cap) && cap >= 1 && cap < base.maxAttempts ? { ...base, maxAttempts: cap } : base;
}

/** Reserves the worst case before a paid call; returns the reserved cents (0 when the adapter is free or a mock). */
async function reserve(adapter: { paid: boolean; provider: string; model: string; capability: string }, req: CapabilityRequest, estimateMicros: number, o: ExecuteOptions): Promise<number> {
  if (!adapter.paid || isMock(adapter)) return 0;
  if (!o.spend) throw new OperationBlockedError(['spend_guard_missing']);
  const cents = reservationCents(estimateMicros, effectivePolicy(adapter.capability as Capability, o).maxAttempts);
  try {
    await o.spend.reserve({ opKey: req.requestKey, capability: adapter.capability as Capability, provider: adapter.provider, model: adapter.model, cents, organizationId: req.organizationId, retryApproved: o.retryApproved });
  } catch (e) {
    if (e instanceof SpendBlockedError) throw new OperationBlockedError([`spend:${e.reason}`]);
    throw e;
  }
  return cents;
}

/** Closes a reservation after a failed call (release when provably not billed, otherwise settle). */
export async function settleFailure(spend: SpendGuard | undefined, opKey: string, reservedCents: number, err: unknown, price: PriceSheet | null, now?: Date): Promise<void> {
  if (!spend || reservedCents <= 0) return;
  const pe = err instanceof ProviderError ? err : new ProviderError('unknown', err instanceof Error ? err.message : String(err));
  const s = failureSettlement(pe, price, reservedCents, now);
  if (s.action === 'release') await spend.release(opKey, pe.code);
  else await spend.settle(opKey, s.cents, { needsReconciliation: s.needsReconciliation, note: pe.code });
}

/** Settles a successful call at its actual cost; an unpriceable result is charged at the reservation and rethrown. */
async function settleSuccess(o: ExecuteOptions, opKey: string, reservedCents: number, result: CapabilityResult): Promise<number> {
  let micros: number;
  try {
    micros = actual(o.price, result, o.now);
  } catch (e) {
    if (o.spend && reservedCents > 0) await o.spend.settle(opKey, null, { providerRequestId: result.provenance.providerRequestId ?? null, needsReconciliation: true, note: 'unpriced' });
    throw e;
  }
  if (o.spend && reservedCents > 0) await o.spend.settle(opKey, Math.ceil(micros / 10_000), { providerRequestId: result.provenance.providerRequestId ?? null });
  return micros;
}

async function withRetry<T>(capability: Capability, fn: () => Promise<T>, o: ExecuteOptions): Promise<{ value: T; attempts: number }> {
  const policy = effectivePolicy(capability, o);
  const sleep = o.sleep ?? realSleep;
  for (let attempt = 1; ; attempt++) {
    try {
      const value = await fn();
      o.onAttempt?.(attempt, null);
      return { value, attempts: attempt };
    } catch (e) {
      const err = e instanceof ProviderError ? e : new ProviderError('unknown', e instanceof Error ? e.message : String(e));
      o.onAttempt?.(attempt, err);
      if (o.signal?.aborted) throw err;
      const delay = nextRetryDelay(policy, attempt, err.code, err.retryAfterMs);
      if (delay === null) throw err;
      await sleep(delay);
    }
  }
}

export async function executeOperation(adapter: CapabilityAdapter, req: CapabilityRequest, o: ExecuteOptions): Promise<Executed> {
  const estimateMicros = preflight(adapter, req, o);
  const reservedCents = await reserve(adapter, req, estimateMicros, o);
  const signal = o.signal ?? new AbortController().signal;
  let run: { value: CapabilityResult; attempts: number };
  try {
    run = await withRetry(adapter.capability as Capability, () => adapter.run(req as never, signal), o);
  } catch (e) {
    await settleFailure(o.spend, req.requestKey, reservedCents, e, o.price, o.now);
    throw e;
  }
  const actualMicros = await settleSuccess(o, req.requestKey, reservedCents, run.value);
  return { result: run.value, attempts: run.attempts, estimateMicros, actualMicros, reservedCents };
}

/** Async (video): submit only — the task id must be stored before polling. The reservation stays open until the
 *  result is collected (collectOperation) or the job fails (settleFailure with the stored reservedCents). */
export async function submitOperation(adapter: AsyncCapabilityAdapter, req: CapabilityRequest, o: ExecuteOptions) {
  const estimateMicros = preflight(adapter, req, o);
  const reservedCents = await reserve(adapter, req, estimateMicros, o);
  const signal = o.signal ?? new AbortController().signal;
  try {
    const { value, attempts } = await withRetry(adapter.capability as Capability, () => adapter.submit(req as never, signal), o);
    return { ...value, attempts, estimateMicros, reservedCents };
  } catch (e) {
    await settleFailure(o.spend, req.requestKey, reservedCents, e, o.price, o.now);
    throw e;
  }
}

export async function collectOperation(adapter: AsyncCapabilityAdapter, req: CapabilityRequest, outputRef: string, plan: Record<string, string | number>, o: ExecuteOptions & { reservedCents?: number }): Promise<Executed> {
  const signal = o.signal ?? new AbortController().signal;
  const reservedCents = adapter.paid && !isMock(adapter) ? (o.reservedCents ?? 0) : 0;
  let run: { value: CapabilityResult; attempts: number };
  try {
    run = await withRetry(adapter.capability as Capability, () => adapter.fetchResult(req as never, outputRef, plan, signal), o);
  } catch (e) {
    // The clip was generated (the provider bills it) even if the download failed: charge the reservation.
    if (o.spend && reservedCents > 0) await o.spend.settle(req.requestKey, null, { needsReconciliation: true, note: 'download_failed' });
    throw e;
  }
  const actualMicros = await settleSuccess(o, req.requestKey, reservedCents, run.value);
  return { result: run.value, attempts: run.attempts, estimateMicros: 0, actualMicros, reservedCents };
}
