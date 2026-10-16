import { getSupabaseServer } from '@/lib/supabase/server';
import { callRpc, isMissingFunction } from '@/lib/supabase/rpc';
import { json, readJson, requireUser } from '@/lib/api/guard';
import { isUuid } from '@/lib/studio/validation';

export const dynamic = 'force-dynamic';

/** Platform admin approves or rejects a payment claim (admin_review_payment re-checks the role). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  if (!guard.ctx.isPlatformAdmin) return json({ error: 'not_found' }, 404);
  const { id } = await params;
  if (!isUuid(id)) return json({ error: 'not_found' }, 404);

  const read = await readJson(request, 4_000);
  if (!read.ok) return json({ error: read.error }, read.status);
  const b = read.body as { approve?: unknown; note?: unknown };
  if (typeof b.approve !== 'boolean') return json({ error: 'invalid_request' }, 400);
  const note = typeof b.note === 'string' ? b.note.trim().slice(0, 1000) : '';
  if (!b.approve && note.length < 3) return json({ error: 'reason_required' }, 400);

  const supabase = await getSupabaseServer();
  const { data, error } = await callRpc<string>(supabase, 'admin_review_payment', { p_payment_id: id, p_approve: b.approve, p_note: note || null });
  if (error) {
    if (isMissingFunction(error)) return json({ error: 'unavailable' }, 501);
    const m = error.message.toLowerCase();
    if (m.includes('already reviewed')) return json({ error: 'already_reviewed' }, 409);
    if (m.includes('below')) return json({ error: 'amount_below_price' }, 422);
    if (m.includes('not found')) return json({ error: 'not_found' }, 404);
    console.error('admin_review_payment failed', { code: error.code, message: error.message });
    return json({ error: 'unknown' }, 422);
  }
  return json({ status: data });
}
