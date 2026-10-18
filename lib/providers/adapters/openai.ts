/**
 * OpenAI adapters (documented 2026-10-18):
 *  - Moderation  POST https://api.openai.com/v1/moderations  { model:"omni-moderation-latest", input:[{type:"text",text},{type:"image_url",image_url:{url:"data:..."}}] }
 *                → { results:[{ flagged, categories, category_scores }] }    (free of charge)
 *  - Transcription  POST /v1/audio/transcriptions  multipart: file, model=whisper-1, response_format=verbose_json,
 *                   timestamp_granularities[]=word, language? → { text, words:[{word,start,end}], duration }
 *                   ($0.006/minute; files up to 25 MB)
 */
import { ProviderError, type CapabilityAdapter, type CapabilityResult, type SafetyRequest, type TranscriptionRequest } from '../contracts.ts';
import { requestJson, type FetchLike } from '../http.ts';
import { sha256 } from '../provenance.ts';

export const OPENAI_BASE = 'https://api.openai.com/v1';
export const OPENAI_PROVIDER = 'openai';
export const OPENAI_MODERATION_MODEL = 'omni-moderation-latest';
export const OPENAI_TRANSCRIBE_MODEL = 'whisper-1';
export const OPENAI_TRANSCRIBE_MAX_BYTES = 25 * 1024 * 1024;

export interface OpenAIConfig {
  apiKey: string;
  fetch: FetchLike;
  timeoutMs?: number;
  loadAsset: (assetId: string) => Promise<{ bytes: Uint8Array; mime: string }>;
}

/** Categories that always block (children, extremist violence, self-harm instructions); others go to human review. */
export const BLOCK_CATEGORIES = ['sexual/minors', 'self-harm/instructions', 'self-harm/intent', 'illicit/violent', 'hate/threatening', 'violence/graphic'];

export function moderationDecision(categories: Record<string, boolean>): { decision: 'allow' | 'review' | 'block'; categories: string[] } {
  const flagged = Object.entries(categories).filter(([, v]) => v).map(([k]) => k).sort();
  if (flagged.length === 0) return { decision: 'allow', categories: [] };
  return { decision: flagged.some((c) => BLOCK_CATEGORIES.includes(c)) ? 'block' : 'review', categories: flagged };
}

export function openAIModerationAdapter(cfg: OpenAIConfig): CapabilityAdapter<SafetyRequest> {
  return {
    provider: OPENAI_PROVIDER, model: OPENAI_MODERATION_MODEL, capability: 'safety', paid: false, locales: ['en', 'fr', 'ar', 'de'],
    estimateUsage: () => ({ requests: 1 }),
    async run(r, signal): Promise<CapabilityResult> {
      const images = await Promise.all(r.imageAssetIds.slice(0, 8).map((id) => cfg.loadAsset(id)));
      const input = [{ type: 'text', text: r.text.slice(0, 32_000) }, ...images.map((a) => ({ type: 'image_url', image_url: { url: `data:${a.mime};base64,${Buffer.from(a.bytes).toString('base64')}` } }))];
      const res = await requestJson<{ id?: string; results?: Array<{ flagged?: boolean; categories?: Record<string, boolean> }> }>(cfg.fetch, `${OPENAI_BASE}/moderations`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` }, body: JSON.stringify({ model: OPENAI_MODERATION_MODEL, input }), timeoutMs: cfg.timeoutMs ?? 30_000, signal,
      });
      const merged: Record<string, boolean> = {};
      for (const x of res.results ?? []) for (const [k, v] of Object.entries(x.categories ?? {})) merged[k] = merged[k] || v === true;
      const d = moderationDecision(merged);
      return {
        json: d, usage: { requests: 1 },
        provenance: { capability: 'safety', provider: OPENAI_PROVIDER, model: OPENAI_MODERATION_MODEL, modelVersion: null, requestKey: r.requestKey, promptSha256: sha256(r.text), inputAssetIds: r.imageAssetIds, referenceAssetIds: [], characterSpecVersions: {}, approvedBy: null, createdAt: new Date().toISOString(), costMicros: 0, currency: 'USD', aiGenerated: true, contentCredentials: null, mock: false, providerRequestId: res.id ?? null },
      };
    },
  };
}

export function openAITranscriptionAdapter(cfg: OpenAIConfig): CapabilityAdapter<TranscriptionRequest> {
  return {
    provider: OPENAI_PROVIDER, model: OPENAI_TRANSCRIBE_MODEL, capability: 'transcription', paid: true, locales: ['en', 'fr', 'ar', 'de'],
    estimateUsage: (r) => ({ audioSeconds: r.durationSeconds }),
    async run(r, signal): Promise<CapabilityResult> {
      const audio = await cfg.loadAsset(r.audioAssetId);
      if (audio.bytes.byteLength > OPENAI_TRANSCRIBE_MAX_BYTES) throw new ProviderError('invalid_request', 'audio file larger than 25 MB');
      const form = new FormData();
      const ext = audio.mime.includes('wav') ? 'wav' : audio.mime.includes('mp4') ? 'mp4' : audio.mime.includes('webm') ? 'webm' : 'mp3';
      form.append('file', new Blob([new Uint8Array(audio.bytes)], { type: audio.mime }), `audio.${ext}`);
      form.append('model', OPENAI_TRANSCRIBE_MODEL);
      form.append('response_format', 'verbose_json');
      form.append('timestamp_granularities[]', 'word');
      form.append('language', r.locale);
      const res = await requestJson<{ text?: string; duration?: number; words?: Array<{ word: string; start: number; end: number }> }>(cfg.fetch, `${OPENAI_BASE}/audio/transcriptions`, {
        method: 'POST', headers: { authorization: `Bearer ${cfg.apiKey}` }, body: form, timeoutMs: cfg.timeoutMs ?? 300_000, signal,
      });
      const subtitles: NonNullable<CapabilityResult['subtitles']> = [];
      for (const w of res.words ?? []) {
        const last = subtitles[subtitles.length - 1];
        const s = Math.round(w.start * 1000);
        const e = Math.round(w.end * 1000);
        if (last && last.text.length + w.word.length < 42 && e - last.startMs <= 3000) {
          last.text += ` ${w.word.trim()}`;
          last.endMs = e;
        } else subtitles.push({ startMs: s, endMs: e, text: w.word.trim() });
      }
      return {
        text: res.text ?? '', subtitles, usage: { audioSeconds: res.duration ?? r.durationSeconds },
        provenance: { capability: 'transcription', provider: OPENAI_PROVIDER, model: OPENAI_TRANSCRIBE_MODEL, modelVersion: null, requestKey: r.requestKey, promptSha256: sha256(r.audioAssetId), inputAssetIds: [r.audioAssetId], referenceAssetIds: [], characterSpecVersions: {}, approvedBy: null, createdAt: new Date().toISOString(), costMicros: null, currency: null, aiGenerated: true, contentCredentials: null, mock: false, providerRequestId: null },
      };
    },
  };
}
