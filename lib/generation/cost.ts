/**
 * Mirrors the estimate computed inside public.request_studio_generation so the UI can show the
 * same number the database will reserve. Keep in sync with that function.
 */
export interface CostPolicy {
  script_flat_cents: number;
  voice_per_minute_cents: number;
  image_per_scene_cents: number;
  video_per_second_cents: number;
  render_flat_cents: number;
  retry_buffer_percent: number;
}

export interface CostInput {
  totalDurationSeconds: number;
  sceneCount: number;
  hasDialogue: boolean;
}

export interface CostBreakdown {
  script: number;
  voice: number;
  images: number;
  video: number;
  render: number;
  base: number;
  /** Reserved amount including the retry buffer (what the budget reservation holds). */
  reserved: number;
  slots: number;
}

export function estimateGenerationCost(policy: CostPolicy, input: CostInput): CostBreakdown {
  const voiceMinutes = Math.max(1, Math.ceil(input.totalDurationSeconds / 60));
  const script = policy.script_flat_cents;
  // The reservation always includes voice minutes; the voice stage is later skipped (cost 0) without dialogue.
  const voice = voiceMinutes * policy.voice_per_minute_cents;
  const images = input.sceneCount * policy.image_per_scene_cents;
  const video = input.totalDurationSeconds * policy.video_per_second_cents;
  const render = policy.render_flat_cents;
  const base = script + voice + images + video + render;
  const reserved = Math.ceil((base * (100 + policy.retry_buffer_percent)) / 100);
  return { script, voice, images, video, render, base, reserved, slots: Math.max(1, Math.ceil(input.totalDurationSeconds / 30)) };
}
