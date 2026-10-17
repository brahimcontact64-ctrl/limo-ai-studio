import { getSupabaseServer } from '@/lib/supabase/server';
import { json, readJson, requireUser } from '@/lib/api/guard';
import { allowRequest } from '@/lib/api/rateLimit';
import { callRpc, isMissingFunction, untyped } from '@/lib/supabase/rpc';
import { loadSeries } from '@/lib/data/stories';
import { normalizeCheckpoint, validateCheckpoint } from '@/lib/story/bible';
import { suggestCheckpoint } from '@/lib/story/continue';
import { storyError } from '@/lib/story/errors';
import { isUuid } from '@/lib/studio/validation';
import { projectFromDb, type DbSceneRow } from '@/lib/studio/draft';

export const dynamic = 'force-dynamic';

/**
 * Episode actions:
 * - suggest: Mock AI ending checkpoint from this episode's own script (not saved),
 * - checkpoint: save the ending (versioned; refused once the episode is approved),
 * - approve: needs the approved script, a valid ending and settled earlier episodes,
 * - reopen: makes the ending editable again and flags later episodes,
 * - resolve: the writer confirms a flagged episode still fits.
 */
export async function POST(request: Request, { params }: { params: Promise<{ episodeId: string }> }) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  const { episodeId } = await params;
  if (!isUuid(episodeId)) return json({ error: 'not_found' }, 404);
  const read = await readJson(request, 200_000);
  if (!read.ok) return json({ error: read.error }, read.status);
  const b = (read.body ?? {}) as Record<string, unknown>;
  const supabase = await getSupabaseServer();
  const db = untyped(supabase);
  if (b.action !== 'suggest' && !(await allowRequest(supabase, 'story_write', 120, 3600))) return json({ error: 'rate_limited' }, 429);

  const { data: ep } = await db.from('content_episodes').select('id, series_id, episode_number, project_id').eq('id', episodeId).maybeSingle();
  if (!ep) return json({ error: 'not_found' }, 404);

  if (b.action === 'suggest' || b.action === 'checkpoint' || b.action === 'approve') {
    const series = await loadSeries(supabase, ep.series_id);
    if (!series) return json({ error: 'not_found' }, 404);
    const episode = series.episodes.find((e) => e.id === episodeId)!;
    const previous = series.episodes.find((e) => e.episode_number === episode.episode_number - 1);
    if (b.action === 'suggest') {
      const { data: rows } = await db.from('project_scenes').select('*').eq('project_id', ep.project_id).order('scene_number');
      const draft = projectFromDb({ id: ep.project_id, title: '', content_type: '', language_code: '', brief: '', goal: '', visual_style: '', project_cast: [] }, (rows ?? []) as DbSceneRow[], []);
      return json({ checkpoint: suggestCheckpoint(series.bible, draft.scenes, previous?.approved_checkpoint ?? null), label: 'Mock AI' });
    }
    if (b.action === 'approve') {
      const issues = validateCheckpoint(episode.checkpoint, series.bible, episode.scene_count);
      if (issues.length) return json({ error: 'invalid_ending', issues }, 422);
      const res = await callRpc<{ fingerprint: string; bible_version: number }>(supabase, 'approve_story_episode', { p_episode_id: episodeId, p_bible_version: b.bible_version });
      return respond(res);
    }
    const checkpoint = normalizeCheckpoint(b.checkpoint);
    const res = await callRpc<string>(supabase, 'save_episode_checkpoint', {
      p_episode_id: episodeId,
      p_checkpoint: checkpoint,
      p_base_updated_at: typeof b.base_updated_at === 'string' ? b.base_updated_at : null,
    });
    if (isMissingFunction(res.error)) return json({ error: 'unavailable' }, 501);
    if (res.error || !res.data) return fail(res.error?.message);
    // Drafts may be incomplete; the issues are returned so the editor can show them.
    return json({ checkpoint_updated_at: res.data, issues: validateCheckpoint(checkpoint, series.bible, episode.scene_count) });
  }
  if (b.action === 'reopen') return respond(await callRpc<null>(supabase, 'reopen_story_episode', { p_episode_id: episodeId }));
  if (b.action === 'resolve') {
    return respond(await callRpc<null>(supabase, 'resolve_episode_review', { p_episode_id: episodeId, p_note: typeof b.note === 'string' ? b.note.slice(0, 500) : '' }));
  }
  return json({ error: 'invalid_action' }, 400);
}

function fail(message?: string) {
  const e = storyError(message);
  return json({ error: e.code, detail: e.detail }, e.status);
}

function respond(res: { data: unknown; error: { code?: string; message: string } | null }) {
  if (isMissingFunction(res.error)) return json({ error: 'unavailable' }, 501);
  if (res.error) return fail(res.error.message);
  return json({ ok: true, result: res.data ?? null });
}
