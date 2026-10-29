/**
 * Integration tests: forgot-password public API routes (Phase 3).
 *
 * Same mock-boundary convention as user-invite-flow.test.ts: the REAL route
 * handlers are driven; seams are mocked at their module edges — lib/db (global
 * prisma), lib/auth (auth.api.requestPasswordReset/resetPassword + enforceBanStatus),
 * lib/rate-limiter, audit-log, logger. The routes call BetterAuth IN-PROCESS
 * (plan R1 decision) so the stock handlers themselves are the seam: what flows
 * through them (bodies, headers) and what guards run before/after is asserted
 * here; BA's internal token/hashing behaviour is pinned by tests/unit/auth-config.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Seams (hoisted — must exist before any import chain loads)
// ---------------------------------------------------------------------------

const mockPrisma = vi.hoisted(() => ({
  verification: { findFirst: vi.fn(), deleteMany: vi.fn() },
  user: { findUnique: vi.fn() },
  account: { findMany: vi.fn() },
}));

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }));

const mockEnforceBan = vi.hoisted(() => vi.fn());
const baApi = vi.hoisted(() => ({
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ auth: { api: baApi }, enforceBanStatus: mockEnforceBan }));

const mockRateCheck = vi.hoisted(() => vi.fn().mockReturnValue(true));
vi.mock('@/lib/rate-limiter', () => ({
  checkPasswordResetRateLimit: mockRateCheck,
  getClientIp: vi.fn(() => '203.0.113.7'),
}));

const mockRecordAudit = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('@/lib/audit-log', () => ({ recordAuditLog: mockRecordAudit }));

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/platform-db', () => ({ withPlatformContext: (_u: string, op: () => unknown) => op() }));
// nodemailer is never instantiated in these specs (email seam lives inside the mocked BA hook).
vi.mock('nodemailer', () => ({}));

const { POST: requestPost } = await import('@/app/api/auth/password-reset/route');
const { GET: verifyGet } = await import('@/app/api/auth/password-reset/verify/route');
const { POST: resetPost } = await import('@/app/api/auth/password-reset/reset/route');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Plain Request vs NextRequest at call sites — same `as never` convention as
// password-change.test.ts; postJson returns a request typed for resetPost.
function postJson(url: string, body: unknown) {
  return new Request(url, {
    method: 'POST',
    headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof resetPost>[0];
}

const TOKEN = 'r3s3t-token-abc123';
const LOCAL_USER = { id: 'u-local-1', email: 'local@propni.example.com' };

beforeEach(() => {
  vi.clearAllMocks();
  mockRateCheck.mockReturnValue(true);
  baApi.requestPasswordReset.mockResolvedValue({ status: true, message: "If this email exists in our system, check your email for the reset link" });
  baApi.resetPassword.mockResolvedValue({ status: true });
});

async function verificationRows(identifier: string, userId: string, expiresInMs: number) {
  mockPrisma.verification.findFirst.mockResolvedValue({
    identifier,
    value: userId,
    expiresAt: new Date(Date.now() + expiresInMs),
  });
}

// ---------------------------------------------------------------------------
// POST /api/auth/password-reset — request route
// ---------------------------------------------------------------------------

describe('POST /api/auth/password-reset (request)', () => {
  it('known active local user → 200 pass-through of BetterAuth body, audit with masked email', async () => {
    mockEnforceBan.mockResolvedValue(undefined); // active (not banned)

    const res = await requestPost(postJson('http://localhost:3000/api/auth/password-reset', { email: 'LOCAL@propni.example.com' }) as never);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: true, message: expect.stringMatching(/check your email/i) });

    // In-process BA call carried exactly the normalised email + host header.
    expect(baApi.requestPasswordReset).toHaveBeenCalledTimes(1);
    const call = baApi.requestPasswordReset.mock.calls[0][0];
    expect(call.body).toEqual({ email: 'local@propni.example.com' });
    expect(new Headers(call.headers).get('host')).toBe('localhost:3000');

    // Audit fired (fire-and-forget) with MASKED email only + IP — never raw PII.
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'user.password-reset-requested',
        resourceType: 'User',
        success: true,
        ipAddress: '203.0.113.7',
        metadata: { maskedEmail: 'l***@propni.example.com' },
      }),
    );

    // No-store on the response (no reset flow state may be cached).
    expect(res.headers.get('cache-control')).toContain('no-store');
  });

  it('unknown email → SAME 200 shape (no account oracle; BA internals do the equalisation)', async () => {
    mockEnforceBan.mockResolvedValue(undefined); // no row — gate passes silently

    const res = await requestPost(postJson('http://localhost:3000/api/auth/password-reset', { email: 'nobody@propni.example.com' }) as never);

    expect(res.status).toBe(200);
    const body = await res.json();
    // The copy is the idempotent BetterAuth acknowledgement — identical to a known account.
    expect(body).toMatchObject({ status: true, message: expect.stringMatching(/check your email/i) });
    // Unknown emails still hand to BetterAuth — it is the no-oracle + timing-equalising layer (design R3).
    expect(baApi.requestPasswordReset).toHaveBeenCalledTimes(1);
  });

  it('banned local user → 401 with the login banner copy, BA handler never reached', async () => {
    const { APIError } = await import('better-auth/api');
    mockEnforceBan.mockRejectedValue(
      new APIError('UNAUTHORIZED', { message: 'Access denied. Your account has been banned.' }),
    );

    const res = await requestPost(postJson('http://localhost:3000/api/auth/password-reset', { email: 'local@propni.example.com' }) as never);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Access denied. Your account has been banned.' });
    expect(baApi.requestPasswordReset).not.toHaveBeenCalled();
    expect(mockPrisma.verification.findFirst).not.toHaveBeenCalled();
  });

  it('invalid / missing email → 400 before any guard or BA call', async () => {
    const malformed = await requestPost(postJson('http://localhost:3000/api/auth/password-reset', { email: 'not-an-email' }) as never);
    expect(malformed.status).toBe(400);

    const missing = await requestPost(postJson('http://localhost:3000/api/auth/password-reset', {}) as never);
    expect(missing.status).toBe(400);

    expect(mockEnforceBan).not.toHaveBeenCalled();
    expect(baApi.requestPasswordReset).not.toHaveBeenCalled();
  });

  it('malformed JSON body → 400', async () => {
    const req = new Request('http://localhost:3000/api/auth/password-reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{nope',
    });
    expect((await requestPost(req as never)).status).toBe(400);
  });

  it('rate-limited IP → 429 with Retry-After, and ZERO downstream work', async () => {
    mockRateCheck.mockReturnValue(false);

    const res = await requestPost(postJson('http://localhost:3000/api/auth/password-reset', { email: 'local@propni.example.com' }) as never);

    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('60');
    expect(mockEnforceBan).not.toHaveBeenCalled();
    expect(baApi.requestPasswordReset).not.toHaveBeenCalled();
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it('DB outage (ban gate lookup) → 503', async () => {
    mockEnforceBan.mockRejectedValue(new Error("Can't reach database server"));

    const res = await requestPost(postJson('http://localhost:3000/api/auth/password-reset', { email: 'local@propni.example.com' }) as never);
    expect(res.status).toBe(503);
  });
});

// ---------------------------------------------------------------------------
// GET /api/auth/password-reset/verify — read-only token pre-flight
// ---------------------------------------------------------------------------

describe('GET /api/auth/password-reset/verify', () => {
  function verifyRequest(query: string) {
    return new NextRequest(`http://localhost:3000/api/auth/password-reset/verify?${query}`, {
      method: 'GET',
      headers: { Origin: 'http://localhost:3000' },
    });
  }

  beforeEach(() => {
    mockPrisma.verification.findFirst.mockResolvedValue(null);
    mockPrisma.user.findUnique.mockResolvedValue(LOCAL_USER);
  });

  it('valid, unexpired token → { valid: true, expiresInSeconds } + link-opened audit for the owner', async () => {
    await verificationRows(`reset-password:${TOKEN}`, LOCAL_USER.id, 30 * 60 * 1000);

    const res = await verifyGet(verifyRequest(`token=${TOKEN}`));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(true);
    expect(body.expiresInSeconds).toBeGreaterThan(0);
    expect(body.expiresInSeconds).toBeLessThanOrEqual(30 * 60);

    // The audit fires ONLY on the valid path and carries the owner + masked email.
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'user.password-reset-link-opened',
        resourceId: LOCAL_USER.id,
        success: true,
        metadata: { maskedEmail: 'l***@propni.example.com' },
      }),
    );
  });

  it('is READ-ONLY: a valid token is never deleted by verify (consume stays in the reset handler)', async () => {
    await verificationRows(`reset-password:${TOKEN}`, LOCAL_USER.id, 30 * 60 * 1000);

    await verifyGet(verifyRequest(`token=${TOKEN}`));

    expect(mockPrisma.verification.deleteMany).not.toHaveBeenCalled();
    // and pre-flight read exactly the identifier form BetterAuth mints:
    expect(mockPrisma.verification.findFirst).toHaveBeenCalledWith({
      where: { identifier: `reset-password:${TOKEN}` },
    });
  });

  it('replayed (already consumed) token → valid:false, no audit', async () => {
    mockPrisma.verification.findFirst.mockResolvedValue(null); // row gone

    const res = await verifyGet(verifyRequest(`token=${TOKEN}`));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ valid: false, reason: 'invalid-or-expired' });
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it('expired token → valid:false (row exists but expired)', async () => {
    await verificationRows(`reset-password:${TOKEN}`, LOCAL_USER.id, -1000);

    const res = await verifyGet(verifyRequest(`token=${TOKEN}`));
    expect(await res.json()).toEqual({ valid: false, reason: 'invalid-or-expired' });
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it('missing token → { valid:false, reason:"missing" }, no DB read', async () => {
    const res = await verifyGet(verifyRequest('') as never);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ valid: false, reason: 'missing' });
    expect(mockPrisma.verification.findFirst).not.toHaveBeenCalled();
  });

  it('rate-limited IP → 429 and the token is untouched', async () => {
    mockRateCheck.mockReturnValue(false);
    await verificationRows(`reset-password:${TOKEN}`, LOCAL_USER.id, 30 * 60 * 1000);

    const res = await verifyGet(verifyRequest(`token=${TOKEN}`));

    expect(res.status).toBe(429);
    expect(mockPrisma.verification.findFirst).not.toHaveBeenCalled();
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/password-reset/reset — complete the reset
// ---------------------------------------------------------------------------

describe('POST /api/auth/password-reset/reset', () => {
  function happyFixture() {
    verificationRows(`reset-password:${TOKEN}`, LOCAL_USER.id, 30 * 60 * 1000);
    mockPrisma.user.findUnique.mockResolvedValue(LOCAL_USER);
    mockPrisma.account.findMany.mockResolvedValue([{ providerId: 'credential' }]);
    mockEnforceBan.mockResolvedValue(undefined);
  }

  it('full happy path → 200 { success, message }, BA called with the token + new password, success audit', async () => {
    happyFixture();

    const res = await resetPost(
      postJson('http://localhost:3000/api/auth/password-reset/reset', { newPassword: 'BrandNew123!', token: TOKEN }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, message: 'Password updated' });
    expect(baApi.resetPassword).toHaveBeenCalledTimes(1);
    const call = baApi.resetPassword.mock.calls[0][0];
    expect(call.body).toEqual({ newPassword: 'BrandNew123!', token: TOKEN });

    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'user.password-reset-success',
        userId: LOCAL_USER.id,
        resourceId: LOCAL_USER.id,
        success: true,
        metadata: { maskedEmail: 'l***@propni.example.com' },
      }),
    );
    expect(res.headers.get('cache-control')).toContain('no-store');
  });

  it('replayed / unknown token → 400 invalid-or-expired copy, BA handler never reached, no success audit', async () => {
    mockPrisma.verification.findFirst.mockResolvedValue(null);
    mockPrisma.user.findUnique.mockResolvedValue(LOCAL_USER);

    const res = await resetPost(
      postJson('http://localhost:3000/api/auth/password-reset/reset', { newPassword: 'BrandNew123!', token: TOKEN }),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid or expired reset link.' });
    expect(baApi.resetPassword).not.toHaveBeenCalled();
    expect(mockRecordAudit).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'user.password-reset-success' }),
    );
  });

  it('expired token → same 400 copy (no oracle between expired and invalid)', async () => {
    await verificationRows(`reset-password:${TOKEN}`, LOCAL_USER.id, -1000);

    const res = await resetPost(
      postJson('http://localhost:3000/api/auth/password-reset/reset', { newPassword: 'BrandNew123!', token: TOKEN }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid or expired reset link.' });
  });

  it('OIDC-only account (forged body) → 403 server-side guard, BA never reached', async () => {
    mockPrisma.verification.findFirst.mockResolvedValue({ identifier: `reset-password:${TOKEN}`, value: 'u-oidc-only', expiresAt: new Date(Date.now() + 60_000) });
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u-oidc-only', email: 'goolge@propni.example.com' });
    mockPrisma.account.findMany.mockResolvedValue([{ providerId: 'google' }]);

    const res = await resetPost(
      postJson('http://localhost:3000/api/auth/password-reset/reset', { newPassword: 'BrandNew123!', token: TOKEN }),
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Password resets are only available for email & password accounts.' });
    expect(baApi.resetPassword).not.toHaveBeenCalled();
  });

  it('banned at mutation time → 401, BA never reached', async () => {
    happyFixture();
    const { APIError } = await import('better-auth/api');
    mockEnforceBan.mockRejectedValue(new APIError('UNAUTHORIZED', { message: 'Access denied. Your account has been suspended.' }));

    const res = await resetPost(
      postJson('http://localhost:3000/api/auth/password-reset/reset', { newPassword: 'BrandNew123!', token: TOKEN }),
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Access denied. Your account has been suspended.' });
    expect(baApi.resetPassword).not.toHaveBeenCalled();
  });

  it('scrypt ceiling pre-check: >72 chars → 400 with the /api/auth/password copy, before any DB read', async () => {
    const res = await resetPost(
      postJson('http://localhost:3000/api/auth/password-reset/reset', { newPassword: 'x'.repeat(73), token: TOKEN }),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Password must be at most 72 characters.' });
    expect(mockPrisma.verification.findFirst).not.toHaveBeenCalled();
    expect(baApi.resetPassword).not.toHaveBeenCalled();
  });

  it('missing token / newPassword → 400', async () => {
    const noToken = await resetPost(postJson('http://localhost:3000/api/auth/password-reset/reset', { newPassword: 'BrandNew123!' }) as never);
    expect(noToken.status).toBe(400);

    const noPassword = await resetPost(postJson('http://localhost:3000/api/auth/password-reset/reset', { token: TOKEN }) as never);
    expect(noPassword.status).toBe(400);

    expect(baApi.resetPassword).not.toHaveBeenCalled();
  });

  it('surfaces BetterAuth validation failures verbatim (min length) as their status', async () => {
    happyFixture();
    const { APIError } = await import('better-auth/api');
    baApi.resetPassword.mockRejectedValue(
      new APIError('BAD_REQUEST', { message: 'Password must be at least 8 characters.' }),
    );

    const res = await resetPost(
      postJson('http://localhost:3000/api/auth/password-reset/reset', { newPassword: 'short', token: TOKEN }),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Password must be at least 8 characters.' });
    expect(mockRecordAudit).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'user.password-reset-success' }));
  });

  it('DB outage → 503 (not 500)', async () => {
    mockPrisma.verification.findFirst.mockRejectedValue(new Error("Can't reach database server"));

    const res = await resetPost(
      postJson('http://localhost:3000/api/auth/password-reset/reset', { newPassword: 'BrandNew123!', token: TOKEN }),
    );
    expect(res.status).toBe(503);
  });

  it('rate-limited IP → 429, nothing downstream', async () => {
    mockRateCheck.mockReturnValue(false);

    const res = await resetPost(
      postJson('http://localhost:3000/api/auth/password-reset/reset', { newPassword: 'BrandNew123!', token: TOKEN }),
    );

    expect(res.status).toBe(429);
    expect(mockPrisma.verification.findFirst).not.toHaveBeenCalled();
    expect(baApi.resetPassword).not.toHaveBeenCalled();
  });
});
