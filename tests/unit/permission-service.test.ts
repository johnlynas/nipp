/**
 * Unit tests for PermissionService — full CRUD with authorization.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import globalDb from '@/lib/global-db';
import { PermissionService } from '@/services/permission-service';
import { ServiceContext, ForbiddenError, NotFoundError, ConflictError } from '@/lib/services/types';

// Mock dependencies
vi.mock('@/lib/global-db', () => ({
  default: {
    permission: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    rolePermission: { count: vi.fn() },
  },
}));

vi.mock('@/lib/role-service', () => ({}));

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

const mockPermission = (overrides = {}) => ({
  id: 'perm-1',
  key: 'properties:view',
  resource: 'properties',
  action: 'view',
  description: 'View properties',
  isDefault: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('PermissionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('creates permission for PLATFORM_ADMIN', async () => {
      vi.mocked(globalDb.permission.findUnique).mockResolvedValue(null);
      vi.mocked(globalDb.permission.create).mockResolvedValue(mockPermission({ id: 'new-perm' }) as never);

      const result = await PermissionService.create(
        { key: 'new:action', resource: 'new', action: 'do' },
        mockCtx('PLATFORM_ADMIN'),
      );

      expect(result.id).toBe('new-perm');
    });

    it('creates permission with isDefault=true', async () => {
      vi.mocked(globalDb.permission.findUnique).mockResolvedValue(null);
      vi.mocked(globalDb.permission.create).mockResolvedValue(mockPermission({ id: 'new-perm', isDefault: true }) as never);

      const result = await PermissionService.create(
        { key: 'new:action', resource: 'new', action: 'do', isDefault: true },
        mockCtx('PLATFORM_ADMIN'),
      );

      expect(result.isDefault).toBe(true);
    });

    it('throws ForbiddenError for TENANT_ADMIN', async () => {
      await expect(
        PermissionService.create({ key: 'x:y', resource: 'x', action: 'y' }, mockCtx('TENANT_ADMIN'))
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ForbiddenError for MEMBER', async () => {
      await expect(
        PermissionService.create({ key: 'x:y', resource: 'x', action: 'y' }, mockCtx('MEMBER'))
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws error when key is missing', async () => {
      await expect(
        PermissionService.create({ resource: 'x', action: 'y' } as never, mockCtx('PLATFORM_ADMIN'))
      ).rejects.toThrow(/required/i);
    });

    it('throws error when resource is missing', async () => {
      await expect(
        PermissionService.create({ key: 'x:y', action: 'y' } as never, mockCtx('PLATFORM_ADMIN'))
      ).rejects.toThrow(/required/i);
    });

    it('throws error when action is missing', async () => {
      await expect(
        PermissionService.create({ key: 'x:y', resource: 'x' } as never, mockCtx('PLATFORM_ADMIN'))
      ).rejects.toThrow(/required/i);
    });

    it('throws ConflictError when key already exists', async () => {
      vi.mocked(globalDb.permission.findUnique).mockResolvedValue(mockPermission() as never);

      await expect(
        PermissionService.create({ key: 'properties:view', resource: 'x', action: 'y' }, mockCtx('PLATFORM_ADMIN'))
      ).rejects.toThrow(ConflictError);
    });
  });

  describe('getById', () => {
    it('returns permission for PLATFORM_ADMIN', async () => {
      vi.mocked(globalDb.permission.findUnique).mockResolvedValue(mockPermission() as never);

      const result = await PermissionService.getById('perm-1', mockCtx('PLATFORM_ADMIN'));

      expect(result).toBeDefined();
    });

    it('returns permission for TENANT_ADMIN (read-only)', async () => {
      vi.mocked(globalDb.permission.findUnique).mockResolvedValue(mockPermission() as never);

      const result = await PermissionService.getById('perm-1', mockCtx('TENANT_ADMIN'));

      expect(result).toBeDefined();
    });

    it('throws ForbiddenError for MEMBER', async () => {
      await expect(
        PermissionService.getById('perm-1', mockCtx('MEMBER'))
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws NotFoundError when permission does not exist', async () => {
      vi.mocked(globalDb.permission.findUnique).mockResolvedValue(null);

      await expect(
        PermissionService.getById('perm-999', mockCtx('PLATFORM_ADMIN'))
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('list', () => {
    it('returns paginated permissions for PLATFORM_ADMIN', async () => {
      vi.mocked(globalDb.permission.findMany).mockResolvedValue([mockPermission() as never]);
      vi.mocked(globalDb.permission.count).mockResolvedValue(1);

      const result = await PermissionService.list({}, { page: 1, pageSize: 20 }, mockCtx('PLATFORM_ADMIN'));

      expect(result.items).toHaveLength(1);
      expect(result.pagination.total).toBe(1);
    });

    it('filters by isDefault', async () => {
      vi.mocked(globalDb.permission.findMany).mockResolvedValue([mockPermission({ isDefault: true }) as never]);
      vi.mocked(globalDb.permission.count).mockResolvedValue(1);

      const result = await PermissionService.list({ isDefault: true }, { page: 1, pageSize: 20 }, mockCtx('PLATFORM_ADMIN'));

      expect(result.items).toHaveLength(1);
    });

    it('returns paginated permissions for TENANT_ADMIN (read-only)', async () => {
      vi.mocked(globalDb.permission.findMany).mockResolvedValue([mockPermission() as never]);
      vi.mocked(globalDb.permission.count).mockResolvedValue(1);

      const result = await PermissionService.list({}, { page: 1, pageSize: 20 }, mockCtx('TENANT_ADMIN'));

      expect(result.items).toHaveLength(1);
    });

    it('throws ForbiddenError for MEMBER', async () => {
      await expect(
        PermissionService.list({}, { page: 1, pageSize: 20 }, mockCtx('MEMBER'))
      ).rejects.toThrow(ForbiddenError);
    });

    it('applies resource filter', async () => {
      vi.mocked(globalDb.permission.findMany).mockResolvedValue([]);
      vi.mocked(globalDb.permission.count).mockResolvedValue(0);

      await PermissionService.list({ resource: 'properties' }, { page: 1, pageSize: 20 }, mockCtx('PLATFORM_ADMIN'));

      expect(globalDb.permission.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { resource: 'properties' } }),
      );
    });

    it('applies search filter', async () => {
      vi.mocked(globalDb.permission.findMany).mockResolvedValue([]);
      vi.mocked(globalDb.permission.count).mockResolvedValue(0);

      await PermissionService.list({ search: 'view' }, { page: 1, pageSize: 20 }, mockCtx('PLATFORM_ADMIN'));

      expect(globalDb.permission.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { OR: [
            { key: { contains: 'view', mode: 'insensitive' } },
            { resource: { contains: 'view', mode: 'insensitive' } },
            { description: { contains: 'view', mode: 'insensitive' } },
          ]},
        }),
      );
    });

    it('returns correct pagination', async () => {
      vi.mocked(globalDb.permission.findMany).mockResolvedValue([]);
      vi.mocked(globalDb.permission.count).mockResolvedValue(75);

      const result = await PermissionService.list({}, { page: 4, pageSize: 20 }, mockCtx('PLATFORM_ADMIN'));

      expect(result.pagination.page).toBe(4);
      expect(result.pagination.pageSize).toBe(20);
      expect(result.pagination.totalPages).toBe(Math.ceil(75 / 20));
    });
  });

  describe('update', () => {
    it('updates permission for PLATFORM_ADMIN', async () => {
      vi.mocked(globalDb.permission.findUnique).mockResolvedValue(mockPermission() as never);
      vi.mocked(globalDb.permission.update).mockResolvedValue({ id: 'perm-1', key: 'properties:view', resource: 'properties', action: 'view', description: 'Updated desc' } as never);

      const result = await PermissionService.update('perm-1', { description: 'Updated desc' }, mockCtx('PLATFORM_ADMIN'));

      expect(result.description).toBe('Updated desc');
    });

    it('throws ForbiddenError for TENANT_ADMIN', async () => {
      await expect(
        PermissionService.update('perm-1', { description: 'X' }, mockCtx('TENANT_ADMIN'))
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ForbiddenError for MEMBER', async () => {
      await expect(
        PermissionService.update('perm-1', { description: 'X' }, mockCtx('MEMBER'))
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws NotFoundError when permission does not exist', async () => {
      vi.mocked(globalDb.permission.findUnique).mockResolvedValue(null);

      await expect(
        PermissionService.update('perm-999', { description: 'X' }, mockCtx('PLATFORM_ADMIN'))
      ).rejects.toThrow(NotFoundError);
    });

    it('throws ConflictError when key already exists', async () => {
      (globalDb.permission.findUnique as ReturnType<typeof vi.fn>).mockImplementation(async (args) => {
        if ((args as any).where?.key === 'new-key') return { id: 'perm-2', key: 'other' };
        return { id: 'perm-1', key: 'properties:view' };
      });

      await expect(
        PermissionService.update('perm-1', { key: 'new-key' }, mockCtx('PLATFORM_ADMIN'))
      ).rejects.toThrow(ConflictError);
    });

    it('calls Redis cache invalidation on update', async () => {
      vi.mocked(globalDb.permission.findUnique).mockResolvedValue(mockPermission() as never);
      vi.mocked(globalDb.permission.update).mockResolvedValue({ id: 'perm-1', key: 'properties:view', resource: 'properties', action: 'view', description: 'Updated' } as never);

      await PermissionService.update('perm-1', { description: 'Updated' }, mockCtx('PLATFORM_ADMIN'));

      expect(globalDb.permission.findUnique).toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('deletes permission for PLATFORM_ADMIN when not assigned to roles', async () => {
      vi.mocked(globalDb.permission.findUnique).mockResolvedValue(mockPermission() as never);
      vi.mocked(globalDb.rolePermission.count).mockResolvedValue(0);

      const result = await PermissionService.delete('perm-1', mockCtx('PLATFORM_ADMIN'));

      expect(result?.success).toBe(true);
    });

    it('returns null when permission is assigned to roles', async () => {
      vi.mocked(globalDb.permission.findUnique).mockResolvedValue(mockPermission() as never);
      vi.mocked(globalDb.rolePermission.count).mockResolvedValue(2);

      const result = await PermissionService.delete('perm-1', mockCtx('PLATFORM_ADMIN'));

      expect(result).toBeNull();
    });

    it('returns null when permission is a default (bootstrapped) permission', async () => {
      vi.mocked(globalDb.permission.findUnique).mockResolvedValue(mockPermission({ isDefault: true }) as never);
      vi.mocked(globalDb.rolePermission.count).mockResolvedValue(0);

      const result = await PermissionService.delete('perm-1', mockCtx('PLATFORM_ADMIN'));

      expect(result).toBeNull();
    });

    it('throws ForbiddenError for TENANT_ADMIN', async () => {
      await expect(
        PermissionService.delete('perm-1', mockCtx('TENANT_ADMIN'))
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ForbiddenError for MEMBER', async () => {
      await expect(
        PermissionService.delete('perm-1', mockCtx('MEMBER'))
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws NotFoundError when permission does not exist', async () => {
      vi.mocked(globalDb.permission.findUnique).mockResolvedValue(null);

      await expect(
        PermissionService.delete('perm-999', mockCtx('PLATFORM_ADMIN'))
      ).rejects.toThrow(NotFoundError);
    });

    it('calls Redis cache invalidation on delete', async () => {
      vi.mocked(globalDb.permission.findUnique).mockResolvedValue(mockPermission() as never);
      vi.mocked(globalDb.rolePermission.count).mockResolvedValue(0);

      await PermissionService.delete('perm-1', mockCtx('PLATFORM_ADMIN'));

      expect(globalDb.permission.findUnique).toHaveBeenCalled();
    });
  });
});
