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
 *   RATE_LIMIT_AUTH_MAX                 — max requests per window for auth endpoints (default 5)
 *   RATE_LIMIT_AUTH_WINDOW              — window in seconds for auth endpoints (default 60)
 *   RATE_LIMIT_ADMIN_MAX                — max requests per window for admin writes (default 30)
 *   RATE_LIMIT_ADMIN_WINDOW             — window in seconds for admin writes (default 60)
 *   RATE_LIMIT_CALENDAR_MAX             — max requests per window for calendar CRUD (default 30)
 *   RATE_LIMIT_CALENDAR_WINDOW          — window in seconds for calendar CRUD (default 60)
 */

import { env } from '@/lib/env';
import { auth } from '@/lib/auth';

// ---------------------------------------------------------------------------
// Helpers — session extraction (used by route wrappers)
// ---------------------------------------------------------------------------

/** Extract the session ID from a request — used for rate limiting. */
export async function getSessionId(request: Request): Promise<string | null> {
  try {
    const session = await auth.api.getSession({ headers: new Headers(request.headers) });
    return (session?.session as { id?: string })?.id ?? null;
  } catch {
    return null;
  }
}

/** Extract client IP from request headers (handles proxies). */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip') ?? 'unknown';
}

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

const AUTH_MAX = Number(env.RATE_LIMIT_AUTH_MAX ?? 5);
const AUTH_WINDOW = Number(env.RATE_LIMIT_AUTH_WINDOW ?? 60);

const ADMIN_MAX = Number(env.RATE_LIMIT_ADMIN_MAX ?? 30);
const ADMIN_WINDOW = Number(env.RATE_LIMIT_ADMIN_WINDOW ?? 60);

const CALENDAR_MAX = Number(env.RATE_LIMIT_CALENDAR_MAX ?? 30);
const CALENDAR_WINDOW = Number(env.RATE_LIMIT_CALENDAR_WINDOW ?? 60);

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

// ---------------------------------------------------------------------------
// Auth endpoint rate limiter (by IP, stricter: 5 per minute)
// ---------------------------------------------------------------------------

/** Auth endpoint store — keyed by client IP address. */
export const authRateLimitStore = new Map<string, RateLimitEntry>();

/** Auth window in seconds (read from env or default 60). */
export const AUTH_RATE_LIMIT_WINDOW = AUTH_WINDOW;

/** Auth max requests per window (read from env or default 5). */
export const AUTH_RATE_LIMIT_MAX = AUTH_MAX;

/**
 * Check auth rate limit by IP address — returns true if allowed, false if throttled.
 * Used for login/register brute-force protection on the BetterAuth catch-all route.
 */
export function checkAuthRateLimit(ipAddress: string): boolean {
  const now = Math.floor(Date.now() / 1000);

  let entry = authRateLimitStore.get(ipAddress);
  if (!entry || now - entry.windowStart > AUTH_RATE_LIMIT_WINDOW) {
    // New window
    entry = { count: 1, windowStart: now };
    authRateLimitStore.set(ipAddress, entry);
    return true;
  }

  if (entry.count >= AUTH_RATE_LIMIT_MAX) {
    return false; // Rate limited
  }

  entry.count++;
  return true;
}

/** Reset the auth rate limit store — used by tests. */
export function resetAuthRateLimitStore(): void {
  authRateLimitStore.clear();
}

// Auth cleanup (lazy)
let authCleanupTimer: ReturnType<typeof setInterval> | null = null;

function startAuthRateLimitCleanup(): void {
  if (authCleanupTimer) return;

  authCleanupTimer = setInterval(() => {
    const now = Math.floor(Date.now() / 1000);
    for (const [ip, entry] of authRateLimitStore.entries()) {
      if (now - entry.windowStart > AUTH_RATE_LIMIT_WINDOW * 2) {
        authRateLimitStore.delete(ip);
      }
    }
  }, 5 * 60 * 1000);

  if (typeof authCleanupTimer.unref === 'function') {
    authCleanupTimer.unref();
  }
}

startAuthRateLimitCleanup();

// ---------------------------------------------------------------------------
// Admin write rate limiter (by session: 30 per minute)
// ---------------------------------------------------------------------------

/** Admin writes store — keyed by session ID. */
export const adminRateLimitStore = new Map<string, RateLimitEntry>();

/** Admin write window in seconds (read from env or default 60). */
export const ADMIN_RATE_LIMIT_WINDOW = ADMIN_WINDOW;

/** Admin write max requests per window (read from env or default 30). */
export const ADMIN_RATE_LIMIT_MAX = ADMIN_MAX;

/**
 * Check admin write rate limit by session — returns true if allowed, false if throttled.
 * Used for all admin POST/PATCH/DELETE endpoints to prevent bulk data modification abuse.
 */
export function checkAdminRateLimit(sessionId: string): boolean {
  const now = Math.floor(Date.now() / 1000);

  let entry = adminRateLimitStore.get(sessionId);
  if (!entry || now - entry.windowStart > ADMIN_RATE_LIMIT_WINDOW) {
    // New window
    entry = { count: 1, windowStart: now };
    adminRateLimitStore.set(sessionId, entry);
    return true;
  }

  if (entry.count >= ADMIN_RATE_LIMIT_MAX) {
    return false; // Rate limited
  }

  entry.count++;
  return true;
}

/** Reset the admin rate limit store — used by tests. */
export function resetAdminRateLimitStore(): void {
  adminRateLimitStore.clear();
}

// Admin cleanup (lazy)
let adminCleanupTimer: ReturnType<typeof setInterval> | null = null;

/** Clean up stale entries from the admin rate limit store. Exposed for testing. */
export function cleanAdminRateLimitStore(now: number = Math.floor(Date.now() / 1000)): void {
  for (const [sessionId, entry] of adminRateLimitStore.entries()) {
    if (now - entry.windowStart > ADMIN_RATE_LIMIT_WINDOW * 2) {
      adminRateLimitStore.delete(sessionId);
    }
  }
}

export function startAdminRateLimitCleanup(): void {
  if (adminCleanupTimer) return;

  adminCleanupTimer = setInterval(() => {
    cleanAdminRateLimitStore();
  }, 5 * 60 * 1000);

  if (typeof adminCleanupTimer.unref === 'function') {
    adminCleanupTimer.unref();
  }
}

startAdminRateLimitCleanup();

// ---------------------------------------------------------------------------
// Calendar CRUD rate limiter (by session: 30 per minute)
// ---------------------------------------------------------------------------

/** Calendar CRUD store — keyed by session ID. */
export const calendarRateLimitStore = new Map<string, RateLimitEntry>();

/** Calendar CRUD window in seconds (read from env or default 60). */
export const CALENDAR_RATE_LIMIT_WINDOW = CALENDAR_WINDOW;

/** Calendar CRUD max requests per window (read from env or default 30). */
export const CALENDAR_RATE_LIMIT_MAX = CALENDAR_MAX;

/**
 * Check calendar CRUD rate limit by session — returns true if allowed, false if throttled.
 * Used for all calendar event POST/PATCH/DELETE endpoints to prevent abuse of CRUD operations.
 */
export function checkCalendarRateLimit(sessionId: string): boolean {
  const now = Math.floor(Date.now() / 1000);

  let entry = calendarRateLimitStore.get(sessionId);
  if (!entry || now - entry.windowStart > CALENDAR_RATE_LIMIT_WINDOW) {
    // New window
    entry = { count: 1, windowStart: now };
    calendarRateLimitStore.set(sessionId, entry);
    return true;
  }

  if (entry.count >= CALENDAR_RATE_LIMIT_MAX) {
    return false; // Rate limited
  }

  entry.count++;
  return true;
}

/** Reset the calendar rate limit store — used by tests. */
export function resetCalendarRateLimitStore(): void {
  calendarRateLimitStore.clear();
}

// Calendar cleanup (lazy)
let calendarCleanupTimer: ReturnType<typeof setInterval> | null = null;

/** Clean up stale entries from the calendar rate limit store. Exposed for testing. */
export function cleanCalendarRateLimitStore(now: number = Math.floor(Date.now() / 1000)): void {
  for (const [sessionId, entry] of calendarRateLimitStore.entries()) {
    if (now - entry.windowStart > CALENDAR_RATE_LIMIT_WINDOW * 2) {
      calendarRateLimitStore.delete(sessionId);
    }
  }
}

export function startCalendarRateLimitCleanup(): void {
  if (calendarCleanupTimer) return;

  calendarCleanupTimer = setInterval(() => {
    cleanCalendarRateLimitStore();
  }, 5 * 60 * 1000);

  if (typeof calendarCleanupTimer.unref === 'function') {
    calendarCleanupTimer.unref();
  }
}

startCalendarRateLimitCleanup();
