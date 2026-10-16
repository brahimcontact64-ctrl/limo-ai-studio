import type { NextRequest } from 'next/server';
import { handleEmailLink } from '@/lib/auth/callback';

/** LIMO email templates link here with token_hash + type (supabase/templates/*.html). */
export async function GET(request: NextRequest) {
  return handleEmailLink(request);
}
