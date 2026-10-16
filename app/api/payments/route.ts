import { getSupabaseServer } from '@/lib/supabase/server';
import { callRpc, isMissingFunction } from '@/lib/supabase/rpc';
import { json, readJson, requireUser } from '@/lib/api/guard';
import { isPaymentMethod, isValidReceiptPath, mapPaymentError } from '@/lib/billing/payments';

export const dynamic = 'force-dynamic';

/**
 * Customer payment claim for manual activation. The amount is priced in the database
 * (submit_payment), the workspace is the caller's verified active workspace, and only
 * owners/admins may submit (checked here and again in the database).
 */
export async function POST(request: Request) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  const { ctx } = guard;
  const org = ctx.org;
  if (!org || !['owner', 'admin'].includes(org.role)) return json({ error: 'not_authorized' }, 403);

  const read = await readJson(request, 8_000);
  if (!read.ok) return json({ error: read.error }, read.status);
  const b = read.body as Record<string, unknown>;
  const purchaseType = b.purchase_type;
  const itemCode = typeof b.item_code === 'string' ? b.item_code.slice(0, 60) : '';
  const reference = typeof b.transaction_ref === 'string' ? b.transaction_ref.trim() : '';
  const receiptPath = typeof b.receipt_path === 'string' && b.receipt_path ? b.receipt_path : null;

  if (purchaseType !== 'subscription' && purchaseType !== 'addon') return json({ error: 'invalid_item' }, 400);
  if (!itemCode || !isPaymentMethod(b.method)) return json({ error: 'invalid_item' }, 400);
  if (reference.length < 3 || reference.length > 200) return json({ error: 'invalid_reference' }, 400);
  if (receiptPath && !isValidReceiptPath(receiptPath, org.organization_id)) return json({ error: 'receipt_invalid' }, 400);

  const supabase = await getSupabaseServer();
  const { data, error } = await callRpc<string>(supabase, 'submit_payment', {
    p_organization_id: org.organization_id,
    p_purchase_type: purchaseType,
    p_item_code: itemCode,
    p_method: b.method,
    p_transaction_ref: reference,
    p_receipt_path: receiptPath,
  });
  if (error) {
    if (isMissingFunction(error)) return json({ error: 'unavailable' }, 501);
    const code = mapPaymentError(error.message);
    return json({ error: code }, code === 'not_authorized' ? 403 : code === 'too_many_pending' || code === 'rate_limited' ? 429 : 422);
  }
  return json({ payment_id: data }, 201);
}
