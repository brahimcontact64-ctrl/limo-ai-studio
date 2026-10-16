import 'server-only';
import { NextResponse } from 'next/server';
import { loadAppContext, canEditRole, type AppContext } from '../data/context';

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

/**
 * Rejects cross-site state-changing requests. Browsers always send Origin on POST/DELETE fetches;
 * requests without it (server-to-server) are allowed because they carry no ambient browser cookies.
 */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function readJson(request: Request, maxBytes: number): Promise<{ ok: true; body: unknown } | { ok: false; status: number; error: string }> {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > maxBytes) return { ok: false, status: 413, error: 'payload_too_large' };
  try {
    return { ok: true, body: JSON.parse(raw) };
  } catch {
    return { ok: false, status: 400, error: 'invalid_json' };
  }
}

export type Guarded = { ok: true; ctx: AppContext } | { ok: false; response: NextResponse };

export async function requireUser(request: Request): Promise<Guarded> {
  if (!sameOrigin(request)) return { ok: false, response: json({ error: 'forbidden_origin' }, 403) };
  const ctx = await loadAppContext();
  if (!ctx) return { ok: false, response: json({ error: 'unauthenticated' }, 401) };
  return { ok: true, ctx };
}

export function canEditOrg(ctx: AppContext, organizationId: string): boolean {
  const m = ctx.memberships.find((x) => x.organization_id === organizationId);
  return canEditRole(m?.role);
}
