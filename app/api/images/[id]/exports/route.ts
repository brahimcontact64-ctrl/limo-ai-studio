import { getSupabaseServer } from '@/lib/supabase/server';
import { json, readJson, requireUser } from '@/lib/api/guard';
import { allowRequest } from '@/lib/api/rateLimit';
import { callRpc, isMissingFunction, untyped } from '@/lib/supabase/rpc';
import { sniffImage, type ImageFormat } from '@/lib/images/formats';
import { imageError } from '@/lib/images/errors';
import { isUuid } from '@/lib/studio/validation';

export const dynamic = 'force-dynamic';

const MAX_EXPORT_BYTES = 25 * 1024 * 1024;

/**
 * Registers a rendered export (already uploaded to workspace-assets/<org>/exports/…) as a library item.
 * The file is downloaded with the user's own access and its real format and pixel size are read from the
 * bytes; claims that do not match are refused.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!isUuid(id)) return json({ error: 'not_found' }, 404);
  const read = await readJson(request, 4_000);
  if (!read.ok) return json({ error: read.error }, read.status);
  const b = (read.body ?? {}) as Record<string, unknown>;
  const path = typeof b.object_path === 'string' ? b.object_path : '';
  const format = b.format as ImageFormat;
  if (!['png', 'jpeg', 'webp'].includes(format) || !path) return json({ error: 'invalid_request' }, 400);
  const supabase = await getSupabaseServer();
  if (!(await allowRequest(supabase, 'image_export', 120, 3600))) return json({ error: 'rate_limited' }, 429);

  const { data: project } = await untyped(supabase).from('image_projects').select('organization_id').eq('id', id).maybeSingle();
  if (!project) return json({ error: 'not_found' }, 404);
  if (!path.startsWith(`${(project as { organization_id: string }).organization_id}/exports/`)) return json({ error: 'invalid_path' }, 400);
  const file = await supabase.storage.from('workspace-assets').download(path);
  if (file.error || !file.data) return json({ error: 'invalid_path' }, 400);
  if (file.data.size > MAX_EXPORT_BYTES) return json({ error: 'too_large' }, 413);
  const sniffed = sniffImage(new Uint8Array(await file.data.slice(0, 65536).arrayBuffer()));
  if (!sniffed || sniffed.format !== format || sniffed.width !== b.width || sniffed.height !== b.height) return json({ error: 'type_mismatch' }, 422);

  const { data, error } = await callRpc<Record<string, unknown>>(supabase, 'register_image_export', {
    p_project_id: id,
    p_object_path: path,
    p_format: format,
    p_width: sniffed.width,
    p_height: sniffed.height,
    p_size_bytes: file.data.size,
    p_revision_number: Number.isInteger(b.revision_number) ? b.revision_number : null,
  });
  if (isMissingFunction(error)) return json({ error: 'unavailable' }, 501);
  if (error || !data) {
    const e = imageError(error?.message);
    return json({ error: e.code }, e.status);
  }
  return json(data, 201);
}
