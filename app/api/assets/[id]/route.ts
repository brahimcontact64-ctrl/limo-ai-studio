import { getSupabaseServer } from '@/lib/supabase/server';
import { callRpc, isMissingFunction } from '@/lib/supabase/rpc';
import { json, requireUser } from '@/lib/api/guard';
import { isUuid } from '@/lib/studio/validation';

export const dynamic = 'force-dynamic';

/** Deletes a library file: delete_media_asset checks role and usage, then the object is removed from Storage. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!isUuid(id)) return json({ error: 'not_found' }, 404);
  const supabase = await getSupabaseServer();
  const { data: path, error } = await callRpc<string>(supabase, 'delete_media_asset', { p_asset_id: id });
  if (error) {
    if (isMissingFunction(error)) return json({ error: 'unavailable' }, 501);
    const m = error.message.toLowerCase();
    if (m.includes('used by')) return json({ error: 'in_use' }, 409);
    if (m.includes('not found')) return json({ error: 'not_found' }, 404);
    return json({ error: 'not_authorized' }, 403);
  }
  if (path) await supabase.storage.from('workspace-assets').remove([path]);
  return json({ ok: true });
}
