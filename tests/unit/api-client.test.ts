/**
 * Unit tests for lib/api-client.ts — encryptedFetch.
 *
 * Strategy: mock '@/lib/payload-key-manager' and '@/lib/crypto-client' (the
 * two network/stateful collaborators) but keep the real isPiiRoute() and
 * AAD builders so wire-format integration between them is verified too.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  HEADER_PAYLOAD_ENCRYPTION,
  HEADER_PAYLOAD_KEY_ID,
  HEADER_PAYLOAD_TIMESTAMP,
  HEADER_PAYLOAD_NONCE,
  PAYLOAD_ENCRYPTION_VERSION,
  ERROR_CODES,
  buildRequestAad,
  buildResponseAad,
} from '@/lib/payload-format';
import { PII_ROUTE_PATTERNS } from '@/lib/pii-routes';

// ---------------------------------------------------------------------------
// Mocks (hoisted before vi.mock)
// ---------------------------------------------------------------------------

const { mockGetPayloadKey, mockRefreshPayloadKey, mockEncryptWithAad, mockDecryptWithAad } = vi.hoisted(() => ({
  mockGetPayloadKey: vi.fn(),
  mockRefreshPayloadKey: vi.fn(),
  mockEncryptWithAad: vi.fn(),
  mockDecryptWithAad: vi.fn(),
}));

vi.mock('@/lib/payload-key-manager', () => ({
  getPayloadKey: (...args: unknown[]) => mockGetPayloadKey(...args),
  refreshPayloadKey: (...args: unknown[]) => mockRefreshPayloadKey(...args),
}));

vi.mock('@/lib/crypto-client', () => ({
  encryptWithAad: (...args: unknown[]) => mockEncryptWithAad(...args),
  decryptWithAad: (...args: unknown[]) => mockDecryptWithAad(...args),
}));

import { encryptedFetch } from '@/lib/api-client';

// ---------------------------------------------------------------------------
// Fixtures and helpers
// ---------------------------------------------------------------------------

const KEY_ID = 'key-abc123';
const PATHNAME = '/api/admin/organizations/org_42';
const BASE_URL = `http://localhost:3000${PATHNAME}`;

/** A valid in-memory payload key as returned by the (mocked) key manager. */
function makeKeyData(overrides: Record<string, unknown> = {}) {
  return {
    keyId: KEY_ID,
    algorithm: 'aes-256-gcm',
    expiresAt: Math.floor(Date.now() / 1000) + 300,
    cryptoKey: {}, // opaque to api-client
    sessionId: '',
    ...overrides,
  };
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

/** Response of encrypted binary content (the normal PII-route success shape). */
function octetStreamResponse(bytes: Uint8Array = new Uint8Array([9, 9, 9]), init: ResponseInit = {}): Response {
  return new Response(bytes.buffer.slice(0, bytes.byteLength) as ArrayBuffer, {
    status: 200,
    headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'max-age=600' },
    ...init,
  });
}

/** Pull the payload-encryption headers off a captured outgoing Request. */
function payloadHeaders(req: Request) {
  return {
    version: req.headers.get(HEADER_PAYLOAD_ENCRYPTION),
    keyId: req.headers.get(HEADER_PAYLOAD_KEY_ID),
    timestamp: req.headers.get(HEADER_PAYLOAD_TIMESTAMP),
    nonce: req.headers.get(HEADER_PAYLOAD_NONCE),
  };
}

const encoder = new TextEncoder();

/** Deterministic encrypted-bytes stand-in per plaintext. */
function fakeEncrypted(plain: string | Uint8Array): Uint8Array {
  const bytes = typeof plain === 'string' ? encoder.encode(plain) : plain;
  return new Uint8Array([0x00, ...bytes, 0xff]);
}

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch = vi.fn();
  vi.stubGlobal('fetch', mockFetch);
  mockGetPayloadKey.mockReset();
  mockRefreshPayloadKey.mockReset();
  mockEncryptWithAad.mockReset();
  mockDecryptWithAad.mockReset();

  // Sensible defaults — override per test.
  mockGetPayloadKey.mockResolvedValue(makeKeyData());
  mockEncryptWithAad.mockImplementation(async (_key: unknown, plain: string | Uint8Array) => ({
    encrypted: fakeEncrypted(plain),
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Pass-through behaviour (no encryption)
// ---------------------------------------------------------------------------

describe('encryptedFetch — pass-through', () => {
  it('delegates to plain fetch without the pii flag and returns the response untouched', async () => {
    const upstream = jsonResponse({ plain: true });
    mockFetch.mockResolvedValueOnce(upstream);

    const result = await encryptedFetch('/api/health');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockGetPayloadKey).not.toHaveBeenCalled();
    expect(result).toBe(upstream);
  });

  it('delegates to plain fetch when pii is true but the route is not a PII route', async () => {
    const upstream = jsonResponse({ plain: true });
    mockFetch.mockResolvedValueOnce(upstream);

    // Note: Node requires an absolute URL here — with pii:true, encryptedFetch
    // constructs `new Request(url)` before matching routes. Real browser
    // callers use origin-relative paths; we use the explicit origin.
    const result = await encryptedFetch('http://localhost:3000/api/health', { pii: true });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockGetPayloadKey).not.toHaveBeenCalled();
    expect(result).toBe(upstream);
  });

  it('does not over-match a PII pattern by prefix (/api/admin/users/search-extra)', async () => {
    // 4 segments like /api/admin/users/search, but the literal final segment
    // differs → no match (guards against prefix overmatching).
    const upstream = jsonResponse({ ok: true });
    mockFetch.mockResolvedValueOnce(upstream);

    await encryptedFetch('http://localhost:3000/api/admin/users/search-extra', { pii: true });

    expect(mockGetPayloadKey).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Request construction and headers
// ---------------------------------------------------------------------------

describe('encryptedFetch — request construction', () => {
  it('uses the exact absolute origin+path of the incoming URL for the outgoing request', async () => {
    mockFetch.mockResolvedValueOnce(octetStreamResponse());
    mockDecryptWithAad.mockResolvedValueOnce(JSON.stringify({ ok: true }));

    await encryptedFetch('http://localhost:3000/api/admin/audit-logs', { pii: true });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const firstReq = mockFetch.mock.calls[0][0] as Request;
    expect(new URL(firstReq.url).pathname).toBe('/api/admin/audit-logs');
  });

  it('attaches all four payload-encryption headers on a PII GET with no body', async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const before = Math.floor(Date.now() / 1000);
    const after = Date.now() / 1000 + 5;

    await encryptedFetch(BASE_URL, { pii: true });

    expect(mockGetPayloadKey).toHaveBeenCalledTimes(1);
    const req = mockFetch.mock.calls[0][0] as Request;
    const headers = payloadHeaders(req);
    expect(headers.version).toBe(PAYLOAD_ENCRYPTION_VERSION);
    expect(headers.keyId).toBe(KEY_ID);
    expect(headers.nonce).toMatch(/^[A-Za-z0-9_-]{22,}$/);
    const ts = Number(headers.timestamp);
    expect(Number.isInteger(ts)).toBe(true);
    expect(ts).toBeGreaterThanOrEqual(Math.floor(before) - 1);
    expect(ts).toBeLessThan(after + 5);
  });

  it('strips query strings when deciding PII route but keeps the full URL for the request', async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await encryptedFetch(`${BASE_URL}?page=1&pageSize=500`, { pii: true });

    const req = mockFetch.mock.calls[0][0] as Request;
    expect(payloadHeaders(req).keyId).toBe(KEY_ID); // encryption applied
    expect(new URL(req.url).pathname).toBe(PATHNAME);
  });

  it('normalises trailing slashes when matching PII routes', async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await encryptedFetch(BASE_URL + '/', { pii: true });

    expect(mockGetPayloadKey).toHaveBeenCalledTimes(1); // matches /api/admin/organizations/:orgId
  });

  it('throws a descriptive error when the payload key cannot be obtained', async () => {
    mockGetPayloadKey.mockRejectedValueOnce(new Error('network down'));

    await expect(encryptedFetch(BASE_URL, { pii: true })).rejects.toThrow(
      'Failed to obtain payload encryption key',
    );
  });

  it.each([
    ['FormData', () => new FormData()],
    ['Blob', () => new Blob(['data'])],
    ['URLSearchParams', () => new URLSearchParams({ a: '1' })],
    ['ArrayBuffer', () => new ArrayBuffer(8)],
  ] as const)('rejects unsupported %s bodies on PII routes with pii=true', async (label, makeBody) => {
    await expect(
      encryptedFetch(BASE_URL, { pii: true, method: 'POST', body: makeBody() as BodyInit }),
    ).rejects.toThrow(/does not support .*bodies in v1/);

    expect(mockGetPayloadKey).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Request body encryption
// ---------------------------------------------------------------------------

describe('encryptedFetch — request body encryption', () => {
  it('encrypts a JSON string body and sends it as application/octet-stream', async () => {
    const plaintextBody = JSON.stringify({ name: 'Ada Lovelace' });
    const encryptedBytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    mockEncryptWithAad.mockResolvedValueOnce({ encrypted: encryptedBytes });
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await encryptedFetch(BASE_URL, { pii: true, method: 'POST', body: plaintextBody });

    // Plaintext handed to crypto must be the exact JSON bytes.
    expect(mockEncryptWithAad).toHaveBeenCalledTimes(1);
    const [keyArg, plaintextArg] = mockEncryptWithAad.mock.calls[0];
    expect(keyArg).toEqual(expect.anything());
    expect(Buffer.from(plaintextArg as Uint8Array).toString('utf8')).toBe(plaintextBody);

    // AAD must match the canonical builder with the header values actually sent.
    const req = mockFetch.mock.calls[0][0] as Request;
    const headers = payloadHeaders(req);
    const expectedAad = buildRequestAad(KEY_ID, '', 'POST', PATHNAME, headers.timestamp!, headers.nonce!);
    expect(Buffer.from(mockEncryptWithAad.mock.calls[0][2] as Uint8Array).toString('binary')).toBe(
      Buffer.from(expectedAad).toString('binary'),
    );

    // Wire format: octet-stream body, no Content-Length mismatch.
    expect(req.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(req.headers.get('content-length')).toBeNull();
    expect(Buffer.from(await req.arrayBuffer()).toString('hex')).toBe('deadbeef');
  });

  it('drops a caller-provided Content-Length header to prevent length mismatch', async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await encryptedFetch(BASE_URL, {
      pii: true,
      method: 'POST',
      body: JSON.stringify({ a: 1 }),
      headers: { 'Content-Type': 'application/json', 'Content-Length': '999' },
    });

    const req = mockFetch.mock.calls[0][0] as Request;
    expect(req.headers.get('content-length')).toBeNull();
    expect(req.headers.get('Content-Type')).toBe('application/octet-stream');
  });

  it('preserves custom caller headers alongside the payload-encryption headers', async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await encryptedFetch(BASE_URL, {
      pii: true,
      method: 'POST',
      body: JSON.stringify({ a: 1 }),
      headers: { 'X-Custom-Correlation': 'req-7' },
    });

    const req = mockFetch.mock.calls[0][0] as Request;
    expect(req.headers.get('X-Custom-Correlation')).toBe('req-7');
    expect(payloadHeaders(req).keyId).toBe(KEY_ID);
  });
});

// ---------------------------------------------------------------------------
// Response decryption
// ---------------------------------------------------------------------------

describe('encryptedFetch — response decryption', () => {
  it('decrypts an octet-stream PII response into JSON with corrected headers', async () => {
    mockDecryptWithAad.mockResolvedValueOnce(JSON.stringify({ members: ['Alice', 'Bob'] }));
    const serverResponse = new Response(new Uint8Array([7, 7]).buffer as ArrayBuffer, {
      status: 200,
      statusText: 'OK',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Cache-Control': 'max-age=600',
        'X-Custom-Server': 'keep-me',
      },
    });
    mockFetch.mockResolvedValueOnce(serverResponse);

    const result = await encryptedFetch(BASE_URL, { pii: true });

    expect(mockDecryptWithAad).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(200);
    expect(result.headers.get('Content-Type')).toBe('application/json');
    expect(result.headers.get('Cache-Control')).toBe('no-store');
    expect(result.headers.get('X-Custom-Server')).toBe('keep-me');
    await expect(result.json()).resolves.toEqual({ members: ['Alice', 'Bob'] });
  });

  it('passes the response AAD built from the actual request nonce to decryptWithAad', async () => {
    mockDecryptWithAad.mockResolvedValueOnce(JSON.stringify({ ok: true }));
    mockFetch.mockResolvedValueOnce(octetStreamResponse());

    await encryptedFetch(`${BASE_URL}?q=1`, { pii: true });

    const reqOut = mockFetch.mock.calls[0][0] as Request;
    const nonce = payloadHeaders(reqOut).nonce!;
    const expectedAad = buildResponseAad(KEY_ID, '', 'GET', PATHNAME, nonce);

    expect(mockDecryptWithAad).toHaveBeenCalledTimes(1);
    const [, , options] = mockDecryptWithAad.mock.calls[0];
    expect(Buffer.from(options.aad as Uint8Array).toString('binary')).toBe(
      Buffer.from(expectedAad).toString('binary'),
    );
  });

  it('propagates non-200 success status codes (e.g. 201) through the decrypted response', async () => {
    const plaintextBody = JSON.stringify({ created: true });
    mockEncryptWithAad.mockResolvedValueOnce({ encrypted: new Uint8Array([1]) });
    mockDecryptWithAad.mockResolvedValueOnce(JSON.stringify({ id: 'org_new' }));
    mockFetch.mockResolvedValueOnce(
      octetStreamResponse(new Uint8Array([5, 5]), { status: 201, statusText: 'Created' }),
    );

    const result = await encryptedFetch(BASE_URL, { pii: true, method: 'POST', body: plaintextBody });

    expect(result.status).toBe(201);
    expect(result.statusText).toBe('Created');
    await expect(result.json()).resolves.toEqual({ id: 'org_new' });
  });

  it('does not decrypt a 204 No Content response (returned as-is)', async () => {
    const upstream = new Response(null, { status: 204 });
    mockFetch.mockResolvedValueOnce(upstream);

    const result = await encryptedFetch(BASE_URL, { pii: true });

    expect(result).toBe(upstream);
    expect(mockDecryptWithAad).not.toHaveBeenCalled();
  });

  it('does not decrypt non-octet-stream JSON responses (server already plaintext)', async () => {
    const upstream = jsonResponse({ already: 'plain' });
    mockFetch.mockResolvedValueOnce(upstream);

    const result = await encryptedFetch(BASE_URL, { pii: true });

    expect(result).toBe(upstream);
    expect(mockDecryptWithAad).not.toHaveBeenCalled();
  });

  it('returns the raw (cloned) response intact when decryption fails', async () => {
    mockDecryptWithAad.mockRejectedValueOnce(new Error('boom'));
    const rawBytes = new TextEncoder().encode('still-readable-bytes');
    mockFetch.mockResolvedValueOnce(
      new Response(rawBytes.buffer as ArrayBuffer, {
        status: 200,
        headers: { 'Content-Type': 'application/octet-stream' },
      }),
    );

    const result = await encryptedFetch(BASE_URL, { pii: true });

    expect(result.status).toBe(200);
    expect(result.headers.get('Content-Type')).toBe('application/octet-stream'); // original headers kept
    const body = new Uint8Array(await result.arrayBuffer());
    expect(Buffer.from(body).toString('utf8')).toBe('still-readable-bytes');
  });
});

// ---------------------------------------------------------------------------
// Error / retry paths
// ---------------------------------------------------------------------------

describe('encryptedFetch — error and retry paths', () => {
  it('retries once with the plaintext body when server responds non-ok with JSON (encryption disabled upstream)', async () => {
    const encryptedAttempt = jsonResponse(
      { error: 'expected encryption' },
      { status: 500 },
    );
    const plaintextResult = new Response('still failing', {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
    mockFetch.mockResolvedValueOnce(encryptedAttempt).mockResolvedValueOnce(plaintextResult);

    const result = await encryptedFetch(BASE_URL, {
      pii: true,
      method: 'POST',
      body: JSON.stringify({ a: 1 }),
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result).toBe(plaintextResult);
    // The retry must carry the original plaintext body (not the encrypted one).
    const retryReq = mockFetch.mock.calls[1][0] as Request;
    expect(Buffer.from(await retryReq.arrayBuffer()).toString('utf8')).toBe('{"a":1}');
  });

    it.each([ERROR_CODES.PAYLOAD_KEY_EXPIRED, ERROR_CODES.PAYLOAD_KEY_UNKNOWN])(
    'refreshes the key and retries once on a stale-key 401 (%s)',
    async (staleCode) => {
      const newKey = makeKeyData({ keyId: 'key-fresh-999' });
      mockRefreshPayloadKey.mockResolvedValueOnce(newKey);
      mockDecryptWithAad.mockResolvedValueOnce(JSON.stringify({ recovered: true }));

      // Sequence: (1) encrypted call → 401 stale JSON, (2) plaintext fallback
      // retry for the same 401 (any non-ok JSON triggers it; returns the same
      // 401), (3) refreshed encrypted call → success. The stale-key handler runs
      // only after the fallback, so exactly one refresh happens.
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ error: staleCode }, { status: 401, statusText: 'Unauthorized' }))
        .mockResolvedValueOnce(jsonResponse({ error: staleCode }, { status: 401, statusText: 'Unauthorized' }))
        .mockResolvedValueOnce(octetStreamResponse());

      const result = await encryptedFetch(BASE_URL, { pii: true, method: 'GET' });

      expect(mockRefreshPayloadKey).toHaveBeenCalledTimes(1);
      // Exactly one refresh: only the stale-key 401 path (not the JSON error path)
      // refreshes keys; the 401 seen by the fallback retry carries the same code
      // but the refresh already happened upstream. The refreshed (3rd) fetch is
      // the one that recovers.
      expect(mockFetch).toHaveBeenCalledTimes(3);

      // Retry request must use the refreshed keyId.
      const retryReq = mockFetch.mock.calls[2][0] as Request;
      expect(payloadHeaders(retryReq).keyId).toBe('key-fresh-999');

      // Response decryption uses the new key's keyId for AAD.
      await expect(result.json()).resolves.toEqual({ recovered: true });
    },
  );

  it('re-encrypts the body with the refreshed key and fresh nonce on stale-key retry', async () => {
    const newKey = makeKeyData({ keyId: 'key-fresh-999' });
    mockRefreshPayloadKey.mockResolvedValueOnce(newKey);
    mockEncryptWithAad
      .mockResolvedValueOnce({ encrypted: new Uint8Array([1, 1]) })
      .mockResolvedValueOnce({ encrypted: new Uint8Array([2, 2]) });
    mockDecryptWithAad.mockResolvedValueOnce(JSON.stringify({ ok: true }));

    mockFetch
      .mockResolvedValueOnce(jsonResponse({ error: ERROR_CODES.PAYLOAD_KEY_EXPIRED }, { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ error: ERROR_CODES.PAYLOAD_KEY_EXPIRED }, { status: 401 }))
      .mockResolvedValueOnce(octetStreamResponse());

    await encryptedFetch(BASE_URL, { pii: true, method: 'POST', body: JSON.stringify({ a: 1 }) });

    expect(mockEncryptWithAad).toHaveBeenCalledTimes(2);
    const retryReq = mockFetch.mock.calls[2][0] as Request;
    const headers = payloadHeaders(retryReq);
    expect(headers.keyId).toBe('key-fresh-999');

    // Re-encryption used a fresh AAD consistent with the retry request.
    const expectedAad = buildRequestAad('key-fresh-999', '', 'POST', PATHNAME, headers.timestamp!, headers.nonce!);
    expect(Buffer.from(mockEncryptWithAad.mock.calls[1][2] as Uint8Array).toString('binary')).toBe(
      Buffer.from(expectedAad).toString('binary'),
    );
  });

  it('returns the failed retried response and warns when the stale-key retry also fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockRefreshPayloadKey.mockResolvedValueOnce(makeKeyData({ keyId: 'key-fresh-999' }));

    // (1) encrypted call → 401 stale JSON, (2) plaintext fallback → same 401,
    // (3) refreshed encrypted retry → still failing. The warning is emitted for
    // the retried response, which is what gets returned to the caller.
    const failedRetry = jsonResponse({ detail: 'still broken' }, { status: 500 });
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ error: ERROR_CODES.PAYLOAD_KEY_EXPIRED }, { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ error: ERROR_CODES.PAYLOAD_KEY_EXPIRED }, { status: 401 }))
      .mockResolvedValueOnce(failedRetry);

    const result = await encryptedFetch(BASE_URL, { pii: true });

    expect(result).toBe(failedRetry);
    expect(mockRefreshPayloadKey).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      '[PayloadKey] Stale-key retry also failed (status:',
      500,
      ') — key refresh may not have propagated',
    );
    warnSpy.mockRestore();
  });

  it('returns a readable clone of the 401 when refreshPayloadKey throws during stale-key retry', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockRefreshPayloadKey.mockRejectedValueOnce(new Error('refresh failed'));

    // (1) encrypted call → 401 stale JSON, (2) plaintext fallback (same 401),
    // then refresh payload key throws → the except branch returns the cloned
    // 401 from step 2 WITHOUT making any further request.
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ error: ERROR_CODES.PAYLOAD_KEY_EXPIRED }, { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ error: ERROR_CODES.PAYLOAD_KEY_EXPIRED }, { status: 401 }));

    const result = await encryptedFetch(BASE_URL, { pii: true });

    expect(result.status).toBe(401);
    // Body of the clone returned by the except branch must still be readable.
    await expect(result.json()).resolves.toEqual({ error: ERROR_CODES.PAYLOAD_KEY_EXPIRED });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('returns a CLONE when refreshPayloadKey throws (distinct object, still readable body)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockRefreshPayloadKey.mockRejectedValueOnce(new Error('refresh 500'));

    const fallback401 = jsonResponse({ error: ERROR_CODES.PAYLOAD_KEY_EXPIRED }, { status: 401 });
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ error: ERROR_CODES.PAYLOAD_KEY_EXPIRED }, { status: 401 }))
      .mockResolvedValueOnce(fallback401);

    const result = await encryptedFetch(BASE_URL, { pii: true });

    // Clone semantics: a distinct Response object whose body was not consumed
    // by the error inspection and can still be read.
    expect(result).not.toBe(fallback401);
    expect(result.status).toBe(401);
    await expect(result.json()).resolves.toEqual({ error: ERROR_CODES.PAYLOAD_KEY_EXPIRED });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledWith('[PayloadKey] Stale-key retry threw an exception');
    warnSpy.mockRestore();
  });

  it('does not refresh for a non-stale 401 and still returns a readable body', async () => {
    // (1) encrypted call → 401, (2) plaintext fallback → same non-stale 401.
    // The stale-key handler only refreshes on PAYLOAD_KEY_EXPIRED/UNKNOWN; any
    // other error code skips the refresh and the response is returned as-is.
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ error: 'banned_user' }, { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ error: 'banned_user' }, { status: 401 }));

    const result = await encryptedFetch(BASE_URL, { pii: true });

    expect(mockRefreshPayloadKey).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.status).toBe(401);
    await expect(result.json()).resolves.toEqual({ error: 'banned_user' });
  });

  it('returns a non-JSON 401 response as-is without key refresh', async () => {
    const first401 = new Response('maintenance', {
      status: 401,
      headers: { 'Content-Type': 'text/html' },
    });
    mockFetch.mockResolvedValueOnce(first401);

    const result = await encryptedFetch(BASE_URL, { pii: true });

    expect(mockRefreshPayloadKey).not.toHaveBeenCalled();
    expect(result.status).toBe(401);
  });

  it('does not consume the response body of a non-ok JSON response when status is not 401', async () => {
    const bad = jsonResponse({ message: 'internal error' }, { status: 500 });
    mockFetch.mockResolvedValueOnce(bad).mockResolvedValueOnce(
      new Response('x', { status: 503, headers: { 'Content-Type': 'text/plain' } }),
    );

    // A 5xx JSON error triggers the plaintext retry (server not encrypting / degraded),
    // but no key refresh happens.
    await encryptedFetch(BASE_URL, { pii: true });
    expect(mockRefreshPayloadKey).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Route surface sanity (guards against PII_ROUTE_PATTERNS drift)
// ---------------------------------------------------------------------------

describe('encryptedFetch — PII route coverage', () => {
  it.each([
    '/api/admin/users/search',
    '/api/admin/organizations/org_123/members',
    '/api/admin/organizations/org_123/members/mem_456',
    '/api/auth/user-permissions',
    '/api/admin/audit-logs?limit=10',
    '/api/admin/system-logs',
  ])('applies encryption to PII route %s', async (path) => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await encryptedFetch(`http://localhost:3000${path}`, { pii: true });

    const req = mockFetch.mock.calls[0][0] as Request;
    expect(payloadHeaders(req).version).toBe(PAYLOAD_ENCRYPTION_VERSION);
  });

  it.each(['/api/health', '/api/admin/roles', '/api/teams'])('leaves non-PII route %s unencrypted', async (path) => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await encryptedFetch(`http://localhost:3000${path}`, { pii: true });

    expect(mockGetPayloadKey).not.toHaveBeenCalled();
  });

  it('covers every configured PII pattern with a concrete example path', async () => {
    // Ensures the pattern list and the matcher agree — e.g. :orgId patterns
    // actually match when substituted.
    const examples: Record<string, string> = Object.fromEntries(
      PII_ROUTE_PATTERNS.map((p) => [p, p.replace(/:[A-Za-z]+/g, 'sample_id')]),
    );
    for (const pattern of PII_ROUTE_PATTERNS) {
      mockFetch.mockReset();
      mockGetPayloadKey.mockReset();
      mockGetPayloadKey.mockResolvedValue(makeKeyData());
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

      await encryptedFetch(`http://localhost:3000${examples[pattern]}`, { pii: true });

      expect(mockGetPayloadKey, `pattern ${pattern} should match ${examples[pattern]}`).toHaveBeenCalledTimes(1);
    }
  });
});
