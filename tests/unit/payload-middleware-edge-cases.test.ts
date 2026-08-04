/**
 * Unit tests for wrapPiiRoute edge cases: OPTIONS, 204, empty body, error responses.
 *
 * Verifies:
 * - OPTIONS preflight requests pass through without encryption
 * - 204 No Content responses are not encrypted
 * - Empty bodies are handled safely
 * - Error responses (non-2xx) are not encrypted
 * - Non-JSON responses are passed through unchanged
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';



import { wrapPiiRoute, getEncryptionMode } from '@/lib/payload-middleware';

// ---------------------------------------------------------------------------
// Mocks
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



vi.mock('@/lib/payload-key-server', () => ({
  getValidPayloadKey: vi.fn().mockResolvedValue({ valid: true, key: {
    keyId: 'test-key',
    sessionId: 'session-1',
    expiresAt: Math.floor(Date.now() / 1000) + 300,
    algorithm: 'aes-256-gcm',
    keyMaterial: 'a'.repeat(43), // 32 bytes base64url
  }}),
}));

vi.mock('@/lib/crypto-server', () => ({
  encryptWithAad: vi.fn().mockReturnValue({ encrypted: new Uint8Array([1, 2, 3]) }),
  decryptWithAad: vi.fn().mockReturnValue(JSON.stringify({ test: 'data' })),
}));

vi.mock('@/lib/redis', () => ({
  redisGet: vi.fn().mockResolvedValue(null),
  redisSet: vi.fn().mockResolvedValue(undefined),
  redisDel: vi.fn().mockResolvedValue(undefined),
  redisPing: vi.fn().mockResolvedValue(true),
  redisSetWithNx: vi.fn().mockResolvedValue(true), // new key set successfully
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createRequest(
  url: string,
  options: { method?: string; headers?: Record<string, string>; body?: ArrayBuffer } = {},
) {
  const request = new NextRequest(url, {
    method: options.method || 'GET',
    headers: options.headers,
  });

  if (options.body) {
    // Note: NextRequest doesn't support setting body in constructor for tests,
    // so we'd need to mock request.arrayBuffer() if testing body handling
  }

  return request;
}

/** Build encryption headers for PII route requests. */
let _nonceCounter = 0;
function encryptionHeaders(extra: Record<string, string> = {}): Record<string, string> {
  _nonceCounter++;
  return {
    'X-Payload-Encryption': 'v1',
    'X-Payload-Key-Id': 'test-key',
    'X-Payload-Timestamp': String(Math.floor(Date.now() / 1000)),
    // Unique nonce per call to avoid replay detection across tests.
    'X-Payload-Nonce': `nonce${_nonceCounter.toString().padStart(22, '0')}`,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('wrapPiiRoute Edge Cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('OPTIONS preflight handling', () => {
    it('should pass through OPTIONS requests without encryption', async () => {
      const handler = vi.fn().mockResolvedValue(NextResponse.json({ success: true }));

      const wrapped = wrapPiiRoute(handler);
      const request = createRequest('http://localhost:3000/api/admin/organizations/org-123', {
        method: 'OPTIONS',
      });

      const response = await wrapped(request);

      expect(handler).toHaveBeenCalledWith(
        request,
        null, // decryptedBody is null for OPTIONS
        expect.objectContaining({ orgId: 'org-123' }), // route params
      );
      expect(response.status).toBe(200);
    });

    it('should not require encryption headers for OPTIONS', async () => {
      const handler = vi.fn().mockResolvedValue(NextResponse.json({ success: true }));

      const wrapped = wrapPiiRoute(handler);
      const request = createRequest('http://localhost:3000/api/admin/organizations/org-123', {
        method: 'OPTIONS',
      });

      // No encryption headers — should still work for OPTIONS
      const response = await wrapped(request);

      expect(response.status).toBe(200);
    });
  });

  describe('204 No Content handling', () => {
    it('should not encrypt 204 responses', async () => {
      const handler = vi.fn().mockResolvedValue(
        new NextResponse(null, { status: 204 }),
      );

      const wrapped = wrapPiiRoute(handler);
      const request = createRequest('http://localhost:3000/api/admin/organizations/org-123', {
        method: 'DELETE',
        headers: {
          'X-Payload-Encryption': 'v1',
          'X-Payload-Key-Id': 'test-key',
          'X-Payload-Timestamp': String(Math.floor(Date.now() / 1000)),
          'X-Payload-Nonce': 'a'.repeat(22),
        },
      });

      const response = await wrapped(request);

      expect(response.status).toBe(204);
      // 204 responses should not have encrypted body
      const text = await response.text();
      expect(text).toBe('');
    });

    it('should add cache headers to 204 responses', async () => {
      const handler = vi.fn().mockResolvedValue(
        new Response(null, { status: 204 }),
      );

      const wrapped = wrapPiiRoute(handler);
      const request = createRequest('http://localhost:3000/api/admin/organizations/org-123', {
        method: 'DELETE',
        headers: encryptionHeaders(),
      });

      const response = await wrapped(request);

      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(response.headers.get('Pragma')).toBe('no-cache');
    });
  });

  describe('Empty body handling', () => {
    it('should handle empty JSON object responses', async () => {
      const handler = vi.fn().mockResolvedValue(
        NextResponse.json({}),
      );

      const wrapped = wrapPiiRoute(handler);
      const request = createRequest('http://localhost:3000/api/admin/organizations/org-123', {
        method: 'GET',
        headers: encryptionHeaders(),
      });

      const response = await wrapped(request);

      expect(response.status).toBe(200);
    });

    it('should handle null body responses', async () => {
      const handler = vi.fn().mockResolvedValue(
        NextResponse.json(null),
      );

      const wrapped = wrapPiiRoute(handler);
      const request = createRequest('http://localhost:3000/api/admin/organizations/org-123', {
        method: 'GET',
        headers: encryptionHeaders(),
      });

      const response = await wrapped(request);

      expect(response.status).toBe(200);
    });
  });

  describe('Error response handling', () => {
    it('should not encrypt error responses (4xx)', async () => {
      const handler = vi.fn().mockResolvedValue(
        NextResponse.json({ error: 'Not found' }, { status: 404 }),
      );

      const wrapped = wrapPiiRoute(handler);
      const request = createRequest('http://localhost:3000/api/admin/organizations/org-123', {
        method: 'GET',
        headers: encryptionHeaders(),
      });

      const response = await wrapped(request);

      expect(response.status).toBe(404);
      // Error responses should remain JSON, not encrypted
      const contentType = response.headers.get('Content-Type');
      expect(contentType).toContain('application/json');

      const body = await response.json();
      expect(body.error).toBe('Not found');
    });

    it('should not encrypt error responses (5xx)', async () => {
      const handler = vi.fn().mockResolvedValue(
        NextResponse.json({ error: 'Internal server error' }, { status: 500 }),
      );

      const wrapped = wrapPiiRoute(handler);
      const request = createRequest('http://localhost:3000/api/admin/organizations/org-123', {
        method: 'GET',
        headers: encryptionHeaders(),
      });

      const response = await wrapped(request);

      expect(response.status).toBe(500);
      const contentType = response.headers.get('Content-Type');
      expect(contentType).toContain('application/json');
    });

    it('should not encrypt non-JSON responses', async () => {
      const handler = vi.fn().mockResolvedValue(
        new NextResponse('Plain text response', {
          status: 200,
          headers: { 'Content-Type': 'text/plain' },
        }),
      );

      const wrapped = wrapPiiRoute(handler);
      const request = createRequest('http://localhost:3000/api/admin/organizations/org-123', {
        method: 'GET',
        headers: encryptionHeaders(),
      });

      const response = await wrapped(request);

      expect(response.status).toBe(200);
      const contentType = response.headers.get('Content-Type');
      expect(contentType).toContain('text/plain');

      const text = await response.text();
      expect(text).toBe('Plain text response');
    });
  });

  describe('GET and DELETE methods', () => {
    it('should handle GET requests without body decryption', async () => {
      const handler = vi.fn().mockResolvedValue(
        NextResponse.json({ results: [] }),
      );

      const wrapped = wrapPiiRoute(handler);
      const request = createRequest('http://localhost:3000/api/admin/organizations/org-123', {
        method: 'GET',
        headers: encryptionHeaders(),
      });

      const response = await wrapped(request);

      expect(handler).toHaveBeenCalledWith(
        request,
        null, // GET requests don't have decrypted body
        expect.any(Object),
      );
    });

    it('should handle DELETE requests without body decryption', async () => {
      const handler = vi.fn().mockResolvedValue(
        new Response(null, { status: 204 }),
      );

      const wrapped = wrapPiiRoute(handler);
      const request = createRequest('http://localhost:3000/api/admin/organizations/org-123', {
        method: 'DELETE',
        headers: encryptionHeaders(),
      });

      const response = await wrapped(request);

      expect(handler).toHaveBeenCalledWith(
        request,
        null, // DELETE requests don't have decrypted body
        expect.any(Object),
      );
    });
  });

  describe('Disabled mode passthrough', () => {
    it('should pass through all requests without encryption in disabled mode', async () => {
      // Reset modules and re-import with disabled mode.
      vi.resetModules();

      // Mock env before importing the middleware using doMock (not hoisted)
      vi.doMock('@/lib/env', () => ({
        env: {
          PAYLOAD_ENCRYPTION_MODE: 'disabled',
          PAYLOAD_ENCRYPTION_MAX_BYTES: 65536,
          PAYLOAD_ENCRYPTION_REPLAY_WINDOW_SECONDS: 30,
        },
      }));

      // Also mock other dependencies needed by the middleware
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

      // No encryption headers needed in disabled mode
      const request = createRequest('http://localhost:3000/api/admin/organizations/org-123');
      const response = await wrapped(request);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
    });
  });

  describe('Route params passing', () => {
    it('should pass route params to handler for organization routes', async () => {
      const handler = vi.fn().mockResolvedValue(NextResponse.json({ success: true }));

      const wrapped = wrapPiiRoute(handler);
      const request = createRequest('http://localhost:3000/api/admin/organizations/org-abc123/members/member-def456', {
        method: 'GET',
        headers: encryptionHeaders(),
      });

      await wrapped(request);

      expect(handler).toHaveBeenCalledWith(
        request,
        null,
        expect.objectContaining({ orgId: 'org-abc123', memberId: 'member-def456' }),
      );
    });

    it('should pass empty params for non-organization routes', async () => {
      const handler = vi.fn().mockResolvedValue(NextResponse.json({ success: true }));

      const wrapped = wrapPiiRoute(handler);
      // /api/admin/users/search IS a PII route, so it needs encryption headers
      const request = createRequest('http://localhost:3000/api/admin/users/search', {
        method: 'GET',
        headers: encryptionHeaders(),
      });

      await wrapped(request);

      expect(handler).toHaveBeenCalledWith(
        request,
        null,
        {},
      );
    });
  });
});
