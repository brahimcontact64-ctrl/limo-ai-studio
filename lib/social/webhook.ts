import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Meta webhook helpers (prepared; no Meta app is configured yet). Requests are accepted only with a
 * valid X-Hub-Signature-256 computed with the app secret, which lives in server environment variables.
 */
export function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header || !header.startsWith('sha256=') || !appSecret) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');
  const given = header.slice(7);
  if (given.length !== expected.length || !/^[0-9a-f]+$/i.test(given)) return false;
  return timingSafeEqual(Buffer.from(given, 'hex'), Buffer.from(expected, 'hex'));
}

/** Subscription handshake: echo the challenge only for the configured verify token. */
export function verifySubscription(params: URLSearchParams, verifyToken: string): string | null {
  if (!verifyToken) return null;
  if (params.get('hub.mode') !== 'subscribe' || params.get('hub.verify_token') !== verifyToken) return null;
  return params.get('hub.challenge');
}

/** What the platform should do with a Page webhook entry (only safe, local actions). */
export function webhookActions(payload: unknown): Array<{ page_external_id: string; action: 'permissions_changed' | 'feed_event' }> {
  const p = payload as { object?: string; entry?: Array<{ id?: string; changes?: Array<{ field?: string }> }> };
  if (p?.object !== 'page' || !Array.isArray(p.entry)) return [];
  const out: Array<{ page_external_id: string; action: 'permissions_changed' | 'feed_event' }> = [];
  for (const e of p.entry.slice(0, 50)) {
    if (!e?.id) continue;
    for (const c of e.changes ?? []) out.push({ page_external_id: String(e.id), action: c.field === 'permissions' ? 'permissions_changed' : 'feed_event' });
  }
  return out;
}
