/** Maps social publishing database errors (migration 20261017220000) to stable API codes. */
export function socialError(message: string | undefined | null): { code: string; status: number } {
  const m = message ?? '';
  if (/changed since it was loaded/i.test(m)) return { code: 'conflict', status: 409 };
  if (/remove approval before editing/i.test(m)) return { code: 'approved_locked', status: 409 };
  if (/already approved/i.test(m)) return { code: 'already_approved', status: 409 };
  if (/already scheduled/i.test(m)) return { code: 'already_scheduled', status: 409 };
  if (/placeholders/i.test(m)) return { code: 'placeholder', status: 422 };
  if (/caption before approving/i.test(m)) return { code: 'caption_required', status: 422 };
  if (/choose an image|choose a video/i.test(m)) return { code: 'media_required', status: 422 };
  if (/approve the image before/i.test(m)) return { code: 'image_not_approved', status: 409 };
  if (/video export is not finished|no longer approved/i.test(m)) return { code: 'video_not_approved', status: 409 };
  if (/approve the post before scheduling/i.test(m)) return { code: 'not_approved', status: 409 };
  if (/connected page|reconnect/i.test(m)) return { code: 'page_unavailable', status: 409 };
  if (/invalid time zone/i.test(m)) return { code: 'invalid_timezone', status: 422 };
  if (/time in the future/i.test(m)) return { code: 'time_in_past', status: 422 };
  if (/120 days/i.test(m)) return { code: 'too_far', status: 422 };
  if (/publishing is paused/i.test(m)) return { code: 'paused', status: 409 };
  if (/live facebook publishing is not enabled/i.test(m)) return { code: 'live_disabled', status: 409 };
  if (/post limit reached/i.test(m)) return { code: 'post_limit_reached', status: 402 };
  if (/page limit reached/i.test(m)) return { code: 'page_limit_reached', status: 402 };
  if (/active subscription|billing cycle/i.test(m)) return { code: 'subscription_required', status: 402 };
  if (/in progress/i.test(m)) return { code: 'in_progress', status: 409 };
  if (/not scheduled|no longer be cancelled|only drafts|only posts awaiting|not approved|unschedule the post/i.test(m)) return { code: 'invalid_state', status: 409 };
  if (/explain what must change/i.test(m)) return { code: 'note_required', status: 422 };
  if (/outside this workspace/i.test(m)) return { code: 'foreign_asset', status: 403 };
  if (/invalid hashtags/i.test(m)) return { code: 'invalid_hashtags', status: 422 };
  if (/automatic publishing is not available/i.test(m)) return { code: 'automation_unavailable', status: 409 };
  if (/confirm the automation|rules changed/i.test(m)) return { code: 'confirmation_required', status: 422 };
  if (/invalid posting frequency|invalid approval boundary/i.test(m)) return { code: 'invalid_rules', status: 422 };
  if (/revoked/i.test(m)) return { code: 'revoked', status: 409 };
  if (/give the page a name/i.test(m)) return { code: 'name_required', status: 422 };
  if (/not authorized|authentication required/i.test(m)) return { code: 'not_authorized', status: 403 };
  if (/not found/i.test(m)) return { code: 'not_found', status: 404 };
  return { code: 'invalid', status: 422 };
}
