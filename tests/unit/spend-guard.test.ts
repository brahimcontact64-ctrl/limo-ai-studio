/**
 * $10 AI pilot safeguards (Phase 4): the spend guard rules, the executor's reserve → settle/release protocol, the
 * kill switch, the no-paid-retry pilot policy, and the two pilot adapters (Gemini TTS, Claude safety review) against
 * MOCKED HTTP. No network, no API key, no cost. The database twin of the guard is tested in
 * scripts/sql/ai-spend-guard-test.sql (rules + 20 concurrent sessions).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { operationCost, paidCallBlockers, ProviderError, type CapabilityAdapter, type TextRequest, type VoiceRequest, type SafetyRequest } from '../../lib/providers/contracts.ts';
import { executeOperation, OperationBlockedError, preflight, type GateInput } from '../../lib/providers/execute.ts';
import { failureSettlement, memorySpendGuard, PILOT_GUARD, reservationCents, SPEND_BUCKET, SpendBlockedError } from '../../lib/providers/spend.ts';
import { RESEARCHED_PRICES, priceKey, verifySheet } from '../../lib/providers/prices.ts';
import { sheetFromRegistry } from '../../lib/providers/registry-prices.ts';
import { buildAdapters, safetyProvider, voiceProvider } from '../../lib/providers/registry.ts';
import { audioOf, estimatedCues, geminiTtsAdapter, pcmToWav, wavSeconds } from '../../lib/providers/adapters/gemini-tts.ts';
import { claudeSafetyAdapter, claudeTextAdapter, refusalBilling } from '../../lib/providers/adapters/anthropic.ts';
import type { FetchLike } from '../../lib/providers/http.ts';

const now = new Date('2026-10-19T00:00:00Z');
const signal = new AbortController().signal;
const gate: GateInput = { env: { LIMO_ENABLE_PAID_GENERATION: 'true' }, capabilityApproved: true, providerEnabledInRegistry: true, remainingBudgetCents: 10_000, confirmAboveCents: 1_000, userConfirmedCents: null, missingReferences: [], sourceApproved: true };
const claude = verifySheet(RESEARCHED_PRICES[priceKey('anthropic', 'claude-opus-5-5')]!, 'owner', now);
const textReq = (key = 'op-1'): TextRequest => ({ requestKey: key, organizationId: 'o', locale: 'fr', kind: 'text', task: 'rewrite', instructions: 'x', facts: {}, maxOutputTokens: 500 });
const pilot = () => memorySpendGuard({ enabled: true, ...PILOT_GUARD });

/** A paid fake adapter: records whether a reservation existed when the request was "sent". */
function fake(outcomes: Array<ProviderError | 'ok'>, guard?: ReturnType<typeof pilot>) {
  const a = {
    provider: 'anthropic', model: 'claude-opus-5-5', capability: 'text' as const, paid: true, locales: ['fr' as const], calls: 0, reservedAtSend: [] as boolean[],
    estimateUsage: () => ({ inputTokens: 2000, outputTokens: 1000 }), // $0.028 → 3 ¢ per attempt
    async run(r: TextRequest) {
      a.reservedAtSend.push(guard?.entries.get(r.requestKey)?.status === 'reserved');
      const o = outcomes[a.calls++] ?? 'ok';
      if (o !== 'ok') throw o;
      return { text: '{}', usage: { inputTokens: 1000, outputTokens: 500 }, provenance: { capability: 'text' as const, provider: 'anthropic', model: 'claude-opus-5-5', modelVersion: null, requestKey: r.requestKey, promptSha256: '', inputAssetIds: [], referenceAssetIds: [], characterSpecVersions: {}, approvedBy: null, createdAt: '', costMicros: null, currency: null, aiGenerated: true, contentCredentials: null, mock: false, providerRequestId: 'req_1' } };
    },
  };
  return a as CapabilityAdapter<TextRequest> & typeof a;
}

// ---- guard rules -------------------------------------------------------------------------------------------------
test('pilot allocation: $10 total, text $2 / images $2 / video $3 / voice $1, $2 contingency, $1 per operation', () => {
  assert.equal(PILOT_GUARD.limitCents, 1000);
  const caps = Object.values(PILOT_GUARD.caps).reduce((a, b) => a + b, 0);
  assert.equal(caps, 800);
  assert.equal(PILOT_GUARD.limitCents - caps, 200, 'contingency');
  assert.equal(SPEND_BUCKET.translation, 'text');
  assert.equal(SPEND_BUCKET.safety, 'text');
  assert.equal(SPEND_BUCKET.character_image, 'image');
});

test('guard: operation, bucket and total caps; duplicate keys; released keys need an approved retry; kill switch', async () => {
  const g = pilot();
  const r = (opKey: string, capability: 'text' | 'video' | 'voice' | 'image', cents: number, retryApproved = false) => g.reserve({ opKey, capability, provider: 'p', model: 'm', cents, retryApproved });
  const refused = async (p: Promise<void>, reason: string) => assert.rejects(p, (e: unknown) => e instanceof SpendBlockedError && e.reason === reason);
  await refused(r('a', 'text', 0), 'invalid_amount');
  await refused(r('a', 'text', 101), 'operation_cap');
  await r('a', 'text', 100);
  await refused(r('a', 'text', 1), 'already_reserved');
  await r('b', 'text', 100);
  await refused(r('c', 'text', 1), 'bucket_cap');
  await g.settle('a', 40);
  await r('c', 'text', 60, false); // a settled at 40 frees 60 of the text bucket
  await refused(r('a', 'text', 1), 'already_settled');
  await g.release('c', 'auth');
  await refused(r('c', 'text', 10), 'retry_requires_approval');
  await r('c', 'text', 10, true);
  for (const [k, c] of [['v1', 100], ['v2', 100], ['v3', 100]] as const) await r(k, 'video', c);
  await refused(r('v4', 'video', 1), 'bucket_cap');
  await r('i1', 'image', 100);
  await r('i2', 'image', 100);
  await r('s1', 'voice', 100);
  // text 40+100+10, video 300, image 200, voice 100 = 750 used; the rest is contingency for over-runs only.
  assert.equal(g.total(), 750);
  await g.settle('v1', 280); // a provider charged more than reserved: recorded, absorbed by the contingency
  assert.equal(g.total(), 930);
  await refused(r('t9', 'text', 51), 'bucket_cap');
  g.config.enabled = false;
  await refused(r('t10', 'voice', 1), 'kill_switch');
});

test('total limit holds across buckets even when every bucket has room', async () => {
  const g = memorySpendGuard({ enabled: true, limitCents: 150, maxOperationCents: 100, caps: { text: 100, image: 100 } });
  await g.reserve({ opKey: 'a', capability: 'text', provider: 'p', model: 'm', cents: 100 });
  await assert.rejects(g.reserve({ opKey: 'b', capability: 'image', provider: 'p', model: 'm', cents: 60 }), (e: unknown) => e instanceof SpendBlockedError && e.reason === 'budget_exceeded');
  await assert.rejects(g.reserve({ opKey: 'c', capability: 'video', provider: 'p', model: 'm', cents: 1 }), (e: unknown) => e instanceof SpendBlockedError && e.reason === 'bucket_not_allowed');
});

// ---- executor protocol -------------------------------------------------------------------------------------------
test('executor: a paid call without a guard is blocked before any request; mock adapters need none', async () => {
  const a = fake([]);
  await assert.rejects(executeOperation(a, textReq(), { price: claude, gate, now }), (e: unknown) => e instanceof OperationBlockedError && e.reasons.includes('spend_guard_missing'));
  assert.equal(a.calls, 0);
});

test('executor: reserves BEFORE sending, settles the actual cost after (1,000 in + 500 out = 1.4 ¢ → 2 ¢)', async () => {
  const g = pilot();
  const a = fake(['ok'], g);
  const ex = await executeOperation(a, textReq(), { price: claude, gate: { ...gate, env: { ...gate.env, LIMO_AI_MAX_ATTEMPTS: '1' } }, now, spend: g });
  assert.deepEqual(a.reservedAtSend, [true]);
  assert.equal(ex.reservedCents, 3, 'estimate $0.028 → 3 ¢ × 1 attempt');
  assert.equal(g.entries.get('op-1')?.status, 'settled');
  assert.equal(g.entries.get('op-1')?.actual, 2);
  assert.equal(g.total(), 2);
});

test('pilot policy LIMO_AI_MAX_ATTEMPTS=1: no paid retry; the default policy reserves every allowed attempt', async () => {
  const g = pilot();
  const once = fake([new ProviderError('timeout', 't')], g);
  await assert.rejects(executeOperation(once, textReq(), { price: claude, gate: { ...gate, env: { ...gate.env, LIMO_AI_MAX_ATTEMPTS: '1' } }, now, spend: g, sleep: async () => {} }));
  assert.equal(once.calls, 1);
  const e = g.entries.get('op-1')!;
  assert.equal(e.status, 'settled', 'a timeout may have been billed: charged at the reservation');
  assert.equal(e.actual, 3);
  assert.equal(e.reconcile, true);
  assert.equal(reservationCents(28_000, 3), 9);
  // The limit can only lower the policy, never raise it.
  const g2 = pilot();
  const a = fake([new ProviderError('unavailable', 'x'), 'ok'], g2);
  const ex = await executeOperation(a, textReq('op-2'), { price: claude, gate: { ...gate, env: { ...gate.env, LIMO_AI_MAX_ATTEMPTS: '9' } }, now, spend: g2, sleep: async () => {} });
  assert.equal(ex.reservedCents, 9);
  assert.equal(ex.attempts, 2);
});

test('failures: not-billed errors release, billed refusals settle at their usage, unknown outcomes settle at the reservation', async () => {
  for (const code of ['auth', 'invalid_request', 'quota_exceeded', 'rate_limited', 'disabled'] as const) {
    const g = pilot();
    const once = { ...gate, env: { ...gate.env, LIMO_AI_MAX_ATTEMPTS: '1' } };
    await assert.rejects(executeOperation(fake([new ProviderError(code, code)], g), textReq(), { price: claude, gate: once, now, spend: g }));
    assert.equal(g.entries.get('op-1')?.status, 'released', code);
    assert.equal(g.total(), 0, code);
  }
  const free = pilot();
  await assert.rejects(executeOperation(fake([new ProviderError('content_refused', 'no')], free), textReq(), { price: claude, gate, now, spend: free }));
  assert.equal(free.entries.get('op-1')?.status, 'released', 'an unbilled refusal costs nothing');
  const billed = pilot();
  await assert.rejects(executeOperation(fake([new ProviderError('content_refused', 'bio', undefined, { inputTokens: 5000, outputTokens: 0 })], billed), textReq(), { price: claude, gate, now, spend: billed }));
  assert.equal(billed.entries.get('op-1')?.actual, 2, '5,000 input tokens × $4/M = $0.02');
  assert.deepEqual(failureSettlement(new ProviderError('unknown', 'x'), claude, 7), { action: 'settle', cents: 7, needsReconciliation: true });
});

test('a duplicate operation is never sent twice: the second execution is blocked by the guard', async () => {
  const g = pilot();
  const a = fake(['ok', 'ok'], g);
  await executeOperation(a, textReq(), { price: claude, gate, now, spend: g });
  await assert.rejects(executeOperation(a, textReq(), { price: claude, gate, now, spend: g }), (e: unknown) => e instanceof OperationBlockedError && e.reasons.includes('spend:already_settled'));
  assert.equal(a.calls, 1);
});

test('concurrency (in-process): 20 parallel $1 operations against a $3 video cap → exactly 3 are sent', async () => {
  const g = pilot();
  const sent: string[] = [];
  const results = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => g.reserve({ opKey: `v${i}`, capability: 'video', provider: 'google', model: 'veo', cents: 100 }).then(() => sent.push(`v${i}`))));
  assert.equal(sent.length, 3);
  assert.equal(results.filter((r) => r.status === 'rejected').length, 17);
});

test('kill switch: LIMO_AI_KILL_SWITCH=on blocks every paid call at preflight; unset leaves the other gates in charge', () => {
  const a = fake([]);
  assert.throws(() => preflight(a, textReq(), { price: claude, gate: { ...gate, env: { ...gate.env, LIMO_AI_KILL_SWITCH: 'on' } }, now }), (e: unknown) => e instanceof OperationBlockedError && e.reasons.includes('kill_switch'));
  assert.deepEqual(paidCallBlockers({ ...gate, env: { LIMO_ENABLE_PAID_GENERATION: 'true', LIMO_AI_KILL_SWITCH: 'TRUE' }, capability: 'image', priceVerified: true, estimateCents: 1 }), ['kill_switch']);
  assert.deepEqual(paidCallBlockers({ ...gate, env: { LIMO_ENABLE_PAID_GENERATION: 'true', LIMO_AI_KILL_SWITCH: 'off' }, capability: 'image', priceVerified: true, estimateCents: 1 }), []);
});

test('a price with an end date is refused after it (Gemini TTS listed price ends 2026-12-31)', () => {
  const tts = verifySheet(RESEARCHED_PRICES['google/gemini-3.8-flash-tts']!, 'owner', new Date('2027-01-01T00:00:00Z'));
  assert.equal(operationCost({ ...tts, verifiedAt: '2026-12-30T00:00:00Z' }, { inputTokens: 100, outputTokens: 800 }, { now: new Date('2026-12-31T12:00:00Z') }).micros, 50 + 7_200);
  assert.throws(() => operationCost(tts, { inputTokens: 100 }, { now: new Date('2027-01-01T08:00:00Z') }), /valid until 2026-12-31/);
  const row = sheetFromRegistry({ code: 'google_tts_v1', provider: 'google', stage_type: 'voice', model_id: 'gemini-3.8-flash-tts', credential_env_key: 'GEMINI_API_KEY', enabled: false, is_default: false, pricing_unit: 'token', pricing_metadata: { usd_per_1m_input_tokens: 0.5, usd_per_1m_output_tokens: 9, price_valid_until: '2026-12-31' }, official_reference: null, verified_at: null });
  assert.equal(row.validUntil, '2026-12-31');
});

// ---- pilot adapters against mocked HTTP --------------------------------------------------------------------------
interface Call { url: string; headers: Headers; body: any }
function fakeFetch(handler: (c: Call) => Response) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init = {}) => {
    const c = { url: String(url), headers: new Headers(init.headers as HeadersInit), body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body };
    calls.push(c);
    return handler(c);
  };
  return { fetch, calls };
}
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'content-type': 'application/json' } });
const voiceReq: VoiceRequest = { requestKey: 'v-1', organizationId: 'o', locale: 'fr', kind: 'voice', text: 'Bienvenue chez Atlas, le goût du pain frais.', voiceId: 'Kore', voiceProfileVersion: null, scriptRevisionId: 'r' };

test('Gemini TTS: Interactions request (model, key header, user_input, audio format, voice) → WAV, duration, estimated cues', async () => {
  const pcm = new Uint8Array(48_000 * 2); // 2 s at 24 kHz, 16-bit mono
  const { fetch, calls } = fakeFetch(() => json({ id: 'int_1', status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'audio', mime_type: 'audio/L16;codec=pcm;rate=24000', data: Buffer.from(pcm).toString('base64') }] }], usage: { total_input_tokens: 20, total_output_tokens: 64 } }));
  const r = await geminiTtsAdapter({ apiKey: 'test-key', fetch }).run(voiceReq, signal);
  const c = calls[0]!;
  assert.equal(c.url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
  assert.equal(c.headers.get('x-goog-api-key'), 'test-key');
  assert.equal(c.body.model, 'gemini-3.8-flash-tts');
  assert.deepEqual(c.body.input, [{ type: 'user_input', content: [{ type: 'text', text: voiceReq.text }] }]);
  assert.deepEqual(c.body.response_format, { type: 'audio' });
  assert.deepEqual(c.body.generation_config, { speech_config: [{ voice: 'Kore' }] });
  const wav = r.files![0]!;
  assert.equal(wav.mime, 'audio/wav');
  assert.equal(Buffer.from(wav.bytes.slice(0, 4)).toString(), 'RIFF');
  assert.equal(r.json?.audio_seconds, 2);
  assert.deepEqual(r.usage, { inputTokens: 20, outputTokens: 64 });
  assert.ok(r.subtitles!.length >= 1 && r.subtitles!.at(-1)!.endMs === 2000);
  assert.ok(r.issues!.some((i) => i.code === 'estimated_timing'));
  assert.equal(r.provenance.voiceId, 'Kore');
});

test('Gemini TTS: WAV kept as is; filtered output is content_refused; bad voice and missing usage handled safely', async () => {
  const wav = pcmToWav(new Uint8Array(24_000 * 2), 24_000);
  assert.equal(wavSeconds(wav), 1);
  assert.equal(audioOf({ steps: [{ type: 'model_output', content: [{ type: 'audio', mime_type: 'audio/wav', data: Buffer.from(wav).toString('base64') }] }] })!.byteLength, wav.byteLength);
  assert.throws(() => audioOf({ steps: [{ type: 'model_output', content: [{ type: 'audio', mime_type: 'audio/mpeg', data: 'AA==' }] }] }), /unexpected audio format/);
  const none = fakeFetch(() => json({ status: 'completed', steps: [] }));
  await assert.rejects(geminiTtsAdapter({ apiKey: 'k', fetch: none.fetch }).run(voiceReq, signal), (e: unknown) => e instanceof ProviderError && e.code === 'content_refused');
  const bad = fakeFetch(() => json({}));
  await assert.rejects(geminiTtsAdapter({ apiKey: 'k', fetch: bad.fetch }).run({ ...voiceReq, voiceId: '../x' }, signal), /invalid Gemini voice name/);
  assert.equal(bad.calls.length, 0);
  const noUsage = fakeFetch(() => json({ status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'audio', mime_type: 'audio/wav', data: Buffer.from(wav).toString('base64') }] }] }));
  const r = await geminiTtsAdapter({ apiKey: 'k', fetch: noUsage.fetch }).run(voiceReq, signal);
  assert.ok((r.usage.outputTokens ?? 0) > 0, 'missing usage is billed at the estimate, never as free');
  assert.ok(r.issues!.some((i) => i.code === 'usage_estimated'));
  assert.deepEqual(estimatedCues('', 3), []);
});

const claudeMessage = (text: string, extra: Record<string, unknown> = {}) => ({
  id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, stop_details: null,
  usage: { input_tokens: 2100, output_tokens: 60, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, ...extra,
});
const safetyReq: SafetyRequest = { requestKey: 's-1', organizationId: 'o', locale: 'fr', kind: 'safety', text: 'Scène 1 : pain chaud, sourire.', imageAssetIds: ['img-1'] };

test('Claude safety review: images + text, reviewer system prompt, JSON decision; unknown decisions become review', async () => {
  const { fetch, calls } = fakeFetch(() => json(claudeMessage(JSON.stringify({ decision: 'allow', categories: [], rationale: 'bakery ad' }))));
  const a = claudeSafetyAdapter({ apiKey: 'test-key', fetch, loadAsset: async () => ({ bytes: new Uint8Array([137, 80, 78, 71]), mime: 'image/png' }) });
  const r = await a.run(safetyReq, signal);
  const body = calls[0]!.body;
  assert.match(body.system, /content safety reviewer/);
  assert.equal(body.messages[0].content[0].type, 'image');
  assert.equal(body.messages[0].content[0].source.media_type, 'image/png');
  assert.equal(body.messages[0].content[1].type, 'text');
  assert.equal(body.output_config.format.schema.properties.decision.enum.join(','), 'allow,review,block');
  assert.equal(r.json?.decision, 'allow');
  assert.deepEqual(r.usage, { inputTokens: 2100, outputTokens: 60 });
  const odd = fakeFetch(() => json(claudeMessage(JSON.stringify({ decision: 'maybe', categories: ['x'], rationale: '' }))));
  assert.equal((await claudeSafetyAdapter({ apiKey: 'k', fetch: odd.fetch, loadAsset: async () => ({ bytes: new Uint8Array(1), mime: 'image/png' }) }).run(safetyReq, signal)).json?.decision, 'review');
  const gif = fakeFetch(() => json({}));
  await assert.rejects(claudeSafetyAdapter({ apiKey: 'k', fetch: gif.fetch, loadAsset: async () => ({ bytes: new Uint8Array(1), mime: 'image/tiff' }) }).run(safetyReq, signal), /unsupported image type/);
  assert.equal(gif.calls.length, 0);
});

test('Claude refusal billing: billed categories and partial output carry usage; other refusals are free', async () => {
  assert.equal(refusalBilling('cyber', { input_tokens: 900, output_tokens: 0 }), undefined);
  assert.deepEqual(refusalBilling('bio', { input_tokens: 900, output_tokens: 0 }), { inputTokens: 900, outputTokens: 0 });
  assert.deepEqual(refusalBilling('cyber', { input_tokens: 900, output_tokens: 40 }), { inputTokens: 900, outputTokens: 40 });
  const refused = fakeFetch(() => json(claudeMessage('', { stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'frontier_llm', explanation: null }, usage: { input_tokens: 800, output_tokens: 0 } })));
  await assert.rejects(claudeTextAdapter({ apiKey: 'k', fetch: refused.fetch }).run(textReq(), signal), (e: unknown) => e instanceof ProviderError && e.code === 'content_refused' && e.billedUsage?.inputTokens === 800);
});

test('registry: pilot selectors pick Gemini TTS and the Claude safety review; defaults are unchanged', () => {
  assert.equal(voiceProvider({}), 'elevenlabs');
  assert.equal(safetyProvider({}), 'openai');
  const live = { LIMO_GENERATION_MODE: 'live', LIMO_ENABLE_PAID_GENERATION: 'true', ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g', LIMO_VOICE_PROVIDER: 'google', LIMO_SAFETY_PROVIDER: 'anthropic' };
  const a = buildAdapters(live, { loadAsset: async () => ({ bytes: new Uint8Array(1), mime: 'image/png' }) });
  assert.equal(a.voice.provider, 'google');
  assert.equal(a.voice.model, 'gemini-3.8-flash-tts');
  assert.equal(a.safety.provider, 'anthropic');
  assert.equal(a.safety.capability, 'safety');
  const off = buildAdapters({ ...live, LIMO_GENERATION_MODE: 'off' }, { loadAsset: async () => ({ bytes: new Uint8Array(1), mime: 'image/png' }) });
  assert.equal(off.voice.provider, 'disabled');
});
