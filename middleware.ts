import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { LOCALE_COOKIE, isLocale, negotiateLocale } from './lib/i18n/config';

const PROTECTED = ['/app', '/admin'];
const AUTH_ONLY_GUEST = ['/login', '/signup', '/forgot-password'];

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  // First visit: pick a UI language from Accept-Language and remember it.
  if (!isLocale(request.cookies.get(LOCALE_COOKIE)?.value)) {
    const locale = negotiateLocale(request.headers.get('accept-language'));
    request.cookies.set(LOCALE_COOKIE, locale);
    response = NextResponse.next({ request });
    response.cookies.set(LOCALE_COOKIE, locale, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return response;

  const locale = request.cookies.get(LOCALE_COOKIE)?.value;
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(items) {
        items.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        items.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        if (locale) response.cookies.set(LOCALE_COOKIE, locale, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' });
      },
    },
  });

  // Refreshes the session and validates the JWT with Supabase Auth.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const redirectTo = (pathname: string, params?: Record<string, string>) => {
    const target = request.nextUrl.clone();
    target.pathname = pathname;
    target.search = '';
    for (const [k, v] of Object.entries(params ?? {})) target.searchParams.set(k, v);
    const redirect = NextResponse.redirect(target);
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  };

  if (!user && PROTECTED.some((p) => path === p || path.startsWith(`${p}/`))) {
    return redirectTo('/login', { next: path + request.nextUrl.search });
  }
  if (user && AUTH_ONLY_GUEST.includes(path)) {
    return redirectTo('/app');
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|brand/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)'],
};
