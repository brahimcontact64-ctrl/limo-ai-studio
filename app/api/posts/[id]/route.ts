import { getSupabaseServer } from '@/lib/supabase/server';
import { json, readJson, requireUser } from '@/lib/api/guard';
import { callRpc, isMissingFunction } from '@/lib/supabase/rpc';
import { imageError } from '@/lib/images/errors';
import { isUuid } from '@/lib/studio/validation';

export const dynamic = 'force-dynamic';

/** approve | unapprove a post. Approval means "ready for the publishing step" (not connected yet). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!isUuid(id)) return json({ error: 'not_found' }, 404);
  const read = await readJson(request, 2_000);
  if (!read.ok) return json({ error: read.error }, read.status);
  const b = (read.body ?? {}) as Record<string, unknown>;
  if (b.action !== 'approve' && b.action !== 'unapprove') return json({ error: 'invalid_action' }, 400);
  const supabase = await getSupabaseServer();
  const { data, error } = await callRpc<Record<string, unknown>>(supabase, 'set_social_post_approval', {
    p_post_id: id,
    p_approve: b.action === 'approve',
    p_base_updated_at: typeof b.base_updated_at === 'string' ? b.base_updated_at : null,
  });
  if (isMissingFunction(error)) return json({ error: 'unavailable' }, 501);
  if (error || !data) {
    const e = imageError(error?.message);
    return json({ error: e.code }, e.status);
  }
  return json(data);
}
