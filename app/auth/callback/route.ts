import type { NextRequest } from 'next/server';
import { handleEmailLink } from '@/lib/auth/callback';

/** Default Supabase email links (PKCE `code`) and legacy links. */
export async function GET(request: NextRequest) {
  return handleEmailLink(request);
}
