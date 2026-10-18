/**
 * Google Gemini image adapter (Interactions API, documented 2026-10-18) for image generation, editing with the
 * customer's product photos, and character-consistent images from approved canonical references.
 *
 *   POST https://generativelanguage.googleapis.com/v1beta/interactions   (header x-goog-api-key)
 *   { model, input: [{type:"text",text}, {type:"image",mime_type,data}...],
 *     response_format: {type:"image", mime_type, aspect_ratio, image_size} }
 *   → Interaction { id, status, steps[{type:"model_output", content:[{type:"image", data, mime_type}]}], usage }
 *
 * Reference limits (Nano Banana 2.1): 10 object + 4 character images; Pro: 6 object + 5 character + 3 style.
 * Every image carries a SynthID watermark (recorded in provenance). Text in the image is avoided on purpose:
 * LIMO keeps text as editable layers (Image Studio), so prices and claims are never baked into pixels.
 */
import { ProviderError, type CapabilityAdapter, type CapabilityResult, type CharacterImageRequest, type ImageRequest, type Provenance } from '../contracts.ts';
import { requestJson, type FetchLike } from '../http.ts';
import { sha256 } from '../provenance.ts';

export const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
export const GEMINI_IMAGE_MODEL = 'gemini-nano-banana-2.1';
export const GEMINI_CHARACTER_MODEL = 'gemini-3-pro-image';
export const GEMINI_PROVIDER = 'google';

/** Reference image limits per model (objects, characters), from the image generation guide. */
export const REFERENCE_LIMITS: Record<string, { objects: number; characters: number }> = {
  'gemini-nano-banana-2.1': { objects: 10, characters: 4 },
  'gemini-3.1-flash-image': { objects: 10, characters: 4 },
  'gemini-3-pro-image': { objects: 6, characters: 5 },
};

export interface GeminiImageConfig {
  apiKey: string;
  fetch: FetchLike;
  model?: string;
  timeoutMs?: number;
  /** Loads an input/reference image of this workspace by asset id (worker: Supabase Storage). */
  loadAsset: (assetId: string) => Promise<{ bytes: Uint8Array; mime: string }>;
}

export type ImageSize = '1K' | '2K' | '4K';

/** LIMO formats → Gemini aspect_ratio values (all four exist natively). */
export function geminiAspect(width: number, height: number): string {
  const r = width / height;
  const options: Array<[string, number]> = [['1:1', 1], ['4:5', 0.8], ['9:16', 9 / 16], ['16:9', 16 / 9], ['3:4', 0.75], ['4:3', 4 / 3]];
  return options.reduce((best, o) => (Math.abs(o[1] - r) < Math.abs(best[1] - r) ? o : best))[0];
}

export const imageSizeFor = (width: number, height: number): ImageSize => (Math.max(width, height) > 2048 ? '4K' : Math.max(width, height) > 1024 ? '2K' : '1K');

interface InteractionImage { type: string; data?: string; mime_type?: string }
interface Interaction {
  id?: string;
  status?: string;
  steps?: Array<{ type?: string; content?: InteractionImage[] }>;
  usage?: { total_input_tokens?: number; total_output_tokens?: number };
  errors?: Array<{ code?: string; message?: string }>;
}

/** All generated images of an interaction (model_output steps → image content blocks). */
export function imagesOf(i: Interaction): Array<{ bytes: Uint8Array; mime: string }> {
  const out: Array<{ bytes: Uint8Array; mime: string }> = [];
  for (const step of i.steps ?? []) {
    if (step.type !== 'model_output') continue;
    for (const c of step.content ?? []) if (c.type === 'image' && c.data) out.push({ bytes: new Uint8Array(Buffer.from(c.data, 'base64')), mime: c.mime_type ?? 'image/png' });
  }
  return out;
}

const refine = (status: number, body: string) => (status === 400 && /safety|blocked|prohibited|policy/i.test(body) ? 'content_refused' : null);

async function interact(cfg: GeminiImageConfig, model: string, parts: unknown[], aspect: string, size: ImageSize, signal: AbortSignal): Promise<Interaction> {
  const body = { model, input: parts, response_format: { type: 'image', mime_type: 'image/png', aspect_ratio: aspect, image_size: size } };
  const res = await requestJson<Interaction>(cfg.fetch, `${GEMINI_BASE}/interactions`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': cfg.apiKey }, body: JSON.stringify(body), timeoutMs: cfg.timeoutMs ?? 120_000, signal,
  }, refine);
  if (res.status === 'failed' || res.status === 'incomplete' || res.status === 'cancelled') {
    const msg = (res.errors ?? []).map((e) => `${e.code ?? ''} ${e.message ?? ''}`).join('; ');
    throw new ProviderError(/safety|block|policy/i.test(msg) ? 'content_refused' : 'unknown', `Gemini interaction ${res.status}: ${msg.slice(0, 300)}`);
  }
  return res;
}

const imagePart = (a: { bytes: Uint8Array; mime: string }) => ({ type: 'image', mime_type: a.mime, data: Buffer.from(a.bytes).toString('base64') });

function provenance(capability: Provenance['capability'], model: string, requestKey: string, prompt: string, input: string[], refs: string[], specVersions: Record<string, number> = {}, providerRequestId: string | null = null): Provenance {
  return {
    capability, provider: GEMINI_PROVIDER, model, modelVersion: null, requestKey, promptSha256: sha256(prompt), inputAssetIds: input, referenceAssetIds: refs,
    characterSpecVersions: specVersions, approvedBy: null, createdAt: new Date().toISOString(), costMicros: null, currency: null, aiGenerated: true,
    contentCredentials: 'SynthID', mock: false, providerRequestId,
  };
}

export const NO_TEXT_RULE = 'Do not render any words, letters, prices, logos or watermarks in the image; text is added later as editable layers.';

export function geminiImageAdapter(cfg: GeminiImageConfig): CapabilityAdapter<ImageRequest> {
  const model = cfg.model ?? GEMINI_IMAGE_MODEL;
  return {
    provider: GEMINI_PROVIDER, model, capability: 'image', paid: true, locales: ['en', 'fr', 'ar', 'de'],
    estimateUsage: (r) => ({ images: r.count, inputTokens: 300 + 600 * r.inputAssetIds.length }),
    async run(r, signal): Promise<CapabilityResult> {
      const limit = REFERENCE_LIMITS[model]?.objects ?? 6;
      if (r.inputAssetIds.length > limit) throw new ProviderError('invalid_request', `at most ${limit} input images for ${model}`);
      const inputs = await Promise.all(r.inputAssetIds.map((id) => cfg.loadAsset(id)));
      const keep = r.task === 'edit' ? 'Keep the product in the input photo exactly as it is (shape, colours, label, proportions); change only what is asked.' : '';
      const prompt = [r.prompt, keep, NO_TEXT_RULE].filter(Boolean).join('\n');
      const files: NonNullable<CapabilityResult['files']> = [];
      let inTok = 0;
      let outTok = 0;
      let lastId: string | null = null;
      for (let i = 0; i < r.count; i++) {
        const res = await interact(cfg, model, [{ type: 'text', text: prompt }, ...inputs.map(imagePart)], geminiAspect(r.size.width, r.size.height), imageSizeFor(r.size.width, r.size.height), signal);
        const imgs = imagesOf(res);
        if (imgs.length === 0) throw new ProviderError('content_refused', 'Gemini returned no image (possibly filtered)');
        files.push({ ...imgs[0]!, role: 'image' });
        inTok += res.usage?.total_input_tokens ?? 0;
        outTok += res.usage?.total_output_tokens ?? 0;
        lastId = res.id ?? lastId;
      }
      return { files, usage: { images: files.length, inputTokens: inTok, outputTokens: outTok }, provenance: provenance('image', model, r.requestKey, prompt, r.inputAssetIds, [], {}, lastId) };
    },
  };
}

export function geminiCharacterAdapter(cfg: GeminiImageConfig): CapabilityAdapter<CharacterImageRequest> {
  const model = cfg.model ?? GEMINI_CHARACTER_MODEL;
  return {
    provider: GEMINI_PROVIDER, model, capability: 'character_image', paid: true, locales: ['en', 'fr', 'ar', 'de'],
    estimateUsage: (r) => ({ images: r.count, inputTokens: 400 + 600 * r.references.reduce((a, x) => a + x.assetIds.length, 0) }),
    async run(r, signal): Promise<CapabilityResult> {
      const refIds = r.references.flatMap((x) => x.assetIds);
      const limit = REFERENCE_LIMITS[model]?.characters ?? 4;
      if (refIds.length === 0) throw new ProviderError('invalid_request', 'approved character references required');
      if (refIds.length > limit) throw new ProviderError('invalid_request', `at most ${limit} character reference images for ${model}`);
      const refs = await Promise.all(refIds.map((id) => cfg.loadAsset(id)));
      const who = r.references.map((x) => `${x.character} (design spec v${x.specVersion})`).join(', ');
      const prompt = `${r.prompt}\nThe reference images show the approved canonical characters ${who}. Keep their identity exactly: head shape, crown, colours, face layout, proportions and outfit details. ${NO_TEXT_RULE}`;
      const files: NonNullable<CapabilityResult['files']> = [];
      let lastId: string | null = null;
      for (let i = 0; i < r.count; i++) {
        const res = await interact(cfg, model, [{ type: 'text', text: prompt }, ...refs.map(imagePart)], geminiAspect(r.size.width, r.size.height), imageSizeFor(r.size.width, r.size.height), signal);
        const imgs = imagesOf(res);
        if (imgs.length === 0) throw new ProviderError('content_refused', 'Gemini returned no image (possibly filtered)');
        files.push({ ...imgs[0]!, role: 'image' });
        lastId = res.id ?? lastId;
      }
      const specVersions = Object.fromEntries(r.references.map((x) => [x.character, x.specVersion]));
      return { files, usage: { images: files.length }, provenance: provenance('character_image', model, r.requestKey, prompt, [], refIds, specVersions, lastId) };
    },
  };
}
