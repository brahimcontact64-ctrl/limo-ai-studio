import { getSupabaseServer } from '@/lib/supabase/server';
import { canEditOrg, json, readJson, requireUser } from '@/lib/api/guard';
import { callRpc, isMissingFunction } from '@/lib/supabase/rpc';
import { socialError } from '@/lib/social/errors';
import { isUuid } from '@/lib/studio/validation';

export const dynamic = 'force-dynamic';

/**
 * add_mock {name}: connect a SIMULATED Page (no Facebook account, no token) to test the full flow.
 * disconnect {page_id}: remove a Page; its scheduled posts are withdrawn and refunded.
 * Real Facebook Pages need the Meta OAuth flow, which is not enabled (owner approval + Meta review).
 */
export async function POST(request: Request) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  const org = guard.ctx.org;
  if (!org || !canEditOrg(guard.ctx, org.organization_id)) return json({ error: 'not_authorized' }, 403);
  const read = await readJson(request, 2_000);
  if (!read.ok) return json({ error: read.error }, read.status);
  const b = (read.body ?? {}) as Record<string, unknown>;
  const supabase = await getSupabaseServer();
  const call =
    b.action === 'add_mock'
      ? callRpc<unknown>(supabase, 'add_mock_facebook_page', { p_organization_id: org.organization_id, p_name: typeof b.name === 'string' ? b.name.slice(0, 100) : '' })
      : b.action === 'disconnect' && typeof b.page_id === 'string' && isUuid(b.page_id)
        ? callRpc<unknown>(supabase, 'disconnect_facebook_page', { p_page_id: b.page_id })
        : null;
  if (!call) return json({ error: 'invalid_action' }, 400);
  const { data, error } = await call;
  if (isMissingFunction(error)) return json({ error: 'unavailable' }, 501);
  if (error) {
    const e = socialError(error.message);
    return json({ error: e.code }, e.status);
  }
  return json({ ok: true, result: data });
}
