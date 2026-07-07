import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';

/**
 * Route protection and tenant context middleware.
 *
 * Protects routes, redirects unauthenticated users to login,
 * and establishes organization context via AsyncLocalStorage.
 */

// Public routes — accessible without authentication (checked first)
const PUBLIC_PATTERNS = [
  '/login',
  '/register',
  '/api/auth',
];

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_PATTERNS.some((pattern) => pathname === pattern || pathname.startsWith(`${pattern}/`));
}

export async function middleware(request: NextRequest) {
  const { pathname, protocol } = request.nextUrl;

  // Skip middleware for public routes and auth API endpoints
  if (isPublicRoute(pathname)) {
    return NextResponse.next();
  }

  // Validate session using BetterAuth's internal getSession function.
  // This properly checks the database for invalidated/revoked sessions,
  // not just cookie presence.
  // BetterAuth prefixes cookies with __Secure- when BETTER_AUTH_URL uses https://.
  // Check both prefixed and unprefixed variants for compatibility with HTTP and HTTPS dev modes.
  const sessionCookie =
    request.cookies.get('__Secure-better-auth.session_token')?.value ||
    request.cookies.get('better-auth.session_token')?.value ||
    request.cookies.get('__Secure-better-auth-session_token')?.value ||
    request.cookies.get('better-auth-session_token')?.value;

  if (!sessionCookie) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Validate session against the database (handles invalidated/revoked sessions)
  let valid = false;
  try {
    const sessionData = await auth.api.getSession({
      headers: request.headers,
    });
    valid = !!sessionData;
  } catch {
    // DB unreachable — treat as unauthenticated to be safe
    valid = false;
  }

  if (!valid) {
    // Session invalid/expired/revoked — redirect to login
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Prevent caching of protected pages (ensures logout is respected)
  const response = NextResponse.next();
  response.headers.set('Cache-Control', 'no-store, max-age=0');
  response.headers.set('Surrogate-Control', 'no-store');
  response.headers.set('Pragma', 'no-cache');
  response.headers.set('Expires', '0');

  return response;
}

// Run middleware on all routes except static files and API health checks
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder assets
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
