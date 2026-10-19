/** Database messages of the Animation Studio / AI job functions → stable API error codes (shown translated in the UI). */
const MAP: Array<[RegExp, string, number]> = [
  [/not authorized/i, 'not_authorized', 403],
  [/not found/i, 'not_found', 404],
  [/changed in another window/i, 'conflict', 409],
  [/limited to \d+ seconds/i, 'video_too_long', 400],
  [/4, 6 or 8 seconds/i, 'shot_duration', 400],
  [/at most 15 shots/i, 'too_many_shots', 400],
  [/at most 5 characters/i, 'too_many_characters', 400],
  [/unknown character/i, 'unknown_character', 400],
  [/speaker must be in the shot/i, 'speaker_not_in_scene', 400],
  [/empty dialogue/i, 'dialogue_empty', 400],
  [/expression/i, 'expression_invalid', 400],
  [/references must be approved/i, 'reference_not_approved', 400],
  [/being generated/i, 'shot_busy', 409],
  [/AI animation is not enabled|AI content is not enabled/i, 'not_enabled', 403],
  [/is not ready/i, 'character_not_ready', 409],
  [/approve the keyframe first/i, 'keyframe_not_approved', 409],
  [/already has an approved keyframe/i, 'keyframe_already_approved', 409],
  [/nothing to speak/i, 'nothing_to_speak', 400],
  [/already in progress/i, 'busy', 409],
  [/no keyframe waiting|no clip waiting|no generated clip/i, 'nothing_to_review', 409],
  [/say what should change/i, 'note_required', 400],
  [/clip already exists/i, 'clip_exists', 409],
  [/last frame needs a first frame/i, 'last_frame_needs_first', 400],
  [/frames must be images/i, 'frame_invalid', 400],
  [/approve every shot/i, 'shots_not_approved', 409],
  [/storyboard is empty/i, 'empty', 400],
  [/active subscription required/i, 'subscription_required', 402],
  [/video credit limit/i, 'credit_limit', 402],
  [/music must be an audio/i, 'music_invalid', 400],
  [/describe the content|invalid request/i, 'invalid_request', 400],
  [/only queued jobs/i, 'not_cancellable', 409],
];

export function animationError(message: string | undefined | null): { code: string; status: number } {
  for (const [re, code, status] of MAP) if (re.test(message ?? '')) return { code, status };
  return { code: 'unavailable', status: 500 };
}
