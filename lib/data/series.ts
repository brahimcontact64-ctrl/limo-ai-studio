import type { SupabaseClient } from '@supabase/supabase-js';
import type { SeriesContext } from '../story/continuity';

/** Series data used for edit-time continuity checks. RLS limits it to the caller's workspaces. */
export async function loadSeriesContext(supabase: SupabaseClient<any, any, any>, seriesId: string): Promise<SeriesContext | null> {
  const { data: s } = await supabase.from('content_series').select('id, title, continuity_mode, cast_bible, story_rules').eq('id', seriesId).maybeSingle();
  if (!s) return null;
  // The latest finished episode is the one this edit continues from.
  const { data: eps } = await supabase
    .from('content_episodes')
    .select('episode_number, ending_hook, last_scene_state, status')
    .eq('series_id', seriesId)
    .in('status', ['generated', 'approved', 'published'])
    .order('episode_number', { ascending: false })
    .limit(1);
  const prev = eps?.[0];
  return {
    series_id: s.id,
    title: s.title,
    continuity_mode: s.continuity_mode === 'flexible' ? 'flexible' : 'strict',
    cast_bible: s.cast_bible,
    story_rules: s.story_rules,
    previous: prev ? { episode_number: prev.episode_number, ending_hook: prev.ending_hook, last_scene_state: prev.last_scene_state } : null,
  };
}
