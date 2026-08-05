/**
 * Mocked handler tests for roles API routes.
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
    role: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    memberRole: { count: vi.fn() },
  },
}));

vi.mock('@/lib/tenant-db', () => ({
  default: {
    role: { findMany: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
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

// Import list route
const { GET: getRoles, POST: postRole } = await import(
  '@/app/api/admin/organizations/[orgId]/roles/route'
);

// Import detail route
const { PATCH: patchRole, DELETE: deleteRole } = await import(
  '@/app/api/admin/organizations/[orgId]/roles/[roleId]/route'
);

// Shared mock session with proper structure matching auth.api.getSession() return type
const mockSession = {
  session: { id: 'session-1', userId: 'admin-1' },
  user: { id: 'admin-1', name: 'Admin User' },
};

describe('GET /api/admin/organizations/[orgId]/roles', () => {
  beforeEach(() => vi.clearAllMocks());

  function createParams(orgId: string) {
    return Promise.resolve({ orgId });
  }

  it('should return roles when authorized', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      authorized: true,
      session: mockSession,
    } as any);

    vi.mocked(globalDb.organization.findUnique).mockResolvedValue({ id: 'org-1' } as any);
    vi.mocked(tenantDb.role.findMany).mockResolvedValue([
      {
        id: 'role-1',
        name: 'Custom Role',
        isDefault: false,
      } as any,
    ]);
    vi.mocked(tenantDb.role.count).mockResolvedValue(1);

    const response = await getRoles({} as NextRequest, { params: createParams('org-1') });

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.roles).toHaveLength(1);
    expect(json.roles[0].name).toBe('Custom Role');
  });

  it('should return empty array when org has no roles', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      authorized: true,
      session: mockSession,
    } as any);

    vi.mocked(globalDb.organization.findUnique).mockResolvedValue({ id: 'org-1' } as any);
    vi.mocked(tenantDb.role.findMany).mockResolvedValue([]);
    vi.mocked(tenantDb.role.count).mockResolvedValue(0);

    const response = await getRoles({} as NextRequest, { params: createParams('org-1') });

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

    const response = await getRoles({} as NextRequest, { params: createParams('org-1') });

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

    const response = await getRoles({} as NextRequest, { params: createParams('org-1') });

    expect(response.status).toBe(503);
  });

  it('should return 404 when organization not found', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      authorized: true,
      session: mockSession,
    } as any);

    vi.mocked(globalDb.organization.findUnique).mockResolvedValue(null);

    const response = await getRoles({} as NextRequest, { params: createParams('org-1') });

    expect(response.status).toBe(404);
  });
});

describe('POST /api/admin/organizations/[orgId]/roles', () => {
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

  it('should create a role when authorized with valid name', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      authorized: true,
      session: mockSession,
    } as any);

    vi.mocked(globalDb.organization.findUnique).mockResolvedValue({ id: 'org-1' } as any);
    vi.mocked(globalDb.role.findFirst).mockResolvedValue(null);
    vi.mocked(tenantDb.role.create).mockResolvedValue({ id: 'role-1', name: 'New Role' } as any);

    const response = await postRole(
      createRequest({ name: 'New Role', description: 'A new role' }),
      { params: createParams('org-1') }
    );

    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json.message).toBe('Role created successfully');
  });

  it('should return 400 when name is missing', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      authorized: true,
      session: mockSession,
    } as any);

    const response = await postRole(
      createRequest({ description: 'No name' }),
      { params: createParams('org-1') }
    );

    expect(response.status).toBe(400);
  });

  it('should return 409 when role name already exists', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      authorized: true,
      session: mockSession,
    } as any);

    vi.mocked(globalDb.organization.findUnique).mockResolvedValue({ id: 'org-1' } as any);
    vi.mocked(globalDb.role.findFirst).mockResolvedValue({ id: 'existing-role' } as any);

    const response = await postRole(
      createRequest({ name: 'Existing Role' }),
      { params: createParams('org-1') }
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

    const response = await postRole(
      createRequest({ name: 'New Role' }),
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

    const response = await postRole(
      createRequest({ name: 'New Role' }),
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

    const response = await postRole(
      createRequest({ name: 'New Role' }),
      { params: createParams('org-1') }
    );

    expect(response.status).toBe(404);
  });

  it('should record audit log on successful role creation', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      authorized: true,
      session: mockSession,
    } as any);

    vi.mocked(globalDb.organization.findUnique).mockResolvedValue({ id: 'org-1' } as any);
    vi.mocked(globalDb.role.findFirst).mockResolvedValue(null);
    vi.mocked(tenantDb.role.create).mockResolvedValue({ id: 'role-1', name: 'New Role' } as any);

    await postRole(
      createRequest({ name: 'New Role' }),
      { params: createParams('org-1') }
    );

    expect(recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'role.created',
        success: true,
        resourceType: 'Organization.Role',
      })
    );
  });

  it('should handle invalid JSON body gracefully', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      authorized: true,
      session: mockSession,
    } as any);

    const response = await postRole(
      { json: () => Promise.reject(new Error('Invalid JSON')), headers: new Headers() } as unknown as NextRequest,
      { params: createParams('org-1') }
    );

    expect(response.status).toBe(400);
  });
});

describe('PATCH /api/admin/organizations/[orgId]/roles/:roleId', () => {
  beforeEach(() => vi.clearAllMocks());

  function createParams(orgId: string, roleId: string) {
    return Promise.resolve({ orgId, roleId });
  }

  function createRequest(body: Record<string, unknown>) {
    return {
      json: () => Promise.resolve(body),
      headers: new Headers(),
    } as unknown as NextRequest;
  }

  it('should update a role when authorized', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      authorized: true,
      session: mockSession,
    } as any);

    vi.mocked(globalDb.organization.findUnique).mockResolvedValue({ id: 'org-1' } as any);
    vi.mocked(globalDb.role.findFirst).mockResolvedValue({ id: 'role-1' } as any);
    vi.mocked(tenantDb.role.update).mockResolvedValue({ id: 'role-1', name: 'Updated Role' } as any);

    const response = await patchRole(
      createRequest({ name: 'Updated Role' }),
      { params: createParams('org-1', 'role-1') }
    );

    expect(response.status).toBe(200);
  });

  it('should return 400 when name and description are missing', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      authorized: true,
      session: mockSession,
    } as any);

    const response = await patchRole(
      createRequest({}),
      { params: createParams('org-1', 'role-1') }
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

    const response = await patchRole(
      createRequest({ name: 'Updated' }),
      { params: createParams('org-1', 'role-1') }
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

    const response = await patchRole(
      createRequest({ name: 'Updated' }),
      { params: createParams('org-1', 'role-1') }
    );

    expect(response.status).toBe(503);
  });

  it('should return 404 when organization not found', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      authorized: true,
      session: mockSession,
    } as any);

    vi.mocked(globalDb.organization.findUnique).mockResolvedValue(null);

    const response = await patchRole(
      createRequest({ name: 'Updated' }),
      { params: createParams('org-1', 'role-1') }
    );

    expect(response.status).toBe(404);
  });

  it('should return 404 when role not found in org', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      authorized: true,
      session: mockSession,
    } as any);

    vi.mocked(globalDb.organization.findUnique).mockResolvedValue({ id: 'org-1' } as any);
    vi.mocked(globalDb.role.findFirst).mockResolvedValue(null);

    const response = await patchRole(
      createRequest({ name: 'Updated' }),
      { params: createParams('org-1', 'role-1') }
    );

    expect(response.status).toBe(404);
  });

  it('should record audit log on successful role update', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      authorized: true,
      session: mockSession,
    } as any);

    vi.mocked(globalDb.organization.findUnique).mockResolvedValue({ id: 'org-1' } as any);
    vi.mocked(globalDb.role.findFirst).mockResolvedValue({ id: 'role-1' } as any);
    vi.mocked(tenantDb.role.update).mockResolvedValue({ id: 'role-1', name: 'Updated Role' } as any);

    await patchRole(
      createRequest({ name: 'Updated Role' }),
      { params: createParams('org-1', 'role-1') }
    );

    expect(recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'role.updated',
        success: true,
        resourceType: 'Organization.Role',
      })
    );
  });

  it('should handle invalid JSON body gracefully', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      authorized: true,
      session: mockSession,
    } as any);

    const response = await patchRole(
      { json: () => Promise.reject(new Error('Invalid JSON')), headers: new Headers() } as unknown as NextRequest,
      { params: createParams('org-1', 'role-1') }
    );

    expect(response.status).toBe(400);
  });
});

describe('DELETE /api/admin/organizations/[orgId]/roles/:roleId', () => {
  beforeEach(() => vi.clearAllMocks());

  function createParams(orgId: string, roleId: string) {
    return Promise.resolve({ orgId, roleId });
  }

  it('should delete a role when authorized and no members assigned', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      authorized: true,
      session: mockSession,
    } as any);

    vi.mocked(globalDb.organization.findUnique).mockResolvedValue({ id: 'org-1' } as any);
    vi.mocked(globalDb.role.findFirst).mockResolvedValue({ id: 'role-1' } as any);
    vi.mocked(globalDb.memberRole.count).mockResolvedValue(0);

    const response = await deleteRole({} as NextRequest, { params: createParams('org-1', 'role-1') });

    expect(response.status).toBe(200);
  });

  it('should return 400 when role has assigned members', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      authorized: true,
      session: mockSession,
    } as any);

    vi.mocked(globalDb.organization.findUnique).mockResolvedValue({ id: 'org-1' } as any);
    vi.mocked(globalDb.role.findFirst).mockResolvedValue({ id: 'role-1' } as any);
    vi.mocked(globalDb.memberRole.count).mockResolvedValue(3);

    const response = await deleteRole({} as NextRequest, { params: createParams('org-1', 'role-1') });

    expect(response.status).toBe(400);
  });

  it('should return 403 when not authorized', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      session: null,
      authorized: false,
      error: 'Unauthorized',
      status: 403,
    });

    const response = await deleteRole({} as NextRequest, { params: createParams('org-1', 'role-1') });

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

    const response = await deleteRole({} as NextRequest, { params: createParams('org-1', 'role-1') });

    expect(response.status).toBe(503);
  });

  it('should return 404 when organization not found', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      authorized: true,
      session: mockSession,
    } as any);

    vi.mocked(globalDb.organization.findUnique).mockResolvedValue(null);

    const response = await deleteRole({} as NextRequest, { params: createParams('org-1', 'role-1') });

    expect(response.status).toBe(404);
  });

  it('should return 404 when role not found in org', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      authorized: true,
      session: mockSession,
    } as any);

    vi.mocked(globalDb.organization.findUnique).mockResolvedValue({ id: 'org-1' } as any);
    vi.mocked(globalDb.role.findFirst).mockResolvedValue(null);

    const response = await deleteRole({} as NextRequest, { params: createParams('org-1', 'role-1') });

    expect(response.status).toBe(404);
  });

  it('should record audit log on successful role deletion', async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue({
      authorized: true,
      session: mockSession,
    } as any);

    vi.mocked(globalDb.organization.findUnique).mockResolvedValue({ id: 'org-1' } as any);
    vi.mocked(globalDb.role.findFirst).mockResolvedValue({ id: 'role-1' } as any);
    vi.mocked(globalDb.memberRole.count).mockResolvedValue(0);

    await deleteRole({} as NextRequest, { params: createParams('org-1', 'role-1') });

    expect(recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'role.deleted',
        success: true,
        resourceType: 'Organization.Role',
      })
    );
  });
});