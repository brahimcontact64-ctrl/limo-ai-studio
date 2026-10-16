import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { getSupabaseServer } from '../supabase/server';
import { safeNext } from './redirect';

const OTP_TYPES: ReadonlySet<string> = new Set(['signup', 'email', 'recovery', 'invite', 'magiclink', 'email_change']);

/**
 * Completes a Supabase email link.
 * - token_hash + type (LIMO email templates): works on any device.
 * - code (default PKCE templates): only works in the browser that started the flow. When the
 *   exchange fails, Supabase has usually already confirmed the address, so sign-up links fall back
 *   to the sign-in page with a neutral message and recovery links ask for a new link.
 */
export async function handleEmailLink(request: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = request.nextUrl;
  const next = safeNext(searchParams.get('next'));
  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const typeParam = searchParams.get('type');
  const isRecovery = typeParam === 'recovery' || next.startsWith('/reset-password');
  const supabase = await getSupabaseServer();

  let ok = false;
  if (tokenHash && typeParam && OTP_TYPES.has(typeParam)) {
    ok = !(await supabase.auth.verifyOtp({ token_hash: tokenHash, type: typeParam as EmailOtpType })).error;
  } else if (code) {
    ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  }

  const go = (path: string) => NextResponse.redirect(new URL(path, origin));
  if (ok) return go(isRecovery ? '/reset-password' : next);
  if (isRecovery) return go('/forgot-password?error=link');
  // A failed PKCE exchange after a successful verify is the common cross-device case.
  return go(code ? '/login?confirmed=maybe' : '/login?error=link');
}
