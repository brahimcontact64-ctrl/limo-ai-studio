import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { getSupabaseServer } from '@/lib/supabase/server';
import { safeNext } from '@/lib/auth/redirect';

/**
 * Handles Supabase email links:
 * - PKCE: ?code=...           (default for @supabase/ssr)
 * - OTP:  ?token_hash=...&type=signup|recovery|email_change|invite|magiclink
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = safeNext(searchParams.get('next'));
  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const supabase = await getSupabaseServer();

  let ok = false;
  if (code) {
    ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  } else if (tokenHash && type) {
    ok = !(await supabase.auth.verifyOtp({ token_hash: tokenHash, type })).error;
  }

  const target = ok ? (type === 'recovery' ? '/reset-password' : next) : '/login?error=link';
  return NextResponse.redirect(new URL(target, origin));
}
