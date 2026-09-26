/**
 * Mocked handler tests for members API routes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// Mock all dependencies before importing the route
vi.mock('@/lib/require-super-admin', () => ({
  requireSuperAdmin: vi.fn(),
}));

vi.mock('@/lib/tenant-db', () => ({
  default: {
    organization: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    user: { findUnique: vi.fn(), create: vi.fn() },
    member: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    rolePermission: { findFirst: vi.fn(), create: vi.fn() },
    role: { findMany: vi.fn() },
    // Default "Members" team auto-enrollment (lib/org-default-team)
    team: {
      findFirst: vi.fn().mockResolvedValue({ id: 'members-team', slug: 'members' }),
      create: vi.fn(),
    },
    teamMember: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn() },
    teamRole: { findMany: vi.fn().mockResolvedValue([]) },
    memberRole: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn() },
  },
}));

vi.mock('@/lib/tenant-context', () => ({
  runWithTenant: vi.fn(async (_orgId: string, fn: () => Promise<unknown>) => fn()),
}));

vi.mock('@/lib/platform-db', () => ({
  // Pass-through: these unit tests exercise route logic with mocked tenantDb;
  // the verified platform-admin RLS wrapper itself is covered by
  // tests/unit/rls-transaction.test.ts.
  withTenantAdminContext: vi.fn(async (_userId: string, _orgId: string, fn: () => Promise<unknown>) => fn()),
}));

vi.mock('@/lib/audit-log', () => ({
  recordAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn().mockResolvedValue({
        session: { id: 'session-1', userId: 'admin-1' },
        user: { id: 'admin-1', name: 'Admin User' },
      }),
    },
  },
}));

const { requireSuperAdmin } = await import('@/lib/require-super-admin');
const globalDb = (await import('@/lib/tenant-db')).default;
const tenantDb = (await import('@/lib/tenant-db')).default;
const { runWithTenant } = await import('@/lib/tenant-context');
const { recordAuditLog } = await import('@/lib/audit-log');

const { GET, POST } = await import(
  '@/app/api/admin/organizations/[orgId]/members/route'
);

// Shared mock session with proper structure matching auth.api.getSession() return type
const mockSession = {
  session: { id: 'session-1', userId: 'admin-1' },
  user: { id: 'admin-1', name: 'Admin User' },
};

describe('GET /api/admin/organizations/[orgId]/members', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should return members when authorized', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      authorized: true,
      session: mockSession,
    } as any);

    vi.mocked(globalDb.organization.findUnique).mockResolvedValue({ id: 'org-1' } as any);
    vi.mocked(tenantDb.member.findMany).mockResolvedValue([
      {
        id: 'member-1',
        userId: 'user-1',
        orgId: 'org-1',
        role: 'member',
        createdAt: new Date(),
        updatedAt: new Date(),
        user: { name: 'Test User', email: 'test@example.com' },
      } as any,
    ]);

    const response = await GET({ url: 'http://localhost/api/admin/organizations/org-1/members', headers: new Headers() } as NextRequest);

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.members).toHaveLength(1);
    expect(json.members[0].user.email).toBe('test@example.com');
  });

  it('should return empty array when org has no members', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      authorized: true,
      session: mockSession,
    } as any);

    vi.mocked(globalDb.organization.findUnique).mockResolvedValue({ id: 'org-1' } as any);
    vi.mocked(tenantDb.member.findMany).mockResolvedValue([]);

    const response = await GET({ url: 'http://localhost/api/admin/organizations/org-1/members', headers: new Headers() } as NextRequest);

    expect(response.status).toBe(200);
  });

  it('should return 403 when not authorized', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      session: null,
      authorized: false,
      error: 'Unauthorized',
      status: 403,
    });

    const response = await GET({ url: 'http://localhost/api/admin/organizations/org-1/members', headers: new Headers() } as NextRequest);

    expect(response.status).toBe(403);
  });

  it('should return 503 when database is unavailable', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      authorized: true,
      session: mockSession,
    } as any);

    vi.mocked(globalDb.organization.findUnique).mockRejectedValue(
      new Error("Can't reach database server")
    );

    const response = await GET({ url: 'http://localhost/api/admin/organizations/org-1/members', headers: new Headers() } as NextRequest);

    expect(response.status).toBe(503);
  });

  it('should return 404 when organization not found', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      authorized: true,
      session: mockSession,
    } as any);

    vi.mocked(globalDb.organization.findUnique).mockResolvedValue(null);

    const response = await GET({ url: 'http://localhost/api/admin/organizations/org-1/members', headers: new Headers() } as NextRequest);

    expect(response.status).toBe(404);
  });
});

describe('POST /api/admin/organizations/[orgId]/members', () => {
  beforeEach(() => vi.clearAllMocks());

  function createRequest(body: Record<string, unknown>) {
    return {
      url: 'http://localhost/api/admin/organizations/org-1/members',
      json: () => Promise.resolve(body),
      headers: new Headers(),
    } as unknown as NextRequest;
  }

  it('should add a member when authorized with valid email', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      authorized: true,
      session: mockSession,
    } as any);

    vi.mocked(globalDb.organization.findUnique).mockResolvedValue({ id: 'org-1' } as any);
    vi.mocked(globalDb.user.findUnique).mockResolvedValue({ id: 'user-1' } as any);
    vi.mocked(globalDb.member.findFirst).mockResolvedValue(null);
    vi.mocked(tenantDb.member.create).mockResolvedValue({
      id: 'member-1',
      userId: 'user-1',
      orgId: 'org-1',
      role: 'member',
    } as any);

    const response = await POST(
      createRequest({ email: 'test@example.com', role: 'member' })
    );

    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json.message).toBe('Member added successfully');
  });

  it('should auto-enroll the new member in the org default Members team', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      authorized: true,
      session: mockSession,
    } as any);

    vi.mocked(globalDb.organization.findUnique).mockResolvedValue({ id: 'org-1' } as any);
    vi.mocked(globalDb.user.findUnique).mockResolvedValue({ id: 'user-1' } as any);
    vi.mocked(globalDb.member.findFirst).mockResolvedValue(null);
    vi.mocked(tenantDb.member.create).mockResolvedValue({
      id: 'member-1',
      userId: 'user-1',
      orgId: 'org-1',
      role: 'member',
    } as any);

    const response = await POST(
      createRequest({ email: 'test@example.com', role: 'member' })
    );

    expect(response.status).toBe(201);
    expect(tenantDb.teamMember.create).toHaveBeenCalledWith({
      data: { userId: 'user-1', teamId: 'members-team', organizationId: 'org-1' },
    });
  });

  it('should heal a legacy org without a Members team before enrolling', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      authorized: true,
      session: mockSession,
    } as any);

    vi.mocked(globalDb.organization.findUnique).mockResolvedValue({ id: 'org-1' } as any);
    vi.mocked(globalDb.user.findUnique).mockResolvedValue({ id: 'user-1' } as any);
    vi.mocked(globalDb.member.findFirst).mockResolvedValue(null);
    vi.mocked(tenantDb.member.create).mockResolvedValue({
      id: 'member-1',
      userId: 'user-1',
      orgId: 'org-1',
      role: 'member',
    } as any);

    // Legacy org: no Members team row exists yet
    vi.mocked(globalDb.team.findFirst).mockResolvedValue(null);
    vi.mocked(globalDb.team.create).mockResolvedValue({ id: 'healed-team', slug: 'members' } as never);

    const response = await POST(
      createRequest({ email: 'test@example.com' })
    );

    expect(response.status).toBe(201);
    expect(globalDb.team.create).toHaveBeenCalledWith({
      data: { name: 'Members', slug: 'members', organizationId: 'org-1' },
    });
    expect(tenantDb.teamMember.create).toHaveBeenCalledWith({
      data: { userId: 'user-1', teamId: 'healed-team', organizationId: 'org-1' },
    });
  });

  it('should create a new user if email does not exist', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      authorized: true,
      session: mockSession,
    } as any);

    vi.mocked(globalDb.organization.findUnique).mockResolvedValue({ id: 'org-1' } as any);
    vi.mocked(globalDb.user.findUnique).mockResolvedValue(null);
    vi.mocked(globalDb.member.findFirst).mockResolvedValue(null);

    // Mock user.create to return a new user
    vi.mocked(globalDb.user.create).mockResolvedValue({ id: 'user-new' } as any);
    vi.mocked(tenantDb.member.create).mockResolvedValue({
      id: 'member-1',
      userId: 'user-new',
      orgId: 'org-1',
      role: 'member',
    } as any);

    const response = await POST(
      createRequest({ email: 'new@example.com' })
    );

    expect(response.status).toBe(201);
    expect(globalDb.user.create).toHaveBeenCalled();
  });

  it('should return 400 when email is missing', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      authorized: true,
      session: mockSession,
    } as any);

    const response = await POST(
      createRequest({ role: 'member' })
    );

    expect(response.status).toBe(400);
  });

  it('should return 409 when user is already a member', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      authorized: true,
      session: mockSession,
    } as any);

    vi.mocked(globalDb.organization.findUnique).mockResolvedValue({ id: 'org-1' } as any);
    vi.mocked(globalDb.user.findUnique).mockResolvedValue({ id: 'user-1' } as any);
    vi.mocked(globalDb.member.findFirst).mockResolvedValue({ id: 'existing-member' } as any);

    const response = await POST(
      createRequest({ email: 'test@example.com' })
    );

    expect(response.status).toBe(409);
  });

  it('should return 403 when not authorized', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      session: null,
      authorized: false,
      error: 'Unauthorized',
      status: 403,
    });

    const response = await POST(
      createRequest({ email: 'test@example.com' })
    );

    expect(response.status).toBe(403);
  });

  it('should return 503 when database is unavailable', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      authorized: true,
      session: mockSession,
    } as any);

    vi.mocked(globalDb.organization.findUnique).mockRejectedValue(
      new Error("Can't reach database server")
    );

    const response = await POST(
      createRequest({ email: 'test@example.com' })
    );

    expect(response.status).toBe(503);
  });

  it('should return 404 when organization not found', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      authorized: true,
      session: mockSession,
    } as any);

    vi.mocked(globalDb.organization.findUnique).mockResolvedValue(null);

    const response = await POST(
      createRequest({ email: 'test@example.com' })
    );

    expect(response.status).toBe(404);
  });

  it('should record audit log on successful member creation', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      authorized: true,
      session: mockSession,
    } as any);

    vi.mocked(globalDb.organization.findUnique).mockResolvedValue({ id: 'org-1' } as any);
    vi.mocked(globalDb.user.findUnique).mockResolvedValue({ id: 'user-1' } as any);
    vi.mocked(globalDb.member.findFirst).mockResolvedValue(null);
    vi.mocked(tenantDb.member.create).mockResolvedValue({
      id: 'member-1',
      userId: 'user-1',
      orgId: 'org-1',
      role: 'member',
    } as any);

    await POST(
      createRequest({ email: 'test@example.com' })
    );

    expect(recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'member.created',
        success: true,
        resourceType: 'Organization.Member',
      })
    );
  });

  it('should handle invalid JSON body gracefully', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      authorized: true,
      session: mockSession,
    } as any);

    const response = await POST(
      { url: 'http://localhost/api/admin/organizations/org-1/members', json: () => Promise.reject(new Error('Invalid JSON')), headers: new Headers() } as unknown as NextRequest
    );

    expect(response.status).toBe(400);
  });
});