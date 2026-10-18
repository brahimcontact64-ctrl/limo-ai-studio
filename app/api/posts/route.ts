import { getSupabaseServer } from '@/lib/supabase/server';
import { canEditOrg, json, readJson, requireUser } from '@/lib/api/guard';
import { allowRequest } from '@/lib/api/rateLimit';
import { callRpc, isMissingFunction, untyped } from '@/lib/supabase/rpc';
import { CAPTION_MAX, normalizeHashtags } from '@/lib/images/posts';
import { socialError } from '@/lib/social/errors';
import { POST_LANGUAGES, POST_TONES } from '@/lib/social/types';
import { isUuid } from '@/lib/studio/validation';

export const dynamic = 'force-dynamic';

const id = (v: unknown) => (typeof v === 'string' && isUuid(v) ? v : null);
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

/** Create or save a social post draft (text, tone, language, image or video). Nothing is published. */
export async function POST(request: Request) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  const read = await readJson(request, 40_000);
  if (!read.ok) return json({ error: read.error }, read.status);
  const b = (read.body ?? {}) as Record<string, unknown>;
  const title = text(b.title, 200).trim();
  if (!title) return json({ error: 'title_required' }, 400);
  const caption = typeof b.caption === 'string' ? b.caption : '';
  if (caption.length > CAPTION_MAX) return json({ error: 'caption_too_long' }, 400);
  const postId = id(b.id);

  const supabase = await getSupabaseServer();
  if (!(await allowRequest(supabase, 'post_save', 400, 3600))) return json({ error: 'rate_limited' }, 429);
  let organizationId = guard.ctx.org?.organization_id;
  if (postId) {
    const { data } = await untyped(supabase).from('social_posts').select('organization_id').eq('id', postId).maybeSingle();
    organizationId = (data as { organization_id?: string } | null)?.organization_id;
    if (!organizationId) return json({ error: 'not_found' }, 404);
  }
  if (!organizationId) return json({ error: 'no_workspace' }, 403);
  if (!canEditOrg(guard.ctx, organizationId)) return json({ error: 'not_authorized' }, 403);

  const mediaKind = b.media_kind === 'video' ? 'video' : 'image';
  const { data, error } = await callRpc<Record<string, unknown>>(supabase, 'save_social_post_v2', {
    p_organization_id: organizationId,
    p_post_id: postId,
    p_base_updated_at: typeof b.base_updated_at === 'string' ? b.base_updated_at : null,
    p_title: title,
    p_caption: caption,
    p_headline: text(b.headline, 200),
    p_hashtags: normalizeHashtags(b.hashtags),
    p_cta: text(b.cta, 120),
    p_language_code: (POST_LANGUAGES as readonly string[]).includes(b.language_code as string) ? b.language_code : 'en',
    p_tone: (POST_TONES as readonly string[]).includes(b.tone as string) ? b.tone : 'friendly',
    p_media_kind: mediaKind,
    p_image_project_id: mediaKind === 'image' ? id(b.image_project_id) : null,
    p_media_asset_id: mediaKind === 'image' ? id(b.media_asset_id) : null,
    p_render_job_id: mediaKind === 'video' ? id(b.render_job_id) : null,
    p_source_project_id: id(b.source_project_id),
    p_origin: b.origin === 'ai' ? 'ai' : 'manual',
    p_revision_source: b.revision_source === 'autosave' || b.revision_source === 'ai_suggestion' ? b.revision_source : 'manual',
    p_revision_label: text(b.revision_label, 200) || null,
  });
  if (isMissingFunction(error)) return json({ error: 'unavailable' }, 501);
  if (error || !data) {
    const e = socialError(error?.message);
    return json({ error: e.code }, e.status);
  }
  return json(data, postId ? 200 : 201);
}
