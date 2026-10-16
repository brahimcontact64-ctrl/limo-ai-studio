/**
 * Limits enforced by the live Supabase backend. Keep in sync with:
 * - public.save_studio_project (migration 20261016061058)
 * - trigger guard_project_scene_duration_v1 (1..15 s per scene, stricter than the RPC's 120 s)
 * - studio_projects_project_cast_check1 (1..18 once migration 20261016120000 is applied)
 */
export const LIMITS = {
  castMin: 1,
  castMax: 18,
  scenesMin: 1,
  scenesMax: 25,
  sceneDurationMin: 1,
  sceneDurationMax: 15,
  totalDurationMax: 600,
  titleMax: 200,
  briefMax: 8000,
  goalMax: 1000,
  visualStyleMax: 1000,
  sceneTitleMax: 200,
  /** Seconds of finished video per usage slot (normalize_studio_project_slots). */
  secondsPerSlot: 30,
} as const;

/** Per-field maximum lengths applied by save_studio_project. */
export const SCENE_FIELD_MAX = {
  title: 200,
  location_prompt: 1500,
  environment_prompt: 1500,
  camera_prompt: 1000,
  lighting_prompt: 1000,
  action_prompt: 2500,
  dialogue: 4000,
  on_screen_text: 1500,
  effects_prompt: 1500,
  music_prompt: 1000,
  transition_out: 500,
  continuity_notes: 1500,
} as const;

export const CHARACTER_FAMILIES = ['limo', 'nova', 'adam'] as const;
export const CHARACTER_VARIANTS = ['boy', 'girl', 'man', 'woman', 'elder_man', 'elder_woman'] as const;
export type CharacterFamily = (typeof CHARACTER_FAMILIES)[number];
export type CharacterVariant = (typeof CHARACTER_VARIANTS)[number];

/** The 18 cast variants. Family base records (limo, nova, adam) are deliberately excluded. */
export const CHARACTER_ID_PATTERN = /^(limo|nova|adam)_(boy|girl|man|woman|elder_man|elder_woman)$/;

export function isCastVariantId(id: unknown): id is string {
  return typeof id === 'string' && CHARACTER_ID_PATTERN.test(id);
}

export function parseCharacterId(id: string): { family: CharacterFamily; variant: CharacterVariant } | null {
  const m = CHARACTER_ID_PATTERN.exec(id);
  if (!m) return null;
  return { family: m[1] as CharacterFamily, variant: m[2] as CharacterVariant };
}

export function estimateSlots(totalSeconds: number): number {
  return Math.max(1, Math.ceil(totalSeconds / LIMITS.secondsPerSlot));
}
