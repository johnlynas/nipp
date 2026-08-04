<!-- design.md -->
# Design: Data-in-Transit Payload Encryption

## Architecture Overview

This design adds application-layer payload encryption for selected PII-bearing API routes. It operates on top of TLS and is intended as defense-in-depth.

The revised design is based on five layers:

1. Payload Key Layer  
   The client obtains a short-lived AES-256-GCM key from an authenticated server endpoint. The BetterAuth session cookie can remain HTTP-only.

2. Encryption Layer  
   AES-256-GCM encrypts and decrypts JSON payloads. Each operation uses a fresh random 12-byte nonce.

3. Binding Layer  
   AES-GCM Additional Authenticated Data binds the ciphertext to the HTTP method, pathname, key ID, session ID, timestamp, and request nonce.

4. Interception Layer  
   Route-level wrappers decrypt incoming PII requests before business logic and encrypt successful PII responses before they are returned.

5. Operational Safety Layer  
   Feature flags, payload limits, replay-cache availability checks, cache prevention, and redacted observability protect rollout and production operation.

This is not end-to-end encryption. The server decrypts payloads during normal request processing.

## Trust Boundaries

### Protected

This design helps reduce exposure of PII payloads in:

- application logs
- proxy logs
- debug middleware
- accidental plaintext serialization
- some internal network paths
- replay or cross-route payload reuse
- certain TLS-termination scenarios where payload keys are not exposed

### Not Protected

This design does not protect against:

- malicious code executing inside the server request handler
- malicious code executing inside the browser page
- session theft
- XSS that can call application APIs
- PII in URLs, query strings, headers, or file uploads
- authorized user actions performed through the legitimate UI

## Data Flow

### Payload Key Issuance

1. Browser sends POST /api/security/payload-key with the BetterAuth session cookie.
2. Server validates the BetterAuth session.
3. Server generates or derives a 32-byte payload key.
4. Server stores or binds the key to a keyId and session.
5. Server returns keyId, algorithm, expiresAt, and base64url key material.
6. Client imports the key as a non-extractable Web Crypto AES-GCM CryptoKey.
7. Client stores the key only in memory.

### Encrypted Request Flow

1. React component calls encryptedFetch with pii: true.
2. Payload key manager gets or refreshes the payload key.
3. Client serializes JSON body.
4. Client generates a 12-byte AES-GCM nonce.
5. Client builds request AAD.
6. Client encrypts the JSON body with AES-256-GCM.
7. Client sends raw binary body with required payload encryption headers.
8. Server authenticates the session.
9. Server validates feature flag, headers, payload size, timestamp, and replay nonce.
10. Server retrieves the payload key by keyId.
11. Server decrypts the payload using request AAD.
12. Server parses and validates JSON.
13. Route handler receives plaintext JSON.

### Encrypted Response Flow

1. Route handler returns JSON-serializable data.
2. Server wrapper builds response AAD.
3. Server encrypts the response with AES-256-GCM.
4. Server returns raw binary body with Content-Type: application/octet-stream.
5. Server includes Cache-Control: no-store.
6. Client decrypts the response using the same payload key.
7. Client returns decrypted JSON to the application layer.

## Technical Decision 1: Payload Key Bootstrap

### Problem

The original design derived the encryption key in the browser from the BetterAuth session token. This fails if the session cookie is HTTP-only. Making the session cookie JavaScript-readable would increase XSS impact and is not recommended.

### Revised Decision

Use a server-issued payload key.

The client calls:

POST /api/security/payload-key

The server:

1. Validates the BetterAuth session.
2. Generates or derives a 32-byte AES-256-GCM key.
3. Associates the key with a keyId and session.
4. Returns the key over TLS with Cache-Control: no-store.

The client imports the key as non-extractable where supported.

### Rejected Alternative: JavaScript-Readable Session Cookie

Making the BetterAuth session cookie accessible to JavaScript is rejected because it exposes the full session credential to XSS.

### Optional Server-Side HKDF

If payload keys are derived instead of randomly generated, the server may use HKDF.

Corrections from the original design:

- Node.js hkdfSync returns an ArrayBuffer; wrap it with Buffer.from.
- If Web Crypto HKDF is ever used, the algorithm name is HKDF, not HKDF-SHA-256.
- The hash is specified in deriveBits as SHA-256.

## Technical Decision 2: Key Lifecycle

Payload keys must have explicit lifecycle management.

### Key Properties

Each payload key has:

- keyId
- sessionId
- expiresAt
- algorithm
- revocation status

### Client Behavior

The client payload key manager:

- fetches a key when none exists
- refreshes a key before expiry
- refreshes once when the server reports a stale or invalid key
- clears the key on logout
- does not persist the key
- does not expose raw key material to application components

### Server Behavior

The server:

- validates X-Payload-Key-Id
- rejects expired keys
- rejects keys not associated with the current session
- supports multiple active keys for multiple tabs/devices
- supports session token rotation
- revokes keys on logout

### Error Contract

Suggested error codes:

| Condition | HTTP Status | Error Code |
|---|---:|---|
| Missing or invalid session | 401 | unauthorized |
| Missing payload key header | 400 | missing_payload_key_id |
| Unknown key ID | 401 | payload_key_unknown |
| Expired key | 401 | payload_key_expired |
| Invalid encrypted payload | 400 | invalid_encrypted_payload |
| Unsupported version | 400 | unsupported_payload_version |
| Payload too large | 413 | payload_too_large |
| Wrong content type | 415 | unsupported_media_type |
| Replay cache unavailable in enforce mode | 503 | replay_cache_unavailable |

The client may retry once after refreshing the key when receiving payload_key_expired or payload_key_unknown.

## Technical Decision 3: Payload Key Store and Replay Cache Backends

The payload key store and replay cache must be explicit about deployment topology.

### In-Memory Backend

The default in-memory payload key store is acceptable only for:

- local development
- single-instance deployments
- disabled or permissive testing where accepted

It is not acceptable for production enforce mode on multi-instance deployments.

### Redis Backend

Redis is the recommended backend for:

- replay nonce deduplication
- shared payload key storage, if stateful keys are used

The replay cache should use TTL-based expiry.

### Availability Checks

The system should use a Redis health check, such as redisPing, before relying on replay protection.

When PAYLOAD_ENCRYPTION_REQUIRE_REPLAY_CACHE=true:

- enforce mode must fail closed if the replay cache is unavailable
- the server should return HTTP 503 with error code replay_cache_unavailable
- permissive mode may warn and continue
- disabled mode does not require replay protection

## Technical Decision 4: Binary Wire Format

The original design mixed hex-text and binary body handling. That would not work.

The revised protocol uses raw binary bodies.

### Encrypted Payload Layout

The payload layout is:

- 12-byte nonce
- ciphertext
- 16-byte GCM authentication tag

Web Crypto AES-GCM returns ciphertext and tag concatenated. Node.js crypto exposes the tag separately, so the server implementation must concatenate them.

### Shared Constants

- PAYLOAD_ENCRYPTION_VERSION = v1
- NONCE_BYTES = 12
- AUTH_TAG_BYTES = 16
- MIN_ENCRYPTED_BYTES = NONCE_BYTES + AUTH_TAG_BYTES

### Browser Implementation Rules

Browser code must not use Node.js Buffer.

Browser code must use:

- crypto.subtle
- crypto.getRandomValues
- TextEncoder
- TextDecoder
- Uint8Array

## Technical Decision 5: AAD and Replay Protection

AES-GCM protects confidentiality and integrity of the payload, but it does not by itself prevent replay or cross-route reuse.

### Required Request Headers

For encrypted PII requests:

- X-Payload-Encryption: v1
- X-Payload-Key-Id: key identifier
- X-Payload-Timestamp: unix timestamp
- X-Payload-Nonce: base64url random value

The request nonce is separate from the AES-GCM nonce in the payload body.

### Request AAD

Request AAD must include:

- v1
- request
- HTTP method
- pathname
- keyId
- sessionId
- timestamp
- request nonce

### Response AAD

Response AAD must include:

- v1
- response
- HTTP method
- pathname
- keyId
- sessionId
- request nonce

### Replay Validation

The server must:

1. Reject requests with missing headers.
2. Reject timestamps outside the configured window.
3. Reject request nonces already seen for the same session/key within the window.
4. Store used nonces in a short-TTL cache, for example Redis or an in-memory store.
5. Fail closed in enforce mode when replay cache is required and unavailable.

## Technical Decision 6: Route Matching

The original prefix matcher could overmatch. For example, /api/passports could incorrectly match /api/passports-public.

The revised route matcher must support:

- exact paths
- path parameters
- trailing slash normalization
- query-string stripping
- case-sensitive matching

Example route patterns:

- /api/admin/organizations
- /api/admin/organizations/:orgId
- /api/admin/organizations/:orgId/members
- /api/admin/organizations/:orgId/members/:memberId
- /api/admin/organizations/:orgId/status
- /api/admin/organizations/:orgId/settings
- /api/admin/organizations/search
- /api/admin/users/search
- /api/auth/user-permissions
- /api/admin/audit-logs
- /api/admin/system-logs

## Technical Decision 7: Server Route Wrapper

A route-level wrapper is preferred over global middleware.

The wrapper is exposed as:

wrapPiiRoute(handler, options)

The handler receives:

- request
- decryptedBody
- params

The params argument is supplied by the wrapper and must be used for dynamic route values such as orgId and memberId.

### Wrapper Responsibilities

1. Authenticate or allow handler-level authentication.
2. Check feature flag.
3. Validate payload encryption mode.
4. Validate HTTP method and content type.
5. Enforce payload size limits.
6. Read raw body once.
7. Validate payload headers.
8. Retrieve payload key.
9. Validate timestamp and replay nonce.
10. Decrypt request body using request AAD.
11. Parse JSON.
12. Call the business handler with decrypted body and params.
13. Encrypt successful responses using response AAD.
14. Return unencrypted safe error responses.

### Wrapper Options

The wrapper should support:

- skipEncryptionForUnauthenticated: useful for routes that return empty non-sensitive responses when no session exists.

### Error Precedence

The wrapper should process errors in this order:

1. Session missing or invalid → 401.
2. Feature flag disabled → route-specific fallback behavior.
3. Payload version unsupported → 400.
4. Payload key missing/unknown/expired → 401.
5. Payload too large → 413.
6. Content type invalid → 415.
7. Payload format invalid → 400.
8. Timestamp invalid → 400.
9. Replay detected → 400 or 409.
10. Replay cache unavailable in enforce mode with required cache → 503.
11. GCM authentication failure → 400.
12. JSON parse failure → 400.
13. Schema validation failure → 400 or 422.

Error responses must not contain:

- ciphertext
- plaintext request bodies
- plaintext response bodies
- session tokens
- payload keys
- stack traces

## Technical Decision 8: Client Key Manager

The client key manager is responsible for obtaining and caching the payload key.

Rules:

- store only in module-scoped memory
- refresh before expiry
- clear on logout
- do not persist
- do not expose raw key bytes to UI components
- do not write to localStorage, sessionStorage, IndexedDB, cookies, or Cache Storage

## Technical Decision 9: Encrypted Fetch Wrapper

The client wrapper must support:

- POST/PUT/PATCH with encrypted request bodies
- GET/DELETE with encrypted response bodies
- empty bodies
- 204 No Content
- unencrypted error responses
- one retry after payload-key refresh
- explicit pii: true opt-in

Rules:

- If pii is false or absent, use normal fetch.
- If pii is true, validate that the route is known PII.
- If a request body exists, it must be JSON-serializable.
- FormData, Blob, ReadableStream, URLSearchParams, and ArrayBuffer bodies are unsupported in v1.
- For encrypted request bodies, set Content-Type: application/octet-stream.
- For encrypted successful responses, return a synthetic JSON response.
- Override synthetic decrypted response Content-Type to application/json.
- Remove or recalculate misleading Content-Length headers.
- Do not decrypt non-2xx responses unless explicitly specified.
- Do not decrypt 204 No Content.
- Do not send Content-Type for bodyless requests unless required.

## Technical Decision 10: Caching

Encrypted PII responses must include:

- Cache-Control: no-store
- Pragma: no-cache

The payload key endpoint must also include:

- Cache-Control: no-store

Next.js PII routes should use:

- export const dynamic = 'force-dynamic'
- export const revalidate = 0

Additional requirements:

- CDN caching must be disabled for PII routes.
- Service workers must not cache encrypted PII responses.
- React Query/SWR persistence must not persist encrypted payloads.
- If decrypted data is persisted, it must follow existing PII storage policies.
- unstable_cache may cache database query results only if the cached data is reviewed and approved.
- Server-side plaintext caches of PII search results must be reviewed and approved.

## Technical Decision 11: Auth Guard Compatibility

Payload encryption does not replace authentication or authorization.

PII routes must continue to use approved auth guards.

Preferred pattern:

- requireSuperAdmin(request.headers)

The guard should fail closed on database and platform-organization availability errors.

Recommended mapping:

- Database unavailable → 503
- Platform organization not found → 503 or approved fail-closed equivalent
- Unauthorized → 401
- Forbidden → 403

## Technical Decision 12: Observability

Metrics should include:

- encrypted request count
- encrypted response count
- decryption success/failure
- invalid version count
- expired key count
- unknown key count
- replay detected count
- payload-too-large count
- content-type rejection count
- replay-cache-unavailable count
- plaintext PII request count in permissive mode
- latency by route

Logs may include:

- route
- method
- status
- request ID
- error code
- payload size
- user/session identifier only if allowed by logging policy

Logs must not include:

- ciphertext
- plaintext request bodies
- plaintext response bodies
- payload keys
- session tokens
- PII fields

## Runtime Considerations

### Browser

- Requires secure context: HTTPS or localhost.
- Uses Web Crypto.
- Must not use Node.js Buffer.
- Key stored only in memory.

### Next.js Server

PII route handlers should run in the Node.js runtime when using node:crypto.

If a route runs in the Edge runtime, it must use Web Crypto-compatible utilities only.

### Server Components / Server Actions

If PII is accessed through Next.js Server Actions or server components instead of HTTP APIs, this design does not automatically apply. Those paths must be audited separately.

### Server-to-Server Calls

Internal service-to-service calls that carry PII must not send plaintext merely because they are internal. They must either:

- use the same payload encryption protocol,
- use mTLS or another approved transport control,
- or be explicitly approved as an accepted risk.

## File Changes

### New Files

| File | Purpose |
|---|---|
| lib/payload-format.ts | Shared constants, binary helpers, validation. |
| lib/crypto-server.ts | Server AES-256-GCM with AAD and binary output. |
| lib/crypto-client.ts | Browser AES-256-GCM with AAD and binary output. |
| lib/payload-key-server.ts | Server payload key generation/derivation and validation. |
| lib/payload-key-manager.ts | Client payload key fetching/caching. |
| lib/api-client.ts | Encrypted fetch wrapper. |
| lib/pii-routes.ts | PII route configuration and matcher. |
| lib/payload-middleware.ts | Server route wrapper/helpers. |
| app/api/security/payload-key/route.ts | Authenticated payload key issuance endpoint. |

### Modified Files

| File | Change |
|---|---|
| PII API routes | Use payload encryption wrapper. |
| Client PII callers | Use encryptedFetch with pii: true. |
| Logger | Redact payload bodies and PII. |
| Monitoring | Add payload encryption metrics. |
| .env examples | Add payload encryption configuration. |
| SECURITY.md | Document threat model and limitations. |
| ARCHITECTURE.md | Add payload encryption architecture. |

## Relationship to Existing lib/crypto.ts

The existing at-rest encryption in lib/crypto.ts should not be assumed compatible with transit encryption.

Transit encryption should use a separate, versioned protocol. Shared low-level helpers may be extracted only after verifying format, nonce, tag, and encoding compatibility.

## Security Considerations

### Session Token Compromise

If the BetterAuth session is compromised, the attacker may be able to obtain a payload key or use the application as the user. Payload encryption does not solve session theft.

### XSS

If XSS exists, an attacker may be able to call APIs using the authenticated session and read decrypted responses through the application context.

Payload keys should be memory-only and short-lived, but this is not a complete XSS mitigation.

### CSRF

Payload encryption does not replace CSRF protection.

PII mutating routes must continue to use:

- SameSite cookies
- CORS restrictions
- CSRF tokens where applicable
- content-type restrictions
- origin checks

### Nonce Management

AES-GCM nonces must never be reused with the same key.

Use:

- crypto.getRandomValues in browsers
- randomBytes in Node.js

Do not implement custom RNG.

### Payload Size

Decrypting large payloads is expensive. Enforce size limits before decryption.

Suggested default:

PAYLOAD_ENCRYPTION_MAX_BYTES = 65536

Adjust based on product requirements.

## Testing Strategy

### Unit Tests

Cover:

- binary format validation
- server encrypt/decrypt round-trip
- client encrypt/decrypt round-trip
- AAD mismatch rejection
- wrong key rejection
- tamper rejection
- truncation rejection
- empty plaintext round-trip
- Unicode round-trip
- payload size validation
- route matcher behavior
- key manager refresh/expiry behavior
- API client fallback behavior
- wrapper param passing behavior
- skipEncryptionForUnauthenticated behavior

### Interoperability Tests

Cover:

- server encrypts, client decrypts
- client encrypts, server decrypts
- Node and Web Crypto produce compatible results
- HKDF outputs match if HKDF is used
- binary format round-trips across runtimes

### Integration Tests

Cover:

- authenticated payload key issuance
- encrypted POST request and response
- encrypted GET response
- 204 no-content handling
- plaintext rejection in enforce mode
- tampered payload rejection
- expired key handling
- stale key refresh retry
- replay rejection
- wrong route rejection
- wrong method rejection
- oversized payload rejection
- wrong content type rejection
- non-PII route bypass
- OPTIONS preflight bypass
- cache-control headers
- log redaction
- replay cache unavailable fail-closed behavior
- unauthenticated user-permissions behavior

### Browser Tests

Use Playwright or equivalent to verify real browser behavior:

- Web Crypto availability
- payload key import
- encrypted fetch round-trip
- logout clears key
- secure-context behavior

### Performance Tests

Benchmark:

- 1KB payload
- 10KB payload
- 100KB payload
- maximum allowed payload
- concurrent encrypted requests
- client-side key import overhead
- server-side decryption overhead

Define a performance budget before rollout.

## Known Limitations

- Timing tests are noisy and should be advisory, not hard CI gates.
- Browser tests cannot guarantee all user browsers; they verify representative Web Crypto behavior.
- Replay cache introduces state and needs a backend decision.
- The key endpoint returns key material over TLS and must be carefully protected and redacted in logs.
- This protocol does not protect PII placed outside encrypted bodies.
- In-memory key storage is not safe for multi-instance enforce mode.
- Memory-only replay cache is not safe for multi-instance enforce mode.