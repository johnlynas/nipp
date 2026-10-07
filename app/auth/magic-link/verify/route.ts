import { NextRequest, NextResponse } from 'next/server';
// RLS Phase 3: token consumption + User update run inside lib/oidc-magic-link on
// the global client — User and Verification have no RLS, so no tenant context,
// and @/lib/db stays out of the app tree (lint-restricted).
import { consumeInviteToken, markOidcVerified } from '@/lib/oidc-magic-link';
import { checkAuthRateLimit, getClientIp } from '@/lib/rate-limiter';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

/**
 * GET /auth/magic-link/verify?token=…
 *
 * The destination of the emailed activation link (design §4.3). Consumes the
 * one-time token, marks the account `oidcVerified`, and redirects to /login —
 * it NEVER mints a session (the login cookie must not appear in any response).
 * Activation completes when the user clicks "Sign in with Google" on that page;
 * the provisioning gate in lib/auth.ts then passes. Failure paths
 * (invalid/expired/replay) redirect with `?oidc=link-expired` so the login page
 * can tell the user to ask their administrator for a fresh link. A 429 leaves
 * the token untouched — the mail client / browser can retry after the window.
 */
export async function GET(request: NextRequest) {
  const ip = getClientIp(request);

  // IP-rate-limited: reply WITHOUT touching the token (spec: "token
  // preserved") and hand back a retry hint instead of steering to /login.
  if (!checkAuthRateLimit(ip)) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      { status: 429, headers: { 'Retry-After': '60' } },
    );
  }

  const token = request.nextUrl.searchParams.get('token') ?? '';
  if (!token) {
    // Malformed link — same recovery screen as invalid/expired.
    return NextResponse.redirect(new URL('/login?oidc=link-expired', request.url));
  }

  const result = await consumeInviteToken(token);

  if (result.ok) {
    const { userId } = await markOidcVerified(result.email);
    if (!userId) {
      // Token was valid but the account disappeared after invite — log, then
      // send them to the verified screen so they're not stuck on a dead link.
      logger.error({ email: result.email }, '[OidcVerify] Token consumed but no user row found');
    } else {
      logger.info({ userId, ip }, 'OIDC activation link verified (inbox ownership proven)');
    }
    return NextResponse.redirect(new URL('/login?oidc=link-verified', request.url));
  }

  logger.info({ ip, reason: result.reason ?? 'unknown' }, 'OIDC activation link verification failed (no session issued)');
  return NextResponse.redirect(new URL('/login?oidc=link-expired', request.url));
}
