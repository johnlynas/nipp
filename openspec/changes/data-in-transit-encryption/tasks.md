# Tasks: Data-in-Transit Payload Encryption

## Phase 1: Foundation — Key Derivation & Crypto Utilities
- [ ] **Task 1.1:** Create `lib/payload-key.ts` with server-side HKDF key derivation function (`derivePayloadKey`).
  - Uses `node:crypto.hkdfSync` with SHA-256.
  - Salt: `"nipp-payload-encryption"`, info prefix: `"session:"`.
  - Returns a 32-byte `Buffer` suitable for AES-256-GCM.
  - Add unit tests in `tests/unit/payload-key.test.ts`.

- [ ] **Task 1.2:** Create `lib/crypto-client.ts` with client-side AES-256-GCM encrypt/decrypt using Web Crypto API.
  - `encryptPayload(plaintext: string, key: CryptoKey): Promise<string>` — returns hex-encoded nonce + ciphertext + auth tag.
  - `decryptPayload(ciphertext: string, key: CryptoKey): Promise<string>` — parses hex format and decrypts.
  - Helper functions: `arrayBufferToHex`, `hexToArrayBuffer`.
  - Add unit tests in `tests/unit/crypto-client.test.ts`.

- [ ] **Task 1.3:** Create `lib/crypto-server.ts` with server-side AES-256-GCM encrypt/decrypt using Node.js `node:crypto`.
  - Reuses the same hex-encoded format as `lib/crypto.ts` (nonce + ciphertext + auth tag).
  - `encryptPayload(plaintext: string, key: Buffer): Promise<string>`.
  - `decryptPayload(ciphertext: string, key: Buffer): Promise<string>`.
  - Add unit tests in `tests/unit/crypto-server.test.ts`.

- [ ] **Task 1.4:** Create `lib/pii-routes.ts` with the list of routes that handle sensitive PII.
  - Export `PII_ROUTES` array and `isPIIRoute(pathname)` helper function.
  - Start with `/api/passports` and `/api/personal-details` as placeholders; update based on actual route structure.

## Phase 2: Server-Side — Decryption Middleware & Route Integration
- [ ] **Task 2.1:** Create `lib/payload-middleware.ts` with server-side decrypt/encrypt utilities.
  - `decryptPIIPayload(req: Request, sessionToken: string): Promise<Record<string, unknown>>` — reads encrypted body, derives key, decrypts, parses JSON.
  - `encryptPIIResponse(data: Record<string, unknown>, sessionToken: string): Promise<Uint8Array>` — serializes JSON, derives key, encrypts.
  - `extractSessionId(req: Request): string` — helper to extract session ID from BetterAuth cookie or request headers.
  - Handle errors: malformed ciphertext, auth tag mismatch, decryption failure → return `400 Bad Request`.

- [ ] **Task 2.2:** Identify all API routes that handle sensitive PII (passport numbers, personal details).
  - Search `app/api/` for routes that read/write passport or PII fields.
  - Document the list and confirm with `lib/pii-routes.ts`.

- [ ] **Task 2.3:** Update each PII route handler to use payload decryption for incoming requests.
  - Replace `req.json()` with `decryptPIIPayload(req, sessionToken)`.
  - Set `Content-Type: application/octet-stream` on the response.

- [ ] **Task 2.4:** Update each PII route handler to use payload encryption for outgoing responses.
  - Wrap response data with `encryptPIIResponse(data, sessionToken)`.
  - Ensure error responses (validation errors, not found) are NOT encrypted — only successful PII payloads.

## Phase 3: Client-Side — Fetch Wrapper & Component Integration
- [ ] **Task 3.1:** Create `lib/api-client.ts` with the encrypted fetch wrapper.
  - `encryptedFetch(url, options)` — transparent encryption for PII routes.
  - Derives session key from BetterAuth cookie (session token + session ID).
  - Encrypts request body when `options.pii = true`.
  - Decrypts response body for PII routes.
  - Falls back to standard `fetch` for non-PII requests.

- [ ] **Task 3.2:** Create a utility to extract the BetterAuth session token from cookies on the client side.
  - `getSessionToken(): string | null` — reads `better-auth.session_token` cookie.
  - Note: HTTP-only cookies are not accessible from JavaScript. Alternative: use a non-HTTP-only cookie or derive key from an available token.
  - **Decision point:** If BetterAuth session cookies are HTTP-only, consider deriving the key from a JWT or token stored in `localStorage` (if BetterAuth provides one), or use a dual-cookie approach.

- [ ] **Task 3.3:** Update all client-side API calls that touch PII data to use `encryptedFetch`.
  - Search for `fetch()` or SWR/React Query calls that hit PII routes.
  - Replace with `encryptedFetch(url, { ...options, pii: true })`.

- [ ] **Task 3.4:** Update any SWR/React Query configurations to handle encrypted responses.
  - Ensure data transformers decrypt responses before passing to components.
  - Verify that query key invalidation still works with encrypted payloads.

## Phase 4: Testing

### Layer 1: Unit Tests — Crypto Correctness (No Server Required)
- [ ] **Task 4.1:** Write `tests/unit/payload-key.test.ts` — HKDF key derivation consistency & uniqueness.
  - Same inputs → same key (deterministic, at least 5 assertions)
  - Different session IDs → different keys
  - Different session tokens → different keys
  - Output is always exactly 32 bytes (AES-256)
  - Edge cases: empty token, special characters, unicode emoji
  - No zero-filled keys produced
- [ ] **Task 4.2:** Write `tests/unit/crypto-client.test.ts` — Web Crypto API encrypt/decrypt round-trip.
  - Simple string round-trip ("Hello, World!")
  - JSON object round-trip with PII fields
  - Nonce randomization: same plaintext → different ciphertext (at least 3 encryptions compared)
  - Tamper detection: flipping one byte in ciphertext → decryption throws
  - Truncation detection: removing auth tag (last 32 hex chars) → decryption throws
  - Wrong key rejection: ciphertext encrypted with one key cannot be decrypted with another
  - Empty string round-trip
  - Large payload (1MB) round-trip
  - Output format validation: hex-encoded, nonce = 24 chars, auth tag = 32 chars
  - Statistical nonce uniqueness: 100 sequential encryptions → 100 unique nonces
- [ ] **Task 4.3:** Write `tests/unit/crypto-server.test.ts` — Node.js crypto encrypt/decrypt round-trip.
  - Same test matrix as client-side (round-trip, tamper, truncation, wrong key, empty string, large payload)
  - Format compatibility: server output matches client input format (same hex encoding)
  - Unicode handling: emoji, CJK characters round-trip correctly
  - Statistical nonce uniqueness: 100 sequential encryptions → 100 unique nonces
- [ ] **Task 4.4:** Write `tests/unit/api-client.test.ts` — encrypted fetch wrapper behavior.
  - Encrypts request body when `pii: true`, sends as `application/octet-stream`
  - Decrypts response body for PII routes
  - Falls back to standard `fetch` when `pii: false` or not set
  - Preserves response status codes (4xx/5xx)

### Layer 2: Integration Tests — End-to-End Flow (Requires Test Server)
- [ ] **Task 4.5:** Write `tests/integration/pii-payload-encryption.test.ts` — full E2E encrypted cycle.
  - Spin up test server via `spawn('next', ['dev', '-p', '0'])` on random port
  - Client derives key from session token, encrypts JSON body with AES-GCM, sends as `application/octet-stream`
  - Server derives same key from session cookie, decrypts, passes plaintext to route handler
  - Server encrypts JSON response with AES-GCM; client derives same key, decrypts, parses JSON
  - Plaintext rejection: sending `application/json` to PII route → `400 Bad Request`
  - Tamper rejection: flipping bits in encrypted body → GCM auth tag fails → `400 Bad Request`
  - Non-PII bypass: `/api/health` returns standard JSON with `Content-Type: application/json`
  - Large payload (100KB) processes within timeout (10s limit)
- [ ] **Task 4.6:** Write `tests/integration/non-pii-routes.test.ts` — non-PII route isolation.
  - Standard `fetch()` calls work without encryption
  - Response is standard JSON, not encrypted bytes
  - No performance regression on non-PII endpoints
  - Middleware does not intercept non-matching routes

### Layer 3: Security Tests — Attack Surface Verification
- [ ] **Task 4.7:** Write `tests/security/payload-encryption-security.test.ts` — attack resistance.
  - Missing auth tag (last 32 hex chars removed) → decryption fails
  - Missing nonce (first 24 hex chars removed) → decryption fails
  - Empty ciphertext `""` → rejected gracefully
  - Non-hex input (`"not-valid-hex!!!"`) → rejected
  - Statistical nonce uniqueness: 10,000 encryptions → 10,000 unique nonces
  - Ciphertext indistinguishability: short vs long plaintext produce proportional ciphertext length only
  - Single-bit flip in ciphertext → full decryption failure (GCM integrity)
  - Deterministic key derivation: same inputs produce same keys across multiple imports
  - Timing resistance: valid vs invalid ciphertext decryption times within 10x of each other

### CI Pipeline Integration
- [ ] **Task 4.8:** Add payload encryption tests to `.github/workflows/ci.yml`.
  - Unit tests run on every PR (fast, no server): `payload-key`, `crypto-client`, `crypto-server`
  - Fetch wrapper unit test runs on every PR: `api-client`
  - Integration tests run on every PR with extended timeout (30s): `pii-payload-encryption`, `non-pii-routes`
  - Security tests run on every PR: `payload-encryption-security`
  - All four layers must pass before merge is allowed

## Phase 5: Security Review & Hardening
- [ ] **Task 5.1:** Audit all PII routes to ensure none are missed — every route handling passport/PII data must use payload encryption.
- [ ] **Task 5.2:** Verify that error responses from PII routes are NOT encrypted (validation errors, auth failures should be readable for debugging).
- [ ] **Task 5.3:** Verify that encrypted payloads are never logged — check `lib/logger.ts` for any accidental serialization of request/response bodies.
- [ ] **Task 5.4:** Verify that session key derivation fails gracefully if the session token is missing or malformed — should return `401 Unauthorized`, not crash.
- [ ] **Task 5.5:** Review the HKDF parameters (salt, info) for uniqueness and non-predictability across sessions.

## Phase 6: Documentation & Rollout
- [ ] **Task 6.1:** Update `SECURITY.md` to document the payload encryption layer.
- [ ] **Task 6.2:** Update `ARCHITECTURE.md` to include the new encryption layer in the security architecture diagram.
- [ ] **Task 6.3:** Update `.env.local-prod.example` with any new environment variables (e.g., `PAYLOAD_ENCRYPTION_SALT`).
- [ ] **Task 6.4:** Deploy to staging environment with payload encryption enabled for PII routes only.
- [ ] **Task 6.5:** Monitor error rates, latency impact, and decryption failures for 1 week.
- [ ] **Task 6.6:** Deploy to production with payload encryption enabled for all PII routes.
