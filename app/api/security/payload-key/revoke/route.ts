/**
 * POST /api/security/payload-key/revoke
 *
 * Revokes all payload encryption keys for the current session.
 * Called during logout to prevent replay of old encrypted requests.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { revokeSessionKeys } from '@/lib/payload-key-server';

// ---------------------------------------------------------------------------
// Route segment configuration — never cache, always dynamic
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ---------------------------------------------------------------------------
// CSRF / origin validation (same logic as the key issuance endpoint)
// ---------------------------------------------------------------------------

/**
 * Validate that the request Origin or Referer matches the trusted frontend URL.
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
// Rate limiting (stricter than key issuance — max 5 revocations per minute)
// ---------------------------------------------------------------------------

const REVOKE_RATE_LIMIT_WINDOW = 60; // seconds
const REVOKE_RATE_LIMIT_MAX = 5;     // requests per window

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const revokeRateLimitStore = new Map<string, RateLimitEntry>();

function checkRevokeRateLimit(clientId: string): boolean {
  const now = Math.floor(Date.now() / 1000);

  let entry = revokeRateLimitStore.get(clientId);
  if (!entry || now - entry.windowStart > REVOKE_RATE_LIMIT_WINDOW) {
    // New window
    entry = { count: 1, windowStart: now };
    revokeRateLimitStore.set(clientId, entry);
    return true;
  }

  if (entry.count >= REVOKE_RATE_LIMIT_MAX) {
    return false; // Rate limited
  }

  entry.count++;
  return true;
}

// ---------------------------------------------------------------------------
// Cleanup old rate-limit entries (lazy singleton)
// ---------------------------------------------------------------------------

let revokeCleanupTimer: ReturnType<typeof setInterval> | null = null;

function startRevokeRateLimitCleanup(): void {
  if (revokeCleanupTimer) return;

  revokeCleanupTimer = setInterval(() => {
    const now = Math.floor(Date.now() / 1000);
    for (const [clientId, entry] of revokeRateLimitStore.entries()) {
      if (now - entry.windowStart > REVOKE_RATE_LIMIT_WINDOW * 2) {
        revokeRateLimitStore.delete(clientId);
      }
    }
  }, 5 * 60 * 1000);

  if (typeof revokeCleanupTimer.unref === 'function') {
    revokeCleanupTimer.unref();
  }
}

startRevokeRateLimitCleanup();

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
