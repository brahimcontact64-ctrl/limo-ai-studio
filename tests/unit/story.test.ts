import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCheckpointToBible, diffBible, normalizeBible, normalizeCheckpoint, validateBible, validateCheckpoint } from '../../lib/story/bible.ts';
import { affectedEpisodes, buildContinueDraft, checkpointChanges, suggestCheckpoint } from '../../lib/story/continue.ts';
import { checkContinuity } from '../../lib/story/continuity.ts';
import { EMPTY_BIBLE, type EpisodeCheckpoint, type StoryBible } from '../../lib/story/types.ts';
import { emptyProject } from '../../lib/studio/draft.ts';

const bible: StoryBible = normalizeBible({
  premise: 'Three neighbours run a market stall. Every week something goes missing.',
  genre: 'Comedy',
  tone: 'warm',
  characters: [
    { ref: 'limo_boy', name: 'Limo', role: 'curious kid', traits: ['curious'], goals: ['find the key'], motivations: ['help grandma'] },
    { ref: 'nova_elder_woman', name: 'Grandma Nova', role: 'stall owner', traits: ['wise'], goals: [], motivations: [] },
    { ref: 'adam_man', name: 'Adam', role: 'neighbour', traits: ['grumpy'], goals: [], motivations: [] },
  ],
  relationships: [{ a: 'limo_boy', b: 'nova_elder_woman', kind: 'grandson', note: '' }],
  locations: [
    { key: 'market', name: 'Market', description: 'Busy morning market' },
    { key: 'kitchen', name: 'Kitchen', description: 'Grandma’s kitchen' },
  ],
  world_rules: [{ id: 'no-magic', text: 'magic', kind: 'forbidden' }],
  arcs: [{ id: 'lost-key', title: 'The lost key', description: 'The stall key vanished', status: 'open', opened_in: 1 }],
});

test('bible: normalisation and validation', () => {
  assert.deepEqual(validateBible(bible), []);
  const bad = normalizeBible({ characters: [{ ref: 'not_a_character', name: '' }, { ref: 'limo_boy', name: 'A' }, { ref: 'limo_boy', name: 'B' }], relationships: [{ a: 'limo_boy', b: 'ghost' }], locations: [{ key: 'Bad Key!' }], arcs: [{ id: 'x' }, { id: 'x' }] });
  const codes = validateBible(bad).map((i) => i.code).sort();
  assert.deepEqual(codes, ['arc_duplicate', 'character_duplicate', 'character_name_required', 'character_ref_invalid', 'location_key_invalid', 'relationship_unknown_character'].sort());
  const changes = diffBible(bible, { ...bible, characters: bible.characters.slice(0, 2), locations: [...bible.locations, { key: 'park', name: 'Park', description: '' }] });
  assert.deepEqual(changes.map((c) => `${c.section}:${c.kind}:${c.key}`).sort(), ['characters:removed:adam_man', 'locations:added:park']);
});

/** Simulates writing and approving episodes; the "approved" checkpoint is what the next episode starts from. */
function approve(b: StoryBible, cp: EpisodeCheckpoint, n: number) {
  return { bible: applyCheckpointToBible(b, cp, n), approved: { number: n, checkpoint: cp } };
}

test('three consecutive episodes continue from the exact previous approved ending', () => {
  // Episode 1 from the bible.
  const d1 = buildContinueDraft(bible, null, 1);
  assert.equal(d1.based_on_episode, null);
  assert.deepEqual(d1.cast, ['limo_boy', 'nova_elder_woman', 'adam_man']);
  assert.ok(d1.scenes.some((s) => s.title === 'Thread: The lost key'));
  d1.scenes[d1.scenes.length - 1]!.narration = 'Grandma Nova finds a map in the kitchen.';
  d1.scenes[d1.scenes.length - 1]!.location_prompt = 'Kitchen';
  const cp1: EpisodeCheckpoint = {
    ...suggestCheckpoint(bible, d1.scenes, null),
    summary: 'Limo and Grandma search the market; a map turns up.',
    characters: [
      { ref: 'limo_boy', present: true, location_key: 'kitchen', emotional_state: 'excited', physical_state: 'scraped knee', current_goal: 'read the map' },
      { ref: 'nova_elder_woman', present: true, location_key: 'kitchen', emotional_state: 'worried', physical_state: '', current_goal: '' },
      { ref: 'adam_man', present: false, location_key: 'market', emotional_state: 'annoyed', physical_state: '', current_goal: '' },
    ],
    arcs_progressed: ['lost-key'],
    arcs_opened: [{ id: 'the-map', title: 'The map', description: 'Who drew the map?' }],
  };
  assert.equal(cp1.ending_hook, 'Grandma Nova finds a map in the kitchen.');
  assert.equal(cp1.location_key, 'kitchen');
  assert.deepEqual(validateCheckpoint(cp1, bible, d1.scenes.length), []);
  let state = approve(bible, cp1, 1);
  assert.ok(state.bible.arcs.some((a) => a.id === 'the-map' && a.status === 'open' && a.opened_in === 1));

  // Episode 2 starts from episode 1's approved ending.
  const d2 = buildContinueDraft(state.bible, state.approved, 2);
  assert.equal(d2.based_on_episode, 1);
  assert.deepEqual(d2.cast, ['limo_boy', 'nova_elder_woman'], 'only characters present at the approved ending');
  const open2 = d2.scenes[0]!;
  assert.equal(open2.narration, cp1.ending_hook);
  assert.ok(open2.location_prompt.startsWith('Kitchen'));
  assert.ok(open2.continuity_notes.includes('scraped knee') && open2.continuity_notes.includes('read the map'));
  assert.deepEqual(open2.participants, ['limo_boy', 'nova_elder_woman']);
  // No invented events: every non-carried line is a visible placeholder.
  for (const s of d2.scenes.slice(1)) assert.ok(/\[.+\]/.test(s.action_prompt || s.narration), s.title);
  // Threads are not forgotten: every open arc gets a scene.
  assert.deepEqual(d2.scenes.filter((s) => s.title.startsWith('Thread:')).map((s) => s.title), ['Thread: The lost key', 'Thread: The map']);
  d2.scenes[d2.scenes.length - 1]!.narration = 'The key was in the map case all along.';
  const cp2: EpisodeCheckpoint = { ...suggestCheckpoint(state.bible, d2.scenes, cp1), summary: 'The key is found.', arcs_resolved: ['lost-key'] };
  assert.equal(cp2.characters.find((c) => c.ref === 'limo_boy')?.physical_state, 'scraped knee', 'states carry over unless changed');
  assert.deepEqual(validateCheckpoint(cp2, state.bible, d2.scenes.length), []);
  state = approve(state.bible, cp2, 2);
  assert.equal(state.bible.arcs.find((a) => a.id === 'lost-key')?.status, 'resolved');
  assert.equal(state.bible.arcs.find((a) => a.id === 'lost-key')?.resolved_in, 2);

  // Episode 3: the resolved thread is gone, the still-open one remains.
  const d3 = buildContinueDraft(state.bible, state.approved, 3);
  assert.equal(d3.scenes[0]!.narration, 'The key was in the map case all along.');
  assert.deepEqual(d3.scenes.filter((s) => s.title.startsWith('Thread:')).map((s) => s.title), ['Thread: The map']);
  // Identities never change: names and refs come from the bible.
  assert.ok(d3.cast.every((ref) => bible.characters.some((c) => c.ref === ref)));
  assert.equal(state.bible.relationships[0]!.kind, 'grandson');
});

test('checkpoint validation keeps the timeline to canon and to this episode’s scenes', () => {
  const cp = normalizeCheckpoint({
    summary: '',
    location_key: 'moon',
    characters: [{ ref: 'nova_boy', location_key: 'market' }],
    events: [{ text: 'An earlier invented event', characters: ['limo_boy'], scenes: [] }, { text: 'Too far', characters: [], scenes: [9] }],
    arcs_progressed: ['nope'],
    arcs_opened: [{ id: 'lost-key', title: 'dup' }],
  });
  const codes = validateCheckpoint(cp, bible, 3).map((i) => i.code).sort();
  assert.deepEqual(codes, ['event_scene_missing', 'event_without_scene', 'new_arc_exists', 'summary_required', 'unknown_arc', 'unknown_character', 'unknown_location'].sort());
  const resolvedTwice = validateCheckpoint({ ...cp, summary: 'x', location_key: '', characters: [], events: [], arcs_progressed: [], arcs_opened: [], arcs_resolved: ['lost-key'] }, { ...bible, arcs: [{ ...bible.arcs[0]!, status: 'resolved' }] }, 3);
  assert.deepEqual(resolvedTwice.map((i) => i.code), ['arc_already_resolved']);
});

test('revising an earlier episode flags later episodes (direct vs downstream)', () => {
  const before: EpisodeCheckpoint = normalizeCheckpoint({ summary: 'a', location_key: 'kitchen', characters: [{ ref: 'limo_boy', present: true, emotional_state: 'happy' }, { ref: 'adam_man', present: false }], arcs_progressed: ['lost-key'] });
  const after: EpisodeCheckpoint = normalizeCheckpoint({ summary: 'a', location_key: 'kitchen', characters: [{ ref: 'limo_boy', present: true, emotional_state: 'scared' }, { ref: 'adam_man', present: false }], arcs_progressed: ['lost-key'] });
  const changes = checkpointChanges(before, after);
  assert.deepEqual(changes, { characters: ['limo_boy'], arcs: [] });
  const later = [
    { number: 3, cast: ['adam_man'], arcs: [] },
    { number: 4, cast: ['limo_boy'], arcs: [] },
    { number: 5, cast: ['adam_man'], arcs: [] },
    { number: 1, cast: ['limo_boy'], arcs: [] },
  ];
  const flagged = affectedEpisodes(2, 'earlier_episode_changed', changes, later, 't');
  assert.deepEqual(flagged.map((f) => [f.number, f.reason.impact]), [[3, 'direct'], [4, 'direct'], [5, 'downstream']]);
  assert.ok(flagged.every((f) => f.reason.episode_number === 2));
  assert.deepEqual(checkpointChanges(before, before), { characters: [], arcs: [] });
});

test('story continuity does not touch projects outside a series', () => {
  const ad = emptyProject({ content_type: 'custom', language_code: 'en', creation_mode: 'product_ad' });
  assert.deepEqual(checkContinuity(ad, { series_id: 's', title: '', continuity_mode: 'strict', bible: EMPTY_BIBLE, bible_version: 1, episode_number: null, previous: null }), []);
});
