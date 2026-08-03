# Tasks: Data-in-Transit Payload Encryption

## Phase 0: Security Decisions and Threat Model

- [ ] Task 0.1: Write or update the threat model for payload encryption.
  - Define protected assets.
  - Define attacker capabilities.
  - Define trust boundaries.
  - Clarify that this is not end-to-end encryption.
  - Document what happens if TLS is compromised.
  - Document what happens if the BetterAuth session token is compromised.
  - Document what happens if XSS exists.

- [ ] Task 0.2: Confirm the BetterAuth session cookie model.
  - Confirm whether better-auth.session_token is HTTP-only.
  - Confirm cookie name or names.
  - Confirm session rotation behavior.
  - Confirm session expiry behavior.
  - Confirm multi-session behavior.
  - Confirm logout invalidation behavior.

- [ ] Task 0.3: Approve the payload key bootstrap mechanism.
  - Primary recommended mechanism: server-issued payload key over authenticated TLS.
  - Reject JavaScript-readable session cookie unless explicitly approved.
  - Document whether payload keys are stateful or statelessly derived.
  - Document key TTL.
  - Document key revocation.

- [ ] Task 0.4: Approve replay protection strategy.
  - Define timestamp window.
  - Define request nonce format.
  - Define replay-cache backend: Redis, in-memory, or other.
  - Define nonce TTL.
  - Decide whether replay protection is mandatory for v1 or an accepted risk.

- [ ] Task 0.5: Approve payload format.
  - Use raw binary body format.
  - Use version header X-Payload-Encryption: v1.
  - Define minimum payload length.
  - Define maximum payload length.
  - Define header names.
  - Define error codes.

- [ ] Task 0.6: Define operational limits.
  - Maximum encrypted request size.
  - Maximum decrypted JSON size.
  - Timeout budget.
  - Rate limits for payload key endpoint.
  - Rate limits for PII routes.
  - Metrics and alert thresholds.

- [ ] Task 0.7: Define rollout and rollback strategy.
  - Feature flag names.
  - Modes: disabled, permissive, enforce.
  - Staging monitoring duration.
  - Rollback procedure.
  - External consumer migration plan, if applicable.

- [ ] Task 0.8: Obtain security sign-off.
  - Review threat model.
  - Review key bootstrap.
  - Review replay protection.
  - Review XSS/session-theft limitations.
  - Review logging policy.

## Phase 1: Shared Format and Crypto Utilities

- [ ] Task 1.1: Create lib/payload-format.ts.
  - Export PAYLOAD_ENCRYPTION_VERSION.
  - Export NONCE_BYTES = 12.
  - Export AUTH_TAG_BYTES = 16.
  - Export MIN_ENCRYPTED_BYTES.
  - Add binary helpers.
  - Add base64url encode/decode helpers.
  - Add payload length validation.
  - Do not expose raw key logging or debug printing of secrets.

- [ ] Task 1.2: Create lib/crypto-server.ts.
  - Implement AES-256-GCM encryption with AAD.
  - Implement AES-256-GCM decryption with AAD.
  - Use raw binary output: nonce, ciphertext, auth tag.
  - Use node:crypto.
  - Throw typed errors.
  - Add unit tests.

- [ ] Task 1.3: Create lib/crypto-client.ts.
  - Implement AES-256-GCM encryption with AAD using Web Crypto.
  - Implement AES-256-GCM decryption with AAD using Web Crypto.
  - Use raw binary output.
  - Do not use Node.js Buffer.
  - Use TextEncoder and TextDecoder.
  - Use crypto.getRandomValues for nonces.
  - Add unit tests.

- [ ] Task 1.4: Create optional server-side HKDF utility if using derived keys.
  - Create lib/payload-key-server.ts.
  - Use hkdfSync correctly.
  - Wrap HKDF output with Buffer.from.
  - Include session ID and server-side secret/context.
  - Do not expose HKDF secrets to the client unless explicitly approved.
  - Add unit tests.

- [ ] Task 1.5: If any client-side HKDF is ever used, verify Web Crypto usage.
  - Use algorithm name HKDF, not HKDF-SHA-256.
  - Specify hash SHA-256 in deriveBits.
  - Import HKDF key with usage deriveBits.
  - Add interoperability tests comparing Node and Web Crypto HKDF output.

- [ ] Task 1.6: Create lib/pii-routes.ts.
  - Define exact and parameterized PII routes.
  - Implement robust route matching.
  - Strip query strings before matching.
  - Normalize trailing slashes.
  - Avoid prefix overmatching.
  - Add unit tests.

## Phase 2: Server Payload Key and Route Protection

- [ ] Task 2.1: Define PayloadKeyProvider abstraction.
  - issueKey(sessionContext)
  - getKey(keyId, sessionContext)
  - revokeKeysForSession(sessionId)
  - Support expiry.
  - Support multiple active keys.
  - Support session rotation.

- [ ] Task 2.2: Implement payload key issuance endpoint.
  - Create app/api/security/payload-key/route.ts.
  - Require valid BetterAuth session.
  - Return keyId, algorithm, expiresAt, and key.
  - Set Cache-Control: no-store.
  - Rate-limit endpoint.
  - Do not log response body.
  - Add integration tests.

- [ ] Task 2.3: Create lib/payload-session.ts.
  - Extract BetterAuth session context server-side.
  - Validate session.
  - Extract session ID.
  - Handle missing/expired session.
  - Return typed session context.
  - Add unit/integration tests.

- [ ] Task 2.4: Create lib/payload-middleware.ts or lib/pii-route-wrapper.ts.
  - Authenticate session before decryption.
  - Validate feature flag.
  - Validate payload version header.
  - Validate payload key ID header.
  - Validate timestamp header.
  - Validate request nonce header.
  - Enforce payload size limits.
  - Validate content type for request bodies.
  - Read raw request body once.
  - Retrieve payload key.
  - Validate replay nonce.
  - Build request AAD.
  - Decrypt request body.
  - Parse JSON.
  - Validate schema.
  - Build response AAD.
  - Encrypt successful response.
  - Return safe unencrypted errors.

- [ ] Task 2.5: Implement replay protection.
  - Validate timestamp window.
  - Store used request nonces.
  - Use TTL-based replay cache.
  - Return error on replay.
  - Add tests.

- [ ] Task 2.6: Implement cache-prevention headers.
  - Encrypted PII responses must set Cache-Control: no-store.
  - Payload key endpoint must set Cache-Control: no-store.
  - Add tests.

- [ ] Task 2.7: Implement observability.
  - Add metrics for encrypted requests, encrypted responses, decryption failures, expired keys, unknown keys, replay detections, oversized payloads, and unsupported versions.
  - Ensure logs do not include ciphertext, plaintext bodies, payload keys, or session tokens.
  - Add log redaction tests.

- [ ] Task 2.8: Implement feature-flag enforcement.
  - Add PAYLOAD_ENCRYPTION_MODE.
  - Support disabled, permissive, and enforce.
  - In enforce, reject plaintext PII requests.
  - In permissive, emit metrics for plaintext PII traffic.
  - Add tests for each mode.

- [ ] Task 2.9: Update PII API routes.
  - Identify all PII routes.
  - Replace direct req.json usage with wrapper-provided input.
  - Ensure error responses are unencrypted.
  - Ensure successful PII responses are encrypted in enforce mode.
  - Handle OPTIONS requests safely.
  - Handle 204 No Content where applicable.
  - Ensure route handlers run in the correct runtime.

## Phase 3: Client Key Manager and API Client

- [ ] Task 3.1: Create lib/payload-key-manager.ts.
  - Fetch payload key from /api/security/payload-key.
  - Import key as non-extractable AES-GCM CryptoKey.
  - Store key only in memory.
  - Refresh key before expiry.
  - Refresh key on stale-key error.
  - Clear key on logout.
  - Do not persist key material.
  - Add unit tests with mocked fetch.

- [ ] Task 3.2: Create lib/api-client.ts.
  - Implement encryptedFetch.
  - Require explicit pii: true for PII routes.
  - Validate that body is JSON-serializable.
  - Reject unsupported body types.
  - Add payload encryption headers.
  - Generate request timestamp.
  - Generate request nonce.
  - Encrypt request body when present.
  - Send raw binary body with application/octet-stream.
  - Decrypt successful encrypted responses.
  - Handle 204 No Content.
  - Preserve error responses.
  - Retry once after refreshing payload key on stale-key errors.
  - Override synthetic decrypted response Content-Type to application/json.
  - Remove misleading Content-Length header from synthetic response.

- [ ] Task 3.3: Integrate with SWR/React Query.
  - Ensure fetchers use encryptedFetch.
  - Ensure decrypted data is passed to components.
  - Ensure encrypted payloads are not persisted.
  - Ensure retry logic does not retry non-retryable decryption errors.
  - Add tests.

- [ ] Task 3.4: Update all PII client calls.
  - Search for fetch, SWR, and React Query calls touching PII routes.
  - Replace with encryptedFetch.
  - Add pii: true.
  - Verify mutations and queries.
  - Verify logout/login transitions.

- [ ] Task 3.5: Handle unsupported browser environments.
  - Check secure context.
  - Check Web Crypto availability.
  - Fail safely or show approved error state.
  - Do not silently send plaintext PII if encryption is required.

## Phase 4: Testing

### Unit Tests

- [ ] Task 4.1: Payload format tests.
  - Minimum length validation.
  - Binary concatenation.
  - Base64url encode/decode.
  - Invalid input handling.

- [ ] Task 4.2: Server crypto tests.
  - Round-trip encryption/decryption.
  - Unicode round-trip.
  - Empty plaintext round-trip.
  - Wrong key rejection.
  - Tamper rejection.
  - Truncation rejection.
  - AAD mismatch rejection.
  - Binary format compatibility.

- [ ] Task 4.3: Client crypto tests.
  - Web Crypto round-trip.
  - Unicode round-trip.
  - Empty plaintext round-trip.
  - Wrong key rejection.
  - Tamper rejection.
  - Truncation rejection.
  - AAD mismatch rejection.
  - No use of Node.js Buffer.

- [ ] Task 4.4: Interoperability tests.
  - Server encrypts, client decrypts.
  - Client encrypts, server decrypts.
  - AAD binding works across runtimes.
  - HKDF outputs match if HKDF is used.

- [ ] Task 4.5: Route matcher tests.
  - Exact routes.
  - Dynamic routes.
  - Trailing slashes.
  - Query strings.
  - Prefix overmatching prevention.

- [ ] Task 4.6: Payload key manager tests.
  - Initial key fetch.
  - Key refresh.
  - Key expiry.
  - Logout clearing.
  - No persistence.

- [ ] Task 4.7: API client tests.
  - Encrypts body when pii: true.
  - Sends binary body.
  - Adds required headers.
  - Decrypts successful response.
  - Leaves error responses unmodified.
  - Handles 204.
  - Handles missing body.
  - Handles stale key retry.
  - Rejects unsupported body types.

### Integration Tests

- [ ] Task 4.8: Create authenticated test helpers.
  - Create valid BetterAuth test session.
  - Obtain session cookie.
  - Obtain payload key.
  - Clean up sessions.

- [ ] Task 4.9: Full encrypted request/response tests.
  - POST encrypted PII body.
  - Server decrypts.
  - Server processes.
  - Server encrypts response.
  - Client decrypts response.

- [ ] Task 4.10: GET encrypted response tests.
  - GET PII route without request body.
  - Server encrypts response.
  - Client decrypts response.

- [ ] Task 4.11: Plaintext rejection tests.
  - In enforce mode, plaintext JSON to PII route returns error.
  - In permissive mode, plaintext is accepted but metric is emitted.
  - In disabled mode, encryption is not required.

- [ ] Task 4.12: Security rejection tests.
  - Tampered ciphertext rejected.
  - Missing nonce rejected.
  - Missing auth tag rejected.
  - Wrong route rejected.
  - Wrong method rejected.
  - Wrong key rejected.
  - Unsupported version rejected.
  - Stale timestamp rejected.
  - Replayed nonce rejected.

- [ ] Task 4.13: Key lifecycle tests.
  - Expired key rejected.
  - Unknown key rejected.
  - Client refreshes and retries once.
  - Logout invalidates keys.
  - Session rotation invalidates old keys according to policy.

- [ ] Task 4.14: Operational tests.
  - Oversized payload returns 413.
  - Wrong content type returns 415 or 400.
  - Non-PII routes bypass encryption.
  - OPTIONS requests bypass payload decryption.
  - Encrypted responses include Cache-Control: no-store.
  - Payload key endpoint includes Cache-Control: no-store.

- [ ] Task 4.15: Logging redaction tests.
  - Encrypted bodies are not logged.
  - Decrypted PII bodies are not logged.
  - Payload keys are not logged.
  - Session tokens are not logged.
  - Error logs contain only safe metadata.

### Security Tests

- [ ] Task 4.16: Attack-surface tests.
  - Empty payload rejected.
  - Truncated payload rejected.
  - Malformed binary payload rejected.
  - Wrong AAD rejected.
  - Cross-route replay rejected.
  - Cross-method replay rejected.
  - Same-route replay rejected.
  - Missing headers rejected.
  - Invalid timestamp rejected.
  - Reused request nonce rejected.

- [ ] Task 4.17: Timing test as advisory only.
  - Compare valid vs invalid decryption timing.
  - Do not make this a hard CI gate.
  - Use as warning threshold only.

### Browser and Performance Tests

- [ ] Task 4.18: Add Playwright browser test.
  - Verify Web Crypto works in real browser.
  - Verify payload key import.
  - Verify encrypted request round-trip.
  - Verify encrypted response decryption.
  - Verify logout clears in-memory key.

- [ ] Task 4.19: Add performance benchmark.
  - 1KB payload.
  - 10KB payload.
  - 100KB payload.
  - maximum allowed payload.
  - concurrent requests.
  - key refresh overhead.
  - document performance budget.

- [ ] Task 4.20: Add CI pipeline.
  - Run unit tests on every PR.
  - Run integration tests with stable test server.
  - Avoid flaky next dev -p 0 if possible.
  - Use built app or dedicated test harness.
  - Add extended timeout for integration tests.
  - Add Playwright browser dependency cache.
  - Mark timing tests advisory.

## Phase 5: Security Review and Hardening

- [ ] Task 5.1: Audit all PII routes.
  - Confirm every route handling passport/PII data is listed.
  - Confirm dynamic routes are matched.
  - Confirm no accidental non-PII overmatching.
  - Confirm no PII route is missed.

- [ ] Task 5.2: Audit PII outside request bodies.
  - Check URLs.
  - Check query strings.
  - Check headers.
  - Check cookies.
  - Check logs.
  - Check analytics.
  - Check error reports.
  - Check tracing.

- [ ] Task 5.3: Audit unsupported body types.
  - Confirm file uploads are out of scope or protected.
  - Confirm multipart bodies are not accidentally marked PII.
  - Confirm streamed responses are not accidentally encrypted.

- [ ] Task 5.4: Audit authentication and CSRF protections.
  - Confirm BetterAuth cookie flags.
  - Confirm SameSite behavior.
  - Confirm CORS policy.
  - Confirm CSRF token or equivalent protections for mutations.
  - Confirm payload encryption does not bypass existing protections.

- [ ] Task 5.5: Audit runtime compatibility.
  - Confirm PII routes run in Node.js runtime if using Node crypto.
  - Confirm no Edge-runtime incompatibilities.
  - Confirm SSR/server component paths do not send plaintext PII unintentionally.
  - Confirm server-to-server calls are covered or explicitly accepted.

- [ ] Task 5.6: Audit caching layers.
  - CDN.
  - HTTP cache.
  - service worker.
  - React Query persistence.
  - SWR persistence.
  - browser back/forward cache.

- [ ] Task 5.7: Audit observability.
  - Metrics.
  - Logs.
  - Traces.
  - Error reporting.
  - Debug endpoints.
  - Admin tools.

- [ ] Task 5.8: Review key management.
  - Key TTL.
  - Key rotation.
  - Key revocation.
  - Multi-tab behavior.
  - Multi-device behavior.
  - Session token rotation.
  - Payload key endpoint abuse.

## Phase 6: Documentation and Rollout

- [ ] Task 6.1: Update SECURITY.md.
  - Document payload encryption scope.
  - Document threat model.
  - Document limitations.
  - Document key lifecycle.
  - Document replay protection.
  - Document logging policy.
  - Document incident response for suspected key leakage.

- [ ] Task 6.2: Update ARCHITECTURE.md.
  - Add payload encryption diagram.
  - Add key issuance flow.
  - Add request/response flow.
  - Add trust boundaries.

- [ ] Task 6.3: Update API documentation.
  - Document encrypted request format.
  - Document encrypted response format.
  - Document required headers.
  - Document error codes.
  - Document versioning.
  - Document migration guidance for external consumers.

- [ ] Task 6.4: Update environment examples.
  - Add PAYLOAD_ENCRYPTION_MODE.
  - Add PAYLOAD_ENCRYPTION_MAX_BYTES.
  - Add PAYLOAD_ENCRYPTION_KEY_TTL_SECONDS.
  - Add PAYLOAD_ENCRYPTION_REPLAY_WINDOW_SECONDS.
  - Add PAYLOAD_ENCRYPTION_NONCE_TTL_SECONDS.
  - Add server-side HKDF salt/secret if used.
  - Document which variables are safe to expose to clients and which must remain server-only.

- [ ] Task 6.5: Deploy to staging.
  - Enable feature flag.
  - Use permissive or enforce according to rollout plan.
  - Monitor error rates, latency, decryption failures, key refresh failures, replay detections, and payload size rejections.
  - Validate browser behavior.
  - Validate logout/login flows.
  - Validate multi-tab behavior.

- [ ] Task 6.6: Production rollout.
  - Enable for a limited set of PII routes first if possible.
  - Monitor for agreed period.
  - Expand to all configured PII routes.
  - Keep rollback procedure documented.
  - Confirm alerts are active.

- [ ] Task 6.7: Post-rollout review.
  - Review metrics.
  - Review errors.
  - Review support tickets.
  - Review security logs.
  - Confirm no plaintext PII leakage.
  - Confirm no unexpected cache behavior.
  - Confirm rollback path still works.