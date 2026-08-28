/**
 * Shared in-memory rate limiter.
 *
 * Used by payload-key issuance and revoke endpoints.  Exported functions are
 * also exercised directly by integration tests so we don't need to mock the
 * route layer.
 *
 * Configuration (optional env vars, sensible defaults):
 *   RATE_LIMIT_PAYLOAD_KEY_MAX          — max requests per window (default 30)
 *   RATE_LIMIT_PAYLOAD_KEY_WINDOW       — window in seconds (default 60)
 *   RATE_LIMIT_PAYLOAD_KEY_REVOKE_MAX   — max revoke requests per window (default 5)
 *   RATE_LIMIT_PAYLOAD_KEY_REVOKE_WINDOW — window in seconds (default 60)
 */

import { env } from '@/lib/env';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

// ---------------------------------------------------------------------------
// Configuration — read from env with hardcoded defaults
// ---------------------------------------------------------------------------

const PAYLOAD_KEY_MAX = Number(env.RATE_LIMIT_PAYLOAD_KEY_MAX ?? 30);
const PAYLOAD_KEY_WINDOW = Number(env.RATE_LIMIT_PAYLOAD_KEY_WINDOW ?? 60);

const REVOKE_MAX = Number(env.RATE_LIMIT_PAYLOAD_KEY_REVOKE_MAX ?? 5);
const REVOKE_WINDOW = Number(env.RATE_LIMIT_PAYLOAD_KEY_REVOKE_WINDOW ?? 60);

// ---------------------------------------------------------------------------
// Public API — payload key issuance
// ---------------------------------------------------------------------------

/** In-memory store keyed by client identifier. */
export const rateLimitStore = new Map<string, RateLimitEntry>();

/** Window in seconds (read from env or default 60). */
export const RATE_LIMIT_WINDOW = PAYLOAD_KEY_WINDOW;

/** Max requests per window (read from env or default 30). */
export const RATE_LIMIT_MAX = PAYLOAD_KEY_MAX;

/**
 * Check whether a request from `clientId` is within the rate limit.
 * Returns `true` if allowed, `false` if throttled.
 */
export function checkRateLimit(clientId: string): boolean {
  const now = Math.floor(Date.now() / 1000);

  let entry = rateLimitStore.get(clientId);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW) {
    // New window
    entry = { count: 1, windowStart: now };
    rateLimitStore.set(clientId, entry);
    return true;
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return false; // Rate limited
  }

  entry.count++;
  return true;
}

/** Reset the rate limit store — used by tests. */
export function resetRateLimitStore(): void {
  rateLimitStore.clear();
}

// ---------------------------------------------------------------------------
// Cleanup (lazy, starts on first call to checkRateLimit)
// ---------------------------------------------------------------------------

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function startRateLimitCleanup(): void {
  if (cleanupTimer) return; // Already running
  cleanupTimer = setInterval(() => {
    const now = Math.floor(Date.now() / 1000);
    for (const [clientId, entry] of rateLimitStore.entries()) {
      if (now - entry.windowStart > RATE_LIMIT_WINDOW * 2) {
        rateLimitStore.delete(clientId);
      }
    }
  }, 5 * 60 * 1000);
}

// Start cleanup on module load (safe in dev/tests/serverless)
startRateLimitCleanup();

// ---------------------------------------------------------------------------
// Revoke-specific rate limiter (stricter: 5 per minute)
// ---------------------------------------------------------------------------

/** Revoke endpoint store. */
export const revokeRateLimitStore = new Map<string, RateLimitEntry>();

/** Revoke window in seconds (read from env or default 60). */
export const REVOKE_RATE_LIMIT_WINDOW = REVOKE_WINDOW;

/** Revoke max requests per window (read from env or default 5). */
export const REVOKE_RATE_LIMIT_MAX = REVOKE_MAX;

/** Check revoke rate limit — returns true if allowed, false if throttled. */
export function checkRevokeRateLimit(clientId: string): boolean {
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

/** Reset the revoke rate limit store — used by tests. */
export function resetRevokeRateLimitStore(): void {
  revokeRateLimitStore.clear();
}

// Revoke cleanup (lazy)
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
