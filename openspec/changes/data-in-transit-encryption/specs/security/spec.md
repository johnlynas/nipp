# Delta for Security: Data-in-Transit Payload Encryption

## ADDED Requirements

### Requirement: Application-Layer Payload Encryption for PII
All API request and response bodies containing sensitive Personally Identifiable Information (PII) MUST be encrypted at the application layer using AES-256-GCM, in addition to TLS transport encryption.

#### Scenario: Encrypted Request Body
- GIVEN a client is making an API request to a PII route (e.g., `/api/passports`)
- AND the client has an active BetterAuth session
- WHEN the request body contains sensitive PII data
- THEN the client MUST encrypt the JSON body using AES-256-GCM before sending
- THEN the encrypted payload MUST be sent as `application/octet-stream` (not `application/json`)
- THEN the encryption key MUST be derived from the BetterAuth session token via HKDF-SHA-256

#### Scenario: Encrypted Response Body
- GIVEN a PII route handler produces a JSON response containing sensitive PII data
- AND the request was made with an active BetterAuth session
- WHEN the response is serialized for transmission
- THEN the server MUST encrypt the JSON body using AES-256-GCM before sending
- THEN the encrypted payload MUST be returned as `application/octet-stream`

#### Scenario: Server-Side Decryption
- GIVEN a PII route receives an encrypted request body
- WHEN the server middleware processes the request
- THEN the server MUST derive the same AES-256-GCM key from the BetterAuth session token
- THEN the server MUST decrypt the payload before passing it to the route handler
- THEN the route handler MUST receive standard JSON data (no awareness of encryption)

#### Scenario: Key Derivation Consistency
- GIVEN the same session token and session ID on both client and server
- WHEN the key derivation function (HKDF-SHA-256) is applied independently on both sides
- THEN the derived AES-256-GCM keys MUST be identical

#### Scenario: Nonce Uniqueness
- GIVEN multiple encryption operations with the same session key
- WHEN each operation generates a random nonce
- THEN every nonce MUST be unique (no reuse with the same key)

### Requirement: Selective Route Encryption
Payload encryption MUST be applied only to routes that handle sensitive PII, not to all API endpoints.

#### Scenario: PII Route Detection
- GIVEN a list of routes configured as PII-handling endpoints in `lib/pii-routes.ts`
- WHEN an API request is received
- THEN the server MUST check if the route path matches a PII route

#### Scenario: Non-PII Route Bypass
- GIVEN an API request to a non-PII route (e.g., `/api/health`, `/api/auth/*`)
- WHEN the request is processed
- THEN NO payload encryption or decryption MUST be applied
- THEN the response body MUST remain standard JSON

#### Scenario: PII Route Configuration
- GIVEN a new route is created that handles sensitive PII data
- WHEN the developer adds it to `lib/pii-routes.ts`
- THEN payload encryption MUST automatically apply to that route

### Requirement: Error Handling for Decryption Failures
Decryption failures MUST be handled gracefully without exposing sensitive data or crashing the server.

#### Scenario: Malformed Ciphertext
- GIVEN a PII route receives a request with malformed or truncated encrypted body
- WHEN the server attempts to decrypt
- THEN the server MUST return a `400 Bad Request` response (not encrypted)

#### Scenario: Auth Tag Mismatch
- GIVEN a PII route receives an encrypted body that has been tampered with
- WHEN the server attempts to decrypt and verify the GCM auth tag
- THEN the server MUST reject the request with a `400 Bad Request` response (not encrypted)

#### Scenario: Missing Session Token
- GIVEN a PII route receives an encrypted request without a valid session token
- WHEN the server attempts to derive the encryption key
- THEN the server MUST return a `401 Unauthorized` response (not encrypted)

#### Scenario: Decryption Failure
- GIVEN a PII route receives an encrypted body that fails decryption for any reason
- WHEN the server catches the decryption error
- THEN the server MUST return a `400 Bad Request` response (not encrypted)
- THEN the error MUST NOT be logged with any payload content

### Requirement: Client-Side Crypto Compatibility
Client-side encryption MUST use the Web Crypto API (not Node.js `node:crypto`) to be compatible with browser and Edge runtime environments.

#### Scenario: Browser Encryption
- GIVEN a React component running in the browser needs to encrypt a PII payload
- WHEN it calls the client-side encryption function
- THEN it MUST use `crypto.subtle.encrypt` with AES-GCM from the Web Crypto API

#### Scenario: Edge Runtime Compatibility
- GIVEN middleware running on the Next.js Edge runtime needs to derive an encryption key
- WHEN it calls the key derivation function
- THEN it MUST use `crypto.subtle.deriveBits` (Web Crypto API) or be refactored to run in Node.js runtime

### Requirement: No Plaintext Logging of Encrypted Payloads
Encrypted payloads and their decrypted contents MUST NOT appear in application logs.

#### Scenario: Request Body Logging
- GIVEN a PII route handler processes an incoming request
- WHEN the application logs the request body for debugging or audit purposes
- THEN the logged value MUST be the decrypted JSON data (not the raw encrypted ciphertext)

#### Scenario: Response Body Logging
- GIVEN a PII route handler produces an outgoing response
- WHEN the application logs the response body
- THEN the logged value MUST be the decrypted JSON data (not the raw encrypted ciphertext)

#### Scenario: Error Logging
- GIVEN a decryption error occurs during request processing
- WHEN the application logs the error
- THEN the log MUST NOT include any payload content (encrypted or decrypted)

## MODIFIED Requirements

### Requirement: Data in Motion (Transport Layer) — Updated
The existing "Data in Motion" requirement is updated to include application-layer payload encryption as a second layer of protection for PII data.

#### Scenario: Defense-in-Depth Transport Encryption
- GIVEN the application is deployed to production
- WHEN a user accesses a PII endpoint
- THEN data in motion MUST be encrypted via HTTPS (transport layer)
- AND the request/response body MUST ALSO be encrypted via AES-256-GCM (application layer)
- THEN both layers MUST operate independently — failure of one MUST NOT expose plaintext PII

### Requirement: Data at Rest: Sensitive PII — Updated
The existing "Data at Rest" requirement is updated to note that PII is encrypted both in transit (application layer) and at rest.

#### Scenario: Full Lifecycle Encryption
- GIVEN a passport number is submitted by a user
- THEN it MUST be encrypted at rest in the database (AES-256-GCM via `lib/crypto.ts`)
- AND it MUST be encrypted in transit at the application layer (AES-256-GCM via `lib/crypto-client.ts` / `lib/crypto-server.ts`)
- AND it MUST be encrypted in transit at the transport layer (TLS/HTTPS)
