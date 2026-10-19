import { getSupabaseServer } from '@/lib/supabase/server';
import { json, readJson, requireUser } from '@/lib/api/guard';
import { allowRequest } from '@/lib/api/rateLimit';
import { callRpc, isMissingFunction, untyped } from '@/lib/supabase/rpc';
import { isUuid } from '@/lib/studio/validation';
import { animationError } from '@/lib/animation/errors';

export const dynamic = 'force-dynamic';

/** Latest exports of this animation project (render jobs). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!isUuid(id)) return json({ error: 'not_found' }, 404);
  const { data, error } = await untyped(await getSupabaseServer()).from('render_jobs').select('id, status, progress, stage, error_code, total_duration_ms, aspect, width, height, created_at, completed_at, output_media_asset_id').eq('animation_project_id', id).order('created_at', { ascending: false }).limit(10);
  if (error) return json({ error: 'unavailable' }, 501);
  return json({ renders: data ?? [] });
}

/** Approved shots → render spec → the existing render worker (≤ 30 s, one video credit per completed video). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!isUuid(id)) return json({ error: 'not_found' }, 404);
  const read = await readJson(request, 2_000);
  if (!read.ok) return json({ error: read.error }, read.status);
  const b = (read.body ?? {}) as Record<string, unknown>;
  const key = typeof b.idempotency_key === 'string' && /^[A-Za-z0-9_-]{8,120}$/.test(b.idempotency_key) ? b.idempotency_key : null;
  const resolution = [480, 720, 1080].includes(Number(b.resolution)) ? Number(b.resolution) : 720;
  const quality = ['draft', 'standard', 'high'].includes(b.quality as string) ? (b.quality as string) : 'standard';
  if (!key) return json({ error: 'invalid_request' }, 400);
  const supabase = await getSupabaseServer();
  if (!(await allowRequest(supabase, 'render_export', 30, 3600))) return json({ error: 'rate_limited' }, 429);
  const { data, error } = await callRpc(supabase, 'enqueue_animation_render', { p_project_id: id, p_idempotency_key: key, p_resolution: resolution, p_quality: quality });
  if (isMissingFunction(error)) return json({ error: 'unavailable' }, 501);
  if (error) {
    const e = animationError(error.message);
    return json({ error: e.code, detail: error.message.slice(0, 200) }, e.status);
  }
  return json(data, 201);
}
