import { getSupabaseServer } from '@/lib/supabase/server';
import { callRpc, isMissingFunction } from '@/lib/supabase/rpc';
import { json, readJson, requireUser } from '@/lib/api/guard';
import { LOCKED_FLAGS } from '@/lib/admin/flags';

export const dynamic = 'force-dynamic';

/** MFA platform admin toggles a feature flag. Paid/live flags are locked until the owner approves providers. */
export async function POST(request: Request) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  if (!guard.ctx.isPlatformAdmin) return json({ error: 'not_found' }, 404);
  const read = await readJson(request, 1_000);
  if (!read.ok) return json({ error: read.error }, read.status);
  const b = read.body as { key?: unknown; enabled?: unknown };
  if (typeof b.key !== 'string' || typeof b.enabled !== 'boolean') return json({ error: 'invalid_request' }, 400);
  if (LOCKED_FLAGS.has(b.key)) return json({ error: 'locked' }, 403);

  const supabase = await getSupabaseServer();
  const { error } = await callRpc(supabase, 'admin_set_feature_flag', { p_key: b.key, p_enabled: b.enabled });
  if (error) return json({ error: isMissingFunction(error) ? 'unavailable' : /two-factor/i.test(error.message) ? 'mfa_required' : 'unknown' }, isMissingFunction(error) ? 501 : 422);
  return json({ ok: true });
}
