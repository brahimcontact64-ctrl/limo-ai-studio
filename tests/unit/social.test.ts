import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { composePost, missingFacts, subjectFrom, suggestTime, factsFromBrief } from '../../lib/social/compose.ts';
import { isValidTimeZone, nextSlot, utcToZoned, zonedToUtc, weekdayIn } from '../../lib/social/schedule.ts';
import { normalizeRules, planAutomationPost } from '../../lib/social/automation.ts';
import { MetaGraphAdapter, MockFacebookAdapter, normalizeGraphError, PublishError } from '../../lib/social/adapter.ts';
import { verifyMetaSignature, verifySubscription, webhookActions } from '../../lib/social/webhook.ts';
import { socialError } from '../../lib/social/errors.ts';
import { EMPTY_FACTS, type ComposeInput } from '../../lib/social/types.ts';

const PLACEHOLDER = /\[[^\]\n]{1,80}\]/;
const base: ComposeInput = {
  prompt: 'Create a Facebook post promoting my restaurant’s new chicken meal, using my brand style, with a friendly tone and a call to action.',
  business_type: 'restaurant', tone: 'friendly', language: 'en', brand: { name: 'Dar Lemon', cta: '' }, facts: { ...EMPTY_FACTS },
  media: [], timezone: 'Africa/Algiers', now: new Date('2026-10-17T08:00:00Z'),
};

test('composer: writes from the customer’s words only; no invented prices, offers or reviews', () => {
  const r = composePost(base);
  assert.equal(r.provider, 'mock');
  assert.equal(r.proposals.length, 3);
  assert.equal(subjectFrom(base), 'my restaurant’s new chicken meal');
  for (const p of r.proposals) {
    assert.ok(p.caption.includes('my restaurant’s new chicken meal'));
    assert.doesNotMatch(p.caption, /\d/, 'no numbers were given, so none may appear');
    assert.equal(p.cta, 'Order now');
    if (p.variant !== 'short') assert.ok(p.headline.startsWith('Dar Lemon'));
  }
  assert.deepEqual(r.missing_facts, []);
  assert.doesNotMatch(r.proposals[0]!.caption, PLACEHOLDER);
});

test('composer: requested facts that are missing become blocking [placeholders]; given facts are used verbatim', () => {
  const ask = { ...base, prompt: 'Post about our new chicken meal with the price, a 20% discount and customer reviews' };
  assert.deepEqual(missingFacts(ask), ['price', 'offer', 'testimonial']);
  const r = composePost(ask);
  assert.match(r.proposals[0]!.caption, /\[Price\]/);
  assert.match(r.proposals[0]!.caption, /\[Offer details\]/);
  assert.match(r.proposals[0]!.caption, /\[Paste a real customer review\]/);
  assert.doesNotMatch(r.proposals[0]!.caption, /20%.*off|stars|“[^[]/);
  const given = composePost({ ...ask, prompt: 'Post about our chicken meal with the price', facts: { ...EMPTY_FACTS, product_name: 'Chicken Box', price: '850 DA' } });
  assert.deepEqual(given.missing_facts, []);
  assert.match(given.proposals[0]!.caption, /Price: 850 DA/);
  assert.doesNotMatch(given.proposals[0]!.caption, PLACEHOLDER);
});

test('composer: four languages and Arabic; best time is in the customer’s time zone', () => {
  const ar = composePost({ ...base, language: 'ar', prompt: 'أنشئ منشوراً على فيسبوك للترويج لوجبة الدجاج الجديدة مع السعر' });
  assert.match(ar.proposals[0]!.caption, /وجبة الدجاج الجديدة/);
  assert.match(ar.proposals[0]!.caption, /\[السعر\]/);
  assert.equal(composePost({ ...base, language: 'fr' }).proposals[0]!.cta, 'Commandez maintenant');
  assert.equal(composePost({ ...base, language: 'de' }).proposals[0]!.cta, 'Jetzt bestellen');
  const t = suggestTime('restaurant', 'Africa/Algiers', new Date('2026-10-17T08:00:00Z'));
  assert.equal(t.local, '2026-10-17T11:30');
  assert.equal(t.iso, '2026-10-17T10:30:00.000Z');
  assert.deepEqual(factsFromBrief({ productName: 'Glow Serum', price: '2 400 DA' }), { product_name: 'Glow Serum', business_name: '', price: '2 400 DA', offer: '', location: '' });
  const media = composePost({ ...base, media: [{ kind: 'image', id: 'a', title: 'old', approved: true, created_at: '2026-01-01' }, { kind: 'image', id: 'b', title: 'draft', approved: false, created_at: '2026-10-01' }] });
  assert.equal(media.suggested_media?.id, 'a', 'only approved media is suggested');
});

test('time zones: wall clock ↔ UTC, DST, weekly slots', () => {
  assert.ok(isValidTimeZone('Europe/Berlin') && !isValidTimeZone('Mars/Base'));
  assert.equal(zonedToUtc('2026-07-01T18:00', 'Europe/Berlin').toISOString(), '2026-07-01T16:00:00.000Z');
  assert.equal(zonedToUtc('2026-12-01T18:00', 'Europe/Berlin').toISOString(), '2026-12-01T17:00:00.000Z');
  assert.equal(zonedToUtc('2026-10-20T09:00', 'Africa/Algiers').toISOString(), '2026-10-20T08:00:00.000Z');
  assert.equal(utcToZoned(new Date('2026-10-20T08:00:00Z'), 'Africa/Algiers'), '2026-10-20T09:00');
  // 2026-10-17 is a Saturday. Next Monday/Wednesday 09:00 in Algiers.
  const after = new Date('2026-10-17T12:00:00Z');
  const slot = nextSlot([1, 3], ['09:00'], 'Africa/Algiers', after)!;
  assert.equal(slot.toISOString(), '2026-10-19T08:00:00.000Z');
  assert.equal(weekdayIn(slot, 'Africa/Algiers'), 1);
  assert.equal(nextSlot([], ['09:00'], 'UTC', after), null);
});

test('automation: rules are normalised; only approved, unused media; missing facts stay placeholders', () => {
  const rules = normalizeRules({ page_id: 'x', days: [1, 1, 9], times: ['25:00', '18:00'], timezone: 'Nowhere/Zone', max_posts_per_week: 99, boundary: 'auto', tone: 'loud', topics: 'Weekly special with the price' });
  assert.deepEqual([rules.page_id, rules.days, rules.times, rules.timezone, rules.max_posts_per_week, rules.boundary, rules.tone], ['', [1], ['18:00'], 'UTC', 21, 'review_each', 'friendly']);
  const media = [
    { kind: 'image' as const, id: 'used', title: 'Used', approved: true, created_at: '2026-01-01' },
    { kind: 'image' as const, id: 'draft', title: 'Draft', approved: false, created_at: '2026-01-02' },
    { kind: 'image' as const, id: 'next', title: 'Lemon tart', approved: true, created_at: '2026-01-03' },
    { kind: 'video' as const, id: 'vid', title: 'Video', approved: true, created_at: '2026-01-04' },
  ];
  const plan = planAutomationPost({ ...rules, days: [0, 1, 2, 3, 4, 5, 6] }, media, new Set(['used']), { name: 'Dar Lemon', cta: '' }, new Date('2026-10-17T08:00:00Z'))!;
  assert.equal(plan.media.id, 'next');
  assert.match(plan.caption, /\[Price\]/, 'the policy did not give a price');
  assert.equal(plan.run_at.toISOString(), '2026-10-17T18:00:00.000Z');
  assert.equal(planAutomationPost({ ...rules, days: [] }, media, new Set(), { name: '', cta: '' }, new Date()), null);
});

test('adapters: mock never uses the network and is idempotent; Graph errors normalise; live adapter refuses', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error('network used');
  }) as typeof fetch;
  try {
    const store = new Map<string, string>();
    const rpc = async (_fn: string, a: Record<string, unknown>) => {
      const key = String(a.p_job_id);
      const dup = store.has(key);
      if (!dup) store.set(key, `sim_${store.size + 1}`);
      return { data: { external_post_id: store.get(key), duplicate: dup }, error: null };
    };
    const req = { jobId: 'j1', idempotencyKey: 'post:1:abc', pageExternalId: 'mock_1', message: 'Hi', media: null };
    const a = await new MockFacebookAdapter(rpc, 'w').publish(req);
    const b = await new MockFacebookAdapter(rpc, 'w').publish(req);
    assert.deepEqual([a.simulated, a.duplicate, b.duplicate, b.externalPostId], [true, false, true, a.externalPostId]);
    await assert.rejects(new MockFacebookAdapter(rpc, 'w', { fail_attempts: 1, error: 'rate_limited' }, 1).publish(req), (e: PublishError) => e.normalized.code === 'rate_limited' && e.normalized.retryable);
    await assert.rejects(new MetaGraphAdapter({ liveEnabled: false }).publish(req), (e: PublishError) => e.normalized.code === 'live_publishing_disabled');
    await assert.rejects(new MetaGraphAdapter({ liveEnabled: true }).publish(req), (e: PublishError) => e.normalized.code === 'live_publishing_disabled');
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.deepEqual(normalizeGraphError({ code: 190 }), { code: 'token_expired', retryable: false, reconnect: true, message: 'Unknown Facebook error' });
  assert.equal(normalizeGraphError({ code: 613 }).retryable, true);
  assert.equal(normalizeGraphError({ code: 200 }).reconnect, true);
  assert.equal(normalizeGraphError({ code: 368 }).code, 'content_rejected');
  assert.equal(normalizeGraphError({ code: 1, is_transient: true }).retryable, true);
  assert.match(MetaGraphAdapter.request({ jobId: 'j', idempotencyKey: 'k', pageExternalId: '123', message: 'm', media: { kind: 'video', url: 'https://x' } }).url, /\/123\/videos$/);
});

test('webhooks: signature, subscription handshake, safe actions; error codes', () => {
  const body = JSON.stringify({ object: 'page', entry: [{ id: '42', changes: [{ field: 'permissions' }, { field: 'feed' }] }] });
  const sig = 'sha256=' + createHmac('sha256', 'app-secret').update(body).digest('hex');
  assert.equal(verifyMetaSignature(body, sig, 'app-secret'), true);
  assert.equal(verifyMetaSignature(body + ' ', sig, 'app-secret'), false);
  assert.equal(verifyMetaSignature(body, sig, ''), false);
  assert.equal(verifyMetaSignature(body, null, 'app-secret'), false);
  assert.equal(verifySubscription(new URLSearchParams('hub.mode=subscribe&hub.verify_token=t&hub.challenge=99'), 't'), '99');
  assert.equal(verifySubscription(new URLSearchParams('hub.mode=subscribe&hub.verify_token=x&hub.challenge=99'), 't'), null);
  assert.deepEqual(webhookActions(JSON.parse(body)), [{ page_external_id: '42', action: 'permissions_changed' }, { page_external_id: '42', action: 'feed_event' }]);
  assert.equal(socialError('Replace all [placeholders] before approving').code, 'placeholder');
  assert.equal(socialError('Post is already scheduled').status, 409);
  assert.equal(socialError('Publishing is paused for this workspace').code, 'paused');
});

test('composer: the request’s own instructions are not mistaken for the subject', () => {
  const f = { ...EMPTY_FACTS };
  assert.equal(subjectFrom({ prompt: 'Create a Facebook post promoting our new Chicken Box with the price and customer reviews', facts: f }), 'our new Chicken Box');
  assert.equal(subjectFrom({ prompt: 'Post about fries with cheese', facts: f }), 'Post about fries with cheese');
  assert.equal(subjectFrom({ prompt: 'أنشئ منشوراً على فيسبوك للترويج لوجبة الدجاج الجديدة مع السعر', facts: f }), 'وجبة الدجاج الجديدة');
  const tags = composePost({ ...base, prompt: 'Create a Facebook post promoting our new Chicken Box with the price' }).proposals[0]!.hashtags;
  assert.ok(!tags.includes('with') && !tags.includes('price'), tags.join(','));
});
