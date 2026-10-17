/** Maps Story Engine database errors (migration 20261017160000) to stable API codes. */
export type StoryErrorCode =
  | 'conflict'
  | 'not_found'
  | 'not_authorized'
  | 'subscription_required'
  | 'not_latest'
  | 'previous_not_approved'
  | 'previous_needs_review'
  | 'script_not_approved'
  | 'ending_required'
  | 'earlier_first'
  | 'review_first'
  | 'already_approved'
  | 'episode_approved'
  | 'character_in_use'
  | 'unknown_character'
  | 'unknown_location'
  | 'unknown_arc'
  | 'event_scene'
  | 'note_required'
  | 'limit_reached'
  | 'invalid';

export function storyError(message: string | undefined | null): { code: StoryErrorCode; status: number; detail?: string } {
  const m = message ?? '';
  const detail = /: (.+)$/.exec(m)?.[1];
  if (/changed since it was loaded/i.test(m)) return { code: 'conflict', status: 409 };
  if (/continue from the latest episode/i.test(m)) return { code: 'not_latest', status: 409 };
  if (/approve episode \d+ first/i.test(m)) return { code: 'previous_not_approved', status: 409 };
  if (/episode \d+ needs review first/i.test(m)) return { code: 'previous_needs_review', status: 409 };
  if (/approve the episode script first/i.test(m)) return { code: 'script_not_approved', status: 409 };
  if (/write the episode ending first|ending summary required/i.test(m)) return { code: 'ending_required', status: 422 };
  if (/earlier episodes first/i.test(m)) return { code: 'earlier_first', status: 409 };
  if (/review this episode first/i.test(m)) return { code: 'review_first', status: 409 };
  if (/already approved/i.test(m)) return { code: 'already_approved', status: 409 };
  if (/episode is approved; reopen/i.test(m)) return { code: 'episode_approved', status: 409 };
  if (/appears in approved episodes/i.test(m)) return { code: 'character_in_use', status: 409, detail };
  if (/character outside the canon|not in the story bible|unknown character/i.test(m)) return { code: 'unknown_character', status: 422, detail };
  if (/unknown location/i.test(m)) return { code: 'unknown_location', status: 422, detail };
  if (/unknown plot thread/i.test(m)) return { code: 'unknown_arc', status: 422, detail };
  if (/must come from a scene/i.test(m)) return { code: 'event_scene', status: 422 };
  if (/at least 5 characters/i.test(m)) return { code: 'note_required', status: 422 };
  if (/at most 50 series/i.test(m)) return { code: 'limit_reached', status: 422 };
  if (/active subscription required/i.test(m)) return { code: 'subscription_required', status: 403 };
  if (/not authorized|authentication required/i.test(m)) return { code: 'not_authorized', status: 403 };
  if (/not found/i.test(m)) return { code: 'not_found', status: 404 };
  return { code: 'invalid', status: 422 };
}
