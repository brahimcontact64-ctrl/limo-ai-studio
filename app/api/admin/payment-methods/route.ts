import { getSupabaseServer } from '@/lib/supabase/server';
import { callRpc, isMissingFunction } from '@/lib/supabase/rpc';
import { json, readJson, requireUser } from '@/lib/api/guard';
import { isPaymentMethod } from '@/lib/billing/payments';

export const dynamic = 'force-dynamic';

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Platform admin edits the payment destination shown to customers (admin_update_payment_method). */
export async function POST(request: Request) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  if (!guard.ctx.isPlatformAdmin) return json({ error: 'not_found' }, 404);

  const read = await readJson(request, 8_000);
  if (!read.ok) return json({ error: read.error }, read.status);
  const b = read.body as Record<string, unknown>;
  if (!isPaymentMethod(b.method)) return json({ error: 'invalid_request' }, 400);

  const supabase = await getSupabaseServer();
  const { error } = await callRpc(supabase, 'admin_update_payment_method', {
    p_method: b.method,
    p_enabled: b.enabled === true,
    p_display_name: str(b.display_name, 80) || null,
    p_account_holder: str(b.account_holder, 120),
    p_account_number: str(b.account_number, 120),
    p_ccp_key: str(b.ccp_key, 40),
    p_redotpay_uid: str(b.redotpay_uid, 120),
    p_instructions: str(b.instructions, 2000),
  });
  if (error) {
    if (isMissingFunction(error)) return json({ error: 'unavailable' }, 501);
    return json({ error: 'unknown' }, 422);
  }
  return json({ ok: true });
}
