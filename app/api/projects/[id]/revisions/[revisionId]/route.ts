import { getSupabaseServer } from '@/lib/supabase/server';
import { json, readJson, requireUser } from '@/lib/api/guard';
import { allowRequest } from '@/lib/api/rateLimit';
import { isUuid, mapSaveError } from '@/lib/studio/validation';
import { callRpc, isMissingFunction, untyped } from '@/lib/supabase/rpc';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string; revisionId: string }> };

/** One revision with its snapshot (for comparison). RLS limits it to workspace members. */
export async function GET(request: Request, { params }: Params) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  const { id, revisionId } = await params;
  if (!isUuid(id) || !isUuid(revisionId)) return json({ error: 'not_found' }, 404);
  const supabase = await getSupabaseServer();
  const { data } = await untyped(supabase)
    .from('project_revisions')
    .select('id, revision_number, source, label, created_at, snapshot')
    .eq('id', revisionId)
    .eq('project_id', id)
    .maybeSingle();
  if (!data) return json({ error: 'not_found' }, 404);
  return json({ revision: data });
}

/** Restore: saves the snapshot as a new revision. History is never rewritten. */
export async function POST(request: Request, { params }: Params) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  const { id, revisionId } = await params;
  if (!isUuid(id) || !isUuid(revisionId)) return json({ error: 'not_found' }, 404);
  const read = await readJson(request, 4_000);
  if (!read.ok) return json({ error: read.error }, read.status);
  const body = (read.body ?? {}) as { base_updated_at?: unknown; remove_approval?: unknown };
  const supabase = await getSupabaseServer();
  if (!(await allowRequest(supabase, 'save_project', 60, 60))) return json({ error: 'rate_limited' }, 429);
  const { data: rev } = await untyped(supabase).from('project_revisions').select('id').eq('id', revisionId).eq('project_id', id).maybeSingle();
  if (!rev) return json({ error: 'not_found' }, 404);
  const { data, error } = await callRpc<Record<string, unknown>>(supabase, 'restore_project_revision', {
    p_revision_id: revisionId,
    p_base_updated_at: typeof body.base_updated_at === 'string' ? body.base_updated_at : null,
    p_remove_approval: body.remove_approval === true,
  });
  if (isMissingFunction(error)) return json({ error: 'unavailable' }, 501);
  if (error || !data) {
    const code = error?.message.includes('Revision not found') ? 'not_found' : mapSaveError(error?.message);
    return json({ error: code }, code === 'conflict' || code === 'script_approved' ? 409 : code === 'not_found' ? 404 : 422);
  }
  return json(data);
}
