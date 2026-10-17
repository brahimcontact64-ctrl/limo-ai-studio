import { getSupabaseServer } from '@/lib/supabase/server';
import { json, readJson, requireUser } from '@/lib/api/guard';
import { allowRequest } from '@/lib/api/rateLimit';
import { callRpc, isMissingFunction } from '@/lib/supabase/rpc';
import { imageError } from '@/lib/images/errors';
import { isUuid } from '@/lib/studio/validation';

export const dynamic = 'force-dynamic';

/** approve | unapprove | restore (a revision, saved as a new revision). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!isUuid(id)) return json({ error: 'not_found' }, 404);
  const read = await readJson(request, 4_000);
  if (!read.ok) return json({ error: read.error }, read.status);
  const b = (read.body ?? {}) as Record<string, unknown>;
  const base = typeof b.base_updated_at === 'string' ? b.base_updated_at : null;
  const supabase = await getSupabaseServer();
  if (!(await allowRequest(supabase, 'image_save', 240, 3600))) return json({ error: 'rate_limited' }, 429);
  const call =
    b.action === 'approve'
      ? callRpc<Record<string, unknown>>(supabase, 'approve_image_project', { p_project_id: id, p_base_updated_at: base })
      : b.action === 'unapprove'
        ? callRpc<Record<string, unknown>>(supabase, 'remove_image_approval', { p_project_id: id })
        : b.action === 'restore' && typeof b.revision_id === 'string' && isUuid(b.revision_id)
          ? callRpc<Record<string, unknown>>(supabase, 'restore_image_revision', { p_revision_id: b.revision_id, p_base_updated_at: base })
          : null;
  if (!call) return json({ error: 'invalid_action' }, 400);
  const { data, error } = await call;
  if (isMissingFunction(error)) return json({ error: 'unavailable' }, 501);
  if (error || !data) {
    const e = imageError(error?.message);
    return json({ error: e.code }, e.status);
  }
  return json(data);
}
