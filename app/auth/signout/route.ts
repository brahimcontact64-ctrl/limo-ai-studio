import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { ACTIVE_ORG_COOKIE } from '@/lib/data/context';

/** POST-only so that sign-out cannot be triggered by a cross-site GET (e.g. an <img> tag). */
export async function POST(request: NextRequest) {
  const supabase = await getSupabaseServer();
  await supabase.auth.signOut({ scope: 'local' });
  const response = NextResponse.redirect(new URL('/login', request.nextUrl.origin), { status: 303 });
  response.cookies.delete(ACTIVE_ORG_COOKIE);
  return response;
}
