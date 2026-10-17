import { newScene } from '../studio/draft.ts';
import type { SceneDraft } from '../studio/types.ts';
import type { CharacterState, EpisodeCheckpoint, ReviewReason, StoryBible } from './types.ts';

/**
 * Deterministic "Mock AI" for the Story Engine. It never calls an external service and never invents
 * story facts: the opening comes from the previous APPROVED ending (location, who is present, their
 * states, the ending hook), open threads come from the bible, and everything new is a visible
 * [placeholder] for the writer.
 */

const name = (bible: StoryBible, ref: string) => bible.characters.find((c) => c.ref === ref)?.name ?? ref;
const firstSentence = (t: string) => (t.trim().split(/(?<=[.!?؟…])\s+/)[0] ?? '').trim();

export interface ContinueDraft {
  title: string;
  cast: string[];
  scenes: SceneDraft[];
  /** Exactly which approved ending this draft starts from (null for episode 1). */
  based_on_episode: number | null;
}

function stateLine(bible: StoryBible, s: CharacterState): string {
  const bits = [s.emotional_state, s.physical_state, s.current_goal ? `wants: ${s.current_goal}` : ''].filter(Boolean).join('; ');
  return `${name(bible, s.ref)}${bits ? ` (${bits})` : ''}`;
}

export function buildContinueDraft(bible: StoryBible, previous: { number: number; checkpoint: EpisodeCheckpoint } | null, nextNumber: number): ContinueDraft {
  const known = new Set(bible.characters.map((c) => c.ref));
  const openArcs = bible.arcs.filter((a) => a.status === 'open').slice(0, 2);
  const scenes: SceneDraft[] = [];
  let cast: string[];

  if (previous) {
    const cp = previous.checkpoint;
    const present = cp.characters.filter((c) => c.present && known.has(c.ref));
    cast = present.length ? present.map((c) => c.ref) : bible.characters.map((c) => c.ref).slice(0, 6);
    const loc = bible.locations.find((l) => l.key === cp.location_key);
    scenes.push(
      newScene({
        title: `Picking up from episode ${previous.number}`,
        duration_seconds: 6,
        participants: present.filter((c) => !c.location_key || c.location_key === cp.location_key).map((c) => c.ref),
        location_prompt: loc ? `${loc.name}${loc.description ? `: ${loc.description}` : ''}` : '',
        narration: cp.ending_hook,
        continuity_notes: [
          `Continues directly from the approved ending of episode ${previous.number}.`,
          cp.time_label ? `Time: ${cp.time_label}.` : '',
          present.length ? `States: ${present.map((s) => stateLine(bible, s)).join('; ')}.` : '',
        ]
          .filter(Boolean)
          .join(' '),
      }),
    );
  } else {
    cast = bible.characters.map((c) => c.ref).slice(0, 6);
    const loc = bible.locations[0];
    scenes.push(
      newScene({
        title: 'Opening',
        duration_seconds: 6,
        participants: cast.slice(0, 3),
        location_prompt: loc ? `${loc.name}${loc.description ? `: ${loc.description}` : ''}` : '',
        narration: bible.premise ? firstSentence(bible.premise) : '[Write the opening line]',
        continuity_notes: 'Episode 1: introduces the canon from the Story Bible.',
      }),
    );
  }

  for (const arc of openArcs) {
    scenes.push(
      newScene({
        title: `Thread: ${arc.title}`,
        duration_seconds: 6,
        participants: cast.slice(0, 3),
        action_prompt: `[What happens next in “${arc.title}”]`,
        continuity_notes: arc.description ? `Open thread: ${arc.description}` : 'Open thread.',
      }),
    );
  }
  scenes.push(newScene({ title: 'New ending', duration_seconds: 6, participants: cast.slice(0, 3), narration: '[Write the new ending hook]' }));
  return { title: `Episode ${nextNumber}`, cast, scenes, based_on_episode: previous?.number ?? null };
}

/** Suggests an ending checkpoint from the episode's own script; states carry over unless the writer changes them. */
export function suggestCheckpoint(
  bible: StoryBible,
  scenes: Array<Pick<SceneDraft, 'title' | 'narration' | 'dialogue' | 'action_prompt' | 'location_prompt' | 'participants'>>,
  previous: EpisodeCheckpoint | null,
): EpisodeCheckpoint {
  const known = new Set(bible.characters.map((c) => c.ref));
  const last = scenes[scenes.length - 1];
  const text = (s: (typeof scenes)[number]) => [s.title, s.narration, s.dialogue, s.action_prompt].join(' ').toLowerCase();
  const lastLoc = last ? bible.locations.find((l) => l.name && last.location_prompt.toLowerCase().includes(l.name.toLowerCase())) : undefined;
  const cast = [...new Set(scenes.flatMap((s) => s.participants))].filter((r) => known.has(r));
  const prevState = new Map((previous?.characters ?? []).map((c) => [c.ref, c]));
  return {
    summary: scenes.map((s, i) => `${i + 1}. ${s.title || '—'}`).join(' '),
    ending_hook: last ? firstSentence(last.narration || last.dialogue) : '',
    location_key: lastLoc?.key ?? previous?.location_key ?? '',
    time_label: previous?.time_label ?? '',
    characters: cast.map((ref) => {
      const p = prevState.get(ref);
      return {
        ref,
        present: Boolean(last?.participants.includes(ref)),
        location_key: lastLoc?.key ?? p?.location_key ?? '',
        emotional_state: p?.emotional_state ?? '',
        physical_state: p?.physical_state ?? '',
        current_goal: p?.current_goal ?? '',
      };
    }),
    events: scenes
      .map((s, i) => ({ text: [s.title, firstSentence(s.narration)].filter(Boolean).join(': '), characters: s.participants.filter((r) => known.has(r)), scenes: [i + 1] }))
      .filter((e) => e.text),
    arcs_progressed: bible.arcs.filter((a) => a.status === 'open' && scenes.some((s) => text(s).includes(a.title.toLowerCase()))).map((a) => a.id),
    arcs_resolved: [],
    arcs_opened: [],
  };
}

/** Which characters and arcs differ between two versions of an episode ending. */
export function checkpointChanges(before: EpisodeCheckpoint | null, after: EpisodeCheckpoint | null): { characters: string[]; arcs: string[] } {
  const chars = new Set<string>();
  const arcs = new Set<string>();
  const sb = new Map((before?.characters ?? []).map((c) => [c.ref, JSON.stringify(c)]));
  const sa = new Map((after?.characters ?? []).map((c) => [c.ref, JSON.stringify(c)]));
  for (const k of new Set([...sb.keys(), ...sa.keys()])) if (sb.get(k) !== sa.get(k)) chars.add(k);
  const evRefs = (cp: EpisodeCheckpoint | null) => new Set((cp?.events ?? []).flatMap((e) => e.characters));
  const eb = JSON.stringify(before?.events ?? []);
  const ea = JSON.stringify(after?.events ?? []);
  if (eb !== ea) for (const r of new Set([...evRefs(before), ...evRefs(after)])) chars.add(r);
  const arcSet = (cp: EpisodeCheckpoint | null) => JSON.stringify([cp?.arcs_progressed ?? [], cp?.arcs_resolved ?? [], cp?.arcs_opened ?? []]);
  if (arcSet(before) !== arcSet(after)) {
    for (const id of [...(before?.arcs_progressed ?? []), ...(before?.arcs_resolved ?? []), ...(after?.arcs_progressed ?? []), ...(after?.arcs_resolved ?? [])]) arcs.add(id);
    for (const a of [...(before?.arcs_opened ?? []), ...(after?.arcs_opened ?? [])]) arcs.add(a.id);
  }
  if ((before?.location_key ?? '') !== (after?.location_key ?? '') || (before?.ending_hook ?? '') !== (after?.ending_hook ?? '')) {
    for (const c of after?.characters ?? before?.characters ?? []) if (c.present) chars.add(c.ref);
  }
  return { characters: [...chars].sort(), arcs: [...arcs].sort() };
}

/**
 * Later episodes that need review after episode `changed` changes. The next episode starts from that
 * ending, so it is always directly affected; later ones are direct when they involve a changed
 * character or arc, otherwise downstream (still flagged: the chain of endings changed).
 * Mirrors limo_flag_later_episodes in migration 20261017160000.
 */
export function affectedEpisodes(
  changed: number,
  kind: ReviewReason['kind'],
  changes: { characters: string[]; arcs: string[] },
  later: Array<{ number: number; cast: string[]; arcs: string[] }>,
  at: string,
): Array<{ number: number; reason: ReviewReason }> {
  return later
    .filter((e) => e.number > changed)
    .map((e) => {
      const direct = e.number === changed + 1 || e.cast.some((c) => changes.characters.includes(c)) || e.arcs.some((a) => changes.arcs.includes(a));
      return { number: e.number, reason: { episode_number: changed, kind, impact: direct ? 'direct' : 'downstream', characters: changes.characters, arcs: changes.arcs, at } };
    });
}
