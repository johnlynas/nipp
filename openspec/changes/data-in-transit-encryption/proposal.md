<!-- proposal.md -->
# Data-in-Transit Payload Encryption

Status: Proposed — Phase 3 hardening complete  
Revision: Fix 16  
Author: Property NI Development Team  
Created: 2026-08-03  
Last Updated: 2026-08-04  
Related Issues: Security hardening initiative; defense-in-depth for PII

## Summary

This proposal adds application-layer payload encryption for selected PII-bearing API routes on top of existing TLS transport encryption.

This is defense-in-depth, not strict end-to-end encryption. The application server must decrypt payloads to process them.

The design encrypts selected JSON request and response bodies using AES-256-GCM, binds each payload to the request context, adds replay protection, and uses server-issued short-lived payload keys so the browser does not need access to HTTP-only BetterAuth session cookies.

## Current Implementation Position

This proposal is currently in Phase 3: hardening and multi-instance support.

Current state:

- Core payload encryption infrastructure is implemented.
- 11 PII routes are wrapped with `wrapPiiRoute()`.
- 10 client pages or API callers are migrated to `encryptedFetch`.
- Payload encryption remains disabled by default.
- Integration tests for encrypted request/response round-trip are implemented (15+ tests).
- Browser/Playwright tests for Web Crypto flow are implemented (8+ tests).
- Redis-backed payload key store (`RedisPayloadKeyStore`) is available for multi-instance deployments.
- Redis-backed replay cache (`RedisReplayCache`) with health checks is available for multi-instance deployments.
- Logout flow revokes server-side keys and clears client-side keys atomically.
- Logger redaction handles nested objects, arrays, and Error serialization safely.
- Production enforce mode is not approved yet.

Production enforce mode must not be enabled until:

1. The core middleware, crypto, key endpoint, and client manager code have been reviewed. ✅
2. Integration tests and browser tests pass. ✅
3. Replay protection is proven to fail closed when required. ✅
4. The deployment topology is safe for payload key storage (Redis store available). ⚠️ Must be wired in for multi-instance.
5. Existing audit-log and organization-lifecycle behavior is confirmed not to regress. ✅

## Incorporated Review Changes

This revision addresses the following review findings:

1. The original client-side key derivation design required reading the BetterAuth session token in browser JavaScript. This is blocked if the session cookie is HTTP-only and unsafe if the cookie is made JavaScript-readable.
2. The original threat model overclaimed protection and did not clearly define trust boundaries.
3. AES-GCM alone did not bind payloads to HTTP method, path, session, timestamp, or request uniqueness.
4. There was no replay protection.
5. There was no key lifecycle design for expiry, rotation, stale keys, logout, or multiple tabs.
6. The original wire format mixed hex-text and binary encoding and would not work as written.
7. The original Web Crypto HKDF example used an invalid algorithm name.
8. The original Node.js HKDF example returned an ArrayBuffer where a Buffer was expected.
9. Browser code used Node.js Buffer, which is not available in browsers.
10. Operational requirements were missing: payload limits, caching controls, observability, feature flags, rollback, migration, and PII-in-URL/header restrictions.
11. The original logging requirement incorrectly allowed decrypted PII to be logged.
12. Dynamic route handlers previously relied on fragile manual URL parsing. The revised design requires `wrapPiiRoute()` to supply route params to handlers.
13. Several PII routes were missing from the wrapped route list. The current list includes organization search, organization status, and organization settings routes.
14. Caching was not consistently disabled on PII routes. PII routes must use no-store behavior and dynamic route settings.
15. The replay cache backend and fail-closed behavior are now explicit configuration requirements.
16. The unauthenticated `/api/auth/user-permissions` edge case is handled through a wrapper option that can skip encryption for empty non-sensitive responses.
17. Multi-instance deployment limitations are now explicit: in-memory payload key storage and memory-only replay cache are not safe for multi-instance enforce mode.
18. Redis-backed payload key store (`RedisPayloadKeyStore`) is implemented for multi-instance deployments.
19. Redis-backed replay cache (`RedisReplayCache`) with health checks is implemented for multi-instance deployments.
20. Logout flow now revokes server-side keys and clears client-side keys atomically.
21. Logger redaction now handles nested objects, arrays, and Error serialization safely.

## Motivation

### Current State

The application already encrypts sensitive PII at rest and uses TLS/HTTPS for transport security. However, selected PII-bearing API request and response bodies are currently plaintext JSON inside the TLS channel.

If logs, proxies, debug middleware, tracing tools, or internal request pipelines capture request/response bodies, sensitive PII may be exposed in plaintext.

### Problems This Proposal Addresses

This proposal adds a second application-layer protection for selected PII routes:

- PII request bodies are encrypted before leaving the browser.
- PII response bodies are encrypted before leaving the server.
- Payloads are bound to the request context to reduce replay and cross-route misuse.
- Decryption failures are handled with safe, generic errors.
- Payload encryption operations are observable without logging PII.

### Limits of This Proposal

This proposal does not replace TLS, authentication, authorization, CSRF protection, secure session management, secure logging, or secure browser execution.

Regulatory alignment may be supported by this control, but implementation of this proposal does not by itself guarantee GDPR, PCI-DSS, HIPAA, or other compliance.

## Scope

### In Scope

- Encryption of selected PII-bearing JSON API request bodies.
- Encryption of selected PII-bearing JSON API response bodies.
- AES-256-GCM authenticated encryption.
- Versioned binary payload format.
- Server-issued payload key bootstrap compatible with HTTP-only session cookies.
- Client-side payload key manager.
- Request-context binding using AES-GCM Additional Authenticated Data.
- Freshness and replay protection for encrypted PII requests.
- Route-level enforcement for configured PII routes.
- Route param passing through the payload encryption wrapper.
- Error handling for invalid, expired, missing, or tampered payloads.
- Payload size limits and DoS protections.
- Cache-prevention headers and Next.js dynamic route settings for encrypted PII routes.
- Observability without logging ciphertext or plaintext PII.
- Feature-flagged rollout and rollback plan.
- Unit, integration, security, browser, and performance testing.

### Out of Scope

- End-to-end encryption with client-held long-term keys.
- Full key-exchange protocols such as ECDH, unless introduced later.
- Encryption of non-PII API routes.
- Encryption of file uploads, multipart bodies, or streamed binary payloads.
- Database-level or column-level encryption changes.
- TLS configuration changes.
- Protection of PII placed in URLs, query parameters, or HTTP headers.
- Native mobile or third-party API consumers unless they implement the same protocol.

## High-Level Design

### Payload Key Bootstrap

The client obtains a short-lived payload encryption key from an authenticated server endpoint:

POST /api/security/payload-key

The server validates the BetterAuth session and returns:

- keyId
- algorithm
- expiresAt
- base64url-encoded key material

The client imports this key using Web Crypto as a non-extractable AES-GCM CryptoKey and stores it only in memory.

This preserves HTTP-only session cookies and gives the server control over key expiry and rotation.

### Encryption Format

Encrypted payloads use a versioned binary format:

- 12-byte nonce
- ciphertext
- 16-byte AES-GCM authentication tag

The HTTP body is raw binary.

The request includes:

- Content-Type: application/octet-stream
- X-Payload-Encryption: v1
- X-Payload-Key-Id: key identifier
- X-Payload-Timestamp: unix timestamp
- X-Payload-Nonce: base64url random value

Hex encoding may be used in tests or debugging utilities, but the HTTP wire format is binary.

### Request Binding and Replay Protection

AES-GCM Additional Authenticated Data binds each encrypted request to:

- payload protocol version
- purpose: request or response
- HTTP method
- URL pathname
- payload key ID
- session identifier
- timestamp
- request nonce

The server rejects:

- missing or unsupported payload versions
- expired timestamps
- replayed request nonces
- payloads sent to a different route
- payloads sent with a different HTTP method
- payloads associated with an invalid or expired key
- requests that fail payload format validation

### Replay Cache and Fail-Closed Behavior

Replay nonce deduplication requires a cache backend.

Supported configuration:

- PAYLOAD_ENCRYPTION_REPLAY_CACHE=memory
- PAYLOAD_ENCRYPTION_REPLAY_CACHE=redis

The memory backend is single-instance only. Redis is required for multi-instance deployments.

When PAYLOAD_ENCRYPTION_REQUIRE_REPLAY_CACHE=true and the replay cache is unavailable, enforce mode must fail closed with HTTP 503 and error code replay_cache_unavailable.

### Route Wrapper and Params

PII routes are wrapped with:

wrapPiiRoute(handler, options)

The wrapper supplies:

- request
- decryptedBody
- route params

Handlers must not manually parse dynamic route segments unless explicitly approved.

The wrapper supports options such as:

- skipEncryptionForUnauthenticated: allows unauthenticated non-sensitive empty responses to bypass response encryption safely.

### Feature Flag and Rollout

Payload encryption is controlled by configuration.

Environment variables:

- PAYLOAD_ENCRYPTION_MODE
- PAYLOAD_ENCRYPTION_MAX_BYTES
- PAYLOAD_ENCRYPTION_KEY_TTL_SECONDS
- PAYLOAD_ENCRYPTION_REPLAY_WINDOW_SECONDS
- PAYLOAD_ENCRYPTION_NONCE_TTL_SECONDS
- PAYLOAD_ENCRYPTION_REPLAY_CACHE
- PAYLOAD_ENCRYPTION_REQUIRE_REPLAY_CACHE

Modes:

- disabled: no payload encryption is required or applied
- permissive: server accepts encrypted payloads and may emit metrics for plaintext PII requests; migration-only
- enforce: server requires encrypted payloads for configured PII routes

## Wrapped Routes

The following routes are currently in the Phase 2 wrapped route list:

1. /api/admin/users/search — GET
2. /api/admin/organizations/:orgId/members — GET, POST
3. /api/admin/organizations/:orgId/members/:memberId — PATCH, DELETE
4. /api/admin/organizations — GET, POST
5. /api/admin/organizations/:orgId — GET, PATCH, DELETE
6. /api/auth/user-permissions — GET
7. /api/admin/audit-logs — GET
8. /api/admin/system-logs — GET
9. /api/admin/organizations/search — GET
10. /api/admin/organizations/:orgId/status — PATCH
11. /api/admin/organizations/:orgId/settings — PATCH

## Client Pages Migrated

The following client pages or API callers are currently migrated:

1. app/admin/organizations/page.tsx
2. app/admin/organizations/create/page.tsx
3. app/admin/organizations/[orgId]/page.tsx
4. app/admin/organizations/[orgId]/members/page.tsx
5. app/admin/organizations/[orgId]/settings/page.tsx
6. features/organization/api/useOrganization.ts
7. features/organization/api/useUpdateOrgSettings.ts
8. features/permissions/api/usePermissions.ts
9. app/admin/audit-logs/page.tsx
10. app/admin/system-logs/page.tsx

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---:|---|
| Breaking existing API consumers | High | Feature flag, staging rollout, API documentation, deprecation window. |
| XSS can still interact with APIs as the user | High | This proposal does not solve XSS. Maintain CSP, session protections, and XSS defenses. Payload key is memory-only and short-lived. |
| Payload key exposed in browser memory | Medium | Key is non-extractable where possible, memory-only, short-lived, and rotated. It is not stored in cookies, localStorage, sessionStorage, or IndexedDB. |
| Key endpoint becomes sensitive | Medium | Endpoint requires authenticated session, returns no-store headers, is rate-limited, and response bodies are not logged. |
| Replay attacks | Medium | Timestamp, request nonce, AAD binding, and server-side replay cache. |
| Replay cache unavailable | High | In enforce mode with PAYLOAD_ENCRYPTION_REQUIRE_REPLAY_CACHE=true, return 503 replay_cache_unavailable. |
| Cross-route payload reuse | Medium | AAD includes method and pathname. |
| Performance overhead | Medium | Benchmarking, payload limits, key caching, hardware-accelerated AES-GCM. |
| Large-payload DoS | Medium | Enforce size limits before decryption and rate-limit PII routes. |
| Caching of encrypted PII | Medium | Cache-Control: no-store, dynamic route settings, CDN and service-worker guidance. |
| Observability leakage | High | Metrics only; no ciphertext, plaintext, keys, session tokens, or PII in logs/traces. |
| WAF cannot inspect encrypted payloads | Medium | Document monitoring strategy and exemptions where required. |
| Edge runtime incompatibility | Medium | PII decryption routes must run in Node.js runtime unless reimplemented with Web Crypto. |
| Incorrect route configuration | High | Shared route matcher, integration tests, audit task, explicit client pii flag. |
| Session token rotation invalidates keys | Medium | Key IDs, expiry, client refresh, and one retry on stale key errors. |
| PII remains in query strings or headers | High | Explicit requirement that sensitive PII must not be placed in URLs, query strings, or headers. Search endpoints must be reviewed. |
| Multi-instance deployments using in-memory key store | High | Redis-backed `RedisPayloadKeyStore` is available. Enforce mode must not be enabled until it is wired in for multi-instance deployments. |
| Audit log route behavior regresses during migration | High | Existing audit-log response contract and data source must be preserved or explicitly reworked. ✅ Fixed in Phase 2. |
| Organization deletion behavior changes accidentally | High | Organization lifecycle state machine and audit logging must be preserved unless explicitly approved. ✅ Fixed in Phase 2. |

## Implementation Timeline

| Phase | Description | Estimated Effort |
|---|---|---:|
| Phase 0 | Threat model, key bootstrap decision, replay strategy, rollout policy | 1-2 days |
| Phase 1 | Shared format, crypto utilities, route matcher | 2-3 days |
| Phase 2 | Server key endpoint, route wrapper, replay protection, observability | 3-4 days |
| Phase 3 | Client key manager, encrypted fetch, React Query/SWR integration | 2-4 days |
| Phase 4 | Unit, integration, security, browser, and performance tests | 3-5 days |
| Phase 5 | Security review and hardening | 2-3 days |
| Phase 6 | Documentation, staging, monitoring, production rollout | 2-3 days |

Total estimated effort: 15-24 developer-days.

The original 9-14 day estimate was too low once key bootstrap, replay protection, rollout, and browser testing are included.

## Open Questions Requiring Sign-Off

1. Confirm BetterAuth session cookie flags and session token accessibility.
2. Confirm whether payload keys should be stateful in Redis/DB or statelessly derived server-side.
3. Confirm replay-cache backend and retention window.
4. Confirm maximum encrypted payload size.
5. Confirm whether external API consumers require a migration period.
6. Confirm whether mobile or service-to-service clients must support this protocol.
7. Confirm accepted risk if full replay protection cannot be implemented in the first iteration.
8. Confirm whether organization deletion should remain archive-based or become hard delete.
9. Confirm whether search endpoints should move PII search terms from query strings into encrypted POST bodies.
10. Confirm whether plaintext server-side caching of admin search results is acceptable.

## Phase 3 Completion Summary

The following Priority 3 items have been implemented:

1. ✅ **Redis/shared key store for multi-instance** — `RedisPayloadKeyStore` implements the `PayloadKeyStore` interface with TTL-based expiry, session tracking, and eviction.
2. ✅ **Redis/shared replay cache for multi-instance** — `RedisReplayCache` with health checks and graceful degradation. Memory fallback for single-instance deployments.
3. ✅ **Integration tests for encrypted request/response cycle** — 15+ tests covering server↔client interoperability, AAD mismatch detection, tamper detection, key mismatch, Unicode handling, and base64url transport.
4. ✅ **Browser/Playwright tests for Web Crypto flow** — 8+ tests verifying Web Crypto availability, secure context, key generation, encrypt/decrypt round-trip, Unicode handling, AAD mismatch rejection, key import, and tamper detection.
5. ✅ **Verify all PII routes wrapped and client calls match** — Route matcher (`pii-routes.ts`) covers all 11 PII routes. Client pages use `encryptedFetch` with explicit PII flags.
6. ✅ **Logger redaction with nested payloads and errors** — `redactLogObject()` utility handles nested objects, arrays, and Error serialization. PII fields are redacted at any depth.
7. ✅ **User-permissions unauthenticated behavior** — `skipEncryptionForUnauthenticated` option allows unauthenticated requests to return plaintext empty arrays. Tests verify this behavior.
8. ✅ **OPTIONS, 204, empty body, error response behavior** — Comprehensive tests verify OPTIONS passthrough, 204 no encryption, empty body handling, error response passthrough, and non-JSON response passthrough.
9. ✅ **Logout clears client keys and revokes server keys** — `signOutUser()` calls `/api/security/payload-key/revoke`, then clears client key via `clearPayloadKey()`. Tests verify the flow.
10. ✅ **OpenSpec documentation updates** — Proposal.md updated with Phase 3 status, completed items, and risks/mitigations table refreshed.
