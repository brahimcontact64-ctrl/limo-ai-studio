import { getSupabaseServer } from '@/lib/supabase/server';
import { canEditOrg, json, readJson, requireUser } from '@/lib/api/guard';
import { allowRequest } from '@/lib/api/rateLimit';
import { callRpc, isMissingFunction, untyped } from '@/lib/supabase/rpc';
import { CAPTION_MAX, normalizeHashtags } from '@/lib/images/posts';
import { imageError } from '@/lib/images/errors';
import { isUuid } from '@/lib/studio/validation';

export const dynamic = 'force-dynamic';

/** Create or save a social post draft (caption, hashtags, image). Nothing is published. */
export async function POST(request: Request) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  const read = await readJson(request, 40_000);
  if (!read.ok) return json({ error: read.error }, read.status);
  const b = (read.body ?? {}) as Record<string, unknown>;
  const title = typeof b.title === 'string' ? b.title.trim().slice(0, 200) : '';
  if (!title) return json({ error: 'title_required' }, 400);
  const caption = typeof b.caption === 'string' ? b.caption : '';
  if (caption.length > CAPTION_MAX) return json({ error: 'caption_too_long' }, 400);
  const id = typeof b.id === 'string' && isUuid(b.id) ? b.id : null;

  const supabase = await getSupabaseServer();
  if (!(await allowRequest(supabase, 'post_save', 240, 3600))) return json({ error: 'rate_limited' }, 429);
  let organizationId = guard.ctx.org?.organization_id;
  if (id) {
    const { data } = await untyped(supabase).from('social_posts').select('organization_id').eq('id', id).maybeSingle();
    organizationId = (data as { organization_id?: string } | null)?.organization_id;
    if (!organizationId) return json({ error: 'not_found' }, 404);
  }
  if (!organizationId) return json({ error: 'no_workspace' }, 403);
  if (!canEditOrg(guard.ctx, organizationId)) return json({ error: 'not_authorized' }, 403);

  const { data, error } = await callRpc<Record<string, unknown>>(supabase, 'save_social_post', {
    p_organization_id: organizationId,
    p_post_id: id,
    p_base_updated_at: typeof b.base_updated_at === 'string' ? b.base_updated_at : null,
    p_title: title,
    p_caption: caption,
    p_hashtags: normalizeHashtags(b.hashtags),
    p_image_project_id: typeof b.image_project_id === 'string' && isUuid(b.image_project_id) ? b.image_project_id : null,
    p_media_asset_id: typeof b.media_asset_id === 'string' && isUuid(b.media_asset_id) ? b.media_asset_id : null,
  });
  if (isMissingFunction(error)) return json({ error: 'unavailable' }, 501);
  if (error || !data) {
    const e = imageError(error?.message);
    return json({ error: e.code }, e.status);
  }
  return json(data, id ? 200 : 201);
}
