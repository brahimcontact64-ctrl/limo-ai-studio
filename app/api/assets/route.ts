import { getSupabaseServer } from '@/lib/supabase/server';
import { callRpc, isMissingFunction } from '@/lib/supabase/rpc';
import { canEditOrg, json, readJson, requireUser } from '@/lib/api/guard';
import { allowRequest } from '@/lib/api/rateLimit';
import { ASSET_KINDS, listAssets } from '@/lib/data/assets';
import { ASSET_MIME_TYPES } from '@/lib/assets/files';

export const dynamic = 'force-dynamic';

/** Lists the active workspace's library with short-lived signed URLs (used by the studio picker). */
export async function GET(request: Request) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  const org = guard.ctx.org;
  if (!org) return json({ error: 'no_workspace' }, 403);
  const supabase = await getSupabaseServer();
  const assets = await listAssets(supabase, org.organization_id);
  if (!assets) return json({ error: 'unavailable' }, 501);
  return json({ assets });
}

/** Registers a file the browser uploaded to workspace-assets/<organization_id>/… (register_media_asset re-checks). */
export async function POST(request: Request) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  const org = guard.ctx.org;
  if (!org || !canEditOrg(guard.ctx, org.organization_id)) return json({ error: 'not_authorized' }, 403);
  const read = await readJson(request, 4_000);
  if (!read.ok) return json({ error: read.error }, read.status);
  const b = read.body as Record<string, unknown>;
  const path = typeof b.object_path === 'string' ? b.object_path : '';
  const mime = typeof b.mime_type === 'string' ? b.mime_type : '';
  const kind = typeof b.kind === 'string' && (ASSET_KINDS as readonly string[]).includes(b.kind) ? b.kind : 'other';
  const int = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);
  if (!new RegExp(`^${org.organization_id}/[0-9a-f-]{36}\\.[a-z0-9]{2,5}$`).test(path)) return json({ error: 'invalid_path' }, 400);
  if (!ASSET_MIME_TYPES.has(mime)) return json({ error: 'type_not_allowed' }, 400);

  const supabase = await getSupabaseServer();
  if (!(await allowRequest(supabase, 'register_asset', 120, 3600))) return json({ error: 'rate_limited' }, 429);
  const { data, error } = await callRpc<string>(supabase, 'register_media_asset', {
    p_organization_id: org.organization_id,
    p_object_path: path,
    p_kind: kind,
    p_mime_type: mime,
    p_size_bytes: int(b.size_bytes),
    p_file_name: typeof b.file_name === 'string' ? b.file_name.slice(0, 200) : '',
    p_width: int(b.width),
    p_height: int(b.height),
    p_duration_ms: int(b.duration_ms),
    p_label: typeof b.label === 'string' ? b.label.slice(0, 120) : null,
  });
  if (error) return json({ error: isMissingFunction(error) ? 'unavailable' : 'invalid_upload' }, isMissingFunction(error) ? 501 : 422);
  return json({ asset_id: data }, 201);
}
