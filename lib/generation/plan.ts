/**
 * AI generation planner (Milestone 10): approved script revision → the provider operations needed, with costs.
 *
 * Rules:
 *  - Only an APPROVED script revision is planned; its text is never changed (the plan only adds visuals/voice).
 *  - Total length ≤ 30 s (V1 video policy). Each scene keeps its approved order and duration.
 *  - Scenes that show canonical or workspace characters need their approved reference images; otherwise those
 *    scenes are blocked (`missing_character_reference`) — product scenes without characters are never blocked.
 *  - The customer's own photo/clip of a scene is used as is (no image generation); a photo can still be animated.
 *  - Footage is generated once per scene in 9:16 or 16:9 (`generationAspect`) and reused for every export
 *    format: the operation key does not contain the export aspect, so a 1:1 or 4:5 export never pays again.
 *  - Every operation has an idempotency key (same revision + scene + prompt + model = same key = no second charge)
 *    and a cost from a VERIFIED price sheet; an unverified price makes the plan unpayable (`price_unverified`).
 */
import { operationCost, PriceSheetError, type PriceSheet, type Usage } from '../providers/contracts.ts';
import { operationKey, sha256 } from '../providers/provenance.ts';
import { priceKey } from '../providers/prices.ts';
import { veoDuration } from '../providers/adapters/veo.ts';
import { VIDEO_POLICY } from '../video/policy.ts';

export interface PlanScene {
  scene_number: number;
  duration_seconds: number;
  title: string;
  narration: string;
  dialogue: string;
  visual_prompt: string;
  camera_prompt: string;
  participants: string[];
  /** The customer's own media chosen for the scene (image or clip), if any. */
  media?: { asset_id: string; media_type: 'image' | 'video' } | null;
}

export interface CharacterReference {
  /** Cast id (e.g. limo_boy or custom:<uuid>). */
  id: string;
  name: string;
  specVersion: number;
  /** Approved reference image asset ids (front, three-quarter, side…). Empty = not ready. */
  assetIds: string[];
  identityText: string;
  /** Approved voice per language (character voice profile). */
  voiceIds?: Partial<Record<string, string>>;
}

export interface PlanOptions {
  images: boolean;
  video: boolean;
  voice: boolean;
  videoTier: 'standard' | 'fast' | 'lite';
  resolution: '720p' | '1080p';
  imageModel: string;
  /** Model for scenes that show characters (approved references as identity lock). */
  characterImageModel: string;
  imageSize: '1K' | '2K';
  voiceModel: string;
  narratorVoiceId: string | null;
  textModel: string;
  /** Voice provider: 'elevenlabs' (characters) or 'google' (Gemini TTS, tokens). Default elevenlabs. */
  voiceProvider?: 'elevenlabs' | 'google';
  /** Safety provider: 'openai' (free moderation) or 'anthropic' (Claude review with textModel). Default openai. */
  safetyProvider?: 'openai' | 'anthropic';
}

export interface PlanInput {
  projectId: string;
  revisionId: string;
  language: string;
  /** Preferred export aspect; footage is generated in 9:16 (portrait, square, 4:5) or 16:9. */
  aspect: '9:16' | '16:9' | '1:1' | '4:5';
  scenes: PlanScene[];
  characters: CharacterReference[];
  styleHint: string;
  options: PlanOptions;
}

export type OpKind = 'safety' | 'scene_prompts' | 'scene_image' | 'scene_video' | 'voice';

export interface PlannedOp {
  kind: OpKind;
  scene: number | null;
  key: string;
  provider: string;
  model: string;
  priceKey: string;
  usage: Usage;
  costMicros: number | null;
  prompt: string;
  /** For video: the generated clip length (4/6/8 s) and the scene length it covers. */
  clipSeconds?: number;
  references?: string[];
  blocked?: 'missing_character_reference' | 'price_unverified';
}

export interface Plan {
  ops: PlannedOp[];
  totalSeconds: number;
  generationAspect: '9:16' | '16:9';
  /** Sum of all operation costs (micro-USD); null when any price is unverified. */
  totalMicros: number | null;
  /** Rounded up to cents, plus the retry buffer: what the budget reservation must hold. */
  reserveCents: number | null;
  blockers: string[];
}

export const generationAspect = (a: PlanInput['aspect']): '9:16' | '16:9' => (a === '16:9' ? '16:9' : '9:16');

const VEO_MODEL = { standard: 'veo-3.1-generate-preview', fast: 'veo-3.1-fast-generate-preview', lite: 'veo-3.1-lite-generate-preview' } as const;

export function buildPlan(input: PlanInput, prices: Record<string, PriceSheet>, opts: { retryBufferPercent: number; now?: Date } = { retryBufferPercent: 25 }): Plan {
  const total = input.scenes.reduce((a, s) => a + s.duration_seconds, 0);
  const blockers: string[] = [];
  if (total > VIDEO_POLICY.maxDurationSeconds) blockers.push(`video_too_long:${total}`);
  if (input.scenes.length === 0) blockers.push('no_scenes');
  const o = input.options;
  const aspect = generationAspect(input.aspect);
  const byId = new Map(input.characters.map((c) => [c.id, c]));
  const ops: PlannedOp[] = [];
  const cost = (key: string, usage: Usage): number | null => {
    const sheet = prices[key];
    if (!sheet) return null;
    try {
      return operationCost(sheet, usage, { now: opts.now }).micros;
    } catch (e) {
      if (e instanceof PriceSheetError) return null;
      throw e;
    }
  };
  const add = (op: Omit<PlannedOp, 'costMicros'>) => {
    const c = op.provider === 'limo-mock' ? 0 : cost(op.priceKey, op.usage);
    ops.push({ ...op, costMicros: c, blocked: op.blocked ?? (c === null ? 'price_unverified' : undefined) });
  };
  const scriptText = input.scenes.map((s) => [s.title, s.narration, s.dialogue, s.visual_prompt].join(' ')).join('\n');

  if (o.safetyProvider === 'anthropic') {
    const images = input.scenes.filter((s) => s.media?.media_type === 'image').length;
    add({ kind: 'safety', scene: null, key: operationKey([input.revisionId, 'safety', 'anthropic', o.textModel, sha256(scriptText)]), provider: 'anthropic', model: o.textModel, priceKey: priceKey('anthropic', o.textModel), usage: { inputTokens: Math.ceil(scriptText.length / 3) + 1600 * Math.min(images, 6) + 700, outputTokens: 400 }, prompt: '' });
  } else {
    add({ kind: 'safety', scene: null, key: operationKey([input.revisionId, 'safety', sha256(scriptText)]), provider: 'openai', model: 'omni-moderation-latest', priceKey: priceKey('openai', 'omni-moderation-latest'), usage: { requests: 1 }, prompt: '' });
  }
  if (o.images || o.video) {
    const chars = Math.ceil(scriptText.length / 3) + 1500;
    add({ kind: 'scene_prompts', scene: null, key: operationKey([input.revisionId, 'scene_prompts', o.textModel, sha256(scriptText)]), provider: 'anthropic', model: o.textModel, priceKey: priceKey('anthropic', o.textModel), usage: { inputTokens: chars, outputTokens: 300 * input.scenes.length + 200 }, prompt: scriptText });
  }

  for (const s of input.scenes) {
    const refs = s.participants.map((p) => byId.get(p));
    const missingRef = s.participants.some((p, i) => !refs[i] || refs[i]!.assetIds.length === 0);
    const refIds = refs.flatMap((r) => (r ? r.assetIds.slice(0, 2) : [])).slice(0, 4);
    const identity = refs.filter(Boolean).map((r) => r!.identityText).join(' ');
    const basePrompt = [s.visual_prompt || s.title, identity, input.styleHint].filter(Boolean).join('\n');
    const userImage = s.media?.media_type === 'image' ? s.media.asset_id : null;
    const userClip = s.media?.media_type === 'video';
    if (o.images && !s.media) {
      const size = o.imageSize;
      const model = refIds.length ? o.characterImageModel : o.imageModel;
      add({
        kind: 'scene_image', scene: s.scene_number, key: operationKey([input.revisionId, s.scene_number, 'image', model, size, aspect, sha256(basePrompt), refIds.join(',')]),
        provider: 'google', model, priceKey: priceKey('google', model, size), usage: { images: 1, inputTokens: 300 + 600 * refIds.length }, prompt: basePrompt, references: refIds,
        blocked: missingRef ? 'missing_character_reference' : undefined,
      });
    }
    if (o.video && !userClip) {
      const needs8 = refIds.length > 0 || o.resolution !== '720p';
      const clip = veoDuration(s.duration_seconds, needs8);
      const model = VEO_MODEL[o.videoTier];
      add({
        kind: 'scene_video', scene: s.scene_number, key: operationKey([input.revisionId, s.scene_number, 'video', model, o.resolution, aspect, clip, sha256(`${basePrompt}|${s.camera_prompt}`), userImage ?? '', refIds.join(',')]),
        provider: 'google', model, priceKey: priceKey('google', model, o.resolution), usage: { videoSeconds: clip }, prompt: [basePrompt, s.camera_prompt].filter(Boolean).join('\n'),
        clipSeconds: clip, references: o.videoTier === 'lite' ? [] : refIds.slice(0, 3), blocked: missingRef ? 'missing_character_reference' : undefined,
      });
    }
    const spoken = [s.narration, s.dialogue].filter((t) => t.trim()).join(' ').trim();
    if (o.voice && spoken) {
      const voiceId = o.narratorVoiceId ?? '';
      add({
        kind: 'voice', scene: s.scene_number, key: operationKey([input.revisionId, s.scene_number, 'voice', o.voiceModel, voiceId, input.language, sha256(spoken)]),
        ...(o.voiceProvider === 'google'
          ? { provider: 'google', model: o.voiceModel, priceKey: priceKey('google', o.voiceModel), usage: { inputTokens: Math.ceil(spoken.length / 2) + 50, outputTokens: Math.ceil((spoken.length / 12) * 32 * 1.5) + 100 } }
          : { provider: 'elevenlabs', model: o.voiceModel, priceKey: priceKey('elevenlabs', o.voiceModel), usage: { characters: spoken.length } }),
        prompt: spoken,
      });
    }
  }

  if (ops.some((x) => x.blocked === 'missing_character_reference')) blockers.push('missing_character_reference');
  if (ops.some((x) => x.blocked === 'price_unverified')) blockers.push('price_unverified');
  const totalMicros = ops.some((x) => x.costMicros === null) ? null : ops.reduce((a, x) => a + (x.costMicros ?? 0), 0);
  const reserveCents = totalMicros === null ? null : Math.ceil((Math.ceil(totalMicros / 10_000) * (100 + opts.retryBufferPercent)) / 100);
  return { ops, totalSeconds: total, generationAspect: aspect, totalMicros, reserveCents, blockers: [...new Set(blockers)] };
}
