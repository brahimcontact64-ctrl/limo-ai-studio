import { getSupabaseServer } from '@/lib/supabase/server';
import { json, readJson, requireUser } from '@/lib/api/guard';
import { allowRequest } from '@/lib/api/rateLimit';
import { callRpc, isMissingFunction } from '@/lib/supabase/rpc';
import { isUuid } from '@/lib/studio/validation';
import { animationError } from '@/lib/animation/errors';

export const dynamic = 'force-dynamic';

/**
 * One shot: approve / reject (revise) its keyframe or clip, set first/last frames, or request an AI job.
 * Jobs are refused by the database while `animation_generation` is off or a character is not ready; real provider
 * calls additionally need paid_generation, verified prices, budgets and the spend guard (worker side).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; shotId: string }> }) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  const { shotId } = await params;
  if (!isUuid(shotId)) return json({ error: 'not_found' }, 404);
  const read = await readJson(request, 4_000);
  if (!read.ok) return json({ error: read.error }, read.status);
  const b = (read.body ?? {}) as Record<string, unknown>;
  const supabase = await getSupabaseServer();
  let res: { data: unknown; error: { message: string; code?: string } | null };
  if (b.action === 'decide') {
    if (!['keyframe', 'clip'].includes(b.stage as string) || !['approve', 'reject'].includes(b.decision as string)) return json({ error: 'invalid_request' }, 400);
    res = await callRpc(supabase, 'decide_animation_shot', { p_shot_id: shotId, p_stage: b.stage, p_decision: b.decision, p_note: typeof b.note === 'string' ? b.note.slice(0, 1000) : null, p_identity_confirmed: b.identity_confirmed === true });
  } else if (b.action === 'frames') {
    res = await callRpc(supabase, 'set_animation_shot_frames', { p_shot_id: shotId, p_first_frame_asset_id: isUuid(b.first_frame_asset_id) ? b.first_frame_asset_id : null, p_last_frame_asset_id: isUuid(b.last_frame_asset_id) ? b.last_frame_asset_id : null });
  } else if (b.action === 'job') {
    const kind = b.kind as string;
    const key = typeof b.idempotency_key === 'string' && /^[A-Za-z0-9_-]{8,120}$/.test(b.idempotency_key) ? b.idempotency_key : null;
    if (!['animation_keyframe', 'animation_clip', 'animation_voice'].includes(kind) || !key || !Number.isInteger(b.confirm_cents)) return json({ error: 'invalid_request' }, 400);
    if (!(await allowRequest(supabase, 'animation_job', 60, 3600))) return json({ error: 'rate_limited' }, 429);
    res = await callRpc(supabase, 'request_animation_job', { p_shot_id: shotId, p_kind: kind, p_request_key: key, p_confirmed_cents: b.confirm_cents });
  } else return json({ error: 'invalid_request' }, 400);
  if (isMissingFunction(res.error)) return json({ error: 'unavailable' }, 501);
  if (res.error) {
    const e = animationError(res.error.message);
    return json({ error: e.code, detail: res.error.message.slice(0, 200) }, e.status);
  }
  return json(res.data);
}
