import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { generateNonce } from '@/lib/csp-nonce';
import { env } from '@/lib/env';

const PUBLIC_PATTERNS = [
  '/login',
  '/api/auth',
  '/api/health',
];

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_PATTERNS.some((pattern) => 
    pathname === pattern || pathname.startsWith(`${pattern}/`)
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Generate CSP nonce for every request (Edge Runtime compatible)
  const nonce = generateNonce();
  
  // Set the nonce header for App Router components to consume
  request.headers.set('x-csp-nonce', nonce);

  // Allow 'unsafe-eval' ONLY in development for Next.js Fast Refresh (HMR)
  // In Edge runtime, NODE_ENV might not be strictly 'development', so we check if it's NOT production
  const isDev = env.NODE_ENV !== 'production';
  const scriptSrcDirective = isDev 
    ? `'self' 'unsafe-eval' 'nonce-${nonce}'` 
    : `'self' 'nonce-${nonce}'`;

  // Construct the strict CSP string
  const cspHeader = `
    default-src 'self';
    script-src ${scriptSrcDirective};
    style-src 'self' 'unsafe-inline'; // NOTE: React/Next.js dynamically apply inline styles at runtime (layout, transitions) that cannot be given nonces. This is a known trade-off.
    img-src 'self' data: blob:;
    font-src 'self' data:;
    connect-src 'self';
    frame-ancestors 'none';
    base-uri 'self';
    form-action 'self';
  `.replace(/\s{2,}/g, ' ').trim();

  // Create response early so CSP header is attached to all responses
  const response = NextResponse.next();

  // Set to Content-Security-Policy-Report-Only , to detect and log  CSP issues developer console
  // Set to Content-Security-Policy , to activate CSP checks
  response.headers.set('Content-Security-Policy', cspHeader);

  // Skip middleware for public routes (but CSP headers are already set)
  if (isPublicRoute(pathname)) {
    return response;
  }

  // SECURE COOKIE CHECK: 
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
