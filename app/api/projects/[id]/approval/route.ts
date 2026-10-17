import { getSupabaseServer } from '@/lib/supabase/server';
import { json, readJson, requireUser } from '@/lib/api/guard';
import { isUuid, mapSaveError } from '@/lib/studio/validation';
import { callRpc, isMissingFunction } from '@/lib/supabase/rpc';

export const dynamic = 'force-dynamic';

/** Approve the current script (its snapshot becomes the generation source) or remove the approval. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!isUuid(id)) return json({ error: 'not_found' }, 404);
  const read = await readJson(request, 2_000);
  if (!read.ok) return json({ error: read.error }, read.status);
  const body = (read.body ?? {}) as { action?: unknown; base_updated_at?: unknown };
  const supabase = await getSupabaseServer();
  const base = typeof body.base_updated_at === 'string' ? body.base_updated_at : null;
  const res =
    body.action === 'approve'
      ? await callRpc<Record<string, unknown>>(supabase, 'approve_project_script', { p_project_id: id, p_base_updated_at: base })
      : body.action === 'remove'
        ? await callRpc<Record<string, unknown>>(supabase, 'remove_script_approval', { p_project_id: id })
        : null;
  if (!res) return json({ error: 'invalid_action' }, 400);
  if (isMissingFunction(res.error)) return json({ error: 'unavailable' }, 501);
  if (res.error || !res.data) {
    const m = res.error?.message ?? '';
    if (m.includes('Project not found')) return json({ error: 'not_found' }, 404);
    if (m.includes('no scenes')) return json({ error: 'no_scenes' }, 422);
    const code = mapSaveError(m);
    return json({ error: code }, code === 'conflict' || code === 'not_editable' ? 409 : 422);
  }
  return json(res.data);
}
