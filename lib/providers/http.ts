/**
 * HTTP layer shared by every real provider adapter (Milestone 10).
 *
 * Adapters never call the global `fetch` directly: they receive a `FetchLike`. In every environment where paid
 * generation is not explicitly enabled, that fetch is `blockedFetch`, which refuses any request to a known AI
 * provider host before it leaves the process (so even a coding mistake cannot make a paid call). Tests inject a
 * recording mock that answers with documented response shapes.
 */
import { classifyHttp, ProviderError, type ProviderErrorCode } from './contracts.ts';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Hosts of the AI providers LIMO may use. Requests to them are refused unless live calls are enabled. */
export const PROVIDER_HOSTS = [
  'api.anthropic.com',
  'api.openai.com',
  'generativelanguage.googleapis.com',
  'api.elevenlabs.io',
  'api.us.elevenlabs.io',
  'api.dev.runwayml.com',
] as const;

export class NetworkBlockedError extends Error {
  readonly host: string;
  constructor(host: string) {
    super(`Live AI provider calls are disabled (${host})`);
    this.host = host;
  }
}

export function isProviderHost(url: string): string | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  return (PROVIDER_HOSTS as readonly string[]).find((h) => host === h || host.endsWith(`.${h}`)) ?? null;
}

/** A fetch that refuses every provider host and counts the attempts (other hosts are refused too). */
export function blockedFetch(onBlocked?: (host: string) => void): FetchLike {
  return async (url) => {
    const host = isProviderHost(url) ?? (() => {
      try {
        return new URL(url).hostname;
      } catch {
        return 'invalid-url';
      }
    })();
    onBlocked?.(host);
    throw new NetworkBlockedError(host);
  };
}

export interface RequestOptions extends Omit<RequestInit, 'signal'> {
  timeoutMs: number;
  signal?: AbortSignal;
}

/** Combines the caller's cancellation signal with a per-request timeout. */
export function withTimeout(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const t = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, t]) : t;
}

/** Seconds or HTTP-date in `retry-after` → milliseconds (bounded to 10 minutes). */
export function retryAfterMs(headers: Headers): number | undefined {
  const v = headers.get('retry-after');
  if (!v) return undefined;
  const s = Number(v);
  if (Number.isFinite(s) && s >= 0) return Math.min(600_000, Math.round(s * 1000));
  const d = Date.parse(v);
  return Number.isFinite(d) ? Math.min(600_000, Math.max(0, d - Date.now())) : undefined;
}

/** Turns a non-2xx response into a normalized ProviderError (body text is truncated, never logged with secrets). */
export async function errorFromResponse(res: Response, refine?: (status: number, body: string) => ProviderErrorCode | null): Promise<ProviderError> {
  const body = await res.text().catch(() => '');
  const code = refine?.(res.status, body) ?? classifyHttp(res.status);
  return new ProviderError(code, `HTTP ${res.status}: ${body.slice(0, 300)}`, retryAfterMs(res.headers));
}

/** Maps transport failures (timeout, abort, blocked network) to ProviderError codes. */
export function transportError(e: unknown, signal?: AbortSignal): ProviderError {
  if (e instanceof ProviderError) return e;
  if (e instanceof NetworkBlockedError) return new ProviderError('disabled', e.message);
  if (signal?.aborted && signal.reason instanceof Error && signal.reason.name !== 'TimeoutError') return new ProviderError('unknown', 'cancelled');
  const name = e instanceof Error ? e.name : '';
  if (name === 'TimeoutError' || name === 'AbortError') return new ProviderError('timeout', 'request timed out');
  return new ProviderError('unavailable', e instanceof Error ? e.message : String(e));
}

export async function requestJson<T>(fetch: FetchLike, url: string, opts: RequestOptions, refine?: (status: number, body: string) => ProviderErrorCode | null): Promise<T> {
  const { timeoutMs, signal, ...init } = opts;
  const s = withTimeout(timeoutMs, signal);
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: s });
  } catch (e) {
    throw transportError(e, signal);
  }
  if (!res.ok) throw await errorFromResponse(res, refine);
  try {
    return (await res.json()) as T;
  } catch {
    throw new ProviderError('unknown', 'invalid JSON from provider');
  }
}

export async function requestBytes(fetch: FetchLike, url: string, opts: RequestOptions, maxBytes: number): Promise<{ bytes: Uint8Array; mime: string }> {
  const { timeoutMs, signal, ...init } = opts;
  const s = withTimeout(timeoutMs, signal);
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: s, redirect: 'follow' });
  } catch (e) {
    throw transportError(e, signal);
  }
  if (!res.ok) throw await errorFromResponse(res);
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > maxBytes) throw new ProviderError('invalid_request', `output larger than ${maxBytes} bytes`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new ProviderError('invalid_request', `output larger than ${maxBytes} bytes`);
  return { bytes, mime: (res.headers.get('content-type') ?? 'application/octet-stream').split(';')[0]!.trim() };
}

export const toBase64 = (b: Uint8Array) => Buffer.from(b).toString('base64');
export const fromBase64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));
