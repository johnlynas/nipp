/**
 * Unit tests for app/api-docs/_guard.ts — super-admin gate on the API docs.
 *
 * The guard must be fail-closed: no session → 401, non-super-admin → 403,
 * and only a verified Platform-org member proceeds (null).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks (hoisted before imports)
// ---------------------------------------------------------------------------

const { mockGetSession, mockIsSuperAdmin, mockCheckApiDocsRateLimit } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockIsSuperAdmin: vi.fn(),
  mockCheckApiDocsRateLimit: vi.fn().mockReturnValue(true),
}));

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: (...args: unknown[]) => mockGetSession(...args) } },
}));

vi.mock('@/lib/authz', () => ({
  isSuperAdmin: (userId: string, orgId?: string) => mockIsSuperAdmin(userId, orgId),
}));

vi.mock('@/lib/rate-limiter', () => ({
  checkApiDocsRateLimit: (sessionId: string) => mockCheckApiDocsRateLimit(sessionId),
  API_DOCS_RATE_LIMIT_MAX: 10,
  API_DOCS_RATE_LIMIT_WINDOW: 60,
}));

const { requireSuperAdmin } = await import('@/app/api-docs/_guard');

function session(isSuperAdminFlag?: boolean) {
  return {
    user: { id: 'user-1', ...(isSuperAdminFlag !== undefined ? { isSuperAdmin: isSuperAdminFlag } : {}) },
    session: { id: 'session-1' },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckApiDocsRateLimit.mockReturnValue(true);
});

describe('requireSuperAdmin (/api-docs gate)', () => {
  it('returns 401 JSON when there is no session', async () => {
    mockGetSession.mockResolvedValue(null);

    const denied = await requireSuperAdmin(new Request('http://localhost/api-docs'));

    expect(denied).toBeInstanceOf(Response);
    expect(denied!.status).toBe(401);
    expect(await denied!.json()).toEqual({ error: 'Unauthorized' });
    // No authz check attempted without a user id.
    expect(mockIsSuperAdmin).not.toHaveBeenCalled();
  });

  it('allows the request when session user is flagged super admin (no extra DB query)', async () => {
    mockGetSession.mockResolvedValue(session(true));

    const denied = await requireSuperAdmin(new Request('http://localhost/api-docs'));

    expect(denied).toBeNull();
    // Fast path: the session callback already resolved the flag from the DB.
    expect(mockIsSuperAdmin).not.toHaveBeenCalled();
  });

  it('denies with 403 when session says not a super admin and the fresh DB check agrees', async () => {
    mockGetSession.mockResolvedValue(session(false));
    mockIsSuperAdmin.mockResolvedValue(false);

    const denied = await requireSuperAdmin(new Request('http://localhost/api-docs'));

    expect(denied).toBeInstanceOf(Response);
    expect(denied!.status).toBe(403);
    expect(await denied!.json()).toEqual({ error: 'Forbidden: super admin only' });
  });

  it('allows the request when a stale session denial disagrees with the fresh DB check', async () => {
    mockGetSession.mockResolvedValue(session(false)); // cached flag from an earlier resolution
    mockIsSuperAdmin.mockResolvedValue(true); // current DB state: is a member

    const denied = await requireSuperAdmin(new Request('http://localhost/api-docs'));

    expect(denied).toBeNull();
  });

  it('denies with 403 when the fallback authz check fails', async () => {
    mockGetSession.mockResolvedValue(session()); // no flag on user
    mockIsSuperAdmin.mockResolvedValue(false);

    const denied = await requireSuperAdmin(new Request('http://localhost/api-docs'));

    expect(denied).toBeInstanceOf(Response);
    expect(denied!.status).toBe(403);
  });

  it('denies with 403 when the authz check throws (fail-closed)', async () => {
    mockGetSession.mockResolvedValue(session()); // no flag on user
    mockIsSuperAdmin.mockRejectedValue(new Error('db down'));

    const denied = await requireSuperAdmin(new Request('http://localhost/api-docs'));

    expect(denied).toBeInstanceOf(Response);
    expect(denied!.status).toBe(403);
  });
});

describe('requireSuperAdmin — rate limiting', () => {
  it('returns 429 with Retry-After when the session is throttled', async () => {
    mockGetSession.mockResolvedValue(session(true));
    mockCheckApiDocsRateLimit.mockReturnValue(false);

    const denied = await requireSuperAdmin(new Request('http://localhost/api-docs'));

    expect(denied).toBeInstanceOf(Response);
    expect(denied!.status).toBe(429);
    // Throttling must not leak the spec content or run further auth checks.
    expect(await denied!.json()).toEqual({
      error: 'rate_limited',
      message: 'Too many requests — limit is 10 per 60s',
      retryAfter: 60,
    });
    expect(denied!.headers.get('Retry-After')).toBe('60');
    expect(mockIsSuperAdmin).not.toHaveBeenCalled(); // short-circuits before the DB check
  });

  it('applies the limiter per session id (shared counter across UI/spec/assets)', async () => {
    mockGetSession.mockResolvedValue(session(true));
    mockCheckApiDocsRateLimit.mockReturnValue(true);

    await requireSuperAdmin(new Request('http://localhost/api-docs'));
    expect(mockCheckApiDocsRateLimit).toHaveBeenCalledWith('session:session-1');
  });
});
