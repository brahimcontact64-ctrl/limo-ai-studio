import { getSupabaseServer } from '@/lib/supabase/server';
import { json, readJson, requireUser } from '@/lib/api/guard';
import { allowRequest } from '@/lib/api/rateLimit';
import { callRpc, isMissingFunction } from '@/lib/supabase/rpc';
import { normalizeBible, validateBible } from '@/lib/story/bible';
import { storyError } from '@/lib/story/errors';
import { isUuid } from '@/lib/studio/validation';

export const dynamic = 'force-dynamic';

/**
 * Canon changes are explicit: save a new Story Bible version (based on the version the user loaded) or
 * restore an earlier one as a new version. Characters used by approved episodes cannot be removed.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!isUuid(id)) return json({ error: 'not_found' }, 404);
  const read = await readJson(request, 300_000);
  if (!read.ok) return json({ error: read.error }, read.status);
  const b = (read.body ?? {}) as Record<string, unknown>;
  if (!Number.isInteger(b.base_version)) return json({ error: 'invalid_request' }, 400);
  const supabase = await getSupabaseServer();
  if (!(await allowRequest(supabase, 'story_write', 120, 3600))) return json({ error: 'rate_limited' }, 429);

  let res;
  if (b.action === 'restore') {
    if (!Number.isInteger(b.version)) return json({ error: 'invalid_request' }, 400);
    res = await callRpc<number>(supabase, 'restore_story_bible', { p_series_id: id, p_version: b.version, p_base_version: b.base_version });
  } else {
    const bible = normalizeBible(b.bible);
    const issues = validateBible(bible);
    if (issues.length) return json({ error: 'invalid_bible', issues }, 400);
    res = await callRpc<number>(supabase, 'save_story_bible', {
      p_series_id: id,
      p_base_version: b.base_version,
      p_bible: bible,
      p_note: typeof b.note === 'string' ? b.note.slice(0, 500) : null,
    });
  }
  if (isMissingFunction(res.error)) return json({ error: 'unavailable' }, 501);
  if (res.error || res.data === null) {
    const e = storyError(res.error?.message);
    return json({ error: e.code, detail: e.detail }, e.status);
  }
  return json({ version: res.data });
}
