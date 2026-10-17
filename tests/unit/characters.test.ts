import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CANON, CANON_SPEC_VERSION, EXPRESSION_KEYS, REQUIRED_VIEWS, canonFor } from '../../lib/characters/canon.ts';
import { mimeAllowedFor, referenceMime, referenceReadiness, viewSlots, type ReferenceAsset } from '../../lib/characters/references.ts';
import { buildCustomSpec, parseCustomCharacter } from '../../lib/characters/custom.ts';
import { CHARACTER_FAMILIES, CHARACTER_VARIANTS, isCastId, isCastVariantId } from '../../lib/studio/limits.ts';
import { buildScenePrompt } from '../../lib/studio/prompts.ts';
import { emptyProject, newScene, toSaveRequest } from '../../lib/studio/draft.ts';
import { validateDraft } from '../../lib/studio/validation.ts';

test('canon: 18 characters, six variants per family, ids match the catalog pattern', () => {
  assert.equal(CANON.length, 18);
  assert.equal(new Set(CANON.map((c) => c.character_id)).size, 18);
  for (const f of CHARACTER_FAMILIES) assert.deepEqual(CANON.filter((c) => c.family === f).map((c) => c.variant), [...CHARACTER_VARIANTS]);
  assert.ok(CANON.every((c) => isCastVariantId(c.character_id)));
});

test('canon: family identity is shared by all six variants and differs between families', () => {
  for (const f of CHARACTER_FAMILIES) {
    const fam = CANON.filter((c) => c.family === f);
    for (const k of ['species', 'head', 'crown', 'surface', 'face'] as const) assert.equal(new Set(fam.map((c) => c[k])).size, 1, `${f} ${k}`);
    assert.equal(new Set(fam.map((c) => JSON.stringify(c.palette))).size, 1, `${f} palette`);
  }
  const skins = CHARACTER_FAMILIES.map((f) => canonFor(`${f}_boy`)!.palette.find((p) => p.key === 'skin')!.hex);
  assert.equal(new Set(skins).size, 3);
});

test('canon: palette, proportions, outfits, expressions, views and consistency text', () => {
  for (const c of CANON) {
    assert.ok(c.palette.every((p) => /^#[0-9A-F]{6}$/i.test(p.hex)), c.character_id);
    assert.deepEqual(c.expressions.map((e) => e.key), [...EXPRESSION_KEYS]);
    assert.deepEqual(c.outfits.map((o) => o.key), ['everyday', 'special']);
    assert.deepEqual([...c.required_views], [...REQUIRED_VIEWS]);
    const skin = c.palette.find((p) => p.key === 'skin')!.hex;
    assert.ok(c.consistency.identity_prompt.includes(skin) && c.consistency.identity_prompt.includes(c.crown), c.character_id);
    assert.ok(c.consistency.negative_prompt.length >= 5);
    assert.ok(/family-friendly/.test(c.consistency.identity_prompt));
  }
  const h = (id: string) => canonFor(id)!.proportions.height_in_heads;
  assert.ok(h('limo_boy') < h('limo_elder_woman') && h('limo_elder_woman') < h('limo_woman'));
});

test('migration seed is generated from the canon (no drift)', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/20261017140000_limo_character_system_v1.sql', import.meta.url), 'utf8');
  for (const c of CANON) {
    const json = JSON.stringify(c).replace(/'/g, "''");
    assert.ok(sql.includes(`('${c.character_id}', ${CANON_SPEC_VERSION}, 'proposed', '${json}'::jsonb`), c.character_id);
  }
  assert.ok(!/'approved'::text|, 'approved', '\{/.test(sql), 'the seed never approves a spec');
});

const asset = (o: Partial<ReferenceAsset>): ReferenceAsset => ({
  id: crypto.randomUUID(), asset_kind: 'rendered_reference', view: 'front', expression_key: null, outfit_key: null,
  spec_version: 1, status: 'approved', mime_type: 'image/png', provenance: 'uploaded_artwork', created_at: '2026-10-17T10:00:00Z', ...o,
});

test('reference slots and readiness', () => {
  const none = viewSlots([], 1);
  assert.deepEqual(none.map((s) => s.state), ['missing', 'missing', 'missing', 'missing']);
  assert.equal(referenceReadiness(none, true), 'pending');
  const front = [asset({ view: 'front' })];
  assert.equal(referenceReadiness(viewSlots(front, 1), true), 'pending');
  const three = [asset({ view: 'front' }), asset({ view: 'side' }), asset({ view: 'three_quarter' })];
  assert.equal(referenceReadiness(viewSlots(three, 1), true), 'approved');
  assert.equal(referenceReadiness(viewSlots(three, 1), false), 'pending', 'an unapproved spec blocks readiness');
  assert.equal(referenceReadiness(viewSlots(three, 2), true), 'pending', 'references of an older spec version do not count');
  const pending = [...front, asset({ view: 'side', status: 'pending_review' })];
  assert.equal(referenceReadiness(viewSlots(pending, 1), true), 'in_review');
  assert.equal(viewSlots([asset({ view: 'front', expression_key: 'happy' })], 1)[0]!.state, 'missing', 'expression sheets are not view references');
});

test('file types: rendered images are never accepted as rigged 3D models', () => {
  assert.ok(mimeAllowedFor('rendered_reference', 'image/png'));
  assert.ok(!mimeAllowedFor('rigged_model', 'image/png'));
  assert.ok(mimeAllowedFor('rigged_model', 'model/gltf-binary'));
  assert.ok(!mimeAllowedFor('rendered_reference', 'model/gltf-binary'));
  assert.equal(referenceMime({ name: 'limo.GLB', type: '' }), 'model/gltf-binary');
  assert.equal(referenceMime({ name: 'rig.fbx', type: 'application/octet-stream' }), 'application/octet-stream');
  assert.equal(referenceMime({ name: 'front.png', type: 'image/png' }), 'image/png');
});

test('workspace characters: parsing, spec and cast ids', () => {
  assert.deepEqual(parseCustomCharacter({ name: '' }), { ok: false, issue: 'name_required' });
  assert.deepEqual(parseCustomCharacter({ name: 'Zed', colors: { primary: 'blue' } }), { ok: false, issue: 'invalid_color' });
  assert.deepEqual(parseCustomCharacter({ name: 'Zed', base_family: 'banana' }), { ok: false, issue: 'invalid_option' });
  const parsed = parseCustomCharacter({ name: ' Zed ', description: 'Round blue mascot', base_family: 'nova', age_group: 'child', details: ['star badge'], colors: { primary: '#1144AA' } });
  assert.ok(parsed.ok);
  const spec = buildCustomSpec(parsed.value);
  assert.ok(spec.identity_prompt.startsWith('Zed:') && spec.identity_prompt.includes('#1144AA') && spec.identity_prompt.includes('NOVA'));
  const id = `custom:${crypto.randomUUID()}`;
  assert.ok(isCastId(id) && !isCastVariantId(id) && !isCastId('custom:nope'));
  const d = emptyProject({ content_type: 'storytelling', language_code: 'en', creation_mode: 'story' });
  d.title = 'Mixed cast';
  d.cast = ['limo_boy', id];
  d.scenes = [newScene({ title: 'A', duration_seconds: 5, participants: [id] })];
  const issues = validateDraft(toSaveRequest(d), { contentTypes: new Set(['storytelling']), languages: new Set(['en']), exportPresets: new Set() });
  assert.ok(!issues.some((i) => i.code === 'cast_invalid_id'));
});

test('prompts use the canonical identity text and flag missing references', () => {
  const boy = canonFor('limo_boy')!;
  const chars = new Map([['limo_boy', { id: 'limo_boy', name: 'Limo Boy', visual_description: 'short catalog text', reference_status: 'pending', visual_ref: null, identity_prompt: boy.consistency.identity_prompt }]]);
  const scene = { ...newScene({ title: 'Hi', duration_seconds: 4, participants: ['limo_boy'] }) };
  const { key: _k, ...rest } = scene;
  const prompt = buildScenePrompt({ title: 'T', visual_style: '', language_code: 'en', content_type: 'storytelling' }, rest, 0, chars);
  assert.ok(prompt.text.includes(boy.crown));
  assert.ok(!prompt.text.includes('short catalog text'));
  assert.deepEqual(prompt.missingReferences, ['limo_boy']);
});

test('the character reference guide is generated from the canon (no drift)', async () => {
  const { execFileSync } = await import('node:child_process');
  const generated = execFileSync(process.execPath, ['scripts/gen-character-guide.ts'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const file = readFileSync(new URL('../../docs/CHARACTER_REFERENCE_GUIDE.md', import.meta.url), 'utf8');
  assert.equal(file.replace(/\r\n/g, '\n').trim(), generated.replace(/\r\n/g, '\n').trim());
});
