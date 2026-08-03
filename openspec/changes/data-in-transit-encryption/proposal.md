# Data-in-Transit Payload Encryption

**Status:** Proposed  
**Author:** Property NI Development Team  
**Created:** 2026-08-03  
**Last Updated:** 2026-08-03  
**Related Issues:** Security hardening initiative; defense-in-depth for PII

---

## Summary

This proposal adds application-layer payload encryption on top of the existing TLS transport layer. While HTTPS encrypts data in transit at the network level, this change ensures that request and response bodies are encrypted end-to-end so that even if TLS is compromised, the server cannot read sensitive payloads in transit. The encryption uses AES-256-GCM — the same algorithm already used for PII at rest in `lib/crypto.ts` — with a per-session key derived from the BetterAuth session token.

## Motivation

### Current State
The application already encrypts data at rest (AES-256-GCM for PII, Argon2id for passwords) and encrypts data in transit via TLS/HTTPS. However, the server receives and processes plaintext JSON payloads over HTTPS — meaning a compromised server, misconfigured TLS, or a man-in-the-middle at the edge would expose raw PII in transit.

### Problems This Solves
1. **Defense-in-depth for PII:** Adds a second encryption layer so that sensitive payloads (passport numbers, personal details) are encrypted at the application level regardless of TLS state.
2. **Server-side compromise mitigation:** If an attacker gains server access, they cannot intercept or replay plaintext payloads from active sessions.
3. **Insider threat protection:** Server operators with database access cannot read raw PII from network logs, proxy logs, or application debug output.
4. **Regulatory alignment:** Many data protection frameworks (GDPR, PCI-DSS) recommend or require encryption of sensitive data beyond transport layer alone.

## Scope

### In Scope
- Per-session payload encryption for API request bodies containing sensitive PII (passport numbers, personal details).
- Per-session payload encryption for API response bodies containing sensitive PII.
- Key derivation from BetterAuth session tokens via HKDF.
- Client-side fetch wrapper for encrypted API calls (Web Crypto API).
- Server-side decryption middleware/interceptor for affected routes.
- Extension of `lib/crypto.ts` to support Web Crypto API (client-side) and Node.js `node:crypto` (server-side).

### Out of Scope
- Encrypting all API payloads — only routes handling sensitive PII are encrypted.
- End-to-end encryption with client-held keys (no key exchange protocol).
- Database-level or column-level encryption changes.
- TLS configuration changes (existing HTTPS setup is retained).

## Detailed Design

### Key Derivation Strategy
After successful authentication via BetterAuth, a per-session AES-256-GCM key is derived from the session token using HKDF-SHA-256:

```
derivedKey = HKDF-SHA-256(
  inputKey = sessionToken,
  salt     = "nipp-payload-encryption",
  info     = `session:${sessionId}`,
  length   = 32 bytes (AES-256 key)
)
```

The same derivation runs on both client and server, producing identical keys without transmitting any key material. The session token is already exchanged over TLS during login, so this does not introduce a new key exchange surface.

### Encryption Format
Each encrypted payload follows the same format as the existing `lib/crypto.ts` at-rest encryption:

```
<nonce (12 bytes hex)><ciphertext (hex)><authTag (16 bytes hex)>
```

- Algorithm: AES-256-GCM
- Nonce: 12 bytes, randomly generated per encryption operation
- Output: hex-encoded string

### Request Flow
1. Client derives session key from BetterAuth session token via HKDF.
2. Client serializes request body to JSON, then encrypts with AES-256-GCM using the session key.
3. Client sends encrypted payload as `application/octet-stream` (not JSON).
4. Server middleware intercepts the request, derives the same session key from the BetterAuth session token.
5. Server decrypts the payload, parses JSON, and passes it to the route handler as if it were plaintext.
6. Route handler processes normally — no changes to business logic.

### Response Flow
1. Route handler produces a normal JSON response object.
2. Server middleware encrypts the JSON with AES-256-GCM using the session key.
3. Server returns encrypted payload as `application/octet-stream`.
4. Client middleware intercepts the response, derives the session key, decrypts, and parses JSON for the application.

### Affected Routes
Only routes that handle sensitive PII (passport numbers, personal identification data) will use payload encryption. This is determined by a route-level annotation or configuration, not every API endpoint.

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Breaking existing API consumers | High | Only apply to PII-specific routes; document the change for any external integrations. |
| Performance overhead of encrypt/decrypt per request | Medium | AES-GCM is hardware-accelerated; negligible for typical payload sizes. Benchmark before rollout. |
| Session key mismatch between client and server | High | Derive from the same session token using deterministic HKDF; add integrity checks via GCM auth tag. |
| Edge runtime incompatibility (middleware) | Medium | Use Web Crypto API for key derivation in middleware; Node.js `node:crypto` only in route handlers. |
| Debugging difficulty (encrypted payloads) | Medium | Log encrypted payload size and metadata only; never log ciphertext. Use structured logging with redaction. |
| Cache invalidation (encrypted responses) | Medium | Encrypted responses are per-session; disable CDN caching for encrypted endpoints. |

## Implementation Timeline

| Phase | Description | Estimated Effort |
|---|---|---|
| 1 | Foundation: extend `lib/crypto.ts`, create key derivation utility, build fetch wrapper | 2-3 days |
| 2 | Server-side: create decryption middleware, apply to PII routes | 2-3 days |
| 3 | Client-side: integrate encrypted fetch, update affected components | 2-3 days |
| 4 | Testing: unit tests, integration tests, security review | 2-3 days |
| 5 | Rollout: staging deployment, monitoring, production release | 1-2 days |

**Total estimated effort:** 9-14 developer-days.
