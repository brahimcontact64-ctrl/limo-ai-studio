/**
 * Publishing adapters. The worker talks to Facebook only through this interface. In Milestone 8 only
 * the MOCK adapter is used: it "publishes" into the database table mock_facebook_publications and never
 * opens a network connection. The Meta Graph adapter below is a prepared skeleton that refuses to run
 * unless live publishing is explicitly enabled (locked flag + owner approval + Meta app review).
 */
export interface PublishRequest {
  jobId: string;
  /** Stable per post version: retrying with the same key must never create a second Facebook post. */
  idempotencyKey: string;
  pageExternalId: string;
  message: string;
  media: { kind: 'image' | 'video'; url: string | null } | null;
}

export interface PublishResult {
  externalPostId: string;
  simulated: boolean;
  duplicate: boolean;
}

export interface NormalizedPublishError {
  code: 'token_expired' | 'permission_revoked' | 'rate_limited' | 'temporary' | 'content_rejected' | 'invalid_request' | 'media_failed' | 'live_publishing_disabled' | 'unknown';
  retryable: boolean;
  /** The customer must reconnect the Page before anything else can be published. */
  reconnect: boolean;
  message: string;
}

export interface PublishingAdapter {
  readonly code: 'mock' | 'facebook';
  readonly live: boolean;
  publish(req: PublishRequest): Promise<PublishResult>;
}

export class PublishError extends Error {
  normalized: NormalizedPublishError;
  constructor(normalized: NormalizedPublishError) {
    super(normalized.message);
    this.normalized = normalized;
  }
}

/**
 * Meta Graph API error → stable code. Codes from Graph error responses: 190 (token expired/invalid),
 * 10/200–299 (permissions), 4/17/32/613 (rate limits), 1/2 (temporary), 368 (blocked for policy),
 * 100 (invalid parameter), 324 (media upload).
 */
export function normalizeGraphError(err: { code?: number; error_subcode?: number; message?: string; is_transient?: boolean } | null | undefined): NormalizedPublishError {
  const code = err?.code;
  const msg = err?.message ?? 'Unknown Facebook error';
  if (code === 190) return { code: 'token_expired', retryable: false, reconnect: true, message: msg };
  if (code === 10 || (code !== undefined && code >= 200 && code <= 299)) return { code: 'permission_revoked', retryable: false, reconnect: true, message: msg };
  if (code === 4 || code === 17 || code === 32 || code === 613) return { code: 'rate_limited', retryable: true, reconnect: false, message: msg };
  if (code === 1 || code === 2 || err?.is_transient) return { code: 'temporary', retryable: true, reconnect: false, message: msg };
  if (code === 368) return { code: 'content_rejected', retryable: false, reconnect: false, message: msg };
  if (code === 324) return { code: 'media_failed', retryable: false, reconnect: false, message: msg };
  if (code === 100) return { code: 'invalid_request', retryable: false, reconnect: false, message: msg };
  return { code: 'unknown', retryable: false, reconnect: false, message: msg };
}

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;

/** Simulated Facebook: idempotent "publication" recorded in the database. No network, ever. */
export class MockFacebookAdapter implements PublishingAdapter {
  readonly code = 'mock' as const;
  readonly live = false;
  private rpc: Rpc;
  private workerId: string;
  private failures: { remaining: number; code: NormalizedPublishError['code'] } | null;
  constructor(rpc: Rpc, workerId: string, simulate?: { fail_attempts?: number; error?: NormalizedPublishError['code'] } | null, attempt = 1) {
    this.rpc = rpc;
    this.workerId = workerId;
    const fails = simulate?.fail_attempts ?? 0;
    this.failures = attempt <= fails ? { remaining: 1, code: simulate?.error ?? 'temporary' } : null;
  }
  async publish(req: PublishRequest): Promise<PublishResult> {
    if (this.failures) {
      const c = this.failures.code;
      const n = normalizeGraphError({ code: c === 'rate_limited' ? 4 : c === 'token_expired' ? 190 : c === 'content_rejected' ? 368 : 2, message: `Simulated ${c}` });
      throw new PublishError(n);
    }
    const { data, error } = await this.rpc('mock_facebook_publish', { p_job_id: req.jobId, p_worker_id: this.workerId });
    if (error) throw new PublishError({ code: 'temporary', retryable: true, reconnect: false, message: error.message });
    const d = data as { external_post_id: string; duplicate: boolean };
    return { externalPostId: d.external_post_id, simulated: true, duplicate: d.duplicate };
  }
}

/**
 * Prepared Meta Graph adapter. It builds the request a real publication would need but refuses to send
 * it while live publishing is disabled. Real use requires: the facebook_live_publishing flag (locked),
 * owner approval, Meta app review for pages_manage_posts, and the Page token read from Vault by the
 * worker (service role) — never from the browser.
 */
export class MetaGraphAdapter implements PublishingAdapter {
  readonly code = 'facebook' as const;
  readonly live = true;
  private enabled: boolean;
  constructor(opts: { liveEnabled: boolean }) {
    this.enabled = opts.liveEnabled;
  }
  static request(req: PublishRequest, apiVersion = 'v21.0') {
    const base = `https://graph.facebook.com/${apiVersion}/${encodeURIComponent(req.pageExternalId)}`;
    if (req.media?.kind === 'video') return { url: `${base}/videos`, body: { description: req.message, file_url: req.media.url } };
    if (req.media?.kind === 'image') return { url: `${base}/photos`, body: { caption: req.message, url: req.media.url } };
    return { url: `${base}/feed`, body: { message: req.message } };
  }
  async publish(_req: PublishRequest): Promise<PublishResult> {
    if (!this.enabled) throw new PublishError({ code: 'live_publishing_disabled', retryable: false, reconnect: false, message: 'Live Facebook publishing is not enabled.' });
    // Deliberately not implemented in Milestone 8: no Graph request is ever sent from this codebase yet.
    throw new PublishError({ code: 'live_publishing_disabled', retryable: false, reconnect: false, message: 'The live Graph adapter is not activated.' });
  }
}
