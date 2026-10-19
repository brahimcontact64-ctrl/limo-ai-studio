/**
 * Creative AI jobs (migration 20261019090000, table ai_jobs): pure request builders shared by the API (estimates,
 * validation) and the generator worker (execution). Kinds:
 *   social_caption   Facebook composer: headline, caption, hashtags, CTA from the customer's facts (Claude post_caption)
 *   social_rewrite   one paragraph rewritten (shorter / longer / tone / translate) — facts never added
 *   social_image     promotional image (Gemini image) in the Brand Kit colours, no text in the pixels
 *   animation_keyframe / animation_clip / animation_voice   one storyboard shot (Animation Studio)
 * Every result is a proposal: the customer reviews, edits, accepts or rejects it. Nothing is published or applied here.
 */
import type { CapabilityRequest, CharacterImageRequest, ImageRequest, Locale, TextRequest, VideoRequest, VoiceRequest } from '../providers/contracts.ts';
import { CANON_SPEC_VERSION } from '../characters/canon.ts';
import { operationKey } from '../providers/provenance.ts';
import { clipPrompt } from '../animation/scenario.ts';
import type { ProjectRow, ShotRow } from '../animation/storyboard.ts';

export const AI_JOB_KINDS = ['animation_keyframe', 'animation_clip', 'animation_voice', 'social_caption', 'social_rewrite', 'social_image'] as const;
export type AiJobKind = (typeof AI_JOB_KINDS)[number];

/** Feature flag per kind (all OFF by default) — on top of paid_generation for real providers. */
export const JOB_FLAG: Record<AiJobKind, string> = {
  animation_keyframe: 'animation_generation', animation_clip: 'animation_generation', animation_voice: 'animation_generation',
  social_caption: 'ai_social_text', social_rewrite: 'ai_social_text', social_image: 'ai_social_images',
};
/** Registry stage whose (owner-verified) row prices and enables the provider. */
export const JOB_STAGE: Record<AiJobKind, string> = {
  animation_keyframe: 'scene_image', animation_clip: 'scene_video', animation_voice: 'voice', social_caption: 'script', social_rewrite: 'script', social_image: 'scene_image',
};

import { REWRITE_MODES, SOCIAL_IMAGE_ASPECTS, type RewriteMode } from './constants.ts';
export { REWRITE_MODES, SOCIAL_IMAGE_ASPECTS, type RewriteMode };

export interface SocialInput {
  language: Locale;
  prompt?: string;
  text?: string;
  mode?: RewriteMode;
  target_language?: Locale;
  business_type?: string;
  tone?: string;
  facts?: Record<string, string>;
  brand?: { name?: string; cta?: string; primary?: string; secondary?: string; tone?: string };
  aspect?: keyof typeof SOCIAL_IMAGE_ASPECTS;
  purpose?: string;
}

const LANG: Record<Locale, string> = { en: 'English', fr: 'French', ar: 'Arabic', de: 'German' };
const clean = (o: Record<string, string> | undefined) => Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => typeof v === 'string' && v.trim()).map(([k, v]) => [k, v.trim().slice(0, 200)]));

/** Validates a social request coming from the API (the database checks flag, workspace and language again). */
export function validateSocialInput(kind: 'social_caption' | 'social_rewrite' | 'social_image', i: SocialInput): string[] {
  const e: string[] = [];
  if (!['en', 'fr', 'ar', 'de'].includes(i.language)) e.push('language');
  if (kind === 'social_rewrite') {
    if (!i.text?.trim()) e.push('text_required');
    if ((i.text ?? '').length > 3000) e.push('text_too_long');
    if (!i.mode || !(REWRITE_MODES as readonly string[]).includes(i.mode)) e.push('mode');
    if (i.mode === 'translate' && (!i.target_language || !['en', 'fr', 'ar', 'de'].includes(i.target_language))) e.push('target_language');
  } else {
    if (!i.prompt?.trim()) e.push('prompt_required');
    if ((i.prompt ?? '').length > 2000) e.push('prompt_too_long');
  }
  if (kind === 'social_image' && i.aspect && !(i.aspect in SOCIAL_IMAGE_ASPECTS)) e.push('aspect');
  return e;
}

export function socialRequest(kind: 'social_caption' | 'social_rewrite' | 'social_image', i: SocialInput, organizationId: string, requestKey: string): CapabilityRequest {
  const base = { organizationId, requestKey, locale: i.language };
  if (kind === 'social_caption') {
    const r: TextRequest = {
      ...base, kind: 'text', task: 'post_caption', maxOutputTokens: 1200,
      facts: { ...clean(i.facts), ...(i.brand?.name ? { brand: i.brand.name } : {}), ...(i.brand?.cta ? { call_to_action: i.brand.cta } : {}) },
      instructions: [
        `Write one Facebook post in ${LANG[i.language]} for a ${i.business_type ?? 'business'}.`,
        `Tone: ${i.tone ?? i.brand?.tone ?? 'friendly'}.`,
        'Return a headline, the caption (2–4 short paragraphs), 3–6 relevant hashtags and a call to action.',
        'Use only the facts given; a missing fact stays as a visible [placeholder].',
        `Request: ${(i.prompt ?? '').slice(0, 2000)}`,
      ].join('\n'),
    };
    return r;
  }
  if (kind === 'social_rewrite') {
    const how = i.mode === 'translate' ? `Translate it into ${LANG[i.target_language ?? i.language]}` : i.mode === 'shorter' ? 'Make it shorter' : i.mode === 'longer' ? 'Make it a little longer with more detail from the facts only' : i.mode === 'warmer' ? 'Make it warmer and friendlier' : 'Make it more professional';
    const r: TextRequest = { ...base, locale: i.mode === 'translate' ? (i.target_language ?? i.language) : i.language, kind: 'text', task: 'rewrite', maxOutputTokens: 900, facts: clean(i.facts), instructions: `${how}. Keep every fact, price and name exactly; add no new facts.\n\nText:\n${(i.text ?? '').slice(0, 3000)}` };
    return r;
  }
  const size = SOCIAL_IMAGE_ASPECTS[i.aspect ?? '1:1'];
  const colours = [i.brand?.primary, i.brand?.secondary].filter(Boolean).join(' and ');
  const r: ImageRequest = {
    ...base, kind: 'image', task: 'generate', inputAssetIds: [], size: { ...size }, count: 1,
    prompt: [`Promotional ${i.purpose ?? 'social media'} image: ${(i.prompt ?? '').slice(0, 1500)}`, colours ? `Use the brand colours ${colours}.` : '', 'Appetising, premium, well-lit, clean composition with space for a headline added later.'].filter(Boolean).join('\n'),
  };
  return r;
}

/** Keyframe of one shot: composes the shot's characters from their APPROVED references (identity lock). */
export function keyframeRequest(shot: ShotRow, project: Pick<ProjectRow, 'aspect' | 'language_code'>, organizationId: string, requestKey: string): ImageRequest | CharacterImageRequest {
  const size = project.aspect === '16:9' ? { width: 1920, height: 1080 } : { width: 1080, height: 1920 };
  const scene = { number: shot.shot_number, durationSeconds: shot.duration_seconds, description: shot.description, environment: shot.environment, characters: shot.characters, actions: shot.actions, expressions: shot.expressions, camera: shot.camera, dialogue: [] };
  const prompt = `${clipPrompt(scene, 'separate').replace('Smooth natural body and facial motion. ', '')}\nThis is the FIRST FRAME of the shot: a single still image, characters in their starting pose.`;
  const base = { organizationId, requestKey, locale: 'en' as const, size, count: 1, prompt };
  if (shot.characters.length && shot.reference_asset_ids.length) {
    // The attached references are validated by the database as APPROVED references of these characters (≤ 5 images).
    return { ...base, kind: 'character_image', references: [{ character: shot.characters.join('+'), specVersion: CANON_SPEC_VERSION, assetIds: shot.reference_asset_ids.slice(0, 5) }] };
  }
  return { ...base, kind: 'image', task: 'generate', inputAssetIds: [] };
}

/** Clip of one shot: Veo image-to-video from the approved first frame (optional last frame). Genuine motion. */
export function clipRequest(shot: ShotRow, project: Pick<ProjectRow, 'aspect' | 'language_code' | 'settings'>, organizationId: string, requestKey: string, firstFrame: string, lastFrame: string | null, videoTotalSeconds: number): VideoRequest {
  const scene = { number: shot.shot_number, durationSeconds: shot.duration_seconds, description: shot.description, environment: shot.environment, characters: shot.characters, actions: shot.actions, expressions: shot.expressions, camera: shot.camera, dialogue: shot.dialogue, sound: shot.sound || undefined };
  return {
    organizationId, requestKey, locale: project.language_code, kind: 'video', prompt: clipPrompt(scene, project.settings.voice_mode ?? 'separate'),
    firstFrameAssetId: firstFrame, lastFrameAssetId: lastFrame, references: [], durationSeconds: shot.duration_seconds, videoTotalSeconds, aspect: project.aspect, scriptRevisionId: `animation:${shot.id}:${shot.revision}`,
  };
}

/** Lines to speak in one shot (narration first, then dialogue), each with its own idempotent key. */
export function voiceLines(shot: ShotRow, language: Locale, voices: Record<string, string | undefined>, narratorVoice: string | null, organizationId: string): Array<{ line: number; speaker: string; request: VoiceRequest | null; missingVoice: boolean }> {
  const lines = [...(shot.narration.trim() ? [{ speaker: 'narrator', text: shot.narration }] : []), ...shot.dialogue.map((d) => ({ speaker: d.speaker, text: d.text }))];
  return lines.map((l, i) => {
    const voiceId = l.speaker === 'narrator' ? narratorVoice : voices[l.speaker];
    if (!voiceId) return { line: i, speaker: l.speaker, request: null, missingVoice: true };
    return {
      line: i, speaker: l.speaker, missingVoice: false,
      request: { organizationId, locale: language, kind: 'voice', text: l.text, voiceId, voiceProfileVersion: null, scriptRevisionId: `animation:${shot.id}:${shot.revision}`, requestKey: operationKey(['animation-voice', shot.id, shot.revision, i, voiceId, language, l.text]) },
    };
  });
}

/** Offsets of generated voice lines inside the shot: 300 ms after the cut, 250 ms between lines. */
export function placeVoiceLines(durationsMs: number[]): number[] {
  const out: number[] = [];
  let t = 300;
  for (const d of durationsMs) {
    out.push(t);
    t += d + 250;
  }
  return out;
}
