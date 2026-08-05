/**
 * Unit tests for OrganizationService — full CRUD with authorization.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import globalDb from '@/lib/global-db';
import { env } from '@/lib/env';
import { OrganizationService } from '@/services/organization-service';
import { ServiceContext, ForbiddenError, NotFoundError, ConflictError } from '@/lib/services/types';

// Mock dependencies
vi.mock('@/lib/global-db', () => ({
  default: {
    organization: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    user: { findUnique: vi.fn(), create: vi.fn() },
    member: { create: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(null)),
  },
}));

vi.mock('@/lib/env', () => ({
  env: { PLATFORM_ORGANIZATION_ID: 'platform-org-123' },
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockCtx = (role: 'PLATFORM_ADMIN' | 'TENANT_ADMIN' | 'MEMBER', orgId?: string): ServiceContext => ({
  userId: 'user-1',
  role,
  organizationId: orgId,
});

const mockOrg = (overrides: Record<string, unknown> = {}) => ({
  id: 'org-1',
  name: 'Test Org',
  slug: 'test-org',
  status: 'ACTIVE' as const,
  metadata: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
}) as Record<string, unknown>;

const mockOrgWithCount = (overrides: Record<string, unknown> = {}) => ({
  id: 'org-1',
  name: 'Test Org',
  slug: 'test-org',
  status: 'ACTIVE' as const,
  metadata: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  _count: { members: 0 },
  ...overrides,
}) as Record<string, unknown>;

describe('OrganizationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getOrganizationById', () => {
    it('returns org for PLATFORM_ADMIN', async () => {
      vi.mocked(globalDb.organization.findUnique).mockResolvedValue(mockOrg() as never as never);

      const result = await OrganizationService.getOrganizationById('org-1', mockCtx('PLATFORM_ADMIN'));

      expect(result).toBeDefined();
      expect(globalDb.organization.findUnique).toHaveBeenCalledWith({ where: { id: 'org-1' } });
    });

    it('returns org for TENANT_ADMIN with matching orgId', async () => {
      vi.mocked(globalDb.organization.findUnique).mockResolvedValue(mockOrg({ id: 'org-1' }) as never);

      const result = await OrganizationService.getOrganizationById('org-1', mockCtx('TENANT_ADMIN', 'org-1'));

      expect(result).toBeDefined();
    });

    it('throws ForbiddenError for TENANT_ADMIN with different orgId', async () => {
      vi.mocked(globalDb.organization.findUnique).mockResolvedValue(mockOrg({ id: 'org-2' }) as never);

      await expect(
        OrganizationService.getOrganizationById('org-2', mockCtx('TENANT_ADMIN', 'org-1'))
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ForbiddenError for MEMBER', async () => {
      await expect(
        OrganizationService.getOrganizationById('org-1', mockCtx('MEMBER'))
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws NotFoundError when org does not exist', async () => {
      vi.mocked(globalDb.organization.findUnique).mockResolvedValue(null);

      await expect(
        OrganizationService.getOrganizationById('org-999', mockCtx('PLATFORM_ADMIN'))
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('updateOrganization', () => {
    it('updates name for PLATFORM_ADMIN', async () => {
      vi.mocked(globalDb.organization.findUnique).mockResolvedValue(mockOrg() as never);
      vi.mocked(globalDb.organization.update).mockResolvedValue({ ...mockOrg(), name: 'Updated Org' } as never);

      const result = await OrganizationService.updateOrganization('org-1', { name: 'Updated Org' }, mockCtx('PLATFORM_ADMIN'));

      expect(result.name).toBe('Updated Org');
    });

    it('updates status for PLATFORM_ADMIN', async () => {
      vi.mocked(globalDb.organization.findUnique).mockResolvedValue(mockOrg() as never);
      vi.mocked(globalDb.organization.update).mockResolvedValue({ ...mockOrg(), status: 'SUSPENDED' } as never);

      const result = await OrganizationService.updateOrganization('org-1', { status: 'SUSPENDED' }, mockCtx('PLATFORM_ADMIN'));

      expect(result.status).toBe('SUSPENDED');
    });

    it('allows slug update for PLATFORM_ADMIN', async () => {
      vi.mocked(globalDb.organization.findUnique).mockResolvedValue(mockOrg() as never);
      vi.mocked(globalDb.organization.update).mockResolvedValue({ ...mockOrg(), slug: 'new-slug' } as never);

      const result = await OrganizationService.updateOrganization('org-1', { slug: 'new-slug' }, mockCtx('PLATFORM_ADMIN'));

      expect(result.slug).toBe('new-slug');
    });

    it('throws ForbiddenError for TENANT_ADMIN with different orgId', async () => {
      vi.mocked(globalDb.organization.findUnique).mockResolvedValue(mockOrg({ id: 'org-2' }) as never);

      await expect(
        OrganizationService.updateOrganization('org-2', { name: 'X' }, mockCtx('TENANT_ADMIN', 'org-1'))
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ForbiddenError for MEMBER', async () => {
      await expect(
        OrganizationService.updateOrganization('org-1', { name: 'X' }, mockCtx('MEMBER'))
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws NotFoundError when org does not exist', async () => {
      vi.mocked(globalDb.organization.findUnique).mockResolvedValue(null);

      await expect(
        OrganizationService.updateOrganization('org-999', { name: 'X' }, mockCtx('PLATFORM_ADMIN'))
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('deleteOrganization', () => {
    it('deletes org for PLATFORM_ADMIN when no members', async () => {
      vi.mocked(globalDb.organization.findUnique).mockResolvedValue(mockOrgWithCount() as never);

      const result = await OrganizationService.deleteOrganization('org-1', mockCtx('PLATFORM_ADMIN'));

      expect(result.success).toBe(true);
    });

    it('throws ConflictError when org has members', async () => {
      vi.mocked(globalDb.organization.findUnique).mockResolvedValue(mockOrgWithCount({ _count: { members: 3 } }) as never)

      await expect(
        OrganizationService.deleteOrganization('org-1', mockCtx('PLATFORM_ADMIN'))
      ).rejects.toThrow(ConflictError);
    });

    it('throws ForbiddenError when deleting Platform Organization', async () => {
      vi.mocked(globalDb.organization.findUnique).mockResolvedValue(mockOrgWithCount({ id: 'platform-org-123' }) as never)

      await expect(
        OrganizationService.deleteOrganization('platform-org-123', mockCtx('PLATFORM_ADMIN'))
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ForbiddenError for TENANT_ADMIN', async () => {
      await expect(
        OrganizationService.deleteOrganization('org-1', mockCtx('TENANT_ADMIN'))
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ForbiddenError for MEMBER', async () => {
      await expect(
        OrganizationService.deleteOrganization('org-1', mockCtx('MEMBER'))
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws NotFoundError when org does not exist', async () => {
      vi.mocked(globalDb.organization.findUnique).mockResolvedValue(null);

      await expect(
        OrganizationService.deleteOrganization('org-999', mockCtx('PLATFORM_ADMIN'))
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('getPaginatedOrganizations', () => {
    it('returns paginated results', async () => {
      vi.mocked(globalDb.organization.findMany).mockResolvedValue([mockOrg() as never]);
      vi.mocked(globalDb.organization.count).mockResolvedValue(1);

      const result = await OrganizationService.getPaginatedOrganizations({
        page: 1, pageSize: 20, status: 'ACTIVE', search: 'test',
      });

      expect(result.organizations).toHaveLength(1);
      expect(result.pagination.total).toBe(1);
      expect(result.pagination.page).toBe(1);
    });

    it('applies status filter', async () => {
      vi.mocked(globalDb.organization.findMany).mockResolvedValue([]);
      vi.mocked(globalDb.organization.count).mockResolvedValue(0);

      await OrganizationService.getPaginatedOrganizations({
        page: 1, pageSize: 20, status: 'SUSPENDED',
      });

      expect(globalDb.organization.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'SUSPENDED' } }),
      );
    });

    it('applies search filter', async () => {
      vi.mocked(globalDb.organization.findMany).mockResolvedValue([]);
      vi.mocked(globalDb.organization.count).mockResolvedValue(0);

      await OrganizationService.getPaginatedOrganizations({
        page: 1, pageSize: 20, search: 'acme',
      });

      expect(globalDb.organization.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { name: { contains: 'acme', mode: 'insensitive' } } }),
      );
    });
  });

  describe('createOrganization', () => {
    it('creates org for PLATFORM_ADMIN with admin bootstrap', async () => {
      const createdOrg = mockOrg({ id: 'new-org' });
      vi.mocked(globalDb.$transaction).mockImplementation(async (fn) => {
        // Simulate the transaction: check name, create org, create user + member
        const existing = await globalDb.organization.findFirst({ where: { name: 'Test' } });
        if (existing) throw new Error('Duplicate');

        // Mock user creation inside transaction
        vi.mocked(globalDb.user.findUnique).mockResolvedValue(null);
        vi.mocked(globalDb.user.create).mockResolvedValue({ id: 'user-1', email: 'admin@test.com', name: 'admin' } as never);
        vi.mocked(globalDb.member.create).mockResolvedValue({ id: 'm-1', userId: 'user-1', orgId: 'new-org' } as never);

        return createdOrg;
      });

      const result = await OrganizationService.createOrganization(
        { name: 'Test', slug: 'test', adminEmail: 'admin@test.com' },
        mockCtx('PLATFORM_ADMIN'),
      );

      expect(result.id).toBe('new-org');
    });

    it('throws ForbiddenError for TENANT_ADMIN', async () => {
      await expect(
        OrganizationService.createOrganization({ name: 'Test' }, mockCtx('TENANT_ADMIN'))
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ForbiddenError for MEMBER', async () => {
      await expect(
        OrganizationService.createOrganization({ name: 'Test' }, mockCtx('MEMBER'))
      ).rejects.toThrow(ForbiddenError);
    });
  });
});
