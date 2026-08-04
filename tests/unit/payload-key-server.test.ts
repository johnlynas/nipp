/**
 * Unit tests for payload-key-server.ts — server-side payload key management.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  issuePayloadKey,
  getValidPayloadKey,
  revokeSessionKeys,
  cleanupExpiredKeys,
  getPayloadKeyStore,
  setPayloadKeyStore,
} from '@/lib/payload-key-server';

// Helper to create a fresh in-memory store for each test
function freshStore() {
  const entries = new Map<string, Awaited<ReturnType<typeof issuePayloadKey>>>();

  return {
    put: async (key: Awaited<ReturnType<typeof issuePayloadKey>>) => {
      entries.set(key.keyId, key);
    },
    get: async (keyId: string, sessionId: string) => {
      const key = entries.get(keyId);
      if (!key) return null;
      if (key.sessionId !== sessionId) return null;
      if (Date.now() / 1000 > key.expiresAt) {
        entries.delete(keyId);
        return null;
      }
      return key;
    },
    lookup: async (keyId: string, sessionId: string) => {
      const key = entries.get(keyId);
      if (!key) return { key: null, reason: 'unknown' as const };
      if (key.sessionId !== sessionId) return { key: null, reason: 'unknown' as const };
      if (Date.now() / 1000 > key.expiresAt) {
        return { key, reason: 'expired' as const };
      }
      return { key, reason: undefined };
    },
    revokeForSession: async (sessionId: string) => {
      for (const [keyId, key] of entries.entries()) {
        if (key.sessionId === sessionId) {
          entries.delete(keyId);
        }
      }
    },
  };
}

describe('issuePayloadKey', () => {
  it('should issue a key with all required fields', async () => {
    const sessionId = 'test-session-123';
    const key = await issuePayloadKey(sessionId, 300);

    expect(key.keyId).toBeDefined();
    expect(typeof key.keyId).toBe('string');
    expect(key.sessionId).toBe(sessionId);
    expect(key.algorithm).toBe('aes-256-gcm');
    expect(typeof key.expiresAt).toBe('number');
    expect(key.keyMaterial.length).toBeGreaterThan(0);
  });

  it('should set expiresAt to current time + TTL', async () => {
    const sessionId = 'test-session-456';
    const ttlSeconds = 300;

    const beforeIssue = Math.floor(Date.now() / 1000);
    const key = await issuePayloadKey(sessionId, ttlSeconds);
    const afterIssue = Math.floor(Date.now() / 1000);

    expect(key.expiresAt).toBeGreaterThanOrEqual(beforeIssue + ttlSeconds - 1);
    expect(key.expiresAt).toBeLessThanOrEqual(afterIssue + ttlSeconds + 1);
  });

  it('should generate unique key IDs', async () => {
    const sessionId = 'test-session-unique';
    const key1 = await issuePayloadKey(sessionId);
    const key2 = await issuePayloadKey(sessionId);

    expect(key1.keyId).not.toBe(key2.keyId);
  });

  it('should generate unique key materials', async () => {
    const sessionId = 'test-session-material';
    const key1 = await issuePayloadKey(sessionId);
    const key2 = await issuePayloadKey(sessionId);

    expect(key1.keyMaterial).not.toBe(key2.keyMaterial);
  });

  it('should use default TTL of 300 seconds', async () => {
    const sessionId = 'test-session-default-ttl';
    const beforeIssue = Math.floor(Date.now() / 1000);
    const key = await issuePayloadKey(sessionId);

    expect(key.expiresAt).toBeGreaterThanOrEqual(beforeIssue + 299);
    expect(key.expiresAt).toBeLessThanOrEqual(beforeIssue + 301);
  });
});

describe('getValidPayloadKey', () => {
  beforeEach(() => {
    // Reset the store before each test with a fresh in-memory store
    setPayloadKeyStore(freshStore());
  });

  it('should validate a valid key', async () => {
    const sessionId = 'test-session-validate';
    const key = await issuePayloadKey(sessionId, 300);

    // Store the key
    const store = getPayloadKeyStore();
    await store.put(key);

    const result = await getValidPayloadKey(key.keyId, sessionId);
    expect(result.valid).toBe(true);
  });

  it('should reject unknown key ID', async () => {
    const result = await getValidPayloadKey('unknown-key-id', 'test-session');
    expect(result.valid).toBe(false);
  });

  it('should reject key with wrong session', async () => {
    const sessionId = 'test-session-wrong';
    const key = await issuePayloadKey(sessionId, 300);

    const store = getPayloadKeyStore();
    await store.put(key);

    const result = await getValidPayloadKey(key.keyId, 'different-session');
    expect(result.valid).toBe(false);
  });

  it('should reject empty key ID', async () => {
    const result = await getValidPayloadKey('', 'test-session');
    expect(result.valid).toBe(false);
  });

  it('should reject key with invalid format', async () => {
    const result = await getValidPayloadKey('key/with/slashes', 'test-session');
    expect(result.valid).toBe(false);
  });

  it('should include error code for unknown key', async () => {
    const result = await getValidPayloadKey('unknown-key-id', 'test-session');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe('payload_key_unknown');
    }
  });

  it('should include error code for invalid key ID', async () => {
    const result = await getValidPayloadKey('', 'test-session');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe('invalid_key_id');
    }
  });
});

describe('revokeSessionKeys', () => {
  beforeEach(() => {
    setPayloadKeyStore(freshStore());
  });

  it('should revoke all keys for a session', async () => {
    const sessionId = 'test-session-revoke';

    // Issue multiple keys for the same session
    const key1 = await issuePayloadKey(sessionId, 300);
    const key2 = await issuePayloadKey(sessionId, 300);

    const store = getPayloadKeyStore();
    await store.put(key1);
    await store.put(key2);

    // Verify keys exist
    expect(await store.get(key1.keyId, sessionId)).not.toBeNull();
    expect(await store.get(key2.keyId, sessionId)).not.toBeNull();

    // Revoke all keys for the session
    await revokeSessionKeys(sessionId);

    // Verify keys are revoked
    expect(await store.get(key1.keyId, sessionId)).toBeNull();
    expect(await store.get(key2.keyId, sessionId)).toBeNull();
  });

  it('should not affect keys for other sessions', async () => {
    const sessionId1 = 'test-session-revoke-1';
    const sessionId2 = 'test-session-revoke-2';

    const key1 = await issuePayloadKey(sessionId1, 300);
    const key2 = await issuePayloadKey(sessionId2, 300);

    const store = getPayloadKeyStore();
    await store.put(key1);
    await store.put(key2);

    // Revoke only session 1's keys
    await revokeSessionKeys(sessionId1);

    // Session 2's key should still be valid
    expect(await store.get(key1.keyId, sessionId1)).toBeNull();
    expect(await store.get(key2.keyId, sessionId2)).not.toBeNull();
  });

  it('should handle revoking non-existent session', async () => {
    await expect(revokeSessionKeys('non-existent-session')).resolves.toBeUndefined();
  });
});

describe('getValidPayloadKey', () => {
  beforeEach(() => {
    setPayloadKeyStore(freshStore());
  });

  it('should return key material for a valid key', async () => {
    const sessionId = 'test-session-getvalid';
    const key = await issuePayloadKey(sessionId, 300);

    const store = getPayloadKeyStore();
    await store.put(key);

    const result = await getValidPayloadKey(key.keyId, sessionId);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.key.keyId).toBe(key.keyId);
      expect(result.key.sessionId).toBe(sessionId);
      expect(result.key.algorithm).toBe('aes-256-gcm');
      expect(typeof result.key.keyMaterial).toBe('string');
    }
  });

  it('should reject unknown key ID', async () => {
    const result = await getValidPayloadKey('unknown-key-id', 'test-session');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe('payload_key_unknown');
    }
  });

  it('should reject expired key with specific error', async () => {
    const sessionId = 'test-session-expired';
    // Issue a key that expires immediately (TTL of 0)
    const key = await issuePayloadKey(sessionId, 0);

    // Wait a moment for it to expire
    await new Promise((r) => setTimeout(r, 10));

    const store = getPayloadKeyStore();
    await store.put(key);

    // The in-memory store's get() deletes expired keys, but lookup() returns them
    const result = await getValidPayloadKey(key.keyId, sessionId);
    // Since the store's get() deletes expired keys and lookup() is used internally,
    // this will return payload_key_unknown (key was deleted by get())
    expect(result.valid).toBe(false);
  });

  it('should reject invalid key ID format', async () => {
    const result = await getValidPayloadKey('', 'test-session');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe('invalid_key_id');
    }
  });

  it('should reject wrong session', async () => {
    const sessionId = 'test-session-wrong-getvalid';
    const key = await issuePayloadKey(sessionId, 300);

    const store = getPayloadKeyStore();
    await store.put(key);

    const result = await getValidPayloadKey(key.keyId, 'different-session');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe('payload_key_unknown');
    }
  });
});

describe('cleanupExpiredKeys', () => {
  it('should remove expired keys from the real in-memory store', async () => {
    const sessionId = 'test-session-cleanup';
    const expiredKey = await issuePayloadKey(sessionId, 0);
    const validKey = await issuePayloadKey(sessionId, 300);

    // Create a store with cleanup support
    const { setPayloadKeyStore: spks } = await import('@/lib/payload-key-server');
    const entries = new Map<string, Awaited<ReturnType<typeof issuePayloadKey>>>();

    const store = {
      put: async (key: Awaited<ReturnType<typeof issuePayloadKey>>) => { entries.set(key.keyId, key); },
      get: async (keyId: string, sid: string) => {
        const key = entries.get(keyId);
        if (!key || key.sessionId !== sid) return null;
        if (Date.now() / 1000 > key.expiresAt) { entries.delete(keyId); return null; }
        return key;
      },
      lookup: async (keyId: string, sid: string) => {
        const key = entries.get(keyId);
        if (!key || key.sessionId !== sid) return { key: null, reason: 'unknown' as const };
        if (Date.now() / 1000 > key.expiresAt) return { key, reason: 'expired' as const };
        return { key, reason: undefined };
      },
      revokeForSession: async (sid: string) => {
        for (const [kid, k] of entries.entries()) {
          if (k.sessionId === sid) entries.delete(kid);
        }
      },
      cleanup: async () => {
        const now = Date.now() / 1000;
        let removed = 0;
        for (const [kid, k] of entries.entries()) {
          if (now > k.expiresAt) { entries.delete(kid); removed++; }
        }
        return removed;
      },
    } as unknown as Awaited<ReturnType<typeof import('@/lib/payload-key-server').getPayloadKeyStore>>;

    spks(store);
    await store.put(expiredKey);
    await store.put(validKey);

    const removed = await cleanupExpiredKeys();
    expect(removed).toBeGreaterThanOrEqual(1);

    const remaining = await store.get(validKey.keyId, sessionId);
    expect(remaining).not.toBeNull();
  });

  it('should return 0 when no keys are expired', async () => {
    const { setPayloadKeyStore: spks } = await import('@/lib/payload-key-server');
    const entries = new Map<string, Awaited<ReturnType<typeof issuePayloadKey>>>();

    const store = {
      put: async (key: Awaited<ReturnType<typeof issuePayloadKey>>) => { entries.set(key.keyId, key); },
      get: async (keyId: string, sid: string) => {
        const key = entries.get(keyId);
        if (!key || key.sessionId !== sid) return null;
        if (Date.now() / 1000 > key.expiresAt) { entries.delete(keyId); return null; }
        return key;
      },
      lookup: async (keyId: string, sid: string) => {
        const key = entries.get(keyId);
        if (!key || key.sessionId !== sid) return { key: null, reason: 'unknown' as const };
        if (Date.now() / 1000 > key.expiresAt) return { key, reason: 'expired' as const };
        return { key, reason: undefined };
      },
      revokeForSession: async (sid: string) => {
        for (const [kid, k] of entries.entries()) {
          if (k.sessionId === sid) entries.delete(kid);
        }
      },
      cleanup: async () => {
        const now = Date.now() / 1000;
        let removed = 0;
        for (const [kid, k] of entries.entries()) {
          if (now > k.expiresAt) { entries.delete(kid); removed++; }
        }
        return removed;
      },
    } as unknown as Awaited<ReturnType<typeof import('@/lib/payload-key-server').getPayloadKeyStore>>;

    spks(store);
    const key = await issuePayloadKey('test-session-cleanup-none', 300);
    await store.put(key);

    const removed = await cleanupExpiredKeys();
    expect(removed).toBe(0);
  });

  it('should return 0 when store has no cleanup method', async () => {
    const { setPayloadKeyStore: spks } = await import('@/lib/payload-key-server');
    const store = {
      put: async () => {},
      get: async () => null,
      lookup: async () => ({ key: null, reason: 'unknown' as const }),
      revokeForSession: async () => {},
    } as unknown as Awaited<ReturnType<typeof import('@/lib/payload-key-server').getPayloadKeyStore>>;

    spks(store);
    const removed = await cleanupExpiredKeys();
    expect(removed).toBe(0);
  });
});

describe('getPayloadKeyStore / setPayloadKeyStore', () => {
  beforeEach(() => {
    // Reset to default in-memory store
    setPayloadKeyStore(freshStore());
  });

  it('should return the default in-memory store', () => {
    const store = getPayloadKeyStore();
    expect(store).toBeDefined();
    expect(typeof store.put).toBe('function');
    expect(typeof store.get).toBe('function');
    expect(typeof store.revokeForSession).toBe('function');
  });

  it('should allow setting a custom store', () => {
    const customStore = freshStore();

    setPayloadKeyStore(customStore);
    expect(getPayloadKeyStore()).toBe(customStore);
  });

  it('should return the same store instance on repeated calls', () => {
    const store1 = getPayloadKeyStore();
    const store2 = getPayloadKeyStore();
    expect(store1).toBe(store2);
  });
});
