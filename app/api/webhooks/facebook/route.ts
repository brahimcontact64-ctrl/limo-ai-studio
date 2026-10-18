import { NextResponse } from 'next/server';
import { verifyMetaSignature, verifySubscription, webhookActions } from '@/lib/social/webhook';

export const dynamic = 'force-dynamic';

/**
 * Meta webhook endpoint (PREPARED, NOT ACTIVE). No Meta app is configured, so it answers 503 until the
 * server-only META_WEBHOOK_VERIFY_TOKEN / META_APP_SECRET exist. Even then it only verifies the
 * signature and acknowledges: storing and acting on events (e.g. revoked permissions → mark the Page
 * connection expired) needs a reviewed server-side processor, planned with the live integration.
 */
export async function GET(request: Request) {
  const token = process.env.META_WEBHOOK_VERIFY_TOKEN ?? '';
  if (!token) return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  const challenge = verifySubscription(new URL(request.url).searchParams, token);
  return challenge ? new NextResponse(challenge, { status: 200 }) : NextResponse.json({ error: 'forbidden' }, { status: 403 });
}

export async function POST(request: Request) {
  const secret = process.env.META_APP_SECRET ?? '';
  if (!secret) return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  const raw = (await request.text()).slice(0, 200_000);
  if (!verifyMetaSignature(raw, request.headers.get('x-hub-signature-256'), secret)) return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  let actions: ReturnType<typeof webhookActions> = [];
  try {
    actions = webhookActions(JSON.parse(raw));
  } catch {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }
  return NextResponse.json({ received: actions.length, processed: false });
}
