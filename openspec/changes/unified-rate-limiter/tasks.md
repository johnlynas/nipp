# Tasks: Unified Rate Limiting System

## Phase 1: Environment Variable Schema
- [ ] **Task 1.1:** Add `RATE_LIMIT_PAYLOAD_KEY_MAX` to Zod env schema in `lib/env-schema.ts` (type: `z.string().regex(/^\d+$/).optional()`, default via hardcoded fallback 30)
- [ ] **Task 1.2:** Add `RATE_LIMIT_PAYLOAD_KEY_WINDOW` to Zod env schema (type: `z.string().regex(/^\d+$/).optional()`, default 60)
- [ ] **Task 1.3:** Add `RATE_LIMIT_PAYLOAD_KEY_REVOKE_MAX` to Zod env schema (type: `z.string().regex(/^\d+$/).optional()`, default 5)
- [ ] **Task 1.4:** Add `RATE_LIMIT_PAYLOAD_KEY_REVOKE_WINDOW` to Zod env schema (type: `z.string().regex(/^\d+$/).optional()`, default 60)
- [ ] **Task 1.5:** Add `RATE_LIMIT_NOTIFICATION_MAX` to Zod env schema (type: `z.string().regex(/^\d+$/).optional()`, default 5)
- [ ] **Task 1.6:** Add `RATE_LIMIT_NOTIFICATION_WINDOW_HOURS` to Zod env schema (type: `z.string().regex(/^\d+$/).optional()`, default 24)

## Phase 2: Environment Variable Templates
- [ ] **Task 2.1:** Add `RATE_LIMIT_PAYLOAD_KEY_MAX=30` to `.env.example`
- [ ] **Task 2.2:** Add `RATE_LIMIT_PAYLOAD_KEY_WINDOW=60` to `.env.example`
- [ ] **Task 2.3:** Add `RATE_LIMIT_PAYLOAD_KEY_REVOKE_MAX=5` to `.env.example`
- [ ] **Task 2.4:** Add `RATE_LIMIT_PAYLOAD_KEY_REVOKE_WINDOW=60` to `.env.example`
- [ ] **Task 2.5:** Add `RATE_LIMIT_NOTIFICATION_MAX=5` to `.env.example`
- [ ] **Task 2.6:** Add `RATE_LIMIT_NOTIFICATION_WINDOW_HOURS=24` to `.env.example`

## Phase 3: Rate Limiter Module
- [ ] **Task 3.1:** Create `lib/rate-limiter.ts` with `RateLimitEntry` interface (`count: number`, `windowStart: number`)
- [ ] **Task 3.2:** Implement payload key issuance store (`rateLimitStore: Map<string, RateLimitEntry>`) with `checkRateLimit(clientId)` and `resetRateLimitStore()`
- [ ] **Task 3.3:** Implement payload key revocation store (`revokeRateLimitStore: Map<string, RateLimitEntry>`) with `checkRevokeRateLimit(clientId)` and `resetRevokeRateLimitStore()`
- [ ] **Task 3.4:** Implement lazy cleanup timer for issuance store — runs every 5 minutes, removes entries older than 2× window
- [ ] **Task 3.5:** Implement lazy cleanup timer for revocation store — same behavior, with `unref()` where available
- [ ] **Task 3.6:** Export constants: `RATE_LIMIT_WINDOW`, `RATE_LIMIT_MAX`, `REVOKE_RATE_LIMIT_WINDOW`, `REVOKE_RATE_LIMIT_MAX`

## Phase 4: Route Integration — Payload Key Issuance
- [ ] **Task 4.1:** Import `checkRateLimit` and `resetRateLimitStore` into `app/api/security/payload-key/route.ts`
- [ ] **Task 4.2:** Add rate limit check in POST handler: call `checkRateLimit(\`session:${sessionId}\`)` after auth validation
- [ ] **Task 4.3:** Return `{ error: 'rate_limited' }` with status 429 and `Retry-After` header when rate limited
- [ ] **Task 4.4:** Add `resetRateLimitStore()` call in test setup (beforeEach)

## Phase 5: Route Integration — Payload Key Revocation
- [ ] **Task 5.1:** Import `checkRevokeRateLimit` and `resetRevokeRateLimitStore` into `app/api/security/payload-key/revoke/route.ts`
- [ ] **Task 5.2:** Add rate limit check in POST handler: call `checkRevokeRateLimit(\`session:${sessionId}\`)` after auth validation
- [ ] **Task 5.3:** Return `{ error: 'rate_limited' }` with status 429 and `Retry-After` header when rate limited
- [ ] **Task 5.4:** Add `resetRevokeRateLimitStore()` call in test setup (beforeEach)

## Phase 6: Notification Dispatcher Configuration
- [ ] **Task 6.1:** Verify `lib/notifications/events.ts` reads `RATE_LIMIT_NOTIFICATION_MAX` and `RATE_LIMIT_NOTIFICATION_WINDOW_HOURS` from env
- [ ] **Task 6.2:** Confirm notification rate limiter uses Redis-backed store (separate from HTTP route in-memory stores)
- [ ] **Task 6.3:** Verify notification rate limit key format: `{eventType}:{recipientId}` (not session-scoped)

## Phase 7: Integration Tests
- [ ] **Task 7.1:** Create `tests/integration/rate-limiting.test.ts`
- [ ] **Task 7.2:** Test `checkRateLimit()` allows requests within limit (e.g., 30 requests in 60s window)
- [ ] **Task 7.3:** Test `checkRateLimit()` rejects request when limit exceeded (31st request returns false)
- [ ] **Task 7.4:** Test `checkRevokeRateLimit()` has stricter limits (5 requests allowed, 6th rejected)
- [ ] **Task 7.5:** Test window expiry — request after window duration should reset count
- [ ] **Task 7.6:** Test cleanup removes stale entries older than 2× window
- [ ] **Task 7.7:** Test env var overrides — set `RATE_LIMIT_PAYLOAD_KEY_MAX=10` and confirm 10-request limit
- [ ] **Task 7.8:** Test `resetRateLimitStore()` and `resetRevokeRateLimitStore()` clear stores between test cases

## Phase 8: Testing & Validation
- [ ] **Task 8.1:** Run full test suite (`npm run test`) — ensure no regressions
- [ ] **Task 8.2:** Run type checking (`npx tsc --noEmit`) — ensure TypeScript strict mode passes with zero errors
- [ ] **Task 8.3:** Run linting (`npx eslint . --max-warnings=0`) — ensure no lint errors
- [ ] **Task 8.4:** Manual integration test — hit payload-key issuance endpoint with rapid requests, verify 429 after limit
- [ ] **Task 8.5:** Manual integration test — hit payload-key revocation endpoint with rapid requests, verify 429 after stricter limit
