# Data-in-Transit Payload Encryption

Status: Proposed — Requires Security Review  
Author: Property NI Development Team  
Created: 2026-08-03  
Last Updated: 2026-08-03  
Related Issues: Security hardening initiative; defense-in-depth for PII

## Summary

This proposal adds application-layer payload encryption for selected PII-bearing API routes on top of existing TLS transport encryption.

This is defense-in-depth, not strict end-to-end encryption. The application server must decrypt payloads to process them.

The revised design encrypts selected JSON request and response bodies using AES-256-GCM, binds each payload to the request context, adds replay protection, and uses server-issued short-lived payload keys so the browser does not need access to HTTP-only BetterAuth session cookies.

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
- Error handling for invalid, expired, missing, or tampered payloads.
- Payload size limits and DoS protections.
- Cache-prevention headers for encrypted PII responses.
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

The revised design avoids requiring browser JavaScript to read the BetterAuth session cookie.

The client obtains a short-lived payload encryption key from an authenticated server endpoint:

POST /api/security/payload-key

The server validates the BetterAuth session and returns:

- keyId
- algorithm
- expiresAt
- key material, encoded as base64url

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

### Feature Flag and Rollout

Payload encryption is controlled by configuration.

Environment variables:

- PAYLOAD_ENCRYPTION_MODE
- PAYLOAD_ENCRYPTION_MAX_BYTES
- PAYLOAD_ENCRYPTION_KEY_TTL_SECONDS
- PAYLOAD_ENCRYPTION_REPLAY_WINDOW_SECONDS
- PAYLOAD_ENCRYPTION_NONCE_TTL_SECONDS

Modes:

- disabled: no payload encryption is required or applied
- permissive: server accepts encrypted payloads and may emit metrics for plaintext PII requests; migration-only
- enforce: server requires encrypted payloads for configured PII routes

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---:|---|
| Breaking existing API consumers | High | Feature flag, staging rollout, API documentation, deprecation window. |
| XSS can still interact with APIs as the user | High | This proposal does not solve XSS. Maintain CSP, session protections, and XSS defenses. Payload key is memory-only and short-lived. |
| Payload key exposed in browser memory | Medium | Key is non-extractable where possible, memory-only, short-lived, and rotated. It is not stored in cookies, localStorage, sessionStorage, or IndexedDB. |
| Key endpoint becomes sensitive | Medium | Endpoint requires authenticated session, returns no-store headers, is rate-limited, and response bodies are not logged. |
| Replay attacks | Medium | Timestamp, request nonce, AAD binding, and server-side replay cache. |
| Cross-route payload reuse | Medium | AAD includes method and pathname. |
| Performance overhead | Medium | Benchmarking, payload limits, key caching, hardware-accelerated AES-GCM. |
| Large-payload DoS | Medium | Enforce size limits before decryption and rate-limit PII routes. |
| Caching of encrypted PII | Medium | Cache-Control: no-store on encrypted responses; CDN and service-worker guidance. |
| Observability leakage | High | Metrics only; no ciphertext, plaintext, keys, session tokens, or PII in logs/traces. |
| WAF cannot inspect encrypted payloads | Medium | Document monitoring strategy and exemptions where required. |
| Edge runtime incompatibility | Medium | PII decryption routes must run in Node.js runtime unless reimplemented with Web Crypto. |
| Incorrect route configuration | High | Shared route matcher, integration tests, audit task, explicit client pii flag. |
| Session token rotation invalidates keys | Medium | Key IDs, expiry, client refresh, and one retry on stale key errors. |
| PII remains in query strings or headers | High | Explicit requirement that sensitive PII must not be placed in URLs, query strings, or headers. Audit task required. |

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