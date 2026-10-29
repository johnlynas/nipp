/**
 * POST /api/auth/password — server route behaviour.
 *
 * Mocks tenant-db + platform context + auth session so each test owns the exact
 * user state. Covers: unauthenticated 401, OIDC-account 403, hash written to
 * BOTH User.passwordHash and the credential Account row, success only for the
 * caller's own record, validation errors, and the rate-limit branch.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Module mocks — set up before the route is imported (hoisted by vitest).
vi.mock('@/lib/tenant-db', () => ({ default: { user: { update: vi.fn() }, account: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), create: vi.fn() } } }));
vi.mock('@/lib/platform-db', () => ({ withPlatformContext: vi.fn(async (_userId: string, op: () => unknown) => op()) }));
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock('@/lib/audit-log', () => ({ recordAuditLog: vi.fn(async () => ({})) }));
vi.mock('@/lib/rate-limiter', () => ({ checkAuthRateLimit: vi.fn(() => true), getClientIp: vi.fn(() => '10.0.0.1') }));

import { POST } from '@/app/api/auth/password/route';
import tenantDb from '@/lib/tenant-db';
import { auth } from '@/lib/auth';
import { recordAuditLog } from '@/lib/audit-log';
import { checkAuthRateLimit, getClientIp } from '@/lib/rate-limiter';

const mockGetSession = vi.mocked(auth.api.getSession);
const mockRecordAudit = vi.mocked(recordAuditLog);
const db = {
  updateUser: vi.mocked(tenantDb.user.update),
  findProviders: vi.mocked(tenantDb.account.findMany),
  findFirstCredential: vi.mocked(tenantDb.account.findFirst),
  updateCredential: vi.mocked(tenantDb.account.update),
  createCredential: vi.mocked(tenantDb.account.create),
};

function makeRequest(init?: { body?: unknown; headers?: Record<string, string> }) {
  return new Request('http://localhost/api/auth/password', {
    method: 'POST',
    headers: init?.headers ?? { 'Content-Type': 'application/json' },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

function sessionFor(email = 'local@example.com', extra?: Record<string, unknown>) {
  mockGetSession.mockResolvedValue({ id: 'sess-1', user: { id: 'user-123', name: 'Local User' as string, email, ...extra } } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  db.findProviders.mockResolvedValue([{ providerId: 'credential' }] as never);
  db.findFirstCredential.mockResolvedValue({ id: 'acct-1' } as never);
  db.updateUser.mockResolvedValue({} as never);
  db.updateCredential.mockResolvedValue({} as never);
});

describe('POST /api/auth/password', () => {
  it('rejects unauthenticated callers with 401 and touches nothing', async () => {
    mockGetSession.mockResolvedValue(null as never);
    const res = await POST(makeRequest({ body: { password: 'NewPass123!' } }) as never);
    expect(res.status).toBe(401);
    expect(db.updateUser).not.toHaveBeenCalled();
    expect(db.findProviders).not.toHaveBeenCalled();
  });

  it('updates both User.passwordHash and the credential Account row', async () => {
    sessionFor();
    const res = await POST(makeRequest({ body: { password: 'NewPass123!' } }) as never);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, message: 'Password updated' });

    // The update targets the SESSION user only — no id ever comes from the body.
    expect(db.updateUser).toHaveBeenCalledTimes(1);
    const userUpdate = db.updateUser.mock.calls[0][0];
    expect(userUpdate.where.id).toBe('user-123');
    // scrypt output is a raw salt:hash hex pair — not plaintext, no prefix.
    expect(userUpdate.data.passwordHash).toMatch(/^[a-f0-9]{32}:[a-f0-9]+$/);

    expect(db.findFirstCredential).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-123', providerId: 'credential' } }),
    );
    expect(db.updateCredential).toHaveBeenCalledTimes(1);
    const acctUpdate = db.updateCredential.mock.calls[0][0];
    expect(acctUpdate.where.id).toBe('acct-1');
    expect(acctUpdate.data.password).not.toContain('NewPass123!');

    // Same hash goes to both stores.
    expect(acctUpdate.data.password).toBe(userUpdate.data.passwordHash);

    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'user.password-changed', resourceId: 'user-123', success: true }),
    );
  });

  it('creates the credential Account row when only User.passwordHash existed', async () => {
    sessionFor();
    db.findFirstCredential.mockResolvedValue(null as never);
    const res = await POST(makeRequest({ body: { password: 'NewPass123!' } }) as never);

    expect(res.status).toBe(200);
    expect(db.createCredential).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          id: 'user-123',
          accountId: 'user-123',
          providerId: 'credential',
          userId: 'user-123',
        }),
      }),
    );
  });

  it('rejects Google-OIDC accounts with 403 even if they present a password', async () => {
    sessionFor();
    db.findProviders.mockResolvedValue([{ providerId: 'google' }] as never);
    const res = await POST(makeRequest({ body: { password: 'NewPass123!' } }) as never);

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/email & password accounts/i) });
    expect(db.updateUser).not.toHaveBeenCalled();
  });

  it('allows a dual-door account (credential + google) to change its password', async () => {
    sessionFor();
    db.findProviders.mockResolvedValue([{ providerId: 'credential' }, { providerId: 'google' }] as never);
    const res = await POST(makeRequest({ body: { password: 'NewPass123!' } }) as never);

    expect(res.status).toBe(200);
    expect(db.updateUser).toHaveBeenCalledTimes(1);
  });

  it('validates the payload: missing, empty and oversized passwords are 400', async () => {
    sessionFor();
    const noBody = await POST(makeRequest() as never);
    expect(noBody.status).toBe(400);

    const empty = await POST(makeRequest({ body: { password: '   ' } }) as never);
    expect(empty.status).toBe(400);

    const tooLong = await POST(makeRequest({ body: { password: 'x'.repeat(73) } }) as never);
    expect(tooLong.status).toBe(400);
  });

  it('surfaces validation failures before any DB write', async () => {
    sessionFor();
    const res = await POST(makeRequest({ body: { password: '' } }) as never);
    expect(res.status).toBe(400);
    expect(db.findProviders).not.toHaveBeenCalled();
  });

  it('rate-limits repeat callers with 429', async () => {
    sessionFor();
    vi.mocked(checkAuthRateLimit).mockReturnValueOnce(false);
    const res = await POST(makeRequest({ body: { password: 'NewPass123!' } }) as never);

    expect(res.status).toBe(429);
    expect(getClientIp).toHaveBeenCalled();
    expect(db.updateUser).not.toHaveBeenCalled();
  });

  it('maps DB outages to 503, others to 500', async () => {
    sessionFor();
    db.findProviders.mockRejectedValueOnce(new Error(`Can't reach database server`));
    const down = await POST(makeRequest({ body: { password: 'NewPass123!' } }) as never);
    expect(down.status).toBe(503);

    sessionFor();
    db.updateUser.mockRejectedValueOnce(new Error('boom'));
    vi.mocked(checkAuthRateLimit).mockClear(); // reset the mockReturnValueOnce consumed above
    const boom = await POST(makeRequest({ body: { password: 'NewPass123!' } }) as never);
    expect(boom.status).toBe(500);
  });
});
