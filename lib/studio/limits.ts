import { VIDEO_POLICY } from '../video/policy.ts';

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
  /** Longest draft the database saves. Exports are limited separately to 30 s (lib/video/policy.ts); longer
   *  drafts stay saved (never truncated) but must be shortened before approval and export. */
  totalDurationMax: 600,
  titleMax: 200,
  briefMax: 8000,
  goalMax: 1000,
  visualStyleMax: 1000,
  sceneTitleMax: 200,
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
  narration: 4000,
  visual_prompt: 2500,
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

/** Workspace characters in a project cast: "custom:<uuid>" (characters table). */
export const CUSTOM_CHARACTER_PATTERN = /^custom:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isCustomCastId(id: unknown): id is string {
  return typeof id === 'string' && CUSTOM_CHARACTER_PATTERN.test(id);
}

/** Any id allowed in a project cast: one of the 18 variants or a workspace character. */
export function isCastId(id: unknown): id is string {
  return isCastVariantId(id) || isCustomCastId(id);
}

export function parseCharacterId(id: string): { family: CharacterFamily; variant: CharacterVariant } | null {
  const m = CHARACTER_ID_PATTERN.exec(id);
  if (!m) return null;
  return { family: m[1] as CharacterFamily, variant: m[2] as CharacterVariant };
}

/** Video credits one finished export uses: one per video whatever its length (V1 policy, lib/video/policy.ts). */
export function exportCreditsPerVideo(): number {
  return VIDEO_POLICY.creditsPerVideo;
}
