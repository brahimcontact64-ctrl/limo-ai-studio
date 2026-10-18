import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProviderError, type CapabilityAdapter, type ImageRequest, type TextRequest } from '../../lib/providers/contracts.ts';
import { executeOperation, OperationBlockedError, preflight, type GateInput } from '../../lib/providers/execute.ts';
import { RESEARCHED_PRICES, priceKey, verifySheet } from '../../lib/providers/prices.ts';
import { buildAdapters, generationMode } from '../../lib/providers/registry.ts';
import { mockImageAdapter, mockVideoAdapter, mockVoiceAdapter, solidPng, toneWav } from '../../lib/providers/mocks.ts';
import { buildPlan, type PlanInput } from '../../lib/generation/plan.ts';
import { ARTWORK_TOTALS, identityChecks, nextSheets, sheetPlan } from '../../lib/characters/artwork.ts';
import { canonFor } from '../../lib/characters/canon.ts';

const now = new Date('2026-10-19T00:00:00Z');
const loadAsset = async () => ({ bytes: new Uint8Array([1]), mime: 'image/png' });
const signal = new AbortController().signal;
const imgReq: ImageRequest = { requestKey: 'k', organizationId: 'o', locale: 'en', kind: 'image', task: 'generate', prompt: 'p', inputAssetIds: [], size: { width: 1080, height: 1080 }, count: 1 };
const textReq: TextRequest = { requestKey: 'k', organizationId: 'o', locale: 'en', kind: 'text', task: 'rewrite', instructions: 'x', facts: {}, maxOutputTokens: 500 };
const openGate: GateInput = { env: { LIMO_ENABLE_PAID_GENERATION: 'true' }, capabilityApproved: true, providerEnabledInRegistry: true, remainingBudgetCents: 10_000, confirmAboveCents: 1_000, userConfirmedCents: null, missingReferences: [], sourceApproved: true };
const verifiedClaude = verifySheet(RESEARCHED_PRICES[priceKey('anthropic', 'claude-opus-5-5')]!, 'owner', now);

function fakeText(behaviour: Array<ProviderError | 'ok'>): CapabilityAdapter<TextRequest> & { calls: number } {
  const a = {
    provider: 'anthropic', model: 'claude-opus-5-5', capability: 'text' as const, paid: true, locales: ['en' as const], calls: 0,
    estimateUsage: () => ({ inputTokens: 2000, outputTokens: 1000 }),
    async run() {
      const b = behaviour[a.calls++] ?? 'ok';
      if (b !== 'ok') throw b;
      return { text: '{}', usage: { inputTokens: 2000, outputTokens: 1000 }, provenance: { capability: 'text' as const, provider: 'anthropic', model: 'claude-opus-5-5', modelVersion: null, requestKey: 'k', promptSha256: '', inputAssetIds: [], referenceAssetIds: [], characterSpecVersions: {}, approvedBy: null, createdAt: '', costMicros: null, currency: null, aiGenerated: true, contentCredentials: null, mock: false } };
    },
  };
  return a;
}

test('researched prices are all UNVERIFIED: every paid estimate is blocked until the owner verifies the sheet', () => {
  for (const [k, s] of Object.entries(RESEARCHED_PRICES)) {
    assert.equal(s.verifiedAt, null, k);
    assert.equal(s.verifiedBy, null, k);
    assert.equal(s.researchedAt, '2026-10-18', k);
    assert.match(s.source, /^https:\/\//, k);
  }
  assert.throws(() => preflight(fakeText([]), textReq, { price: RESEARCHED_PRICES[priceKey('anthropic', 'claude-opus-5-5')]!, gate: openGate, now }), (e: unknown) => e instanceof OperationBlockedError && e.reasons.includes('price_unverified'));
  assert.throws(() => verifySheet(RESEARCHED_PRICES['openai/whisper-1']!, '  '), /verifier required/);
});

test('cost per operation from verified prices (Claude Opus 5.5: 2,000 in + 1,000 out = $0.028)', () => {
  assert.equal(preflight(fakeText([]), textReq, { price: verifiedClaude, gate: openGate, now }), 28_000);
});

test('paid calls are blocked by default: no env flag, capability not approved, provider disabled, over budget', () => {
  const a = fakeText([]);
  const reasons = (g: Partial<GateInput>) => {
    try {
      preflight(a, textReq, { price: verifiedClaude, gate: { ...openGate, ...g }, now });
      return [];
    } catch (e) {
      return (e as OperationBlockedError).reasons;
    }
  };
  assert.deepEqual(reasons({ env: {} }), ['paid_generation_disabled']);
  assert.deepEqual(reasons({ capabilityApproved: false }), ['capability_not_approved']);
  assert.deepEqual(reasons({ providerEnabledInRegistry: false }), ['provider_disabled']);
  assert.deepEqual(reasons({ remainingBudgetCents: 2 }), ['budget_exceeded']);
  assert.deepEqual(reasons({ confirmAboveCents: 1 }), ['user_confirmation_required']);
  assert.deepEqual(reasons({}), []);
});

test('retries: transient errors are retried with back-off and paid once; refusals and disabled are never retried', async () => {
  const slept: number[] = [];
  const sleep = async (ms: number) => void slept.push(ms);
  const flaky = fakeText([new ProviderError('rate_limited', 'slow', 4000), new ProviderError('unavailable', 'down')]);
  const ok = await executeOperation(flaky, textReq, { price: verifiedClaude, gate: openGate, sleep, now });
  assert.equal(ok.attempts, 3);
  assert.deepEqual(slept, [4000, 4000]);
  assert.equal(ok.actualMicros, 28_000);
  for (const code of ['content_refused', 'disabled', 'invalid_request', 'auth', 'quota_exceeded'] as const) {
    const a = fakeText([new ProviderError(code, code)]);
    await assert.rejects(executeOperation(a, textReq, { price: verifiedClaude, gate: openGate, sleep, now }), (e: unknown) => e instanceof ProviderError && e.code === code);
    assert.equal(a.calls, 1, `${code} must not be retried`);
  }
  const always = fakeText([new ProviderError('timeout', 't'), new ProviderError('timeout', 't'), new ProviderError('timeout', 't'), new ProviderError('timeout', 't')]);
  await assert.rejects(executeOperation(always, textReq, { price: verifiedClaude, gate: openGate, sleep, now }), /t/);
  assert.equal(always.calls, 3, 'bounded by maxAttempts');
});

test('registry: off by default; live needs BOTH flags; mock is labelled; disabled adapters never touch the network', async () => {
  assert.equal(generationMode({}), 'off');
  assert.equal(generationMode({ LIMO_GENERATION_MODE: 'live' }), 'off', 'live without LIMO_ENABLE_PAID_GENERATION stays off');
  assert.equal(generationMode({ LIMO_GENERATION_MODE: 'live', LIMO_ENABLE_PAID_GENERATION: 'true' }), 'live');
  assert.equal(generationMode({ LIMO_GENERATION_MODE: 'MOCK' }), 'mock');
  const off = buildAdapters({ ANTHROPIC_API_KEY: 'k' }, { loadAsset });
  await assert.rejects(off.text.run(textReq, signal), (e: unknown) => e instanceof ProviderError && e.code === 'disabled');
  await assert.rejects(off.video.submit({ ...imgReq, kind: 'video', prompt: 'p', firstFrameAssetId: null, references: [], durationSeconds: 4, videoTotalSeconds: 4, aspect: '9:16', scriptRevisionId: 'r' } as never, signal), (e: unknown) => e instanceof ProviderError && e.code === 'disabled');
  // Live mode without a network client given: the adapters get the blocked fetch, not the global one.
  const blocked: string[] = [];
  const liveNoFetch = buildAdapters({ LIMO_GENERATION_MODE: 'live', LIMO_ENABLE_PAID_GENERATION: 'true', GEMINI_API_KEY: 'g' }, { loadAsset, onBlocked: (h) => blocked.push(h) });
  await assert.rejects(liveNoFetch.image.run(imgReq, signal), (e: unknown) => e instanceof ProviderError && e.code === 'disabled');
  assert.deepEqual(blocked, ['generativelanguage.googleapis.com']);
  const liveNoKey = buildAdapters({ LIMO_GENERATION_MODE: 'live', LIMO_ENABLE_PAID_GENERATION: 'true' }, { loadAsset });
  await assert.rejects(liveNoKey.voice.run({ ...textReq, kind: 'voice', text: 'hi', voiceId: 'Voice1234abcd', voiceProfileVersion: null, scriptRevisionId: 'r' } as never, signal), /ELEVENLABS_API_KEY is not configured/);
  const mock = buildAdapters({ LIMO_GENERATION_MODE: 'mock' }, { loadAsset });
  const r = await mock.image.run(imgReq, signal);
  assert.equal(r.provenance.mock, true);
  assert.equal(r.provenance.aiGenerated, false);
});

test('mocks: real files (PNG, WAV), no cost, honest video (still, not animated)', async () => {
  const png = solidPng(4, 3, [10, 20, 30]);
  assert.deepEqual([...png.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const wav = toneWav(1.5);
  assert.equal(Buffer.from(wav.slice(0, 4)).toString(), 'RIFF');
  assert.equal(wav.byteLength, 44 + Math.round(1.5 * 22050) * 2);
  const ex = await executeOperation(mockImageAdapter(), imgReq, { price: null, gate: { ...openGate, env: {} }, now });
  assert.equal(ex.actualMicros, 0);
  const v = mockVideoAdapter();
  const req = { ...imgReq, kind: 'video' as const, prompt: 'p', firstFrameAssetId: 'img-1', references: [], durationSeconds: 5, videoTotalSeconds: 5, aspect: '9:16' as const, scriptRevisionId: 'r' };
  const sub = await v.submit(req, signal);
  const res = await v.fetchResult(req, sub.taskId, sub.plan, signal);
  assert.deepEqual(res.json, { still_asset_id: 'img-1', animated: false });
  assert.equal(res.files?.length, 0);
  const voice = await mockVoiceAdapter().run({ ...textReq, kind: 'voice', text: 'Fresh bread every morning at the bakery', voiceId: 'v', voiceProfileVersion: null, scriptRevisionId: 'r' } as never, signal);
  assert.ok((voice.subtitles?.length ?? 0) >= 1);
});

// ---- planner ---------------------------------------------------------------------------------------------------
const opts = { images: true, video: true, voice: true, videoTier: 'fast' as const, resolution: '720p' as const, imageModel: 'gemini-nano-banana-2.1', characterImageModel: 'gemini-3-pro-image', imageSize: '1K' as const, voiceModel: 'eleven_flash_v2_5', narratorVoiceId: 'Voice1234abcd', textModel: 'claude-opus-5-5' };
const plan = (over: Partial<PlanInput> = {}): PlanInput => ({
  projectId: 'p', revisionId: 'rev-1', language: 'en', aspect: '9:16', styleHint: 'warm', characters: [], options: opts,
  scenes: [
    { scene_number: 1, duration_seconds: 5, title: 'Hook', narration: 'Meet Rose Perfume.', dialogue: '', visual_prompt: 'Perfume on marble', camera_prompt: 'slow push-in', participants: [], media: { asset_id: 'photo-1', media_type: 'image' } },
    { scene_number: 2, duration_seconds: 7, title: 'Mood', narration: '', dialogue: '', visual_prompt: 'Rose petals falling', camera_prompt: '', participants: [] },
  ],
  ...over,
});
const verifiedAll = Object.fromEntries(Object.entries(RESEARCHED_PRICES).map(([k, s]) => [k, verifySheet(s, 'owner', now)]));

test('planner: customer photo kept (no image op), clip lengths 4/6/8 s, voice only where there is text, idempotent keys', () => {
  const p = buildPlan(plan(), verifiedAll, { retryBufferPercent: 25, now });
  const kinds = p.ops.map((o) => `${o.kind}:${o.scene ?? '-'}`);
  assert.deepEqual(kinds, ['safety:-', 'scene_prompts:-', 'scene_video:1', 'voice:1', 'scene_image:2', 'scene_video:2']);
  assert.deepEqual(p.ops.filter((o) => o.kind === 'scene_video').map((o) => o.clipSeconds), [6, 8]);
  assert.equal(p.generationAspect, '9:16');
  assert.deepEqual(p.blockers, []);
  // Same inputs → same keys (a retry or a second request never pays twice).
  assert.deepEqual(buildPlan(plan(), verifiedAll, { retryBufferPercent: 25, now }).ops.map((o) => o.key), p.ops.map((o) => o.key));
});

test('planner: exporting 1:1 or 4:5 reuses the 9:16 footage (same keys, no new generation); 16:9 is a different generation', () => {
  const keys = (aspect: PlanInput['aspect']) => buildPlan(plan({ aspect }), verifiedAll, { retryBufferPercent: 25, now }).ops.map((o) => o.key);
  assert.deepEqual(keys('1:1'), keys('9:16'));
  assert.deepEqual(keys('4:5'), keys('9:16'));
  assert.notDeepEqual(keys('16:9'), keys('9:16'));
});

test('planner: costs from verified prices with retry buffer; unverified prices and the 30 s limit block the plan', () => {
  const p = buildPlan(plan(), verifiedAll, { retryBufferPercent: 25, now });
  // video 6 s + 8 s at $0.10/s = $1.40; one 1K image $0.0336 + 300 input tokens; voice 18 chars at $0.04/1k; Claude prompts.
  const video = p.ops.filter((o) => o.kind === 'scene_video').reduce((a, o) => a + (o.costMicros ?? 0), 0);
  assert.equal(video, 1_400_000);
  assert.ok(p.totalMicros! > 1_400_000 && p.totalMicros! < 1_600_000, String(p.totalMicros));
  assert.equal(p.reserveCents, Math.ceil(Math.ceil(p.totalMicros! / 10_000) * 1.25));
  const unverified = buildPlan(plan(), RESEARCHED_PRICES, { retryBufferPercent: 25, now });
  assert.equal(unverified.totalMicros, null);
  assert.ok(unverified.blockers.includes('price_unverified'));
  const long = buildPlan(plan({ scenes: [...plan().scenes, { ...plan().scenes[1]!, scene_number: 3, duration_seconds: 15, media: null }, { ...plan().scenes[1]!, scene_number: 4, duration_seconds: 5, media: null }] }), verifiedAll, { retryBufferPercent: 25, now });
  assert.ok(long.blockers.some((b) => b.startsWith('video_too_long')));
});

test('planner: characters need approved references; product scenes without characters are never blocked', () => {
  const withCast = plan({ scenes: [{ ...plan().scenes[1]!, participants: ['limo_boy'] }] });
  const blocked = buildPlan(withCast, verifiedAll, { retryBufferPercent: 25, now });
  assert.ok(blocked.blockers.includes('missing_character_reference'));
  const ready = buildPlan({ ...withCast, characters: [{ id: 'limo_boy', name: 'Limo', specVersion: 1, assetIds: ['front', 'tq', 'side'], identityText: 'LIMO child tomato' }] }, verifiedAll, { retryBufferPercent: 25, now });
  assert.deepEqual(ready.blockers, []);
  const img = ready.ops.find((o) => o.kind === 'scene_image')!;
  assert.equal(img.model, 'gemini-3-pro-image', 'character scenes are priced and generated with the character model');
  assert.equal(img.costMicros, 134_000 + (300 + 600 * 2) * 2, 'Pro 1K image + input tokens at $2/M');
  const vid = ready.ops.find((o) => o.kind === 'scene_video')!;
  assert.equal(vid.clipSeconds, 8, 'reference images require 8 s clips');
  assert.deepEqual(vid.references, ['front', 'tq']);
  const lite = buildPlan({ ...withCast, characters: ready.ops.length ? [{ id: 'limo_boy', name: 'Limo', specVersion: 1, assetIds: ['front'], identityText: 'x' }] : [], options: { ...opts, videoTier: 'lite' } }, verifiedAll, { retryBufferPercent: 25, now });
  assert.deepEqual(lite.ops.find((o) => o.kind === 'scene_video')!.references, [], 'Lite takes no references');
});

// ---- character artwork ------------------------------------------------------------------------------------------
test('character artwork: 18 characters, 3 required views (54 images), 14 sheets each; front first, others locked to it', () => {
  assert.deepEqual(ARTWORK_TOTALS, { characters: 18, requiredPerCharacter: 3, sheetsPerCharacter: 14 });
  const p = sheetPlan('nova_woman', 1);
  assert.equal(p.length, 14);
  assert.deepEqual(nextSheets(p, new Set()).map((t) => t.slot), ['view:front']);
  assert.equal(nextSheets(p, new Set(['view:front'])).length, 13);
  const front = p[0]!.prompt;
  assert.match(front, /strawberry/i);
  assert.match(front, /#EFECF7/);
  assert.match(front, /Never: realistic human skin/);
  assert.ok(identityChecks(canonFor('adam_man')!).some((c) => c.startsWith('Crown:')));
  assert.throws(() => sheetPlan('unknown_x', 1), /unknown character/);
});
