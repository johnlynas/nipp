/**
 * Integration tests: admin-initiated password reset (Users dashboard).
 *
 * Same mock-boundary convention as user-invite-flow.test.ts and
 * forgot-password.test.ts: the REAL route handler is driven; seams are mocked
 * at module edges — @/lib/auth (in-process BA requestPasswordReset + ban gate),
 * @/lib/db (hasCredentialAccount's Account read + enforceBanStatus' User read,
 * both reached via lib/forgot-password and lib/auth), @/lib/tenant-db (target
 * User lookup), require-super-admin, rate limiter, audit log, logger.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Seams (hoisted — must exist before any import chain loads)
// ---------------------------------------------------------------------------

const mockPrisma = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  account: { findMany: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ prisma: mockPrisma }));

const baApi = vi.hoisted(() => ({ requestPasswordReset: vi.fn() }));
const mockEnforceBan = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ auth: { api: baApi }, enforceBanStatus: mockEnforceBan }));

// Target lookup (route) + audit create both funnel through the tenant client.
const mockDb = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  auditLog: { create: vi.fn().mockResolvedValue({}) },
}));
vi.mock('@/lib/tenant-db', () => ({ default: mockDb }));
vi.mock('@/lib/platform-db', () => ({ withPlatformContext: (_u: string, op: () => unknown) => op() }));

const mockAdminAuth = vi.hoisted(() =>
  vi.fn(async (): Promise<{
    session: { user: { id: string } } | null;
    authorized: boolean;
    error?: string;
    status: number;
  }> => ({
    session: { user: { id: 'super-admin-1' } },
    authorized: true,
    status: 200,
  })),
);
vi.mock('@/lib/require-super-admin', () => ({ requireSuperAdmin: mockAdminAuth }));

const mockRateCheck = vi.hoisted(() => vi.fn().mockReturnValue(true));
vi.mock('@/lib/rate-limiter', () => ({ checkAdminRateLimit: mockRateCheck }));

const mockRecordAudit = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('@/lib/audit-log', () => ({ recordAuditLog: mockRecordAudit }));

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
// nodemailer is never instantiated (the email seam lives inside the mocked BA hook).
vi.mock('nodemailer', () => ({}));

const { POST: resetPasswordRoute } = await import(
  '@/app/api/dashboard/admin/users/[id]/reset-password/route'
);

type PostHandler = typeof resetPasswordRoute;

function postRequest(url: string): NextRequest {
  return new Request(url, { method: 'POST', headers: { Origin: 'http://localhost:3000' } }) as unknown as Parameters<PostHandler>[0];
}

const TARGET = { id: 'u-reset-target', email: 'Local.User@propni.example.com' };

beforeEach(() => {
  vi.clearAllMocks();
  mockRateCheck.mockReturnValue(true);
  baApi.requestPasswordReset.mockResolvedValue({ status: true });
  // Default fixtures: target exists (tenant client), ban gate passes, local credential present.
  mockDb.user.findUnique.mockResolvedValue(TARGET);
  mockEnforceBan.mockResolvedValue(undefined);
  mockPrisma.account.findMany.mockResolvedValue([{ providerId: 'credential' }]);
});

// ---------------------------------------------------------------------------
// POST /api/dashboard/admin/users/[id]/reset-password
// ---------------------------------------------------------------------------

describe('POST /api/dashboard/admin/users/[id]/reset-password (admin)', () => {
  const paramsPromise = Promise.resolve({ id: TARGET.id });

  it('local (non-banned) user → 200, BetterAuth in-process call with the normalised target email + host header, audit recorded', async () => {
    const res = await resetPasswordRoute(
      postRequest(`http://localhost:3000/api/dashboard/admin/users/${TARGET.id}/reset-password`),
      { params: paramsPromise },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: true });

    // Email is the TARGET's (trimmed + lower-cased) — never request input.
    expect(baApi.requestPasswordReset).toHaveBeenCalledTimes(1);
    const call = baApi.requestPasswordReset.mock.calls[0][0];
    expect(call.body).toEqual({ email: 'local.user@propni.example.com' });
    expect(new Headers(call.headers).get('host')).toBe('localhost:3000');

    // Ban gate ran (lifts expired bans in place) before BetterAuth.
    expect(mockEnforceBan).toHaveBeenCalledWith('local.user@propni.example.com');

    // Audit: acting admin + masked target email only — no raw PII.
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'super-admin-1',
        action: 'user.password-reset-requested-by-admin',
        resourceType: 'User',
        resourceId: TARGET.id,
        success: true,
        metadata: { maskedEmail: 'l***@propni.example.com' },
      }),
    );
  });

  it('OIDC-only account → 403, BetterAuth never reached (forged-call path closed)', async () => {
    mockPrisma.account.findMany.mockResolvedValue([{ providerId: 'google' }]);

    const res = await resetPasswordRoute(
      postRequest(`http://localhost:3000/api/dashboard/admin/users/${TARGET.id}/reset-password`),
      { params: paramsPromise },
    );

    expect(res.status).toBe(403);
    expect(String((await res.json()).error)).toMatch(/google/i);
    expect(baApi.requestPasswordReset).not.toHaveBeenCalled();
  });

  it('banned user → 401 with the shared ban copy, BetterAuth never reached', async () => {
    const { APIError } = await import('better-auth/api');
    mockEnforceBan.mockRejectedValue(
      new APIError('UNAUTHORIZED', { message: 'Access denied. Your account has been banned.' }),
    );

    const res = await resetPasswordRoute(
      postRequest(`http://localhost:3000/api/dashboard/admin/users/${TARGET.id}/reset-password`),
      { params: paramsPromise },
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Access denied. Your account has been banned.' });
    expect(baApi.requestPasswordReset).not.toHaveBeenCalled();
  });

  it('unknown target id → 404, nothing downstream', async () => {
    mockDb.user.findUnique.mockResolvedValue(null);

    const res = await resetPasswordRoute(
      postRequest('http://localhost:3000/api/dashboard/admin/users/ghost/reset-password'),
      { params: Promise.resolve({ id: 'ghost' }) },
    );

    expect(res.status).toBe(404);
    expect(mockEnforceBan).not.toHaveBeenCalled();
    expect(baApi.requestPasswordReset).not.toHaveBeenCalled();
  });

  it('rate-limited admin → 429, nothing downstream', async () => {
    mockRateCheck.mockReturnValue(false);

    const res = await resetPasswordRoute(
      postRequest(`http://localhost:3000/api/dashboard/admin/users/${TARGET.id}/reset-password`),
      { params: paramsPromise },
    );

    expect(res.status).toBe(429);
    expect(mockDb.user.findUnique).not.toHaveBeenCalled();
    expect(baApi.requestPasswordReset).not.toHaveBeenCalled();
  });

  it('non-super-admin session → refused at the gate, no target lookup', async () => {
    mockAdminAuth.mockResolvedValueOnce({
      session: { user: { id: 'not-an-admin' } },
      authorized: false,
      error: 'Super Admin access required',
      status: 403,
    });

    const res = await resetPasswordRoute(
      postRequest(`http://localhost:3000/api/dashboard/admin/users/${TARGET.id}/reset-password`),
      { params: paramsPromise },
    );

    expect(res.status).toBe(403);
    expect(mockDb.user.findUnique).not.toHaveBeenCalled();
  });

  it('DB outage (target lookup) → 503, not a generic 500', async () => {
    mockDb.user.findUnique.mockRejectedValue(new Error("Can't reach database server"));

    const res = await resetPasswordRoute(
      postRequest(`http://localhost:3000/api/dashboard/admin/users/${TARGET.id}/reset-password`),
      { params: paramsPromise },
    );

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'Database unavailable' });
  });

  it('BetterAuth failure → generic 500 (internal detail never leaked)', async () => {
    baApi.requestPasswordReset.mockRejectedValue(new Error('boom'));

    const res = await resetPasswordRoute(
      postRequest(`http://localhost:3000/api/dashboard/admin/users/${TARGET.id}/reset-password`),
      { params: paramsPromise },
    );

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to send password-reset email' });
  });
});
