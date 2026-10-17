import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { LOCALE_COOKIE, isLocale, negotiateLocale } from './lib/i18n/config';

const PROTECTED = ['/app', '/admin'];
const AUTH_ONLY_GUEST = ['/login', '/signup', '/forgot-password'];
const UUID = '([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})';
/** Private detail pages checked for visibility before rendering (see below). */
const DETAIL_ROUTES = [
  { pattern: new RegExp(`^/app/stories/${UUID}(?:/|$)`), table: 'content_series' },
  { pattern: new RegExp(`^/app/projects/${UUID}(?:/|$)`), table: 'studio_projects' },
  { pattern: new RegExp(`^/app/images/${UUID}(?:/|$)`), table: 'image_projects' },
  { pattern: new RegExp(`^/app/posts/${UUID}(?:/|$)`), table: 'social_posts' },
] as const;

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

  // Detail pages of private resources: answer a real 404 (not a streamed 200) when the signed-in user
  // cannot see the row. RLS decides visibility; no data is read beyond the id.
  if (user) {
    const m = DETAIL_ROUTES.map((r) => ({ r, match: r.pattern.exec(path) })).find((x) => x.match);
    if (m?.match) {
      const { data, error } = await supabase.from(m.r.table).select('id').eq('id', m.match[1]!).maybeSingle();
      // Missing table (migration not applied) → let the page handle it.
      if (!data && !(error && (error.code === '42P01' || error.code === 'PGRST205'))) {
        const notFound = NextResponse.rewrite(new URL('/__not-found', request.url), { status: 404 });
        response.cookies.getAll().forEach((c) => notFound.cookies.set(c));
        return notFound;
      }
    }
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|brand/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)'],
};
