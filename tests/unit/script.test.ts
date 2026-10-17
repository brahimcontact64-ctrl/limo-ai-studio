import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHistory, pushHistory, redo, undo, MERGE_WINDOW_MS } from '../../lib/studio/history.ts';
import { compareDrafts, diffWords } from '../../lib/studio/diff.ts';
import { draftFromSnapshot, emptyProject, newScene, type RevisionSnapshot } from '../../lib/studio/draft.ts';
import { ASSIST_ACTIONS, mockTranslate, runMockAssist, shortenText, toneText, type AssistInput } from '../../lib/ai/script.ts';
import { checkContinuity, type SeriesContext } from '../../lib/story/continuity.ts';
import { CREATION_MODES, type Brief } from '../../lib/create/modes.ts';
import { buildStarterScenes } from '../../lib/create/templates.ts';
import en from '../../lib/i18n/dictionaries/en.ts';

test('history: bursts merge, undo/redo walk the steps, a new change clears redo', () => {
  let h = createHistory('a');
  h = pushHistory(h, 'ab', 1000);
  h = pushHistory(h, 'abc', 1000 + MERGE_WINDOW_MS - 1); // same burst
  h = pushHistory(h, 'abcd', 5000); // new step
  assert.equal(h.past.length, 2);
  h = undo(h);
  assert.equal(h.present, 'abc');
  h = undo(h);
  assert.equal(h.present, 'a');
  assert.equal(undo(h), h, 'nothing left to undo');
  h = redo(h);
  assert.equal(h.present, 'abc');
  h = pushHistory(h, 'x', 9000);
  assert.equal(h.future.length, 0);
});

test('diffWords reproduces both texts', () => {
  const before = 'The quick brown fox jumps';
  const after = 'The slow brown fox walks today';
  const d = diffWords(before, after);
  assert.equal(d.filter((s) => s.type !== 'add').map((s) => s.text).join(''), before);
  assert.equal(d.filter((s) => s.type !== 'del').map((s) => s.text).join(''), after);
  assert.ok(d.some((s) => s.type === 'del' && s.text.includes('quick')));
  assert.deepEqual(diffWords('same', 'same'), [{ type: 'same', text: 'same' }]);
});

test('compareDrafts lists project, scene, added and removed changes', () => {
  const a = emptyProject({ content_type: 'custom', language_code: 'en', creation_mode: 'product_ad' });
  a.title = 'Ad';
  a.scenes = [newScene({ title: 'Hook', narration: 'Hello', duration_seconds: 5 }), newScene({ title: 'End' })];
  const b = { ...a, title: 'Ad 2', scenes: [{ ...a.scenes[0]!, narration: 'Hello there', duration_seconds: 6 }, a.scenes[1]!, newScene({ title: 'Extra' })] };
  const c = compareDrafts(a, b);
  assert.ok(c.some((x) => x.kind === 'project' && x.field === 'title'));
  assert.ok(c.some((x) => x.kind === 'scene' && x.index === 0 && x.field === 'narration'));
  assert.ok(c.some((x) => x.kind === 'scene' && x.field === 'duration_seconds'));
  assert.ok(c.some((x) => x.kind === 'scene_added' && x.index === 2));
  assert.equal(compareDrafts(a, a).length, 0);
});

test('draftFromSnapshot restores the stored shape', () => {
  const snap: RevisionSnapshot = {
    title: 'T', creation_mode: 'product_ad', creation_brief: { productName: 'Serum' }, content_type: 'custom', language_code: 'fr',
    brief: '', goal: '', visual_style: '', project_cast: [], export_presets: ['square_1_1'],
    scenes: [{ scene_number: 2, title: 'B', duration_seconds: 4, participants: [], location_prompt: '', environment_prompt: '', camera_prompt: 'Pan', lighting_prompt: '', action_prompt: '', dialogue: '', on_screen_text: '', effects_prompt: '', music_prompt: '', transition_out: '', continuity_notes: '', narration: 'N2', visual_prompt: '', asset_ids: [] },
      { scene_number: 1, title: 'A', duration_seconds: 5, participants: [], location_prompt: '', environment_prompt: '', camera_prompt: '', lighting_prompt: '', action_prompt: '', dialogue: '', on_screen_text: '', effects_prompt: '', music_prompt: '', transition_out: '', continuity_notes: '', narration: 'N1', visual_prompt: '', asset_ids: [] }],
  };
  const d = draftFromSnapshot('p1', snap);
  assert.equal(d.id, 'p1');
  assert.deepEqual(d.scenes.map((s) => s.title), ['A', 'B']);
  assert.equal(d.scenes[1]!.camera_prompt, 'Pan');
  assert.equal(d.creation_brief.productName, 'Serum');
});

function project(mode: (typeof CREATION_MODES)[number], language = 'en'): AssistInput['project'] {
  const brief: Brief = mode === 'product_ad' ? { productName: 'Glow Serum', sellingPoints: ['Vitamin C', 'Fragrance free'], price: '2 400 DA', callToAction: 'Order on our page' } : {};
  return {
    title: 'Test', creation_mode: mode, creation_brief: brief, brief: '', visual_style: '', language_code: language,
    scenes: buildStarterScenes(mode, brief, en.create.templates[mode], []).map((s) => ({ ...s, participants: mode === 'story' ? ['limo_boy'] : [] })),
  };
}

test('mock draft works for all eight modes and only uses brief facts', () => {
  for (const mode of CREATION_MODES) {
    const p = project(mode);
    const r = runMockAssist({ action: 'draft', scenes: [], project: p });
    assert.equal(r.provider, 'mock');
    for (const s of r.scenes) for (const f of s.fields) assert.ok(f.after.length <= 4000, `${mode} ${f.field}`);
  }
  const ad = runMockAssist({ action: 'draft', scenes: [], project: project('product_ad') });
  const text = JSON.stringify(ad);
  assert.ok(text.includes('Glow Serum') && text.includes('2 400 DA') && text.includes('Order on our page'));
  // No invented prices or discounts.
  assert.ok(!/\d+ ?%/.test(text) && !/\$|€/.test(text));
});

test('mock draft marks missing facts as placeholders', () => {
  const p = project('custom');
  const r = runMockAssist({ action: 'draft', scenes: [0], project: p });
  assert.ok(JSON.stringify(r).includes('Meet Test.'));
  const empty = { ...p, title: '' };
  assert.ok(JSON.stringify(runMockAssist({ action: 'draft', scenes: [0], project: empty })).includes('[Add an opening line]'));
});

test('every action returns proposals with before/after and never touches other scenes', () => {
  const p = project('product_ad');
  const drafted = runMockAssist({ action: 'draft', scenes: [], project: p });
  for (const s of drafted.scenes) for (const f of s.fields) (p.scenes[s.index] as unknown as Record<string, string>)[f.field] = f.after;
  for (const action of ASSIST_ACTIONS) {
    const r = runMockAssist({ action, scenes: [1], project: p, tone: 'energetic', target_language: 'fr' });
    assert.ok(r.scenes.every((s) => s.index === 1), action);
    for (const s of r.scenes) for (const f of s.fields) assert.equal(f.before, (p.scenes[1] as unknown as Record<string, string>)[f.field]);
  }
});

test('text transforms', () => {
  assert.equal(shortenText('one two three'), 'one two three');
  assert.equal(shortenText('one two three four five six seven eight nine ten.'), 'one two three four five six…');
  assert.equal(toneText('Great. Really', 'energetic', 'en'), 'Great! Really!');
  assert.equal(toneText('Wow!! 🎉 nice', 'calm', 'en'), 'Wow. nice');
  assert.equal(mockTranslate('Bonjour', 'en'), '[Mock translation → EN] Bonjour');
  assert.equal(mockTranslate(mockTranslate('Hi', 'fr'), 'de'), '[Mock translation → DE] Hi');
  const ar = runMockAssist({ action: 'rewrite', scenes: [0], project: { ...project('custom', 'ar'), scenes: [{ ...project('custom').scenes[0]!, narration: 'مرحبا' }] } });
  assert.equal(ar.scenes[0]!.fields[0]!.after, 'باختصار: مرحبا');
});

test('continuity: series cast, forbidden terms, opening location and recap', () => {
  const d = emptyProject({ content_type: 'storytelling', language_code: 'en', creation_mode: 'story' });
  d.cast = ['limo_boy', 'nova_girl'];
  d.scenes = [newScene({ title: 'Open', location_prompt: 'Beach', narration: 'A storm comes' })];
  const series: SeriesContext = {
    series_id: 's', title: 'S', continuity_mode: 'strict',
    cast_bible: { characters: ['limo_boy'] }, story_rules: { forbidden: ['storm'] },
    previous: { episode_number: 1, ending_hook: 'The door opens.', last_scene_state: { location: 'Market' } },
  };
  const codes = checkContinuity(d, series).map((i) => i.code).sort();
  assert.deepEqual(codes, ['character_not_in_series', 'forbidden_term', 'missing_recap', 'opening_location_changed']);
  d.scenes[0]!.continuity_notes = 'Picks up right after episode 1.';
  d.scenes[0]!.narration = 'Calm day';
  assert.deepEqual(checkContinuity(d, { ...series, cast_bible: {} }).map((i) => i.code), []);
});
