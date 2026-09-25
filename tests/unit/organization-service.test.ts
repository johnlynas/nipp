/**
 * Unit tests for OrganizationService — full CRUD with authorization.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import globalDb from '@/lib/tenant-db';
import { env } from '@/lib/env';
import { OrganizationService } from '@/services/organization-service';
import { ServiceContext, ForbiddenError, NotFoundError, ConflictError, ValidationError } from '@/lib/services/types';

// Mock dependencies
vi.mock('@/lib/tenant-db', () => ({
  default: {
    organization: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    user: { findUnique: vi.fn(), create: vi.fn() },
    member: { create: vi.fn() },
    team: { create: vi.fn() },
    calendar: { create: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ $executeRawUnsafe: vi.fn().mockResolvedValue(0) }),
    ),
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

    it('throws when an organization with the same name already exists (case-insensitive)', async () => {
      vi.mocked(globalDb.organization.findFirst).mockResolvedValue(mockOrg({ id: 'existing' }) as never);
      // Pass a real-looking tx through so the service's in-transaction checks run
      vi.mocked(globalDb.$transaction).mockImplementation(async (fn) => {
        const tx = {
          organization: globalDb.organization,
          team: globalDb.team,
          calendar: globalDb.calendar,
          user: globalDb.user,
          member: globalDb.member,
          $executeRawUnsafe: vi.fn().mockResolvedValue(0),
        };
        return fn(tx as never);
      });

      await expect(
        OrganizationService.createOrganization({ name: 'TEST' }, mockCtx('PLATFORM_ADMIN'))
      ).rejects.toThrow(/already exists/i);

      // Name lookup must be case-insensitive
      expect(globalDb.organization.findFirst).toHaveBeenCalledWith({
        where: { name: { equals: 'TEST', mode: 'insensitive' } },
      });
    });

    it('creates the default Members team and default calendar inside the transaction', async () => {
      vi.mocked(globalDb.organization.findFirst).mockResolvedValue(null);
      const createdOrg = mockOrg({ id: 'new-org' });
      vi.mocked(globalDb.organization.create).mockResolvedValue(createdOrg as never);
      vi.mocked(globalDb.team.create).mockResolvedValue({ id: 'team-1' } as never);
      vi.mocked(globalDb.calendar.create).mockResolvedValue({ id: 'cal-1' } as never);

      const rebind = vi.fn().mockResolvedValue(0);
      vi.mocked(globalDb.$transaction).mockImplementation(async (fn) => {
        const tx = {
          organization: globalDb.organization,
          team: globalDb.team,
          calendar: globalDb.calendar,
          user: globalDb.user,
          member: globalDb.member,
          $executeRawUnsafe: rebind,
        };
        return fn(tx as never);
      });

      await OrganizationService.createOrganization({ name: 'Test Org' }, mockCtx('PLATFORM_ADMIN'));

      // RLS WITH CHECK on Team/Calendar/Member binds to app.current_org_id — the
      // service must rebind it to the NEW org id (transaction-local) before those INSERTs.
      expect(rebind).toHaveBeenCalledTimes(1);
      expect(String(rebind.mock.calls[0][0])).toContain("set_config('app.current_org_id', 'new-org', true)");

      expect(globalDb.team.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: 'Members', slug: 'members', organizationId: 'new-org' }),
        }),
      );
      expect(globalDb.calendar.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isDefault: true, organizationId: 'new-org' }),
        }),
      );
    });

    it('reuses an existing admin user and only creates the member link', async () => {
      const existingUser = { id: 'admin-user-1', email: 'admin@test.com', name: 'admin' };
      vi.mocked(globalDb.organization.findFirst).mockResolvedValue(null);
      vi.mocked(globalDb.organization.create).mockResolvedValue(mockOrg({ id: 'new-org' }) as never);
      vi.mocked(globalDb.team.create).mockResolvedValue({ id: 'team-1' } as never);
      vi.mocked(globalDb.calendar.create).mockResolvedValue({ id: 'cal-1' } as never);
      vi.mocked(globalDb.user.findUnique).mockResolvedValue(existingUser as never);
      vi.mocked(globalDb.member.create).mockResolvedValue({ id: 'm-1' } as never);

      vi.mocked(globalDb.$transaction).mockImplementation(async (fn) => {
        const tx = {
          organization: globalDb.organization,
          team: globalDb.team,
          calendar: globalDb.calendar,
          user: globalDb.user,
          member: globalDb.member,
          $executeRawUnsafe: vi.fn().mockResolvedValue(0),
        };
        return fn(tx as never);
      });

      await OrganizationService.createOrganization(
        { name: 'Test Org', adminEmail: 'admin@test.com' },
        mockCtx('PLATFORM_ADMIN'),
      );

      expect(globalDb.user.create).not.toHaveBeenCalled();
      expect(globalDb.member.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'admin-user-1', orgId: 'new-org', role: 'admin' }),
        }),
      );
    });

    it('retries with a numeric slug suffix on P2002 collision, then succeeds', async () => {
      vi.mocked(globalDb.organization.findFirst).mockResolvedValue(null);
      const collision = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
      let attempts = 0;
      (globalDb.organization.create as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        async (args: { data: { slug: string } }) => {
          attempts += 1;
          if (args.data.slug === 'test') throw collision;
          return mockOrg({ id: 'new-org', slug: args.data.slug });
        },
      );
      vi.mocked(globalDb.team.create).mockResolvedValue({ id: 'team-1' } as never);
      vi.mocked(globalDb.calendar.create).mockResolvedValue({ id: 'cal-1' } as never);

      vi.mocked(globalDb.$transaction).mockImplementation(async (fn) => {
        const tx = {
          organization: globalDb.organization,
          team: globalDb.team,
          calendar: globalDb.calendar,
          user: globalDb.user,
          member: globalDb.member,
          $executeRawUnsafe: vi.fn().mockResolvedValue(0),
        };
        return fn(tx as never);
      });

      const result = await OrganizationService.createOrganization(
        { name: 'Test', slug: 'test' },
        mockCtx('PLATFORM_ADMIN'),
      );

      expect(attempts).toBeGreaterThanOrEqual(2);
      // First attempt used the bare slug; a subsequent one applied the numeric suffix
      const slugs = vi.mocked(globalDb.organization.create).mock.calls.map((c) => (c[0].data as { slug: string }).slug);
      expect(slugs[0]).toBe('test');
      expect(slugs.at(-1)).toMatch(/^test-\d+$/);
      expect(result.id).toBe('new-org');
    });

    it('generates the slug from the name (spaces to hyphens) when none is provided', async () => {
      vi.mocked(globalDb.organization.findFirst).mockResolvedValue(null);
      const createdOrg = mockOrg({ id: 'new-org' });
      vi.mocked(globalDb.organization.create).mockResolvedValue(createdOrg as never);
      vi.mocked(globalDb.team.create).mockResolvedValue({ id: 'team-1' } as never);
      vi.mocked(globalDb.calendar.create).mockResolvedValue({ id: 'cal-1' } as never);

      vi.mocked(globalDb.$transaction).mockImplementation(async (fn) => {
        const tx = {
          organization: globalDb.organization,
          team: globalDb.team,
          calendar: globalDb.calendar,
          user: globalDb.user,
          member: globalDb.member,
          $executeRawUnsafe: vi.fn().mockResolvedValue(0),
        };
        return fn(tx as never);
      });

      await OrganizationService.createOrganization({ name: 'Test Org Name' }, mockCtx('PLATFORM_ADMIN'));

      expect(globalDb.organization.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ slug: 'test-org-name' }) }),
      );
    });
  });

  describe('updateOrganization — tenant admin scoping', () => {
    it('allows TENANT_ADMIN to update their own org (no slug change) without touching slug', async () => {
      vi.mocked(globalDb.organization.findUnique).mockResolvedValue(mockOrg({ id: 'org-1' }) as never);
      vi.mocked(globalDb.organization.update).mockResolvedValue({ ...mockOrg(), name: 'Updated' } as never);

      await OrganizationService.updateOrganization('org-1', { name: 'Updated' }, mockCtx('TENANT_ADMIN', 'org-1'));

      expect(globalDb.organization.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'org-1' },
          data: expect.not.objectContaining({ slug: expect.anything() }),
        } as never),
      );
    });

    it('throws ValidationError when TENANT_ADMIN attempts a slug change', async () => {
      vi.mocked(globalDb.organization.findUnique).mockResolvedValue(mockOrg({ id: 'org-1' }) as never);

      await expect(
        OrganizationService.updateOrganization('org-1', { slug: 'changed' }, mockCtx('TENANT_ADMIN', 'org-1'))
      ).rejects.toThrow(ValidationError);
    });

    it('updates description and status for TENANT_ADMIN on their own org', async () => {
      vi.mocked(globalDb.organization.findUnique).mockResolvedValue(mockOrg({ id: 'org-1' }) as never);
      vi.mocked(globalDb.organization.update).mockResolvedValue(
        { ...mockOrg(), description: 'D', status: 'SUSPENDED' } as never,
      );

      const result = await OrganizationService.updateOrganization(
        'org-1',
        { description: 'D', status: 'SUSPENDED' },
        mockCtx('TENANT_ADMIN', 'org-1'),
      );

      expect(result.description).toBe('D');
      expect(result.status).toBe('SUSPENDED');
    });
  });

  describe('getPaginatedOrganizations — dashboard aggregates', () => {
    it('returns statusCounts from groupBy and globalTotal', async () => {
      vi.mocked(globalDb.organization.count).mockResolvedValue(9);
      vi.mocked(globalDb.organization.groupBy).mockResolvedValue([
        { status: 'ACTIVE', _count: { status: 5 } },
        { status: 'PENDING', _count: { status: 2 } },
      ] as never);
      vi.mocked(globalDb.organization.findMany).mockResolvedValue([]);

      const result = await OrganizationService.getPaginatedOrganizations({ page: 1, pageSize: 20 });

      expect(result.globalTotal).toBe(9);
      expect(result.statusCounts).toEqual({
        ACTIVE: 5,
        PENDING: 2,
        SUSPENDED: 0,
        ARCHIVED: 0,
      });
    });

    it('maps member and team counts onto each organization row', async () => {
      vi.mocked(globalDb.organization.count).mockResolvedValue(1);
      vi.mocked(globalDb.organization.groupBy).mockResolvedValue([] as never);
      vi.mocked(globalDb.organization.findMany).mockResolvedValue([
        { ...mockOrg(), _count: { members: 7, teams: 2 } },
      ] as never);

      const result = await OrganizationService.getPaginatedOrganizations({ page: 1, pageSize: 20 });

      expect(result.organizations[0].memberCount).toBe(7);
      expect(result.organizations[0].teamCount).toBe(2);
    });

    it('combines status and search filters in the where clause', async () => {
      vi.mocked(globalDb.organization.findMany).mockResolvedValue([]);
      vi.mocked(globalDb.organization.count).mockResolvedValue(0);

      await OrganizationService.getPaginatedOrganizations({
        page: 1,
        pageSize: 20,
        status: 'ACTIVE',
        search: 'acme',
      });

      expect(globalDb.organization.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: 'ACTIVE',
            name: { contains: 'acme', mode: 'insensitive' },
          },
        }),
      );
    });

    it('computes skip from page and pageSize', async () => {
      vi.mocked(globalDb.organization.findMany).mockResolvedValue([]);
      vi.mocked(globalDb.organization.count).mockResolvedValue(0);
      vi.mocked(globalDb.organization.groupBy).mockResolvedValue([] as never);

      await OrganizationService.getPaginatedOrganizations({ page: 3, pageSize: 25 });

      expect(globalDb.organization.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 50, take: 25 }),
      );
    });
  });
});
