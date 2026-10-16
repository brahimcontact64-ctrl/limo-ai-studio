import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, isCastVariantId, parseCharacterId, estimateSlots, CHARACTER_FAMILIES, CHARACTER_VARIANTS } from '../../lib/studio/limits.ts';
import { validateDraft, hasErrors, parseSaveRequest, toRpcArgs, mapSaveError, totalDuration } from '../../lib/studio/validation.ts';
import { emptyProject, newScene, toSaveRequest, projectFromDb, castFromDb, moveItem, removeFromCast, draftFingerprint } from '../../lib/studio/draft.ts';
import { buildStoryboard } from '../../lib/studio/prompts.ts';
import type { ProjectDraft } from '../../lib/studio/types.ts';

const ctx = {
  contentTypes: new Set(['storytelling', 'education', 'custom']),
  languages: new Set(['ar', 'fr', 'en', 'de']),
  exportPresets: new Set(['vertical_9_16', 'square_1_1']),
};

function validDraft(): ProjectDraft {
  const d = emptyProject({ content_type: 'storytelling', language_code: 'en' });
  d.title = 'Market day';
  d.cast = ['limo_boy', 'nova_girl'];
  d.scenes = [newScene({ title: 'Opening', participants: ['limo_boy'] }), newScene({ title: 'Reply', participants: ['nova_girl', 'limo_boy'] })];
  return d;
}
const codes = (d: ProjectDraft) => validateDraft(toSaveRequest(d), ctx).map((i) => i.code);

describe('character ids', () => {
  test('exactly 18 variants are valid cast ids', () => {
    const all = CHARACTER_FAMILIES.flatMap((f) => CHARACTER_VARIANTS.map((v) => `${f}_${v}`));
    assert.equal(all.length, 18);
    assert.ok(all.every(isCastVariantId));
  });
  test('family base records and unknown ids are rejected', () => {
    for (const id of ['limo', 'nova', 'adam', 'limo_baby', 'story', '', 'LIMO_BOY']) assert.equal(isCastVariantId(id), false, id);
  });
  test('parses family and variant', () => {
    assert.deepEqual(parseCharacterId('adam_elder_woman'), { family: 'adam', variant: 'elder_woman' });
    assert.equal(parseCharacterId('nope'), null);
  });
});

describe('validateDraft', () => {
  test('a valid draft has no errors', () => {
    assert.equal(hasErrors(validateDraft(toSaveRequest(validDraft()), ctx)), false);
  });
  test('requires a title', () => {
    const d = validDraft();
    d.title = '   ';
    assert.ok(codes(d).includes('title_required'));
  });
  test('rejects "story" — only live catalog content types are accepted', () => {
    const d = validDraft();
    d.content_type = 'story';
    assert.ok(codes(d).includes('content_type_invalid'));
  });
  test('rejects unsupported languages', () => {
    const d = validDraft();
    d.language_code = 'es';
    assert.ok(codes(d).includes('language_invalid'));
  });
  test('cast must have 1..18 unique variants', () => {
    const d = validDraft();
    d.cast = [];
    d.scenes.forEach((s) => (s.participants = []));
    assert.ok(codes(d).includes('cast_min'));
    const all18 = CHARACTER_FAMILIES.flatMap((f) => CHARACTER_VARIANTS.map((v) => `${f}_${v}`));
    d.cast = [...all18];
    assert.equal(hasErrors(validateDraft(toSaveRequest(d), ctx)), false);
    d.cast = [...all18, 'limo_boy'];
    assert.ok(codes(d).includes('cast_max'));
    assert.ok(codes(d).includes('cast_duplicate'));
  });
  test('scene participants must belong to the cast', () => {
    const d = validDraft();
    d.scenes[0]!.participants = ['adam_man'];
    const issues = validateDraft(toSaveRequest(d), ctx);
    const issue = issues.find((i) => i.code === 'participant_not_in_cast');
    assert.ok(issue);
    assert.equal(issue.scene, 0);
  });
  test('scene duration follows the live trigger (1..15 s)', () => {
    const d = validDraft();
    d.scenes[0]!.duration_seconds = 16;
    assert.ok(codes(d).includes('scene_duration_range'));
    d.scenes[0]!.duration_seconds = 0;
    assert.ok(codes(d).includes('scene_duration_range'));
    d.scenes[0]!.duration_seconds = 15;
    assert.ok(!codes(d).includes('scene_duration_range'));
    d.scenes[0]!.duration_seconds = 7.5;
    assert.ok(codes(d).includes('scene_duration_range'));
  });
  test('1..25 scenes', () => {
    const d = validDraft();
    d.scenes = [];
    assert.ok(codes(d).includes('scenes_min'));
    d.scenes = Array.from({ length: 26 }, () => newScene({ participants: ['limo_boy'] }));
    assert.ok(codes(d).includes('scenes_max'));
    d.scenes = Array.from({ length: 25 }, () => newScene({ participants: ['limo_boy'], duration_seconds: 15 }));
    assert.equal(hasErrors(validateDraft(toSaveRequest(d), ctx)), false);
    assert.equal(totalDuration(d.scenes), 375);
  });
  test('scenes without participants are a warning, not an error', () => {
    const d = validDraft();
    d.scenes[1]!.participants = [];
    const issues = validateDraft(toSaveRequest(d), ctx);
    assert.equal(hasErrors(issues), false);
    assert.ok(issues.some((i) => i.code === 'scene_no_participants' && i.severity === 'warning'));
  });
  test('field length limits mirror the RPC', () => {
    const d = validDraft();
    d.scenes[0]!.dialogue = 'x'.repeat(4001);
    assert.ok(codes(d).includes('scene_field_too_long'));
  });
  test('unknown export presets are rejected', () => {
    const d = validDraft();
    d.export_presets = ['cinema_21_9'];
    assert.ok(codes(d).includes('preset_invalid'));
  });
});

describe('parseSaveRequest + toRpcArgs', () => {
  test('round-trips a draft into the RPC shape with {id} cast objects', () => {
    const parsed = parseSaveRequest(JSON.parse(JSON.stringify(toSaveRequest(validDraft()))));
    assert.ok(parsed);
    const args = toRpcArgs('00000000-0000-4000-8000-000000000001', parsed);
    assert.deepEqual(args.p_project_cast, [{ id: 'limo_boy' }, { id: 'nova_girl' }]);
    assert.equal(args.p_project_id, null);
    assert.deepEqual(args.p_scenes.map((s) => s.scene_number), [1, 2]);
    assert.equal(args.p_series_id, null);
    assert.equal(args.p_continuation_mode, false);
    assert.ok(!('character_id' in (args.p_project_cast[0] as object)));
  });
  test('rejects malformed bodies', () => {
    assert.equal(parseSaveRequest(null), null);
    assert.equal(parseSaveRequest({ cast: 'limo_boy', scenes: [] }), null);
    assert.equal(parseSaveRequest({ project_id: 'not-a-uuid', cast: [], scenes: [] }), null);
    assert.equal(parseSaveRequest({ cast: [], scenes: [{ participants: [1] }] }), null);
  });
  test('non-numeric durations become NaN and fail validation', () => {
    const body = toSaveRequest(validDraft()) as unknown as { scenes: Array<Record<string, unknown>> };
    body.scenes[0]!.duration_seconds = '10';
    const parsed = parseSaveRequest(body);
    assert.ok(parsed);
    assert.ok(validateDraft(parsed, ctx).some((i) => i.code === 'scene_duration_range'));
  });
});

describe('draft helpers', () => {
  test('reads project_cast written as [{id}]', () => {
    assert.deepEqual(castFromDb([{ id: 'limo_boy' }, { character_id: 'x' }, 'y', null]), ['limo_boy']);
    assert.deepEqual(castFromDb(null), []);
  });
  test('projectFromDb orders scenes by scene_number', () => {
    const row = { id: 'p', title: 'T', content_type: 'education', language_code: 'fr', brief: null, goal: null, visual_style: null, project_cast: [{ id: 'adam_man' }] };
    const base = { participants: ['adam_man'], location_prompt: null, environment_prompt: null, camera_prompt: null, lighting_prompt: null, action_prompt: null, dialogue: null, on_screen_text: null, effects_prompt: null, music_prompt: null, transition_out: null, continuity_notes: null };
    const d = projectFromDb(row, [{ ...base, scene_number: 2, title: 'B', duration_seconds: 5 }, { ...base, scene_number: 1, title: 'A', duration_seconds: 9 }], ['square_1_1']);
    assert.deepEqual(d.scenes.map((s) => s.title), ['A', 'B']);
    assert.equal(d.brief, '');
    assert.deepEqual(d.cast, ['adam_man']);
  });
  test('moveItem reorders and ignores out-of-range moves', () => {
    assert.deepEqual(moveItem(['a', 'b', 'c'], 0, 2), ['b', 'c', 'a']);
    assert.deepEqual(moveItem(['a', 'b', 'c'], 0, 5), ['a', 'b', 'c']);
  });
  test('removing a cast member removes it from all scenes', () => {
    const d = removeFromCast(validDraft(), 'limo_boy');
    assert.deepEqual(d.cast, ['nova_girl']);
    assert.ok(d.scenes.every((s) => !s.participants.includes('limo_boy')));
  });
  test('fingerprint ignores client-only scene keys', () => {
    const a = validDraft();
    const b = { ...a, scenes: a.scenes.map((s) => ({ ...s, key: 'other' })) };
    assert.equal(draftFingerprint(a), draftFingerprint(b));
  });
  test('slot estimate uses 30-second slots', () => {
    assert.equal(estimateSlots(0), 1);
    assert.equal(estimateSlots(30), 1);
    assert.equal(estimateSlots(31), 2);
    assert.equal(LIMITS.secondsPerSlot, 30);
  });
});

describe('storyboard prompts', () => {
  const chars = new Map([
    ['limo_boy', { id: 'limo_boy', name: 'Limo Boy', visual_description: 'Stylized tomato boy.', reference_status: 'pending', visual_ref: null }],
    ['nova_girl', { id: 'nova_girl', name: 'Nova Girl', visual_description: 'Stylized strawberry girl.', reference_status: 'approved', visual_ref: 'character-library/nova_girl.png' }],
  ]);
  test('includes stable ids, appearance specs and continuity', () => {
    const d = validDraft();
    d.scenes[0]!.continuity_notes = 'Limo holds a red basket.';
    const board = buildStoryboard(d, chars);
    assert.equal(board.length, 2);
    assert.match(board[0]!.text, /\[limo_boy\] Limo Boy: Stylized tomato boy\./);
    assert.match(board[1]!.text, /Continuity from previous scene: Limo holds a red basket\./);
  });
  test('flags characters without an approved canonical reference', () => {
    const board = buildStoryboard(validDraft(), chars);
    assert.deepEqual(board[1]!.missingReferences, ['limo_boy']);
    assert.deepEqual(board[0]!.missingReferences, ['limo_boy']);
  });
});

describe('save error mapping', () => {
  test('maps backend exceptions to stable codes', () => {
    assert.equal(mapSaveError('Active subscription required'), 'subscription_required');
    assert.equal(mapSaveError('Not authorized'), 'not_authorized');
    assert.equal(mapSaveError('new row for relation "studio_projects" violates check constraint "studio_projects_project_cast_check1"'), 'cast_limit');
    assert.equal(mapSaveError('Each scene must be between 1 and 15 seconds in LIMO v1'), 'scene_duration');
    assert.equal(mapSaveError('Project not found or no longer editable'), 'not_editable');
    assert.equal(mapSaveError('boom'), 'unknown');
  });
});
