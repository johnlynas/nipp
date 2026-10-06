/**
 * Integration tests: admin invite flow (Phase 2, Tasks 4–5).
 *
 * Drives the REAL route handlers with the super-admin scaffolding mocked at
 * its boundary (same seam as super-admin-integration.test.ts): requireSuperAdmin,
 * the RLS context wrappers, the rate limiter and logger. The email seam is a
 * hoisted module mock — lib/oidc-magic-link imports sendEmail as an ESM live
 * binding, so a post-hoc vi.spyOn cannot intercept it (Phase 1 plan note #4).
 * All Prisma calls land on a single hand-rolled mock; every assertion about
 * "a link was sent" goes through that log + the Verification row shape.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Email seam recorder — must exist before any import chain loads.
const { sentInvites, emailMode } = vi.hoisted(() => ({
  sentInvites: [] as Array<{ to: string; subject: string }>,
  // flip per-spec: 'ok' resolves success, 'down' rejects (simulates SMTP outage)
  emailMode: { value: 'ok' as 'ok' | 'down' },
}));

vi.mock('@/lib/notifications/email', () => ({
  sendEmail: (to: string, subject: string) => {
    sentInvites.push({ to, subject });
    if (emailMode.value === 'down') return Promise.reject(new Error('smtp down'));
    return Promise.resolve({ success: true as const });
  },
}));

const mockDb = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), create: vi.fn() },
  member: { create: vi.fn(), findFirst: vi.fn() },
  account: { create: vi.fn() },
  team: { findUnique: vi.fn(), findFirst: vi.fn().mockResolvedValue(null) },
  teamMember: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 'tm-x' }) },
  teamRole: { findMany: vi.fn().mockResolvedValue([]) },
  memberRole: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn() },
  auditLog: { create: vi.fn().mockResolvedValue({}) },
  // TeamService.addTeamMember runs its membership write through one transaction.
  $transaction: vi.fn(),
}));

vi.mock('@/lib/tenant-db', () => ({ default: mockDb }));
// lib/oidc-magic-link imports its own prisma from @/lib/db — stub the token
// table so no real database is touched by issue/consume. The verify route
// (Phase 3, Task 8) also uses this client for the User update after a
// successful consume.
const mockVerificationCreate = vi.hoisted(() => vi.fn().mockResolvedValue({ id: 'v-1' }));
const mockVerificationFindFirst = vi.hoisted(() => vi.fn());
const mockVerificationDeleteMany = vi.hoisted(() => vi.fn());
const mockVerifyUserFindUnique = vi.hoisted(() => vi.fn());
const mockVerifyUserUpdate = vi.hoisted(() => vi.fn().mockResolvedValue({}));
vi.mock('@/lib/db', () => ({
  prisma: {
    verification: { create: mockVerificationCreate, findFirst: mockVerificationFindFirst, deleteMany: mockVerificationDeleteMany },
    user: { findUnique: mockVerifyUserFindUnique, update: mockVerifyUserUpdate },
  },
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
// RLS wrappers — pass the op straight through (mocked DB, no real context needed).
vi.mock('@/lib/platform-db', () => ({
  withPlatformContext: (_u: string, op: () => Promise<unknown>) => op(),
  withTenantAdminContext: (_u: string, _o: string, op: () => Promise<unknown>) => op(),
}));
// The verify route rate-limits by IP — hoisted so specs can flip it to false.
const mockAuthRateCheck = vi.hoisted(() => vi.fn().mockReturnValue(true));
vi.mock('@/lib/rate-limiter', () => ({
  checkAdminRateLimit: vi.fn().mockReturnValue(true),
  checkAuthRateLimit: mockAuthRateCheck,
  getClientIp: vi.fn(() => '203.0.113.7'),
}));
// SSE push — no Redis/stream needed in this spec.
const mockNotifyUserOperation = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('@/lib/notification-push', () => ({ notifyUserOperation: mockNotifyUserOperation }));

// Super-admin boundary — every spec controls the session identity.
const mockSession = { user: { id: 'super-admin-1', email: 'admin@propni.example.com', name: 'Super Admin' }, session: {} };
vi.mock('@/lib/require-super-admin', () => ({
  requireSuperAdmin: vi.fn(async () => ({ session: mockSession, authorized: true, status: 200 })),
}));

const { POST: createRoute } = await import('@/app/api/dashboard/admin/users/route');
const { POST: adminCreateRoute } = await import('@/app/api/admin/users/route');
const { POST: invitePost } = await import('@/app/api/dashboard/admin/users/[id]/invite/route');
const { GET: verifyGet } = await import('@/app/auth/magic-link/verify/route');

function toNextRequest(request: Request): NextRequest {
  // Carry the body through (Request bodies are consumed once). Cast — Next's
  // RequestInit signals typing differs from undici within this codebase.
  const init = { method: request.method, headers: request.headers };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    (init as { body?: ReadableStream | null }).body = request.body;
  }
  return new NextRequest(request.url, init as never);
}

function postJson(url: string, body: unknown) {
  return new Request(url, {
    method: 'POST',
    headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// File-wide reset (applies to every describe below).
beforeEach(() => {
  vi.clearAllMocks();
  sentInvites.length = 0;
  emailMode.value = 'ok';
});

// ---------------------------------------------------------------------------
// POST /api/dashboard/admin/users — create with org/team + auto magic link
// ---------------------------------------------------------------------------

describe('POST /api/dashboard/admin/users (create)', () => {
  const orgId = 'org-invoke-1';

  it('passwordless + valid org → 202, user created, Member row, default-team enrollment, email sent', async () => {
    mockDb.user.findUnique.mockResolvedValue(null);
    mockDb.user.create.mockImplementation(async ({ data }) => ({ id: 'new-user-1', ...data, createdAt: new Date(), updatedAt: new Date() }));
    mockDb.member.create.mockResolvedValue({ id: 'm-1' });
    // default members team exists; user not enrolled yet
    mockDb.team.findFirst.mockImplementation(async (args) => {
      if (Object.prototype.hasOwnProperty.call(args.where, 'slug')) {
        return { id: 'members-team', slug: 'members', organizationId: orgId };
      }
      return null;
    });
    mockDb.memberRole.findFirst.mockResolvedValue(null);

    const res = await createRoute(
      toNextRequest(postJson('http://localhost:3000/api/dashboard/admin/users', {
        name: 'Invited Person', email: `invite1.${Date.now()}@propni.example.com`, organizationId: orgId,
      })),
    );

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.user.id).toBe('new-user-1');
    expect(body.magicLinkSent).toBe(true);

    // Member row created for the target org.
    expect(mockDb.member.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 'new-user-1', orgId, role: 'member' }) }),
    );
    // Default "Members" team enrollment (no teamId requested).
    expect(mockDb.teamMember.create).toHaveBeenCalledWith(
      { data: { userId: 'new-user-1', teamId: 'members-team', organizationId: orgId } },
    );
    // Invitation email fired exactly once for the invitee.
    expect(sentInvites).toHaveLength(1);
    const sent = sentInvites[0];
    expect(String(sent.subject)).toMatch(/activat/i);

    // Consumable token row landed in the Verification table (kind marker + ~5min TTL).
    expect(mockVerificationCreate).toHaveBeenCalledTimes(1);
    const created = mockVerificationCreate.mock.calls[0][0].data as { identifier: string; value: string; expiresAt: Date };
    expect(created.identifier.length).toBeGreaterThanOrEqual(32);
    const tokenValue = JSON.parse(created.value);
    expect(tokenValue.kind).toBe('oidc-invite');
    const ttlMs = created.expiresAt.getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(4 * 60 * 1000);

    // Audit trail: creation + invite issuance both recorded.
    const auditActions = mockDb.auditLog.create.mock.calls.map((c) => c[0].data.action);
    expect(auditActions).toContain('user.created');
    expect(auditActions).toContain('user.invite-issued');

    // SSE push to other admins (restored behavior, must not regress).
    expect(mockNotifyUserOperation).toHaveBeenCalledWith(
      'create',
      expect.stringContaining('@'),
      true,
      undefined,
      orgId,
    );
  });

  it('passwordless + valid org + teamId in that org → 202, enrollment into THAT team', async () => {
    const email = `invite2.${Date.now()}@propni.example.com`;
    mockDb.user.findUnique.mockResolvedValue(null);
    mockDb.user.create.mockImplementation(async ({ data }) => ({ id: 'new-user-2', ...data, createdAt: new Date(), updatedAt: new Date() }));
    mockDb.member.create.mockResolvedValue({ id: 'm-1' });
    // exact-id team lookup (service) + findFirst lookups (addTeamMember internals) all resolve to the same team/org
    mockDb.team.findUnique.mockResolvedValue({ id: 'team-blue', organizationId: orgId });
    mockDb.team.findFirst.mockResolvedValue({ id: 'team-blue', organizationId: orgId });
    mockDb.member.findFirst.mockResolvedValue({ id: 'm-1', userId: 'new-user-2', orgId: orgId });
    mockDb.teamMember.findFirst.mockResolvedValue(null);
    mockDb.$transaction.mockImplementation(async (fn) => fn(mockDb));

    const res = await createRoute(
      toNextRequest(postJson('http://localhost:3000/api/dashboard/admin/users', {
        name: 'Team Invited', email, organizationId: orgId, teamId: 'team-blue',
      })),
    );

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.magicLinkSent).toBe(true);
    // Enrolled into the requested team — NOT the default Members team.
    expect(mockDb.teamMember.create).toHaveBeenCalledWith({
      data: { userId: 'new-user-2', teamId: 'team-blue', organizationId: orgId },
    });
  });

  it('passwordless + teamId from a DIFFERENT org → 400, no user row', async () => {
    const email = `invite3.${Date.now()}@propni.example.com`;
    mockDb.user.findUnique.mockResolvedValue(null);
    // foreign team lives in the platform org
    mockDb.team.findUnique.mockResolvedValue({ id: 'platform-team', organizationId: 'org-platform' });

    const res = await createRoute(
      toNextRequest(postJson('http://localhost:3000/api/dashboard/admin/users', {
        name: 'Cross Org Invite', email, organizationId: orgId, teamId: 'platform-team',
      })),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(String(body.error)).toMatch(/does not belong to the selected organization/i);
    expect(mockDb.user.create).not.toHaveBeenCalled();
    expect(sentInvites).toHaveLength(0);
  });

  it('passwordless without org → 400 from the route (organizationId required)', async () => {
    const res = await createRoute(
      toNextRequest(postJson('http://localhost:3000/api/dashboard/admin/users', {
        name: 'No Org Invite', email: `invite4.${Date.now()}@propni.example.com`,
      })),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(String(body.error)).toMatch(/organization/i);
    expect(mockDb.user.create).not.toHaveBeenCalled();
  });

  it('with password → 201, no invite email, magicLinkSent: false', async () => {
    const email = `invite5.${Date.now()}@propni.example.com`;
    mockDb.user.findUnique.mockResolvedValue(null);
    mockDb.user.create.mockImplementation(async ({ data }) => ({ id: 'new-user-5', ...data, createdAt: new Date(), updatedAt: new Date() }));
    mockDb.member.create.mockResolvedValue({ id: 'm-1' });

    const res = await createRoute(
      toNextRequest(postJson('http://localhost:3000/api/dashboard/admin/users', {
        name: 'Pw User', email, password: 'PwOnly123!', organizationId: orgId,
      })),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.user.id).toBe('new-user-5');
    expect(body.magicLinkSent).toBe(false);
    // No activation email for password users.
    expect(sentInvites).toHaveLength(0);
  });

  it('SMTP outage → create still succeeds with magicLinkSent: false (admin can resend)', async () => {
    emailMode.value = 'down';
    const email = `invite6.${Date.now()}@propni.example.com`;
    mockDb.user.findUnique.mockResolvedValue(null);
    mockDb.user.create.mockImplementation(async ({ data }) => ({ id: 'new-user-6', ...data, createdAt: new Date(), updatedAt: new Date() }));
    mockDb.member.create.mockResolvedValue({ id: 'm-1' });

    const res = await createRoute(
      toNextRequest(postJson('http://localhost:3000/api/dashboard/admin/users', {
        name: 'Smtp Down Invite', email, organizationId: orgId,
      })),
    );

    // issueInviteLink swallows SMTP failures — the token stays in the DB.
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.magicLinkSent).toBe(false);
  });

  it('duplicate email → 409 (unchanged)', async () => {
    mockDb.user.findUnique.mockResolvedValue({ id: 'existing', email: 'taken@propni.example.com' });

    const res = await createRoute(
      toNextRequest(postJson('http://localhost:3000/api/dashboard/admin/users', {
        name: 'Taken', email: 'taken@propni.example.com', organizationId: orgId,
      })),
    );

    expect(res.status).toBe(409);
  });
});

describe('POST /api/admin/users (parallel create route)', () => {
  it('passwordless without org → 400 via the admin route too', async () => {
    const res = await adminCreateRoute(
      toNextRequest(postJson('http://localhost:3000/api/admin/users', {
        name: 'No Org Admin Invite', email: `invite7.${Date.now()}@propni.example.com`,
      })),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(String(body.error)).toMatch(/organization/i);
  });
});

// ---------------------------------------------------------------------------
// POST /api/dashboard/admin/users/[id]/invite — resend
// ---------------------------------------------------------------------------

describe('POST /api/dashboard/admin/users/[id]/invite (resend)', () => {
  const paramsPromise = Promise.resolve({ id: 'user-invite-target' });

  it('existing pending user → 200 + resent: true, email fired', async () => {
    mockDb.user.findUnique.mockImplementation(async ({ where }) => {
      if (where.id === 'user-invite-target') {
        return { id: 'user-invite-target', name: 'Pending Invitee', email: `pending.${Date.now()}@propni.example.com`, oidcVerified: false };
      }
      return null;
    });

    const res = await invitePost(
      toNextRequest(postJson('http://localhost:3000/api/dashboard/admin/users/user-invite-target/invite', {})),
      { params: paramsPromise },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ resent: true });
    expect(sentInvites).toHaveLength(1);
    // Audit trail for the resend.
    expect(mockDb.auditLog.create.mock.calls.some((c) => c[0].data.action === 'user.invite-resent')).toBe(true);
  });

  it('already verified → 200 alreadyVerified, no email', async () => {
    mockDb.user.findUnique.mockImplementation(async ({ where }) => {
      if (where.id === 'user-invite-target') {
        return { id: 'user-invite-target', name: 'Done Invitee', email: `done.${Date.now()}@propni.example.com`, oidcVerified: true };
      }
      return null;
    });

    const res = await invitePost(
      toNextRequest(postJson('http://localhost:3000/api/dashboard/admin/users/user-invite-target/invite', {})),
      { params: paramsPromise },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alreadyVerified).toBe(true);
    expect(sentInvites).toHaveLength(0);
  });

  it('unknown id → 404, no email', async () => {
    mockDb.user.findUnique.mockResolvedValue(null);

    const res = await invitePost(
      toNextRequest(postJson('http://localhost:3000/api/dashboard/admin/users/ghost-user/invite', {})),
      { params: Promise.resolve({ id: 'ghost-user' }) },
    );

    expect(res.status).toBe(404);
    expect(sentInvites).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// GET /auth/magic-link/verify — the emailed link destination (Phase 3, Task 8)
// ---------------------------------------------------------------------------

describe('GET /auth/magic-link/verify', () => {
  const token = 'vrfy' + 'token-abc123';
  const email = `verified.${Date.now()}@propni.example.com`;

  function verifyRequest(query: string) {
    return new NextRequest(`http://localhost:3000/auth/magic-link/verify?${query}`, {
      headers: { 'x-forwarded-for': '203.0.113.7' },
    });
  }

  it('valid token → 307 to /login?oidc=link-verified, user marked oidcVerified, NO session cookie', async () => {
    mockVerificationFindFirst.mockResolvedValue({
      identifier: token,
      value: JSON.stringify({ email, kind: 'oidc-invite' }),
      expiresAt: new Date(Date.now() + 120_000),
    });
    mockVerificationDeleteMany.mockResolvedValue({ count: 1 });
    mockVerifyUserFindUnique.mockResolvedValue({
      id: 'u-verify-1',
      email,
      name: 'Verified Person',
      oidcVerified: false,
      emailVerified: false,
    });

    const res = await verifyGet(verifyRequest(`token=${token}`));

    expect(res.status).toBe(307);
    const location = res.headers.get('location');
    expect(location).toContain('/login?oidc=link-verified');

    // Atomic claim fired, then exactly one idempotent flag update.
    expect(mockVerificationDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ identifier: token }) }),
    );
    expect(mockVerifyUserUpdate).toHaveBeenCalledTimes(1);
    expect(mockVerifyUserUpdate.mock.calls[0][0]).toEqual({
      where: { id: 'u-verify-1' },
      data: { oidcVerified: true, emailVerified: true },
    });

    // Contract of design §4.3: the verify route NEVER mints a session — no
    // better-auth cookie may be set anywhere in the response.
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('replaying a consumed token → link-expired (no update, no email)', async () => {
    mockVerificationFindFirst.mockResolvedValue(null); // row already deleted by the first consume

    const res = await verifyGet(verifyRequest(`token=${token}`));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login?oidc=link-expired');
    expect(mockVerificationDeleteMany).not.toHaveBeenCalled();
    expect(mockVerifyUserUpdate).not.toHaveBeenCalled();
    expect(sentInvites).toHaveLength(0);
  });

  it('expired token → link-expired, distinct from invalid', async () => {
    mockVerificationFindFirst.mockResolvedValue({
      identifier: token,
      value: JSON.stringify({ email, kind: 'oidc-invite' }),
      expiresAt: new Date(Date.now() - 1000), // past TTL
    });

    const res = await verifyGet(verifyRequest(`token=${token}`));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login?oidc=link-expired');
    expect(mockVerificationDeleteMany).not.toHaveBeenCalled();
    expect(mockVerifyUserUpdate).not.toHaveBeenCalled();
  });

  it('IP-rate-limited → 429 with the token preserved (no consume)', async () => {
    mockAuthRateCheck.mockReturnValueOnce(false);

    const res = await verifyGet(verifyRequest(`token=${token}`));

    expect(res.status).toBe(429);
    expect(mockVerificationFindFirst).not.toHaveBeenCalled();
    expect(mockVerificationDeleteMany).not.toHaveBeenCalled();
    expect(mockVerifyUserUpdate).not.toHaveBeenCalled();
  });

  it('missing token → link-expired, no DB reads', async () => {
    const res = await verifyGet(verifyRequest(''));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login?oidc=link-expired');
    expect(mockVerificationFindFirst).not.toHaveBeenCalled();
  });
});
