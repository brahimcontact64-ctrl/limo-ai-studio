import type { ProjectDraft } from '../studio/types.ts';
import type { EpisodeCheckpoint, StoryBible } from './types.ts';

/**
 * Edit-time continuity checks for a studio project that is an episode of a series.
 * The context is the current Story Bible and the APPROVED ending of the previous episode.
 * Errors block saving; warnings are shown in the editor.
 */
export interface SeriesContext {
  series_id: string;
  title: string;
  continuity_mode: 'strict' | 'flexible';
  bible: StoryBible;
  bible_version: number;
  episode_number: number | null;
  previous: { episode_number: number; checkpoint: EpisodeCheckpoint } | null;
}

export type ContinuityCode =
  | 'character_not_in_series'
  | 'forbidden_term'
  | 'opening_location_changed'
  | 'missing_recap'
  | 'absent_at_previous_ending'
  | 'open_threads_unaddressed';

export interface ContinuityIssue {
  code: ContinuityCode;
  severity: 'error' | 'warning';
  scene?: number;
  params?: Record<string, string | number>;
}

export function checkContinuity(draft: ProjectDraft, ctx: SeriesContext): ContinuityIssue[] {
  const out: ContinuityIssue[] = [];
  const bible = ctx.bible;
  const known = new Set(bible.characters.map((c) => c.ref));
  const nameOf = (ref: string) => bible.characters.find((c) => c.ref === ref)?.name ?? ref;

  // Identity: only canon characters can appear. Adding one is a deliberate Story Bible change.
  for (const id of draft.cast) if (!known.has(id)) out.push({ code: 'character_not_in_series', severity: 'error', params: { id } });

  const forbidden = bible.world_rules.filter((r) => r.kind === 'forbidden' && r.text.trim()).map((r) => r.text.trim().toLowerCase());
  draft.scenes.forEach((s, i) => {
    const text = [s.title, s.narration, s.dialogue, s.on_screen_text, s.action_prompt, s.visual_prompt].join('\n').toLowerCase();
    const hit = forbidden.find((w) => text.includes(w));
    if (hit) out.push({ code: 'forbidden_term', severity: 'error', scene: i, params: { term: hit } });
  });

  const prev = ctx.previous;
  const first = draft.scenes[0];
  if (prev && first) {
    const cp = prev.checkpoint;
    const loc = bible.locations.find((l) => l.key === cp.location_key);
    const noted = first.continuity_notes.trim().length > 0;
    if (ctx.continuity_mode === 'strict' && loc && first.location_prompt.trim() && !first.location_prompt.toLowerCase().includes(loc.name.toLowerCase()) && !noted) {
      out.push({ code: 'opening_location_changed', severity: 'warning', scene: 0, params: { location: loc.name, episode: prev.episode_number } });
    }
    if (cp.ending_hook && !noted) out.push({ code: 'missing_recap', severity: 'warning', scene: 0, params: { episode: prev.episode_number } });
    const presentAtEnd = new Set(cp.characters.filter((c) => c.present).map((c) => c.ref));
    for (const ref of first.participants) {
      if (cp.characters.length && !presentAtEnd.has(ref) && !noted) out.push({ code: 'absent_at_previous_ending', severity: 'warning', scene: 0, params: { id: nameOf(ref), episode: prev.episode_number } });
    }
  }

  const text = draft.scenes.map((s) => [s.title, s.narration, s.dialogue, s.action_prompt, s.continuity_notes].join(' ')).join(' ').toLowerCase();
  const untouched = bible.arcs.filter((a) => a.status === 'open' && !text.includes(a.title.toLowerCase()));
  if (ctx.episode_number && untouched.length) out.push({ code: 'open_threads_unaddressed', severity: 'warning', params: { threads: untouched.map((a) => a.title).join(', ') } });
  return out;
}
