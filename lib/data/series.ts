import type { SupabaseClient } from '@supabase/supabase-js';
import type { SeriesContext } from '../story/continuity';
import { normalizeBible, normalizeCheckpoint } from '../story/bible';
import { untyped } from '../supabase/rpc';

/**
 * Story context for continuity checks of a studio project that belongs to a series: the current Story
 * Bible and the APPROVED ending of the episode before this project's episode. RLS limits it to members.
 * Returns null before migration 20261017160000 or when the series is not visible.
 */
export async function loadSeriesContext(supabase: SupabaseClient<any, any, any>, seriesId: string, projectId: string | null): Promise<SeriesContext | null> {
  const db = untyped(supabase);
  const { data: s, error } = await db.from('content_series').select('id, title, continuity_mode, current_bible_version').eq('id', seriesId).maybeSingle();
  if (error || !s) return null;
  const { data: bibleRow } = await db.from('story_bible_versions').select('bible').eq('series_id', seriesId).eq('version', s.current_bible_version).maybeSingle();
  let episodeNumber: number | null = null;
  if (projectId) {
    const { data: ep } = await db.from('content_episodes').select('episode_number').eq('project_id', projectId).maybeSingle();
    episodeNumber = (ep as { episode_number?: number } | null)?.episode_number ?? null;
  }
  let previous: SeriesContext['previous'] = null;
  if (episodeNumber && episodeNumber > 1) {
    const { data: prev } = await db
      .from('content_episodes')
      .select('episode_number, approved_checkpoint')
      .eq('series_id', seriesId)
      .eq('episode_number', episodeNumber - 1)
      .eq('checkpoint_status', 'approved')
      .maybeSingle();
    const p = prev as { episode_number: number; approved_checkpoint: unknown } | null;
    if (p?.approved_checkpoint) previous = { episode_number: p.episode_number, checkpoint: normalizeCheckpoint(p.approved_checkpoint) };
  }
  return {
    series_id: s.id,
    title: s.title,
    continuity_mode: s.continuity_mode === 'flexible' ? 'flexible' : 'strict',
    bible: normalizeBible(bibleRow?.bible ?? {}),
    bible_version: s.current_bible_version ?? 0,
    episode_number: episodeNumber,
    previous,
  };
}
