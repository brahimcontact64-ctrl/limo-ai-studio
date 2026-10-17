import type { Database } from '@/lib/supabase/database.types';
import { getSupabaseServer } from '@/lib/supabase/server';
import { loadProject } from '@/lib/data/projects';
import { canEditOrg, json, requireUser } from '@/lib/api/guard';
import { mapSaveError, isUuid, toRpcArgs, toRpcArgsV2 } from '@/lib/studio/validation';
import { callRpc, isMissingFunction } from '@/lib/supabase/rpc';
import { toSaveRequest } from '@/lib/studio/draft';
import { LIMITS } from '@/lib/studio/limits';
import { fmt } from '@/lib/i18n/config';
import { getI18n } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';

// Generated types mark SQL arguments as non-null; save_studio_project accepts NULL for p_project_id/p_series_id.
type SaveRpcArgs = Database['public']['Functions']['save_studio_project']['Args'];

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!isUuid(id)) return json({ error: 'not_found' }, 404);

  const supabase = await getSupabaseServer();
  const project = await loadProject(supabase, id);
  if (!project) return json({ error: 'not_found' }, 404);
  if (!canEditOrg(guard.ctx, project.organization_id)) return json({ error: 'not_authorized' }, 403);

  const { t } = await getI18n();
  const req = toSaveRequest({ ...project.draft, id: null });
  req.title = fmt(t.projects.copyOf, { title: project.draft.title }).slice(0, LIMITS.titleMax);

  const args = toRpcArgsV2(project.organization_id, req);
  // v3 records the copy's first revision; v2/v1 while migration 20261017120000 is not applied.
  const v3 = await callRpc<{ project_id: string }>(supabase, 'save_studio_project_v3', {
    ...args, p_base_updated_at: null, p_revision_source: 'manual', p_revision_label: null, p_remove_approval: false,
  });
  if (!isMissingFunction(v3.error)) {
    if (v3.error || !v3.data) return json({ error: mapSaveError(v3.error?.message) }, 422);
    return json({ project_id: v3.data.project_id }, 201);
  }
  let { data, error } = await callRpc<string>(supabase, 'save_studio_project_v2', args);
  if (isMissingFunction(error)) ({ data, error } = await supabase.rpc('save_studio_project', toRpcArgs(project.organization_id, req) as unknown as SaveRpcArgs));
  if (error || !data) return json({ error: mapSaveError(error?.message) }, 422);
  return json({ project_id: data }, 201);
}
