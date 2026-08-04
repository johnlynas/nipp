/**
 * Server-side payload encryption middleware / route wrapper.
 *
 * Provides helpers to wrap PII API routes with:
 * - Session authentication
 * - Feature flag enforcement (disabled / permissive / enforce)
 * - Payload header validation
 * - Replay protection with fail-closed in enforce mode
 * - Request body decryption
 * - Response body encryption
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { decryptWithAad, encryptWithAad } from './crypto-server';
import { getValidPayloadKey } from './payload-key-server';
import { incrementMetric } from './payload-metrics';
import { createReplayCache, getReplayCacheBackend } from './replay-cache-redis';
import {
  HEADER_PAYLOAD_ENCRYPTION,
  HEADER_PAYLOAD_KEY_ID,
  HEADER_PAYLOAD_TIMESTAMP,
  HEADER_PAYLOAD_NONCE,
  ERROR_CODES,
  validatePayloadLength,
  validatePayloadVersion,
  validateTimestamp,
  validateNonceFormat,
  validateKeyId,
  decodeBase64url,
  buildRequestAad,
  buildResponseAad,
} from './payload-format';
import { isPiiRoute } from './pii-routes';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Route params extracted from the URL path (e.g., { orgId: 'abc123' }). */
export interface PiiRouteParams {
  [param: string]: string | undefined;
}

export type PiiRouteHandler = (
  request: NextRequest,
  decryptedBody: unknown | null,
  params?: PiiRouteParams,
) => Promise<Response> | Response;

export interface PiiRouteContext {
  sessionId: string;
}

/** Context object passed by Next.js App Router to route handlers. */
export interface WrapPiiRouteContext {
  params: Promise<PiiRouteParams>;
}

/** Validated key material reused for both decryption and encryption. */
interface ValidatedKey {
  keyId: string;
  keyBytes: Uint8Array;
}

// ---------------------------------------------------------------------------
// Replay cache instance (lazy-initialized)
// ---------------------------------------------------------------------------

let _replayCache: ReturnType<typeof createReplayCache> | null = null;

/** Get or create the replay cache instance. */
function getReplayCache() {
  if (!_replayCache) {
    _replayCache = createReplayCache();
  }
  return _replayCache;
}

// ---------------------------------------------------------------------------
// Startup warning: enforce mode without replay cache requirement
// ---------------------------------------------------------------------------

/** Warn once at module load time if enforce mode is active without replay cache requirement. */
function warnEnforceWithoutReplayCache(): void {
  if (
    env.PAYLOAD_ENCRYPTION_MODE === 'enforce' &&
    env.PAYLOAD_ENCRYPTION_REQUIRE_REPLAY_CACHE !== 'true'
  ) {
    logger.warn(
      {
        mode: env.PAYLOAD_ENCRYPTION_MODE,
        requireReplayCache: env.PAYLOAD_ENCRYPTION_REQUIRE_REPLAY_CACHE,
      },
      'Enforce mode is active but PAYLOAD_ENCRYPTION_REQUIRE_REPLAY_CACHE is not set to true. ' +
        'In multi-instance deployments, replay protection may be degraded if the cache backend is unavailable. ' +
        'Set PAYLOAD_ENCRYPTION_REQUIRE_REPLAY_CACHE=true for production enforce mode.',
    );
  }
}

// Run startup warning immediately when this module loads.
warnEnforceWithoutReplayCache();

// ---------------------------------------------------------------------------
// Feature flag helpers
// ---------------------------------------------------------------------------

/** Get the current payload encryption mode. */
export function getEncryptionMode(): 'disabled' | 'permissive' | 'enforce' {
  return env.PAYLOAD_ENCRYPTION_MODE;
}

/** Check if a route requires encryption based on mode. */
export function requiresEncryption(mode: string, pathname: string): boolean {
  if (mode === 'disabled') return false;
  if (mode === 'permissive' || mode === 'enforce') {
    return isPiiRoute(pathname);
  }
  return false;
}

/** Check if replay cache is available. */
export async function isReplayCacheAvailable(): Promise<boolean> {
  try {
    const cache = getReplayCache();
    return await cache.healthCheck();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Replay cache health status (cached to avoid per-request PING)
// ---------------------------------------------------------------------------

let _healthStatus: { available: boolean; updatedAt: number } | null = null;
const HEALTH_STATUS_TTL_MS = 10_000; // cache health status for 10 seconds

/**
 * Check replay cache availability with short-lived caching.
 * Avoids issuing a Redis PING on every mutating request.
 */
async function getCachedReplayCacheHealth(): Promise<boolean> {
  if (_healthStatus && Date.now() - _healthStatus.updatedAt < HEALTH_STATUS_TTL_MS) {
    return _healthStatus.available;
  }

  const available = await isReplayCacheAvailable();
  _healthStatus = { available, updatedAt: Date.now() };

  // Warn once if enforce mode is active without replay cache requirement.
  if (available === false && env.PAYLOAD_ENCRYPTION_MODE === 'enforce') {
    logger.warn(
      { backend: getReplayCacheBackend() },
      'Enforce mode active but replay cache is unavailable — requests will fail closed',
    );
  }

  return available;
}

// ---------------------------------------------------------------------------
// Session extraction
// ---------------------------------------------------------------------------

/**
 * Extract and validate the BetterAuth session from the request.
 */
export async function extractSession(
  request: NextRequest,
): Promise<{ sessionId: string; userId: string } | null> {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) return null;

    // Extract session ID from the BetterAuth session object
    const sessionId = (session.session as { id?: string }).id || '';
    const userId = (session.user as { id?: string }).id || '';

    if (!sessionId || !userId) return null;

    return { sessionId, userId };
  } catch (error) {
    logger.error({ err: error }, 'Failed to extract session');
    return null;
  }
}

// ---------------------------------------------------------------------------
// Payload header validation
// ---------------------------------------------------------------------------

/**
 * Validate payload encryption headers from a request.
 */
export function validatePayloadHeaders(request: NextRequest): {
  valid: boolean;
  version?: string;
  keyId?: string;
  timestamp?: number;
  nonce?: string;
  error?: string;
} {
  const version = request.headers.get(HEADER_PAYLOAD_ENCRYPTION);
  const keyId = request.headers.get(HEADER_PAYLOAD_KEY_ID);
  const timestampStr = request.headers.get(HEADER_PAYLOAD_TIMESTAMP);
  const nonce = request.headers.get(HEADER_PAYLOAD_NONCE);

  // Check version
  if (!version || !validatePayloadVersion(version)) {
    return { valid: false, error: ERROR_CODES.UNSUPPORTED_PAYLOAD_VERSION };
  }

  // Check key ID using shared validator (issue #13)
  if (!keyId || !validateKeyId(keyId)) {
    return { valid: false, error: ERROR_CODES.INVALID_KEY_ID };
  }

  // Check timestamp
  if (!timestampStr) {
    return { valid: false, error: ERROR_CODES.STALE_TIMESTAMP };
  }

  const timestamp = Number(timestampStr);
  if (isNaN(timestamp)) {
    return { valid: false, error: ERROR_CODES.STALE_TIMESTAMP };
  }

  // Check nonce format using shared validator (issue #6)
  if (!nonce || !validateNonceFormat(nonce)) {
    return { valid: false, error: ERROR_CODES.INVALID_ENCRYPTED_PAYLOAD };
  }

  return { valid: true, version, keyId, timestamp, nonce };
}

// ---------------------------------------------------------------------------
// Replay protection
// ---------------------------------------------------------------------------

/**
 * Check and record a request nonce for replay protection.
 * Uses the configured replay cache backend (Redis or memory).
 *
 * The Redis implementation uses atomic SET NX to prevent race conditions.
 */
export async function checkReplayProtection(
  sessionId: string,
  nonce: string,
): Promise<{ valid: boolean; error?: string }> {
  try {
    const cache = getReplayCache();

    // RedisReplayCache.isReplay uses atomic SET NX — it both checks and records.
    // MemoryReplayCache.isReplay does the same in-memory.
    const isReplay = await cache.isReplay(sessionId, nonce);
    if (isReplay) {
      logger.warn({ sessionId, nonce }, 'Replay detected');
      incrementMetric('replayDetections');
      return { valid: false, error: ERROR_CODES.REPLAY_DETECTED };
    }

    // If the cache is available and we got here, the nonce was recorded atomically.
    return { valid: true };
  } catch (error) {
    logger.error({ err: error, sessionId }, 'Replay protection check failed');
    // Fail open in permissive mode — allow request but log error.
    return { valid: true };
  }
}

/**
 * Check replay protection with fail-closed support for enforce mode.
 *
 * In enforce mode with PAYLOAD_ENCRYPTION_REQUIRE_REPLAY_CACHE=true:
 * - If replay cache is unavailable, returns 503 replay_cache_unavailable
 * - This prevents requests from being processed without replay protection
 */
export async function checkReplayProtectionStrict(
  sessionId: string,
  nonce: string,
): Promise<{ valid: boolean; error?: string }> {
  const result = await checkReplayProtection(sessionId, nonce);
  if (!result.valid) {
    return result;
  }

  // If require_replay_cache is true, verify cache health before allowing request.
  if (env.PAYLOAD_ENCRYPTION_REQUIRE_REPLAY_CACHE === 'true') {
    const available = await getCachedReplayCacheHealth();
    if (!available) {
      incrementMetric('replayCacheUnavailable');
      logger.error(
        { backend: getReplayCacheBackend() },
        'Replay cache unavailable in enforce mode with require_replay_cache=true',
      );
      return { valid: false, error: ERROR_CODES.REPLAY_CACHE_UNAVAILABLE };
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Validate payload key (upfront, reused for both decrypt and encrypt)
// ---------------------------------------------------------------------------

/**
 * Validate the payload key and return decoded key bytes.
 * Returns specific error codes for each failure mode (issue #2).
 */
async function validatePayloadKey(
  keyId: string,
  sessionId: string,
): Promise<{ valid: true; keyBytes: Uint8Array; keyId: string } | { valid: false; error: string }> {
  const keyResult = await getValidPayloadKey(keyId, sessionId);

  if (!keyResult.valid) {
    // Propagate the specific error code (issue #2).
    const err = keyResult.error;
    if (err === ERROR_CODES.PAYLOAD_KEY_EXPIRED) {
      incrementMetric('expiredKeys');
    } else if (err === ERROR_CODES.PAYLOAD_KEY_UNKNOWN) {
      incrementMetric('unknownKeyIds');
    } else if (err === ERROR_CODES.INVALID_KEY_ID) {
      incrementMetric('unknownKeyIds');
    }
    return { valid: false, error: err };
  }

  // Decode key material inside try/catch (issue #8).
  let keyBytes: Uint8Array;
  try {
    keyBytes = decodeBase64url(keyResult.key.keyMaterial);
  } catch {
    logger.error({ keyId }, 'Malformed key material in store');
    return { valid: false, error: ERROR_CODES.INVALID_ENCRYPTED_PAYLOAD };
  }

  if (keyBytes.length !== 32) {
    logger.error({ keyId, length: keyBytes.length }, 'Key material wrong size');
    return { valid: false, error: ERROR_CODES.INVALID_ENCRYPTED_PAYLOAD };
  }

  return { valid: true, keyId, keyBytes };
}

// ---------------------------------------------------------------------------
// Request body decryption (reuses validated key bytes)
// ---------------------------------------------------------------------------

/**
 * Read and decrypt the request body using already-validated key bytes.
 */
async function decryptRequestBodyWithKey(
  request: NextRequest,
  validatedKey: ValidatedKey,
): Promise<{ body: unknown; error?: string }> {
  // Read raw body as bytes.
  const bodyBuffer = await request.arrayBuffer();
  const bodyBytes = new Uint8Array(bodyBuffer);

  // Check payload size limit.
  if (bodyBytes.length > env.PAYLOAD_ENCRYPTION_MAX_BYTES) {
    incrementMetric('payloadTooLarge');
    return { body: null, error: ERROR_CODES.PAYLOAD_TOO_LARGE };
  }

  // Reject empty payloads.
  if (bodyBytes.length === 0) {
    return { body: null, error: ERROR_CODES.INVALID_ENCRYPTED_PAYLOAD };
  }

  // Validate minimum length.
  if (!validatePayloadLength(bodyBytes)) {
    return { body: null, error: ERROR_CODES.INVALID_ENCRYPTED_PAYLOAD };
  }

  // Build request AAD using shared helper.
  const method = request.method.toUpperCase();
  const pathname = new URL(request.url).pathname;
  const timestampStr = request.headers.get(HEADER_PAYLOAD_TIMESTAMP) || '0';
  const nonce = request.headers.get(HEADER_PAYLOAD_NONCE) || '';

  const aadBytes = buildRequestAad(
    validatedKey.keyId,
    '', // sessionId not needed for AAD — key is already session-bound.
    method,
    pathname,
    timestampStr,
    nonce,
  );

  try {
    const decrypted = decryptWithAad(validatedKey.keyBytes, bodyBytes, { aad: aadBytes });
    const parsed = JSON.parse(decrypted);
    return { body: parsed };
  } catch (error) {
    logger.warn({ err: error, keyId: validatedKey.keyId }, 'Payload decryption failed');
    incrementMetric('decryptionFailures');
    return { body: null, error: ERROR_CODES.INVALID_ENCRYPTED_PAYLOAD };
  }
}

// ---------------------------------------------------------------------------
// Response body encryption (reuses validated key bytes)
// ---------------------------------------------------------------------------

/**
 * Encrypt a response body for PII routes using already-validated key bytes.
 */
async function encryptResponseBodyWithKey(
  responseBody: unknown,
  validatedKey: ValidatedKey,
  request: NextRequest,
): Promise<{ encryptedBytes: Uint8Array; error?: string }> {
  // Serialize response to JSON inside try/catch (issue #9).
  let jsonStr: string;
  try {
    jsonStr = JSON.stringify(responseBody);
  } catch {
    logger.error({ err: new Error('Response JSON serialization failed') }, 'Failed to serialize response body');
    incrementMetric('responseEncryptionFailures');
    return { encryptedBytes: new Uint8Array(0), error: ERROR_CODES.INVALID_ENCRYPTED_PAYLOAD };
  }

  const plaintextBytes = new TextEncoder().encode(jsonStr);

  // Build response AAD using shared helper.
  const method = request.method.toUpperCase();
  const pathname = new URL(request.url).pathname;
  const nonceHeader = request.headers.get(HEADER_PAYLOAD_NONCE) || '';

  const aadBytes = buildResponseAad(
    validatedKey.keyId,
    '', // sessionId not needed for AAD — key is already session-bound.
    method,
    pathname,
    nonceHeader,
  );

  try {
    const { encrypted } = encryptWithAad(validatedKey.keyBytes, plaintextBytes, aadBytes);
    return { encryptedBytes: encrypted };
  } catch (error) {
    logger.error({ err: error }, 'Response encryption failed');
    incrementMetric('responseEncryptionFailures');
    return { encryptedBytes: new Uint8Array(0), error: ERROR_CODES.INVALID_ENCRYPTED_PAYLOAD };
  }
}

// ---------------------------------------------------------------------------
// Route param extraction
// ---------------------------------------------------------------------------

/**
 * Extract route params from the URL pathname.
 * Matches patterns like /api/admin/organizations/:orgId/members
 * Returns { orgId: '...' } or empty object.
 */
export function extractRouteParams(pathname: string): PiiRouteParams {
  const parts = pathname.split('/').filter(Boolean);
  // /api/admin/organizations/{orgId}/members -> parts[2]=organizations, parts[3]={orgId}, parts[4]=members
  // /api/admin/organizations/{orgId}/members/{memberId} -> parts[4]=members, parts[5]={memberId}
  // /api/admin/organizations/{orgId}/status -> parts[4]=status
  // /api/admin/organizations/{orgId}/settings -> parts[4]=settings
  const params: PiiRouteParams = {};

  if (parts.length >= 4 && parts[2] === 'organizations') {
    params.orgId = parts[3];
  }
  if (parts.length >= 6 && parts[2] === 'organizations' && parts[4] === 'members') {
    params.memberId = parts[5];
  }

  return params;
}

// ---------------------------------------------------------------------------
// Route wrapper factory
// ---------------------------------------------------------------------------

/**
 * Options for wrapPiiRoute.
 */
export interface WrapPiiRouteOptions {
  /**
   * If true, skip encryption for unauthenticated requests.
   * The handler will still receive null session and can return
   * a non-PII response (e.g., empty array for user-permissions).
   */
  skipEncryptionForUnauthenticated?: boolean;
}

/**
 * Wrap a PII route handler with encryption/decryption logic.
 */
export function wrapPiiRoute(
  handler: PiiRouteHandler,
  options?: WrapPiiRouteOptions,
) {
  return async (request: NextRequest, context?: any): Promise<Response> => {
    const mode = getEncryptionMode();
    const pathname = new URL(request.url).pathname;

    // Extract route params: prefer Next.js context.params (respects basePath, locales),
    // fall back to URL parsing for backward compatibility.
    let routeParams: PiiRouteParams = {};
    if (context?.params) {
      routeParams = await context.params;
    } else {
      routeParams = extractRouteParams(pathname);
    }

    // Handle OPTIONS preflight requests — pass through without encryption.
    if (request.method === 'OPTIONS') {
      return handler(request, null, routeParams);
    }

    // If encryption is disabled, pass through (but still provide params).
    if (mode === 'disabled') {
      return handler(request, null, routeParams);
    }

    // Extract session.
    const session = await extractSession(request);
    if (!session) {
      // For routes that handle unauthenticated requests (e.g., user-permissions),
      // pass through to the handler which can return a non-PII response.
      if (options?.skipEncryptionForUnauthenticated) {
        return handler(request, null, routeParams);
      }
      // Use shared error code (issue #30).
      return NextResponse.json(
        { error: ERROR_CODES.UNAUTHORIZED },
        { status: 401, headers: { 'Cache-Control': 'no-store', 'Pragma': 'no-cache' } },
      );
    }

    // Check if this is a PII route.
    const needsEncryption = requiresEncryption(mode, pathname);

    if (needsEncryption) {
      incrementMetric('encryptedRequestCount');
    }

    if (!needsEncryption) {
      return handler(request, null, routeParams);
    }

    // -----------------------------------------------------------------------
    // PII route — validate payload headers.
    // -----------------------------------------------------------------------

    const headerValidation = validatePayloadHeaders(request);
    if (!headerValidation.valid) {
      // In permissive mode, accept plaintext JSON for migration.
      if (mode === 'permissive') {
        // Read the body to enforce max size regardless of Content-Length (issue #5).
        let decryptedBody: unknown | null = null;
        try {
          const text = await request.text();

          // Enforce max payload size by reading the body (issue #5).
          const encoder = new TextEncoder();
          if (encoder.encode(text).length > env.PAYLOAD_ENCRYPTION_MAX_BYTES) {
            return NextResponse.json(
              { error: ERROR_CODES.PAYLOAD_TOO_LARGE },
              { status: 413, headers: { 'Cache-Control': 'no-store', 'Pragma': 'no-cache' } },
            );
          }

          if (text) decryptedBody = JSON.parse(text);
        } catch {
          // Not valid JSON — proceed with null body.
        }

        incrementMetric('plaintextPermissive');
        logger.warn({ pathname, error: headerValidation.error }, 'Permissive mode: plaintext PII request');
        return handler(request, decryptedBody);
      }

      // In enforce mode, reject with appropriate error and no-store headers (issue #14).
      const statusMap: Record<string, number> = {
        [ERROR_CODES.UNSUPPORTED_PAYLOAD_VERSION]: 400,
        [ERROR_CODES.MISSING_PAYLOAD_KEY_ID]: 400,
        [ERROR_CODES.INVALID_KEY_ID]: 400,
        [ERROR_CODES.STALE_TIMESTAMP]: 400,
        [ERROR_CODES.INVALID_ENCRYPTED_PAYLOAD]: 400,
      };

      return NextResponse.json(
        { error: headerValidation.error || ERROR_CODES.INVALID_ENCRYPTED_PAYLOAD },
        { status: statusMap[headerValidation.error || ''] || 400, headers: { 'Cache-Control': 'no-store', 'Pragma': 'no-cache' } },
      );
    }

    // -----------------------------------------------------------------------
    // Validate timestamp window.
    // -----------------------------------------------------------------------

    if (headerValidation.timestamp) {
      const tsResult = validateTimestamp(headerValidation.timestamp, env.PAYLOAD_ENCRYPTION_REPLAY_WINDOW_SECONDS);
      if (!tsResult.valid) {
        incrementMetric('staleTimestamps');
        return NextResponse.json(
          { error: ERROR_CODES.STALE_TIMESTAMP },
          { status: 400, headers: { 'Cache-Control': 'no-store', 'Pragma': 'no-cache' } },
        );
      }
    }

    // -----------------------------------------------------------------------
    // Check replay protection (only for non-GET requests).
    // -----------------------------------------------------------------------

    if (request.method !== 'GET' && headerValidation.nonce) {
      const replayResult = await checkReplayProtectionStrict(session.sessionId, headerValidation.nonce);
      if (!replayResult.valid) {
        return NextResponse.json(
          { error: replayResult.error || ERROR_CODES.REPLAY_DETECTED },
          { status: replayResult.error === ERROR_CODES.REPLAY_CACHE_UNAVAILABLE ? 503 : 409, headers: { 'Cache-Control': 'no-store', 'Pragma': 'no-cache' } },
        );
      }
    }

    // -----------------------------------------------------------------------
    // Validate payload key upfront for ALL PII routes (issues #1, #7).
    // This ensures GET/DELETE/bodyless requests also have a valid key before
    // the handler runs, preventing plaintext PII leakage on encryption failure.
    // -----------------------------------------------------------------------

    const keyValidation = await validatePayloadKey(headerValidation.keyId!, session.sessionId);
    if (!keyValidation.valid) {
      // Map specific error codes to HTTP status (issue #2).
      const keyStatusMap: Record<string, number> = {
        [ERROR_CODES.PAYLOAD_KEY_EXPIRED]: 401,
        [ERROR_CODES.PAYLOAD_KEY_UNKNOWN]: 401,
        [ERROR_CODES.INVALID_KEY_ID]: 400,
      };

      return NextResponse.json(
        { error: keyValidation.error },
        { status: keyStatusMap[keyValidation.error] || 401, headers: { 'Cache-Control': 'no-store', 'Pragma': 'no-cache' } },
      );
    }

    // -----------------------------------------------------------------------
    // Execute the handler with decrypted body (if any).
    // -----------------------------------------------------------------------

    let decryptedBody: unknown | null = null;

    if (request.method !== 'GET' && request.method !== 'DELETE') {
      const contentType = request.headers.get('Content-Type') || '';

      if (contentType.includes('application/octet-stream')) {
        const decryption = await decryptRequestBodyWithKey(request, keyValidation);

        if (decryption.error) {
          const statusMap: Record<string, number> = {
            [ERROR_CODES.PAYLOAD_TOO_LARGE]: 413,
            [ERROR_CODES.INVALID_ENCRYPTED_PAYLOAD]: 400,
          };

          return NextResponse.json(
            { error: decryption.error },
            { status: statusMap[decryption.error] || 400, headers: { 'Cache-Control': 'no-store', 'Pragma': 'no-cache' } },
          );
        }

        decryptedBody = decryption.body;
      } else if (mode === 'enforce') {
        // Enforce mode: reject non-encrypted bodies for PII routes.
        incrementMetric('decryptionFailures');
        return NextResponse.json(
          { error: ERROR_CODES.UNSUPPORTED_MEDIA_TYPE },
          { status: 415, headers: { 'Cache-Control': 'no-store', 'Pragma': 'no-cache' } },
        );
      } else if (mode === 'permissive') {
        // Permissive mode: try to parse as JSON.
        try {
          const text = await request.text();
          if (text) decryptedBody = JSON.parse(text);
        } catch {
          // Not valid JSON — proceed with null body.
        }
      }
    }

    // Execute the handler with decrypted body and route params.
    const response = await handler(request, decryptedBody, routeParams);

    // -----------------------------------------------------------------------
    // Handle 204 No Content — no body to encrypt.
    // -----------------------------------------------------------------------

    if (response.status === 204) {
      const res = new NextResponse(null, {
        status: 204,
        headers: response.headers,
      });
      res.headers.set('Cache-Control', 'no-store');
      res.headers.set('Pragma', 'no-cache');
      return res;
    }

    // -----------------------------------------------------------------------
    // Encrypt successful PII responses (not errors).
    // -----------------------------------------------------------------------

    if (response.ok && response.status !== 204) {
      const responseContentType = response.headers.get('Content-Type') || '';

      // Only encrypt JSON responses.
      if (responseContentType.includes('application/json')) {
        let responseText = '';
        try {
          responseText = await response.text();

          let responseBody: unknown;

          try {
            responseBody = JSON.parse(responseText);
          } catch {
            // Not valid JSON — return the consumed text as a new response.
            const fallback = new Response(responseText, {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
            });
            fallback.headers.set('Cache-Control', 'no-store');
            fallback.headers.set('Pragma', 'no-cache');
            return fallback;
          }

          incrementMetric('encryptedResponseCount');

          const encryption = await encryptResponseBodyWithKey(responseBody, keyValidation, request);

          if (encryption.error) {
            // In enforce mode: never return plaintext on encryption failure (issue #1).
            if (mode === 'enforce') {
              logger.error({ err: encryption.error }, 'Response encryption failed in enforce mode');
              return NextResponse.json(
                { error: ERROR_CODES.INVALID_ENCRYPTED_PAYLOAD },
                { status: 503, headers: { 'Cache-Control': 'no-store', 'Pragma': 'no-cache' } },
              );
            }

            // In permissive mode, return plaintext with no-store headers.
            logger.warn({ err: encryption.error }, 'Response encryption failed, returning unencrypted');
            const fallback = new Response(responseText, {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
            });
            fallback.headers.set('Cache-Control', 'no-store');
            fallback.headers.set('Pragma', 'no-cache');
            return fallback;
          }

          // Return encrypted response with proper headers.
          const encryptedResponse = new Response(
            encryption.encryptedBytes.buffer as ArrayBuffer,
            {
              status: response.status,
              statusText: response.statusText,
              headers: {
                'Content-Type': 'application/octet-stream',
                'Cache-Control': 'no-store',
                'Pragma': 'no-cache',
              },
            },
          );

          return encryptedResponse;
        } catch {
          // Encryption failed — in enforce mode, never return plaintext (issue #1).
          if (mode === 'enforce') {
            logger.error({ err: new Error('Response encryption pipeline failed') }, 'Failed to encrypt response');
            return NextResponse.json(
              { error: ERROR_CODES.INVALID_ENCRYPTED_PAYLOAD },
              { status: 503, headers: { 'Cache-Control': 'no-store', 'Pragma': 'no-cache' } },
            );
          }

          // In permissive mode, return plaintext with no-store headers.
          const fallback = new Response(responseText, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
          fallback.headers.set('Cache-Control', 'no-store');
          fallback.headers.set('Pragma', 'no-cache');
          return fallback;
        }
      }

      // Non-JSON successful responses: add no-store headers (issue #14).
      const res = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
      res.headers.set('Cache-Control', 'no-store');
      res.headers.set('Pragma', 'no-cache');
      return res;
    }

    // -----------------------------------------------------------------------
    // Error responses: add no-store headers (issue #14).
    // -----------------------------------------------------------------------

    const errorRes = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
    errorRes.headers.set('Cache-Control', 'no-store');
    errorRes.headers.set('Pragma', 'no-cache');

    return errorRes;
  };
}
