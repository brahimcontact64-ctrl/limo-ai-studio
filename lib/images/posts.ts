/**
 * Social posts (Milestone 6): caption + hashtags + one approved image. Output is prepared for the
 * Facebook publishing workflow of Milestone 8; nothing is sent to any social network here.
 */
export const CAPTION_MAX = 5000;
export const HASHTAGS_MAX = 30;

export function normalizeHashtags(input: unknown): string[] {
  const raw = Array.isArray(input) ? input.join(' ') : typeof input === 'string' ? input : '';
  const out: string[] = [];
  for (const part of raw.split(/[\s,]+/)) {
    const tag = part.replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '').slice(0, 60);
    if (tag && !out.some((t) => t.toLowerCase() === tag.toLowerCase())) out.push(tag);
    if (out.length >= HASHTAGS_MAX) break;
  }
  return out;
}

export type PostIssue = 'caption_required' | 'caption_too_long' | 'image_required' | 'image_not_approved';

export function validatePost(post: { caption: string; media_asset_id: string | null; image_status: 'draft' | 'approved' | null }): PostIssue[] {
  const out: PostIssue[] = [];
  if (!post.caption.trim()) out.push('caption_required');
  if (post.caption.length > CAPTION_MAX) out.push('caption_too_long');
  if (!post.media_asset_id) out.push('image_required');
  else if (post.image_status === 'draft') out.push('image_not_approved');
  return out;
}

/** The message text a publisher would send (caption, a blank line, then hashtags). */
export function postMessage(caption: string, hashtags: string[]): string {
  const tags = hashtags.map((t) => `#${t}`).join(' ');
  return [caption.trim(), tags].filter(Boolean).join('\n\n');
}

/**
 * Payload for the future Facebook adapter (Milestone 8). The image is referenced by workspace asset id;
 * the adapter will create a short-lived URL at publish time. `published` is always false here.
 */
export function facebookDraftPayload(post: { id: string; caption: string; hashtags: string[]; media_asset_id: string | null }) {
  return {
    channel: 'facebook_page' as const,
    post_id: post.id,
    message: postMessage(post.caption, post.hashtags),
    media: post.media_asset_id ? [{ asset_id: post.media_asset_id, type: 'image' as const }] : [],
    published: false,
  };
}
