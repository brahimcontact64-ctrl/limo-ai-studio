import { getSupabaseServer } from '@/lib/supabase/server';
import { json, readJson, requireUser } from '@/lib/api/guard';
import { allowRequest } from '@/lib/api/rateLimit';
import { callRpc, isMissingFunction } from '@/lib/supabase/rpc';
import { normalizeVideoSettings, renderError } from '@/lib/video/settings';
import { isUuid } from '@/lib/studio/validation';

export const dynamic = 'force-dynamic';

/**
 * Starts an MP4 export of the project's APPROVED script revision. The request only queues a job (the
 * database copies the approved timeline into it); a separate render worker does the work. The same
 * idempotency key always returns the same job, so a double click or a retried request renders once.
 */
export async function POST(request: Request) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  const read = await readJson(request, 40_000);
  if (!read.ok) return json({ error: read.error }, read.status);
  const b = (read.body ?? {}) as Record<string, unknown>;
  const projectId = typeof b.project_id === 'string' && isUuid(b.project_id) ? b.project_id : null;
  const key = typeof b.idempotency_key === 'string' && /^[A-Za-z0-9_-]{8,120}$/.test(b.idempotency_key) ? b.idempotency_key : null;
  if (!projectId || !key) return json({ error: 'invalid_request' }, 400);
  const s = normalizeVideoSettings(b.settings);
  const supabase = await getSupabaseServer();
  if (!(await allowRequest(supabase, 'render_enqueue', 30, 3600))) return json({ error: 'rate_limited' }, 429);
  const { data, error } = await callRpc<Record<string, unknown>>(supabase, 'enqueue_render_job', {
    p_project_id: projectId,
    p_idempotency_key: key,
    p_aspect: s.aspect,
    p_resolution: s.resolution,
    p_quality: s.quality,
    p_settings: s,
  });
  if (isMissingFunction(error)) return json({ error: 'unavailable' }, 501);
  if (error || !data) {
    const e = renderError(error?.message);
    return json({ error: e.code }, e.status);
  }
  return json(data, data.existing ? 200 : 201);
}
