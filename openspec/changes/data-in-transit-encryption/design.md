# Design: Data-in-Transit Payload Encryption

## Architecture Overview

This design adds application-layer payload encryption on top of the existing TLS transport layer. The core idea is to derive a per-session AES-256-GCM key from the BetterAuth session token using HKDF-SHA-256, then use that key to encrypt request bodies and response bodies for routes handling sensitive PII.

The architecture has three layers:
1. **Key Derivation Layer** — deterministic session key derivation on both client and server.
2. **Encryption Layer** — AES-256-GCM encrypt/decrypt operations (client-side via Web Crypto API, server-side via Node.js `node:crypto`).
3. **Interception Layer** — middleware that intercepts requests/responses for affected routes, performing decryption before route handlers and encryption after.

## Data Flow

### Request Encryption (Client → Server)
```
┌──────────────┐     ┌───────────────┐     ┌──────────────┐
│  React App   │────▶│ Encrypted     │────▶│ TLS (HTTPS)  │
│              │ JSON│ Fetch Wrapper │     │              │
└──────────────┘     └───────────────┘     └──────────────┘
                              │                    │
                         Encrypt AES-256-GCM    Encrypted bytes
                              │                    │
                              ▼                    ▼
┌──────────────┐     ┌───────────────┐     ┌──────────────┐
│  Route       │◀────│ Decryption    │◀────│ TLS (HTTPS)  │
│  Handler     │ JSON│ Middleware    │     │              │
└──────────────┘     └───────────────┘     └──────────────┘
                              ▲                    ▲
                         Decrypt AES-256-GCM    Encrypted bytes
                              │                    │
┌──────────────┐     ┌───────────────┐     ┌──────────────┐
│  BetterAuth  │────▶│ Key           │     │  Browser     │
│  Session     │     │ Derivation    │     │              │
└──────────────┘     └───────────────┘     └──────────────┘
```

### Response Encryption (Server → Client)
```
┌──────────────┐     ┌───────────────┐     ┌──────────────┐
│  Route       │────▶│ Encryption    │────▶│ TLS (HTTPS)  │
│  Handler     │ JSON│ Middleware    │     │              │
└──────────────┘     └───────────────┘     └──────────────┘
                              │                    │
                         Encrypt AES-256-GCM    Encrypted bytes
                              │                    │
                              ▼                    ▼
┌──────────────┐     ┌───────────────┐     ┌──────────────┐
│  React App   │◀────│ Decrypted     │◀────│ TLS (HTTPS)  │
│              │ JSON│ Fetch Wrapper │     │              │
└──────────────┘     └───────────────┘     └──────────────┘
```

## Technical Decisions

### 1. Key Derivation: HKDF from Session Token
Instead of implementing a full ECDH key exchange, we derive the payload encryption key deterministically from the existing BetterAuth session token. This avoids:
- Additional round-trips during login
- New key storage or rotation logic
- Key exchange attack surface

```typescript
// lib/payload-key.ts (new)
import { hkdfSync } from 'node:crypto';

export function derivePayloadKey(sessionToken: string, sessionId: string): Buffer {
  const salt = 'nipp-payload-encryption';
  const info = `session:${sessionId}`;
  
  return hkdfSync(
    'sha256',
    sessionToken,       // input key material (IKM)
    Buffer.from(salt),  // salt
    Buffer.from(info),  // info (context)
    32                  // desired key length (AES-256)
  );
}

// Client-side equivalent using Web Crypto API:
export async function derivePayloadKeyClient(sessionToken: string, sessionId: string): Promise<CryptoKey> {
  const rawKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(sessionToken),
    'HKDF-SHA-256',
    false,
    ['deriveBits']
  );
  
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF-SHA-256',
      salt: new TextEncoder().encode('nipp-payload-encryption'),
      info: new TextEncoder().encode(`session:${sessionId}`),
    },
    rawKey,
    256 // 32 bytes = AES-256
  );
  
  return crypto.subtle.importKey(
    'raw',
    bits,
    'AES-GCM',
    false,
    ['encrypt', 'decrypt']
  );
}
```

**Why this works:** The session token is already exchanged over TLS during login. Deriving a secondary key from it adds encryption without introducing new key material in transit.

### 2. Dual Crypto Implementation (Node.js + Web Crypto API)
The existing `lib/crypto.ts` uses Node.js `node:crypto`, which works on the server but not in the browser or Edge runtime. We need two implementations:

**Server-side (`lib/crypto-server.ts`)** — extends existing `lib/crypto.ts`:
```typescript
import { createCipheriv, createDecipheriv } from 'node:crypto';

export async function encryptPayload(plaintext: string, key: Buffer): Promise<string> {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return nonce.toString('hex') + encrypted + authTag;
}

export async function decryptPayload(ciphertext: string, key: Buffer): Promise<string> {
  const nonce = Buffer.from(ciphertext.slice(0, 24), 'hex');
  const authTag = Buffer.from(ciphertext.slice(-32), 'hex');
  const encrypted = ciphertext.slice(24, -32);
  
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
```

**Client-side (`lib/crypto-client.ts`)** — new file using Web Crypto API:
```typescript
export async function encryptPayload(plaintext: string, key: CryptoKey): Promise<string> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder();
  
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    key,
    encoder.encode(plaintext)
  );
  
  const authTag = encrypted.slice(-16);
  const ciphertext = encrypted.slice(0, -16);
  
  return arrayBufferToHex(nonce) + arrayBufferToHex(ciphertext) + arrayBufferToHex(authTag);
}

export async function decryptPayload(ciphertext: string, key: CryptoKey): Promise<string> {
  const nonce = hexToArrayBuffer(ciphertext.slice(0, 24));
  const authTag = hexToArrayBuffer(ciphertext.slice(-32));
  const encryptedData = hexToArrayBuffer(ciphertext.slice(24, -32));
  
  const fullCiphertext = new Uint8Array(encryptedData.byteLength + 16);
  fullCiphertext.set(encryptedData, 0);
  fullCiphertext.set(new Uint8Array(authTag), encryptedData.byteLength);
  
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce },
    key,
    fullCiphertext
  );
  
  return new TextDecoder().decode(decrypted);
}
```

### 3. Server-Side Decryption Middleware
A Next.js middleware or route-level interceptor that decrypts incoming payloads for PII routes:

```typescript
// lib/payload-middleware.ts (new)
import { derivePayloadKey } from './payload-key';

export async function decryptPIIPayload(req: Request, sessionToken: string): Promise<Record<string, unknown>> {
  const encryptedBody = await req.arrayBuffer();
  const ciphertext = Buffer.from(encryptedBody).toString('hex');
  
  // Derive key from session token (session ID extracted from BetterAuth cookie)
  const sessionId = extractSessionId(req);
  const key = derivePayloadKey(sessionToken, sessionId);
  
  // Decrypt
  const plaintext = await decryptPayload(ciphertext, key);
  
  return JSON.parse(plaintext);
}

export async function encryptPIIResponse(data: Record<string, unknown>, sessionToken: string): Promise<Uint8Array> {
  const sessionId = extractSessionIdFromResponse();
  const key = derivePayloadKey(sessionToken, sessionId);
  
  const plaintext = JSON.stringify(data);
  const encrypted = await encryptPayload(plaintext, key);
  
  return new TextEncoder().encode(encrypted);
}
```

**Integration point:** This middleware is applied selectively to PII routes. Two approaches:
- **Route-level wrapper:** Each affected API route wraps its body parsing in `decryptPIIPayload()`.
- **Middleware-level:** A Next.js middleware checks the route path against a PII routes list and intercepts the request/response.

The route-level approach is preferred because it's explicit, easier to audit, and doesn't add overhead to non-PII routes.

### 4. Client-Side Fetch Wrapper
A transparent encrypted fetch wrapper for React components:

```typescript
// lib/api-client.ts (new)
import { derivePayloadKeyClient, encryptPayload, decryptPayload } from './crypto-client';

interface EncryptedFetchOptions extends RequestInit {
  pii?: boolean; // flag to enable payload encryption for this request
}

export async function encryptedFetch(url: string, options: EncryptedFetchOptions = {}): Promise<Response> {
  const isPII = options.pii ?? false;
  
  if (isPII && options.body) {
    const sessionToken = getSessionToken(); // from BetterAuth cookie
    const sessionId = extractSessionIdFromCookie(sessionToken);
    const key = await derivePayloadKeyClient(sessionToken, sessionId);
    
    const plaintext = JSON.stringify(options.body);
    const encrypted = await encryptPayload(plaintext, key);
    
    options.body = new TextEncoder().encode(encrypted);
    options.headers = { ...options.headers, 'Content-Type': 'application/octet-stream' };
  }
  
  const response = await fetch(url, options);
  
  if (isPII && response.ok) {
    const encryptedBody = await response.arrayBuffer();
    const ciphertext = Buffer.from(encryptedBody).toString('hex');
    
    const sessionToken = getSessionToken();
    const sessionId = extractSessionIdFromCookie(sessionToken);
    const key = await derivePayloadKeyClient(sessionToken, sessionId);
    
    const plaintext = await decryptPayload(ciphertext, key);
    
    // Return a new Response with decrypted body
    return new Response(plaintext, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }
  
  return response;
}
```

### 5. Route Configuration for PII Endpoints
A simple configuration to mark which routes handle sensitive PII:

```typescript
// lib/pii-routes.ts (new)
export const PII_ROUTES = [
  '/api/passports',
  '/api/personal-details',
  // Add routes as needed
] as const;

export function isPIIRoute(pathname: string): boolean {
  return PII_ROUTES.some(route => pathname.startsWith(route));
}
```

## File Changes Summary

### New Files
| File | Purpose |
|---|---|
| `lib/payload-key.ts` | HKDF-based session key derivation (server-side) |
| `lib/crypto-client.ts` | AES-256-GCM encrypt/decrypt using Web Crypto API (client-side) |
| `lib/api-client.ts` | Transparent encrypted fetch wrapper for React components |
| `lib/pii-routes.ts` | Configuration of which routes handle sensitive PII |

### Modified Files
| File | Change |
|---|---|
| `lib/crypto.ts` | No changes needed — existing at-rest encryption is separate. May add a shared utility for hex encoding/decoding if needed by both client and server implementations. |
| `middleware.ts` | No changes — payload decryption is handled at the route level, not globally. |
| `lib/auth.ts` | No changes — session token is already available via BetterAuth. |
| API routes handling PII | Wrap request body parsing with `decryptPIIPayload()` and response serialization with `encryptPIIResponse()`. |
| Client components making PII API calls | Replace `fetch()` with `encryptedFetch()` from `lib/api-client.ts`. |
| `.env.local-prod.example` | Add `PAYLOAD_ENCRYPTION_SALT` and `PAYLOAD_ENCRYPTION_INFO_PREFIX` env vars (optional, for configurability). |

## Security Considerations

### Key Derivation Security
- The HKDF salt is static (`"nipp-payload-encryption"`), which is acceptable because the session token provides entropy.
- The info parameter includes the session ID, ensuring different sessions derive different keys even with the same salt.
- The derived key is never transmitted — it's computed independently on both client and server from the session token.

### Encryption Security
- AES-256-GCM provides both confidentiality and integrity (authenticated encryption).
- A fresh random nonce is generated for every encryption operation, preventing nonce reuse attacks.
- The auth tag is verified during decryption — tampered payloads are rejected automatically by GCM.

### Threat Model
This encryption protects against:
- Server-side log leakage (request/response bodies in application logs)
- Compromised server memory (payloads are encrypted in transit, decrypted only briefly during processing)
- Insider threats (server operators cannot read raw PII from network captures)

This does NOT protect against:
- Legitimate server-side processing (the server must decrypt to process the data)
- Client-side compromise (if the browser is compromised, the attacker has access to decrypted payloads)
- TLS termination point compromise (the cloud provider's edge still sees encrypted application data, but the server itself also only sees decrypted data during processing)

## Testing Strategy

A layered testing approach is used: unit tests verify crypto primitives in isolation (no server needed), integration tests verify the full client→server encrypted round-trip with a real HTTP server, and security tests verify resistance to common attacks.

### Test File Layout
```
tests/
  unit/
    payload-key.test.ts          # HKDF key derivation consistency & uniqueness
    crypto-client.test.ts        # Web Crypto API encrypt/decrypt round-trip
    crypto-server.test.ts        # Node.js crypto encrypt/decrypt round-trip
    api-client.test.ts           # Encrypted fetch wrapper behavior
  integration/
    pii-payload-encryption.test.ts   # Full E2E encrypted request/response cycle
    non-pii-routes.test.ts           # Non-PII routes are unaffected
  security/
    payload-encryption-security.test.ts  # Attack resistance verification
```

### Layer 1: Unit Tests — Crypto Correctness (Fast, No Server)

These tests verify the core crypto primitives work correctly in isolation. They run in milliseconds and do not require a running server.

#### `tests/unit/payload-key.test.ts` — Key Derivation Consistency
Verifies that HKDF-SHA-256 produces deterministic, unique keys:
- Same inputs → same key (deterministic)
- Different session IDs → different keys
- Different session tokens → different keys
- Output is always exactly 32 bytes (AES-256)
- Handles edge cases: empty token, special characters, unicode
- No zero-filled keys produced

#### `tests/unit/crypto-client.test.ts` — Client-Side Encrypt/Decrypt Round-Trip
Verifies Web Crypto API (`crypto.subtle`) encrypt/decrypt behavior:
- Simple string round-trip: `encrypt → decrypt` returns original
- JSON object round-trip: preserves structure and values
- Nonce randomization: same plaintext produces different ciphertext each time
- Tamper detection: flipping a byte in ciphertext causes decryption failure
- Truncation detection: removing the auth tag causes decryption failure
- Wrong key rejection: ciphertext encrypted with one key cannot be decrypted with another
- Empty string handling
- Large payload handling (1MB)
- Output format validation: hex-encoded, correct nonce (24 chars) + ciphertext + auth tag (32 chars)
- Statistical nonce uniqueness: 100 sequential encryptions produce 100 unique nonces

#### `tests/unit/crypto-server.test.ts` — Server-Side Encrypt/Decrypt Round-Trip
Verifies Node.js `node:crypto` encrypt/decrypt behavior:
- Same test matrix as client-side tests (round-trip, tamper, truncation, wrong key, empty string, large payload)
- Format compatibility: server output format matches client input format (same hex encoding scheme)
- Unicode handling: emoji, CJK characters round-trip correctly
- Statistical nonce uniqueness: 100 sequential encryptions produce 100 unique nonces

#### `tests/unit/api-client.test.ts` — Encrypted Fetch Wrapper
Verifies the transparent fetch wrapper:
- Encrypts request body when `pii: true` flag is set
- Sends as `application/octet-stream`, not `application/json`
- Decrypts response body for PII routes
- Falls back to standard `fetch` when `pii: false` or not set
- Handles response status codes correctly (preserves 4xx/5xx)

### Layer 2: Integration Tests — End-to-End Flow (Requires Test Server)

These tests spin up a real Next.js test server and verify the full encrypted request/response cycle over HTTP.

#### `tests/integration/pii-payload-encryption.test.ts` — Full E2E Cycle
Tests the complete client→server encrypted flow:
- **Encrypted request → decrypted processing:** Client derives key from session token, encrypts JSON body with AES-GCM, sends as `application/octet-stream`. Server derives same key from session cookie, decrypts, passes plaintext JSON to route handler. Route handler processes normally.
- **Encrypted response → decrypted consumption:** Server encrypts JSON response with AES-GCM. Client derives same key, decrypts, parses JSON.
- **Plaintext rejection:** Sending `application/json` to a PII route returns `400 Bad Request` — the server cannot decrypt plaintext as ciphertext.
- **Tamper rejection:** Flipping bits in the encrypted body causes GCM auth tag verification to fail → `400 Bad Request`.
- **Non-PII bypass:** A non-PII route (e.g., `/api/health`) returns standard JSON with `Content-Type: application/json` — no encryption overhead.
- **Large payload performance:** 100KB encrypted payload processes within timeout (10s limit).

#### `tests/integration/non-pii-routes.test.ts` — Non-PII Route Isolation
Verifies that non-PII routes are completely unaffected:
- Standard `fetch()` calls work without encryption
- Response is standard JSON, not encrypted bytes
- No performance regression on non-PII endpoints
- Middleware does not intercept non-matching routes

### Layer 3: Security Tests — Attack Surface Verification

These tests verify the encryption resists common cryptographic attacks.

#### `tests/security/payload-encryption-security.test.ts` — Attack Resistance
- **Missing auth tag:** Removing the last 32 hex chars (16-byte GCM tag) causes decryption failure
- **Missing nonce:** Removing the first 24 hex chars (12-byte nonce) causes decryption failure
- **Empty ciphertext:** Rejects `""` input gracefully
- **Non-hex input:** Rejects malformed hex strings (e.g., `"not-valid-hex!!!"`)
- **Statistical nonce uniqueness:** 10,000 sequential encryptions produce 10,000 unique nonces (birthday paradox: ~10^9 encryptions needed for 50% collision probability with 96-bit nonce)
- **Ciphertext indistinguishability:** Short and long plaintexts produce ciphertexts of proportional length only — no structural information leaked
- **Single-bit flip detection:** Flipping one hex character in ciphertext causes full decryption failure (GCM integrity guarantee)
- **Deterministic key derivation:** Same inputs produce same keys across multiple import calls
- **Timing resistance:** Valid and invalid ciphertext decryption times are within 10x of each other (not a strict requirement, but flags obvious timing leaks)

### Test Execution in CI

All test layers are integrated into the GitHub Actions CI pipeline:

```yaml
- name: Run payload encryption unit tests
  run: npx vitest run \
    tests/unit/payload-key.test.ts \
    tests/unit/crypto-client.test.ts \
    tests/unit/crypto-server.test.ts

- name: Run encrypted fetch wrapper unit test
  run: npx vitest run tests/unit/api-client.test.ts

- name: Run integration encryption tests (requires server)
  run: npx vitest run \
    tests/integration/pii-payload-encryption.test.ts \
    tests/integration/non-pii-routes.test.ts \
    --test-timeout=30000

- name: Run security tests
  run: npx vitest run tests/security/payload-encryption-security.test.ts
```

### Test Coverage Goals
| Layer | Target Coverage | Notes |
|---|---|---|
| Unit (crypto primitives) | 100% of encrypt/decrypt paths | Every branch in crypto functions tested |
| Unit (key derivation) | 100% of edge cases | Empty, unicode, special chars all covered |
| Integration (E2E) | All PII routes + non-PII bypass | Every marked route tested with encrypted payload |
| Security (attack surface) | All attack vectors listed above | Tamper, truncation, wrong key, timing |
| Integration (non-PII) | All non-PII routes sampled | At least one representative route per path prefix |

### Test Data
All tests use synthetic test data — no real PII, no production secrets:
- Test session tokens: `"test-session-token-abc"`, `"session-token-def"`
- Test session IDs: `"sess-test-001"`, `"sess-002"`
- Test passport numbers: `"AB1234567"` (synthetic format)
- Test keys: `Buffer.alloc(32, 0x42)` or derived from test HKDF inputs
- Large payloads: programmatically generated (`'x'.repeat(N)`)

### Known Test Limitations
- **Timing tests are best-effort:** Node.js GC and OS scheduling introduce noise; the 10x ratio is a warning threshold, not a pass/fail criterion.
- **Integration tests require a running server:** The test harness spawns `next dev` on a random port and waits for readiness. This adds ~2-3 seconds per test file but provides the highest confidence.
- **Client-side crypto tests run in Node.js:** Vitest's default environment is Node.js, which has a built-in `crypto` global that implements the Web Crypto API. This means client-side crypto tests run in Node.js, not a real browser. For full browser compatibility verification, consider adding Playwright tests that run in Chromium (see Phase 6 rollout).
