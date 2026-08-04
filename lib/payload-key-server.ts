/**
 * Server-side payload key management.
 *
 * Handles generation, validation, and revocation of short-lived AES-256-GCM
 * payload encryption keys. Keys are bound to sessions and have explicit TTLs.
 */

import { randomBytes } from 'crypto';
import { encodeBase64url, validateKeyId, ERROR_CODES } from './payload-format';
import { generateKey } from './crypto-server';
import { env } from './env';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PayloadKey {
  /** Unique key identifier */
  keyId: string;
  /** Session ID this key is bound to */
  sessionId: string;
  /** Unix timestamp (seconds) when the key expires */
  expiresAt: number;
  /** Algorithm identifier */
  algorithm: string;
  /** Raw key material as base64url-encoded bytes */
  keyMaterial: string;
}

/** Result of a key lookup that distinguishes unknown from expired. */
export interface PayloadKeyLookup {
  /** The key object if found (may be expired). */
  key: PayloadKey | null;
  /** Why the lookup failed, if applicable. */
  reason?: 'unknown' | 'expired';
}

export interface PayloadKeyStore {
  /** Store or update a payload key. */
  put(key: PayloadKey): Promise<void>;
  /** Retrieve a payload key by ID and session. Returns null if not found or expired. */
  get(keyId: string, sessionId: string): Promise<PayloadKey | null>;
  /** Lookup a key without deleting expired entries. Distinguishes unknown vs expired. */
  lookup(keyId: string, sessionId: string): Promise<PayloadKeyLookup>;
  /** Revoke all keys for a session. */
  revokeForSession(sessionId: string): Promise<void>;
  /** Remove expired entries. Returns count removed. */
  cleanup?(): Promise<number>;
}

// ---------------------------------------------------------------------------
// In-memory store (default)
// ---------------------------------------------------------------------------

class InMemoryPayloadKeyStore implements PayloadKeyStore {
  private entries = new Map<string, PayloadKey>();

  async put(key: PayloadKey): Promise<void> {
    // Enforce max active keys per session — count only non-expired entries.
    const maxKeysPerSession = env.PAYLOAD_ENCRYPTION_MAX_KEYS_PER_SESSION;
    const now = Date.now() / 1000;

    // First, clean up expired entries for this session.
    let sessionActiveCount = 0;
    const expiredKeys: string[] = [];
    for (const [kid, k] of this.entries.entries()) {
      if (k.sessionId === key.sessionId) {
        if (now <= k.expiresAt) {
          sessionActiveCount++;
        } else {
          expiredKeys.push(kid);
        }
      }
    }

    // Remove expired entries.
    for (const kid of expiredKeys) {
      this.entries.delete(kid);
    }

    if (sessionActiveCount >= maxKeysPerSession) {
      // Evict the oldest active key for this session to make room.
      let oldestKey: string | null = null;
      let oldestExpiry = Infinity;
      for (const [kid, k] of this.entries.entries()) {
        if (k.sessionId === key.sessionId && now <= k.expiresAt && k.expiresAt < oldestExpiry) {
          oldestKey = kid;
          oldestExpiry = k.expiresAt;
        }
      }
      if (oldestKey) {
        this.entries.delete(oldestKey);
      }
    }

    this.entries.set(key.keyId, key);
  }

  async get(keyId: string, sessionId: string): Promise<PayloadKey | null> {
    const key = this.entries.get(keyId);
    if (!key) return null;

    // Check session binding
    if (key.sessionId !== sessionId) return null;

    // Check expiry — delete expired keys on access
    if (Date.now() / 1000 > key.expiresAt) {
      this.entries.delete(keyId);
      return null;
    }

    return key;
  }

  /**
   * Lookup a key without deleting expired entries.
   * Returns the key object (even if expired) so callers can distinguish
   * unknown keys from expired ones.
   */
  async lookup(keyId: string, sessionId: string): Promise<PayloadKeyLookup> {
    const key = this.entries.get(keyId);
    if (!key) return { key: null, reason: 'unknown' };

    // Check session binding
    if (key.sessionId !== sessionId) return { key: null, reason: 'unknown' };

    // Check expiry
    if (Date.now() / 1000 > key.expiresAt) {
      return { key, reason: 'expired' };
    }

    return { key, reason: undefined };
  }

  async revokeForSession(sessionId: string): Promise<void> {
    for (const [keyId, key] of this.entries.entries()) {
      if (key.sessionId === sessionId) {
        this.entries.delete(keyId);
      }
    }
  }

  /** Remove all expired entries. */
  async cleanup(): Promise<number> {
    const now = Date.now() / 1000;
    let removed = 0;
    for (const [keyId, key] of this.entries.entries()) {
      if (now > key.expiresAt) {
        this.entries.delete(keyId);
        removed++;
      }
    }
    return removed;
  }

  /** Remove entries older than the given age in seconds. */
  async cleanupOlderThan(ageSeconds: number): Promise<number> {
    const cutoff = Date.now() / 1000 - ageSeconds;
    let removed = 0;
    for (const [keyId, key] of this.entries.entries()) {
      if (key.expiresAt < cutoff) {
        this.entries.delete(keyId);
        removed++;
      }
    }
    return removed;
  }

  /** Get the number of active (non-expired) keys. */
  async activeKeyCount(): Promise<number> {
    const now = Date.now() / 1000;
    let count = 0;
    for (const [, key] of this.entries.entries()) {
      if (now <= key.expiresAt) count++;
    }
    return count;
  }

  /** Get the total number of stored keys (including expired). */
  async totalCount(): Promise<number> {
    return this.entries.size;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

let _store: PayloadKeyStore | null = null;

/**
 * Get or set the payload key store.
 * By default uses an in-memory store. Replace with a Redis-backed store
 * for multi-instance deployments.
 */
export function getPayloadKeyStore(): PayloadKeyStore {
  if (!_store) {
    _store = new InMemoryPayloadKeyStore();
    // Start the cleanup scheduler automatically when the in-memory store is created.
    startKeyCleanupScheduler();
  }
  return _store;
}

export function setPayloadKeyStore(store: PayloadKeyStore): void {
  _store = store;
}

// ---------------------------------------------------------------------------
// Key operations
// ---------------------------------------------------------------------------

/**
 * Generate a new payload key bound to a session.
 */
export async function issuePayloadKey(
  sessionId: string,
  ttlSeconds: number = 300,
): Promise<PayloadKey> {
  const keyId = randomBytes(16).toString('hex');
  const keyMaterial = generateKey();

  return {
    keyId,
    sessionId,
    expiresAt: Math.floor(Date.now() / 1000) + ttlSeconds,
    algorithm: 'aes-256-gcm',
    keyMaterial: encodeBase64url(keyMaterial),
  };
}

/**
 * Generate a new payload key and store it in one step.
 * This is the preferred helper — issuePayloadKey alone does not persist the key.
 */
export async function issueAndStorePayloadKey(
  sessionId: string,
  ttlSeconds: number = 300,
): Promise<PayloadKey> {
  const key = await issuePayloadKey(sessionId, ttlSeconds);
  await getPayloadKeyStore().put(key);
  return key;
}

/**
 * Retrieve a valid payload key with its material.
 *
 * Returns the full PayloadKey object (including raw key bytes) when:
 * - The key ID is well-formed,
 * - The key exists in the store,
 * - The session matches,
 * - The key has not expired.
 *
 * Returns specific error codes for:
 * - `invalid_key_id` — malformed key ID,
 * - `payload_key_unknown` — key does not exist or session mismatch,
 * - `payload_key_expired` — key exists but has expired.
 */
export async function getValidPayloadKey(
  keyId: string,
  sessionId: string,
): Promise<{ valid: true; key: PayloadKey } | { valid: false; error: string }> {
  if (!validateKeyId(keyId)) {
    return { valid: false, error: ERROR_CODES.INVALID_KEY_ID };
  }

  const store = getPayloadKeyStore();
  const lookup = await store.lookup(keyId, sessionId);

  if (!lookup.key) {
    return { valid: false, error: ERROR_CODES.PAYLOAD_KEY_UNKNOWN };
  }

  if (lookup.reason === 'expired') {
    return { valid: false, error: ERROR_CODES.PAYLOAD_KEY_EXPIRED };
  }

  return { valid: true, key: lookup.key };
}

/**
 * Revoke all payload keys for a session (e.g., on logout).
 */
export async function revokeSessionKeys(sessionId: string): Promise<void> {
  const store = getPayloadKeyStore();
  await store.revokeForSession(sessionId);
}

/**
 * Clean up expired keys from the store.
 * Returns the number of entries removed. If the store does not support
 * cleanup (e.g., a Redis-backed store with its own eviction policy), returns 0.
 */
export async function cleanupExpiredKeys(): Promise<number> {
  const store = getPayloadKeyStore();
  if (typeof store.cleanup === 'function') {
    return store.cleanup();
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Periodic cleanup scheduler (lazy singleton)
// ---------------------------------------------------------------------------

let cleanupTimer: ReturnType<typeof setInterval> | null = null;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes

/**
 * Start the periodic cleanup scheduler.
 * Cleans up expired keys from the in-memory store every 5 minutes.
 * Safe to call multiple times — only one timer runs at a time.
 */
export function startKeyCleanupScheduler(): void {
  if (cleanupTimer) return; // Already running

  cleanupTimer = setInterval(async () => {
    try {
      const removed = await cleanupExpiredKeys();
      if (removed > 0) {
        // Use the application logger instead of console.log.
        if (typeof globalThis !== 'undefined' && 'logger' in globalThis) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (globalThis as any).logger?.info({ removed }, '[PayloadKey] Cleaned up expired keys');
        }
      }
    } catch (error) {
      // Use the application logger instead of console.error.
      if (typeof globalThis !== 'undefined' && 'logger' in globalThis) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).logger?.error({ err: error }, '[PayloadKey] Cleanup error');
      }
    }
  }, CLEANUP_INTERVAL_MS);

  // Prevent the timer from keeping the process alive in Node.js
  if (cleanupTimer && typeof cleanupTimer.unref === 'function') {
    cleanupTimer.unref();
  }
}

/**
 * Stop the periodic cleanup scheduler.
 */
export function stopKeyCleanupScheduler(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}
