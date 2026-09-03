# Proposal: Unified Rate Limiting System

**Status:** Proposed  
**Author:** John Lynas  
**Created:** 2026-08-28  
**Last Updated:** 2026-08-28  
**Related Issues:** Security initiative, API abuse prevention

## Summary

Consolidate three separate, hardcoded rate-limiting implementations into a single configurable module (`lib/rate-limiter.ts`) with all thresholds controlled via environment variables. The system provides in-memory rate limiting for HTTP routes (payload-key issuance and revocation) and integrates with the existing Redis-backed notification dispatcher. No source code changes are required to adjust rate limit thresholds — all values are read from environment variables with sensible defaults.

## Motivation

The codebase had three separate, hardcoded rate-limiting implementations:

- **Payload key issuance** (`POST /api/security/payload-key`): 30 req/min per session, in-memory Map
- **Payload key revocation** (`POST /api/security/payload-key/revoke`): 5 req/min per session, in-memory Map
- **Notification dispatcher** (`lib/notifications/events.ts`): 5 per event type/recipient/24h, Redis-backed

This fragmentation made it impossible to:
1. Apply rate limiting consistently across all unprotected routes (admin, dashboard-admin, auth, organizations)
2. Adjust limits without modifying source code
3. Understand the full rate limiting picture at a glance

## References & Foundational Rules

This proposal builds upon and must strictly adhere to the rules established in:
- `project-initialization`: Core architecture, tenant isolation, and environment variable patterns.
- `l1-cache-layer`: In-memory caching patterns and store management conventions.

Mandatory Rules enforced in this proposal:
- **Unified Architecture:** Single Next.js origin. No separate backend servers.
- **Secrets Management:** New env vars added to `.env.example` — no real secrets committed.
- **Testability:** Exported stores and reset functions allow tests to clear state between test cases.

## Non-Regression Requirements

This proposal MUST NOT break any existing functionality:
- **Payload Key Issuance:** The existing rate limit of 30 req/min per session must continue to work with the same behavior.
- **Payload Key Revocation:** The existing rate limit of 5 req/min per session must continue to work with the same behavior.
- **Notification Dispatcher:** The existing Redis-backed notification rate limiting (5 per event type/recipient/24h) must continue to work unchanged.
- **Existing Tests:** All existing tests must pass with zero regressions.

## Scope

**In scope:**
- **Shared Module:** Create `lib/rate-limiter.ts` with two independent in-memory stores — one for payload key issuance (default 30 req/min) and one for revocation (default 5 req/min).
- **Lazy Cleanup Timers:** Each store has a cleanup interval running every 5 minutes, removing entries older than 2× the window duration.
- **Exported API:** `checkRateLimit()`, `checkRevokeRateLimit()` for use in route handlers; `resetRateLimitStore()`, `resetRevokeRateLimitStore()` for tests.
- **Exported Stores:** `rateLimitStore`, `revokeRateLimitStore` for test access (avoids mocking route files).
- **Environment Variables:** Six new optional env vars in `lib/env-schema.ts` with Zod validation (digits-only regex, optional).
- **Env Templates:** Add all six rate limit env vars to `.env.example` with default values.
- **Route Integration:** Wire the rate limiter into `app/api/security/payload-key/route.ts` and `app/api/security/payload-key/revoke/route.ts`.
- **Integration Tests:** Add tests in `tests/integration/rate-limiting.test.ts` exercising both stores, cleanup behavior, and env var overrides.

**Out of scope (Deferred):**
- Rate limiting for admin/dashboard-admin POST/PUT/DELETE endpoints — the module is ready to be wired in, but applying it to those routes is a follow-up.
- Rate limiting for auth login/register endpoints — BetterAuth already provides brute-force protection (5 sign-in attempts/15 min).
- Rate limiting for organization CRUD operations — same deferred category.
- Redis-backed rate limiting for HTTP routes — the current in-memory design supports a future migration path.
- Per-route rate limit policies beyond issuance and revocation — the module is generic enough to support this later.

## Detailed Design Overview

The shared module `lib/rate-limiter.ts` provides two independent in-memory stores, each with its own cleanup timer:

1. **Payload Key Issuance Store** — keyed by `session:{sessionId}`, default 30 requests per 60-second window.
2. **Payload Key Revocation Store** — keyed by `session:{sessionId}`, default 5 requests per 60-second window.

Both stores use the same algorithm:
- On each request, check if a window entry exists for the client ID.
- If no entry or the window has expired, start a new window with count 1 (allowed).
- If within the window and count < max, increment count (allowed).
- If within the window and count >= max, reject with 429.

A lazy cleanup interval runs every 5 minutes per store, deleting entries older than 2× the window duration. This prevents unbounded memory growth from stale session IDs.

Configuration is read from environment variables at module load time, with hardcoded defaults as fallbacks:

| Variable | Purpose | Default |
|----------|---------|---------|
| `RATE_LIMIT_PAYLOAD_KEY_MAX` | Max requests per window for key issuance | 30 |
| `RATE_LIMIT_PAYLOAD_KEY_WINDOW` | Window duration in seconds for key issuance | 60 |
| `RATE_LIMIT_PAYLOAD_KEY_REVOKE_MAX` | Max requests per window for key revocation | 5 |
| `RATE_LIMIT_PAYLOAD_KEY_REVOKE_WINDOW` | Window duration in seconds for key revocation | 60 |
| `RATE_LIMIT_NOTIFICATION_MAX` | Max notifications per event type/recipient/window | 5 |
| `RATE_LIMIT_NOTIFICATION_WINDOW_HOURS` | Window duration in hours for notifications | 24 |

The notification dispatcher (`lib/notifications/events.ts`) uses its own Redis-backed rate limiter, which is separate from HTTP route rate limiting because notifications are triggered by events (not direct API calls) and require Redis persistence for consistency across multiple application instances.

## Files to Create or Modify

| Type | File Path | Purpose |
|------|-----------|---------|
| New | `lib/rate-limiter.ts` | Shared in-memory rate limiter module with two stores |
| Modified | `lib/env-schema.ts` | Add 6 rate limit env vars (digits-only regex, optional) |
| Modified | `.env.example` | Add all 6 rate limit env vars with defaults |
| Modified | `app/api/security/payload-key/route.ts` | Wire in `checkRateLimit()` |
| Modified | `app/api/security/payload-key/revoke/route.ts` | Wire in `checkRevokeRateLimit()` |
| New | `tests/integration/rate-limiting.test.ts` | Integration tests for both stores and cleanup |

## Testing Plan

- **Integration Tests:** Verify `checkRateLimit()` allows requests within the limit and rejects when exceeded.
- **Integration Tests:** Verify `checkRevokeRateLimit()` has stricter limits (5/min vs 30/min).
- **Integration Tests:** Verify cleanup removes stale entries after 2× window duration.
- **Integration Tests:** Verify env var overrides work (e.g., set `RATE_LIMIT_PAYLOAD_KEY_MAX=10` and confirm 10-request limit).
- **Integration Tests:** Verify stores are reset correctly between tests via `resetRateLimitStore()` / `resetRevokeRateLimitStore()`.
- **Manual Testing:** Hit the payload-key endpoints with rapid requests, verify 429 response after limit.

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| In-memory stores are per-instance (not shared across replicas) | Medium | Document multi-instance consideration; migration path to Redis-backed stores exists |
| Cleanup timer leaks in long-running dev servers | Low | Timer uses `unref()` where available so it doesn't prevent process exit |
| Stale session IDs accumulate in store before cleanup runs | Low | Cleanup runs every 5 minutes; entries are deleted after 2× window (120s), so max lifetime is bounded |
| Env var schema allows empty strings via `optional()` | Low | Zod `.regex(/^\d+$/)` only matches one-or-more digits; empty string is rejected by the regex |
| Rate limit key collision across tenants | Low | Keys are session-scoped (`session:{sessionId}`), which is unique per authenticated user |

## Acceptance Criteria

- [ ] `lib/rate-limiter.ts` exports `checkRateLimit()`, `checkRevokeRateLimit()`, stores, and reset functions.
- [ ] Both stores use in-memory `Map` with correct window-based counting logic.
- [ ] Cleanup timers run every 5 minutes and remove entries older than 2× the window.
- [ ] All six rate limit env vars are in `lib/env-schema.ts` with Zod validation (digits-only regex, optional).
- [ ] All six rate limit env vars are in `.env.example` with default values.
- [ ] Payload-key issuance route returns 429 when rate limit is exceeded.
- [ ] Payload-key revocation route returns 429 when its stricter rate limit is exceeded.
- [ ] Integration tests verify both stores, cleanup behavior, and env var overrides.
- [ ] All existing tests pass with zero TypeScript errors and zero ESLint warnings.
