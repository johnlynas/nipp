# Unified Rate Limiting System

## Overview

This document describes the unified rate limiting system for the Property NI API. The system provides a single, configurable rate limiter that all routes can use with per-route policies defined via environment variables.

## Problem Statement

The codebase had three separate, hardcoded rate-limiting implementations:
- **Payload key issuance** (`POST /api/security/payload-key`): 30 req/min per session, in-memory Map
- **Payload key revocation** (`POST /api/security/payload-key/revoke`): 5 req/min per session, in-memory Map
- **Notification dispatcher** (`lib/notifications/dispatcher.ts`): 5 per event type/recipient/24h, Redis-backed

This fragmentation made it impossible to:
1. Apply rate limiting consistently across all unprotected routes (admin, dashboard-admin, auth, organizations)
2. Adjust limits without modifying source code
3. Understand the full rate limiting picture at a glance

## Architecture

### Unified Rate Limiter Module

The shared module `lib/rate-limiter.ts` provides:
- **In-memory stores** for HTTP route rate limiting (payload-key issuance + revocation)
- **Exported functions**: `checkRateLimit()`, `checkRevokeRateLimit()`
- **Exported stores** for test access: `rateLimitStore`, `revokeRateLimitStore`
- **Lazy cleanup timers** that run every 5 minutes to remove stale entries (older than 2× window)

### Notification Rate Limiting

The notification dispatcher (`lib/notifications/events.ts`) uses its own Redis-backed rate limiter for email notifications. This is separate from HTTP route rate limiting because:
- Notifications are triggered by events, not direct API calls
- The rate limit is per-event-type/recipient/window (not per-session)
- Redis persistence ensures consistency across multiple application instances

### Configuration via Environment Variables

All rate limits are configurable through environment variables with sensible defaults. No source code changes required to adjust thresholds:

| Variable | Purpose | Default |
|----------|---------|---------|
| `RATE_LIMIT_PAYLOAD_KEY_MAX` | Max requests per window for key issuance | 30 |
| `RATE_LIMIT_PAYLOAD_KEY_WINDOW` | Window duration in seconds for key issuance | 60 |
| `RATE_LIMIT_PAYLOAD_KEY_REVOKE_MAX` | Max requests per window for key revocation | 5 |
| `RATE_LIMIT_PAYLOAD_KEY_REVOKE_WINDOW` | Window duration in seconds for key revocation | 60 |
| `RATE_LIMIT_NOTIFICATION_MAX` | Max notifications per event type/recipient/window | 5 |
| `RATE_LIMIT_NOTIFICATION_WINDOW_HOURS` | Window duration in hours for notifications | 24 |

### Route Categories and Rate Limiting Needs

The API has **75+ routes** across 8 categories:

| Category | Routes | Rate Limiting Status | Notes |
|----------|--------|---------------------|-------|
| **health** | 1 | Not needed | GET only, public endpoint |
| **auth** | 4 | Partially protected | BetterAuth provides brute-force protection (5 sign-in attempts/15 min) |
| **admin** | 23 | Not rate limited | High-risk: bulk writes, sensitive data access — needs protection |
| **dashboard-admin** | 20 | Not rate limited | Same as admin — needs protection |
| **organizations** | 18 | Not rate limited | Per-org operations — needs protection |
| **roles** | 6 | Not rate limited | Org-scoped role management — needs protection |
| **notifications** | 1 | Partially protected | `send-today` uses notification dispatcher rate limiting |
| **security** | 2 | Rate limited | Payload-key issuance + revocation endpoints |

### Future Work: Applying Rate Limiting to Unprotected Routes

The unified rate limiter module is ready to be wired into unprotected routes. The pattern for adding rate limiting to any route:

```typescript
import { checkRateLimit, resetRateLimitStore } from '@/lib/rate-limiter';

// Inside POST handler (after auth check):
if (!checkRateLimit(`session:${sessionId}`)) {
  return NextResponse.json(
    { error: 'rate_limited' },
    { status: 429, headers: { 'Retry-After': String(RATE_LIMIT_WINDOW) } },
  );
}
```

**Priority routes for rate limiting:**
1. **Admin/Dashboard-Admin POST/PUT/DELETE** — Bulk operations that modify data
2. **Auth login/register endpoints** — Brute-force protection beyond BetterAuth defaults
3. **Organization CRUD operations** — Prevent abuse of org management APIs

## Implementation Notes

### In-Memory Store Behavior
- Stores are keyed by client identifier (e.g., `session:{sessionId}`)
- Each route category can use the same store or separate stores depending on policy needs
- Cleanup runs every 5 minutes, removing entries older than 2× the window duration

### Testability
- Exported `resetRateLimitStore()` and `resetRevokeRateLimitStore()` functions allow tests to clear state between test cases
- Integration tests import directly from `@/lib/rate-limiter` rather than mocking route files
- This avoids Next.js type generation issues with non-route exports

### Multi-Instance Considerations
- In-memory stores are per-instance (not shared across replicas)
- For multi-instance deployments, consider migrating to Redis-backed rate limiting for the HTTP routes (similar to notification dispatcher)
- The current design supports this migration path — only the store implementation would change

## References

- **Design doc**: `openspec/changes/unified-rate-limiter/design.md` (this file)
- **Implementation**: `lib/rate-limiter.ts`, `lib/notifications/events.ts`
- **Tests**: `tests/integration/rate-limiting.test.ts`, `tests/unit/notification-dispatcher.test.ts`
- **Security docs**: `SECURITY.md` (Rate Limiting Configuration section)
