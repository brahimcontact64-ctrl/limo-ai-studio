/** $10 AI pilot requests (lib/generation/pilot.ts): shapes, gates and planning estimates. No network, no cost. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRequest, type ImageRequest, type TextRequest, type TranslationRequest } from '../../lib/providers/contracts.ts';
import { pilotRequest, PILOT_CHARACTER, researchedEstimate, SAMPLE_BRIEF } from '../../lib/generation/pilot.ts';
import { claudeTextAdapter } from '../../lib/providers/adapters/anthropic.ts';
import { blockedFetch } from '../../lib/providers/http.ts';

const brief = { business: 'Chez Amina', city: 'Oran', offer: 'menu du midi', hours: '12h–15h', approvedText: 'Chez Amina, le goût de la maison.' };

test('pilot text steps: French script ≤ 30 s from the given facts only, rewrite, Arabic translation keeping the name', () => {
  const s = pilotRequest('script', brief, 'org').request as TextRequest;
  assert.equal(s.task, 'script_draft');
  assert.equal(s.locale, 'fr');
  assert.match(s.instructions, /30 secondes maximum/);
  assert.deepEqual(s.facts, { business: 'Chez Amina', city: 'Oran', offer: 'menu du midi', hours: '12h–15h' });
  const t = pilotRequest('translate', brief, 'org').request as TranslationRequest;
  assert.equal(t.locale, 'ar');
  assert.equal(t.source, 'fr');
  assert.deepEqual(t.lockedTerms, ['Chez Amina']);
  assert.deepEqual(validateRequest(t), []);
  assert.deepEqual((pilotRequest('translate', SAMPLE_BRIEF, 'org').request as TranslationRequest).lockedTerms, [], 'placeholders are not locked terms');
  assert.equal(pilotRequest('script', brief, 'org').request.requestKey, pilotRequest('script', brief, 'org').request.requestKey, 'idempotent key');
  assert.notEqual(pilotRequest('script', brief, 'org').request.requestKey, pilotRequest('script', { ...brief, offer: 'x' }, 'org').request.requestKey);
});

test('character front pilot: limo_man, text-only Pro image request at the 4K tier, identity and negative rules in the prompt', () => {
  const p = pilotRequest('character-front', brief, 'org');
  const r = p.request as ImageRequest;
  assert.equal(PILOT_CHARACTER, 'limo_man');
  assert.equal(p.model, 'gemini-3-pro-image');
  assert.equal(p.registryCode, 'google_character_image_v1');
  assert.equal(p.priceKey, 'google/gemini-3-pro-image@4K', '2048×2731 needs the 4K tier');
  assert.deepEqual(r.inputAssetIds, []);
  assert.equal(r.count, 1);
  assert.match(r.prompt, /LIMO adult man/);
  assert.match(r.prompt, /Front view/);
  assert.match(r.prompt, /#EFECF7/);
  assert.match(r.prompt, /Never: /);
  assert.equal(researchedEstimate(p, { images: 1, inputTokens: 300 })!.usd, 0.2406);
});

test('planning estimate uses the researched price but the price itself stays unverified', () => {
  const p = pilotRequest('script', brief, 'org');
  const usage = claudeTextAdapter({ apiKey: 'x', fetch: blockedFetch() }).estimateUsage(p.request as TextRequest);
  const e = researchedEstimate(p, usage)!;
  assert.ok(e.usd > 0.03 && e.usd < 0.06, String(e.usd));
  assert.equal(e.sheet.verifiedAt, null);
});
