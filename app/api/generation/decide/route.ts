import { getSupabaseServer } from '@/lib/supabase/server';
import { json, readJson, requireUser } from '@/lib/api/guard';
import { callRpc, isMissingFunction } from '@/lib/supabase/rpc';
import { isUuid } from '@/lib/studio/validation';
import { generationError } from '@/lib/generation/proposals';

export const dynamic = 'force-dynamic';

/** Records the customer's decision on one generated scene asset (applying it to the timeline is a separate save). */
export async function POST(request: Request) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  const read = await readJson(request, 2_000);
  if (!read.ok) return json({ error: read.error }, read.status);
  const b = (read.body ?? {}) as Record<string, unknown>;
  const scene = Number(b.scene_number);
  if (!isUuid(b.run_id) || !isUuid(b.asset_id) || !Number.isInteger(scene) || (b.decision !== 'applied' && b.decision !== 'rejected')) return json({ error: 'invalid_request' }, 400);
  const supabase = await getSupabaseServer();
  const { data, error } = await callRpc<Record<string, unknown>>(supabase, 'decide_generation_proposal', { p_run_id: b.run_id, p_scene_number: scene, p_asset_id: b.asset_id, p_decision: b.decision });
  if (isMissingFunction(error)) return json({ error: 'unavailable' }, 501);
  if (error || !data) {
    const e = generationError(error?.message);
    return json({ error: e.code }, e.status);
  }
  return json(data);
}
