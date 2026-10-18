/**
 * Google Gemini text-to-speech adapter (Interactions API, speech generation guide, researched 2026-10-18).
 *
 *   POST https://generativelanguage.googleapis.com/v1beta/interactions   (header x-goog-api-key)
 *   { model: "gemini-3.8-flash-tts",
 *     input: [{ type: "user_input", content: [{ type: "text", text }] }],
 *     response_format: { type: "audio" },
 *     generation_config: { speech_config: [{ voice: "Kore" }] } }
 *   → Interaction { steps[{ type: "model_output", content: [{ type: "audio", data (base64), mime_type }] }], usage }
 *
 * Output is 24 kHz mono 16-bit audio; raw PCM (audio/L16, audio/pcm) is wrapped in a WAV header here, a WAV is kept.
 * 30 prebuilt voices; the language follows the text (French, German and Arabic are supported). The API returns no
 * timestamps, so subtitle cues are ESTIMATED (words spread over the measured duration, flagged `estimated_timing`).
 * Billing is per token (input text tokens + audio output tokens) — usage comes from the response.
 * Why it exists: the $10 pilot keeps voice on the same prepaid, hard-capped Google account as images and video,
 * instead of an ElevenLabs subscription without a documented hard cap.
 */
import { ProviderError, type CapabilityAdapter, type CapabilityResult, type VoiceRequest } from '../contracts.ts';
import { requestJson, type FetchLike } from '../http.ts';
import { sha256 } from '../provenance.ts';
import { GEMINI_BASE, GEMINI_PROVIDER } from './gemini-image.ts';

export const GEMINI_TTS_MODEL = 'gemini-3.8-flash-tts';
export const GEMINI_TTS_DEFAULT_VOICE = 'Kore';
/** Upper bounds used for the reservation (the bill uses the measured usage). */
export const TTS_AUDIO_TOKENS_PER_SECOND = 32;
export const TTS_CHARS_PER_SECOND = 12;
export const GEMINI_TTS_MAX_CHARS = 5_000;

export interface GeminiTtsConfig {
  apiKey: string;
  fetch: FetchLike;
  model?: string;
  timeoutMs?: number;
}

interface AudioBlock { type?: string; data?: string; mime_type?: string }
interface TtsInteraction {
  id?: string;
  status?: string;
  steps?: Array<{ type?: string; content?: AudioBlock[] }>;
  usage?: { total_input_tokens?: number; total_output_tokens?: number };
  errors?: Array<{ code?: string; message?: string }>;
}

/** 16-bit mono PCM → WAV file. */
export function pcmToWav(pcm: Uint8Array, sampleRate = 24_000, channels = 1): Uint8Array {
  const out = new Uint8Array(44 + pcm.byteLength);
  const v = new DataView(out.buffer);
  const ascii = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  ascii(0, 'RIFF');
  v.setUint32(4, 36 + pcm.byteLength, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * channels * 2, true);
  v.setUint16(32, channels * 2, true);
  v.setUint16(34, 16, true);
  ascii(36, 'data');
  v.setUint32(40, pcm.byteLength, true);
  out.set(pcm, 44);
  return out;
}

/** Duration of a PCM WAV (seconds), from its fmt and data chunks. */
export function wavSeconds(wav: Uint8Array): number {
  const v = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  let byteRate = 0;
  for (let o = 12; o + 8 <= wav.byteLength; ) {
    const id = String.fromCharCode(wav[o]!, wav[o + 1]!, wav[o + 2]!, wav[o + 3]!);
    const size = v.getUint32(o + 4, true);
    if (id === 'fmt ') byteRate = v.getUint32(o + 16, true);
    if (id === 'data') return byteRate ? Math.min(size, wav.byteLength - o - 8) / byteRate : 0;
    o += 8 + size + (size % 2);
  }
  return 0;
}

const isWav = (b: Uint8Array) => b.length > 12 && String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WAVE';

/** The audio of an interaction as a WAV file (raw PCM is wrapped; the sample rate comes from the mime type). */
export function audioOf(i: TtsInteraction): Uint8Array | null {
  for (const step of i.steps ?? []) {
    if (step.type !== 'model_output') continue;
    for (const c of step.content ?? []) {
      if (c.type !== 'audio' || !c.data) continue;
      const bytes = new Uint8Array(Buffer.from(c.data, 'base64'));
      if (isWav(bytes)) return bytes;
      const mime = (c.mime_type ?? '').toLowerCase();
      if (mime && !/l16|pcm|wav/.test(mime)) throw new ProviderError('unknown', `unexpected audio format ${mime}`);
      const rate = Number(/rate=(\d+)/.exec(mime)?.[1] ?? 24_000);
      return pcmToWav(bytes, rate);
    }
  }
  return null;
}

/** Subtitle cues without provider timestamps: words spread over the duration by length (max ~42 chars / 3 s). */
export function estimatedCues(text: string, seconds: number, maxChars = 42, maxMs = 3000): Array<{ startMs: number; endMs: number; text: string }> {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length || seconds <= 0) return [];
  const total = words.reduce((s, w) => s + w.length + 1, 0);
  const msPerChar = (seconds * 1000) / total;
  const cues: Array<{ startMs: number; endMs: number; text: string }> = [];
  let t = 0;
  for (const w of words) {
    const end = t + (w.length + 1) * msPerChar;
    const last = cues[cues.length - 1];
    if (last && last.text.length + 1 + w.length <= maxChars && end - last.startMs <= maxMs) {
      last.text += ` ${w}`;
      last.endMs = Math.round(end);
    } else cues.push({ startMs: Math.round(t), endMs: Math.round(end), text: w });
    t = end;
  }
  return cues;
}

export function geminiTtsAdapter(cfg: GeminiTtsConfig): CapabilityAdapter<VoiceRequest> {
  const model = cfg.model ?? GEMINI_TTS_MODEL;
  const estimate = (r: VoiceRequest) => ({ inputTokens: Math.ceil(r.text.length / 2) + 50, outputTokens: Math.ceil((r.text.length / TTS_CHARS_PER_SECOND) * TTS_AUDIO_TOKENS_PER_SECOND * 1.5) + 100 });
  return {
    provider: GEMINI_PROVIDER, model, capability: 'voice', paid: true, locales: ['en', 'fr', 'ar', 'de'],
    estimateUsage: estimate,
    async run(r, signal): Promise<CapabilityResult> {
      if (!r.text.trim()) throw new ProviderError('invalid_request', 'nothing to speak');
      if (r.text.length > GEMINI_TTS_MAX_CHARS) throw new ProviderError('invalid_request', `text longer than ${GEMINI_TTS_MAX_CHARS} characters`);
      if (!/^[A-Z][a-z]{2,20}$/.test(r.voiceId)) throw new ProviderError('invalid_request', 'invalid Gemini voice name');
      const body = { model, input: [{ type: 'user_input', content: [{ type: 'text', text: r.text }] }], response_format: { type: 'audio' }, generation_config: { speech_config: [{ voice: r.voiceId }] } };
      const res = await requestJson<TtsInteraction>(cfg.fetch, `${GEMINI_BASE}/interactions`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': cfg.apiKey }, body: JSON.stringify(body), timeoutMs: cfg.timeoutMs ?? 120_000, signal,
      }, (status, text) => (status === 400 && /safety|blocked|prohibited|policy/i.test(text) ? 'content_refused' : null));
      if (res.status === 'failed' || res.status === 'incomplete' || res.status === 'cancelled') {
        const msg = (res.errors ?? []).map((e) => `${e.code ?? ''} ${e.message ?? ''}`).join('; ');
        throw new ProviderError(/safety|block|policy/i.test(msg) ? 'content_refused' : 'unknown', `Gemini TTS ${res.status}: ${msg.slice(0, 300)}`);
      }
      const wav = audioOf(res);
      if (!wav) throw new ProviderError('content_refused', 'Gemini returned no audio (possibly filtered)');
      const seconds = Math.round(wavSeconds(wav) * 1000) / 1000;
      return {
        files: [{ bytes: wav, mime: 'audio/wav', role: 'audio' }],
        subtitles: estimatedCues(r.text, seconds),
        json: { audio_seconds: seconds, estimated_timing: true },
        issues: [{ code: 'estimated_timing', detail: 'subtitle timing estimated (the TTS API returns no timestamps)' }, ...(res.usage?.total_output_tokens ? [] : [{ code: 'usage_estimated', detail: 'provider reported no usage; billed at the estimate, reconcile' }])],
        // Missing usage is never treated as free: the conservative estimate is billed and flagged for reconciliation.
        usage: res.usage?.total_output_tokens ? { inputTokens: res.usage.total_input_tokens ?? 0, outputTokens: res.usage.total_output_tokens } : estimate(r),
        provenance: {
          capability: 'voice', provider: GEMINI_PROVIDER, model, modelVersion: null, requestKey: r.requestKey, promptSha256: sha256(r.text),
          inputAssetIds: [], referenceAssetIds: [], characterSpecVersions: {}, approvedBy: null, createdAt: new Date().toISOString(),
          costMicros: null, currency: null, aiGenerated: true, contentCredentials: null, mock: false, providerRequestId: res.id ?? null, voiceId: r.voiceId,
        },
      };
    },
  };
}
