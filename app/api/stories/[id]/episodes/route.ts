import { getSupabaseServer } from '@/lib/supabase/server';
import { json, readJson, requireUser } from '@/lib/api/guard';
import { allowRequest } from '@/lib/api/rateLimit';
import { callRpc, isMissingFunction } from '@/lib/supabase/rpc';
import { getCatalogs } from '@/lib/data/catalog';
import { loadSeries } from '@/lib/data/stories';
import { buildContinueDraft } from '@/lib/story/continue';
import { storyError } from '@/lib/story/errors';
import { toRpcArgsV2 } from '@/lib/studio/validation';
import { emptyProject, toSaveRequest } from '@/lib/studio/draft';
import { isUuid } from '@/lib/studio/validation';

export const dynamic = 'force-dynamic';

/**
 * Start episode 1 or "Continue Story". The draft is built (Mock AI, deterministic) from the latest
 * episode's APPROVED ending; the database refuses unless that episode is the latest, approved, reviewed
 * and its ending fingerprint is the one the user saw.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!isUuid(id)) return json({ error: 'not_found' }, 404);
  const read = await readJson(request, 4_000);
  if (!read.ok) return json({ error: read.error }, read.status);
  const b = (read.body ?? {}) as Record<string, unknown>;
  const supabase = await getSupabaseServer();
  if (!(await allowRequest(supabase, 'story_write', 120, 3600))) return json({ error: 'rate_limited' }, 429);

  const series = await loadSeries(supabase, id);
  if (!series) return json({ error: 'not_found' }, 404);
  const latest = series.episodes[series.episodes.length - 1] ?? null;
  const basedOn = typeof b.based_on_episode_id === 'string' && isUuid(b.based_on_episode_id) ? b.based_on_episode_id : null;
  if ((latest?.id ?? null) !== basedOn) return json({ error: 'not_latest' }, 409);
  if (latest && (latest.checkpoint_status !== 'approved' || !latest.approved_checkpoint)) return json({ error: 'previous_not_approved' }, 409);

  const draft = buildContinueDraft(series.bible, latest ? { number: latest.episode_number, checkpoint: latest.approved_checkpoint! } : null, (latest?.episode_number ?? 0) + 1);
  const catalogs = await getCatalogs();
  const contentType = catalogs.contentTypes.find((c) => c.code === 'storytelling')?.code ?? catalogs.contentTypes[0]?.code ?? 'storytelling';
  const preset = catalogs.exportPresets.some((p) => p.code === 'vertical_9_16') ? ['vertical_9_16'] : [];
  const project = emptyProject({ content_type: contentType, language_code: series.language_code, creation_mode: 'story', export_presets: preset });
  project.title = typeof b.title === 'string' && b.title.trim() ? b.title.trim().slice(0, 200) : draft.title;
  project.cast = draft.cast;
  project.scenes = draft.scenes;
  const args = toRpcArgsV2(series.organization_id, toSaveRequest(project));

  const { data, error } = await callRpc<{ episode_id: string; project_id: string; episode_number: number }>(supabase, 'create_story_episode', {
    p_series_id: id,
    p_season_id: typeof b.season_id === 'string' && isUuid(b.season_id) ? b.season_id : null,
    p_based_on_episode_id: basedOn,
    p_based_on_fingerprint: typeof b.based_on_fingerprint === 'string' ? b.based_on_fingerprint : null,
    p_title: project.title,
    p_content_type: contentType,
    p_project_cast: args.p_project_cast,
    p_scenes: args.p_scenes,
    p_export_presets: args.p_export_presets,
  });
  if (isMissingFunction(error)) return json({ error: 'unavailable' }, 501);
  if (error || !data) {
    const e = storyError(error?.message);
    return json({ error: e.code, detail: e.detail }, e.status);
  }
  return json(data, 201);
}
