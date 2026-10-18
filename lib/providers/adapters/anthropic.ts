/**
 * Claude adapter (Anthropic Messages API through the official SDK) for text, story and translation work.
 *
 * - The SDK gets LIMO's FetchLike (blocked unless live calls are enabled) and `maxRetries: 0`: retries, budgets
 *   and fallbacks are decided by LIMO's own policy (contracts.ts), never silently by the client.
 * - Every task asks for JSON matching a schema (`output_config.format`), then validates it again here.
 * - A refusal (`stop_reason: "refusal"`) becomes `content_refused`: never retried, never sent to another provider.
 *   Server-side refusal fallbacks are deliberately not enabled (owner rule).
 * - Facts: the model may only use the facts it is given. Numbers (prices, percentages, dates) that do not appear
 *   in the input are reported as `invented_facts` and the result cannot be applied without review.
 */
import Anthropic from '@anthropic-ai/sdk';
import { classifyHttp, ProviderError, type CapabilityAdapter, type CapabilityResult, type Locale, type Provenance, type StoryRequest, type TextRequest, type TranslationRequest, type Usage } from '../contracts.ts';
import type { FetchLike } from '../http.ts';
import { sha256 } from '../provenance.ts';

export const CLAUDE_DEFAULT_MODEL = 'claude-opus-5-5';
export const CLAUDE_PROVIDER = 'anthropic';

export interface ClaudeConfig {
  apiKey: string;
  fetch: FetchLike;
  model?: string;
  timeoutMs?: number;
  effort?: 'low' | 'medium' | 'high';
  /** Absolute API base URL (tests point it at the mock). */
  baseURL?: string;
}

const LANG: Record<Locale, string> = { en: 'English', fr: 'French', ar: 'Arabic (Modern Standard, natural for North Africa)', de: 'German' };

/** Errors from the SDK → normalized provider errors. */
export function claudeError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  if (e instanceof Anthropic.APIUserAbortError) return new ProviderError('unknown', 'cancelled');
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new ProviderError('timeout', 'Claude request timed out');
  if (e instanceof Anthropic.APIConnectionError) {
    const cause = (e as { cause?: unknown }).cause;
    if (cause instanceof Error && cause.name === 'NetworkBlockedError') return new ProviderError('disabled', cause.message);
    return new ProviderError('unavailable', e.message);
  }
  if (e instanceof Anthropic.APIError) {
    const status = e.status ?? 0;
    const retry = Number((e.headers as Headers | undefined)?.get?.('retry-after'));
    const code = status === 529 ? 'unavailable' : classifyHttp(status);
    return new ProviderError(code, `Claude HTTP ${status}: ${e.message.slice(0, 300)}`, Number.isFinite(retry) && retry >= 0 ? retry * 1000 : undefined);
  }
  return new ProviderError('unknown', e instanceof Error ? e.message : String(e));
}

/** Numbers in `out` that never occur in `input` (prices, percentages, quantities the model may have invented). */
export function inventedNumbers(out: string, input: string): string[] {
  const norm = (s: string) => s.replace(/[\s  ]/g, '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  const have = new Set((norm(input).match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(',', '.')));
  const found = (norm(out).match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(',', '.'));
  return [...new Set(found.filter((n) => !have.has(n) && !/^[1-9]$/.test(n)))];
}

type Json = Record<string, unknown>;
const obj = (properties: Json, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const str = { type: 'string' };
const SCENE = obj({ title: str, duration_seconds: { type: 'integer' }, narration: str, dialogue: str, on_screen_text: str, visual_prompt: str, camera_prompt: str });

export const SCHEMAS = {
  script_draft: obj({ scenes: { type: 'array', items: SCENE }, notes: str }),
  rewrite: obj({ text: str }),
  post_caption: obj({ headline: str, caption: str, hashtags: { type: 'array', items: str }, cta: str }),
  safety_review: obj({ decision: { type: 'string', enum: ['allow', 'review', 'block'] }, categories: { type: 'array', items: str }, rationale: str }),
  scene_prompts: obj({ scenes: { type: 'array', items: obj({ scene_number: { type: 'integer' }, image_prompt: str, motion_prompt: str }) } }),
  continue_episode: obj({ title: str, scenes: { type: 'array', items: SCENE }, uses_canon: { type: 'array', items: str } }),
  continuity_check: obj({ issues: { type: 'array', items: obj({ scene: { type: 'integer' }, severity: { type: 'string', enum: ['error', 'warning'] }, message: str }) } }),
  suggest_checkpoint: obj({ summary: str, ending_hook: str }),
  translation: obj({ text: str }),
} as const;

export const SYSTEM = [
  'You write short-form video scripts and social posts for LIMO AI Studio customers.',
  'Use ONLY the facts provided by the customer. Never invent prices, discounts, quantities, dates, claims, reviews or contact details.',
  'When a needed fact is missing, write a visible placeholder in square brackets, e.g. [price].',
  'A video lasts at most 30 seconds in total; each scene lasts 1 to 15 seconds.',
  'Keep content family-friendly. Reply only with JSON that matches the given schema.',
].join(' ');

interface Call {
  task: keyof typeof SCHEMAS;
  user: string;
  maxTokens: number;
  locale: Locale;
}

async function callJson(cfg: ClaudeConfig, c: Call, signal: AbortSignal): Promise<{ data: Json; usage: Usage; model: string; requestId: string | null }> {
  const client = new Anthropic({ apiKey: cfg.apiKey, fetch: cfg.fetch as never, maxRetries: 0, timeout: cfg.timeoutMs ?? 90_000, ...(cfg.baseURL ? { baseURL: cfg.baseURL } : {}) });
  let res: Anthropic.Message;
  try {
    res = await client.messages.create(
      {
        model: cfg.model ?? CLAUDE_DEFAULT_MODEL,
        max_tokens: c.maxTokens,
        system: `${SYSTEM} Write in ${LANG[c.locale]}.`,
        messages: [{ role: 'user', content: c.user }],
        output_config: { effort: cfg.effort ?? 'medium', format: { type: 'json_schema', schema: SCHEMAS[c.task] } },
      } as never,
      { signal },
    );
  } catch (e) {
    throw claudeError(e);
  }
  const stop = (res as unknown as { stop_reason: string; stop_details?: { category?: string | null } | null });
  if (stop.stop_reason === 'refusal') throw new ProviderError('content_refused', `Claude declined (${stop.stop_details?.category ?? 'unspecified'})`);
  if (stop.stop_reason === 'max_tokens') throw new ProviderError('invalid_request', 'Claude output was truncated (max_tokens)');
  const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  let data: Json;
  try {
    data = JSON.parse(text) as Json;
  } catch {
    throw new ProviderError('unknown', 'Claude returned invalid JSON');
  }
  const u = res.usage as unknown as { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };
  return {
    data,
    usage: { inputTokens: u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0), outputTokens: u.output_tokens },
    model: res.model,
    requestId: (res as unknown as { _request_id?: string | null })._request_id ?? null,
  };
}

function provenance(capability: Provenance['capability'], requestKey: string, model: string, prompt: string, extra: Partial<Provenance> = {}): Provenance {
  return {
    capability, provider: CLAUDE_PROVIDER, model, modelVersion: null, requestKey, promptSha256: sha256(prompt), inputAssetIds: [], referenceAssetIds: [],
    characterSpecVersions: {}, approvedBy: null, createdAt: new Date().toISOString(), costMicros: null, currency: null, aiGenerated: true,
    contentCredentials: null, mock: false, ...extra,
  };
}

/** Rough token estimate before the call (for the reservation). */
const estimate = (chars: number, outTokens: number): Usage => ({ inputTokens: Math.ceil((chars + SYSTEM.length + 1200) / 3), outputTokens: outTokens });

export function claudeTextAdapter(cfg: ClaudeConfig): CapabilityAdapter<TextRequest> {
  return {
    provider: CLAUDE_PROVIDER, model: cfg.model ?? CLAUDE_DEFAULT_MODEL, capability: 'text', paid: true, locales: ['en', 'fr', 'ar', 'de'],
    estimateUsage: (r) => estimate(r.instructions.length + JSON.stringify(r.facts).length, r.maxOutputTokens),
    async run(r, signal): Promise<CapabilityResult> {
      const facts = Object.entries(r.facts).map(([k, v]) => `- ${k}: ${v}`).join('\n') || '- (none)';
      const user = `Task: ${r.task}\nCustomer facts (the only facts you may use):\n${facts}\n\nInstructions:\n${r.instructions}`;
      const out = await callJson(cfg, { task: r.task, user, maxTokens: r.maxOutputTokens, locale: r.locale }, signal);
      const invented = r.task === 'safety_review' ? [] : inventedNumbers(JSON.stringify(out.data), `${facts}\n${r.instructions}`);
      return { text: JSON.stringify(out.data), json: out.data, issues: invented.length ? [{ code: 'invented_facts', detail: invented.join(', ') }] : [], usage: out.usage, provenance: provenance('text', r.requestKey, out.model, user, { providerRequestId: out.requestId }) };
    },
  };
}

export function claudeStoryAdapter(cfg: ClaudeConfig): CapabilityAdapter<StoryRequest> {
  return {
    provider: CLAUDE_PROVIDER, model: cfg.model ?? CLAUDE_DEFAULT_MODEL, capability: 'story', paid: true, locales: ['en', 'fr', 'ar', 'de'],
    estimateUsage: (r) => estimate(r.bible.length + 600, r.maxOutputTokens),
    async run(r, signal): Promise<CapabilityResult> {
      const prev = r.previousCheckpoint ? `Previous approved ending (episode ${r.previousCheckpoint.episode}): ${r.previousCheckpoint.summary}\nEnding hook: ${r.previousCheckpoint.endingHook}` : 'This is episode 1.';
      const user = [
        `Task: ${r.task}`,
        `Story Bible version ${r.bibleVersion} (the only canon you may use; never change character identities, relationships or world rules):`,
        r.bible,
        prev,
        r.task === 'continue_episode' ? 'Start exactly from the previous ending. New facts must be [placeholders] for the writer. Total length at most 30 seconds.' : '',
      ].join('\n\n');
      const out = await callJson(cfg, { task: r.task, user, maxTokens: r.maxOutputTokens, locale: r.locale }, signal);
      return { text: JSON.stringify(out.data), json: out.data, issues: [], usage: out.usage, provenance: provenance('story', r.requestKey, out.model, user, { characterSpecVersions: r.characterSpecVersions, providerRequestId: out.requestId }) };
    },
  };
}

export function claudeTranslationAdapter(cfg: ClaudeConfig): CapabilityAdapter<TranslationRequest> {
  return {
    provider: CLAUDE_PROVIDER, model: cfg.model ?? CLAUDE_DEFAULT_MODEL, capability: 'translation', paid: true, locales: ['en', 'fr', 'ar', 'de'],
    estimateUsage: (r) => estimate(r.text.length, Math.ceil(r.text.length / 2) + 200),
    async run(r, signal): Promise<CapabilityResult> {
      const user = `Translate from ${LANG[r.source]} into ${LANG[r.locale]}. Keep these terms exactly as written: ${r.lockedTerms.map((t) => `"${t}"`).join(', ') || '(none)'}.\n\nText:\n${r.text}`;
      const out = await callJson(cfg, { task: 'translation', user, maxTokens: Math.max(512, r.text.length * 2), locale: r.locale }, signal);
      const text = String(out.data.text ?? '');
      const missing = r.lockedTerms.filter((t) => t && !text.includes(t));
      return { text, json: out.data, issues: missing.length ? [{ code: 'locked_term_changed', detail: missing.join(', ') }] : [], usage: out.usage, provenance: provenance('translation', r.requestKey, out.model, user, { providerRequestId: out.requestId }) };
    },
  };
}
