import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CREATION_MODES, MODE_FIELDS, MODE_CONTENT_TYPE, claimFields, isCreationMode, requiresCharacters, sanitizeBrief } from '../../lib/create/modes.ts';
import { buildStarterScenes } from '../../lib/create/templates.ts';
import { validateDraft, hasErrors, parseSaveRequest, toRpcArgsV2 } from '../../lib/studio/validation.ts';
import { emptyProject, toSaveRequest } from '../../lib/studio/draft.ts';
import { LIMITS } from '../../lib/studio/limits.ts';

const ctx = { contentTypes: new Set(Object.values(MODE_CONTENT_TYPE)), languages: new Set(['ar', 'fr', 'en', 'de']) };

test('eight creation modes; only story requires characters', () => {
  assert.equal(CREATION_MODES.length, 8);
  for (const m of CREATION_MODES) assert.equal(requiresCharacters(m), m === 'story');
  assert.equal(isCreationMode('product_ad'), true);
  assert.equal(isCreationMode('cartoon'), false);
});

test('a character-free product ad is valid; a character-free story is not', () => {
  const ad = emptyProject({ content_type: 'product_ads', language_code: 'fr', creation_mode: 'product_ad' });
  ad.title = 'Parfum Été';
  assert.equal(hasErrors(validateDraft(toSaveRequest(ad), ctx)), false);
  const story = emptyProject({ content_type: 'storytelling', language_code: 'en', creation_mode: 'story' });
  story.title = 'Episode 1';
  assert.ok(validateDraft(toSaveRequest(story), ctx).some((i) => i.code === 'cast_min'));
});

test('scenes without participants only warn when the project has a cast', () => {
  const ad = emptyProject({ content_type: 'product_ads', language_code: 'en', creation_mode: 'product_ad' });
  ad.title = 'x';
  assert.ok(!validateDraft(toSaveRequest(ad), ctx).some((i) => i.code === 'scene_no_participants'));
});

test('sanitizeBrief keeps declared fields only, trims, caps lists, rejects unknown select values', () => {
  const b = sanitizeBrief('product_ad', {
    productName: '  Rose Oud  ',
    sellingPoints: ['Long lasting', '', 'Vegan', 'a', 'b', 'c', 'd', 'e', 'f', 'g'],
    visualDirection: 'neon',
    tone: 'premium',
    hacker: 'x',
    price: 42,
  });
  assert.deepEqual(b, { productName: 'Rose Oud', sellingPoints: ['Long lasting', 'Vegan', 'a', 'b', 'c', 'd', 'e', 'f'], tone: 'premium' });
  assert.deepEqual(sanitizeBrief('story', null), {});
});

test('price and offer are flagged as claims to review', () => {
  assert.deepEqual(claimFields('product_ad', { price: '3500 DZD', offer: '-20%' }), ['price', 'offer']);
  assert.ok(MODE_FIELDS.product_ad.find((f) => f.key === 'price')?.claim);
});

test('starter scenes copy only user text and respect duration limits', () => {
  const titles = ['Hook', 'Product reveal', 'Benefits', 'Offer', 'Call to action'];
  const assets = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
  const scenes = buildStarterScenes('product_ad', { productName: 'Rose Oud', sellingPoints: ['Long lasting', 'Vegan'], callToAction: 'Order on WhatsApp' }, titles, assets);
  assert.equal(scenes.length, 5);
  assert.deepEqual(scenes.map((s) => s.title), titles);
  assert.equal(scenes[2]!.on_screen_text, 'Long lasting · Vegan');
  assert.equal(scenes[3]!.on_screen_text, ''); // no price/offer typed → nothing invented
  assert.equal(scenes[4]!.on_screen_text, 'Order on WhatsApp');
  assert.deepEqual(scenes[1]!.asset_ids, [assets[1]]);
  for (const mode of CREATION_MODES) {
    for (const s of buildStarterScenes(mode, {}, [])) {
      assert.ok(s.duration_seconds >= 1 && s.duration_seconds <= LIMITS.sceneDurationMax, mode);
      assert.equal(s.participants.length, 0);
    }
  }
});

test('v2 RPC payload carries mode, brief, narration, visuals and assets', () => {
  const ad = emptyProject({ content_type: 'product_ads', language_code: 'en', creation_mode: 'product_ad', creation_brief: { productName: 'Rose Oud' } });
  ad.title = 'Rose Oud launch';
  ad.scenes[0]!.narration = 'Meet Rose Oud.';
  ad.scenes[0]!.visual_prompt = 'Bottle on marble';
  ad.scenes[0]!.asset_ids = ['11111111-1111-4111-8111-111111111111'];
  const parsed = parseSaveRequest(JSON.parse(JSON.stringify(toSaveRequest(ad))));
  assert.ok(parsed);
  const args = toRpcArgsV2('00000000-0000-4000-8000-000000000001', parsed);
  assert.equal(args.p_creation_mode, 'product_ad');
  assert.deepEqual(args.p_creation_brief, { productName: 'Rose Oud' });
  assert.deepEqual(args.p_project_cast, []);
  assert.equal(args.p_scenes[0]!.narration, 'Meet Rose Oud.');
  assert.deepEqual(args.p_scenes[0]!.asset_ids, ['11111111-1111-4111-8111-111111111111']);
});

test('requests without a mode are treated as story (backwards compatible); unknown modes are rejected', () => {
  const legacy = { title: 't', cast: ['limo_boy'], scenes: [], export_presets: [] };
  assert.equal(parseSaveRequest(legacy)?.creation_mode, 'story');
  assert.equal(parseSaveRequest({ ...legacy, creation_mode: 'cartoon' }), null);
});

test('invalid scene assets are reported', () => {
  const ad = emptyProject({ content_type: 'product_ads', language_code: 'en', creation_mode: 'product_ad' });
  ad.title = 'x';
  ad.scenes[0]!.asset_ids = ['not-a-uuid'];
  assert.ok(validateDraft(toSaveRequest(ad), ctx).some((i) => i.code === 'scene_assets_invalid'));
});
