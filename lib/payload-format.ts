/**
 * Shared constants, binary helpers, and validation for payload encryption.
 *
 * This module defines the versioned binary wire format used by both server
 * and client for AES-256-GCM encrypted PII payloads.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Payload encryption protocol version header value. */
export const PAYLOAD_ENCRYPTION_VERSION = 'v1';

/** Number of bytes for the AES-GCM nonce. */
export const NONCE_BYTES = 12;

/** Number of bytes for the AES-GCM authentication tag. */
export const AUTH_TAG_BYTES = 16;

/** Minimum encrypted payload length: nonce + auth tag (zero-length ciphertext). */
export const MIN_ENCRYPTED_BYTES = NONCE_BYTES + AUTH_TAG_BYTES;

// ---------------------------------------------------------------------------
// Header names (constants for consistency)
// ---------------------------------------------------------------------------

export const HEADER_PAYLOAD_ENCRYPTION = 'X-Payload-Encryption';
export const HEADER_PAYLOAD_KEY_ID = 'X-Payload-Key-Id';
export const HEADER_PAYLOAD_TIMESTAMP = 'X-Payload-Timestamp';
export const HEADER_PAYLOAD_NONCE = 'X-Payload-Nonce';

// ---------------------------------------------------------------------------
// Error codes (machine-readable)
// ---------------------------------------------------------------------------

/** Error codes for payload encryption (machine-readable). */
export const ERROR_CODES = {
  UNAUTHORIZED: 'unauthorized',
  MISSING_PAYLOAD_KEY_ID: 'missing_payload_key_id',
  INVALID_KEY_ID: 'invalid_key_id',
  PAYLOAD_KEY_UNKNOWN: 'payload_key_unknown',
  PAYLOAD_KEY_EXPIRED: 'payload_key_expired',
  INVALID_ENCRYPTED_PAYLOAD: 'invalid_encrypted_payload',
  UNSUPPORTED_PAYLOAD_VERSION: 'unsupported_payload_version',
  PAYLOAD_TOO_LARGE: 'payload_too_large',
  UNSUPPORTED_MEDIA_TYPE: 'unsupported_media_type',
  STALE_TIMESTAMP: 'stale_timestamp',
  REPLAY_DETECTED: 'replay_detected',
  REPLAY_CACHE_UNAVAILABLE: 'replay_cache_unavailable',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

// ---------------------------------------------------------------------------
// Base64url helpers (RFC 4648 §5) — server-safe with Buffer fallback
// ---------------------------------------------------------------------------

/** Encode a Uint8Array as base64url (no padding). */
export function encodeBase64url(data: Uint8Array): string {
  // Use Buffer on Node.js for efficiency; fall back to btoa in browsers.
  if (typeof Buffer !== 'undefined' && Buffer.from) {
    return Buffer.from(data).toString('base64url');
  }

  // Browser fallback: chunk to avoid call stack overflow.
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < data.length; i += chunkSize) {
    const chunk = data.subarray(i, Math.min(i + chunkSize, data.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decode a base64url string (with or without padding) to Uint8Array. */
export function decodeBase64url(input: string): Uint8Array {
  // Use Buffer on Node.js for efficiency; fall back to atob in browsers.
  if (typeof Buffer !== 'undefined' && Buffer.from) {
    // base64url is not a native encoding in older Node, so we normalize first.
    const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }

  // Browser fallback.
  let base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (base64.length % 4)) % 4;
  base64 += '='.repeat(padLength);

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Binary helpers
// ---------------------------------------------------------------------------

/** Concatenate multiple Uint8Arrays into one. */
export function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/** Validate that an encrypted payload meets the minimum length requirement. */
export function validatePayloadLength(payload: Uint8Array): boolean {
  return payload.length >= MIN_ENCRYPTED_BYTES;
}

/** Validate that a payload version header is supported. */
export function validatePayloadVersion(version: string): boolean {
  return version === PAYLOAD_ENCRYPTION_VERSION;
}

/** Validate that a timestamp is within the allowed window (in seconds). */
export function validateTimestamp(
  timestamp: number,
  maxAgeSeconds: number,
): { valid: boolean; reason?: string } {
  const now = Date.now() / 1000;
  // Allow a small future skew (5 seconds) but reject anything beyond the window
  const maxFuture = 5;
  if (timestamp > now + maxFuture) {
    return { valid: false, reason: 'stale_timestamp' };
  }
  const age = now - timestamp;
  if (age > maxAgeSeconds) {
    return { valid: false, reason: 'stale_timestamp' };
  }
  return { valid: true };
}

/** Validate that a nonce is unique base64url-encoded string. */
export function validateNonceFormat(nonce: string): boolean {
  // At least 128 bits of randomness → ~22 base64url characters
  return /^[A-Za-z0-9_-]{22,}$/.test(nonce);
}

// ---------------------------------------------------------------------------
// AAD builders (shared between server and client)
// ---------------------------------------------------------------------------

/** Canonical separator for AAD fields. */
const AAD_SEPARATOR = '\x00';

/**
 * Build a canonical request AAD string.
 *
 * Fields: version, purpose ('request'), method, pathname, keyId, sessionId,
 *         timestamp, requestNonce
 *
 * The fields are joined with a null byte separator to prevent accidental
 * divergence between client and server implementations.
 */
export function buildRequestAad(
  keyId: string,
  sessionId: string,
  method: string,
  pathname: string,
  timestamp: string,
  nonce: string,
): Uint8Array {
  const parts = [
    PAYLOAD_ENCRYPTION_VERSION,
    'request',
    method.toUpperCase(),
    pathname,
    keyId,
    sessionId,
    timestamp,
    nonce,
  ];
  return new TextEncoder().encode(parts.join(AAD_SEPARATOR));
}

/**
 * Build a canonical response AAD string.
 *
 * Fields: version, purpose ('response'), method, pathname, keyId, sessionId,
 *         requestNonce
 *
 * Response AAD does not include the timestamp to keep it stable across
 * retries of the same request.
 */
export function buildResponseAad(
  keyId: string,
  sessionId: string,
  method: string,
  pathname: string,
  nonce: string,
): Uint8Array {
  const parts = [
    PAYLOAD_ENCRYPTION_VERSION,
    'response',
    method.toUpperCase(),
    pathname,
    keyId,
    sessionId,
    nonce,
  ];
  return new TextEncoder().encode(parts.join(AAD_SEPARATOR));
}

/** Validate that a key ID is non-empty and well-formed. */
export function validateKeyId(keyId: string): boolean {
  return keyId.length > 0 && /^[A-Za-z0-9_-]{1,64}$/.test(keyId);
}
