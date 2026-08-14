/**
 * Unit tests for ResourceService — full CRUD with authorization.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import globalDb from '@/lib/global-db';
import { ResourceService } from '@/services/resource-service';
import { ServiceContext, ForbiddenError, NotFoundError, ConflictError, ValidationError } from '@/lib/services/types';

// Mock dependencies
// Shared mock functions for transaction support — use vi.hoisted so they're
// available inside the hoisted vi.mock factory.
const Mocks = vi.hoisted(() => {
  const resourceCreate = vi.fn();
  const resourceUpdate = vi.fn();
  // Shared findUnique/findFirst so $transaction delegates to the same mocks
  const resourceFindUnique = vi.fn();
  const resourceFindFirst = vi.fn();
  return {
    resourceCreate,
    resourceUpdate,
    resourceFindUnique,
    resourceFindFirst,
    resourceRoleCreate: vi.fn(),
    resourceRoleDeleteMany: vi.fn(),
  };
});

vi.mock('@/lib/global-db', () => ({
  default: {
    resource: {
      findUnique: Mocks.resourceFindUnique,
      findFirst: Mocks.resourceFindFirst,
      findMany: vi.fn(),
      count: vi.fn(),
      create: Mocks.resourceCreate,
      update: Mocks.resourceUpdate,
      delete: vi.fn(),
    },
    resourceRole: {
      findMany: vi.fn(),
      deleteMany: Mocks.resourceRoleDeleteMany,
      count: vi.fn(),
      create: Mocks.resourceRoleCreate,
    },
    $transaction: vi.fn(async (cb) => {
      // Transaction client delegates to the same mocks so test setups apply inside transactions
      const txClient = {
        resource: {
          findUnique: Mocks.resourceFindUnique,
          findFirst: Mocks.resourceFindFirst,
          findMany: vi.fn(),
          count: vi.fn(),
          create: Mocks.resourceCreate,
          update: Mocks.resourceUpdate,
          delete: vi.fn(),
        },
        resourceRole: {
          deleteMany: Mocks.resourceRoleDeleteMany,
          create: Mocks.resourceRoleCreate,
        },
      };
      return cb(txClient);
    }),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockCtx = (role: 'PLATFORM_ADMIN' | 'TENANT_ADMIN' | 'MEMBER', orgId?: string): ServiceContext => ({
  userId: 'user-1',
  role,
  organizationId: orgId,
});

const mockResource = (overrides = {}) => ({
  id: 'res-1',
  name: 'Maintenance',
  description: 'Manage maintenance requests',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const mockResourceRole = (overrides = {}) => ({
  id: 'rr-1',
  createdAt: new Date(),
  roleId: 'role-1',
  role: { id: 'role-1', name: 'Manager', description: null, organizationId: 'org-1' },
  ...overrides,
});

describe('ResourceService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock return values to prevent bleed between tests
    Mocks.resourceFindFirst.mockReset().mockResolvedValue(null);
    Mocks.resourceFindUnique.mockReset().mockResolvedValue(null);
  });

  describe('create', () => {
    it('creates resource for PLATFORM_ADMIN', async () => {
      Mocks.resourceFindFirst.mockResolvedValue(null);
      Mocks.resourceCreate.mockResolvedValue(mockResource({ id: 'new-res' }) as never);

      const result = await ResourceService.create(
        { name: 'Maintenance', description: 'Manage maintenance requests' },
        mockCtx('PLATFORM_ADMIN'),
      );

      expect(result.id).toBe('new-res');
    });

    it('creates resource with role assignments', async () => {
      Mocks.resourceFindFirst.mockResolvedValue(null);
      Mocks.resourceCreate.mockResolvedValue(mockResource({ id: 'new-res' }) as never);
      Mocks.resourceRoleCreate.mockResolvedValue(mockResourceRole() as never);

      const result = await ResourceService.create(
        { name: 'Maintenance', description: '...', roleIds: ['role-1', 'role-2'] },
        mockCtx('PLATFORM_ADMIN'),
      );

      expect(result.id).toBe('new-res');
    });

    it('throws ForbiddenError for TENANT_ADMIN', async () => {
      await expect(
        ResourceService.create({ name: 'Test' }, mockCtx('TENANT_ADMIN'))
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ForbiddenError for MEMBER', async () => {
      await expect(
        ResourceService.create({ name: 'Test' }, mockCtx('MEMBER'))
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ConflictError when name already exists (case-insensitive)', async () => {
      Mocks.resourceFindFirst.mockResolvedValue(mockResource() as never);

      await expect(
        ResourceService.create({ name: 'maintenance' }, mockCtx('PLATFORM_ADMIN'))
      ).rejects.toThrow(ConflictError);
    });

    it('throws ValidationError when name is missing', async () => {
      await expect(
        ResourceService.create({ description: 'No name' } as never, mockCtx('PLATFORM_ADMIN'))
      ).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError when name is empty string', async () => {
      await expect(
        ResourceService.create({ name: '', description: 'Empty' }, mockCtx('PLATFORM_ADMIN'))
      ).rejects.toThrow(ValidationError);
    });

    it('trims name on create', async () => {
      Mocks.resourceFindFirst.mockResolvedValue(null);
      Mocks.resourceCreate.mockResolvedValue(mockResource({ id: 'new-res' }) as never);

      await ResourceService.create(
        { name: '  Maintenance  ', description: 'test' },
        mockCtx('PLATFORM_ADMIN'),
      );

      expect(Mocks.resourceCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ name: 'Maintenance' }) }),
      );
    });
  });

  describe('getById', () => {
    it('returns resource with role assignments for PLATFORM_ADMIN', async () => {
      Mocks.resourceFindUnique.mockResolvedValue(
        mockResource({ resourceRoles: [mockResourceRole()] }) as never,
      );

      const result = await ResourceService.getById('res-1', mockCtx('PLATFORM_ADMIN'));

      expect(result).toBeDefined();
      expect(result.resourceRoles).toHaveLength(1);
    });

    it('throws NotFoundError when resource does not exist', async () => {
      Mocks.resourceFindUnique.mockResolvedValue(null);

      await expect(
        ResourceService.getById('res-999', mockCtx('PLATFORM_ADMIN'))
      ).rejects.toThrow(NotFoundError);
    });

    it('throws ForbiddenError for TENANT_ADMIN', async () => {
      await expect(
        ResourceService.getById('res-1', mockCtx('TENANT_ADMIN'))
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ForbiddenError for MEMBER', async () => {
      await expect(
        ResourceService.getById('res-1', mockCtx('MEMBER'))
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('list', () => {
    it('returns paginated resources for PLATFORM_ADMIN', async () => {
      vi.mocked(globalDb.resource.findMany).mockResolvedValue([mockResource()] as never);
      vi.mocked(globalDb.resource.count).mockResolvedValue(1);

      const result = await ResourceService.list({}, { page: 1, pageSize: 20 }, mockCtx('PLATFORM_ADMIN'));

      expect(result.items).toHaveLength(1);
      expect(result.pagination.total).toBe(1);
    });

    it('filters by search (case-insensitive)', async () => {
      vi.mocked(globalDb.resource.findMany).mockResolvedValue([]) as never;
      vi.mocked(globalDb.resource.count).mockResolvedValue(0);

      await ResourceService.list({ search: 'maint' }, { page: 1, pageSize: 20 }, mockCtx('PLATFORM_ADMIN'));

      expect(globalDb.resource.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { name: { contains: 'maint', mode: 'insensitive' } },
        }),
      );
    });

    it('returns all resources when no search filter', async () => {
      vi.mocked(globalDb.resource.findMany).mockResolvedValue([]) as never;
      vi.mocked(globalDb.resource.count).mockResolvedValue(0);

      await ResourceService.list({}, { page: 1, pageSize: 20 }, mockCtx('PLATFORM_ADMIN'));

      expect(globalDb.resource.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });

    it('applies custom pagination', async () => {
      vi.mocked(globalDb.resource.findMany).mockResolvedValue([]) as never;
      vi.mocked(globalDb.resource.count).mockResolvedValue(25);

      const result = await ResourceService.list({}, { page: 2, pageSize: 10 }, mockCtx('PLATFORM_ADMIN'));

      expect(result.pagination.page).toBe(2);
      expect(result.pagination.pageSize).toBe(10);
    });

    it('caps page size at 100', async () => {
      vi.mocked(globalDb.resource.findMany).mockResolvedValue([]) as never;
      vi.mocked(globalDb.resource.count).mockResolvedValue(0);

      await ResourceService.list({}, { page: 1, pageSize: 500 }, mockCtx('PLATFORM_ADMIN'));

      // normalizePagination caps at 100
      expect(globalDb.resource.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
    });

    it('throws ForbiddenError for MEMBER', async () => {
      await expect(
        ResourceService.list({}, { page: 1, pageSize: 20 }, mockCtx('MEMBER'))
      ).rejects.toThrow(ForbiddenError);
    });

    it('orders by name ascending', async () => {
      vi.mocked(globalDb.resource.findMany).mockResolvedValue([]) as never;
      vi.mocked(globalDb.resource.count).mockResolvedValue(0);

      await ResourceService.list({}, { page: 1, pageSize: 20 }, mockCtx('PLATFORM_ADMIN'));

      expect(globalDb.resource.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { name: 'asc' } }),
      );
    });

    it('includes resourceRoles with role data', async () => {
      vi.mocked(globalDb.resource.findMany).mockResolvedValue([]) as never;
      vi.mocked(globalDb.resource.count).mockResolvedValue(0);

      await ResourceService.list({}, { page: 1, pageSize: 20 }, mockCtx('PLATFORM_ADMIN'));

      expect(globalDb.resource.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: { resourceRoles: { include: { role: true } } },
        }),
      );
    });
  });

  describe('update', () => {
    it('updates name and description for PLATFORM_ADMIN', async () => {
      Mocks.resourceFindUnique.mockResolvedValue(mockResource() as never);
      Mocks.resourceUpdate.mockResolvedValue(
        mockResource({ name: 'Work Orders', description: 'Updated' }) as never,
      );

      const result = await ResourceService.update('res-1', { name: 'Work Orders', description: 'Updated' }, mockCtx('PLATFORM_ADMIN'));

      expect(result.name).toBe('Work Orders');
    });

    it('partial update — name only', async () => {
      Mocks.resourceFindUnique.mockResolvedValue(mockResource() as never);
      Mocks.resourceUpdate.mockResolvedValue(
        mockResource({ name: 'New Name' }) as never,
      );

      await ResourceService.update('res-1', { name: 'New Name' }, mockCtx('PLATFORM_ADMIN'));

      expect(Mocks.resourceUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: { name: 'New Name' } }),
      );
    });

    it('replaces role assignments when roleIds provided', async () => {
      Mocks.resourceFindUnique.mockResolvedValue(mockResource() as never);
      Mocks.resourceUpdate.mockResolvedValue(mockResource({ id: 'res-1' }) as never);
      Mocks.resourceRoleCreate.mockResolvedValue(mockResourceRole() as never);

      await ResourceService.update('res-1', { roleIds: ['role-3'] }, mockCtx('PLATFORM_ADMIN'));

      expect(Mocks.resourceRoleDeleteMany).toHaveBeenCalledWith({ where: { resourceId: 'res-1' } });
      expect(Mocks.resourceRoleCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: { resourceId: 'res-1', roleId: 'role-3' } }),
      );
    });

    it('throws NotFoundError when resource does not exist', async () => {
      Mocks.resourceFindUnique.mockResolvedValue(null);

      await expect(
        ResourceService.update('res-999', { name: 'New' }, mockCtx('PLATFORM_ADMIN'))
      ).rejects.toThrow(NotFoundError);
    });

    it('throws ConflictError when name already exists (different resource)', async () => {
      // res-1 has a different name, so updating to 'Maintenance' should conflict
      Mocks.resourceFindUnique.mockResolvedValue(mockResource({ id: 'res-1', name: 'Work Orders' }) as never);
      Mocks.resourceFindFirst.mockResolvedValue(mockResource({ id: 'res-2' }) as never);
      Mocks.resourceUpdate.mockResolvedValue(mockResource({ id: 'res-1' }) as never);

      await expect(
        ResourceService.update('res-1', { name: 'Maintenance' }, mockCtx('PLATFORM_ADMIN'))
      ).rejects.toThrow(ConflictError);
    });

    it('throws ForbiddenError for TENANT_ADMIN', async () => {
      await expect(
        ResourceService.update('res-1', { name: 'New' }, mockCtx('TENANT_ADMIN'))
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ForbiddenError for MEMBER', async () => {
      await expect(
        ResourceService.update('res-1', { name: 'New' }, mockCtx('MEMBER'))
      ).rejects.toThrow(ForbiddenError);
    });

    it('trims name on update', async () => {
      Mocks.resourceFindUnique.mockResolvedValue(mockResource() as never);
      Mocks.resourceUpdate.mockResolvedValue(mockResource({ id: 'res-1' }) as never);

      await ResourceService.update('res-1', { name: '  New Name  ' }, mockCtx('PLATFORM_ADMIN'));

      expect(Mocks.resourceUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: { name: 'New Name' } }),
      );
    });

    it('clears all role assignments when roleIds is empty array', async () => {
      Mocks.resourceFindUnique.mockResolvedValue(mockResource() as never);
      Mocks.resourceUpdate.mockResolvedValue(mockResource({ id: 'res-1' }) as never);

      await ResourceService.update('res-1', { roleIds: [] }, mockCtx('PLATFORM_ADMIN'));

      expect(Mocks.resourceRoleDeleteMany).toHaveBeenCalledWith({ where: { resourceId: 'res-1' } });
      // create should not be called for empty array
    });
  });

  describe('delete', () => {
    it('deletes resource with no assigned roles for PLATFORM_ADMIN', async () => {
      vi.mocked(globalDb.resource.findUnique).mockResolvedValue(mockResource() as never);
      vi.mocked(globalDb.resourceRole.count).mockResolvedValue(0);
      vi.mocked(globalDb.resource.delete).mockResolvedValue(mockResource({ id: 'res-1' }) as never);

      const result = await ResourceService.delete('res-1', mockCtx('PLATFORM_ADMIN'));

      expect(result).toEqual({ success: true });
    });

    it('throws ConflictError when resource has assigned roles', async () => {
      vi.mocked(globalDb.resource.findUnique).mockResolvedValue(mockResource() as never);
      vi.mocked(globalDb.resourceRole.count).mockResolvedValue(2);

      await expect(
        ResourceService.delete('res-1', mockCtx('PLATFORM_ADMIN'))
      ).rejects.toThrow(ConflictError);
    });

    it('throws NotFoundError when resource does not exist', async () => {
      vi.mocked(globalDb.resource.findUnique).mockResolvedValue(null);

      await expect(
        ResourceService.delete('res-999', mockCtx('PLATFORM_ADMIN'))
      ).rejects.toThrow(NotFoundError);
    });

    it('throws ForbiddenError for TENANT_ADMIN', async () => {
      await expect(
        ResourceService.delete('res-1', mockCtx('TENANT_ADMIN'))
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ForbiddenError for MEMBER', async () => {
      await expect(
        ResourceService.delete('res-1', mockCtx('MEMBER'))
      ).rejects.toThrow(ForbiddenError);
    });

    it('does not delete when roles are assigned', async () => {
      vi.mocked(globalDb.resource.findUnique).mockResolvedValue(mockResource() as never);
      vi.mocked(globalDb.resourceRole.count).mockResolvedValue(1);

      await ResourceService.delete('res-1', mockCtx('PLATFORM_ADMIN')).catch(() => {});

      expect(globalDb.resource.delete).not.toHaveBeenCalled();
    });
  });
});
