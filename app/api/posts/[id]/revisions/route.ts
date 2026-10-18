import { getSupabaseServer } from '@/lib/supabase/server';
import { json, requireUser } from '@/lib/api/guard';
import { untyped } from '@/lib/supabase/rpc';
import { isUuid } from '@/lib/studio/validation';

export const dynamic = 'force-dynamic';

/** Revision history of a post (workspace members only, via RLS). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!isUuid(id)) return json({ error: 'not_found' }, 404);
  const { data, error } = await untyped(await getSupabaseServer())
    .from('social_post_revisions')
    .select('id, revision_number, source, label, snapshot, updated_at')
    .eq('post_id', id)
    .order('revision_number', { ascending: false })
    .limit(50);
  if (error) return json({ error: 'unavailable' }, 501);
  return json({ revisions: data ?? [] });
}
