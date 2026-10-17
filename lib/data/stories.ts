import 'server-only';
import type { ServerSupabase } from '../supabase/server';
import { untyped } from '../supabase/rpc';
import { normalizeBible, normalizeCheckpoint } from '../story/bible';
import type { EpisodeCheckpoint, ReviewReason, StoryBible } from '../story/types';

export interface SeriesSummary {
  id: string;
  title: string;
  language_code: string;
  continuity_mode: 'strict' | 'flexible';
  current_bible_version: number;
  updated_at: string;
  episodes: number;
  needs_review: number;
}

export interface EpisodeRow {
  id: string;
  episode_number: number;
  title: string | null;
  season_id: string | null;
  project_id: string | null;
  status: string;
  checkpoint: EpisodeCheckpoint;
  checkpoint_status: 'none' | 'draft' | 'approved';
  checkpoint_updated_at: string;
  approved_checkpoint: EpisodeCheckpoint | null;
  checkpoint_fingerprint: string | null;
  approved_at: string | null;
  based_on_episode_id: string | null;
  bible_version_used: number | null;
  review_status: 'ok' | 'needs_review';
  review_reasons: ReviewReason[];
  /** Linked studio project's script approval (Milestone 3). */
  script_status: 'draft' | 'approved' | 'changed' | null;
  scene_count: number;
}

export interface SeriesDetail {
  id: string;
  organization_id: string;
  title: string;
  language_code: string;
  continuity_mode: 'strict' | 'flexible';
  current_bible_version: number;
  bible: StoryBible;
  seasons: Array<{ id: string; season_number: number; title: string; summary: string | null }>;
  episodes: EpisodeRow[];
}

const EPISODE_COLUMNS =
  'id, episode_number, title, season_id, project_id, status, checkpoint, checkpoint_status, checkpoint_updated_at, approved_checkpoint, checkpoint_fingerprint, approved_at, based_on_episode_id, bible_version_used, review_status, review_reasons';

/** Series of one workspace (RLS: members). Returns null before migration 20261017160000. */
export async function listSeries(supabase: ServerSupabase, organizationId: string): Promise<SeriesSummary[] | null> {
  const db = untyped(supabase);
  const { data, error } = await db
    .from('content_series')
    .select('id, title, language_code, continuity_mode, current_bible_version, updated_at, content_episodes(review_status)')
    .eq('organization_id', organizationId)
    .neq('status', 'archived')
    .order('updated_at', { ascending: false });
  if (error) return null;
  return (data ?? []).map((s: Record<string, unknown>) => {
    const eps = (s.content_episodes as Array<{ review_status: string }>) ?? [];
    return {
      id: s.id as string,
      title: s.title as string,
      language_code: s.language_code as string,
      continuity_mode: s.continuity_mode === 'flexible' ? 'flexible' : 'strict',
      current_bible_version: s.current_bible_version as number,
      updated_at: s.updated_at as string,
      episodes: eps.length,
      needs_review: eps.filter((e) => e.review_status === 'needs_review').length,
    };
  });
}

export async function loadSeries(supabase: ServerSupabase, seriesId: string): Promise<SeriesDetail | null> {
  const db = untyped(supabase);
  const { data: s, error } = await db
    .from('content_series')
    .select('id, organization_id, title, language_code, continuity_mode, current_bible_version')
    .eq('id', seriesId)
    .maybeSingle();
  if (error || !s) return null;
  const [bibleRes, seasonsRes, episodesRes] = await Promise.all([
    db.from('story_bible_versions').select('bible').eq('series_id', seriesId).eq('version', s.current_bible_version).maybeSingle(),
    db.from('story_seasons').select('id, season_number, title, summary').eq('series_id', seriesId).order('season_number'),
    db.from('content_episodes').select(EPISODE_COLUMNS).eq('series_id', seriesId).order('episode_number'),
  ]);
  const episodes = (episodesRes.data ?? []) as Array<Record<string, unknown>>;
  const projectIds = episodes.map((e) => e.project_id).filter(Boolean) as string[];
  const projects = projectIds.length
    ? await db.from('studio_projects').select('id, script_status, project_scenes(count)').in('id', projectIds)
    : { data: [] };
  const byProject = new Map(((projects.data ?? []) as Array<{ id: string; script_status: string; project_scenes: Array<{ count: number }> }>).map((p) => [p.id, p]));
  return {
    id: s.id,
    organization_id: s.organization_id,
    title: s.title,
    language_code: s.language_code,
    continuity_mode: s.continuity_mode === 'flexible' ? 'flexible' : 'strict',
    current_bible_version: s.current_bible_version,
    bible: normalizeBible(bibleRes.data?.bible ?? {}),
    seasons: seasonsRes.data ?? [],
    episodes: episodes.map((e) => {
      const p = e.project_id ? byProject.get(e.project_id as string) : undefined;
      return {
        ...(e as unknown as EpisodeRow),
        checkpoint: normalizeCheckpoint(e.checkpoint),
        approved_checkpoint: e.approved_checkpoint ? normalizeCheckpoint(e.approved_checkpoint) : null,
        review_reasons: (Array.isArray(e.review_reasons) ? e.review_reasons : []) as ReviewReason[],
        script_status: (p?.script_status as EpisodeRow['script_status']) ?? null,
        scene_count: p?.project_scenes?.[0]?.count ?? 0,
      };
    }),
  };
}

export async function listBibleVersions(supabase: ServerSupabase, seriesId: string) {
  const { data } = await untyped(supabase)
    .from('story_bible_versions')
    .select('version, source, note, created_at, bible')
    .eq('series_id', seriesId)
    .order('version', { ascending: false })
    .limit(100);
  return ((data ?? []) as Array<{ version: number; source: string; note: string | null; created_at: string; bible: unknown }>).map((v) => ({ ...v, bible: normalizeBible(v.bible) }));
}

export async function listTimeline(supabase: ServerSupabase, seriesId: string) {
  const { data } = await untyped(supabase)
    .from('story_events')
    .select('id, episode_id, seq, text, characters, scenes')
    .eq('series_id', seriesId)
    .order('seq');
  return (data ?? []) as Array<{ id: string; episode_id: string; seq: number; text: string; characters: string[]; scenes: number[] }>;
}

export async function listCheckpointVersions(supabase: ServerSupabase, episodeId: string) {
  const { data } = await untyped(supabase)
    .from('story_checkpoint_versions')
    .select('version, checkpoint, created_at')
    .eq('episode_id', episodeId)
    .order('version', { ascending: false })
    .limit(50);
  return ((data ?? []) as Array<{ version: number; checkpoint: unknown; created_at: string }>).map((v) => ({ ...v, checkpoint: normalizeCheckpoint(v.checkpoint) }));
}
