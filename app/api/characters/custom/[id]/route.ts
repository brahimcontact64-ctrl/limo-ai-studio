import { getSupabaseServer } from '@/lib/supabase/server';
import { json, requireUser } from '@/lib/api/guard';
import { callRpc, isMissingFunction } from '@/lib/supabase/rpc';
import { isUuid } from '@/lib/studio/validation';

export const dynamic = 'force-dynamic';

/** Archive a workspace character (kept for existing projects; hidden from new casts). */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!isUuid(id)) return json({ error: 'not_found' }, 404);
  const supabase = await getSupabaseServer();
  const { error } = await callRpc<null>(supabase, 'archive_custom_character', { p_character_id: id });
  if (isMissingFunction(error)) return json({ error: 'unavailable' }, 501);
  if (error) return json({ error: 'not_found' }, 404);
  return json({ ok: true });
}
