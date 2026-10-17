import { isCastId } from '../studio/limits.ts';
import type { BibleCharacter, CharacterState, EpisodeCheckpoint, PlotArc, StoryBible } from './types.ts';

const S = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const L = (v: unknown, maxItems: number, maxLen: number) => (Array.isArray(v) ? v.map((x) => S(x, maxLen)).filter(Boolean).slice(0, maxItems) : []);
const KEY = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const O = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const A = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export const BIBLE_LIMITS = { characters: 18, relationships: 60, locations: 40, rules: 40, arcs: 40 } as const;

export type BibleIssue =
  | { code: 'character_ref_invalid'; ref: string }
  | { code: 'character_duplicate'; ref: string }
  | { code: 'character_name_required'; ref: string }
  | { code: 'relationship_unknown_character'; ref: string }
  | { code: 'location_key_invalid'; key: string }
  | { code: 'location_duplicate'; key: string }
  | { code: 'arc_id_invalid'; id: string }
  | { code: 'arc_duplicate'; id: string }
  | { code: 'too_many'; section: string };

/** Normalises untrusted input into a bible (drops unknown fields, trims, caps sizes). */
export function normalizeBible(raw: unknown): StoryBible {
  const b = O(raw);
  return {
    premise: S(b.premise, 4000),
    genre: S(b.genre, 120),
    tone: S(b.tone, 200),
    characters: A(b.characters).slice(0, BIBLE_LIMITS.characters + 1).map((c) => {
      const o = O(c);
      return { ref: S(o.ref, 60), name: S(o.name, 80), role: S(o.role, 200), traits: L(o.traits, 12, 120), goals: L(o.goals, 8, 200), motivations: L(o.motivations, 8, 200) };
    }),
    relationships: A(b.relationships).slice(0, BIBLE_LIMITS.relationships + 1).map((r) => {
      const o = O(r);
      return { a: S(o.a, 60), b: S(o.b, 60), kind: S(o.kind, 60), note: S(o.note, 300) };
    }),
    locations: A(b.locations).slice(0, BIBLE_LIMITS.locations + 1).map((l) => {
      const o = O(l);
      return { key: S(o.key, 40).toLowerCase(), name: S(o.name, 120), description: S(o.description, 1000) };
    }),
    world_rules: A(b.world_rules).slice(0, BIBLE_LIMITS.rules + 1).map((r, i) => {
      const o = O(r);
      return { id: S(o.id, 40) || `rule-${i + 1}`, text: S(o.text, 500), kind: o.kind === 'forbidden' ? 'forbidden' : 'rule' };
    }),
    arcs: A(b.arcs).slice(0, BIBLE_LIMITS.arcs + 1).map((a) => {
      const o = O(a);
      const n = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 ? (v as number) : null);
      return { id: S(o.id, 40).toLowerCase(), title: S(o.title, 160), description: S(o.description, 1000), status: o.status === 'resolved' ? 'resolved' : 'open', opened_in: n(o.opened_in), resolved_in: n(o.resolved_in) } as PlotArc;
    }),
  };
}

export function validateBible(b: StoryBible): BibleIssue[] {
  const out: BibleIssue[] = [];
  const sections: Array<[keyof typeof BIBLE_LIMITS, unknown[]]> = [
    ['characters', b.characters],
    ['relationships', b.relationships],
    ['locations', b.locations],
    ['rules', b.world_rules],
    ['arcs', b.arcs],
  ];
  for (const [k, list] of sections) if (list.length > BIBLE_LIMITS[k]) out.push({ code: 'too_many', section: k });
  const refs = new Set<string>();
  for (const c of b.characters) {
    if (!isCastId(c.ref)) out.push({ code: 'character_ref_invalid', ref: c.ref });
    else if (refs.has(c.ref)) out.push({ code: 'character_duplicate', ref: c.ref });
    refs.add(c.ref);
    if (!c.name) out.push({ code: 'character_name_required', ref: c.ref });
  }
  for (const r of b.relationships) for (const x of [r.a, r.b]) if (!refs.has(x)) out.push({ code: 'relationship_unknown_character', ref: x });
  const keys = new Set<string>();
  for (const l of b.locations) {
    if (!KEY.test(l.key)) out.push({ code: 'location_key_invalid', key: l.key });
    else if (keys.has(l.key)) out.push({ code: 'location_duplicate', key: l.key });
    keys.add(l.key);
  }
  const arcs = new Set<string>();
  for (const a of b.arcs) {
    if (!KEY.test(a.id)) out.push({ code: 'arc_id_invalid', id: a.id });
    else if (arcs.has(a.id)) out.push({ code: 'arc_duplicate', id: a.id });
    arcs.add(a.id);
  }
  return out;
}

export interface BibleChange {
  section: 'premise' | 'characters' | 'relationships' | 'locations' | 'world_rules' | 'arcs';
  kind: 'added' | 'removed' | 'changed';
  key: string;
}

/** What a canon change does (shown to the user before saving; nothing changes silently). */
export function diffBible(before: StoryBible, after: StoryBible): BibleChange[] {
  const out: BibleChange[] = [];
  if (before.premise !== after.premise || before.genre !== after.genre || before.tone !== after.tone) out.push({ section: 'premise', kind: 'changed', key: 'premise' });
  const cmp = <T>(section: BibleChange['section'], a: T[], b: T[], key: (x: T) => string) => {
    const ma = new Map(a.map((x) => [key(x), JSON.stringify(x)]));
    const mb = new Map(b.map((x) => [key(x), JSON.stringify(x)]));
    for (const [k, v] of mb) if (!ma.has(k)) out.push({ section, kind: 'added', key: k });
    else if (ma.get(k) !== v) out.push({ section, kind: 'changed', key: k });
    for (const k of ma.keys()) if (!mb.has(k)) out.push({ section, kind: 'removed', key: k });
  };
  cmp('characters', before.characters, after.characters, (c: BibleCharacter) => c.ref);
  cmp('relationships', before.relationships, after.relationships, (r) => `${r.a}|${r.b}|${r.kind}`);
  cmp('locations', before.locations, after.locations, (l) => l.key);
  cmp('world_rules', before.world_rules, after.world_rules, (r) => r.id);
  cmp('arcs', before.arcs, after.arcs, (a) => a.id);
  return out;
}

/** Applies an approved checkpoint's arc changes to the bible (done when the user approves the episode). */
export function applyCheckpointToBible(bible: StoryBible, cp: EpisodeCheckpoint, episodeNumber: number): StoryBible {
  const arcs = bible.arcs.map((a) => (cp.arcs_resolved.includes(a.id) ? { ...a, status: 'resolved' as const, resolved_in: episodeNumber } : a));
  for (const n of cp.arcs_opened) if (!arcs.some((a) => a.id === n.id)) arcs.push({ id: n.id, title: n.title, description: n.description, status: 'open', opened_in: episodeNumber, resolved_in: null });
  return { ...bible, arcs };
}

export function normalizeCheckpoint(raw: unknown): EpisodeCheckpoint {
  const c = O(raw);
  const ids = (v: unknown) => L(v, 40, 40).map((x) => x.toLowerCase());
  return {
    summary: S(c.summary, 4000),
    ending_hook: S(c.ending_hook, 1000),
    location_key: S(c.location_key, 40).toLowerCase(),
    time_label: S(c.time_label, 120),
    characters: A(c.characters).slice(0, 18).map((x) => {
      const o = O(x);
      return { ref: S(o.ref, 60), present: o.present !== false, location_key: S(o.location_key, 40).toLowerCase(), emotional_state: S(o.emotional_state, 200), physical_state: S(o.physical_state, 200), current_goal: S(o.current_goal, 300) } as CharacterState;
    }),
    events: A(c.events).slice(0, 40).map((e) => {
      const o = O(e);
      return { text: S(o.text, 500), characters: L(o.characters, 18, 60), scenes: A(o.scenes).filter((n): n is number => Number.isInteger(n) && (n as number) > 0).slice(0, 25) };
    }),
    arcs_progressed: ids(c.arcs_progressed),
    arcs_resolved: ids(c.arcs_resolved),
    arcs_opened: A(c.arcs_opened).slice(0, 10).map((a) => {
      const o = O(a);
      return { id: S(o.id, 40).toLowerCase(), title: S(o.title, 160), description: S(o.description, 1000) };
    }),
  };
}

export type CheckpointIssue =
  | { code: 'summary_required' }
  | { code: 'unknown_character'; ref: string }
  | { code: 'unknown_location'; key: string }
  | { code: 'unknown_arc'; id: string }
  | { code: 'arc_already_resolved'; id: string }
  | { code: 'new_arc_exists'; id: string }
  | { code: 'event_without_scene'; index: number }
  | { code: 'event_scene_missing'; index: number; scene: number }
  | { code: 'event_text_required'; index: number };

/**
 * An ending checkpoint may only refer to canon (bible characters, locations, arcs) and to scenes of this
 * episode: events must come from the script, so the timeline never gains invented events.
 */
export function validateCheckpoint(cp: EpisodeCheckpoint, bible: StoryBible, sceneCount: number): CheckpointIssue[] {
  const out: CheckpointIssue[] = [];
  const refs = new Set(bible.characters.map((c) => c.ref));
  const locs = new Set(bible.locations.map((l) => l.key));
  const arcs = new Map(bible.arcs.map((a) => [a.id, a]));
  if (!cp.summary) out.push({ code: 'summary_required' });
  if (cp.location_key && !locs.has(cp.location_key)) out.push({ code: 'unknown_location', key: cp.location_key });
  for (const s of cp.characters) {
    if (!refs.has(s.ref)) out.push({ code: 'unknown_character', ref: s.ref });
    if (s.location_key && !locs.has(s.location_key)) out.push({ code: 'unknown_location', key: s.location_key });
  }
  cp.events.forEach((e, index) => {
    if (!e.text) out.push({ code: 'event_text_required', index });
    if (e.scenes.length === 0) out.push({ code: 'event_without_scene', index });
    for (const n of e.scenes) if (n > sceneCount) out.push({ code: 'event_scene_missing', index, scene: n });
    for (const r of e.characters) if (!refs.has(r)) out.push({ code: 'unknown_character', ref: r });
  });
  for (const id of [...cp.arcs_progressed, ...cp.arcs_resolved]) if (!arcs.has(id)) out.push({ code: 'unknown_arc', id });
  for (const id of cp.arcs_resolved) if (arcs.get(id)?.status === 'resolved') out.push({ code: 'arc_already_resolved', id });
  for (const n of cp.arcs_opened) if (arcs.has(n.id) || !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(n.id)) out.push({ code: 'new_arc_exists', id: n.id });
  return out;
}
