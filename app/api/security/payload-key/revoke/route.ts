/**
 * POST /api/security/payload-key/revoke
 *
 * Revokes all payload encryption keys for the current session.
 * Called during logout to prevent replay of old encrypted requests.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { isSameOriginRequest } from '@/lib/csrf';
import { logger } from '@/lib/logger';
import { revokeSessionKeys } from '@/lib/payload-key-server';
import { checkRevokeRateLimit, resetRevokeRateLimitStore } from '@/lib/rate-limiter';

// ---------------------------------------------------------------------------
// Route segment configuration — never cache, always dynamic
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ---------------------------------------------------------------------------
// CSRF / origin validation (same logic as the key issuance endpoint)
// ---------------------------------------------------------------------------

/**
 * Validate that the request is same-origin with the server serving it
 * (host-independent — see payload-key/route.ts for rationale).
 */
function isTrustedOrigin(request: NextRequest): boolean {
  return isSameOriginRequest(request.url, request.method, request.headers);
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  // CSRF / origin check — reject cross-site requests
  if (!isTrustedOrigin(request)) {
    logger.warn({ origin: request.headers.get('origin') }, 'Payload key revoke endpoint: untrusted origin rejected');
    return NextResponse.json(
      { error: 'forbidden' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // Rate limit by session ID (authenticated requests are more reliable)
  let sessionId: string | null = null;

  // Validate session first — rate limit by session ID after auth
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return NextResponse.json(
        { error: 'unauthorized' },
        { status: 401, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    sessionId = (session.session as { id?: string }).id || null;
  } catch (error) {
    logger.error({ err: error }, 'Session validation failed for payload key revocation');
    return NextResponse.json(
      { error: 'unauthorized' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  if (!sessionId) {
    logger.warn('Payload key revoke: missing session ID');
    return NextResponse.json(
      { error: 'unauthorized' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // Rate limit by session ID (authenticated requests are more reliable)
  if (!checkRevokeRateLimit(`session:${sessionId}`)) {
    logger.warn({ sessionId }, 'Payload key revoke endpoint rate limited');
    return NextResponse.json(
      { error: 'rate_limited' },
      { status: 429, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    await revokeSessionKeys(sessionId);
    logger.info({ sessionId }, 'Payload keys revoked for session');

    return NextResponse.json(
      { message: 'ok' },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    logger.error({ err: error, sessionId }, 'Failed to revoke payload keys');
    return NextResponse.json(
      { error: 'internal_error' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
