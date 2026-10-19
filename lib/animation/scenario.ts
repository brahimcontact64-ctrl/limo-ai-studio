/**
 * Scenario-driven animated character video: intake, validation, readiness and storyboard plan
 * (docs/ANIMATION_PIPELINE.md). The OWNER writes the scenario; this module never invents story, dialogue, characters,
 * setting or actions — prompts are assembled only from the scenario fields and the approved canonical identity text.
 *
 * Pipeline per shot (documented provider capabilities only):
 *   1. keyframe   Gemini 3 Pro Image with the APPROVED character references (≤ 5 character images per request) —
 *                 composes every character of the shot in the environment, identity locked by the references
 *   2. clip       Veo 3.1 image-to-video from that keyframe (4/6/8 s, 24 fps, 16:9 or 9:16) — genuine motion;
 *                 native audio (dialogue in quotes, sound effects) when voiceMode = 'native'
 *   3. voice      (voiceMode = 'separate') one TTS line per dialogue line with the character's fixed voice identity
 *   4. lipsync    (optional, EXPERIMENTAL, no adapter yet) re-time the mouths in the clip to the separate voice track
 *   5. review     continuity check of keyframe/clip against the references + human approval, then the MP4 export
 * Nothing here calls a provider; costs use the researched (unverified) list prices for planning only.
 */
import { CANON, EXPRESSION_KEYS, canonFor } from '../characters/canon.ts';
import { specFor } from '../characters/spec-versions.ts';
import { approvedVariant, expressionAllowed, variantSceneText, type SceneExpression } from '../characters/variants.ts';
import { VIDEO_POLICY } from '../video/policy.ts';
import type { Locale } from '../providers/contracts.ts';

export const SHOT_SECONDS = [4, 6, 8] as const;
/** Gemini 3 Pro Image: up to 5 character reference images per request. */
export const MAX_CHARACTER_REFERENCES = 5;
/** Above this many characters in one shot, identity and interaction quality are not reliable (documented single-subject references). */
export const RELIABLE_CHARACTERS_PER_SHOT = 2;
/** Spoken words per second that still sound natural (planning heuristic, not a provider limit). */
export const MAX_WORDS_PER_SECOND = 2.5;

export interface DialogueLine {
  speaker: string;
  text: string;
  emotion?: SceneExpression;
}

export interface ScenarioScene {
  number: number;
  durationSeconds: number;
  description: string;
  environment: string;
  /** Canonical ids (e.g. "limo_man") or workspace characters ("custom:<uuid>"); may be empty for commercial shots. */
  characters: string[];
  /** What each character does, in the owner's words: { "limo_man": "…" }. */
  actions: Record<string, string>;
  expressions?: Record<string, SceneExpression>;
  /** Approved scene variant per character (costume / expression on the unchanged canonical spec): { "adam_man": "adam_man.formal_angry" }. */
  variants?: Record<string, string>;
  /** Design-spec version per canonical character used in this scene ({ "adam_boy": 2 }); absent = version 1. */
  specVersions?: Record<string, number>;
  camera: string;
  dialogue: DialogueLine[];
  narration?: string;
  /** Sound effects / ambience for this shot. */
  sound?: string;
}

export interface Scenario {
  title: string;
  language: Locale;
  aspect: '9:16' | '16:9';
  scenes: ScenarioScene[];
  /** Background music direction (added in the final mix; never generated as a copy of existing music). */
  music?: string;
}

export interface ScenarioIssue {
  level: 'error' | 'warning';
  code: string;
  scene?: number;
  detail: string;
}

const isCharacterId = (id: string) => !!canonFor(id) || /^custom:[0-9a-f-]{36}$/i.test(id);
const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;

/** Structural and policy checks (V1: ≤ 30 s total). Errors block planning; warnings are shown to the owner. */
export function validateScenario(s: Scenario): ScenarioIssue[] {
  const out: ScenarioIssue[] = [];
  const err = (code: string, detail: string, scene?: number) => out.push({ level: 'error', code, scene, detail });
  const warn = (code: string, detail: string, scene?: number) => out.push({ level: 'warning', code, scene, detail });
  if (!s.title?.trim()) err('title_required', 'the scenario needs a title');
  if (!['en', 'fr', 'ar', 'de'].includes(s.language)) err('language', 'language must be en, fr, ar or de');
  if (s.language !== 'en') warn('language_quality', 'Veo documents full support for English only; native dialogue in other languages "may vary" — use voiceMode "separate" for reliable speech');
  if (!['9:16', '16:9'].includes(s.aspect)) err('aspect', 'Veo generates 16:9 or 9:16 only');
  if (!s.scenes?.length) err('scenes_required', 'at least one scene');
  const total = (s.scenes ?? []).reduce((a, x) => a + (x.durationSeconds || 0), 0);
  if (total > VIDEO_POLICY.maxDurationSeconds) err('video_too_long', `total ${total} s exceeds the ${VIDEO_POLICY.maxDurationSeconds} s V1 limit`);
  const numbers = new Set<number>();
  for (const sc of s.scenes ?? []) {
    const n = sc.number;
    if (numbers.has(n)) err('scene_number_duplicate', `scene ${n} appears twice`, n);
    numbers.add(n);
    if (!(SHOT_SECONDS as readonly number[]).includes(sc.durationSeconds)) err('shot_duration', 'each generated shot lasts 4, 6 or 8 s (Veo)', n);
    if (!sc.description?.trim()) err('description_required', 'describe what happens in the scene', n);
    if (!sc.environment?.trim()) err('environment_required', 'describe the setting', n);
    if (!sc.camera?.trim()) warn('camera_missing', 'no camera instruction (the model will choose)', n);
    for (const id of sc.characters) if (!isCharacterId(id)) err('unknown_character', `${id} is not a canonical or workspace character`, n);
    if (sc.characters.length > MAX_CHARACTER_REFERENCES) err('too_many_characters', `at most ${MAX_CHARACTER_REFERENCES} characters per shot (reference limit)`, n);
    else if (sc.characters.length > RELIABLE_CHARACTERS_PER_SHOT) warn('multi_character_risk', `${sc.characters.length} characters in one shot: identity and interaction are not guaranteed by any provider`, n);
    for (const id of sc.characters) if (!sc.actions?.[id]?.trim()) warn('action_missing', `no action for ${id}`, n);
    for (const [id, e] of Object.entries(sc.expressions ?? {})) {
      if (!sc.characters.includes(id)) err('expression_not_in_scene', `${id} has an expression but is not in the scene`, n);
      if (!expressionAllowed(e, sc.variants?.[id], id)) err('expression_unknown', `${e} is not one of ${EXPRESSION_KEYS.join(', ')} (nor of the selected approved variant)`, n);
    }
    for (const [id, v] of Object.entries(sc.specVersions ?? {})) {
      if (!sc.characters.includes(id) || (canonFor(id) && !specFor(id, v))) err('spec_version_unknown', `${id} has no design spec version ${v}`, n);
    }
    for (const [id, key] of Object.entries(sc.variants ?? {})) {
      if (!sc.characters.includes(id) || !approvedVariant(key, id)) err('variant_not_approved', `${key} is not an approved variant of ${id} in this scene`, n);
    }
    let spoken = words(sc.narration ?? '');
    for (const line of sc.dialogue ?? []) {
      if (!sc.characters.includes(line.speaker)) err('speaker_not_in_scene', `${line.speaker} speaks but is not in the scene`, n);
      if (!line.text?.trim()) err('dialogue_empty', 'empty dialogue line', n);
      if (line.emotion && !expressionAllowed(line.emotion, sc.variants?.[line.speaker], line.speaker)) err('expression_unknown', `${line.emotion} is not a known expression`, n);
      spoken += words(line.text ?? '');
    }
    if (spoken > Math.floor(sc.durationSeconds * MAX_WORDS_PER_SECOND)) warn('dialogue_too_long', `${spoken} words in ${sc.durationSeconds} s (natural pace ≤ ${Math.floor(sc.durationSeconds * MAX_WORDS_PER_SECOND)})`, n);
    if ((sc.dialogue ?? []).length > 0 && new Set(sc.dialogue.map((d) => d.speaker)).size > 1) warn('multi_speaker_shot', 'several speakers in one shot: lip-sync tools document one face at a time; consider one speaker per shot', n);
  }
  return out;
}

/** What the platform knows about a character before animation (from character_reference_assets and voice profiles). */
export interface CharacterReadiness {
  specApproved: boolean;
  /** Approved reference asset ids per view. */
  approvedViews: Partial<Record<'front' | 'three_quarter' | 'side' | 'back', string>>;
  /** Voice identity per language (character_voice_profiles): provider + voice id. */
  voices: Partial<Record<Locale, { provider: string; voiceRef: string }>>;
}

/** Everything that must exist before ANY paid animation call (characters first: approved artwork before animation). */
export function readinessBlockers(s: Scenario, state: Record<string, CharacterReadiness | undefined>, voiceMode: 'native' | 'separate'): string[] {
  const out: string[] = [];
  const used = [...new Set(s.scenes.flatMap((x) => x.characters))];
  for (const id of used) {
    const c = state[id];
    if (!c?.specApproved) out.push(`${id}: design spec not approved`);
    for (const v of ['front', 'three_quarter', 'side'] as const) if (!c?.approvedViews[v]) out.push(`${id}: no approved ${v} reference`);
    const speaks = s.scenes.some((x) => x.dialogue.some((d) => d.speaker === id));
    if (speaks && voiceMode === 'separate' && !c?.voices[s.language]) out.push(`${id}: no voice identity for ${s.language}`);
  }
  return out;
}

export type ShotOpKind = 'keyframe' | 'clip' | 'voice' | 'lipsync' | 'continuity_review';
export interface ShotOp {
  kind: ShotOpKind;
  provider: string;
  model: string;
  /** Planning cost per take in USD (researched list price, unverified). */
  usd: number;
  experimental?: boolean;
  detail: string;
}
export interface Shot {
  scene: number;
  seconds: number;
  characters: string[];
  referenceAssetIds: string[];
  clipPrompt: string;
  ops: ShotOp[];
}

export interface StoryboardOptions {
  tier: 'fast' | 'standard';
  resolution: '720p' | '1080p';
  voiceMode: 'native' | 'separate';
  lipSync: boolean;
  /** Expected generations per shot until one is approved (iteration is normal for character animation). */
  takes: number;
}

/** Researched list prices used for PLANNING only (sources in docs/ANIMATION_PIPELINE.md §4). */
export const PLANNING_PRICES = {
  keyframePro2K: 0.134,
  veoPerSecond: { standard: { '720p': 0.4, '1080p': 0.4 }, fast: { '720p': 0.1, '1080p': 0.12 } },
  ttsPerLine: 0.01,
  lipsyncPerSecond: 0.05,
  reviewPerShot: 0.02,
} as const;

const VEO_MODEL = { standard: 'veo-3.1-generate-preview', fast: 'veo-3.1-fast-generate-preview' } as const;

/** The clip prompt: owner's scene fields + identity text of each character. Dialogue in quotes only for native audio. */
export function clipPrompt(sc: ScenarioScene, voiceMode: 'native' | 'separate'): string {
  const who = sc.characters.map((id) => {
    const spec = specFor(id, sc.specVersions?.[id]);
    const expr = sc.expressions?.[id] ? ` Expression: ${sc.expressions[id]}.` : '';
    return `${spec ? spec.consistency.identity_prompt : id}${variantSceneText(sc.variants?.[id], id)} Action: ${sc.actions?.[id] ?? ''}.${expr}`;
  });
  const talk = voiceMode === 'native'
    ? sc.dialogue.map((d) => `${canonFor(d.speaker)?.character_id ?? d.speaker} says: "${d.text}"`)
    : sc.dialogue.length ? ['The speaking character moves the mouth naturally while talking (voice added separately).'] : [];
  return [
    `Scene: ${sc.description}`,
    `Setting: ${sc.environment}`,
    ...who,
    sc.camera ? `Camera: ${sc.camera}` : '',
    ...talk,
    voiceMode === 'native' && sc.sound ? `Sound: ${sc.sound}` : '',
    'Keep every character exactly as in the first frame: same colours, crown, face layout, proportions and outfit. Smooth natural body and facial motion. No text on screen.',
  ].filter(Boolean).join('\n');
}

export function storyboard(s: Scenario, state: Record<string, CharacterReadiness | undefined>, o: StoryboardOptions): { shots: Shot[]; perTakeUsd: number; expectedUsd: number; seconds: number } {
  const shots: Shot[] = s.scenes.map((sc) => {
    // Two references per character (front + three-quarter), capped at the model's character-reference limit.
    const refs = sc.characters.flatMap((id) => [state[id]?.approvedViews.front, state[id]?.approvedViews.three_quarter].filter(Boolean) as string[]).slice(0, MAX_CHARACTER_REFERENCES);
    const ops: ShotOp[] = [
      { kind: 'keyframe', provider: 'google', model: 'gemini-3-pro-image', usd: PLANNING_PRICES.keyframePro2K, detail: `first frame with ${refs.length} approved reference image(s)` },
      { kind: 'clip', provider: 'google', model: VEO_MODEL[o.tier], usd: PLANNING_PRICES.veoPerSecond[o.tier][o.resolution] * sc.durationSeconds, detail: `image-to-video ${sc.durationSeconds} s ${o.resolution} ${s.aspect}${o.voiceMode === 'native' ? ', native audio' : ''}` },
    ];
    if (o.voiceMode === 'separate') {
      for (const d of sc.dialogue) ops.push({ kind: 'voice', provider: state[d.speaker]?.voices[s.language]?.provider ?? 'unassigned', model: 'tts', usd: PLANNING_PRICES.ttsPerLine, detail: `${d.speaker}: fixed voice identity` });
      if (sc.narration?.trim()) ops.push({ kind: 'voice', provider: 'narrator', model: 'tts', usd: PLANNING_PRICES.ttsPerLine, detail: 'narration' });
      if (o.lipSync && sc.dialogue.length) ops.push({ kind: 'lipsync', provider: 'sync.so', model: 'lipsync-2', usd: PLANNING_PRICES.lipsyncPerSecond * sc.durationSeconds, experimental: true, detail: 'mouth re-timing to the separate voice (no LIMO adapter; works on stylized faces unverified)' });
    }
    ops.push({ kind: 'continuity_review', provider: 'anthropic', model: 'claude-opus-5-5', usd: PLANNING_PRICES.reviewPerShot, detail: 'keyframe vs approved references (colours, crown, face, outfit) before the clip; human approval after' });
    return { scene: sc.number, seconds: sc.durationSeconds, characters: sc.characters, referenceAssetIds: refs, clipPrompt: clipPrompt(sc, o.voiceMode), ops };
  });
  const perTakeUsd = round(shots.reduce((a, x) => a + x.ops.reduce((b, op) => b + op.usd, 0), 0));
  // Keyframes and clips are re-generated per take; voices, lip-sync and reviews are counted once per take as well (conservative).
  return { shots, perTakeUsd, expectedUsd: round(perTakeUsd * Math.max(1, o.takes)), seconds: shots.reduce((a, x) => a + x.seconds, 0) };
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/** Canonical ids, for the scenario form. */
export const CANONICAL_CHARACTER_IDS = CANON.map((c) => c.character_id);
