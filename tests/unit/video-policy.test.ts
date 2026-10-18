import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VIDEO_POLICY, VIDEO_MAX_DURATION_MS, checkSpecDuration, exportCreditsFor, secondsOverLimit, withinVideoLimit } from '../../lib/video/policy.ts';
import { buildStarterScenes } from '../../lib/create/templates.ts';
import { CREATION_MODES } from '../../lib/create/modes.ts';
import { buildContinueDraft } from '../../lib/story/continue.ts';
import { totalDuration } from '../../lib/studio/validation.ts';

test('V1 policy: 30 s for every plan, one credit per video', () => {
  assert.equal(VIDEO_POLICY.maxDurationSeconds, 30);
  assert.equal(VIDEO_POLICY.creditsPerVideo, 1);
  assert.equal(VIDEO_MAX_DURATION_MS, 30_000);
});

test('boundaries: 1–30 s exportable, 0 and over 30 s not', () => {
  for (const s of [1, 10, 20, 29.5, 30]) assert.equal(withinVideoLimit(s), true, String(s));
  for (const s of [0, -1, 30.001, 31, 600, Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(withinVideoLimit(s), false, String(s));
});

test('credits: exactly one for 10, 20 or 30 s; refused above the limit', () => {
  assert.deepEqual([10, 20, 30].map(exportCreditsFor), [1, 1, 1]);
  assert.throws(() => exportCreditsFor(31), /limited to 30 seconds/);
  assert.throws(() => exportCreditsFor(0), RangeError);
});

test('seconds over the limit (shown to the user)', () => {
  assert.equal(secondsOverLimit(30), 0);
  assert.equal(secondsOverLimit(30.2), 1);
  assert.equal(secondsOverLimit(45), 15);
});

test('worker spec check: within limit, over limit, inconsistent total, empty', () => {
  const scenes = (...ms: number[]) => ({ scenes: ms.map((duration_ms) => ({ duration_ms })) });
  assert.equal(checkSpecDuration(scenes(15_000, 15_000), 30_000), null);
  assert.match(checkSpecDuration(scenes(15_000, 15_001)) ?? '', /limited to 30 seconds/);
  assert.match(checkSpecDuration(scenes(10_000, 10_000), 30_000) ?? '', /inconsistent/);
  assert.match(checkSpecDuration(scenes()) ?? '', /no duration/);
});

test('every starter template and story continuation draft fits in one 30 s video', () => {
  for (const mode of CREATION_MODES) {
    const total = totalDuration(buildStarterScenes(mode, {}, []));
    assert.ok(total > 0 && total <= 30, `${mode}: ${total} s`);
  }
  const bible = {
    premise: 'A garden story.',
    characters: [{ ref: 'limo_boy', name: 'Limo' }],
    locations: [{ key: 'garden', name: 'Garden', description: '' }],
    arcs: [
      { key: 'a', title: 'A', description: '', status: 'open' },
      { key: 'b', title: 'B', description: '', status: 'open' },
      { key: 'c', title: 'C', description: '', status: 'open' },
    ],
  } as never;
  const previous = { number: 1, checkpoint: { summary: '', ending_hook: 'Hook.', location_key: 'garden', time_label: '', characters: [{ ref: 'limo_boy', present: true }] } } as never;
  assert.ok(totalDuration(buildContinueDraft(bible, previous, 2).scenes) <= 30);
});
