import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { env } from '@/lib/env';

const PUBLIC_PATTERNS = [
  '/login',
  '/api/auth',
  '/api/health',
  '/api/notifications/stream', // SSE stream — handles its own auth
  '/api-docs',
];

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_PATTERNS.some((pattern) =>
    pathname === pattern || pathname.startsWith(`${pattern}/`)
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isDev = env.NODE_ENV !== 'production';

  // Dev: Next.js HMR/Fast Refresh requires unsafe-inline + unsafe-eval.
  // Prod: unsafe-inline for script-src is required because Next.js generates
  // inline scripts (hydration, RSC payload) that cannot be given nonces.
  // Nonce-based CSP is not fully supported in Next.js App Router without
  // a custom server. See: https://github.com/vercel/next.js/issues/54850
  const scriptSrcDirective = isDev
    ? `'self' 'unsafe-inline' 'unsafe-eval'`
    : `'self' 'unsafe-inline'`;

  // NOTE: React/Next.js dynamically apply inline styles at runtime
  // (layout, transitions) that cannot be given nonces — hence unsafe-inline.
  const cspHeader = [
    `default-src 'self'`,
    `script-src ${scriptSrcDirective}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self' data:`,
    `connect-src 'self'`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
  ].join('; ');

  const response = NextResponse.next();

  // Use Report-Only in dev to log violations without blocking.
  // Switch to Content-Security-Policy in production to enforce.
  if (isDev) {
    response.headers.set('Content-Security-Policy-Report-Only', cspHeader);
  } else {
    response.headers.set('Content-Security-Policy', cspHeader);
  }

  // Skip auth checks for public routes (CSP headers already set)
  if (isPublicRoute(pathname)) {
    return response;
  }

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