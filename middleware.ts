import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Route protection and tenant context middleware.
 *
 * Protects routes, redirects unauthenticated users to login,
 * and establishes organization context via AsyncLocalStorage.
 */

// Protected routes — require authentication
const PROTECTED_PATTERNS = [
  '/dashboard',
  '/admin',
  '/organizations',
];

// Public routes — accessible without authentication
const PUBLIC_PATTERNS = [
  '/',
  '/login',
  '/register',
  '/api/auth',
];

function isProtectedRoute(pathname: string): boolean {
  return PROTECTED_PATTERNS.some((pattern) => pathname.startsWith(pattern));
}

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_PATTERNS.some((pattern) => pathname.startsWith(pattern));
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip middleware for public routes and API auth
  if (isPublicRoute(pathname)) {
    return NextResponse.next();
  }

  // Check authentication via BetterAuth session cookie
  const sessionCookie = request.cookies.get('better-auth.session_token')?.value;

  if (!sessionCookie && isProtectedRoute(pathname)) {
    // Redirect unauthenticated users to login
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // TODO: Extract organization context from session and set in AsyncLocalStorage
  // This will be implemented when tenant-context.ts is integrated

  return NextResponse.next();
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
