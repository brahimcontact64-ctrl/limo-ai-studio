import type { Database } from '@/lib/supabase/database.types';
import { getSupabaseServer } from '@/lib/supabase/server';
import { getCatalogs } from '@/lib/data/catalog';
import { canEditOrg, json, readJson, requireUser } from '@/lib/api/guard';
import { allowRequest } from '@/lib/api/rateLimit';
import { hasErrors, mapSaveError, parseSaveRequest, toRpcArgs, toRpcArgsV2, validateDraft } from '@/lib/studio/validation';
import { callRpc, isMissingFunction } from '@/lib/supabase/rpc';
import { loadSeriesContext } from '@/lib/data/series';
import { checkContinuity } from '@/lib/story/continuity';
import { draftFromSnapshot } from '@/lib/studio/draft';

export const dynamic = 'force-dynamic';

// Generated types mark SQL arguments as non-null; save_studio_project accepts NULL for p_project_id/p_series_id.
type SaveRpcArgs = Database['public']['Functions']['save_studio_project']['Args'];

type SaveV3Result = { project_id: string; updated_at: string; script_status: string; revision_number: number };
const SOURCES = new Set(['manual', 'autosave', 'mock_ai']);

/** Revision options sent next to the project payload (Milestone 3). */
function saveOptions(body: unknown) {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const base = typeof b.base_updated_at === 'string' && !Number.isNaN(Date.parse(b.base_updated_at)) ? b.base_updated_at : null;
  return {
    base_updated_at: base,
    revision_source: typeof b.revision_source === 'string' && SOURCES.has(b.revision_source) ? b.revision_source : 'manual',
    revision_label: typeof b.revision_label === 'string' ? b.revision_label.slice(0, 200) : null,
    remove_approval: b.remove_approval === true,
  };
}

/**
 * Create (project_id = null) or update a studio project (save_studio_project_v3, falling back to v2/v1
 * while the newer migrations are not applied).
 * The organization is never taken from the request body:
 * - update: read from the existing project row (visible only through RLS membership),
 * - create: the caller's active workspace, verified against their memberships.
 */
export async function POST(request: Request) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  const { ctx } = guard;

  const read = await readJson(request, 256_000);
  if (!read.ok) return json({ error: read.error }, read.status);
  const req = parseSaveRequest(read.body);
  if (!req) return json({ error: 'invalid_request' }, 400);

  const catalogs = await getCatalogs();
  if (!catalogs.ok) return json({ error: 'catalog_unavailable' }, 503);
  const issues = validateDraft(req, {
    contentTypes: new Set(catalogs.contentTypes.map((c) => c.code)),
    languages: new Set(catalogs.languages.map((l) => l.code)),
    exportPresets: new Set(catalogs.exportPresets.map((p) => p.code)),
  });
  if (hasErrors(issues)) return json({ error: 'validation', issues: issues.filter((i) => i.severity === 'error') }, 400);

  const supabase = await getSupabaseServer();
  if (!(await allowRequest(supabase, 'save_project', 60, 60))) return json({ error: 'rate_limited' }, 429);
  let organizationId: string;
  let seriesId: string | null = null;
  if (req.project_id) {
    const { data: existing } = await supabase.from('studio_projects').select('organization_id, series_id').eq('id', req.project_id).maybeSingle();
    if (!existing) return json({ error: 'not_found' }, 404);
    organizationId = existing.organization_id;
    seriesId = existing.series_id;
  } else {
    if (!ctx.org) return json({ error: 'no_workspace' }, 403);
    organizationId = ctx.org.organization_id;
  }
  if (!canEditOrg(ctx, organizationId)) return json({ error: 'not_authorized' }, 403);

  // Serialized stories: edits must not contradict the series (full Story Engine in Milestone 5).
  if (seriesId) {
    const series = await loadSeriesContext(supabase, seriesId);
    const continuity = series ? checkContinuity(draftFromSnapshot(req.project_id ?? '', { ...req, project_cast: req.cast.map((id) => ({ id })), scenes: req.scenes.map((sc, i) => ({ ...sc, scene_number: i + 1 })) }), series) : [];
    const blocking = continuity.filter((i) => i.severity === 'error');
    if (blocking.length) return json({ error: 'continuity', issues: blocking }, 400);
  }

  // v3 (migration 20261017120000): concurrency check, revision history, approval protection.
  const opts = saveOptions(read.body);
  const v2Args = toRpcArgsV2(organizationId, req);
  const v3 = await callRpc<SaveV3Result>(supabase, 'save_studio_project_v3', {
    ...v2Args,
    p_base_updated_at: opts.base_updated_at,
    p_revision_source: opts.revision_source,
    p_revision_label: opts.revision_label,
    p_remove_approval: opts.remove_approval,
  });
  if (!isMissingFunction(v3.error)) {
    if (v3.error || !v3.data) return saveFailure(v3.error?.message);
    return json(v3.data, req.project_id ? 200 : 201);
  }

  // v2 (migration 20261017100000) supports creation modes, character-free projects and scene media.
  let { data, error } = await callRpc<string>(supabase, 'save_studio_project_v2', v2Args);
  if (isMissingFunction(error)) {
    const usesV2 = req.creation_mode !== 'story' || req.scenes.some((s) => s.narration || s.visual_prompt || s.asset_ids.length > 0);
    if (usesV2) return json({ error: 'unavailable' }, 501);
    ({ data, error } = await supabase.rpc('save_studio_project', toRpcArgs(organizationId, req) as unknown as SaveRpcArgs));
  }
  if (error || !data) return saveFailure(error?.message);

  const { data: saved } = await supabase.from('studio_projects').select('updated_at').eq('id', data).maybeSingle();
  return json({ project_id: data, updated_at: saved?.updated_at ?? new Date().toISOString() }, req.project_id ? 200 : 201);
}

function saveFailure(message: string | undefined) {
  const code = mapSaveError(message);
  const status = code === 'subscription_required' || code === 'not_authorized' ? 403 : code === 'not_editable' || code === 'conflict' || code === 'script_approved' ? 409 : 422;
  if (code === 'unknown') console.error('save_studio_project failed', { message });
  return json({ error: code }, status);
}
