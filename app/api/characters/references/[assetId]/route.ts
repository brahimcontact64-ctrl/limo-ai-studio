import { getSupabaseServer } from '@/lib/supabase/server';
import { json, readJson, requireUser } from '@/lib/api/guard';
import { allowRequest } from '@/lib/api/rateLimit';
import { callRpc, isMissingFunction } from '@/lib/supabase/rpc';
import { isUuid } from '@/lib/studio/validation';

export const dynamic = 'force-dynamic';

/**
 * Review actions on one reference file:
 * - view: records that the reviewer opened the file (required before a decision),
 * - approve: needs the complete checklist (checked again in the database),
 * - reject / retire: need a reason.
 */
export async function POST(request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  const { assetId } = await params;
  if (!isUuid(assetId)) return json({ error: 'not_found' }, 404);
  const read = await readJson(request, 4_000);
  if (!read.ok) return json({ error: read.error }, read.status);
  const b = (read.body ?? {}) as { action?: unknown; note?: unknown; checklist?: unknown };
  const note = typeof b.note === 'string' ? b.note.slice(0, 1000) : null;
  const checklist = b.checklist && typeof b.checklist === 'object' && !Array.isArray(b.checklist) ? b.checklist : {};
  const supabase = await getSupabaseServer();
  if (b.action !== 'view' && !(await allowRequest(supabase, 'character_review', 120, 3600))) return json({ error: 'rate_limited' }, 429);

  const call =
    b.action === 'view'
      ? callRpc<null>(supabase, 'record_character_reference_view', { p_asset_id: assetId })
      : b.action === 'approve' || b.action === 'reject'
        ? callRpc<string>(supabase, 'review_character_reference', { p_asset_id: assetId, p_approve: b.action === 'approve', p_note: note, p_checklist: checklist })
        : b.action === 'retire'
          ? callRpc<string>(supabase, 'retire_character_reference', { p_asset_id: assetId, p_note: note })
          : null;
  if (!call) return json({ error: 'invalid_action' }, 400);
  const { data, error } = await call;
  if (isMissingFunction(error)) return json({ error: 'unavailable' }, 501);
  if (error) {
    const m = error.message;
    if (/not found/i.test(m)) return json({ error: 'not_found' }, 404);
    if (/open the reference/i.test(m)) return json({ error: 'not_viewed' }, 409);
    if (/checklist incomplete/i.test(m)) return json({ error: 'checklist_incomplete' }, 422);
    if (/already been reviewed/i.test(m)) return json({ error: 'already_reviewed' }, 409);
    if (/reason/i.test(m)) return json({ error: 'reason_required' }, 422);
    return json({ error: 'failed' }, 422);
  }
  return json({ ok: true, reference_status: data ?? null });
}
