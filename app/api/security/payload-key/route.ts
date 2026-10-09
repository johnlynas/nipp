/**
 * POST /api/security/payload-key
 *
 * Authenticated endpoint that issues short-lived payload encryption keys.
 * The client sends its BetterAuth session cookie; the server validates it
 * and returns a base64url-encoded AES-256-GCM key material along with
 * metadata (keyId, algorithm, expiresAt).
 *
 * Response headers include Cache-Control: no-store to prevent caching.
 *
 * CSRF protection: requires Origin or Referer header matching the trusted
 * frontend URL. This prevents cross-site request forgery attacks where a
 * malicious site could trigger key issuance on behalf of an authenticated user.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { env } from '@/lib/env';
import { isSameOriginRequest } from '@/lib/csrf';
import { logger } from '@/lib/logger';
import { issuePayloadKey, getPayloadKeyStore, startKeyCleanupScheduler } from '@/lib/payload-key-server';
import { incrementMetric } from '@/lib/payload-metrics';
import { checkRateLimit, resetRateLimitStore, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW } from '@/lib/rate-limiter';

// ---------------------------------------------------------------------------
// CSRF / origin validation (PUBLIC ACCESS fix)
// ---------------------------------------------------------------------------

/**
 * Validate that the request is same-origin with the server serving it.
 *
 * Uses isSameOriginRequest (request's own origin vs Origin/Referer) instead of
 * comparing against env.FRONTEND_URL: a browser on a LAN IP / tunnel hostname
 * sends `http://<that-host>` as its Origin, which the FRONTEND_URL pin rejected
 * with 403 — breaking every PII-routed call (payload key prerequisite) for
 * non-localhost clients. Same origin = the server itself on any reachable host.
 */
function isTrustedOrigin(request: NextRequest): boolean {
  return isSameOriginRequest(request.url, request.method, request.headers);
}

// Start the payload key cleanup scheduler (lazy, unref'd)
startKeyCleanupScheduler();

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  // CSRF / origin check — reject cross-site requests
  if (!isTrustedOrigin(request)) {
    logger.warn({ origin: request.headers.get('origin') }, 'Payload key endpoint: untrusted origin rejected');
    return NextResponse.json(
      { error: 'forbidden' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // Validate session first — rate limit by session ID after auth
  let session;
  try {
    session = await auth.api.getSession({
      headers: request.headers,
    });
  } catch (error) {
    logger.error({ err: error }, 'Session validation failed for payload key request');
    return NextResponse.json(
      { error: 'unauthorized' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  if (!session) {
    logger.warn('Unauthenticated payload key request');
    return NextResponse.json(
      { error: 'unauthorized' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const sessionId = (session.session as { id?: string }).id;
  if (!sessionId) {
    return NextResponse.json(
      { error: 'unauthorized' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // Rate limit by session ID (authenticated requests are more reliable)
  if (!checkRateLimit(`session:${sessionId}`)) {
    incrementMetric('keyRateLimited');
    logger.warn({ sessionId }, 'Payload key endpoint rate limited');
    return NextResponse.json(
      { error: 'rate_limited' },
      { status: 429, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // Issue a new payload key
  const ttlSeconds = env.PAYLOAD_ENCRYPTION_KEY_TTL_SECONDS;

  try {
    const payloadKey = await issuePayloadKey(sessionId, ttlSeconds);

    // Store the key material in the payload key store
    const store = getPayloadKeyStore();
    await store.put(payloadKey);

    incrementMetric('keyIssuanceCount');

    // Return the key (key material is base64url-encoded)
    const response = NextResponse.json({
      keyId: payloadKey.keyId,
      algorithm: payloadKey.algorithm,
      expiresAt: payloadKey.expiresAt,
      key: payloadKey.keyMaterial,
      sessionId: payloadKey.sessionId,
    });

    // Prevent caching of the response
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('Pragma', 'no-cache');

    return response;
  } catch (error) {
    logger.error({ err: error, sessionId }, 'Failed to issue payload key');
    return NextResponse.json(
      { error: 'internal_error' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
