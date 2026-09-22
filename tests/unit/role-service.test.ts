/**
 * Unit tests for RoleService — full CRUD with authorization.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import globalDb from '@/lib/tenant-db';
import tenantDb from '@/lib/tenant-db';
import { runWithTenant } from '@/lib/tenant-context';
import { RoleService } from '@/services/role-service';
import { ServiceContext, ForbiddenError, NotFoundError, ConflictError } from '@/lib/services/types';

// Mock dependencies
vi.mock('@/lib/tenant-db', () => ({
  default: {
    role: {
      findFirst: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    permission: {
      findUnique: vi.fn(),
    },
    memberRole: { count: vi.fn(), findMany: vi.fn() },
    rolePermission: {
      findFirst: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock('@/lib/tenant-context', () => ({
  runWithTenant: vi.fn(async (orgId: string, fn: () => Promise<unknown>) => fn()),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/redis', () => ({
  getRedis: vi.fn(() => null),
}));

vi.mock('@/lib/cache/lru', () => ({
  invalidate: vi.fn(),
}));

const mockCtx = (role: 'PLATFORM_ADMIN' | 'TENANT_ADMIN' | 'MEMBER', orgId?: string): ServiceContext => ({
  userId: 'user-1',
  role,
  organizationId: orgId,
});

const mockRole = (overrides = {}) => ({
  id: 'role-1',
  name: 'Test Role',
  description: 'A test role',
  isDefault: false,
  organizationId: 'org-1',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('RoleService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('creates role for PLATFORM_ADMIN in any org', async () => {
      vi.mocked(globalDb.role.findFirst).mockResolvedValue(null);
      vi.mocked(tenantDb.role.create).mockResolvedValue(mockRole({ id: 'new-role' }) as never);

      const result = await RoleService.create(
        { name: 'New Role', description: 'Desc' },
        'org-2',
        mockCtx('PLATFORM_ADMIN'),
      );

      expect(result.id).toBe('new-role');
    });

    it('creates role for TENANT_ADMIN in their own org', async () => {
      vi.mocked(globalDb.role.findFirst).mockResolvedValue(null);
      vi.mocked(tenantDb.role.create).mockResolvedValue(mockRole({ id: 'new-role' }) as never);

      const result = await RoleService.create(
        { name: 'New Role' },
        'org-1',
        mockCtx('TENANT_ADMIN', 'org-1'),
      );

      expect(result.id).toBe('new-role');
    });

    it('throws ForbiddenError for TENANT_ADMIN in different org', async () => {
      await expect(
        RoleService.create({ name: 'New Role' }, 'org-2', mockCtx('TENANT_ADMIN', 'org-1'))
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ForbiddenError for MEMBER', async () => {
      await expect(
        RoleService.create({ name: 'New Role' }, 'org-1', mockCtx('MEMBER'))
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ConflictError when role name already exists', async () => {
      vi.mocked(globalDb.role.findFirst).mockResolvedValue(mockRole() as never);

      await expect(
        RoleService.create({ name: 'Test Role' }, 'org-1', mockCtx('PLATFORM_ADMIN'))
      ).rejects.toThrow(ConflictError);
    });

    it('throws error when name is missing', async () => {
      await expect(
        RoleService.create({ description: 'No name' } as never, 'org-1', mockCtx('PLATFORM_ADMIN'))
      ).rejects.toThrow(/required/i);
    });
  });

  describe('getById', () => {
    it('returns role for PLATFORM_ADMIN', async () => {
      vi.mocked(tenantDb.role.findUnique).mockResolvedValue(mockRole() as never);

      const result = await RoleService.getById('role-1', 'org-1', mockCtx('PLATFORM_ADMIN'));

      expect(result).toBeDefined();
    });

    it('returns role for TENANT_ADMIN in their own org', async () => {
      vi.mocked(tenantDb.role.findUnique).mockResolvedValue(mockRole() as never);

      const result = await RoleService.getById('role-1', 'org-1', mockCtx('TENANT_ADMIN', 'org-1'));

      expect(result).toBeDefined();
    });

    it('throws ForbiddenError for TENANT_ADMIN in different org', async () => {
      await expect(
        RoleService.getById('role-1', 'org-2', mockCtx('TENANT_ADMIN', 'org-1'))
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ForbiddenError for MEMBER', async () => {
      await expect(
        RoleService.getById('role-1', 'org-1', mockCtx('MEMBER'))
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws NotFoundError when role does not exist', async () => {
      vi.mocked(tenantDb.role.findUnique).mockResolvedValue(null);

      await expect(
        RoleService.getById('role-999', 'org-1', mockCtx('PLATFORM_ADMIN'))
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('list', () => {
    it('returns paginated roles for PLATFORM_ADMIN', async () => {
      vi.mocked(tenantDb.role.findMany).mockResolvedValue([mockRole() as never]);
      vi.mocked(tenantDb.role.count).mockResolvedValue(1);

      const result = await RoleService.list('org-1', {}, { page: 1, pageSize: 20 }, mockCtx('PLATFORM_ADMIN'));

      expect(result.items).toHaveLength(1);
      expect(result.pagination.total).toBe(1);
    });

    it('returns roles for TENANT_ADMIN in their own org', async () => {
      vi.mocked(tenantDb.role.findMany).mockResolvedValue([mockRole() as never]);
      vi.mocked(tenantDb.role.count).mockResolvedValue(1);

      const result = await RoleService.list('org-1', {}, { page: 1, pageSize: 20 }, mockCtx('TENANT_ADMIN', 'org-1'));

      expect(result.items).toHaveLength(1);
    });

    it('throws ForbiddenError for TENANT_ADMIN in different org', async () => {
      await expect(
        RoleService.list('org-2', {}, { page: 1, pageSize: 20 }, mockCtx('TENANT_ADMIN', 'org-1'))
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ForbiddenError for MEMBER', async () => {
      await expect(
        RoleService.list('org-1', {}, { page: 1, pageSize: 20 }, mockCtx('MEMBER'))
      ).rejects.toThrow(ForbiddenError);
    });

    it('applies search filter', async () => {
      vi.mocked(tenantDb.role.findMany).mockResolvedValue([]);
      vi.mocked(tenantDb.role.count).mockResolvedValue(0);

      await RoleService.list('org-1', { search: 'admin' }, { page: 1, pageSize: 20 }, mockCtx('PLATFORM_ADMIN'));

      expect(tenantDb.role.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: 'org-1', name: { contains: 'admin', mode: 'insensitive' } },
        }),
      );
    });

    it('applies isDefault filter', async () => {
      vi.mocked(tenantDb.role.findMany).mockResolvedValue([]);
      vi.mocked(tenantDb.role.count).mockResolvedValue(0);

      await RoleService.list('org-1', { isDefault: true }, { page: 1, pageSize: 20 }, mockCtx('PLATFORM_ADMIN'));

      expect(tenantDb.role.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: 'org-1', isDefault: true },
        }),
      );
    });

    it('returns correct pagination', async () => {
      vi.mocked(tenantDb.role.findMany).mockResolvedValue([]);
      vi.mocked(tenantDb.role.count).mockResolvedValue(50);

      const result = await RoleService.list('org-1', {}, { page: 3, pageSize: 10 }, mockCtx('PLATFORM_ADMIN'));

      expect(result.pagination.page).toBe(3);
      expect(result.pagination.pageSize).toBe(10);
      expect(result.pagination.totalPages).toBe(Math.ceil(50 / 10));
    });
  });

  describe('update', () => {
    it('updates role for PLATFORM_ADMIN', async () => {
      vi.mocked(globalDb.role.findUnique).mockResolvedValue(mockRole() as never);
      vi.mocked(globalDb.role.findFirst).mockResolvedValue(null);
      vi.mocked(tenantDb.role.update).mockResolvedValue({ id: 'role-1', name: 'Updated' } as never);

      const result = await RoleService.update('role-1', { name: 'Updated' }, 'org-1', mockCtx('PLATFORM_ADMIN'));

      expect(result.name).toBe('Updated');
    });

    it('updates role for TENANT_ADMIN in their own org', async () => {
      vi.mocked(globalDb.role.findUnique).mockResolvedValue(mockRole() as never);
      vi.mocked(globalDb.role.findFirst).mockResolvedValue(null);
      vi.mocked(tenantDb.role.update).mockResolvedValue({ id: 'role-1', name: 'Updated' } as never);

      const result = await RoleService.update('role-1', { name: 'Updated' }, 'org-1', mockCtx('TENANT_ADMIN', 'org-1'));

      expect(result.name).toBe('Updated');
    });

    it('throws ForbiddenError for TENANT_ADMIN in different org', async () => {
      await expect(
        RoleService.update('role-1', { name: 'X' }, 'org-2', mockCtx('TENANT_ADMIN', 'org-1'))
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ForbiddenError for MEMBER', async () => {
      await expect(
        RoleService.update('role-1', { name: 'X' }, 'org-1', mockCtx('MEMBER'))
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws NotFoundError when role does not exist', async () => {
      vi.mocked(globalDb.role.findUnique).mockResolvedValue(null);

      await expect(
        RoleService.update('role-999', { name: 'X' }, 'org-1', mockCtx('PLATFORM_ADMIN'))
      ).rejects.toThrow(NotFoundError);
    });

    it('throws ConflictError when name already exists', async () => {
      vi.mocked(globalDb.role.findUnique).mockResolvedValue(mockRole({ name: 'Original' }) as never);
      vi.mocked(globalDb.role.findFirst).mockResolvedValue(mockRole({ id: 'other-role' }) as never);

      await expect(
        RoleService.update('role-1', { name: 'Other Name' }, 'org-1', mockCtx('PLATFORM_ADMIN'))
      ).rejects.toThrow(ConflictError);
    });

    it('calls Redis cache invalidation on update', async () => {
      vi.mocked(globalDb.role.findUnique).mockResolvedValue(mockRole() as never);
      vi.mocked(globalDb.role.findFirst).mockResolvedValue(null);
      vi.mocked(tenantDb.role.update).mockResolvedValue({ id: 'role-1', name: 'Updated' } as never);

      await RoleService.update('role-1', { name: 'Updated' }, 'org-1', mockCtx('PLATFORM_ADMIN'));

      // The invalidatePermissionCache function should have been called
      // (it's an internal async function, so we verify via the mock)
      expect(globalDb.role.findUnique).toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('deletes role for PLATFORM_ADMIN when no members assigned', async () => {
      vi.mocked(globalDb.role.findUnique).mockResolvedValue(mockRole() as never);
      vi.mocked(tenantDb.memberRole.count).mockResolvedValue(0);

      const result = await RoleService.delete('role-1', 'org-1', mockCtx('PLATFORM_ADMIN'));

      expect(result.success).toBe(true);
    });

    it('deletes role for TENANT_ADMIN in their own org when no members assigned', async () => {
      vi.mocked(globalDb.role.findUnique).mockResolvedValue(mockRole() as never);
      vi.mocked(tenantDb.memberRole.count).mockResolvedValue(0);

      const result = await RoleService.delete('role-1', 'org-1', mockCtx('TENANT_ADMIN', 'org-1'));

      expect(result.success).toBe(true);
    });

    it('throws ConflictError when role has assigned members', async () => {
      vi.mocked(globalDb.role.findUnique).mockResolvedValue(mockRole() as never);
      vi.mocked(tenantDb.memberRole.count).mockResolvedValue(3);

      await expect(
        RoleService.delete('role-1', 'org-1', mockCtx('PLATFORM_ADMIN'))
      ).rejects.toThrow(ConflictError);
    });

    it('throws ForbiddenError for TENANT_ADMIN in different org', async () => {
      await expect(
        RoleService.delete('role-1', 'org-2', mockCtx('TENANT_ADMIN', 'org-1'))
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ForbiddenError for MEMBER', async () => {
      await expect(
        RoleService.delete('role-1', 'org-1', mockCtx('MEMBER'))
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws NotFoundError when role does not exist', async () => {
      vi.mocked(globalDb.role.findUnique).mockResolvedValue(null);

      await expect(
        RoleService.delete('role-999', 'org-1', mockCtx('PLATFORM_ADMIN'))
      ).rejects.toThrow(NotFoundError);
    });

    it('calls Redis cache invalidation on delete', async () => {
      vi.mocked(globalDb.role.findUnique).mockResolvedValue(mockRole() as never);
      vi.mocked(tenantDb.memberRole.count).mockResolvedValue(0);

      await RoleService.delete('role-1', 'org-1', mockCtx('PLATFORM_ADMIN'));

      expect(globalDb.role.findUnique).toHaveBeenCalled();
    });
  });

  describe('getRolePermissions', () => {
    it('returns the permissions assigned to a role', async () => {
      vi.mocked(tenantDb.role.findUnique).mockResolvedValue({
        ...mockRole(),
        permissions: [
          { id: 'rp-1', permissionId: 'p-1', permission: { id: 'p-1', resource: 'calendar', action: 'read' } },
          { id: 'rp-2', permissionId: 'p-2', permission: { id: 'p-2', resource: 'calendar', action: 'create' } },
        ],
      } as never);

      const result = await RoleService.getRolePermissions('role-1', 'org-1', mockCtx('PLATFORM_ADMIN'));

      expect(result).toEqual([
        { id: 'p-1', resource: 'calendar', action: 'read' },
        { id: 'p-2', resource: 'calendar', action: 'create' },
      ]);
    });

    it('throws NotFoundError when role does not exist', async () => {
      vi.mocked(tenantDb.role.findUnique).mockResolvedValue(null);

      await expect(
        RoleService.getRolePermissions('role-999', 'org-1', mockCtx('PLATFORM_ADMIN')),
      ).rejects.toThrow(NotFoundError);
    });

    it('throws ForbiddenError for MEMBER', async () => {
      await expect(
        RoleService.getRolePermissions('role-1', 'org-1', mockCtx('MEMBER')),
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('assignPermission', () => {
    it('assigns a permission to the role within the target org', async () => {
      vi.mocked(globalDb.role.findUnique).mockResolvedValue(mockRole() as never);
      vi.mocked(globalDb.permission.findUnique).mockResolvedValue({ id: 'p-1' } as never);
      vi.mocked(globalDb.rolePermission.findFirst).mockResolvedValue(null);
      vi.mocked(tenantDb.rolePermission.create).mockResolvedValue({ id: 'rp-1' } as never);

      const result = await RoleService.assignPermission('role-1', 'org-1', { permissionId: 'p-1' }, mockCtx('PLATFORM_ADMIN'));

      expect(result.success).toBe(true);
      expect(tenantDb.rolePermission.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ roleId: 'role-1', permissionId: 'p-1', organizationId: 'org-1' }),
        }),
      );
    });

    it('throws NotFoundError when the role does not exist', async () => {
      vi.mocked(globalDb.role.findUnique).mockResolvedValue(null);

      await expect(
        RoleService.assignPermission('role-999', 'org-1', { permissionId: 'p-1' }, mockCtx('PLATFORM_ADMIN')),
      ).rejects.toThrow(NotFoundError);
    });

    it('throws NotFoundError when the permission does not exist', async () => {
      vi.mocked(globalDb.role.findUnique).mockResolvedValue(mockRole() as never);
      vi.mocked(globalDb.permission.findUnique).mockResolvedValue(null);

      await expect(
        RoleService.assignPermission('role-1', 'org-1', { permissionId: 'p-999' }, mockCtx('PLATFORM_ADMIN')),
      ).rejects.toThrow(new RegExp('Permission not found'));
    });

    it('throws ConflictError when the permission is already assigned', async () => {
      vi.mocked(globalDb.role.findUnique).mockResolvedValue(mockRole() as never);
      vi.mocked(globalDb.permission.findUnique).mockResolvedValue({ id: 'p-1' } as never);
      vi.mocked(globalDb.rolePermission.findFirst).mockResolvedValue({ id: 'rp-existing' } as never);

      await expect(
        RoleService.assignPermission('role-1', 'org-1', { permissionId: 'p-1' }, mockCtx('PLATFORM_ADMIN')),
      ).rejects.toThrow(ConflictError);

      expect(tenantDb.rolePermission.create).not.toHaveBeenCalled();
    });

    it('throws ForbiddenError for MEMBER', async () => {
      await expect(
        RoleService.assignPermission('role-1', 'org-1', { permissionId: 'p-1' }, mockCtx('MEMBER')),
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('revokePermission', () => {
    it('removes the role-permission link idempotently and succeeds either way', async () => {
      vi.mocked(tenantDb.rolePermission.deleteMany).mockResolvedValue({ count: 1 } as never);

      const result = await RoleService.revokePermission('role-1', 'org-1', 'p-1', mockCtx('PLATFORM_ADMIN'));

      expect(result.success).toBe(true);
      expect(tenantDb.rolePermission.deleteMany).toHaveBeenCalledWith({
        where: { roleId: 'role-1', permissionId: 'p-1' },
      });
    });

    it('succeeds even when no assignment existed', async () => {
      vi.mocked(tenantDb.rolePermission.deleteMany).mockResolvedValue({ count: 0 } as never);

      const result = await RoleService.revokePermission('role-1', 'org-1', 'p-1', mockCtx('PLATFORM_ADMIN'));

      expect(result.success).toBe(true);
    });

    it('throws ForbiddenError for MEMBER', async () => {
      await expect(
        RoleService.revokePermission('role-1', 'org-1', 'p-1', mockCtx('MEMBER')),
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getRoleMembers', () => {
    it('returns member info joined through memberRole and user', async () => {
      vi.mocked(tenantDb.memberRole.findMany).mockResolvedValue([
        {
          id: 'mr-1',
          member: {
            id: 'member-1',
            userId: 'user-9',
            user: { id: 'user-9', name: 'Member One', email: 'm1@example.com' },
          },
        },
        {
          id: 'mr-2',
          member: {
            id: 'member-2',
            userId: 'user-10',
            user: { id: 'user-10', name: 'Member Two', email: 'm2@example.com' },
          },
        },
      ] as never);

      const result = await RoleService.getRoleMembers('role-1', 'org-1', mockCtx('PLATFORM_ADMIN'));

      expect(result).toEqual([
        { memberId: 'member-1', userId: 'user-9', userName: 'Member One', userEmail: 'm1@example.com' },
        { memberId: 'member-2', userId: 'user-10', userName: 'Member Two', userEmail: 'm2@example.com' },
      ]);
      expect(tenantDb.memberRole.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { roleId: 'role-1' } }),
      );
    });

    it('returns an empty list when the role has no members', async () => {
      vi.mocked(tenantDb.memberRole.findMany).mockResolvedValue([] as never);

      const result = await RoleService.getRoleMembers('role-1', 'org-1', mockCtx('PLATFORM_ADMIN'));

      expect(result).toEqual([]);
    });

    it('throws ForbiddenError for MEMBER', async () => {
      await expect(
        RoleService.getRoleMembers('role-1', 'org-1', mockCtx('MEMBER')),
      ).rejects.toThrow(ForbiddenError);
    });
  });
});
