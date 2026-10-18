/**
 * V1 video duration and credit policy (owner decision, 2026-10-18).
 *
 *  - Every plan: an exported video is at most 30 seconds in total.
 *  - Every successfully completed video consumes exactly ONE video credit, whatever its length (1–30 s)
 *    and whatever its format. Downloading a finished video again never costs anything; an identical
 *    export of the same approved revision returns the existing video instead of charging again.
 *  - The credit is RESERVED when the export starts, CONSUMED when the render completes and RELEASED
 *    (refunded) on a definitive failure or a cancellation. Worker retries and lease takeovers keep the
 *    single reservation; retrying a failed or cancelled export reserves again (its earlier credit was
 *    released), so a video is never paid twice.
 *  - AI generation (provider calls) is budgeted separately in cents (lib/providers, reserve_ai_budget) and
 *    never consumes the export credit.
 *
 * The database is the authority: public.limo_video_max_duration_ms and public.limo_video_export_credits
 * (migration 20261018090000) implement the same rule. Longer paid videos later = change those two
 * functions (e.g. per plan or add-on) and VIDEO_POLICY here; render jobs already store their own credit
 * count, so reservations and refunds stay exact.
 */
export const VIDEO_POLICY = {
  maxDurationSeconds: 30,
  creditsPerVideo: 1,
} as const;

export const VIDEO_MAX_DURATION_MS = VIDEO_POLICY.maxDurationSeconds * 1000;

/** True when a timeline of this many seconds can be exported. */
export function withinVideoLimit(totalSeconds: number): boolean {
  return Number.isFinite(totalSeconds) && totalSeconds > 0 && totalSeconds <= VIDEO_POLICY.maxDurationSeconds;
}

/** Export credits a finished video of this length consumes (V1: always 1). Throws above the limit. */
export function exportCreditsFor(totalSeconds: number): number {
  if (!withinVideoLimit(totalSeconds)) throw new RangeError(`Videos are limited to ${VIDEO_POLICY.maxDurationSeconds} seconds`);
  return VIDEO_POLICY.creditsPerVideo;
}

/** Seconds to remove before the timeline can be exported (0 when it already fits). */
export function secondsOverLimit(totalSeconds: number): number {
  return Math.max(0, Math.ceil(totalSeconds - VIDEO_POLICY.maxDurationSeconds));
}

/**
 * Worker-side check of a render spec (defence in depth: the database already refuses such jobs).
 * Returns an error message, or null when the spec is within the policy and consistent.
 */
export function checkSpecDuration(spec: { scenes: ReadonlyArray<{ duration_ms: number }> }, declaredTotalMs?: number): string | null {
  const total = spec.scenes.reduce((a, s) => a + (Number.isFinite(s.duration_ms) ? s.duration_ms : 0), 0);
  if (spec.scenes.length === 0 || total <= 0) return 'The video has no duration';
  if (total > VIDEO_MAX_DURATION_MS) return `Videos are limited to ${VIDEO_POLICY.maxDurationSeconds} seconds (this one is ${total / 1000} s)`;
  if (declaredTotalMs !== undefined && declaredTotalMs !== total) return 'Render timeline is inconsistent';
  return null;
}
