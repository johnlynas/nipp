import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

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

  // Skip middleware for public routes
  if (isPublicRoute(pathname)) {
    return NextResponse.next();
  }

  // SECURE COOKIE CHECK: 
  // Because the logout handler now forcefully clears cookies, 
  // the absence of this cookie definitively means the user is logged out.
  // This avoids Edge Runtime Prisma crashes entirely.
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

  // Prevent caching of protected pages
  const response = NextResponse.next();
  response.headers.set('Cache-Control', 'no-store, max-age=0');
  response.headers.set('Surrogate-Control', 'no-store');
  response.headers.set('Pragma', 'no-cache');
  response.headers.set('Expires', '0');

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
