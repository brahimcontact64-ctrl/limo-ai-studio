import { getSupabaseServer } from '@/lib/supabase/server';
import { canEditOrg, json, readJson, requireUser } from '@/lib/api/guard';
import { callRpc, isMissingFunction } from '@/lib/supabase/rpc';
import { socialError } from '@/lib/social/errors';

export const dynamic = 'force-dynamic';

/** Emergency pause / resume of all publishing in the active workspace (also pauses automation). */
export async function POST(request: Request) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  const org = guard.ctx.org;
  if (!org || !canEditOrg(guard.ctx, org.organization_id)) return json({ error: 'not_authorized' }, 403);
  const read = await readJson(request, 2_000);
  if (!read.ok) return json({ error: read.error }, read.status);
  const b = (read.body ?? {}) as Record<string, unknown>;
  if (typeof b.paused !== 'boolean') return json({ error: 'invalid_request' }, 400);
  const { data, error } = await callRpc<unknown>(await getSupabaseServer(), 'set_publishing_paused', {
    p_organization_id: org.organization_id,
    p_paused: b.paused,
    p_reason: typeof b.reason === 'string' ? b.reason.slice(0, 300) : null,
  });
  if (isMissingFunction(error)) return json({ error: 'unavailable' }, 501);
  if (error) {
    const e = socialError(error.message);
    return json({ error: e.code }, e.status);
  }
  return json(data);
}
