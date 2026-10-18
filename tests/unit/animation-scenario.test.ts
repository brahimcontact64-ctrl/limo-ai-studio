/** Scenario intake → validation → readiness → storyboard (lib/animation/scenario.ts). Placeholder text only: the
 *  flagship scenario is the owner's to write. No network, no cost. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CANONICAL_CHARACTER_IDS, clipPrompt, readinessBlockers, storyboard, validateScenario, type CharacterReadiness, type Scenario } from '../../lib/animation/scenario.ts';

const scene = (n: number, extra: Partial<Scenario['scenes'][number]> = {}): Scenario['scenes'][number] => ({
  number: n, durationSeconds: 8, description: '[scene description]', environment: '[environment]', characters: ['limo_man'],
  actions: { limo_man: '[action]' }, camera: '[camera]', dialogue: [{ speaker: 'limo_man', text: '[line]' }], ...extra,
});
const base: Scenario = { title: '[title]', language: 'fr', aspect: '9:16', scenes: [scene(1), scene(2), scene(3), scene(4, { durationSeconds: 6 })] };
const ready: CharacterReadiness = { specApproved: true, approvedViews: { front: 'f1', three_quarter: 'q1', side: 's1' }, voices: { fr: { provider: 'elevenlabs', voiceRef: 'VoiceAbc12345' } } };

test('18 canonical characters are selectable', () => {
  assert.equal(CANONICAL_CHARACTER_IDS.length, 18);
  assert.ok(CANONICAL_CHARACTER_IDS.includes('nova_elder_woman') && CANONICAL_CHARACTER_IDS.includes('adam_boy'));
});

test('validation: 30 s limit, Veo shot lengths, known characters, speakers in scene, expressions', () => {
  const errors = (s: Scenario) => validateScenario(s).filter((i) => i.level === 'error').map((i) => i.code);
  assert.deepEqual(errors(base), []);
  assert.ok(errors({ ...base, scenes: [...base.scenes, scene(5, { durationSeconds: 4 })] }).includes('video_too_long'), '34 s');
  assert.ok(errors({ ...base, scenes: [scene(1, { durationSeconds: 5 })] }).includes('shot_duration'));
  assert.ok(errors({ ...base, scenes: [scene(1, { characters: ['limo_robot'], actions: {} , dialogue: [] })] }).includes('unknown_character'));
  assert.ok(errors({ ...base, scenes: [scene(1, { dialogue: [{ speaker: 'nova_girl', text: 'x' }] })] }).includes('speaker_not_in_scene'));
  assert.ok(errors({ ...base, scenes: [scene(1, { expressions: { limo_man: 'furious' as never } })] }).includes('expression_unknown'));
  assert.ok(errors({ ...base, aspect: '1:1' as never }).includes('aspect'));
  assert.deepEqual(errors({ ...base, scenes: [scene(1, { characters: [], actions: {}, dialogue: [] })] }), [], 'characters are optional (commercial shots)');
});

test('warnings: non-English native dialogue, multi-character and multi-speaker shots, too many words', () => {
  const warnings = (s: Scenario) => validateScenario(s).filter((i) => i.level === 'warning').map((i) => i.code);
  assert.ok(warnings(base).includes('language_quality'));
  const crowd = scene(1, { characters: ['limo_man', 'limo_woman', 'limo_boy'], actions: { limo_man: 'a', limo_woman: 'b', limo_boy: 'c' }, dialogue: [{ speaker: 'limo_man', text: 'a' }, { speaker: 'limo_woman', text: 'b' }] });
  const w = warnings({ ...base, scenes: [crowd] });
  assert.ok(w.includes('multi_character_risk') && w.includes('multi_speaker_shot'));
  assert.ok(warnings({ ...base, scenes: [scene(1, { durationSeconds: 4, dialogue: [{ speaker: 'limo_man', text: 'un deux trois quatre cinq six sept huit neuf dix onze' }] })] }).includes('dialogue_too_long'));
});

test('readiness: approved spec, front/three-quarter/side references and a voice identity are required before animation', () => {
  assert.deepEqual(readinessBlockers(base, { limo_man: ready }, 'separate'), []);
  const none = readinessBlockers(base, {}, 'separate');
  assert.ok(none.includes('limo_man: design spec not approved'));
  assert.ok(none.includes('limo_man: no approved front reference'));
  assert.ok(none.includes('limo_man: no voice identity for fr'));
  assert.ok(!readinessBlockers(base, { limo_man: { ...ready, voices: {} } }, 'native').some((b) => b.includes('voice')), 'native audio needs no voice profile');
});

test('storyboard: keyframe with approved references → Veo image-to-video → voice → (experimental) lip-sync → review; cost per take', () => {
  const sb = storyboard(base, { limo_man: ready }, { tier: 'standard', resolution: '1080p', voiceMode: 'separate', lipSync: true, takes: 3 });
  assert.equal(sb.seconds, 30);
  assert.equal(sb.shots.length, 4);
  const s1 = sb.shots[0]!;
  assert.deepEqual(s1.ops.map((o) => o.kind), ['keyframe', 'clip', 'voice', 'lipsync', 'continuity_review']);
  assert.deepEqual(s1.referenceAssetIds, ['f1', 'q1']);
  assert.equal(s1.ops[1]!.model, 'veo-3.1-generate-preview');
  assert.equal(s1.ops[1]!.usd, 3.2);
  assert.equal(s1.ops[3]!.experimental, true);
  // 4 × keyframe 0.134 + clips 30 s × 0.40 + 4 voices × 0.01 + lip-sync 30 s × 0.05 + 4 reviews × 0.02
  assert.equal(sb.perTakeUsd, 14.156);
  assert.equal(sb.expectedUsd, Math.round(sb.perTakeUsd * 3 * 1000) / 1000);
  const draft = storyboard(base, { limo_man: ready }, { tier: 'fast', resolution: '720p', voiceMode: 'native', lipSync: false, takes: 1 });
  assert.equal(draft.perTakeUsd, 3.616);
});

test('clip prompt uses only the scenario and the canonical identity; dialogue in quotes only for native audio', () => {
  const p = clipPrompt(scene(1, { dialogue: [{ speaker: 'limo_man', text: '[line]' }], sound: '[sound]' }), 'native');
  assert.match(p, /LIMO adult man/);
  assert.match(p, /says: "\[line\]"/);
  assert.match(p, /Sound: \[sound\]/);
  const sep = clipPrompt(scene(1), 'separate');
  assert.doesNotMatch(sep, /"\[line\]"/);
  assert.match(sep, /voice added separately/);
});
