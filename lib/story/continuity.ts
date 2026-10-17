import type { ProjectDraft } from '../studio/types.ts';

/**
 * Edit-time continuity checks for projects that belong to a series (studio_projects.series_id).
 * Milestone 3 scope: validate edits against data that already exists. The full Story Engine
 * (facts, conflicts, episode generation) is Milestone 5.
 *
 * Accepted shapes (all optional):
 *   content_series.cast_bible  = { characters: ["limo_boy", ...] | [{ id: "limo_boy" }, ...] }
 *   content_series.story_rules = { forbidden: ["word", ...] }
 *   content_episodes.last_scene_state = { location: "...", characters: ["limo_boy", ...] }
 */
export interface SeriesContext {
  series_id: string;
  title: string;
  continuity_mode: 'strict' | 'flexible';
  cast_bible: unknown;
  story_rules: unknown;
  previous: { episode_number: number; ending_hook: string | null; last_scene_state: unknown } | null;
}

export type ContinuityCode = 'character_not_in_series' | 'forbidden_term' | 'opening_location_changed' | 'missing_recap';
export interface ContinuityIssue {
  code: ContinuityCode;
  severity: 'error' | 'warning';
  scene?: number;
  params?: Record<string, string | number>;
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const ids = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : typeof obj(x).id === 'string' ? (obj(x).id as string) : '')).filter(Boolean) : [];
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : []);

export function checkContinuity(draft: ProjectDraft, series: SeriesContext): ContinuityIssue[] {
  const out: ContinuityIssue[] = [];
  const established = ids(obj(series.cast_bible).characters);
  if (established.length > 0) {
    for (const id of draft.cast) if (!established.includes(id)) out.push({ code: 'character_not_in_series', severity: 'warning', params: { id } });
  }

  const forbidden = strings(obj(series.story_rules).forbidden).map((w) => w.toLowerCase());
  if (forbidden.length) {
    draft.scenes.forEach((s, i) => {
      const text = [s.title, s.narration, s.dialogue, s.on_screen_text, s.action_prompt, s.visual_prompt].join('\n').toLowerCase();
      const hit = forbidden.find((w) => text.includes(w));
      if (hit) out.push({ code: 'forbidden_term', severity: 'error', scene: i, params: { term: hit } });
    });
  }

  const prev = series.previous;
  const first = draft.scenes[0];
  if (prev && first) {
    const state = obj(prev.last_scene_state);
    const location = typeof state.location === 'string' ? state.location.trim() : '';
    if (series.continuity_mode === 'strict' && location && first.location_prompt.trim() && !first.location_prompt.toLowerCase().includes(location.toLowerCase()) && !first.continuity_notes.trim()) {
      out.push({ code: 'opening_location_changed', severity: 'warning', scene: 0, params: { location, episode: prev.episode_number } });
    }
    if (prev.ending_hook && !first.continuity_notes.trim()) out.push({ code: 'missing_recap', severity: 'warning', scene: 0, params: { episode: prev.episode_number } });
  }
  return out;
}
