/**
 * Provider prices researched on 2026-10-18 from the official pricing pages (sources per sheet).
 *
 * Every sheet is UNVERIFIED here (`verifiedAt`/`verifiedBy` null): `operationCost` refuses unverified sheets, so no
 * paid call can be estimated — and therefore none can run — until the owner re-checks the page and records the
 * verification (`verifySheet`, done from the admin configuration at activation time). Prices are integer
 * micro-dollars per unit (1 USD = 1,000,000). Nothing here is a guess: units a page did not price are absent.
 */
import type { PriceSheet } from './contracts.ts';

export const PRICE_RESEARCH_DATE = '2026-10-18';
const M = 1_000_000;
const usd = (dollars: number) => Math.round(dollars * M);

function sheet(provider: string, model: string, prices: PriceSheet['prices'], source: string, minimums?: PriceSheet['minimums']): PriceSheet {
  return { provider, model, currency: 'USD', prices, minimums, source, verifiedAt: null, verifiedBy: null, researchedAt: PRICE_RESEARCH_DATE };
}

const CLAUDE = 'https://platform.claude.com/docs/en/about-claude/pricing';
const GEMINI = 'https://ai.google.dev/gemini-api/docs/pricing';
const OPENAI = 'https://developers.openai.com/api/docs/pricing';
const ELEVEN = 'https://elevenlabs.io/pricing/api';

/** Key: `${provider}/${model}` or `${provider}/${model}@${tier}` for prices that depend on size/resolution. */
export const RESEARCHED_PRICES: Record<string, PriceSheet> = {
  // Text (per million tokens).
  'anthropic/claude-opus-5-5': sheet('anthropic', 'claude-opus-5-5', { input_tokens_1m: usd(4), output_tokens_1m: usd(20) }, CLAUDE),
  'anthropic/claude-sonnet-5-5': sheet('anthropic', 'claude-sonnet-5-5', { input_tokens_1m: usd(2), output_tokens_1m: usd(10) }, CLAUDE),
  'anthropic/claude-haiku-5-5': sheet('anthropic', 'claude-haiku-5-5', { input_tokens_1m: usd(0.1), output_tokens_1m: usd(0.5) }, CLAUDE),
  // Images (per image, plus input tokens for prompts and reference images).
  'google/gemini-nano-banana-2.1@1K': sheet('google', 'gemini-nano-banana-2.1', { image: usd(0.0336), input_tokens_1m: usd(1.5) }, GEMINI),
  'google/gemini-nano-banana-2.1@2K': sheet('google', 'gemini-nano-banana-2.1', { image: usd(0.0504), input_tokens_1m: usd(1.5) }, GEMINI),
  'google/gemini-nano-banana-2.1@4K': sheet('google', 'gemini-nano-banana-2.1', { image: usd(0.113), input_tokens_1m: usd(1.5) }, GEMINI),
  'google/gemini-3-pro-image@1K': sheet('google', 'gemini-3-pro-image', { image: usd(0.134), input_tokens_1m: usd(2) }, GEMINI),
  'google/gemini-3-pro-image@2K': sheet('google', 'gemini-3-pro-image', { image: usd(0.134), input_tokens_1m: usd(2) }, GEMINI),
  'google/gemini-3-pro-image@4K': sheet('google', 'gemini-3-pro-image', { image: usd(0.24), input_tokens_1m: usd(2) }, GEMINI),
  // Video (per second of generated video; Veo always generates audio and these are the with-audio prices).
  'google/veo-3.1-generate-preview@720p': sheet('google', 'veo-3.1-generate-preview', { video_second: usd(0.4) }, GEMINI, { video_second: 4 }),
  'google/veo-3.1-generate-preview@1080p': sheet('google', 'veo-3.1-generate-preview', { video_second: usd(0.4) }, GEMINI, { video_second: 8 }),
  'google/veo-3.1-fast-generate-preview@720p': sheet('google', 'veo-3.1-fast-generate-preview', { video_second: usd(0.1) }, GEMINI, { video_second: 4 }),
  'google/veo-3.1-fast-generate-preview@1080p': sheet('google', 'veo-3.1-fast-generate-preview', { video_second: usd(0.12) }, GEMINI, { video_second: 8 }),
  'google/veo-3.1-lite-generate-preview@720p': sheet('google', 'veo-3.1-lite-generate-preview', { video_second: usd(0.05) }, GEMINI, { video_second: 4 }),
  'google/veo-3.1-lite-generate-preview@1080p': sheet('google', 'veo-3.1-lite-generate-preview', { video_second: usd(0.08) }, GEMINI, { video_second: 8 }),
  // Voice (per 1,000 characters).
  'elevenlabs/eleven_flash_v2_5': sheet('elevenlabs', 'eleven_flash_v2_5', { characters_1k: usd(0.04) }, ELEVEN),
  'elevenlabs/eleven_multilingual_v2': sheet('elevenlabs', 'eleven_multilingual_v2', { characters_1k: usd(0.08) }, ELEVEN),
  // Transcription (per minute) and moderation (free).
  'openai/whisper-1': sheet('openai', 'whisper-1', { audio_minute: usd(0.006) }, OPENAI),
  'openai/omni-moderation-latest': sheet('openai', 'omni-moderation-latest', { request: 0 }, 'https://developers.openai.com/api/docs/guides/moderation'),
};

export function priceKey(provider: string, model: string, tier?: string): string {
  return tier ? `${provider}/${model}@${tier}` : `${provider}/${model}`;
}

/** The owner's confirmation that a sheet still matches the provider's official page (stored with the provider config). */
export function verifySheet(s: PriceSheet, by: string, at = new Date()): PriceSheet {
  if (!by.trim()) throw new Error('verifier required');
  return { ...s, verifiedAt: at.toISOString(), verifiedBy: by };
}
