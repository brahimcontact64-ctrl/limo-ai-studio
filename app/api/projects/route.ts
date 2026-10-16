import type { Database } from '@/lib/supabase/database.types';
import { getSupabaseServer } from '@/lib/supabase/server';
import { getCatalogs } from '@/lib/data/catalog';
import { canEditOrg, json, readJson, requireUser } from '@/lib/api/guard';
import { allowRequest } from '@/lib/api/rateLimit';
import { hasErrors, mapSaveError, parseSaveRequest, toRpcArgs, toRpcArgsV2, validateDraft } from '@/lib/studio/validation';
import { callRpc, isMissingFunction } from '@/lib/supabase/rpc';

export const dynamic = 'force-dynamic';

// Generated types mark SQL arguments as non-null; save_studio_project accepts NULL for p_project_id/p_series_id.
type SaveRpcArgs = Database['public']['Functions']['save_studio_project']['Args'];

/**
 * Create (project_id = null) or update a studio project through public.save_studio_project.
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
  if (req.project_id) {
    const { data: existing } = await supabase.from('studio_projects').select('organization_id').eq('id', req.project_id).maybeSingle();
    if (!existing) return json({ error: 'not_found' }, 404);
    organizationId = existing.organization_id;
  } else {
    if (!ctx.org) return json({ error: 'no_workspace' }, 403);
    organizationId = ctx.org.organization_id;
  }
  if (!canEditOrg(ctx, organizationId)) return json({ error: 'not_authorized' }, 403);

  // v2 (migration 20261017100000) supports creation modes, character-free projects and scene media.
  let { data, error } = await callRpc<string>(supabase, 'save_studio_project_v2', toRpcArgsV2(organizationId, req));
  if (isMissingFunction(error)) {
    const usesV2 = req.creation_mode !== 'story' || req.scenes.some((s) => s.narration || s.visual_prompt || s.asset_ids.length > 0);
    if (usesV2) return json({ error: 'unavailable' }, 501);
    ({ data, error } = await supabase.rpc('save_studio_project', toRpcArgs(organizationId, req) as unknown as SaveRpcArgs));
  }
  if (error || !data) {
    const code = mapSaveError(error?.message);
    const status = code === 'subscription_required' || code === 'not_authorized' ? 403 : code === 'not_editable' ? 409 : 422;
    if (code === 'unknown') console.error('save_studio_project failed', { code: error?.code, message: error?.message });
    return json({ error: code }, status);
  }

  const { data: saved } = await supabase.from('studio_projects').select('updated_at').eq('id', data).maybeSingle();
  return json({ project_id: data, updated_at: saved?.updated_at ?? new Date().toISOString() }, req.project_id ? 200 : 201);
}
