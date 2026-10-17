import { getSupabaseServer } from '@/lib/supabase/server';
import { json, readJson, requireUser } from '@/lib/api/guard';
import { allowRequest } from '@/lib/api/rateLimit';
import { callRpc, isMissingFunction } from '@/lib/supabase/rpc';
import { normalizeBible, validateBible } from '@/lib/story/bible';
import { storyError } from '@/lib/story/errors';

export const dynamic = 'force-dynamic';

/** Create a series with its first Story Bible version, in the caller's active workspace. */
export async function POST(request: Request) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  const org = guard.ctx.org;
  if (!org) return json({ error: 'no_workspace' }, 403);
  if (!guard.ctx.canEdit) return json({ error: 'not_authorized' }, 403);
  const read = await readJson(request, 200_000);
  if (!read.ok) return json({ error: read.error }, read.status);
  const b = (read.body ?? {}) as Record<string, unknown>;
  const title = typeof b.title === 'string' ? b.title.trim() : '';
  if (!title || title.length > 200) return json({ error: 'title_required' }, 400);
  const bible = normalizeBible(b.bible);
  const issues = validateBible(bible);
  if (bible.characters.length === 0) issues.push({ code: 'too_many', section: 'characters_required' });
  if (issues.length) return json({ error: 'invalid_bible', issues }, 400);

  const supabase = await getSupabaseServer();
  if (!(await allowRequest(supabase, 'story_write', 120, 3600))) return json({ error: 'rate_limited' }, 429);
  const { data, error } = await callRpc<string>(supabase, 'create_story_series', {
    p_organization_id: org.organization_id,
    p_title: title,
    p_language_code: typeof b.language_code === 'string' ? b.language_code : 'en',
    p_continuity_mode: b.continuity_mode === 'flexible' ? 'flexible' : 'strict',
    p_bible: bible,
  });
  if (isMissingFunction(error)) return json({ error: 'unavailable' }, 501);
  if (error || !data) {
    const e = storyError(error?.message);
    return json({ error: e.code, detail: e.detail }, e.status);
  }
  return json({ series_id: data }, 201);
}
