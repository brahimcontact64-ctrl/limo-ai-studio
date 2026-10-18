import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateGenerationCost } from '../../lib/generation/cost.ts';
import { MockProvider } from '../../lib/generation/mock.ts';
import { assertLiveGenerationAllowed, GenerationBlockedError } from '../../lib/generation/gate.ts';
import type { ProviderAdapter } from '../../lib/generation/types.ts';

const policy = { script_flat_cents: 5, voice_per_minute_cents: 20, image_per_scene_cents: 4, video_per_second_cents: 5, render_flat_cents: 10, retry_buffer_percent: 25 };

test('cost estimate mirrors request_studio_generation', () => {
  const c = estimateGenerationCost(policy, { totalDurationSeconds: 30, sceneCount: 4, hasDialogue: true });
  // 5 + 1*20 + 4*4 + 30*5 + 10 = 201; *1.25 = 251.25 → 252
  assert.equal(c.base, 201);
  assert.equal(c.reserved, 252);
  // AI cost (cents) is separate from the export credit: a finished video always uses exactly one credit.
  assert.equal(c.exportCredits, 1);
  assert.equal(estimateGenerationCost(policy, { totalDurationSeconds: 10, sceneCount: 1, hasDialogue: false }).exportCredits, 1);
});

test('mock provider: idempotent submit, async completion, no cost', async () => {
  const p = new MockProvider('scene_video', 2);
  const req = { requestKey: 'run1:scene-video:1', organizationId: 'org', stage: 'scene_video' as const, prompt: 'x', durationSeconds: 8 };
  const a = await p.submit(req);
  const b = await p.submit(req);
  assert.equal(a.taskId, b.taskId);
  assert.equal((await p.poll(a.taskId)).status, 'running');
  const done = await p.poll(a.taskId);
  assert.equal(done.status, 'succeeded');
  assert.equal(done.actualCostCents, 0);
  assert.match(done.outputUrl ?? '', /\.mp4$/);
  assert.equal(p.estimate(req).cents, 0);
});

test('mock provider: failure path and provider duration limit', async () => {
  const p = new MockProvider('scene_video', 1);
  const t = await p.submit({ requestKey: 'k', organizationId: 'o', stage: 'scene_video', prompt: '[mock:fail]' });
  assert.equal((await p.poll(t.taskId)).status, 'failed');
  await assert.rejects(p.submit({ requestKey: 'k2', organizationId: 'o', stage: 'scene_video', prompt: 'x', durationSeconds: 16 }));
});

const paid: ProviderAdapter = { ...new MockProvider('scene_video'), code: 'paid_x', paid: true, capabilities: { stage: 'scene_video', referenceImages: true, asynchronous: true }, estimate: () => ({ cents: 1, basis: '' }), submit: async () => ({ taskId: '', status: 'queued' }), poll: async () => ({ status: 'queued' }) };
const req = { requestKey: 'k', organizationId: 'o', stage: 'scene_video' as const, prompt: 'x' };

test('gate: paid providers are blocked by default', () => {
  assert.throws(() => assertLiveGenerationAllowed(paid, req, { env: {}, providerEnabledInRegistry: true, missingReferences: [] }), (e) => e instanceof GenerationBlockedError && e.reason === 'paid_generation_disabled');
  assert.throws(() => assertLiveGenerationAllowed(paid, req, { env: { LIMO_ENABLE_PAID_GENERATION: 'true' }, providerEnabledInRegistry: false, missingReferences: [] }), /provider_disabled/);
  assert.doesNotThrow(() => assertLiveGenerationAllowed(paid, req, { env: { LIMO_ENABLE_PAID_GENERATION: 'true' }, providerEnabledInRegistry: true, missingReferences: [] }));
});

test('gate: visual stages require approved character references, even for mock', () => {
  assert.throws(() => assertLiveGenerationAllowed(new MockProvider('scene_image'), { ...req, stage: 'scene_image' }, { env: {}, providerEnabledInRegistry: true, missingReferences: ['limo_boy'] }), /missing_character_reference/);
  assert.doesNotThrow(() => assertLiveGenerationAllowed(new MockProvider('script'), { ...req, stage: 'script' }, { env: {}, providerEnabledInRegistry: false, missingReferences: ['limo_boy'] }));
});
