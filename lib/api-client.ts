/**
 * Encrypted fetch wrapper for PII API calls.
 *
 * Provides `encryptedFetch` — a drop-in replacement for `fetch` that:
 * - Encrypts request bodies for PII routes (POST/PUT/PATCH)
 * - Decrypts response bodies for PII routes (GET/POST/PUT/PATCH/DELETE)
 * - Adds required payload encryption headers
 * - Handles stale-key retry (one automatic refresh + retry)
 * - Preserves error responses unmodified
 * - Handles 204 No Content
 */

import { getPayloadKey, refreshPayloadKey } from './payload-key-manager';
import { encryptWithAad, decryptWithAad } from './crypto-client';
import {
  HEADER_PAYLOAD_ENCRYPTION,
  HEADER_PAYLOAD_KEY_ID,
  HEADER_PAYLOAD_TIMESTAMP,
  HEADER_PAYLOAD_NONCE,
  PAYLOAD_ENCRYPTION_VERSION,
  ERROR_CODES,
  buildRequestAad,
  buildResponseAad,
} from './payload-format';
import { isPiiRoute } from './pii-routes';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EncryptedFetchOptions extends RequestInit {
  /** Explicit opt-in for PII encryption. Must be true to encrypt/decrypt. */
  pii?: boolean;
}

// ---------------------------------------------------------------------------
// AAD builders
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a random base64url nonce string. */
function generateRequestNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Check if a body type is unsupported for encryption. */
function isUnsupportedBodyType(body: unknown): boolean {
  if (body == null) return false;

  // These types cannot be encrypted in v1
  if (body instanceof FormData) return true;
  if (body instanceof Blob) return true;
  if (body instanceof ReadableStream) return true;
  if (body instanceof URLSearchParams) return true;
  if (body instanceof ArrayBuffer) return true;
  if (typeof SharedArrayBuffer !== 'undefined' && body instanceof SharedArrayBuffer) return true;

  return false;
}

/** Serialize a JSON-serializable body to Uint8Array. */
function serializeBody(body: unknown): Uint8Array {
  // Callers may pass an object or a pre-stringified JSON string.
  if (typeof body === 'string') return encoder.encode(body);
  return encoder.encode(JSON.stringify(body));
}

// ---------------------------------------------------------------------------
// Main encrypted fetch
// ---------------------------------------------------------------------------

/**
 * Fetch with application-layer payload encryption for PII routes.
 *
 * @param url - Request URL (string or URL)
 * @param options - Fetch options with optional `pii: true` flag
 * @returns Response (decrypted for PII routes)
 */
export async function encryptedFetch(
  url: string | URL | Request,
  options: EncryptedFetchOptions = {},
): Promise<Response> {
  const { pii = false, ...fetchOptions } = options;

  // If not a PII request, use normal fetch
  if (!pii) {
    return fetch(url, fetchOptions);
  }

  const request = new Request(url, fetchOptions);
  const urlObj = new URL(request.url);
  const pathname = urlObj.pathname;

  // Only apply encryption to known PII routes
  if (!isPiiRoute(pathname)) {
    return fetch(request);
  }

  // Check for unsupported body types
  if (isUnsupportedBodyType(fetchOptions.body)) {
    throw new Error(
      'Payload encryption does not support FormData, Blob, ReadableStream, URLSearchParams, or ArrayBuffer bodies in v1',
    );
  }

  // Handle empty body / 204 cases for GET requests
  const hasBody = fetchOptions.body != null && fetchOptions.body !== '';

  // Get payload key
  let keyData;
  try {
    keyData = await getPayloadKey();
  } catch (err) {
    throw new Error('Failed to obtain payload encryption key', { cause: err });
  }

  let timestamp = Math.floor(Date.now() / 1000);
  let requestNonce = generateRequestNonce();

  // Build modified fetch options
  const modifiedOptions: RequestInit = { ...fetchOptions };

  // Encrypt request body if present
  if (hasBody) {
    const plaintext = serializeBody(fetchOptions.body);
    // sessionId is empty string on the server side (key is already session-bound)
    const aad = buildRequestAad(
      keyData.keyId,
      '',
      request.method,
      pathname,
      String(timestamp),
      requestNonce,
    );

    const { encrypted } = await encryptWithAad(keyData.cryptoKey, plaintext, aad);

    modifiedOptions.body = new Uint8Array(encrypted.buffer as ArrayBuffer, encrypted.byteOffset, encrypted.byteLength);
    modifiedOptions.headers = {
      ...(modifiedOptions.headers as Record<string, string> || {}),
      'Content-Type': 'application/octet-stream',
    };
    // Delete any caller-provided Content-Length to prevent mismatched length errors.
    delete (modifiedOptions.headers as Record<string, string>)['Content-Length'];
  }

  // Add payload encryption headers
  modifiedOptions.headers = {
    ...(modifiedOptions.headers as Record<string, string> || {}),
    [HEADER_PAYLOAD_ENCRYPTION]: PAYLOAD_ENCRYPTION_VERSION,
    [HEADER_PAYLOAD_KEY_ID]: keyData.keyId,
    [HEADER_PAYLOAD_TIMESTAMP]: String(timestamp),
    [HEADER_PAYLOAD_NONCE]: requestNonce,
  };

  // Make the request
  let response = await fetch(new Request(urlObj, modifiedOptions));

  // Detect server-side encryption disabled: if the response is plaintext JSON
  // (not octet-stream), the server isn't expecting encrypted payloads. Retry
  // with plaintext body so PII routes work when PAYLOAD_ENCRYPTION_MODE=disabled.
  if (!response.ok) {
    const respContentType = response.headers.get('Content-Type') || '';
    if (respContentType.includes('application/json')) {
      // Server returned plaintext JSON — it's not encrypting. Retry with
      // the original (plaintext) body.
      const retryOptions: RequestInit = { ...fetchOptions };
      if (hasBody) {
        retryOptions.body = fetchOptions.body;
      }
      response = await fetch(new Request(urlObj, retryOptions));
    }
  }

  // Handle stale key errors — retry once after refresh
  if (response.status === 401) {
    // Clone before consuming so we can return it if retry fails.
    const cloned401 = response.clone();
    const contentType = response.headers.get('Content-Type') || '';
    if (contentType.includes('application/json')) {
      const body = await response.json();
      if (body.error === ERROR_CODES.PAYLOAD_KEY_EXPIRED || body.error === ERROR_CODES.PAYLOAD_KEY_UNKNOWN) {
        // Refresh key and retry once
        try {
          keyData = await refreshPayloadKey();

          // Re-encrypt body with new key if needed
          const retryOptions: RequestInit = { ...fetchOptions };

          // Generate fresh nonce and timestamp for the retry request.
          const retryTimestamp = Math.floor(Date.now() / 1000);
          const retryNonce = generateRequestNonce();

          if (hasBody) {
            const plaintext = serializeBody(fetchOptions.body);
            const aad = buildRequestAad(
              keyData.keyId,
              '',
              request.method,
              pathname,
              String(retryTimestamp),
              retryNonce,
            );

            const { encrypted } = await encryptWithAad(keyData.cryptoKey, plaintext, aad);
            retryOptions.body = new Uint8Array(encrypted.buffer as ArrayBuffer, encrypted.byteOffset, encrypted.byteLength);
            retryOptions.headers = {
              ...(retryOptions.headers as Record<string, string> || {}),
              'Content-Type': 'application/octet-stream',
            };
            delete (retryOptions.headers as Record<string, string>)['Content-Length'];
          }

          retryOptions.headers = {
            ...(retryOptions.headers as Record<string, string> || {}),
            [HEADER_PAYLOAD_ENCRYPTION]: PAYLOAD_ENCRYPTION_VERSION,
            [HEADER_PAYLOAD_KEY_ID]: keyData.keyId,
            [HEADER_PAYLOAD_TIMESTAMP]: String(retryTimestamp),
            [HEADER_PAYLOAD_NONCE]: retryNonce,
          };

          // Update the nonce/timestamp so response AAD matches the retry request.
          requestNonce = retryNonce;
          timestamp = retryTimestamp;

          response = await fetch(new Request(urlObj, retryOptions));

          // Log a warning if the retried response also failed.
          if (!response.ok) {
            console.warn(
              '[PayloadKey] Stale-key retry also failed (status:',
              response.status,
              ') — key refresh may not have propagated',
            );
          }
        } catch {
          // Retry failed — return the cloned 401 response (body still readable).
          console.warn('[PayloadKey] Stale-key retry threw an exception');
          return cloned401;
        }
      } else {
        // Non-stale-key 401 — return the cloned response whose body is still readable.
        return cloned401;
      }
    }
  }

  // Decrypt successful PII responses (not errors, not 204)
  if (response.ok && response.status !== 204) {
    const contentType = response.headers.get('Content-Type') || '';

    // Only decrypt if the server sent encrypted content
    if (contentType.includes('application/octet-stream')) {
      // Clone the response so we can return it if decryption fails.
      const clonedResponse = response.clone();

      try {
        const encryptedBytes = new Uint8Array(await response.arrayBuffer());

        // Build response AAD — sessionId is empty string on the server side
        // (key is already session-bound), so match that here.
        const aad = buildResponseAad(
          keyData.keyId,
          '',
          request.method,
          pathname,
          requestNonce,
        );

        const decrypted = await decryptWithAad(keyData.cryptoKey, encryptedBytes, { aad });
        const decryptedJson = JSON.parse(decrypted);

        // Return response with all original headers preserved, overriding only
        // Content-Type and Cache-Control.
        const newHeaders = new Headers(clonedResponse.headers);
        newHeaders.set('Content-Type', 'application/json');
        newHeaders.set('Cache-Control', 'no-store');

        return new Response(JSON.stringify(decryptedJson), {
          status: response.status,
          statusText: response.statusText,
          headers: newHeaders,
        });
      } catch {
        // Decryption failed — return the cloned response (body still readable).
        return clonedResponse;
      }
    }
  }

  return response;
}