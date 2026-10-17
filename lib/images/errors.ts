/** Maps Image Studio / social post database errors (migration 20261017180000) to stable API codes. */
export function imageError(message: string | undefined | null): { code: string; status: number } {
  const m = message ?? '';
  if (/changed since it was loaded/i.test(m)) return { code: 'conflict', status: 409 };
  if (/is approved; remove approval/i.test(m)) return { code: 'approved_locked', status: 409 };
  if (/already approved/i.test(m)) return { code: 'already_approved', status: 409 };
  if (/placeholder/i.test(m)) return { code: 'placeholder', status: 422 };
  if (/outside this workspace/i.test(m)) return { code: 'foreign_asset', status: 403 };
  if (/does not match the aspect|export size does not match/i.test(m)) return { code: 'size_mismatch', status: 422 };
  if (/invalid export path|uploaded file not found/i.test(m)) return { code: 'invalid_path', status: 400 };
  if (/export too large/i.test(m)) return { code: 'too_large', status: 413 };
  if (/caption before approving/i.test(m)) return { code: 'caption_required', status: 422 };
  if (/choose an image/i.test(m)) return { code: 'image_required', status: 422 };
  if (/approve the image before/i.test(m)) return { code: 'image_not_approved', status: 409 };
  if (/invalid hashtags/i.test(m)) return { code: 'invalid_hashtags', status: 422 };
  if (/at most 500/i.test(m)) return { code: 'limit_reached', status: 422 };
  if (/not authorized|authentication required/i.test(m)) return { code: 'not_authorized', status: 403 };
  if (/not found/i.test(m)) return { code: 'not_found', status: 404 };
  return { code: 'invalid', status: 422 };
}
