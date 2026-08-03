# Delta for Security: Data-in-Transit Payload Encryption

## ADDED Requirements

### Requirement: Payload Key Bootstrap Without Exposing HTTP-Only Session Cookies

The system MUST provide a mechanism for the client to obtain a payload encryption key without requiring JavaScript access to HTTP-only BetterAuth session cookies.

#### Scenario: Authenticated Client Requests Payload Key

GIVEN a user has an active BetterAuth session
WHEN the client requests a payload encryption key from the server
THEN the server MUST validate the session
AND the server MUST return a payload key identifier, expiry, algorithm, and key material
AND the response MUST include Cache-Control: no-store

#### Scenario: Unauthenticated Client Requests Payload Key

GIVEN a client without a valid BetterAuth session requests a payload encryption key
WHEN the server processes the request
THEN the server MUST return 401 Unauthorized
AND the server MUST NOT return payload key material

#### Scenario: Client Stores Payload Key

GIVEN the client receives a payload encryption key
WHEN the client imports the key
THEN the key MUST be imported as a non-extractable AES-GCM CryptoKey where supported
AND the key MUST NOT be stored in localStorage, sessionStorage, IndexedDB, cookies, or persistent caches

#### Scenario: Logout Invalidates Payload Key

GIVEN a user logs out
WHEN the client processes logout
THEN the client MUST clear any in-memory payload key material
AND subsequent PII requests MUST require a new authenticated payload key

---

### Requirement: Application-Layer Payload Encryption for PII

All configured API request and response bodies containing sensitive PII MUST be encrypted at the application layer using AES-256-GCM, in addition to TLS transport encryption.

#### Scenario: Encrypted Request Body

GIVEN a client is making an API request to a configured PII route
AND the client has an active payload key
WHEN the request body contains sensitive PII data
THEN the client MUST encrypt the JSON body using AES-256-GCM
AND the encrypted body MUST be sent as raw binary with Content-Type: application/octet-stream
AND the request MUST include the payload encryption version header
AND the request MUST include the payload key ID header

#### Scenario: Encrypted Response Body

GIVEN a configured PII route handler produces a successful JSON response containing sensitive PII data
AND the request was made with a valid payload key
WHEN the response is serialized for transmission
THEN the server MUST encrypt the JSON body using AES-256-GCM
AND the encrypted payload MUST be returned as raw binary with Content-Type: application/octet-stream
AND the response MUST include Cache-Control: no-store

#### Scenario: Server-Side Decryption

GIVEN a configured PII route receives an encrypted request body
WHEN the server payload wrapper processes the request
THEN the server MUST retrieve the payload key associated with the request
AND the server MUST decrypt the payload using AES-256-GCM
AND the route handler MUST receive standard JSON data
AND the route handler MUST NOT need to know that payload encryption was used

#### Scenario: Nonce Uniqueness

GIVEN multiple encryption operations with the same payload key
WHEN each operation generates a GCM nonce
THEN each nonce MUST be generated using a cryptographically secure random source
AND nonce reuse with the same key MUST be prevented by design

---

### Requirement: Versioned Binary Payload Format

Encrypted payloads MUST use a versioned binary format.

#### Scenario: Valid Payload Format

GIVEN an encrypted payload is sent to a PII route
WHEN the server validates the payload format
THEN the payload MUST contain at least a 12-byte nonce and a 16-byte AES-GCM authentication tag
AND the payload MUST be raw binary
AND the payload version header MUST be supported

#### Scenario: Unsupported Version

GIVEN a client sends an unsupported payload encryption version
WHEN the server processes the request
THEN the server MUST reject the request
AND the server MUST return a safe JSON error response

#### Scenario: Truncated Payload

GIVEN an encrypted payload is shorter than the minimum valid length
WHEN the server validates the payload
THEN the server MUST reject the request with 400 Bad Request
AND the server MUST NOT attempt business processing

#### Scenario: Malformed Payload

GIVEN an encrypted payload cannot be parsed or fails authentication
WHEN the server processes the payload
THEN the server MUST return a safe generic error response
AND the error response MUST NOT include payload content

---

### Requirement: Request Context Binding

Encrypted payloads MUST be cryptographically bound to the request context using AES-GCM Additional Authenticated Data.

#### Scenario: Request Bound to Method and Path

GIVEN an encrypted payload is created for a specific HTTP method and path
WHEN the payload is sent to the same method and path with valid context
THEN decryption MUST succeed

#### Scenario: Request Sent to Different Path

GIVEN an encrypted payload is created for one PII path
WHEN the same payload is sent to a different PII path
THEN the server MUST reject the payload

#### Scenario: Request Sent with Different Method

GIVEN an encrypted payload is created for one HTTP method
WHEN the same payload is sent using a different HTTP method
THEN the server MUST reject the payload

---

### Requirement: Freshness and Replay Protection

Encrypted PII requests MUST include freshness information and MUST be protected against replay within the configured window.

#### Scenario: Valid Timestamp and Nonce

GIVEN an encrypted PII request includes a timestamp and request nonce
WHEN the timestamp is within the configured window
AND the nonce has not been used before for the relevant session/key
THEN the server MAY process the request

#### Scenario: Stale Timestamp

GIVEN an encrypted PII request includes a timestamp outside the configured window
WHEN the server validates the request
THEN the server MUST reject the request

#### Scenario: Replayed Request Nonce

GIVEN an encrypted PII request includes a request nonce that has already been seen within the replay window
WHEN the server validates the request
THEN the server MUST reject the request

---

### Requirement: Payload Key Lifecycle

The system MUST support payload key expiry, rotation, and invalidation.

#### Scenario: Expired Payload Key

GIVEN a client sends an encrypted request using an expired payload key
WHEN the server validates the key
THEN the server MUST reject the request with an error indicating key expiry or invalidity
AND the client SHOULD refresh the payload key and retry once

#### Scenario: Unknown Payload Key

GIVEN a client sends a payload key identifier that is not recognized by the server
WHEN the server validates the key
THEN the server MUST reject the request

#### Scenario: Session Rotation

GIVEN the BetterAuth session token rotates
WHEN the client next requests a payload key
THEN the server MUST issue a key bound to the current valid session
AND old payload keys MUST become invalid according to the configured policy

#### Scenario: Multiple Tabs or Devices

GIVEN a user has multiple active tabs or devices
WHEN each tab obtains a payload key
THEN the server MUST support multiple valid payload keys for the same user session or session family
AND one tab refreshing its key MUST NOT silently break other tabs beyond the configured expiry policy

---

### Requirement: Selective Route Encryption

Payload encryption MUST be applied only to configured PII routes.

#### Scenario: PII Route Detection

GIVEN a list of configured PII routes
WHEN an API request is received
THEN the server MUST determine whether the request path matches a configured PII route using exact or parameterized route matching

#### Scenario: Non-PII Route Bypass

GIVEN an API request to a non-PII route
WHEN the request is processed
THEN payload encryption and decryption MUST NOT be applied
AND the response body MUST remain standard JSON unless otherwise specified

#### Scenario: Dynamic PII Routes

GIVEN a PII route with path parameters, such as /api/passports/:id
WHEN a request is made to a concrete instance of that route
THEN the route matcher MUST identify it as a PII route

#### Scenario: No Prefix Overmatching

GIVEN a configured PII route /api/passports
WHEN a request is made to /api/passports-public
THEN the route matcher MUST NOT classify the request as a PII route solely due to prefix similarity

---

### Requirement: PII Location Restrictions

Sensitive PII MUST NOT be transmitted in URLs, query strings, or HTTP headers unless separately protected and approved.

#### Scenario: Sensitive PII in Query String

GIVEN an API route handles sensitive PII
WHEN the API is designed or audited
THEN sensitive PII MUST NOT be placed in query parameters
AND any violation MUST be flagged for remediation

#### Scenario: Sensitive PII in Headers

GIVEN an API route handles sensitive PII
WHEN the API is designed or audited
THEN sensitive PII MUST NOT be placed in HTTP headers unless explicitly approved
AND any violation MUST be flagged for remediation

#### Scenario: Unsupported Body Types

GIVEN a client attempts to encrypt a PII payload using FormData, Blob, ReadableStream, URLSearchParams, or ArrayBuffer
WHEN the encrypted fetch wrapper processes the request
THEN the wrapper MUST reject the request or route it through an approved alternative flow

---

### Requirement: Error Handling and Status Precedence

Decryption and payload key failures MUST be handled gracefully without exposing sensitive data or crashing the server.

#### Scenario: Missing or Invalid Session

GIVEN a PII route receives a request without a valid BetterAuth session
WHEN the server processes the request
THEN the server MUST return 401 Unauthorized
AND the server MUST NOT return payload key material
AND the server MUST NOT decrypt the payload

#### Scenario: Missing Payload Key Header

GIVEN an enforced PII route receives an encrypted request without a payload key identifier
WHEN the server processes the request
THEN the server MUST return 400 Bad Request

#### Scenario: Malformed Ciphertext

GIVEN a PII route receives a request with malformed or truncated encrypted body
WHEN the server validates or decrypts the payload
THEN the server MUST return 400 Bad Request

#### Scenario: Auth Tag Mismatch

GIVEN a PII route receives an encrypted body that has been tampered with
WHEN the server verifies the GCM auth tag
THEN the server MUST reject the request with 400 Bad Request

#### Scenario: Payload Too Large

GIVEN an encrypted PII request exceeds the configured maximum payload size
WHEN the server validates the request
THEN the server MUST reject the request with 413 Payload Too Large
AND the server SHOULD reject the request before performing decryption

#### Scenario: Wrong Content Type

GIVEN an enforced PII route receives a request body with an unsupported content type
WHEN the server validates the request
THEN the server MUST reject the request with 415 Unsupported Media Type or 400 Bad Request

#### Scenario: Safe Error Responses

GIVEN a payload encryption error occurs
WHEN the server returns an error response
THEN the response MUST NOT include ciphertext, plaintext, session tokens, payload keys, or stack traces
AND the response SHOULD use a generic machine-readable error code

---

### Requirement: Payload Size and DoS Protection

The system MUST enforce payload size limits and protect decryption endpoints from excessive load.

#### Scenario: Payload Within Limit

GIVEN an encrypted PII request is within the configured maximum size
WHEN the server processes the request
THEN the request MAY proceed to decryption

#### Scenario: Payload Exceeds Limit

GIVEN an encrypted PII request exceeds the configured maximum size
WHEN the server validates the request
THEN the server MUST reject the request with 413 Payload Too Large

#### Scenario: Rate Limiting

GIVEN repeated payload key requests or repeated decryption failures from the same client
WHEN the system detects abusive behavior
THEN the system SHOULD apply rate limiting or abuse monitoring

---

### Requirement: Cache Prevention for Encrypted PII

Encrypted PII responses and payload key material MUST NOT be cached.

#### Scenario: Encrypted PII Response Headers

GIVEN a server returns an encrypted PII response
WHEN the response is sent
THEN the response MUST include Cache-Control: no-store

#### Scenario: Payload Key Endpoint Headers

GIVEN the server returns payload key material
WHEN the response is sent
THEN the response MUST include Cache-Control: no-store

#### Scenario: CDN and Service Workers

GIVEN encrypted PII routes are deployed
WHEN CDN or service-worker caching is configured
THEN encrypted PII responses MUST NOT be cached
AND payload key responses MUST NOT be cached

---

### Requirement: Observability Without PII

The system MUST provide observability for payload encryption without logging sensitive payload data.

#### Scenario: Metrics

GIVEN payload encryption is enabled
WHEN encrypted requests or responses are processed
THEN the system SHOULD emit metrics for success, failure, latency, payload size, and error category

#### Scenario: No Payload Logging

GIVEN a PII request or response is processed
WHEN the application logs request or response information
THEN the logs MUST NOT contain encrypted payload bodies
AND the logs MUST NOT contain decrypted PII payload bodies
AND the logs MUST NOT contain payload keys or session tokens

#### Scenario: Error Logging

GIVEN a decryption error occurs
WHEN the application logs the error
THEN the log MUST include enough metadata to diagnose the failure
AND the log MUST NOT include payload content

---

### Requirement: Feature Flag and Rollout Control

Payload encryption MUST be controllable by configuration.

#### Scenario: Disabled Mode

GIVEN payload encryption mode is disabled
WHEN a request is made to a PII route
THEN the server MUST NOT require encrypted payloads

#### Scenario: Enforce Mode

GIVEN payload encryption mode is enforce
WHEN a plaintext JSON request is made to a configured PII route
THEN the server MUST reject the request

#### Scenario: Permissive Migration Mode

GIVEN payload encryption mode is permissive
WHEN a plaintext JSON request is made to a configured PII route
THEN the server MAY accept the request for migration purposes
AND the system SHOULD emit a metric identifying plaintext PII traffic
AND this mode MUST NOT be used as the final production security state without approval

#### Scenario: Rollback

GIVEN payload encryption causes production incidents
WHEN operators disable payload encryption via configuration
THEN PII routes SHOULD revert to the previous plaintext-over-TLS behavior without requiring a client code rollback, where operationally feasible

---

### Requirement: CSRF and Existing Protections Remain Required

Payload encryption MUST NOT be treated as a replacement for CSRF protection, authentication, or authorization.

#### Scenario: Mutating PII Requests

GIVEN a PII route mutates sensitive data
WHEN the route is invoked
THEN the route MUST continue to enforce authentication and authorization
AND the route MUST continue to enforce existing CSRF protections where applicable

#### Scenario: Cross-Origin Requests

GIVEN a cross-origin request attempts to access a PII route
WHEN the request is processed
THEN CORS policy MUST continue to restrict unauthorized cross-origin access
AND payload encryption MUST NOT weaken SameSite or CORS protections

---

### Requirement: Runtime Compatibility

Payload encryption MUST be compatible with the application’s runtime environments.

#### Scenario: Browser Encryption

GIVEN a React component running in a secure browser context needs to encrypt a PII payload
WHEN it calls the client-side encryption function
THEN it MUST use the Web Crypto API
AND it MUST NOT rely on Node.js Buffer

#### Scenario: Server Runtime

GIVEN a PII route handler uses Node.js crypto
WHEN the route is deployed
THEN the route MUST run in a Node.js-compatible runtime
OR the implementation MUST use Web Crypto-compatible utilities if deployed to Edge runtime

#### Scenario: Secure Context Required

GIVEN a browser is not in a secure context
WHEN the client attempts payload encryption
THEN the application SHOULD fail safely or fall back according to approved product/security policy

---

## MODIFIED Requirements

### Requirement: Data in Motion — Updated

The existing Data in Motion requirement is updated to include application-layer payload encryption as a defense-in-depth control for selected PII routes.

#### Scenario: Defense-in-Depth Transport Encryption

GIVEN the application is deployed to production
WHEN a user accesses a configured PII endpoint
THEN data in motion MUST be encrypted via HTTPS at the transport layer
AND the configured request/response body MUST also be encrypted via AES-256-GCM at the application layer
AND the application-layer control MUST be treated as defense-in-depth, not as an absolute independent guarantee

---

### Requirement: Data at Rest — Updated

The existing Data at Rest requirement is updated to note that selected PII is protected in transit at both transport and application layers, in addition to at-rest encryption.

#### Scenario: Full Lifecycle Protection

GIVEN a passport number is submitted by a user
THEN it MUST be encrypted at rest in the database using the approved at-rest encryption mechanism
AND it MUST be protected in transit by TLS
AND it MUST be protected in transit by application-layer payload encryption where the route is configured for payload encryption
AND this proposal MUST NOT be interpreted as eliminating the need for secure server-side processing

---

### Requirement: No PII Payload Logging — Updated

The previous logging requirement is replaced.

Encrypted payloads and decrypted PII payload contents MUST NOT be logged by default.

#### Scenario: Request Body Logging

GIVEN a PII route handler processes an incoming request
WHEN the application logs request information
THEN the logged data MUST NOT include the encrypted request body
AND the logged data MUST NOT include the decrypted PII request body
AND the logged data MAY include non-sensitive metadata such as route, method, status, request ID, and payload size

#### Scenario: Response Body Logging

GIVEN a PII route handler produces an outgoing response
WHEN the application logs response information
THEN the logged data MUST NOT include the encrypted response body
AND the logged data MUST NOT include the decrypted PII response body

#### Scenario: Approved Redacted Logging

GIVEN an audit or debugging requirement needs limited PII visibility
WHEN logging is implemented
THEN only explicitly allowlisted fields may be logged
AND sensitive values MUST be redacted, tokenized, or truncated according to the approved logging policy
