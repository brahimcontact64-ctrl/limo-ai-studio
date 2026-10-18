/**
 * The only way an operation reaches a provider (Milestone 10). Order of checks:
 *   1. structural validation (validateRequest)
 *   2. price: a paid adapter needs a VERIFIED price sheet; the estimate is computed from it
 *   3. authorisation: paidCallBlockers (env flag, owner approval of the capability, provider enabled, verified
 *      price, budget, user confirmation of the amount, character references, approved script)
 *   4. call with bounded retries for transient errors only (rate limit, timeout, unavailable); a safety refusal,
 *      an invalid request, auth/quota problems or a disabled provider are never retried and never re-sent elsewhere
 *   5. actual cost from the provider's measured usage and the same verified sheet
 * Mock adapters (paid: false, provider "limo-mock") skip 2–3 and always cost 0.
 */
import { DEFAULT_RETRY, nextRetryDelay, operationCost, paidCallBlockers, ProviderError, validateRequest, type AsyncCapabilityAdapter, type BlockReason, type Capability, type CapabilityAdapter, type CapabilityRequest, type CapabilityResult, type PaidCallContext, type PriceSheet, type RetryPolicy } from './contracts.ts';

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
}

export interface Executed {
  result: CapabilityResult;
  attempts: number;
  estimateMicros: number;
  actualMicros: number;
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

async function withRetry<T>(capability: Capability, fn: () => Promise<T>, o: ExecuteOptions): Promise<{ value: T; attempts: number }> {
  const policy = o.policy ?? DEFAULT_RETRY[capability];
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
  const signal = o.signal ?? new AbortController().signal;
  const { value, attempts } = await withRetry(adapter.capability as Capability, () => adapter.run(req as never, signal), o);
  return { result: value, attempts, estimateMicros, actualMicros: actual(o.price, value, o.now) };
}

/** Async (video): submit only — the task id must be stored before polling. */
export async function submitOperation(adapter: AsyncCapabilityAdapter, req: CapabilityRequest, o: ExecuteOptions) {
  const estimateMicros = preflight(adapter, req, o);
  const signal = o.signal ?? new AbortController().signal;
  const { value, attempts } = await withRetry(adapter.capability as Capability, () => adapter.submit(req as never, signal), o);
  return { ...value, attempts, estimateMicros };
}

export async function collectOperation(adapter: AsyncCapabilityAdapter, req: CapabilityRequest, outputRef: string, plan: Record<string, string | number>, o: ExecuteOptions): Promise<Executed> {
  const signal = o.signal ?? new AbortController().signal;
  const { value, attempts } = await withRetry(adapter.capability as Capability, () => adapter.fetchResult(req as never, outputRef, plan, signal), o);
  return { result: value, attempts, estimateMicros: 0, actualMicros: actual(o.price, value, o.now) };
}
