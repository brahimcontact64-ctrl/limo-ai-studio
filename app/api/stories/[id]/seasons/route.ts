import { getSupabaseServer } from '@/lib/supabase/server';
import { json, readJson, requireUser } from '@/lib/api/guard';
import { callRpc, isMissingFunction } from '@/lib/supabase/rpc';
import { storyError } from '@/lib/story/errors';
import { isUuid } from '@/lib/studio/validation';

export const dynamic = 'force-dynamic';

/** Optional seasons: numbered automatically. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!isUuid(id)) return json({ error: 'not_found' }, 404);
  const read = await readJson(request, 8_000);
  if (!read.ok) return json({ error: read.error }, read.status);
  const b = (read.body ?? {}) as Record<string, unknown>;
  const supabase = await getSupabaseServer();
  const { data, error } = await callRpc<number>(supabase, 'create_story_season', {
    p_series_id: id,
    p_title: typeof b.title === 'string' ? b.title.slice(0, 200) : '',
    p_summary: typeof b.summary === 'string' ? b.summary.slice(0, 4000) : '',
  });
  if (isMissingFunction(error)) return json({ error: 'unavailable' }, 501);
  if (error || data === null) {
    const e = storyError(error?.message);
    return json({ error: e.code }, e.status);
  }
  return json({ season_number: data }, 201);
}
