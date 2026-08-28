/**
 * Unit tests for lib/payload-key-manager.ts — client-side payload key
 * fetch/caching/refresh, including the in-memory-only cache invariants and
 * response validation.
 *
 * Fetch is stubbed per test; importAesGcmKey (Web Crypto) is mocked so no
 * real key material flows through these tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted keeps instances alive before imports evaluate (the UUT
// imports crypto-client during module initialization).
// ---------------------------------------------------------------------------

const { FAKE_CRYPTO_KEY } = vi.hoisted(() => ({
  FAKE_CRYPTO_KEY: Object.freeze({
    type: 'secret',
    extractable: false,
    algorithm: { name: 'AES-GCM' },
    __fakeKey: true,
  }) as unknown,
}));

vi.mock('@/lib/crypto-client', () => ({
  importAesGcmKey: vi.fn(async (_keyMaterial: string, _extractable = false) => FAKE_CRYPTO_KEY),
}));

import { importAesGcmKey } from '@/lib/crypto-client';
import {
  getPayloadKey,
  refreshPayloadKey,
  clearPayloadKey,
  getCachedKeyInfo,
} from '@/lib/payload-key-manager';

type FetchKey = Awaited<ReturnType<typeof getPayloadKey>>;
const mockedImportKey = importAesGcmKey as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A fully valid payload-key response body (with overrides merged in). */
function keyPayload(overrides: Record<string, unknown> = {}) {
  return {
    keyId: 'kid-123',
    algorithm: 'aes-256-gcm',
    expiresAt: Math.floor(Date.now() / 1000) + 300,
    key: 'k'.repeat(43), // valid base64url length for a 32-byte key
    sessionId: 'session-abc',
    ...overrides,
  };
}

interface ResponseOptions {
  ok?: boolean;
  status?: number;
  statusText?: string;
  /** Cache-Control header value; default 'no-store' (the safe case). */
  cacheControl?: string | null;
  /** Overrides merged into a valid keyPayload() body. */
  payload?: Record<string, unknown>;
  /** When set, used verbatim as the JSON body (for exact/absence fixtures). */
  jsonBody?: unknown;
}

function jsonResponse(opts: ResponseOptions = {}) {
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    statusText: opts.statusText ?? 'OK',
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'cache-control'
          ? (opts.cacheControl === undefined ? 'no-store' : opts.cacheControl)
          : null,
    },
    json: async () => (opts.jsonBody !== undefined ? opts.jsonBody : { ...keyPayload(), ...(opts.payload ?? {}) }),
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;
const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

beforeEach(async () => {
  clearPayloadKey(); // reset module-scoped cache
  mockedImportKey.mockClear();
  consoleWarn.mockClear();
  fetchMock = vi.fn().mockResolvedValue(jsonResponse());
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Restore the real console.warn once when this file is done — never
 *  per-test, since vi.spyOn'd instances detach from console after restore. */
afterAll(() => {
  consoleWarn.mockRestore();
});

function expectKeyShape(key: FetchKey) {
  expect(key.keyId).toBe('kid-123');
  expect(key.algorithm).toBe('aes-256-gcm');
  expect(key.sessionId).toBe('session-abc');
  expect(key.cryptoKey).toBe(FAKE_CRYPTO_KEY);
  expect(typeof key.expiresAt).toBe('number');
}

// ---------------------------------------------------------------------------
// getPayloadKey — caching behaviour
// ---------------------------------------------------------------------------

describe('getPayloadKey', () => {
  it('fetches and caches on a cache miss', async () => {
    const key = await getPayloadKey();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    // POSTs to the payload-key endpoint with a JSON content type.
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/security/payload-key');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');

    // Key material is imported as non-extractable (never leave the module).
    expect(mockedImportKey).toHaveBeenCalledWith('k'.repeat(43), false);

    expectKeyShape(key);
  });

  it('returns the cached key without refetching while valid', async () => {
    const first = await getPayloadKey();
    const second = await getPayloadKey();
    const third = await getPayloadKey();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second).toBe(first); // same object identity — cached, not refetched
    expect(third).toBe(first);
  });

  it('refetches when the cached key has expired', async () => {
    vi.useFakeTimers();
    const startSec = Math.floor(Date.now() / 1000);

    // Seed a cache entry expiring in 10s.
    fetchMock.mockResolvedValue(jsonResponse({ payload: { expiresAt: startSec + 10 } }));
    await getPayloadKey();

    // Jump past expiry — the next get must refetch.
    vi.advanceTimersByTime(11_000);

    fetchMock.mockClear();
    fetchMock.mockResolvedValue(jsonResponse());
    const refreshed = await getPayloadKey();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(refreshed.keyId).toBe('kid-123');
  });
});

describe('getPayloadKey — refresh-ahead window', () => {
  it('refetches when the cached key is within 30s of expiry', async () => {
    vi.useFakeTimers();
    const startSec = Math.floor(Date.now() / 1000);

    // Seed a cache entry expiring in 20s — inside the 30s refresh window.
    fetchMock.mockResolvedValue(jsonResponse({ payload: { expiresAt: startSec + 20 } }));
    const first = await getPayloadKey();
    expect(first.expiresAt).toBe(startSec + 20);

    // A second call (time barely moved) must trigger a refresh.
    fetchMock.mockClear();
    fetchMock.mockResolvedValue(jsonResponse({ payload: { keyId: 'kid-456' } }));
    const refreshed = await getPayloadKey();

    expect(fetchMock).toHaveBeenCalledTimes(1); // refresh-ahead fired
    expect(refreshed.keyId).toBe('kid-456');
  });

  it('does not refetch when the cached key is far from expiry', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ payload: { expiresAt: Math.floor(Date.now() / 1000) + 600 } }));
    await getPayloadKey();

    fetchMock.mockClear();
    await getPayloadKey();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Concurrent refresh deduplication
// ---------------------------------------------------------------------------

describe('refresh promise deduplication', () => {
  it('coalesces concurrent getPayloadKey calls into a single fetch', async () => {
    let release!: (r: Response) => void;
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );

    const p1 = getPayloadKey();
    const p2 = getPayloadKey();
    const p3 = getPayloadKey();

    expect(fetchMock).toHaveBeenCalledTimes(1); // only one in-flight fetch

    release(jsonResponse());
    const [k1, k2, k3] = await Promise.all([p1, p2, p3]);

    expect(k1).toBe(k2);
    expect(k2).toBe(k3);
  });

  it('lets new callers start a fresh fetch after a failed one resets the promise', async () => {
    // Failure must clear the in-flight promise so the next call can retry.
    fetchMock.mockResolvedValue(
      jsonResponse({ ok: false, status: 500, statusText: 'Internal Server Error' }),
    );
    const p1 = getPayloadKey();
    await expect(p1).rejects.toThrow('Failed to fetch payload key: 500 Internal Server Error');

    // After the reset, new callers must start a fresh fetch.
    fetchMock.mockClear();
    fetchMock.mockResolvedValue(jsonResponse());
    const p2 = getPayloadKey();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(p2).resolves.toMatchObject({ keyId: 'kid-123' });
  });
});

// ---------------------------------------------------------------------------
// refreshPayloadKey (forced)
// ---------------------------------------------------------------------------

describe('refreshPayloadKey', () => {
  it('forces a fresh fetch even with a valid cached key', async () => {
    await getPayloadKey();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockClear();
    fetchMock.mockResolvedValue(jsonResponse({ payload: { keyId: 'kid-refreshed' } }));
    const key = await refreshPayloadKey();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(key.keyId).toBe('kid-refreshed');

    // Subsequent get returns the refreshed cache.
    fetchMock.mockClear();
    const cached = await getPayloadKey();
    expect(cached.keyId).toBe('kid-refreshed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('always forces a new fetch even when another refresh is in flight', async () => {
    // Unlike getPayloadKey, the forced refresh path does NOT dedupe against an
    // in-flight promise — it starts its own fetch (documented force semantics).
    let release1!: (r: Response) => void;
    let release2!: (r: Response) => void;
    let call = 0;
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          call++;
          if (call === 1) release1 = resolve;
          else release2 = resolve;
        }),
    );

    const p1 = refreshPayloadKey();
    const p2 = refreshPayloadKey(); // concurrent forced refresh — second fetch
    expect(fetchMock).toHaveBeenCalledTimes(2);

    release1(jsonResponse({ payload: { keyId: 'a' } }));
    release2(jsonResponse({ payload: { keyId: 'b' } }));

    const [k1, k2] = await Promise.all([p1, p2]);
    expect(k1.keyId).toBe('a');
    expect(k2.keyId).toBe('b');

    // The final cache entry wins; no in-flight promise is left dangling.
    fetchMock.mockClear();
    const cached = await getPayloadKey();
    expect(cached.keyId).toBe('b');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// clearPayloadKey / getCachedKeyInfo
// ---------------------------------------------------------------------------

describe('clearPayloadKey', () => {
  it('drops the cached key so the next get re-fetches', async () => {
    await getPayloadKey();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    clearPayloadKey();
    expect(getCachedKeyInfo()).toBeNull();

    fetchMock.mockClear();
    await getPayloadKey();
    expect(fetchMock).toHaveBeenCalledTimes(1); // re-fetched after clear
  });

  it('is safe to call when nothing is cached', () => {
    expect(() => clearPayloadKey()).not.toThrow();
    expect(getCachedKeyInfo()).toBeNull();
  });
});

describe('getCachedKeyInfo', () => {
  it('returns null before any key has been fetched', () => {
    expect(getCachedKeyInfo()).toBeNull();
  });

  it('exposes only keyId/algorithm/expiresAt — never cryptoKey or sessionId', async () => {
    await getPayloadKey();

    const info = getCachedKeyInfo();
    expect(info).not.toBeNull();
    expect(info).toMatchObject({ keyId: 'kid-123', algorithm: 'aes-256-gcm' });
    expect(typeof (info as NonNullable<typeof info>).expiresAt).toBe('number');

    // Strictly the three info fields — no secrets leak into "info".
    expect(Object.keys(info!).sort()).toEqual(['algorithm', 'expiresAt', 'keyId']);
  });
});

// ---------------------------------------------------------------------------
// Response validation & error paths (driven through the public API)
// ---------------------------------------------------------------------------

describe('payload-key response validation', () => {
  it('throws with status and statusText on non-OK responses', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ ok: false, status: 401, statusText: 'Unauthorized' }),
    );

    await expect(getPayloadKey()).rejects.toThrow('Failed to fetch payload key: 401 Unauthorized');

    // Nothing cached after failure.
    expect(getCachedKeyInfo()).toBeNull();
  });

  it.each(['keyId', 'algorithm', 'expiresAt', 'key'] as const)(
    'rejects a payload missing %s',
    async (missing) => {
      // Exact body with the field genuinely absent — do NOT merge over a
      // keyPayload() default, which would re-populate it.
      const body = { ...keyPayload() } as Record<string, unknown>;
      delete body[missing];
      fetchMock.mockResolvedValue(jsonResponse({ jsonBody: body }));

      await expect(getPayloadKey()).rejects.toThrow('Invalid payload key response from server');
    },
  );

  it('rejects when expiresAt is not a number', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ payload: { expiresAt: 'not-a-number' } }),
    );

    await expect(getPayloadKey()).rejects.toThrow(
      'Invalid payload key response from server: unexpected field types',
    );
  });

  it('rejects when key material is not a string', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ payload: { key: 12345 } }));

    await expect(getPayloadKey()).rejects.toThrow(
      'Invalid payload key response from server: unexpected field types',
    );
  });

  it('rejects empty string key material', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ payload: { key: '' } }));

    // Empty string fails the presence check (`!data.key`) — plain message.
    await expect(getPayloadKey()).rejects.toThrow('Invalid payload key response from server');
  });

  it('rejects a missing sessionId (AAD construction would silently break)', async () => {
    const body = { ...keyPayload() } as Record<string, unknown>;
    delete body.sessionId;
    fetchMock.mockResolvedValue(jsonResponse({ jsonBody: body }));

    await expect(getPayloadKey()).rejects.toThrow('Payload key response missing sessionId');
  });

  it('rejects an empty-string sessionId', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ payload: { sessionId: '' } }));

    await expect(getPayloadKey()).rejects.toThrow('Payload key response missing sessionId');
  });

  it('propagates errors from importAesGcmKey and caches nothing', async () => {
    fetchMock.mockResolvedValue(jsonResponse());
    mockedImportKey.mockRejectedValueOnce(
      new Error('Invalid base64url key material'),
    );

    await expect(getPayloadKey()).rejects.toThrow('Invalid base64url key material');
    expect(getCachedKeyInfo()).toBeNull();

    // The next call still works — failure left no stale state.
    mockedImportKey.mockClear();
    fetchMock.mockResolvedValue(jsonResponse());
    await expect(getPayloadKey()).resolves.toMatchObject({ sessionId: 'session-abc' });
  });

  it('does not cache a key when the response fails validation', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ ok: false, status: 503, statusText: 'Service Unavailable' }),
    );

    await expect(getPayloadKey()).rejects.toThrow();
    expect(getCachedKeyInfo()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Cache-Control hygiene warning
// ---------------------------------------------------------------------------

describe('Cache-Control response hygiene', () => {
  it('does not warn when the response carries Cache-Control: no-store', async () => {
    fetchMock.mockResolvedValue(jsonResponse()); // default 'no-store'

    await getPayloadKey();

    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it('does not warn when Cache-Control is missing entirely (warns only on a present-but-wrong value)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ cacheControl: null }));

    await getPayloadKey();

    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it('warns when Cache-Control does not include no-store', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ cacheControl: 'max-age=300' }));

    await getPayloadKey();

    expect(consoleWarn).toHaveBeenCalledTimes(1);
  });

  it('does not warn when Cache-Control includes no-store alongside other directives', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ cacheControl: 'no-cache, no-store, must-revalidate' }));

    await getPayloadKey();

    expect(consoleWarn).not.toHaveBeenCalled();
  });
});
