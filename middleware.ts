import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Route protection and tenant context middleware.
 */

// Public routes — accessible without authentication
const PUBLIC_PATTERNS = [
  '/login',
  '/register',
  '/api/auth',
];

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_PATTERNS.some((pattern) => 
    pathname === pattern || pathname.startsWith(`${pattern}/`)
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip middleware for public routes and auth API endpoints
  if (isPublicRoute(pathname)) {
    return NextResponse.next();
  }

  // Check for session cookie presence (fast, no database query)
  // BetterAuth prefixes cookies with __Secure- when BETTER_AUTH_URL uses https://
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

  // Cookie exists — let the request proceed
  // Actual session validation (database check) happens in server components/API routes
  // which run in Node.js runtime and can use Prisma

  // Prevent caching of protected pages (ensures logout is respected)
  const response = NextResponse.next();
  response.headers.set('Cache-Control', 'no-store, max-age=0');
  response.headers.set('Surrogate-Control', 'no-store');
  response.headers.set('Pragma', 'no-cache');
  response.headers.set('Expires', '0');

  return response;
}

// Run middleware on all routes except static files
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};