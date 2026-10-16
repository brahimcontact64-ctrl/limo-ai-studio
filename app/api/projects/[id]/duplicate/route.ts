import type { Database } from '@/lib/supabase/database.types';
import { getSupabaseServer } from '@/lib/supabase/server';
import { loadProject } from '@/lib/data/projects';
import { canEditOrg, json, requireUser } from '@/lib/api/guard';
import { mapSaveError, isUuid, toRpcArgs } from '@/lib/studio/validation';
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

  const { data, error } = await supabase.rpc('save_studio_project', toRpcArgs(project.organization_id, req) as unknown as SaveRpcArgs);
  if (error || !data) return json({ error: mapSaveError(error?.message) }, 422);
  return json({ project_id: data }, 201);
}
