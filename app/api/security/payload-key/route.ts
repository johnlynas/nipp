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
import { logger } from '@/lib/logger';
import { issuePayloadKey, getPayloadKeyStore, startKeyCleanupScheduler } from '@/lib/payload-key-server';
import { incrementMetric } from '@/lib/payload-metrics';

// ---------------------------------------------------------------------------
// CSRF / origin validation
// ---------------------------------------------------------------------------

/**
 * Validate that the request Origin or Referer matches the trusted frontend URL.
 * Returns true if the origin is trusted, false otherwise.
 */
function isTrustedOrigin(request: NextRequest): boolean {
  const trustedUrl = env.FRONTEND_URL;
  if (!trustedUrl) return true; // No trusted URL configured — allow all (dev mode)

  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');

  // Check Origin header (preferred for same-origin checks)
  if (origin) {
    try {
      const originUrl = new URL(origin);
      const trustedUrlObj = new URL(trustedUrl);
      if (
        originUrl.hostname === trustedUrlObj.hostname &&
        originUrl.port === trustedUrlObj.port
      ) {
        return true;
      }
    } catch {
      // Malformed origin — skip
    }
  }

  // Check Referer header as fallback
  if (referer) {
    try {
      const refererUrl = new URL(referer);
      const trustedUrlObj = new URL(trustedUrl);
      if (
        refererUrl.hostname === trustedUrlObj.hostname &&
        refererUrl.port === trustedUrlObj.port
      ) {
        return true;
      }
    } catch {
      // Malformed referer — skip
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Rate limiting (simple in-memory counter)
// ---------------------------------------------------------------------------

const rateLimitWindow = 60; // seconds
const rateLimitMax = 30;    // requests per window

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

/**
 * Get the trusted client IP.
 * Uses session ID after authentication (more reliable than X-Forwarded-For,
 * which can be spoofed unless proxy headers are explicitly trusted).
 */
function getClientIdentifier(sessionId: string | null, request: NextRequest): string {
  if (sessionId) {
    return `session:${sessionId}`;
  }
  // Fall back to X-Forwarded-For for unauthenticated requests,
  // but only if trusted proxies are configured.
  const trustedProxies = env.TRUSTED_PROXY_CIDRS;
  if (trustedProxies) {
    const forwardedFor = request.headers.get('x-forwarded-for');
    if (forwardedFor) {
      return `ip:${forwardedFor.split(',')[0]?.trim()}`;
    }
  }
  return 'unknown';
}

function checkRateLimit(clientId: string): boolean {
  const now = Math.floor(Date.now() / 1000);

  let entry = rateLimitStore.get(clientId);
  if (!entry || now - entry.windowStart > rateLimitWindow) {
    // New window
    entry = { count: 1, windowStart: now };
    rateLimitStore.set(clientId, entry);
    return true;
  }

  if (entry.count >= rateLimitMax) {
    return false; // Rate limited
  }

  entry.count++;
  return true;
}

// ---------------------------------------------------------------------------
// Cleanup old rate-limit entries (lazy singleton, not module-level)
// ---------------------------------------------------------------------------

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function startRateLimitCleanup(): void {
  if (cleanupTimer) return; // Already running
  cleanupTimer = setInterval(() => {
    const now = Math.floor(Date.now() / 1000);
    for (const [clientId, entry] of rateLimitStore.entries()) {
      if (now - entry.windowStart > rateLimitWindow * 2) {
        rateLimitStore.delete(clientId);
      }
    }
  }, 5 * 60 * 1000);
}

// Start cleanup on first request (avoids issues in dev/tests/serverless)
startRateLimitCleanup();

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
