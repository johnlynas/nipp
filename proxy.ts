import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { env } from '@/lib/env';

const PUBLIC_PATTERNS = [
  '/login',
  '/api/auth',
  '/api/health',
  '/api/notifications/stream', // SSE stream — handles its own auth
  '/auth/magic-link/verify', // OIDC invite link destination — rate-limited in-route, never sets a session
  '/auth/forgot-password', // password reset flow — rate-limited in-route, never sets a session
  '/auth/reset-password', // password reset flow — rate-limited in-route, never sets a session
];
// NOTE: /api-docs is intentionally NOT public — unauthenticated requests are
// redirected to /login here, and route handlers (app/api-docs/_guard.ts) then
// deny anything that is not a verified super admin.

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_PATTERNS.some((pattern) =>
    pathname === pattern || pathname.startsWith(`${pattern}/`)
  );
}

export async function proxy(request: NextRequest) {
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
  // The admin agent page iframes the mastra agent server (NIPP_AGENT_URL);
  // without an explicit frame-src it falls back to default-src 'self' and
  // production CSP blocks the embed.
  const agentOrigin = new URL(env.NIPP_AGENT_URL).origin;
  // The tenant Map page loads the Google Maps JS API via @googlemaps/js-api-loader;
  // map tiles, marker icons and fonts come from maps.gstatic.com as well.
  const googleMapsHosts = 'https://maps.googleapis.com https://www.google.com';
  const googleMapsAssets = 'https://maps.gstatic.com';
  const cspHeader = [
    `default-src 'self'`,
    `script-src ${scriptSrcDirective} ${googleMapsHosts}`,
    `style-src 'self' 'unsafe-inline' ${googleMapsHosts} ${googleMapsAssets}`,
    `img-src 'self' data: blob: ${googleMapsHosts} ${googleMapsAssets}`,
    `font-src 'self' data: ${googleMapsHosts} ${googleMapsAssets}`,
    `connect-src 'self' ${googleMapsHosts}`,
    `frame-src ${agentOrigin}`,
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

  // Server-to-server clients (MCP server, agent) authenticate with the portal's
  // BetterAuth bearer token (Authorization: Bearer <session token>, minted via
  // the bearer() plugin's set-auth-token on sign-in). The proxy only checks for
  // the PRESENCE of a credential — actual validation happens in-route
  // (requireSuperAdmin / withAuth → auth.api.getSession resolves the bearer
  // header), so an invalid token gets a JSON 401 from the route, not this
  // redirect. Browser clients keep the cookie door above; both coexist.
  const authorization = request.headers.get('authorization');
  const hasBearer = !!authorization && authorization.startsWith('Bearer ');

  if (!sessionCookie && !hasBearer) {
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