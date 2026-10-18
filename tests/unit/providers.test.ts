import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chooseFallback,
  classifyHttp,
  DEFAULT_RETRY,
  estimateTokens,
  nextRetryDelay,
  operationCost,
  paidCallBlockers,
  PriceSheetError,
  reservation,
  validateRequest,
  type PaidCallContext,
  type PriceSheet,
} from '../../lib/providers/contracts.ts';

// Placeholder numbers for arithmetic only — NOT real provider prices.
const sheet: PriceSheet = {
  provider: 'test',
  model: 'm1',
  currency: 'USD',
  prices: { input_tokens_1m: 1_000_000, output_tokens_1m: 4_000_000, video_second: 50_000, request: 0 },
  minimums: { video_second: 5 },
  source: 'unit test',
  verifiedAt: '2026-10-10T00:00:00Z',
  verifiedBy: 'owner',
};
const now = new Date('2026-10-18T00:00:00Z');

test('operation cost: tokens per million, minimums, rounding up to cents', () => {
  const c = operationCost(sheet, { inputTokens: 2_000, outputTokens: 1_500 }, { now });
  assert.deepEqual(c.lines.map((l) => [l.unit, l.micros]), [['input_tokens_1m', 2_000], ['output_tokens_1m', 6_000]]);
  assert.equal(c.micros, 8_000);
  assert.equal(c.cents, 1, '0.8 cent is reserved as 1 cent');
  const v = operationCost(sheet, { videoSeconds: 3 }, { now });
  assert.equal(v.lines[0]!.quantity, 5, 'provider minimum of 5 s applies');
  assert.equal(v.cents, 25);
  assert.equal(reservation(v, 20), 30);
});

test('unknown or unverified prices are never treated as free', () => {
  assert.throws(() => operationCost({ ...sheet, verifiedAt: null }, { inputTokens: 1 }, { now }), (e: unknown) => e instanceof PriceSheetError && e.reason === 'unverified');
  assert.throws(() => operationCost(sheet, { inputTokens: 1 }, { now: new Date('2026-12-31T00:00:00Z') }), (e: unknown) => e instanceof PriceSheetError && e.reason === 'stale');
  assert.throws(() => operationCost(sheet, { images: 1 }, { now }), (e: unknown) => e instanceof PriceSheetError && e.reason === 'unit_not_priced');
  assert.equal(operationCost(sheet, {}, { now }).cents, 0);
});

test('token estimate is denser for Arabic', () => {
  assert.equal(estimateTokens('a'.repeat(400)), 100);
  assert.equal(estimateTokens('ب'.repeat(400), 'ar'), 160);
});

test('retries: only transient errors, exponential back-off, Retry-After respected, bounded attempts', () => {
  const p = DEFAULT_RETRY.text;
  assert.equal(nextRetryDelay(p, 1, 'rate_limited'), 2_000);
  assert.equal(nextRetryDelay(p, 2, 'unavailable'), 4_000);
  assert.equal(nextRetryDelay(p, 1, 'rate_limited', 20_000), 20_000);
  assert.equal(nextRetryDelay(p, 3, 'timeout'), null);
  for (const c of ['content_refused', 'invalid_request', 'auth', 'quota_exceeded'] as const) assert.equal(nextRetryDelay(p, 1, c), null, c);
  assert.deepEqual([429, 504, 401, 402, 503, 422].map(classifyHttp), ['rate_limited', 'timeout', 'auth', 'quota_exceeded', 'unavailable', 'invalid_request']);
  assert.ok(DEFAULT_RETRY.video.pollDeadlineMs! >= 10 * 60_000);
});

test('fallback: never around a safety refusal, never over the approved cap or to an unpriced paid provider', () => {
  const chain = [
    { code: 'a', paid: true, enabled: true, circuitOpen: false, estimateCents: 10 },
    { code: 'b', paid: true, enabled: true, circuitOpen: true, estimateCents: 10 },
    { code: 'c', paid: true, enabled: true, circuitOpen: false, estimateCents: null },
    { code: 'd', paid: true, enabled: true, circuitOpen: false, estimateCents: 40 },
    { code: 'e', paid: true, enabled: true, circuitOpen: false, estimateCents: 12 },
  ];
  assert.equal(chooseFallback(chain, 'a', 'unavailable', 20)?.code, 'e');
  assert.equal(chooseFallback(chain, 'a', 'content_refused', 20), null);
  assert.equal(chooseFallback(chain, 'a', 'invalid_request', 20), null);
  assert.equal(chooseFallback(chain.slice(0, 4), 'a', 'timeout', 20), null);
});

const allowed: PaidCallContext = {
  env: { LIMO_ENABLE_PAID_GENERATION: 'true' },
  capability: 'video',
  capabilityApproved: true,
  providerEnabledInRegistry: true,
  priceVerified: true,
  estimateCents: 120,
  remainingBudgetCents: 1_000,
  confirmAboveCents: 50,
  userConfirmedCents: 120,
  missingReferences: [],
  sourceApproved: true,
};

test('paid-call gate: every condition is required; default environment blocks everything', () => {
  assert.deepEqual(paidCallBlockers(allowed), []);
  assert.deepEqual(paidCallBlockers({ ...allowed, env: {} }), ['paid_generation_disabled']);
  assert.deepEqual(paidCallBlockers({ ...allowed, capabilityApproved: false, providerEnabledInRegistry: false }), ['capability_not_approved', 'provider_disabled']);
  assert.deepEqual(paidCallBlockers({ ...allowed, estimateCents: null }), ['price_unverified']);
  assert.deepEqual(paidCallBlockers({ ...allowed, remainingBudgetCents: 100 }), ['budget_exceeded']);
  assert.deepEqual(paidCallBlockers({ ...allowed, userConfirmedCents: 100 }), ['user_confirmation_required'], 'confirmation must cover the full estimate');
  assert.deepEqual(paidCallBlockers({ ...allowed, missingReferences: ['NOVA'] }), ['missing_character_reference']);
  assert.deepEqual(paidCallBlockers({ ...allowed, sourceApproved: false }), ['content_not_approved']);
  assert.deepEqual(paidCallBlockers({ ...allowed, capability: 'text', sourceApproved: false, missingReferences: ['NOVA'] }), [], 'text drafts need neither');
});

test('request validation', () => {
  const base = { requestKey: 'k', organizationId: 'o', locale: 'en' as const };
  assert.deepEqual(validateRequest({ ...base, kind: 'character_image', prompt: 'p', references: [], size: { width: 1024, height: 1024 }, count: 1 }), ['approved character references required']);
  assert.deepEqual(validateRequest({ ...base, kind: 'video', prompt: 'p', firstFrameAssetId: null, references: [], durationSeconds: 30, videoTotalSeconds: 30, aspect: '9:16', scriptRevisionId: 'r' }), ['video duration 1–15 s per scene']);
  assert.deepEqual(validateRequest({ ...base, kind: 'video', prompt: 'p', firstFrameAssetId: null, references: [], durationSeconds: 15, videoTotalSeconds: 31, aspect: '9:16', scriptRevisionId: 'r' }), ['videos are limited to 30 s']);
  assert.deepEqual(validateRequest({ ...base, kind: 'video', prompt: 'p', firstFrameAssetId: null, references: [], durationSeconds: 15, videoTotalSeconds: 30, aspect: '9:16', scriptRevisionId: 'r' }), []);
  assert.deepEqual(validateRequest({ ...base, kind: 'translation', source: 'en', text: 'Rose Perfume 3 900 DA', lockedTerms: ['Rose Perfume', '3 900 DA'] }), []);
  assert.deepEqual(validateRequest({ ...base, kind: 'translation', source: 'en', text: 'Rose', lockedTerms: ['LIMO'] }), ['locked term not present in source']);
});
