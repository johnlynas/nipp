/**
 * Mocked handler tests for permissions API routes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// Mock all dependencies before importing the route
vi.mock('@/lib/require-super-admin', () => ({
  requireSuperAdmin: vi.fn(),
}));

vi.mock('@/lib/global-db', () => ({
  default: {
    organization: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    permission: { findUnique: vi.fn(), findMany: vi.fn() },
    role: { findFirst: vi.fn(), findMany: vi.fn() },
    rolePermission: { findFirst: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
  },
}));

vi.mock('@/lib/tenant-db', () => ({
  default: {
    rolePermission: { findMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
  },
}));

vi.mock('@/lib/tenant-context', () => ({
  runWithTenant: vi.fn(async (_orgId: string, fn: () => Promise<unknown>) => fn()),
}));

vi.mock('@/lib/audit-log', () => ({
  recordAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
}));

const { requireSuperAdmin } = await import('@/lib/require-super-admin');
const globalDb = (await import('@/lib/global-db')).default;
const tenantDb = (await import('@/lib/tenant-db')).default;
const { runWithTenant } = await import('@/lib/tenant-context');
const { recordAuditLog } = await import('@/lib/audit-log');

const { GET, PATCH } = await import(
  '@/app/api/admin/organizations/[orgId]/permissions/route'
);

// Shared mock session with proper structure matching auth.api.getSession() return type
const mockSession = {
  session: { id: 'session-1', userId: 'admin-1' },
  user: { id: 'admin-1', name: 'Admin User' },
};

describe('GET /api/admin/organizations/[orgId]/permissions', () => {
  beforeEach(() => vi.clearAllMocks());

  function createParams(orgId: string) {
    return Promise.resolve({ orgId });
  }

  it('should return permissions grid when authorized', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      authorized: true,
      session: mockSession,
    } as any);

    vi.mocked(globalDb.organization.findUnique).mockResolvedValue({ id: 'org-1' } as any);
    vi.mocked(globalDb.permission.findMany).mockResolvedValue([
      { key: 'properties:read', resource: 'properties', action: 'read' } as any,
      { key: 'properties:create', resource: 'properties', action: 'create' } as any,
    ]);
    vi.mocked(tenantDb.rolePermission.findMany).mockResolvedValue([
      { roleId: 'role-1', permission: { key: 'properties:read' } },
    ] as any);
    vi.mocked(globalDb.role.findMany).mockResolvedValue([
      { id: 'role-1', name: 'Custom Role', isDefault: false },
    ] as any);

    const response = await GET({} as NextRequest, { params: createParams('org-1') });

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.roles).toHaveLength(1);
    expect(json.allPermissions).toHaveLength(2);
  });

  it('should return empty grid when org has no roles', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      authorized: true,
      session: mockSession,
    } as any);

    vi.mocked(globalDb.organization.findUnique).mockResolvedValue({ id: 'org-1' } as any);
    vi.mocked(globalDb.permission.findMany).mockResolvedValue([]);
    vi.mocked(tenantDb.rolePermission.findMany).mockResolvedValue([]);
    vi.mocked(globalDb.role.findMany).mockResolvedValue([]);

    const response = await GET({} as NextRequest, { params: createParams('org-1') });

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.roles).toEqual([]);
  });

  it('should return 403 when not authorized', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      session: null,
      authorized: false,
      error: 'Unauthorized',
      status: 403,
    });

    const response = await GET({} as NextRequest, { params: createParams('org-1') });

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

    const response = await GET({} as NextRequest, { params: createParams('org-1') });

    expect(response.status).toBe(503);
  });

  it('should return 404 when organization not found', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      authorized: true,
      session: mockSession,
    } as any);

    vi.mocked(globalDb.organization.findUnique).mockResolvedValue(null);

    const response = await GET({} as NextRequest, { params: createParams('org-1') });

    expect(response.status).toBe(404);
  });

  it('should build correct permission assignment map', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      authorized: true,
      session: mockSession,
    } as any);

    vi.mocked(globalDb.organization.findUnique).mockResolvedValue({ id: 'org-1' } as any);
    vi.mocked(globalDb.permission.findMany).mockResolvedValue([
      { key: 'properties:read', resource: 'properties', action: 'read' } as any,
    ]);
    vi.mocked(tenantDb.rolePermission.findMany).mockResolvedValue([
      { roleId: 'role-1', permission: { key: 'properties:read' } },
    ] as any);
    vi.mocked(globalDb.role.findMany).mockResolvedValue([
      { id: 'role-1', name: 'Custom Role', isDefault: false },
    ] as any);

    const response = await GET({} as NextRequest, { params: createParams('org-1') });
    const json = await response.json();

    expect(json.roles[0].permissions[0].assigned).toBe(true);
  });
});

describe('PATCH /api/admin/organizations/[orgId]/permissions', () => {
  beforeEach(() => vi.clearAllMocks());

  function createParams(orgId: string) {
    return Promise.resolve({ orgId });
  }

  function createRequest(body: Record<string, unknown>) {
    return {
      json: () => Promise.resolve(body),
      headers: new Headers(),
    } as unknown as NextRequest;
  }

  it('should assign permissions when authorized', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      authorized: true,
      session: mockSession,
    } as any);

    vi.mocked(globalDb.organization.findUnique).mockResolvedValue({ id: 'org-1' } as any);
    vi.mocked(globalDb.role.findFirst).mockResolvedValue({ id: 'role-1' } as any);
    vi.mocked(globalDb.permission.findUnique).mockResolvedValue({ id: 'perm-1', key: 'properties:read' } as any);
    vi.mocked(globalDb.rolePermission.findFirst).mockResolvedValue(null);

    const response = await PATCH(
      createRequest({
        assignments: [{ roleId: 'role-1', permissionKey: 'properties:read', assign: true }],
      }),
      { params: createParams('org-1') }
    );

    expect(response.status).toBe(200);
  });

  it('should revoke permissions when authorized', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      authorized: true,
      session: mockSession,
    } as any);

    vi.mocked(globalDb.organization.findUnique).mockResolvedValue({ id: 'org-1' } as any);
    vi.mocked(globalDb.role.findFirst).mockResolvedValue({ id: 'role-1' } as any);
    vi.mocked(globalDb.permission.findUnique).mockResolvedValue({ id: 'perm-1', key: 'properties:read' } as any);

    const response = await PATCH(
      createRequest({
        assignments: [{ roleId: 'role-1', permissionKey: 'properties:read', assign: false }],
      }),
      { params: createParams('org-1') }
    );

    expect(response.status).toBe(200);
  });

  it('should return 400 when assignments array is missing', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      authorized: true,
      session: mockSession,
    } as any);

    const response = await PATCH(
      createRequest({}),
      { params: createParams('org-1') }
    );

    expect(response.status).toBe(400);
  });

  it('should return 403 when not authorized', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      session: null,
      authorized: false,
      error: 'Unauthorized',
      status: 403,
    });

    const response = await PATCH(
      createRequest({ assignments: [] }),
      { params: createParams('org-1') }
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

    const response = await PATCH(
      createRequest({ assignments: [] }),
      { params: createParams('org-1') }
    );

    expect(response.status).toBe(503);
  });

  it('should return 404 when organization not found', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      authorized: true,
      session: mockSession,
    } as any);

    vi.mocked(globalDb.organization.findUnique).mockResolvedValue(null);

    const response = await PATCH(
      createRequest({ assignments: [] }),
      { params: createParams('org-1') }
    );

    expect(response.status).toBe(404);
  });

  it('should mark result as failed when role not found', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      authorized: true,
      session: mockSession,
    } as any);

    vi.mocked(globalDb.organization.findUnique).mockResolvedValue({ id: 'org-1' } as any);
    vi.mocked(globalDb.role.findFirst).mockResolvedValue(null);

    const response = await PATCH(
      createRequest({
        assignments: [{ roleId: 'invalid-role', permissionKey: 'properties:read', assign: true }],
      }),
      { params: createParams('org-1') }
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.results[0].success).toBe(false);
  });

  it('should mark result as failed when permission not found', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      authorized: true,
      session: mockSession,
    } as any);

    vi.mocked(globalDb.organization.findUnique).mockResolvedValue({ id: 'org-1' } as any);
    vi.mocked(globalDb.role.findFirst).mockResolvedValue({ id: 'role-1' } as any);
    vi.mocked(globalDb.permission.findUnique).mockResolvedValue(null);

    const response = await PATCH(
      createRequest({
        assignments: [{ roleId: 'role-1', permissionKey: 'invalid:key', assign: true }],
      }),
      { params: createParams('org-1') }
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.results[0].success).toBe(false);
  });

  it('should continue processing other assignments after a failure', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      authorized: true,
      session: mockSession,
    } as any);

    vi.mocked(globalDb.organization.findUnique).mockResolvedValue({ id: 'org-1' } as any);
    (vi.mocked(globalDb.role.findFirst) as any).mockImplementation(async (_where: { id: string }) => {
      if (_where.id === 'role-1') return { id: 'role-1' } as any;
      if (_where.id === 'invalid-role') return null;
      return null;
    });
    vi.mocked(globalDb.permission.findUnique).mockResolvedValue({ id: 'perm-1', key: 'properties:read' } as any);
    vi.mocked(globalDb.rolePermission.findFirst).mockResolvedValue(null);

    const response = await PATCH(
      createRequest({
        assignments: [
          { roleId: 'invalid-role', permissionKey: 'properties:read', assign: true },
          { roleId: 'role-1', permissionKey: 'properties:read', assign: true },
        ],
      }),
      { params: createParams('org-1') }
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.results).toHaveLength(2);
    // First assignment fails because role doesn't exist
    expect(json.results[0].success).toBe(false);
  });

  it('should record audit log when changes are made', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      authorized: true,
      session: mockSession,
    } as any);

    vi.mocked(globalDb.organization.findUnique).mockResolvedValue({ id: 'org-1' } as any);
    vi.mocked(globalDb.role.findFirst).mockResolvedValue({ id: 'role-1' } as any);
    vi.mocked(globalDb.permission.findUnique).mockResolvedValue({ id: 'perm-1', key: 'properties:read' } as any);
    vi.mocked(globalDb.rolePermission.findFirst).mockResolvedValue(null);

    await PATCH(
      createRequest({
        assignments: [{ roleId: 'role-1', permissionKey: 'properties:read', assign: true }],
      }),
      { params: createParams('org-1') }
    );

    expect(recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'permissions.updated',
        success: true,
        resourceType: 'Organization.Permissions',
      })
    );
  });

  it('should handle invalid JSON body gracefully', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      authorized: true,
      session: mockSession,
    } as any);

    const response = await PATCH(
      { json: () => Promise.reject(new Error('Invalid JSON')), headers: new Headers() } as unknown as NextRequest,
      { params: createParams('org-1') }
    );

    expect(response.status).toBe(400);
  });
});