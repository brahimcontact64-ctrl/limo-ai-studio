/**
 * Which adapter serves each capability (Milestone 10).
 *
 * Mode (server env, never NEXT_PUBLIC_*):
 *   off  (default)   every capability is disabled: adapters throw `disabled` before any network access
 *   mock             mock adapters (no network, no cost, outputs labelled mock)
 *   live             real adapters — only when LIMO_GENERATION_MODE=live AND LIMO_ENABLE_PAID_GENERATION=true AND the
 *                    provider key is set; every call still has to pass `paidCallBlockers` (owner approval of the
 *                    capability, provider enabled in ai_provider_registry, verified price, budget, user confirmation)
 * In off/mock mode the HTTP client is `blockedFetch`, so a real adapter cannot reach a provider even by mistake.
 *
 * Provider choice per capability (live only):
 *   LIMO_VOICE_PROVIDER   elevenlabs (default) | google  (Gemini TTS on the prepaid Google account)
 *   LIMO_SAFETY_PROVIDER  openai (default, free moderation) | anthropic  (Claude safety review)
 * The $10 pilot uses google + anthropic so that only two accounts with hard billing caps are involved.
 */
import { ProviderError, type AsyncCapabilityAdapter, type CapabilityAdapter, type CapabilityRequest, type CharacterImageRequest, type ImageRequest, type SafetyRequest, type StoryRequest, type TextRequest, type TranscriptionRequest, type TranslationRequest, type VideoRequest, type VoiceRequest } from './contracts.ts';
import { blockedFetch, type FetchLike } from './http.ts';
import { claudeSafetyAdapter, claudeStoryAdapter, claudeTextAdapter, claudeTranslationAdapter } from './adapters/anthropic.ts';
import { geminiCharacterAdapter, geminiImageAdapter } from './adapters/gemini-image.ts';
import { veoAdapter, type VeoTier } from './adapters/veo.ts';
import { elevenLabsAdapter } from './adapters/elevenlabs.ts';
import { geminiTtsAdapter } from './adapters/gemini-tts.ts';
import { openAIModerationAdapter, openAITranscriptionAdapter } from './adapters/openai.ts';
import * as mock from './mocks.ts';

export type GenerationMode = 'off' | 'mock' | 'live';

export interface ProviderEnv {
  LIMO_GENERATION_MODE?: string;
  LIMO_ENABLE_PAID_GENERATION?: string;
  ANTHROPIC_API_KEY?: string;
  GEMINI_API_KEY?: string;
  ELEVENLABS_API_KEY?: string;
  OPENAI_API_KEY?: string;
  LIMO_CLAUDE_MODEL?: string;
  LIMO_VEO_TIER?: string;
  LIMO_VOICE_PROVIDER?: string;
  LIMO_SAFETY_PROVIDER?: string;
  [k: string]: string | undefined;
}

export const voiceProvider = (env: ProviderEnv): 'elevenlabs' | 'google' => (env.LIMO_VOICE_PROVIDER === 'google' ? 'google' : 'elevenlabs');
export const safetyProvider = (env: ProviderEnv): 'openai' | 'anthropic' => (env.LIMO_SAFETY_PROVIDER === 'anthropic' ? 'anthropic' : 'openai');

/** Credential env var per provider (matches ai_provider_registry.credential_env_key). */
export const CREDENTIAL_ENV = { anthropic: 'ANTHROPIC_API_KEY', google: 'GEMINI_API_KEY', elevenlabs: 'ELEVENLABS_API_KEY', openai: 'OPENAI_API_KEY' } as const;

export function generationMode(env: ProviderEnv): GenerationMode {
  const m = (env.LIMO_GENERATION_MODE ?? 'off').toLowerCase();
  if (m === 'live') return env.LIMO_ENABLE_PAID_GENERATION === 'true' ? 'live' : 'off';
  return m === 'mock' ? 'mock' : 'off';
}

function disabled<R extends CapabilityRequest>(capability: R['kind'], reason: string): CapabilityAdapter<R> {
  return {
    provider: 'disabled', model: 'disabled', capability, paid: false, locales: [],
    estimateUsage: () => ({}),
    run: async () => {
      throw new ProviderError('disabled', reason);
    },
  };
}
function disabledAsync(reason: string): AsyncCapabilityAdapter<VideoRequest> {
  const fail = async (): Promise<never> => {
    throw new ProviderError('disabled', reason);
  };
  return { provider: 'disabled', model: 'disabled', capability: 'video', paid: false, locales: [], estimateUsage: () => ({}), submit: fail, poll: fail, fetchResult: fail };
}

export interface Adapters {
  mode: GenerationMode;
  text: CapabilityAdapter<TextRequest>;
  story: CapabilityAdapter<StoryRequest>;
  translation: CapabilityAdapter<TranslationRequest>;
  image: CapabilityAdapter<ImageRequest>;
  character_image: CapabilityAdapter<CharacterImageRequest>;
  video: AsyncCapabilityAdapter<VideoRequest>;
  voice: CapabilityAdapter<VoiceRequest>;
  transcription: CapabilityAdapter<TranscriptionRequest>;
  safety: CapabilityAdapter<SafetyRequest>;
}

export interface AdapterDeps {
  loadAsset: (assetId: string) => Promise<{ bytes: Uint8Array; mime: string }>;
  /** The real network client; used only in live mode. */
  liveFetch?: FetchLike;
  onBlocked?: (host: string) => void;
}

export function buildAdapters(env: ProviderEnv, deps: AdapterDeps): Adapters {
  const mode = generationMode(env);
  if (mode === 'mock') {
    return {
      mode, text: mock.mockTextAdapter(), story: mock.mockStoryAdapter(), translation: mock.mockTranslationAdapter(), image: mock.mockImageAdapter(),
      character_image: mock.mockCharacterAdapter(), video: mock.mockVideoAdapter(), voice: mock.mockVoiceAdapter(), transcription: mock.mockTranscriptionAdapter(), safety: mock.mockSafetyAdapter(),
    };
  }
  const why = mode === 'off' ? 'AI generation is not enabled' : '';
  if (mode === 'off') {
    return {
      mode, text: disabled('text', why), story: disabled('story', why), translation: disabled('translation', why), image: disabled('image', why), character_image: disabled('character_image', why),
      video: disabledAsync(why), voice: disabled('voice', why), transcription: disabled('transcription', why), safety: disabled('safety', why),
    };
  }
  const fetch = deps.liveFetch ?? blockedFetch(deps.onBlocked);
  const key = (k: keyof typeof CREDENTIAL_ENV) => env[CREDENTIAL_ENV[k]];
  const missing = (k: keyof typeof CREDENTIAL_ENV) => `${CREDENTIAL_ENV[k]} is not configured`;
  const claude = key('anthropic') ? { apiKey: key('anthropic')!, fetch, model: env.LIMO_CLAUDE_MODEL || undefined } : null;
  const google = key('google') ? { apiKey: key('google')!, fetch, loadAsset: deps.loadAsset } : null;
  const openai = key('openai') ? { apiKey: key('openai')!, fetch, loadAsset: deps.loadAsset } : null;
  const tier = (['standard', 'fast', 'lite'].includes(env.LIMO_VEO_TIER ?? '') ? env.LIMO_VEO_TIER : 'fast') as VeoTier;
  return {
    mode,
    text: claude ? claudeTextAdapter(claude) : disabled('text', missing('anthropic')),
    story: claude ? claudeStoryAdapter(claude) : disabled('story', missing('anthropic')),
    translation: claude ? claudeTranslationAdapter(claude) : disabled('translation', missing('anthropic')),
    image: google ? geminiImageAdapter(google) : disabled('image', missing('google')),
    character_image: google ? geminiCharacterAdapter(google) : disabled('character_image', missing('google')),
    video: google ? veoAdapter({ ...google, tier }) : disabledAsync(missing('google')),
    voice:
      voiceProvider(env) === 'google'
        ? (google ? geminiTtsAdapter({ apiKey: google.apiKey, fetch }) : disabled('voice', missing('google')))
        : key('elevenlabs') ? elevenLabsAdapter({ apiKey: key('elevenlabs')!, fetch }) : disabled('voice', missing('elevenlabs')),
    transcription: openai ? openAITranscriptionAdapter(openai) : disabled('transcription', missing('openai')),
    safety:
      safetyProvider(env) === 'anthropic'
        ? (claude ? claudeSafetyAdapter({ ...claude, loadAsset: deps.loadAsset }) : disabled('safety', missing('anthropic')))
        : openai ? openAIModerationAdapter(openai) : disabled('safety', missing('openai')),
  };
}
