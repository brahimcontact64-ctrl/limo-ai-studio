import { getSupabaseServer } from '@/lib/supabase/server';
import { callRpc, isMissingFunction } from '@/lib/supabase/rpc';
import { json, readJson, requireUser } from '@/lib/api/guard';
import { isUuid } from '@/lib/studio/validation';

export const dynamic = 'force-dynamic';

/** MFA platform admin changes a workspace subscription (admin_set_subscription; reason required, audited). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  if (!guard.ctx.isPlatformAdmin) return json({ error: 'not_found' }, 404);
  const { id } = await params;
  if (!isUuid(id)) return json({ error: 'not_found' }, 404);

  const read = await readJson(request, 4_000);
  if (!read.ok) return json({ error: read.error }, read.status);
  const b = read.body as Record<string, unknown>;
  const reason = typeof b.reason === 'string' ? b.reason.trim().slice(0, 500) : '';
  const days = b.days === null || b.days === undefined || b.days === '' ? null : Number(b.days);
  if (reason.length < 5) return json({ error: 'reason_required' }, 400);
  if (days !== null && (!Number.isInteger(days) || days < 1 || days > 366)) return json({ error: 'invalid_days' }, 400);
  if (typeof b.plan_code !== 'string' || !['active', 'past_due', 'canceled'].includes(String(b.status))) return json({ error: 'invalid_request' }, 400);

  const supabase = await getSupabaseServer();
  const { error } = await callRpc(supabase, 'admin_set_subscription', {
    p_organization_id: id,
    p_plan_code: b.plan_code,
    p_status: b.status,
    p_days: days,
    p_reason: reason,
  });
  if (error) {
    if (isMissingFunction(error)) return json({ error: 'unavailable' }, 501);
    if (/two-factor/i.test(error.message)) return json({ error: 'mfa_required' }, 403);
    return json({ error: 'unknown' }, 422);
  }
  return json({ ok: true });
}
