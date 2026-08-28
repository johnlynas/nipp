/**
 * Unit tests for lib/payload-key-server.ts — the REAL in-memory key store,
 * factory/scheduler singleton, and issue helpers.
 *
 * The sibling payload-key-server.test.ts covers the public API against a
 * hand-rolled fake store; this file exercises InMemoryPayloadKeyStore itself:
 * eviction policy, expired-entry cleanup on put, get/lookup semantics,
 * cleanup variants, counts, and the periodic cleanup scheduler.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import { ERROR_CODES, validateKeyId, decodeBase64url } from '@/lib/payload-format';
import {
  getPayloadKeyStore,
  setPayloadKeyStore,
  issuePayloadKey,
  issueAndStorePayloadKey,
  getValidPayloadKey,
  revokeSessionKeys,
  cleanupExpiredKeys,
  startKeyCleanupScheduler,
  stopKeyCleanupScheduler,
} from '@/lib/payload-key-server';
import type { PayloadKey } from '@/lib/payload-key-server';
import { env } from '@/lib/env';

// ---------------------------------------------------------------------------
// Types for the class-only helpers (cleanup/activeKeyCount/totalCount/...)
// that are not part of the public PayloadKeyStore interface.
// ---------------------------------------------------------------------------

interface InMemoryKeyStore {
  put(key: PayloadKey): Promise<void>;
  get(keyId: string, sessionId: string): Promise<PayloadKey | null>;
  lookup(
    keyId: string,
    sessionId: string,
  ): Promise<{ key: PayloadKey | null; reason?: 'unknown' | 'expired' }>;
  revokeForSession(sessionId: string): Promise<void>;
  cleanup(): Promise<number>;
  cleanupOlderThan(ageSeconds: number): Promise<number>;
  activeKeyCount(): Promise<number>;
  totalCount(): Promise<number>;
}

const memStore = (): InMemoryKeyStore => getPayloadKeyStore() as unknown as InMemoryKeyStore;

// ---------------------------------------------------------------------------
// Time control — fake timers with a frozen clock so expiry/eviction asserts
// are exact (no flaky real-time boundaries).
//
// IMPORTANT: vi.useFakeTimers() must be entered when the wall clock still
// matches the store module's Date.now() baseline. Calling it at an arbitrary
// past date would leave relative fixtures (cleanupOlderThan computes cutoffs
// from wall clock) out of sync. We therefore freeze the clock at T0 = the
// real "now" captured at import time and express ALL expiries relative to T0.
// ---------------------------------------------------------------------------

const T0 = Math.floor(Date.now() / 1000); // frozen clock origin, seconds

beforeAll(() => {
  vi.useFakeTimers(); // fakes start at the current real time...
  vi.setSystemTime(T0 * 1000); // ...then pin exactly to T0 (≤1s of import)
});

afterAll(() => {
  stopKeyCleanupScheduler();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.setSystemTime(new Date(T0 * 1000)); // reset clock to T0 for each test
  stopKeyCleanupScheduler();
  // setPayloadKeyStore(undefined) nulls the module singleton; the next
  // getPayloadKeyStore() call creates a FRESH InMemoryPayloadKeyStore, so
  // every test starts with an empty store.
  setPayloadKeyStore(undefined as unknown as ReturnType<typeof getPayloadKeyStore>);
});

function makeKey(overrides: Partial<PayloadKey> = {}): PayloadKey {
  return {
    keyId: overrides.keyId ?? 'a'.repeat(32),
    sessionId: overrides.sessionId ?? 'sess-1',
    expiresAt: overrides.expiresAt ?? T0 + 300,
    algorithm: 'aes-256-gcm',
    keyMaterial: overrides.keyMaterial ?? 'b'.repeat(43),
  };
}

/** Access the current singleton store with its class-only helpers. */
function resetStore(): InMemoryKeyStore {
  return memStore();
}

// ---------------------------------------------------------------------------
// issuePayloadKey / issueAndStorePayloadKey
// ---------------------------------------------------------------------------

describe('issuePayloadKey', () => {
  it('produces a well-formed keyId (validates against the shared validator)', async () => {
    const key = await issuePayloadKey('iss-1', 60);

    expect(key.keyId).toMatch(/^[0-9a-f]{32}$/);
    expect(validateKeyId(key.keyId)).toBe(true);
    expect(key.sessionId).toBe('iss-1');
  });

  it('produces base64url key material that decodes to exactly 32 bytes', async () => {
    const key = await issuePayloadKey('iss-2');

    const bytes = decodeBase64url(key.keyMaterial);
    expect(bytes.length).toBe(32);
    // base64url alphabet only (no +, /, =)
    expect(key.keyMaterial).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('pins expiresAt to now + ttl (frozen clock)', async () => {
    const key = await issuePayloadKey('iss-3', 120);
    expect(key.expiresAt).toBe(T0 + 120);
  });

  it('defaults ttl to 300s when omitted', async () => {
    const key = await issuePayloadKey('iss-4');
    expect(key.expiresAt).toBe(T0 + 300);
  });
});

describe('issueAndStorePayloadKey', () => {
  it('stores the issued key — retrievable via getValidPayloadKey', async () => {
    const key = await issueAndStorePayloadKey('iss-store', 100);

    const result = await getValidPayloadKey(key.keyId, 'iss-store');
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.key).toMatchObject({
        keyId: key.keyId,
        sessionId: 'iss-store',
        algorithm: 'aes-256-gcm',
        expiresAt: T0 + 100,
      });
      // key material round-trips through the shared base64url codec.
      expect(decodeBase64url(result.key.keyMaterial)).toEqual(
        decodeBase64url(key.keyMaterial),
      );
    }
  });

  it('does not persist keys created via issuePayloadKey alone', async () => {
    const unstored = await issuePayloadKey('iss-unstored');

    const result = await getValidPayloadKey(unstored.keyId, 'iss-unstored');
    expect(result).toEqual({ valid: false, error: ERROR_CODES.PAYLOAD_KEY_UNKNOWN });
  });
});

// ---------------------------------------------------------------------------
// InMemory store — put() / eviction policy
// ---------------------------------------------------------------------------

describe('in-memory store: put()', () => {
  it('removes this session\'s expired entries before counting active keys', async () => {
    const store = resetStore();
    await store.put(makeKey({ keyId: 'put-exp', expiresAt: T0 + 10 }));
    await store.put(makeKey({ keyId: 'put-live', expiresAt: T0 + 500 }));

    // Let put-exp lapse, then put a new key for the same session.
    vi.setSystemTime(new Date(T0 * 1000 + 11_000));
    await store.put(makeKey({ keyId: 'put-new', expiresAt: T0 + 500 }));

    // The expired entry was removed as a side effect of put.
    expect(await store.get('put-exp', 'sess-1')).toBeNull();
    expect(await store.get('put-live', 'sess-1')).not.toBeNull();
    expect(await store.get('put-new', 'sess-1')).not.toBeNull();
  });

  it('evicts the oldest ACTIVE key of the session when the cap is reached', async () => {
    const store = resetStore();
    const max = env.PAYLOAD_ENCRYPTION_MAX_KEYS_PER_SESSION; // default 10

    for (let i = 1; i <= max; i++) {
      await store.put(makeKey({ keyId: `cap-${i}`, expiresAt: T0 + 100 * i }));
    }
    expect(await store.activeKeyCount()).toBe(max);

    // N+1th insert must evict cap-1 (earliest expiry), preserving the cap.
    await store.put(makeKey({ keyId: 'cap-new', expiresAt: T0 + 900 }));

    expect(await store.get('cap-new', 'sess-1')).not.toBeNull();
    expect(await store.get('cap-1', 'sess-1')).toBeNull(); // evicted
    expect(await store.activeKeyCount()).toBe(max);
    for (let i = 2; i <= max; i++) {
      expect(await store.get(`cap-${i}`, 'sess-1')).not.toBeNull();
    }
  });

  it('eviction is scoped to the same session only', async () => {
    const store = resetStore();
    const max = env.PAYLOAD_ENCRYPTION_MAX_KEYS_PER_SESSION;

    await store.put(makeKey({ keyId: 'other-keep', sessionId: 'sess-B', expiresAt: T0 + 500 }));
    for (let i = 1; i <= max; i++) {
      await store.put(makeKey({ keyId: `same-${i}`, sessionId: 'sess-A', expiresAt: T0 + 100 * i }));
    }

    await store.put(makeKey({ keyId: 'same-new', sessionId: 'sess-A', expiresAt: T0 + 900 }));

    expect(await store.get('other-keep', 'sess-B')).not.toBeNull();
    expect(await store.get('same-1', 'sess-A')).toBeNull(); // evicted from A only
    expect(await store.get('same-new', 'sess-A')).not.toBeNull();
  });

  it('an expired entry does not consume the active cap (no eviction needed)', async () => {
    const store = resetStore();
    const max = env.PAYLOAD_ENCRYPTION_MAX_KEYS_PER_SESSION;

    await store.put(makeKey({ keyId: 'zombie', expiresAt: T0 + 10 }));
    for (let i = 1; i < max; i++) {
      await store.put(makeKey({ keyId: `live-${i}`, expiresAt: T0 + 500 }));
    }

    vi.setSystemTime(new Date(T0 * 1000 + 20_000)); // zombie expired

    // Active count (live only) is max-1, so this insert does NOT evict.
    await store.put(makeKey({ keyId: 'extra', expiresAt: T0 + 500 }));

    expect(await store.get('extra', 'sess-1')).not.toBeNull();
    // All live keys survive.
    for (let i = 1; i < max; i++) {
      expect(await store.get(`live-${i}`, 'sess-1')).not.toBeNull();
    }
    expect(await store.activeKeyCount()).toBe(max);
  });
});

// ---------------------------------------------------------------------------
// InMemory store — get() vs lookup()
// ---------------------------------------------------------------------------

describe('in-memory store: get()', () => {
  it('returns the key when id + session match and it is unexpired', async () => {
    const store = resetStore();
    const key = makeKey({ keyId: 'get-1', expiresAt: T0 + 500 });
    await store.put(key);

    expect(await store.get('get-1', 'sess-1')).toEqual(key);
  });

  it('returns null for an unknown keyId', async () => {
    const store = resetStore();
    expect(await store.get('get-missing', 'sess-1')).toBeNull();
  });

  it('session mismatch returns null without deleting the entry', async () => {
    const store = resetStore();
    await store.put(makeKey({ keyId: 'get-sess', sessionId: 'real', expiresAt: T0 + 500 }));

    expect(await store.get('get-sess', 'impostor')).toBeNull();
    // Entry survives — only expiry triggers deletion on access.
    expect(await store.get('get-sess', 'real')).not.toBeNull();
  });

  it('deletes expired keys on access and returns null', async () => {
    const store = resetStore();
    await store.put(makeKey({ keyId: 'get-exp', expiresAt: T0 + 10 }));

    vi.setSystemTime(new Date(T0 * 1000 + 11_000));

    expect(await store.get('get-exp', 'sess-1')).toBeNull();
    // Physically removed, not just filtered out.
    expect(await store.totalCount()).toBe(0);
  });

  it('keeps a key whose expiry boundary equals now (now <= expiresAt)', async () => {
    const store = resetStore();
    await store.put(makeKey({ keyId: 'get-bound', expiresAt: T0 + 100 }));

    vi.setSystemTime(new Date(T0 * 1000 + 100_000)); // now == expiresAt exactly

    expect(await store.get('get-bound', 'sess-1')).not.toBeNull();
  });
});

describe('in-memory store: lookup()', () => {
  it('distinguishes unknown from expired (expired still returns the key)', async () => {
    const store = resetStore();
    await store.put(makeKey({ keyId: 'look-exp', expiresAt: T0 + 10 }));

    vi.setSystemTime(new Date(T0 * 1000 + 11_000));

    const first = await store.lookup('look-exp', 'sess-1');
    expect(first.reason).toBe('expired');
    expect(first.key?.keyId).toBe('look-exp');

    // lookup does NOT delete — the entry survives a second lookup.
    const again = await store.lookup('look-exp', 'sess-1');
    expect(again.reason).toBe('expired');
    expect(await store.totalCount()).toBe(1);
  });

  it('returns unknown for a missing keyId', async () => {
    const store = resetStore();
    const result = await store.lookup('look-missing', 'sess-1');
    expect(result).toEqual({ key: null, reason: 'unknown' });
  });

  it('session mismatch is reported as unknown (not expired)', async () => {
    const store = resetStore();
    await store.put(makeKey({ keyId: 'look-sess', sessionId: 'real', expiresAt: T0 + 500 }));

    const result = await store.lookup('look-sess', 'wrong');
    expect(result).toEqual({ key: null, reason: 'unknown' });
  });

  it('returns the key with undefined reason when valid and unexpired', async () => {
    const store = resetStore();
    await store.put(makeKey({ keyId: 'look-ok', expiresAt: T0 + 500 }));

    const result = await store.lookup('look-ok', 'sess-1');
    expect(result.key?.keyId).toBe('look-ok');
    expect(result.reason).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// revoke / cleanup / counts
// ---------------------------------------------------------------------------

describe('in-memory store: revokeForSession()', () => {
  it('removes every key for the session, leaving other sessions intact', async () => {
    const store = resetStore();
    await store.put(makeKey({ keyId: 'rev-1', sessionId: 'victim' }));
    await store.put(makeKey({ keyId: 'rev-2', sessionId: 'victim' }));
    await store.put(makeKey({ keyId: 'rev-3', sessionId: 'survivor' }));

    await store.revokeForSession('victim');

    expect(await store.get('rev-1', 'victim')).toBeNull();
    expect(await store.get('rev-2', 'victim')).toBeNull();
    expect(await store.get('rev-3', 'survivor')).not.toBeNull();
  });

  it('is a no-op for sessions with no keys', async () => {
    const store = resetStore();
    await expect(store.revokeForSession('ghost')).resolves.toBeUndefined();
  });

  it('revokeSessionKeys (public API) is wired to the same store', async () => {
    const store = resetStore();
    await store.put(makeKey({ keyId: 'rev-api', sessionId: 'api-sess' }));

    await revokeSessionKeys('api-sess');
    expect(await store.get('rev-api', 'api-sess')).toBeNull();
  });
});

describe('in-memory store: cleanup()', () => {
  it('removes only expired entries and reports the count', async () => {
    const store = resetStore();
    await store.put(makeKey({ keyId: 'cl-1', expiresAt: T0 + 10 }));
    await store.put(makeKey({ keyId: 'cl-2', expiresAt: T0 + 50 }));
    await store.put(makeKey({ keyId: 'cl-3', expiresAt: T0 + 500 }));

    vi.setSystemTime(new Date(T0 * 1000 + 60_000)); // cl-1, cl-2 expired; cl-3 alive

    const removed = await store.cleanup();
    expect(removed).toBe(2);
    expect(await store.get('cl-3', 'sess-1')).not.toBeNull();
    expect(await store.totalCount()).toBe(1);
  });

  it('removes nothing when no entries are expired', async () => {
    const store = resetStore();
    await store.put(makeKey({ keyId: 'cl-live', expiresAt: T0 + 500 }));

    expect(await store.cleanup()).toBe(0);
    expect(await store.totalCount()).toBe(1);
  });

  it('cleanupExpiredKeys (public API) delegates to the in-memory store', async () => {
    const store = resetStore();
    await store.put(makeKey({ keyId: 'cl-api', expiresAt: T0 + 10 }));

    vi.setSystemTime(new Date(T0 * 1000 + 20_000));
    expect(await cleanupExpiredKeys()).toBe(1);
    expect(await store.totalCount()).toBe(0);
  });
});

describe('in-memory store: cleanupOlderThan()', () => {
  it('removes entries that expired before the cutoff, keeping newer ones', async () => {
    const store = resetStore();
    // Cutoff at age 400s → T0 - 400. Entries with expiresAt < cutoff are gone.
    // NOTE: distinct sessionIds — put() auto-purges the NEW key's session on
    // insert, which would otherwise sweep these already-expired fixtures away.
    await store.put(makeKey({ keyId: 'age-old', sessionId: 's-old', expiresAt: T0 - 500 })); // removed
    await store.put(makeKey({ keyId: 'age-fresh', sessionId: 's-fresh', expiresAt: T0 + 100 })); // kept
    await store.put(makeKey({ keyId: 'age-edge', sessionId: 's-edge', expiresAt: T0 - 400 })); // kept (not < cutoff)

    const removed = await store.cleanupOlderThan(400);
    expect(removed).toBe(1);
    expect(await store.get('age-fresh', 's-fresh')).not.toBeNull();
    // The edge entry (expiresAt == cutoff) was NOT removed — still in the
    // store (and expired: lookup reports it without deleting).
    const edge = await store.lookup('age-edge', 's-edge');
    expect(edge.key?.keyId).toBe('age-edge');
    expect(edge.reason).toBe('expired');
    expect(await store.totalCount()).toBe(2);
  });

  it('removes everything when the age exceeds all expiries', async () => {
    const store = resetStore();
    // Cutoff at age 1000s → T0 - 1000; both entries expired well before that.
    await store.put(makeKey({ keyId: 'age-all-1', sessionId: 's-a', expiresAt: T0 - 2000 }));
    await store.put(makeKey({ keyId: 'age-all-2', sessionId: 's-b', expiresAt: T0 - 1500 }));

    expect(await store.cleanupOlderThan(1000)).toBe(2);
    expect(await store.totalCount()).toBe(0);
  });
});

describe('in-memory store: counts', () => {
  it('activeKeyCount ignores expired entries', async () => {
    const store = resetStore();
    await store.put(makeKey({ keyId: 'cnt-new', expiresAt: T0 + 500 }));
    await store.put(makeKey({ keyId: 'cnt-old', expiresAt: T0 + 10 }));

    vi.setSystemTime(new Date(T0 * 1000 + 11_000)); // cnt-old expired; cnt-new live

    expect(await store.activeKeyCount()).toBe(1);
  });

  it('totalCount includes expired entries until they are removed', async () => {
    const store = resetStore();
    await store.put(makeKey({ keyId: 'cnt-t1', expiresAt: T0 + 500 }));
    await store.put(makeKey({ keyId: 'cnt-t2', expiresAt: T0 + 10 }));

    vi.setSystemTime(new Date(T0 * 1000 + 11_000));

    expect(await store.totalCount()).toBe(2); // expired still counted
    expect(await store.activeKeyCount()).toBe(1); // but not active
  });
});

// ---------------------------------------------------------------------------
// Scheduler lifecycle + periodic behaviour
// ---------------------------------------------------------------------------

describe('key cleanup scheduler', () => {
  it('starts at most one interval (repeated calls are no-ops)', async () => {
    stopKeyCleanupScheduler();
    const startSpy = vi.spyOn(globalThis, 'setInterval');
    try {
      startKeyCleanupScheduler();
      startKeyCleanupScheduler();
      startKeyCleanupScheduler();

      expect(startSpy).toHaveBeenCalledTimes(1);
    } finally {
      startSpy.mockRestore();
    }
  });

  it('stop clears the timer and can be restarted with a fresh one', async () => {
    stopKeyCleanupScheduler();
    const intervalSpy = vi.spyOn(globalThis, 'setInterval');
    try {
      startKeyCleanupScheduler();
      expect(intervalSpy).toHaveBeenCalledTimes(1);

      stopKeyCleanupScheduler();
      stopKeyCleanupScheduler(); // idempotent — must not throw

      intervalSpy.mockClear();
      startKeyCleanupScheduler();
      expect(intervalSpy).toHaveBeenCalledTimes(1);
    } finally {
      intervalSpy.mockRestore();
    }
  });

  it('a tick physically removes expired keys and logs them via global logger', async () => {
    const store = resetStore();
    await store.put(makeKey({ keyId: 'tick-exp', expiresAt: T0 + 10 }));
    await store.put(makeKey({ keyId: 'tick-live', expiresAt: T0 + 500 }));

    // Let one entry expire, then start the scheduler and advance a tick.
    vi.setSystemTime(new Date(T0 * 1000 + 20_000));

    const loggerInfo = vi.fn();
    vi.stubGlobal('logger', { info: loggerInfo, error: vi.fn() });

    stopKeyCleanupScheduler();
    startKeyCleanupScheduler();
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000); // exactly one 5-minute tick

    expect(await store.totalCount()).toBe(1); // only tick-live remains
    expect(loggerInfo).toHaveBeenCalledTimes(1);
    const arg = loggerInfo.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.removed).toBe(1);
    expect(String(loggerInfo.mock.calls[0][1])).toContain('Cleaned up expired keys');

    vi.unstubAllGlobals();
  });

  it('a tick logs nothing when there is nothing to clean', async () => {
    const store = resetStore();
    await store.put(makeKey({ keyId: 'tick-quiet', expiresAt: T0 + 500 }));

    const loggerInfo = vi.fn();
    vi.stubGlobal('logger', { info: loggerInfo, error: vi.fn() });

    stopKeyCleanupScheduler();
    startKeyCleanupScheduler();
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    expect(loggerInfo).not.toHaveBeenCalled();
    expect(await store.totalCount()).toBe(1); // nothing removed

    vi.unstubAllGlobals();
  });

  it('getPayloadKeyStore lazily creates the store and starts exactly one scheduler', async () => {
    stopKeyCleanupScheduler();
    const intervalSpy = vi.spyOn(globalThis, 'setInterval');
    try {
      // beforeEach reset nulled the singleton — first access creates it and
      // (per factory behaviour) starts the cleanup scheduler.
      const created = getPayloadKeyStore();
      expect(intervalSpy).toHaveBeenCalledTimes(1);

      // Subsequent accesses reuse the instance without adding timers.
      intervalSpy.mockClear();
      const again = getPayloadKeyStore();
      expect(intervalSpy).not.toHaveBeenCalled();
      expect(again).toBe(created);
    } finally {
      intervalSpy.mockRestore();
    }
  });
});
