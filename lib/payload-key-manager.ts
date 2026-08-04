/**
 * Client-side payload key manager.
 *
 * Manages fetching, caching (in-memory only), and refreshing of payload
 * encryption keys from the server. Keys are never persisted to cookies,
 * localStorage, sessionStorage, IndexedDB, or any other storage.
 */

import { importAesGcmKey } from './crypto-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PayloadKeyInfo {
  /** Key identifier */
  keyId: string;
  /** Algorithm identifier */
  algorithm: string;
  /** Unix timestamp (seconds) when the key expires */
  expiresAt: number;
}

export interface PayloadKeyData extends PayloadKeyInfo {
  /** CryptoKey for AES-GCM operations */
  cryptoKey: CryptoKey;
  /** Session ID bound to this key (used for AAD construction) */
  sessionId: string;
}

// ---------------------------------------------------------------------------
// Module-scoped state (in-memory only)
// ---------------------------------------------------------------------------

let cachedKey: PayloadKeyData | null = null;
let refreshPromise: Promise<PayloadKeyData> | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the current payload key, fetching a new one if necessary.
 */
export async function getPayloadKey(): Promise<PayloadKeyData> {
  // Return cached key if still valid (refresh 30s before expiry)
  if (cachedKey && cachedKey.expiresAt > Date.now() / 1000 + 30) {
    return cachedKey;
  }

  // If a refresh is already in progress, wait for it
  if (refreshPromise) {
    return refreshPromise;
  }

  // Start a new refresh
  refreshPromise = fetchAndCacheKey();
  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

/**
 * Force a refresh of the payload key.
 */
export async function refreshPayloadKey(): Promise<PayloadKeyData> {
  refreshPromise = fetchAndCacheKey();
  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

/**
 * Clear the in-memory payload key (e.g., on logout).
 */
export function clearPayloadKey(): void {
  cachedKey = null;
}

/**
 * Get the current key info without fetching (returns null if no cached key).
 */
export function getCachedKeyInfo(): PayloadKeyInfo | null {
  if (!cachedKey) return null;
  void cachedKey.cryptoKey; // cryptoKey is intentionally excluded from the info object
  return {
    keyId: cachedKey.keyId,
    algorithm: cachedKey.algorithm,
    expiresAt: cachedKey.expiresAt,
  };
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/**
 * Fetch a payload key from the server and cache it.
 */
async function fetchAndCacheKey(): Promise<PayloadKeyData> {
  const response = await fetch('/api/security/payload-key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch payload key: ${response.status} ${response.statusText}`);
  }

  // Prevent caching of the response body
  const cacheControl = response.headers.get('Cache-Control');
  if (cacheControl && !cacheControl.includes('no-store')) {
    console.warn('[PayloadKey] Payload key response missing Cache-Control: no-store');
  }

  const data = await response.json();

  // Validate presence of required fields
  if (!data.keyId || !data.algorithm || !data.expiresAt || !data.key) {
    throw new Error('Invalid payload key response from server');
  }

  // Validate types and formats to prevent subtle failures downstream.
  if (typeof data.expiresAt !== 'number' || typeof data.key !== 'string' || data.key.length === 0) {
    throw new Error('Invalid payload key response from server: unexpected field types');
  }

  // Treat a missing sessionId as an error — the server uses it for AAD construction,
  // so a default of '' would cause silent authentication failures on every request.
  if (!data.sessionId) {
    throw new Error('Payload key response missing sessionId');
  }

  // Import the key as non-extractable AES-GCM CryptoKey
  const cryptoKey = await importAesGcmKey(data.key, false);

  cachedKey = {
    keyId: data.keyId,
    algorithm: data.algorithm,
    expiresAt: data.expiresAt,
    cryptoKey,
    sessionId: data.sessionId,
  };

  return cachedKey;
}
