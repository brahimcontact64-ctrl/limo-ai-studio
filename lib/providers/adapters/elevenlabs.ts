/**
 * ElevenLabs text-to-speech adapter (documented 2026-10-18).
 *   POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/with-timestamps?output_format=mp3_44100_128
 *   header xi-api-key; body { text, model_id, language_code?, voice_settings?, seed?, previous_text?, next_text? }
 *   → { audio_base64, alignment: { characters[], character_start_times_seconds[], character_end_times_seconds[] } }
 * The character timings become subtitle cues (word groups), so subtitles match the spoken audio exactly.
 * One stable voice id per character and language (character voice profile) keeps a series' voices identical.
 */
import { ProviderError, type CapabilityAdapter, type CapabilityResult, type Locale, type VoiceRequest } from '../contracts.ts';
import { requestJson, type FetchLike } from '../http.ts';
import { sha256 } from '../provenance.ts';

export const ELEVENLABS_BASE = 'https://api.elevenlabs.io';
export const ELEVENLABS_PROVIDER = 'elevenlabs';
export const ELEVENLABS_DEFAULT_MODEL = 'eleven_flash_v2_5';
/** Characters per request (eleven_flash_v2_5: 40,000; eleven_multilingual_v2: 10,000). */
export const ELEVENLABS_CHAR_LIMITS: Record<string, number> = { eleven_flash_v2_5: 40_000, eleven_multilingual_v2: 10_000, eleven_v3: 5_000 };
/** language_code is not supported by multilingual_v2 models (the language follows the text). */
const SUPPORTS_LANGUAGE_CODE = (model: string) => !model.startsWith('eleven_multilingual_v2');

export interface ElevenLabsConfig {
  apiKey: string;
  fetch: FetchLike;
  model?: string;
  timeoutMs?: number;
}

export interface Alignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

/** Character timings → subtitle cues of whole words (max ~42 characters or 3 s per cue). */
export function cuesFromAlignment(a: Alignment | null | undefined, maxChars = 42, maxMs = 3000): Array<{ startMs: number; endMs: number; text: string }> {
  if (!a || a.characters.length === 0) return [];
  const words: Array<{ text: string; start: number; end: number }> = [];
  let cur: { text: string; start: number; end: number } | null = null;
  a.characters.forEach((ch, i) => {
    const start = Math.round((a.character_start_times_seconds[i] ?? 0) * 1000);
    const end = Math.round((a.character_end_times_seconds[i] ?? 0) * 1000);
    if (/\s/.test(ch)) {
      if (cur) words.push(cur);
      cur = null;
    } else if (cur) {
      cur.text += ch;
      cur.end = end;
    } else cur = { text: ch, start, end };
  });
  if (cur) words.push(cur);
  const cues: Array<{ startMs: number; endMs: number; text: string }> = [];
  for (const w of words) {
    const last = cues[cues.length - 1];
    if (last && last.text.length + 1 + w.text.length <= maxChars && w.end - last.startMs <= maxMs) {
      last.text += ` ${w.text}`;
      last.endMs = w.end;
    } else cues.push({ startMs: w.start, endMs: w.end, text: w.text });
  }
  return cues;
}

export function elevenLabsAdapter(cfg: ElevenLabsConfig): CapabilityAdapter<VoiceRequest> {
  const model = cfg.model ?? ELEVENLABS_DEFAULT_MODEL;
  return {
    provider: ELEVENLABS_PROVIDER, model, capability: 'voice', paid: true, locales: ['en', 'fr', 'ar', 'de'],
    estimateUsage: (r) => ({ characters: r.text.length }),
    async run(r, signal): Promise<CapabilityResult> {
      const limit = ELEVENLABS_CHAR_LIMITS[model] ?? 5_000;
      if (!r.text.trim()) throw new ProviderError('invalid_request', 'nothing to speak');
      if (r.text.length > limit) throw new ProviderError('invalid_request', `text longer than ${limit} characters for ${model}`);
      if (!/^[A-Za-z0-9]{8,64}$/.test(r.voiceId)) throw new ProviderError('invalid_request', 'invalid voice id');
      const body: Record<string, unknown> = { text: r.text, model_id: model };
      if (SUPPORTS_LANGUAGE_CODE(model)) body.language_code = r.locale as Locale;
      const res = await requestJson<{ audio_base64?: string; alignment?: Alignment | null }>(
        cfg.fetch,
        `${ELEVENLABS_BASE}/v1/text-to-speech/${encodeURIComponent(r.voiceId)}/with-timestamps?output_format=mp3_44100_128`,
        { method: 'POST', headers: { 'content-type': 'application/json', 'xi-api-key': cfg.apiKey }, body: JSON.stringify(body), timeoutMs: cfg.timeoutMs ?? 120_000, signal },
        (status, text) => (status === 400 && /policy|prohibited|blocked/i.test(text) ? 'content_refused' : status === 401 && /quota|credits/i.test(text) ? 'quota_exceeded' : null),
      );
      if (!res.audio_base64) throw new ProviderError('unknown', 'ElevenLabs returned no audio');
      const bytes = new Uint8Array(Buffer.from(res.audio_base64, 'base64'));
      const subtitles = cuesFromAlignment(res.alignment);
      const seconds = subtitles.length ? subtitles[subtitles.length - 1]!.endMs / 1000 : 0;
      return {
        files: [{ bytes, mime: 'audio/mpeg', role: 'audio' }],
        subtitles,
        json: { audio_seconds: seconds },
        usage: { characters: r.text.length },
        provenance: {
          capability: 'voice', provider: ELEVENLABS_PROVIDER, model, modelVersion: null, requestKey: r.requestKey, promptSha256: sha256(r.text),
          inputAssetIds: [], referenceAssetIds: [], characterSpecVersions: {}, approvedBy: null, createdAt: new Date().toISOString(),
          costMicros: null, currency: null, aiGenerated: true, contentCredentials: null, mock: false, providerRequestId: null, voiceId: r.voiceId,
        },
      };
    },
  };
}
