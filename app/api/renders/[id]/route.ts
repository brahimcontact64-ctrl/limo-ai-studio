import { getSupabaseServer } from '@/lib/supabase/server';
import { json, readJson, requireUser } from '@/lib/api/guard';
import { callRpc, isMissingFunction } from '@/lib/supabase/rpc';
import { loadRenderJob } from '@/lib/data/video';
import { renderError } from '@/lib/video/settings';
import { isUuid } from '@/lib/studio/validation';

export const dynamic = 'force-dynamic';

/** Status and progress of one render (workspace members only, via RLS). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!isUuid(id)) return json({ error: 'not_found' }, 404);
  const job = await loadRenderJob(await getSupabaseServer(), id);
  if (!job) return json({ error: 'not_found' }, 404);
  const { organization_id: _org, output_object_path: _path, ...rest } = job;
  return json(rest);
}

/** cancel (queued: immediately; rendering: the worker stops at its next heartbeat) | retry (failed/cancelled). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!isUuid(id)) return json({ error: 'not_found' }, 404);
  const read = await readJson(request, 1_000);
  if (!read.ok) return json({ error: read.error }, read.status);
  const action = (read.body as Record<string, unknown> | null)?.action;
  if (action !== 'cancel' && action !== 'retry') return json({ error: 'invalid_action' }, 400);
  const { data, error } = await callRpc<Record<string, unknown>>(await getSupabaseServer(), action === 'cancel' ? 'cancel_render_job' : 'retry_render_job', { p_job_id: id });
  if (isMissingFunction(error)) return json({ error: 'unavailable' }, 501);
  if (error || !data) {
    const e = renderError(error?.message);
    return json({ error: e.code }, e.status);
  }
  return json(data);
}
