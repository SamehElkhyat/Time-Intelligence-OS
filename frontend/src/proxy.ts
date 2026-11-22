import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * First line of route protection: a request without a session cookie never reaches an app page.
 *
 * This is only a convenience redirect — it cannot tell whether the session is still valid. The
 * backend authorises every API call, and the app shell re-validates the session on load, so a stale
 * or forged cookie gains nothing.
 */
const SESSION_COOKIE = 'tf_session';
const PUBLIC_PREFIXES = ['/login', '/register', '/forgot-password', '/reset-password', '/verify-email'];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = request.cookies.has(SESSION_COOKIE);
  const isPublic = PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!hasSession && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + request.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  if (hasSession && (pathname === '/login' || pathname === '/register')) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Skip the API proxy, Next internals and static files.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
