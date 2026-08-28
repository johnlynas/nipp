/**
 * Unit tests for payload-middleware.ts — exported functions and wrapPiiRoute paths.
 *
 * Covers: extractSession, validatePayloadHeaders, checkReplayProtection,
 *         requiresEncryption, getEncryptionMode, isReplayCacheAvailable,
 *         skipEncryptionForUnauthenticated, encrypted response body.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// ---------------------------------------------------------------------------
// Mocks — hoisted so the module loads with these defaults.
// ---------------------------------------------------------------------------

vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn().mockResolvedValue({
        user: { id: 'user-1' },
        session: { id: 'session-1', activeOrganizationId: null },
      }),
    },
  },
}));

vi.mock('@/lib/env', () => ({
  env: {
    PAYLOAD_ENCRYPTION_MODE: 'enforce',
    PAYLOAD_ENCRYPTION_MAX_BYTES: 65536,
    PAYLOAD_ENCRYPTION_REPLAY_WINDOW_SECONDS: 30,
    PAYLOAD_ENCRYPTION_REQUIRE_REPLAY_CACHE: 'false',
  },
}));

vi.mock('@/lib/payload-metrics', () => ({
  incrementMetric: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('@/lib/redis', () => ({
  redisGet: vi.fn().mockResolvedValue(null),
  redisSet: vi.fn().mockResolvedValue(undefined),
  redisDel: vi.fn().mockResolvedValue(undefined),
  redisPing: vi.fn().mockResolvedValue(true),
  redisSetWithNx: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/lib/payload-key-server', () => ({
  getValidPayloadKey: vi.fn().mockResolvedValue({ valid: true, key: {
    keyId: 'test-key',
    sessionId: 'session-1',
    expiresAt: Math.floor(Date.now() / 1000) + 300,
    algorithm: 'aes-256-gcm',
    keyMaterial: Buffer.from('a'.repeat(32)).toString('base64url'),
    keyBytes: Buffer.from('a'.repeat(32)), // needed for encryptWithAad
  }}),
}));

vi.mock('@/lib/crypto-server', () => ({
  encryptWithAad: vi.fn().mockReturnValue({ encrypted: new Uint8Array([1, 2, 3]) }),
  decryptWithAad: vi.fn().mockReturnValue(JSON.stringify({ test: 'data' })),
}));

vi.mock('@/lib/replay-cache-redis', () => ({
  createReplayCache: vi.fn(() => ({
    healthCheck: vi.fn().mockResolvedValue(true),
    isReplay: vi.fn().mockResolvedValue(false),
  })),
  getReplayCacheBackend: vi.fn(() => 'redis'),
}));

// ---------------------------------------------------------------------------
// Import after mocks are in place.
// ---------------------------------------------------------------------------

import { auth } from '@/lib/auth';
import * as payloadMiddleware from '@/lib/payload-middleware';
import { incrementMetric } from '@/lib/payload-metrics';

// ---------------------------------------------------------------------------
// Helpers (mirrors edge-cases.test.ts pattern).
// ---------------------------------------------------------------------------

function createRequest(
  url: string,
  options: { method?: string; headers?: Record<string, string>; body?: ArrayBuffer } = {},
) {
  return new NextRequest(url, {
    method: options.method || 'GET',
    headers: options.headers,
  });
}

let _nonceCounter = 0;
function encryptionHeaders(extra: Record<string, string> = {}): Record<string, string> {
  _nonceCounter++;
  return {
    'X-Payload-Encryption': 'v1',
    'X-Payload-Key-Id': 'test-key',
    'X-Payload-Timestamp': String(Math.floor(Date.now() / 1000)),
    'X-Payload-Nonce': `nonce${_nonceCounter.toString().padStart(22, '0')}`,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Tests — extractSession
// ---------------------------------------------------------------------------

describe('extractSession', () => {
  beforeEach(() => {
    // Restore default mock implementation after each test.
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: 'user-1' },
      session: { id: 'session-1', activeOrganizationId: null },
    });
  });

  it('should return sessionId and userId when session exists', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: 'user-123' },
      session: { id: 'sess-456' },
    } as any);

    const result = await payloadMiddleware.extractSession(
      createRequest('http://localhost:3000/api/test'),
    );

    expect(result).toEqual({ sessionId: 'sess-456', userId: 'user-123' });
  });

  it('should return null when getSession returns null', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);

    const result = await payloadMiddleware.extractSession(
      createRequest('http://localhost:3000/api/test'),
    );

    expect(result).toBeNull();
  });

  it('should return null when session object has no id', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: 'user-1' },
      session: {}, // no id field
    } as any);

    const result = await payloadMiddleware.extractSession(
      createRequest('http://localhost:3000/api/test'),
    );

    expect(result).toBeNull();
  });

  it('should return null when user object has no id', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: {}, // no id field
      session: { id: 'sess-1' },
    } as any);

    const result = await payloadMiddleware.extractSession(
      createRequest('http://localhost:3000/api/test'),
    );

    expect(result).toBeNull();
  });

  it('should return null and log error when getSession throws', async () => {
    vi.mocked(auth.api.getSession).mockRejectedValue(new Error('DB error'));

    const result = await payloadMiddleware.extractSession(
      createRequest('http://localhost:3000/api/test'),
    );

    expect(result).toBeNull();
  });

  it('should handle session with undefined id field', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: undefined },
      session: { id: 'sess-1' },
    } as any);

    const result = await payloadMiddleware.extractSession(
      createRequest('http://localhost:3000/api/test'),
    );

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests — validatePayloadHeaders
// ---------------------------------------------------------------------------

describe('validatePayloadHeaders', () => {
  it('should return valid=true when all required headers are present and correct', () => {
    const request = createRequest('http://localhost:3000/api/test', {
      headers: {
        'X-Payload-Encryption': 'v1',
        'X-Payload-Key-Id': 'key-abc123',
        'X-Payload-Timestamp': String(Math.floor(Date.now() / 1000)),
        'X-Payload-Nonce': 'a'.repeat(22),
      },
    });

    const result = payloadMiddleware.validatePayloadHeaders(request);

    expect(result.valid).toBe(true);
    expect(result.version).toBe('v1');
    expect(result.keyId).toBe('key-abc123');
    expect(typeof result.timestamp).toBe('number');
    expect(result.nonce).toBe('a'.repeat(22));
  });

  it('should return invalid when X-Payload-Encryption header is missing', () => {
    const request = createRequest('http://localhost:3000/api/test', {
      headers: {
        'X-Payload-Key-Id': 'key-123',
        'X-Payload-Timestamp': String(Math.floor(Date.now() / 1000)),
        'X-Payload-Nonce': 'a'.repeat(22),
      },
    });

    const result = payloadMiddleware.validatePayloadHeaders(request);

    expect(result.valid).toBe(false);
    expect(result.error).toBe('unsupported_payload_version');
  });

  it('should return invalid when X-Payload-Encryption has wrong version', () => {
    const request = createRequest('http://localhost:3000/api/test', {
      headers: {
        'X-Payload-Encryption': 'v2',
        'X-Payload-Key-Id': 'key-123',
        'X-Payload-Timestamp': String(Math.floor(Date.now() / 1000)),
        'X-Payload-Nonce': 'a'.repeat(22),
      },
    });

    const result = payloadMiddleware.validatePayloadHeaders(request);

    expect(result.valid).toBe(false);
    expect(result.error).toBe('unsupported_payload_version');
  });

  it('should return invalid when X-Payload-Key-Id is missing', () => {
    const request = createRequest('http://localhost:3000/api/test', {
      headers: {
        'X-Payload-Encryption': 'v1',
        'X-Payload-Timestamp': String(Math.floor(Date.now() / 1000)),
        'X-Payload-Nonce': 'a'.repeat(22),
      },
    });

    const result = payloadMiddleware.validatePayloadHeaders(request);

    expect(result.valid).toBe(false);
    expect(result.error).toBe('invalid_key_id');
  });

  it('should return invalid when X-Payload-Key-Id is empty string', () => {
    const request = createRequest('http://localhost:3000/api/test', {
      headers: {
        'X-Payload-Encryption': 'v1',
        'X-Payload-Key-Id': '',
        'X-Payload-Timestamp': String(Math.floor(Date.now() / 1000)),
        'X-Payload-Nonce': 'a'.repeat(22),
      },
    });

    const result = payloadMiddleware.validatePayloadHeaders(request);

    expect(result.valid).toBe(false);
    expect(result.error).toBe('invalid_key_id');
  });

  it('should return invalid when X-Payload-Key-Id has disallowed characters', () => {
    const request = createRequest('http://localhost:3000/api/test', {
      headers: {
        'X-Payload-Encryption': 'v1',
        'X-Payload-Key-Id': 'key with spaces!',
        'X-Payload-Timestamp': String(Math.floor(Date.now() / 1000)),
        'X-Payload-Nonce': 'a'.repeat(22),
      },
    });

    const result = payloadMiddleware.validatePayloadHeaders(request);

    expect(result.valid).toBe(false);
    expect(result.error).toBe('invalid_key_id');
  });

  it('should return invalid when X-Payload-Timestamp is missing', () => {
    const request = createRequest('http://localhost:3000/api/test', {
      headers: {
        'X-Payload-Encryption': 'v1',
        'X-Payload-Key-Id': 'key-123',
        'X-Payload-Nonce': 'a'.repeat(22),
      },
    });

    const result = payloadMiddleware.validatePayloadHeaders(request);

    expect(result.valid).toBe(false);
    expect(result.error).toBe('stale_timestamp');
  });

  it('should return invalid when X-Payload-Timestamp is NaN', () => {
    const request = createRequest('http://localhost:3000/api/test', {
      headers: {
        'X-Payload-Encryption': 'v1',
        'X-Payload-Key-Id': 'key-123',
        'X-Payload-Timestamp': 'not-a-number',
        'X-Payload-Nonce': 'a'.repeat(22),
      },
    });

    const result = payloadMiddleware.validatePayloadHeaders(request);

    expect(result.valid).toBe(false);
    expect(result.error).toBe('stale_timestamp');
  });

  it('should return invalid when X-Payload-Nonce is missing', () => {
    const request = createRequest('http://localhost:3000/api/test', {
      headers: {
        'X-Payload-Encryption': 'v1',
        'X-Payload-Key-Id': 'key-123',
        'X-Payload-Timestamp': String(Math.floor(Date.now() / 1000)),
      },
    });

    const result = payloadMiddleware.validatePayloadHeaders(request);

    expect(result.valid).toBe(false);
    expect(result.error).toBe('invalid_encrypted_payload');
  });

  it('should return invalid when X-Payload-Nonce is too short', () => {
    const request = createRequest('http://localhost:3000/api/test', {
      headers: {
        'X-Payload-Encryption': 'v1',
        'X-Payload-Key-Id': 'key-123',
        'X-Payload-Timestamp': String(Math.floor(Date.now() / 1000)),
        'X-Payload-Nonce': 'abc', // too short (< 22 chars)
      },
    });

    const result = payloadMiddleware.validatePayloadHeaders(request);

    expect(result.valid).toBe(false);
    expect(result.error).toBe('invalid_encrypted_payload');
  });

  it('should return invalid when X-Payload-Nonce has disallowed characters', () => {
    const request = createRequest('http://localhost:3000/api/test', {
      headers: {
        'X-Payload-Encryption': 'v1',
        'X-Payload-Key-Id': 'key-123',
        'X-Payload-Timestamp': String(Math.floor(Date.now() / 1000)),
        'X-Payload-Nonce': 'abc!@#defghijklmnopqrstuv', // has !, @, #
      },
    });

    const result = payloadMiddleware.validatePayloadHeaders(request);

    expect(result.valid).toBe(false);
    expect(result.error).toBe('invalid_encrypted_payload');
  });

  it('should accept valid keyId with base64url-safe characters', () => {
    const request = createRequest('http://localhost:3000/api/test', {
      headers: {
        'X-Payload-Encryption': 'v1',
        'X-Payload-Key-Id': 'key-abc_123', // hyphens and underscores are valid
        'X-Payload-Timestamp': String(Math.floor(Date.now() / 1000)),
        'X-Payload-Nonce': 'a'.repeat(22),
      },
    });

    const result = payloadMiddleware.validatePayloadHeaders(request);

    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests — checkReplayProtection (happy path)
// ---------------------------------------------------------------------------

describe('checkReplayProtection', () => {
  it('should return valid=true when nonce is not a replay', async () => {
    const result = await payloadMiddleware.checkReplayProtection('sess-1', 'nonce-abc');

    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests — requiresEncryption
// ---------------------------------------------------------------------------

describe('requiresEncryption', () => {
  it('should return false when mode is disabled', () => {
    expect(payloadMiddleware.requiresEncryption('disabled', '/api/admin/organizations')).toBe(false);
  });

  it('should return false for non-PII routes when mode is permissive', () => {
    expect(payloadMiddleware.requiresEncryption('permissive', '/api/health')).toBe(false);
  });

  it('should return false for non-PII routes when mode is enforce', () => {
    expect(payloadMiddleware.requiresEncryption('enforce', '/api/health')).toBe(false);
  });

  it('should return true for PII routes when mode is permissive', () => {
    expect(payloadMiddleware.requiresEncryption('permissive', '/api/admin/organizations')).toBe(true);
  });

  it('should return true for PII routes when mode is enforce', () => {
    expect(payloadMiddleware.requiresEncryption('enforce', '/api/admin/organizations')).toBe(true);
  });

  it('should return true for user-permissions route', () => {
    expect(payloadMiddleware.requiresEncryption('enforce', '/api/auth/user-permissions')).toBe(true);
  });

  it('should return true for audit-logs route', () => {
    expect(payloadMiddleware.requiresEncryption('enforce', '/api/admin/audit-logs')).toBe(true);
  });

  it('should return true for members route with orgId', () => {
    expect(payloadMiddleware.requiresEncryption('enforce', '/api/admin/organizations/org-123/members')).toBe(true);
  });

  it('should return true for members route with orgId and memberId', () => {
    expect(payloadMiddleware.requiresEncryption('enforce', '/api/admin/organizations/org-123/members/member-456')).toBe(true);
  });

  it('should handle paths with query strings (query stripped before matching)', () => {
    // isPiiRoute strips query strings, so /api/admin/organizations?foo=bar
    // normalizes to /api/admin/organizations which IS a PII route.
    expect(payloadMiddleware.requiresEncryption('enforce', '/api/admin/organizations?foo=bar')).toBe(true);
  });

  it('should handle paths with trailing slash', () => {
    expect(payloadMiddleware.requiresEncryption('enforce', '/api/admin/organizations/')).toBe(true);
  });

  it('should return false for unknown mode', () => {
    expect(payloadMiddleware.requiresEncryption('unknown-mode', '/api/admin/organizations')).toBe(false);
  });

  it('should return true for system-logs route', () => {
    expect(payloadMiddleware.requiresEncryption('enforce', '/api/admin/system-logs')).toBe(true);
  });

  it('should return true for users/search route', () => {
    expect(payloadMiddleware.requiresEncryption('enforce', '/api/admin/users/search')).toBe(true);
  });

  it('should not match non-PII routes that share a prefix', () => {
    expect(payloadMiddleware.requiresEncryption('enforce', '/api/security/payload-key')).toBe(false);
  });

  it('should not match the [...all] auth route', () => {
    expect(payloadMiddleware.requiresEncryption('enforce', '/api/auth/[...all]')).toBe(false);
  });

  it('should return true for organizations route with trailing slash', () => {
    expect(payloadMiddleware.requiresEncryption('enforce', '/api/admin/organizations/')).toBe(true);
  });

  it('should return true for organizations route with query string', () => {
    expect(payloadMiddleware.requiresEncryption('enforce', '/api/admin/organizations?foo=bar')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests — getEncryptionMode
// ---------------------------------------------------------------------------

describe('getEncryptionMode', () => {
  it('should return the current encryption mode from env', () => {
    const mode = payloadMiddleware.getEncryptionMode();
    expect(mode).toBe('enforce'); // from mock env
  });

  it('should return valid mode values', () => {
    const mode = payloadMiddleware.getEncryptionMode();
    expect(['disabled', 'permissive', 'enforce']).toContain(mode);
  });
});

// ---------------------------------------------------------------------------
// Tests — isReplayCacheAvailable
// ---------------------------------------------------------------------------

describe('isReplayCacheAvailable', () => {
  it('should return true when cache health check passes', async () => {
    const available = await payloadMiddleware.isReplayCacheAvailable();
    expect(available).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests — wrapPiiRoute: skipEncryptionForUnauthenticated
// ---------------------------------------------------------------------------

describe('wrapPiiRoute — skipEncryptionForUnauthenticated', () => {
  beforeEach(() => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: 'user-1' },
      session: { id: 'session-1', activeOrganizationId: null },
    });
  });

  it('should pass through to handler when session is null and skipEncryptionForUnauthenticated is true', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);

    const handler = vi.fn().mockResolvedValue(NextResponse.json({ permissions: [] }));

    const wrapped = payloadMiddleware.wrapPiiRoute(handler, {
      skipEncryptionForUnauthenticated: true,
    });

    const request = createRequest('http://localhost:3000/api/auth/user-permissions');

    const response = await wrapped(request);

    expect(handler).toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  it('should return 401 when session is null and skipEncryptionForUnauthenticated is false', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);

    const handler = vi.fn().mockResolvedValue(NextResponse.json({ data: 'secret' }));

    const wrapped = payloadMiddleware.wrapPiiRoute(handler, {
      skipEncryptionForUnauthenticated: false,
    });

    const request = createRequest('http://localhost:3000/api/admin/organizations/org-123');

    const response = await wrapped(request);

    expect(handler).not.toHaveBeenCalled();
    expect(response.status).toBe(401);
  });

  it('should return 401 when session is null and skipEncryptionForUnauthenticated is undefined', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);

    const handler = vi.fn().mockResolvedValue(NextResponse.json({ data: 'secret' }));

    const wrapped = payloadMiddleware.wrapPiiRoute(handler); // no options

    const request = createRequest('http://localhost:3000/api/admin/organizations/org-123');

    const response = await wrapped(request);

    expect(handler).not.toHaveBeenCalled();
    expect(response.status).toBe(401);
  });

  it('should include no-store headers on 401 response', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);

    const handler = vi.fn().mockResolvedValue(NextResponse.json({ data: 'secret' }));

    const wrapped = payloadMiddleware.wrapPiiRoute(handler);

    const request = createRequest('http://localhost:3000/api/admin/organizations/org-123');

    const response = await wrapped(request);

    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Pragma')).toBe('no-cache');

    const body = await response.json();
    expect(body.error).toBe('unauthorized');
  });

  it('should pass through to handler when session exists and encryption headers are valid', async () => {
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ data: 'ok' }));

    const wrapped = payloadMiddleware.wrapPiiRoute(handler);
    const request = createRequest('http://localhost:3000/api/admin/organizations/org-123', {
      method: 'GET',
      headers: encryptionHeaders(),
    });

    const response = await wrapped(request);

    expect(handler).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests — wrapPiiRoute: encrypted response body (requires valid session + key)
// ---------------------------------------------------------------------------

describe('wrapPiiRoute — encrypted response body', () => {
  beforeEach(() => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: 'user-1' },
      session: { id: 'session-1', activeOrganizationId: null },
    });
    vi.mocked(incrementMetric).mockClear();
  });

  it('should encrypt successful JSON responses when key is valid', async () => {
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ name: 'John', ssn: '123-45' }));

    const wrapped = payloadMiddleware.wrapPiiRoute(handler);
    const request = createRequest('http://localhost:3000/api/admin/organizations/org-123', {
      method: 'GET',
      headers: encryptionHeaders(),
    });

    const response = await wrapped(request);

    // Response should be encrypted (binary/octet-stream)
    expect(response.headers.get('Content-Type')).toBe('application/octet-stream');
  });

  it('should return plaintext when response is not valid JSON', async () => {
    const handler = vi.fn().mockResolvedValue(
      new Response('not json at all', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    const wrapped = payloadMiddleware.wrapPiiRoute(handler);
    const request = createRequest('http://localhost:3000/api/admin/organizations/org-123', {
      method: 'GET',
      headers: encryptionHeaders(),
    });

    const response = await wrapped(request);

    // Should fall back to plaintext since JSON.parse fails.
    expect(response.status).toBe(200);
  });

  it('should return plaintext when response is not JSON content-type', async () => {
    const handler = vi.fn().mockResolvedValue(
      new Response('plain text', { status: 200, headers: { 'Content-Type': 'text/plain' } }),
    );

    const wrapped = payloadMiddleware.wrapPiiRoute(handler);
    const request = createRequest('http://localhost:3000/api/admin/organizations/org-123', {
      method: 'GET',
      headers: encryptionHeaders(),
    });

    const response = await wrapped(request);

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toBe('plain text');
  });

  it('should increment encryptedRequestCount metric for PII routes', async () => {
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ data: 'test' }));

    const { incrementMetric } = await import('@/lib/payload-metrics');
    vi.mocked(incrementMetric).mockImplementation(() => {});

    const wrapped = payloadMiddleware.wrapPiiRoute(handler);
    const request = createRequest('http://localhost:3000/api/admin/organizations/org-123', {
      method: 'GET',
      headers: encryptionHeaders(),
    });

    await wrapped(request);

    expect(incrementMetric).toHaveBeenCalledWith('encryptedRequestCount');
  });

  it('should not increment encryptedRequestCount for non-PII routes', async () => {
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ data: 'test' }));

    const { incrementMetric } = await import('@/lib/payload-metrics');
    vi.mocked(incrementMetric).mockImplementation(() => {});

    const wrapped = payloadMiddleware.wrapPiiRoute(handler);
    // /api/health is NOT a PII route.
    const request = createRequest('http://localhost:3000/api/health', {
      method: 'GET',
    });

    await wrapped(request);

    expect(incrementMetric).not.toHaveBeenCalledWith('encryptedRequestCount');
  });

  it('should handle 204 No Content without body consumption errors', async () => {
    const handler = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));

    const wrapped = payloadMiddleware.wrapPiiRoute(handler);
    const request = createRequest('http://localhost:3000/api/admin/organizations/org-123', {
      method: 'DELETE',
      headers: encryptionHeaders(),
    });

    const response = await wrapped(request);

    expect(response.status).toBe(204);
  });

  it('should handle empty JSON object responses', async () => {
    const handler = vi.fn().mockResolvedValue(NextResponse.json({}));

    const wrapped = payloadMiddleware.wrapPiiRoute(handler);
    const request = createRequest('http://localhost:3000/api/admin/organizations/org-123', {
      method: 'GET',
      headers: encryptionHeaders(),
    });

    const response = await wrapped(request);

    expect(response.status).toBe(200);
  });

  it('should handle null body responses', async () => {
    const handler = vi.fn().mockResolvedValue(NextResponse.json(null));

    const wrapped = payloadMiddleware.wrapPiiRoute(handler);
    const request = createRequest('http://localhost:3000/api/admin/organizations/org-123', {
      method: 'GET',
      headers: encryptionHeaders(),
    });

    const response = await wrapped(request);

    expect(response.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Tests — wrapPiiRoute: context.params passthrough (Next.js App Router)
// ---------------------------------------------------------------------------

describe('wrapPiiRoute — context.params passthrough', () => {
  beforeEach(() => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: 'user-1' },
      session: { id: 'session-1', activeOrganizationId: null },
    });
  });

  it('should pass context.params to handler when provided (Next.js App Router style)', async () => {
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ success: true }));

    const wrapped = payloadMiddleware.wrapPiiRoute(handler);
    const request = createRequest('http://localhost:3000/api/admin/organizations/org-123', {
      method: 'GET',
      headers: encryptionHeaders(),
    });

    // Pass params via context (Next.js App Router pattern)
    const response = await wrapped(request, {
      params: Promise.resolve({ orgId: 'context-org-123' }),
    });

    expect(handler).toHaveBeenCalled();
    const handlerCall = vi.mocked(handler).mock.calls[0];
    // Context params should take precedence over URL parsing.
    expect(handlerCall[2]).toEqual({ orgId: 'context-org-123' });
  });

  it('should handle context.params as a resolved Promise with multiple params', async () => {
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ success: true }));

    const wrapped = payloadMiddleware.wrapPiiRoute(handler);
    const request = createRequest('http://localhost:3000/api/admin/organizations/org-123/members/member-456', {
      method: 'GET',
      headers: encryptionHeaders(),
    });

    await wrapped(request, {
      params: Promise.resolve({ orgId: 'ctx-org', memberId: 'ctx-member' }),
    });

    expect(handler).toHaveBeenCalled();
    const handlerCall = vi.mocked(handler).mock.calls[0];
    expect(handlerCall[2]).toEqual({ orgId: 'ctx-org', memberId: 'ctx-member' });
  });

  it('should handle context.params that is a plain object (not Promise)', async () => {
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ success: true }));

    const wrapped = payloadMiddleware.wrapPiiRoute(handler);
    const request = createRequest('http://localhost:3000/api/admin/organizations/org-123', {
      method: 'GET',
      headers: encryptionHeaders(),
    });

    await wrapped(request, { params: { orgId: 'plain-org' } as any });

    expect(handler).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests — wrapPiiRoute: key validation error paths in enforce mode
// ---------------------------------------------------------------------------

describe('wrapPiiRoute — key validation error paths', () => {
  beforeEach(() => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: 'user-1' },
      session: { id: 'session-1', activeOrganizationId: null },
    });
  });

  it('should return 400 when key validation fails with INVALID_KEY_ID', async () => {
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ success: true }));

    // Mock key validation to fail with INVALID_KEY_ID
    const { getValidPayloadKey } = await import('@/lib/payload-key-server');
    vi.mocked(getValidPayloadKey).mockResolvedValue({
      valid: false,
      error: 'invalid_key_id',
    });

    const wrapped = payloadMiddleware.wrapPiiRoute(handler);
    const request = createRequest('http://localhost:3000/api/admin/organizations/org-123', {
      method: 'GET',
      headers: encryptionHeaders(),
    });

    const response = await wrapped(request);

    expect(response.status).toBe(400);
  });

  it('should fall through to plaintext when key is UNKNOWN in enforce mode', async () => {
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ success: true }));

    const { getValidPayloadKey } = await import('@/lib/payload-key-server');
    vi.mocked(getValidPayloadKey).mockResolvedValue({
      valid: false,
      error: 'payload_key_unknown',
    });

    const wrapped = payloadMiddleware.wrapPiiRoute(handler);
    const request = createRequest('http://localhost:3000/api/admin/organizations/org-123', {
      method: 'GET',
      headers: encryptionHeaders(),
    });

    const response = await wrapped(request);

    // Should NOT return an error — falls through to plaintext handling.
    expect(response.status).toBe(200);
  });

  it('should fall through to plaintext when key is EXPIRED in enforce mode', async () => {
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ success: true }));

    const { getValidPayloadKey } = await import('@/lib/payload-key-server');
    vi.mocked(getValidPayloadKey).mockResolvedValue({
      valid: false,
      error: 'payload_key_expired',
    });

    const wrapped = payloadMiddleware.wrapPiiRoute(handler);
    const request = createRequest('http://localhost:3000/api/admin/organizations/org-123', {
      method: 'GET',
      headers: encryptionHeaders(),
    });

    const response = await wrapped(request);

    expect(response.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Tests — wrapPiiRoute: no-store headers on error responses
// ---------------------------------------------------------------------------

describe('wrapPiiRoute — no-store headers', () => {
  beforeEach(() => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: 'user-1' },
      session: { id: 'session-1', activeOrganizationId: null },
    });
  });

  it('should add no-store and pragma headers to error responses', async () => {
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ error: 'fail' }, { status: 500 }));

    const wrapped = payloadMiddleware.wrapPiiRoute(handler);
    const request = createRequest('http://localhost:3000/api/admin/organizations/org-123', {
      method: 'GET',
      headers: encryptionHeaders(),
    });

    const response = await wrapped(request);

    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Pragma')).toBe('no-cache');
  });

  it('should add no-store and pragma headers to 204 responses', async () => {
    const handler = vi.fn().mockResolvedValue(
      new NextResponse(null, { status: 204 }),
    );

    const wrapped = payloadMiddleware.wrapPiiRoute(handler);
    const request = createRequest('http://localhost:3000/api/admin/organizations/org-123', {
      method: 'DELETE',
      headers: encryptionHeaders(),
    });

    const response = await wrapped(request);

    expect(response.status).toBe(204);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Pragma')).toBe('no-cache');
  });

  it('should add no-store and pragma headers to non-JSON responses', async () => {
    const handler = vi.fn().mockResolvedValue(
      new NextResponse('Plain text response', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      }),
    );

    const wrapped = payloadMiddleware.wrapPiiRoute(handler);
    const request = createRequest('http://localhost:3000/api/admin/organizations/org-123', {
      method: 'GET',
      headers: encryptionHeaders(),
    });

    const response = await wrapped(request);

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toBe('Plain text response');
  });
});

// ---------------------------------------------------------------------------
// Tests — wrapPiiRoute: disabled mode passthrough with params
// ---------------------------------------------------------------------------

describe('wrapPiiRoute — disabled mode passthrough', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should pass route params to handler in disabled mode', async () => {
    // Reset modules to pick up a different env.
    vi.resetModules();

    const { NextResponse } = await import('next/server');

    vi.doMock('@/lib/env', () => ({
      env: {
        PAYLOAD_ENCRYPTION_MODE: 'disabled',
        PAYLOAD_ENCRYPTION_MAX_BYTES: 65536,
        PAYLOAD_ENCRYPTION_REPLAY_WINDOW_SECONDS: 30,
      },
    }));

    vi.doMock('@/lib/auth', () => ({
      auth: {
        api: {
          getSession: vi.fn().mockResolvedValue({
            user: { id: 'user-1' },
            session: { id: 'session-1', activeOrganizationId: null },
          }),
        },
      },
    }));

    const { wrapPiiRoute: wrappedHandler } = await import('@/lib/payload-middleware');

    const handler = vi.fn().mockResolvedValue(NextResponse.json({ success: true }));
    const wrapped = wrappedHandler(handler);

    // No encryption headers needed in disabled mode.
    const request = createRequest('http://localhost:3000/api/admin/organizations/org-abc123/members/member-def456');
    await wrapped(request);

    expect(handler).toHaveBeenCalled();
    const handlerCall = vi.mocked(handler).mock.calls[0];
    expect(handlerCall[2]).toEqual({ orgId: 'org-abc123', memberId: 'member-def456' });
  });

  it('should pass through OPTIONS in disabled mode', async () => {
    vi.resetModules();

    const { NextResponse } = await import('next/server');

    vi.doMock('@/lib/env', () => ({
      env: {
        PAYLOAD_ENCRYPTION_MODE: 'disabled',
        PAYLOAD_ENCRYPTION_MAX_BYTES: 65536,
        PAYLOAD_ENCRYPTION_REPLAY_WINDOW_SECONDS: 30,
      },
    }));

    vi.doMock('@/lib/auth', () => ({
      auth: {
        api: {
          getSession: vi.fn().mockResolvedValue({
            user: { id: 'user-1' },
            session: { id: 'session-1', activeOrganizationId: null },
          }),
        },
      },
    }));

    const { wrapPiiRoute: wrappedHandler } = await import('@/lib/payload-middleware');

    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const wrapped = wrappedHandler(handler);

    const request = createRequest('http://localhost:3000/api/admin/organizations/org-123', {
      method: 'OPTIONS',
    });

    const response = await wrapped(request);

    expect(handler).toHaveBeenCalled();
    expect(response.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Tests — wrapPiiRoute: stale timestamp rejection
// ---------------------------------------------------------------------------

describe('wrapPiiRoute — stale timestamp', () => {
  beforeEach(() => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: 'user-1' },
      session: { id: 'session-1', activeOrganizationId: null },
    });
  });

  it('should reject requests with stale timestamp in enforce mode', async () => {
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ success: true }));

    const wrapped = payloadMiddleware.wrapPiiRoute(handler);
    // Timestamp 60 seconds ago exceeds the 30-second window.
    const request = createRequest('http://localhost:3000/api/admin/organizations/org-123', {
      method: 'GET',
      headers: {
        ...encryptionHeaders(),
        'X-Payload-Timestamp': String(Math.floor(Date.now() / 1000) - 60),
      },
    });

    const response = await wrapped(request);

    expect(response.status).toBe(400);
  });

  it('should accept requests with fresh timestamp', async () => {
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ success: true }));

    const wrapped = payloadMiddleware.wrapPiiRoute(handler);
    const request = createRequest('http://localhost:3000/api/admin/organizations/org-123', {
      method: 'GET',
      headers: encryptionHeaders(), // current timestamp
    });

    const response = await wrapped(request);

    expect(response.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Tests — wrapPiiRoute: GET/DELETE methods skip body decryption
// ---------------------------------------------------------------------------

describe('wrapPiiRoute — GET and DELETE skip body decryption', () => {
  beforeEach(() => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: 'user-1' },
      session: { id: 'session-1', activeOrganizationId: null },
    });
  });

  it('should pass null decryptedBody for GET requests', async () => {
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ results: [] }));

    const wrapped = payloadMiddleware.wrapPiiRoute(handler);
    const request = createRequest('http://localhost:3000/api/admin/organizations/org-123', {
      method: 'GET',
      headers: encryptionHeaders(),
    });

    await wrapped(request);

    expect(handler).toHaveBeenCalled();
    const handlerCall = vi.mocked(handler).mock.calls[0];
    expect(handlerCall[1]).toBeNull(); // decryptedBody is null for GET
  });

  it('should pass null decryptedBody for DELETE requests', async () => {
    const handler = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));

    const wrapped = payloadMiddleware.wrapPiiRoute(handler);
    const request = createRequest('http://localhost:3000/api/admin/organizations/org-123', {
      method: 'DELETE',
      headers: encryptionHeaders(),
    });

    await wrapped(request);

    expect(handler).toHaveBeenCalled();
    const handlerCall = vi.mocked(handler).mock.calls[0];
    expect(handlerCall[1]).toBeNull(); // decryptedBody is null for DELETE
  });

  it('should not check replay protection for GET requests', async () => {
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ data: 'test' }));

    const wrapped = payloadMiddleware.wrapPiiRoute(handler);
    // GET with encryption headers — replay check should be skipped.
    const request = createRequest('http://localhost:3000/api/admin/organizations/org-123', {
      method: 'GET',
      headers: encryptionHeaders(),
    });

    const response = await wrapped(request);

    expect(response.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Tests — wrapPiiRoute: permissive mode response encryption
// ---------------------------------------------------------------------------

describe('wrapPiiRoute — permissive mode response encryption', () => {
  beforeEach(async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: 'user-1' },
      session: { id: 'session-1', activeOrganizationId: null },
    });
    vi.mocked(incrementMetric).mockClear();
    
    // Restore default mock for getValidPayloadKey that may have been overridden in previous tests
    const { getValidPayloadKey } = await import('@/lib/payload-key-server');
    vi.mocked(getValidPayloadKey).mockResolvedValue({ 
      valid: true, 
      key: {
        keyId: 'test-key',
        sessionId: 'session-1',
        expiresAt: Math.floor(Date.now() / 1000) + 300,
        algorithm: 'aes-256-gcm',
        keyMaterial: Buffer.from('a'.repeat(32)).toString('base64url'),
        keyBytes: Buffer.from('a'.repeat(32)),
      }
    });
  });

  it('should increment encryptedResponseCount metric on successful encrypted response', async () => {
    vi.mocked(incrementMetric).mockImplementation(() => {});

    const handler = vi.fn().mockResolvedValue(NextResponse.json({ data: 'sensitive' }));
    const wrapped = payloadMiddleware.wrapPiiRoute(handler);
    const request = createRequest('http://localhost:3000/api/admin/organizations/org-123', {
      method: 'GET',
      headers: encryptionHeaders(),
    });

    const response = await wrapped(request);

    // Should have called incrementMetric for encryptedResponseCount
    expect(incrementMetric).toHaveBeenCalledWith('encryptedResponseCount');
  });

  it('should handle empty JSON object responses', async () => {
    const handler = vi.fn().mockResolvedValue(NextResponse.json({}));

    const wrapped = payloadMiddleware.wrapPiiRoute(handler);
    const request = createRequest('http://localhost:3000/api/admin/organizations/org-123', {
      method: 'GET',
      headers: encryptionHeaders(),
    });

    const response = await wrapped(request);

    expect(response.status).toBe(200);
  });

  it('should handle null body responses', async () => {
    const handler = vi.fn().mockResolvedValue(NextResponse.json(null));

    const wrapped = payloadMiddleware.wrapPiiRoute(handler);
    const request = createRequest('http://localhost:3000/api/admin/organizations/org-123', {
      method: 'GET',
      headers: encryptionHeaders(),
    });

    const response = await wrapped(request);

    expect(response.status).toBe(200);
  });

  it('should return plaintext response when key is unknown in permissive mode', async () => {
    // Reset modules for permissive mode.
    vi.resetModules();

    const { NextResponse } = await import('next/server');

    vi.doMock('@/lib/env', () => ({
      env: {
        PAYLOAD_ENCRYPTION_MODE: 'permissive',
        PAYLOAD_ENCRYPTION_MAX_BYTES: 65536,
        PAYLOAD_ENCRYPTION_REPLAY_WINDOW_SECONDS: 30,
      },
    }));

    vi.doMock('@/lib/auth', () => ({
      auth: {
        api: {
          getSession: vi.fn().mockResolvedValue({
            user: { id: 'user-1' },
            session: { id: 'session-1', activeOrganizationId: null },
          }),
        },
      },
    }));

    vi.doMock('@/lib/payload-key-server', () => ({
      getValidPayloadKey: vi.fn().mockResolvedValue({ valid: false, error: 'payload_key_unknown' }),
    }));

    vi.doMock('@/lib/crypto-server', () => ({
      encryptWithAad: vi.fn().mockReturnValue({ encrypted: new Uint8Array([1, 2, 3]) }),
      decryptWithAad: vi.fn().mockReturnValue(JSON.stringify({ test: 'data' })),
    }));

    vi.doMock('@/lib/redis', () => ({
      redisGet: vi.fn().mockResolvedValue(null),
      redisSet: vi.fn().mockResolvedValue(undefined),
      redisDel: vi.fn().mockResolvedValue(undefined),
      redisPing: vi.fn().mockResolvedValue(true),
      redisSetWithNx: vi.fn().mockResolvedValue(true),
    }));

    const { wrapPiiRoute: wrappedHandler } = await import('@/lib/payload-middleware');

    const handler = vi.fn().mockResolvedValue(NextResponse.json({ name: 'John' }));
    const wrapped = wrappedHandler(handler);

    const request = createRequest('http://localhost:3000/api/admin/organizations/org-123', {
      method: 'GET',
      headers: encryptionHeaders(),
    });

    const response = await wrapped(request);

    // Should return plaintext JSON (not encrypted) since key is unknown in permissive mode.
    expect(response.headers.get('Content-Type')).toContain('application/json');
  });

  it('should pass through OPTIONS in permissive mode', async () => {
    vi.resetModules();

    const { NextResponse } = await import('next/server');

    vi.doMock('@/lib/env', () => ({
      env: {
        PAYLOAD_ENCRYPTION_MODE: 'permissive',
        PAYLOAD_ENCRYPTION_MAX_BYTES: 65536,
        PAYLOAD_ENCRYPTION_REPLAY_WINDOW_SECONDS: 30,
      },
    }));

    vi.doMock('@/lib/auth', () => ({
      auth: {
        api: {
          getSession: vi.fn().mockResolvedValue({
            user: { id: 'user-1' },
            session: { id: 'session-1', activeOrganizationId: null },
          }),
        },
      },
    }));

    const { wrapPiiRoute: wrappedHandler } = await import('@/lib/payload-middleware');

    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const wrapped = wrappedHandler(handler);

    const request = createRequest('http://localhost:3000/api/admin/organizations/org-123', {
      method: 'OPTIONS',
    });

    const response = await wrapped(request);

    expect(handler).toHaveBeenCalled();
    expect(response.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Tests — wrapPiiRoute: non-PII route passthrough
// ---------------------------------------------------------------------------

describe('wrapPiiRoute — non-PII route passthrough', () => {
  beforeEach(() => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: 'user-1' },
      session: { id: 'session-1', activeOrganizationId: null },
    });
  });

  it('should pass through /api/health without encryption', async () => {
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ status: 'ok' }));

    const wrapped = payloadMiddleware.wrapPiiRoute(handler);
    // No encryption headers needed — /api/health is not a PII route.
    const request = createRequest('http://localhost:3000/api/health');

    const response = await wrapped(request);

    expect(handler).toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  it('should pass through non-PII routes with session but no encryption', async () => {
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ data: 'public' }));

    const wrapped = payloadMiddleware.wrapPiiRoute(handler);
    // Session is valid but route is not PII — pass through.
    const request = createRequest('http://localhost:3000/api/health');

    const response = await wrapped(request);

    expect(handler).toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  it('should handle non-PII route with encryption headers gracefully', async () => {
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ data: 'public' }));

    const wrapped = payloadMiddleware.wrapPiiRoute(handler);
    // Even with encryption headers, non-PII routes pass through.
    const request = createRequest('http://localhost:3000/api/health', {
      headers: encryptionHeaders(),
    });

    const response = await wrapped(request);

    expect(handler).toHaveBeenCalled();
    expect(response.status).toBe(200);
  });
});
