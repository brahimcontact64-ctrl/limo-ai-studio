import { getSupabaseServer } from '@/lib/supabase/server';
import { json, requireUser } from '@/lib/api/guard';
import { callRpc, isMissingFunction, untyped } from '@/lib/supabase/rpc';
import { isUuid } from '@/lib/studio/validation';
import { animationError } from '@/lib/animation/errors';

export const dynamic = 'force-dynamic';

/** Status and result of one AI job of the caller's workspace (RLS), with signed previews of its files. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!isUuid(id)) return json({ error: 'not_found' }, 404);
  const supabase = await getSupabaseServer();
  const db = untyped(supabase);
  const { data: job } = await db.from('ai_jobs').select('id, organization_id, kind, status, error_code, output, output_asset_ids, created_at, completed_at').eq('id', id).maybeSingle();
  if (!job) return json({ error: 'not_found' }, 404);
  const j = job as { organization_id: string; output_asset_ids: string[] };
  const files: Array<{ id: string; url: string | null; mime: string; mock: boolean }> = [];
  if (j.output_asset_ids?.length) {
    const { data: rows } = await db.from('media_assets').select('id, object_path, mime_type, provenance').eq('organization_id', j.organization_id).in('id', j.output_asset_ids);
    const list = (rows ?? []) as Array<{ id: string; object_path: string; mime_type: string | null; provenance: { mock?: boolean } | null }>;
    const signed = list.length ? ((await supabase.storage.from('workspace-assets').createSignedUrls(list.map((a) => a.object_path), 600)).data ?? []) : [];
    list.forEach((a, i) => files.push({ id: a.id, url: signed[i]?.signedUrl ?? null, mime: a.mime_type ?? '', mock: a.provenance?.mock === true }));
  }
  const { organization_id: _o, ...rest } = job as Record<string, unknown>;
  return json({ ...rest, files });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!isUuid(id)) return json({ error: 'not_found' }, 404);
  const { data, error } = await callRpc(await getSupabaseServer(), 'cancel_ai_job', { p_job_id: id });
  if (isMissingFunction(error)) return json({ error: 'unavailable' }, 501);
  if (error) {
    const e = animationError(error.message);
    return json({ error: e.code }, e.status);
  }
  return json(data);
}
