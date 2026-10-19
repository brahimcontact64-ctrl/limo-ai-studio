/**
 * Mock adapters (Milestone 10): the same contracts as the real ones, no network, no cost, and every output is
 * labelled `mock: true` in its provenance and in the UI. They let the whole generation pipeline (planner →
 * worker → storage → proposals → MP4 export) be tested end to end without a single paid call.
 *  - text/story/translation: deterministic text built only from the given script, never new facts
 *  - image/character: a plain colour PNG (no artwork pretended)
 *  - video: no clip — the proposal says "use the scene image as a still" (honest: nothing was animated)
 *  - voice: a quiet tone WAV of the narration's reading length with evenly spaced subtitle cues
 *  - safety: allow (the real check is the moderation provider)
 */
import { deflateSync } from 'node:zlib';
import type { AsyncCapabilityAdapter, CapabilityAdapter, CapabilityResult, CharacterImageRequest, ImageRequest, Provenance, SafetyRequest, StoryRequest, TextRequest, TranslationRequest, VideoRequest, VoiceRequest, TranscriptionRequest } from './contracts.ts';
import { sha256 } from './provenance.ts';

export const MOCK_PROVIDER = 'limo-mock';

function prov(capability: Provenance['capability'], requestKey: string, prompt: string, extra: Partial<Provenance> = {}): Provenance {
  return {
    capability, provider: MOCK_PROVIDER, model: `mock-${capability}`, modelVersion: '1', requestKey, promptSha256: sha256(prompt), inputAssetIds: [], referenceAssetIds: [],
    characterSpecVersions: {}, approvedBy: null, createdAt: new Date().toISOString(), costMicros: 0, currency: 'USD', aiGenerated: false, contentCredentials: null, mock: true, providerRequestId: null, ...extra,
  };
}

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(Buffer.from(type, 'ascii'), 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** A solid-colour RGB PNG (valid file; used for mock images). */
export function solidPng(width: number, height: number, rgb: [number, number, number]): Uint8Array {
  const raw = new Uint8Array((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x++) raw.set(rgb, row + 1 + x * 3);
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', new Uint8Array(deflateSync(raw))), chunk('IEND', new Uint8Array())];
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** 16-bit mono PCM WAV with a quiet 220 Hz tone (audible enough to verify mixing, clearly not a voice). */
export function toneWav(seconds: number, rate = 22050): Uint8Array {
  const n = Math.max(1, Math.round(seconds * rate));
  const out = new Uint8Array(44 + n * 2);
  const dv = new DataView(out.buffer);
  const w = (o: number, s: string) => out.set(Buffer.from(s, 'ascii'), o);
  w(0, 'RIFF');
  dv.setUint32(4, 36 + n * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true);
  dv.setUint32(28, rate * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  w(36, 'data');
  dv.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, Math.round(Math.sin((2 * Math.PI * 220 * i) / rate) * 1200), true);
  return out;
}

const colourOf = (s: string): [number, number, number] => {
  const h = sha256(s);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};
/** Reading time used for mock narration: ~15 characters per second, at least 1 s. */
export const readingSeconds = (text: string) => Math.max(1, Math.round((text.trim().length / 15) * 10) / 10);

const base = { provider: MOCK_PROVIDER, paid: false, locales: ['en', 'fr', 'ar', 'de'] as const } as const;

export function mockTextAdapter(): CapabilityAdapter<TextRequest> {
  return {
    ...base, locales: [...base.locales], model: 'mock-text', capability: 'text', estimateUsage: () => ({ requests: 1 }),
    async run(r) {
      let json: Record<string, unknown>;
      if (r.task === 'scene_prompts') {
        const scenes = (JSON.parse(r.facts.scenes ?? '[]') as Array<{ scene_number: number; visual_prompt?: string; narration?: string; title?: string }>).map((s) => ({
          scene_number: s.scene_number,
          image_prompt: [s.visual_prompt, s.title].filter(Boolean).join('. ') || `Scene ${s.scene_number}`,
          motion_prompt: 'Slow, steady camera push-in.',
        }));
        json = { scenes };
      } else if (r.task === 'post_caption') {
        // Honest mock: only the customer's facts, clearly labelled; never presented as AI writing.
        const f = r.facts;
        json = {
          headline: `[Mock AI] ${f.business_name || f.brand || '[business]'}`,
          caption: `[Mock AI caption — no AI was used] ${[f.product_name, f.offer, f.price, f.location, f.hours].filter(Boolean).join(' · ') || '[facts]'}`,
          hashtags: [],
          cta: f.call_to_action || '',
        };
      } else if (r.task === 'rewrite') {
        const text = r.instructions.split('Text:\n')[1] ?? r.instructions;
        json = { text: `[Mock rewrite — no AI was used] ${text}` };
      } else json = { text: r.instructions };
      return { text: JSON.stringify(json), json, issues: [], usage: { requests: 1 }, provenance: prov('text', r.requestKey, r.instructions) };
    },
  };
}

export function mockStoryAdapter(): CapabilityAdapter<StoryRequest> {
  return {
    ...base, locales: [...base.locales], model: 'mock-story', capability: 'story', estimateUsage: () => ({ requests: 1 }),
    async run(r) {
      const json = { title: 'Next episode', scenes: [], uses_canon: [] };
      return { text: JSON.stringify(json), json, issues: [], usage: { requests: 1 }, provenance: prov('story', r.requestKey, r.bible, { characterSpecVersions: r.characterSpecVersions }) };
    },
  };
}

export function mockTranslationAdapter(): CapabilityAdapter<TranslationRequest> {
  return {
    ...base, locales: [...base.locales], model: 'mock-translation', capability: 'translation', estimateUsage: () => ({ requests: 1 }),
    async run(r) {
      const text = `[Mock translation → ${r.locale.toUpperCase()}] ${r.text}`;
      return { text, json: { text }, issues: [], usage: { requests: 1 }, provenance: prov('translation', r.requestKey, r.text) };
    },
  };
}

export function mockImageAdapter(): CapabilityAdapter<ImageRequest> {
  return {
    ...base, locales: [...base.locales], model: 'mock-image', capability: 'image', estimateUsage: (r) => ({ images: r.count }),
    async run(r) {
      const w = Math.min(512, r.size.width);
      const h = Math.max(2, Math.round((w * r.size.height) / r.size.width));
      const files = Array.from({ length: r.count }, (_, i) => ({ bytes: solidPng(w, h, colourOf(`${r.prompt}#${i}`)), mime: 'image/png', role: 'image' as const }));
      return { files, usage: { images: r.count }, provenance: prov('image', r.requestKey, r.prompt, { inputAssetIds: r.inputAssetIds }) };
    },
  };
}

export function mockCharacterAdapter(): CapabilityAdapter<CharacterImageRequest> {
  return {
    ...base, locales: [...base.locales], model: 'mock-character', capability: 'character_image', estimateUsage: (r) => ({ images: r.count }),
    async run(r) {
      const files = Array.from({ length: r.count }, (_, i) => ({ bytes: solidPng(384, 512, colourOf(`${r.prompt}#${i}`)), mime: 'image/png', role: 'image' as const }));
      return {
        files, usage: { images: r.count },
        provenance: prov('character_image', r.requestKey, r.prompt, { referenceAssetIds: r.references.flatMap((x) => x.assetIds), characterSpecVersions: Object.fromEntries(r.references.map((x) => [x.character, x.specVersion])) }),
      };
    },
  };
}

/** Mock video: nothing is animated; the result points the renderer at the scene's still image. */
export function mockVideoAdapter(): AsyncCapabilityAdapter<VideoRequest> {
  return {
    ...base, locales: [...base.locales], model: 'mock-video', capability: 'video', estimateUsage: (r) => ({ videoSeconds: r.durationSeconds }),
    async submit(r) {
      return { taskId: `mock:${r.requestKey}`, pollAfterMs: 0, plan: { seconds: r.durationSeconds } };
    },
    async poll(taskId) {
      return { status: 'succeeded', outputRef: taskId };
    },
    async fetchResult(r) {
      return { files: [], json: { still_asset_id: r.firstFrameAssetId, animated: false }, usage: { videoSeconds: 0 }, provenance: prov('video', r.requestKey, r.prompt, { inputAssetIds: r.firstFrameAssetId ? [r.firstFrameAssetId] : [] }) };
    },
  };
}

export function mockVoiceAdapter(): CapabilityAdapter<VoiceRequest> {
  return {
    ...base, locales: [...base.locales], model: 'mock-voice', capability: 'voice', estimateUsage: (r) => ({ characters: r.text.length }),
    async run(r): Promise<CapabilityResult> {
      const seconds = readingSeconds(r.text);
      const words = r.text.trim().split(/\s+/).filter(Boolean);
      const per = (seconds * 1000) / Math.max(1, words.length);
      const subtitles: NonNullable<CapabilityResult['subtitles']> = [];
      words.forEach((w, i) => {
        const last = subtitles[subtitles.length - 1];
        const s = Math.round(i * per);
        const e = Math.round((i + 1) * per);
        if (last && last.text.length + w.length < 42 && e - last.startMs <= 3000) {
          last.text += ` ${w}`;
          last.endMs = e;
        } else subtitles.push({ startMs: s, endMs: e, text: w });
      });
      return { files: [{ bytes: toneWav(seconds), mime: 'audio/wav', role: 'audio' }], subtitles, usage: { characters: r.text.length, audioSeconds: seconds }, provenance: prov('voice', r.requestKey, r.text, { voiceId: r.voiceId }) };
    },
  };
}

export function mockTranscriptionAdapter(): CapabilityAdapter<TranscriptionRequest> {
  return {
    ...base, locales: [...base.locales], model: 'mock-transcription', capability: 'transcription', estimateUsage: (r) => ({ audioSeconds: r.durationSeconds }),
    async run(r) {
      return { text: '', subtitles: [], usage: { audioSeconds: 0 }, provenance: prov('transcription', r.requestKey, r.audioAssetId, { inputAssetIds: [r.audioAssetId] }) };
    },
  };
}

export function mockSafetyAdapter(): CapabilityAdapter<SafetyRequest> {
  return {
    ...base, locales: [...base.locales], model: 'mock-safety', capability: 'safety', estimateUsage: () => ({ requests: 1 }),
    async run(r) {
      return { json: { decision: 'allow', categories: [] }, usage: { requests: 1 }, provenance: prov('safety', r.requestKey, r.text) };
    },
  };
}
