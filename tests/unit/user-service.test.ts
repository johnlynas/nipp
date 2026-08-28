/**
 * Unit tests for UserService — full CRUD with authorization.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import globalDb from '@/lib/global-db';
import { UserService } from '@/services/user-service';
import { ServiceContext, ForbiddenError, NotFoundError, ValidationError } from '@/lib/services/types';

// Mock dependencies
vi.mock('@/lib/global-db', () => ({
  default: {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    member: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
    account: { create: vi.fn() },
    teamMember: { findMany: vi.fn() },
  },
}));

// Helper to cast mock user objects to the expected Prisma type
function castUser(obj: Record<string, unknown>): never {
  return obj as never;
}

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockCtx = (role: 'PLATFORM_ADMIN' | 'TENANT_ADMIN' | 'MEMBER', orgId?: string): ServiceContext => ({
  userId: 'user-1',
  role,
  organizationId: orgId,
});

const mockUser = (overrides: Record<string, unknown> = {}) => ({
  id: 'user-1',
  name: 'Test User',
  email: 'test@example.com',
  emailVerified: true,
  image: null,
  passwordHash: null,
  role: 'member',
  banned: false,
  banReason: null,
  banExpires: null,
  activeOrganizationId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('UserService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('creates user for PLATFORM_ADMIN', async () => {
      vi.mocked(globalDb.user.findUnique).mockResolvedValue(null);
      vi.mocked(globalDb.user.create).mockResolvedValue(castUser(mockUser({ id: 'new-user' })) as never);

      const result = await UserService.create(
        { email: 'new@example.com', name: 'New User' },
        mockCtx('PLATFORM_ADMIN'),
      );

      expect(result.id).toBe('new-user');
    });

    it('creates user and adds to org for TENANT_ADMIN', async () => {
      vi.mocked(globalDb.user.findUnique).mockResolvedValue(null);
      vi.mocked(globalDb.user.create).mockResolvedValue(castUser(mockUser({ id: 'new-user' })) as never);
      vi.mocked(globalDb.member.create).mockResolvedValue({ id: 'm-1', userId: 'new-user', orgId: 'org-1' } as never);

      const result = await UserService.create(
        { email: 'new@example.com', name: 'New User' },
        mockCtx('TENANT_ADMIN', 'org-1'),
      );

      expect(result.id).toBe('new-user');
      expect(globalDb.member.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ userId: 'new-user', orgId: 'org-1' }) }),
      );
    });

    it('throws ForbiddenError for MEMBER', async () => {
      await expect(
        UserService.create({ email: 'x@y.com', name: 'X' }, mockCtx('MEMBER'))
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ValidationError when email is missing', async () => {
      await expect(
        UserService.create({ name: 'X' } as never, mockCtx('PLATFORM_ADMIN'))
      ).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError when name is missing', async () => {
      await expect(
        UserService.create({ email: 'x@y.com' } as never, mockCtx('PLATFORM_ADMIN'))
      ).rejects.toThrow(ValidationError);
    });

    it('throws error when email already exists', async () => {
      vi.mocked(globalDb.user.findUnique).mockResolvedValue(castUser(mockUser()) as never);

      await expect(
        UserService.create({ email: 'test@example.com', name: 'X' }, mockCtx('PLATFORM_ADMIN'))
      ).rejects.toThrow(/already exists/i);
    });
  });

  describe('getById', () => {
    it('returns user for PLATFORM_ADMIN', async () => {
      vi.mocked(globalDb.user.findUnique).mockResolvedValue(castUser(mockUser()) as never);

      const result = await UserService.getById('user-1', mockCtx('PLATFORM_ADMIN'));

      expect(result).toBeDefined();
    });

    it('returns user for TENANT_ADMIN when user is in their org', async () => {
      vi.mocked(globalDb.user.findUnique).mockResolvedValue(castUser(mockUser()) as never);
      vi.mocked(globalDb.member.findFirst).mockResolvedValue({ id: 'm-1', userId: 'user-1', orgId: 'org-1' } as never);

      const result = await UserService.getById('user-1', mockCtx('TENANT_ADMIN', 'org-1'));

      expect(result).toBeDefined();
    });

    it('throws ForbiddenError for TENANT_ADMIN when user is not in their org', async () => {
      vi.mocked(globalDb.user.findUnique).mockResolvedValue(castUser(mockUser()) as never);
      vi.mocked(globalDb.member.findFirst).mockResolvedValue(null);

      await expect(
        UserService.getById('user-2', mockCtx('TENANT_ADMIN', 'org-1'))
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ForbiddenError for MEMBER', async () => {
      await expect(
        UserService.getById('user-1', mockCtx('MEMBER'))
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws NotFoundError when user does not exist', async () => {
      vi.mocked(globalDb.user.findUnique).mockResolvedValue(null);

      await expect(
        UserService.getById('user-999', mockCtx('PLATFORM_ADMIN'))
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('list', () => {
    it('returns all users for PLATFORM_ADMIN', async () => {
      vi.mocked(globalDb.user.findMany).mockResolvedValue([castUser(mockUser()) as never]);
      vi.mocked(globalDb.user.count).mockResolvedValue(1);
      vi.mocked(globalDb.member.findMany).mockResolvedValue([{ id: 'm-1', userId: 'user-1', orgId: 'org-1', role: 'MEMBER', teamId: null, createdAt: new Date(), updatedAt: new Date() }]);

      const result = await UserService.list({}, { page: 1, pageSize: 20 }, mockCtx('PLATFORM_ADMIN'));

      expect(result.items).toHaveLength(1);
      expect(result.pagination.total).toBe(1);
    });

    it('returns only org members for TENANT_ADMIN', async () => {
      vi.mocked(globalDb.user.findMany).mockResolvedValue([castUser(mockUser()) as never]);
      vi.mocked(globalDb.user.count).mockResolvedValue(1);

      await UserService.list({}, { page: 1, pageSize: 20 }, mockCtx('TENANT_ADMIN', 'org-1'));

      expect(globalDb.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { members: { some: { orgId: 'org-1' } } },
        }),
      );
    });

    it('applies search filter', async () => {
      vi.mocked(globalDb.user.findMany).mockResolvedValue([]);
      vi.mocked(globalDb.user.count).mockResolvedValue(0);
      vi.mocked(globalDb.member.findMany).mockResolvedValue([{ id: 'm-1', userId: 'user-1', orgId: 'org-1', role: 'MEMBER', teamId: null, createdAt: new Date(), updatedAt: new Date() }]);

      await UserService.list({ search: 'john' }, { page: 1, pageSize: 20 }, mockCtx('PLATFORM_ADMIN'));

      expect(globalDb.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { name: { contains: 'john', mode: 'insensitive' } },
              { email: { contains: 'john', mode: 'insensitive' } },
            ],
          }),
        }),
      );
    });

    it('throws ForbiddenError for MEMBER', async () => {
      await expect(
        UserService.list({}, { page: 1, pageSize: 20 }, mockCtx('MEMBER'))
      ).rejects.toThrow(ForbiddenError);
    });

    it('returns correct pagination', async () => {
      vi.mocked(globalDb.user.findMany).mockResolvedValue([]);
      vi.mocked(globalDb.user.count).mockResolvedValue(45);
      vi.mocked(globalDb.member.findMany).mockResolvedValue([{ id: 'm-1', userId: 'user-1', orgId: 'org-1', role: 'MEMBER', teamId: null, createdAt: new Date(), updatedAt: new Date() }]);

      const result = await UserService.list({}, { page: 2, pageSize: 10 }, mockCtx('PLATFORM_ADMIN'));

      expect(result.pagination.page).toBe(2);
      expect(result.pagination.pageSize).toBe(10);
      expect(result.pagination.total).toBe(45);
      expect(result.pagination.totalPages).toBe(Math.ceil(45 / 10));
    });
  });

  describe('update', () => {
    it('updates user for PLATFORM_ADMIN', async () => {
      vi.mocked(globalDb.user.findUnique).mockResolvedValue(castUser(mockUser()) as never);
      vi.mocked(globalDb.user.update).mockResolvedValue({ id: 'user-1', name: 'Updated', email: 'test@example.com' } as never);

      const result = await UserService.update('user-1', { name: 'Updated' }, mockCtx('PLATFORM_ADMIN'));

      expect(result.name).toBe('Updated');
    });

    it('updates user for TENANT_ADMIN when in their org', async () => {
      vi.mocked(globalDb.user.findUnique).mockResolvedValue(castUser(mockUser()) as never);
      vi.mocked(globalDb.member.findFirst).mockResolvedValue({ id: 'm-1', userId: 'user-1', orgId: 'org-1' } as never);
      vi.mocked(globalDb.user.update).mockResolvedValue({ id: 'user-1', name: 'Updated', email: 'test@example.com' } as never);

      const result = await UserService.update('user-1', { name: 'Updated' }, mockCtx('TENANT_ADMIN', 'org-1'));

      expect(result.name).toBe('Updated');
    });

    it('throws ForbiddenError for TENANT_ADMIN when user not in org', async () => {
      vi.mocked(globalDb.user.findUnique).mockResolvedValue(castUser(mockUser()) as never);
      vi.mocked(globalDb.member.findFirst).mockResolvedValue(null);

      await expect(
        UserService.update('user-2', { name: 'X' }, mockCtx('TENANT_ADMIN', 'org-1'))
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ForbiddenError for MEMBER', async () => {
      await expect(
        UserService.update('user-1', { name: 'X' }, mockCtx('MEMBER'))
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws NotFoundError when user does not exist', async () => {
      vi.mocked(globalDb.user.findUnique).mockResolvedValue(null);

      await expect(
        UserService.update('user-999', { name: 'X' }, mockCtx('PLATFORM_ADMIN'))
      ).rejects.toThrow(NotFoundError);
    });

    it('throws error when email already exists', async () => {
      (globalDb.user.findUnique as ReturnType<typeof vi.fn>).mockImplementation(async (args) => {
        if ((args as any).where?.email === 'taken@example.com') return { id: 'user-1', email: 'test@example.com' };
        return { id: 'user-1', email: 'old@example.com' };
      });

      await expect(
        UserService.update('user-1', { email: 'taken@example.com' }, mockCtx('PLATFORM_ADMIN'))
      ).rejects.toThrow(/already exists/i);
    });
  });

  describe('delete', () => {
    it('deletes user for PLATFORM_ADMIN', async () => {
      vi.mocked(globalDb.user.findUnique).mockResolvedValue(castUser(mockUser()) as never);

      const result = await UserService.delete('user-1', mockCtx('PLATFORM_ADMIN'));

      expect(result.success).toBe(true);
    });

    it('deletes user and removes member relationships for TENANT_ADMIN', async () => {
      vi.mocked(globalDb.user.findUnique).mockResolvedValue(castUser(mockUser()) as never);
      vi.mocked(globalDb.member.findFirst).mockResolvedValue({ id: 'm-1', userId: 'user-1', orgId: 'org-1' } as never);

      const result = await UserService.delete('user-1', mockCtx('TENANT_ADMIN', 'org-1'));

      expect(result.success).toBe(true);
      expect(globalDb.member.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    });

    it('throws ForbiddenError for TENANT_ADMIN when user not in org', async () => {
      vi.mocked(globalDb.user.findUnique).mockResolvedValue(castUser(mockUser()) as never);
      vi.mocked(globalDb.member.findFirst).mockResolvedValue(null);

      await expect(
        UserService.delete('user-2', mockCtx('TENANT_ADMIN', 'org-1'))
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ForbiddenError for MEMBER', async () => {
      await expect(
        UserService.delete('user-1', mockCtx('MEMBER'))
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws NotFoundError when user does not exist', async () => {
      vi.mocked(globalDb.user.findUnique).mockResolvedValue(null);

      await expect(
        UserService.delete('user-999', mockCtx('PLATFORM_ADMIN'))
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('create — password / credential account', () => {
    it('hashes the password and creates a Better Auth credential account', async () => {
      vi.mocked(globalDb.user.findUnique).mockResolvedValue(null);
      const created = castUser(mockUser({ id: 'pw-user' }));
      vi.mocked(globalDb.user.create).mockResolvedValue(created as never);
      const accountResult = { id: 'account-1', accountId: 'pw-user', providerId: 'credential', password: 'hash', userId: 'pw-user' };
      vi.mocked(globalDb.account.create).mockResolvedValue(accountResult as never);

      await UserService.create(
        { email: 'pw@example.com', name: 'Pw User', password: 's3cret-pass' },
        mockCtx('PLATFORM_ADMIN'),
      );

      // The user record stores a hash, never the plaintext password
      const userData = (vi.mocked(globalDb.user.create).mock.calls[0][0].data) as { passwordHash?: string; email: string };
      expect(userData.passwordHash).toBeTypeOf('string');
      expect(userData.passwordHash).not.toBe('s3cret-pass');

      // Credential account links sign-in to the same user
      expect(globalDb.account.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            providerId: 'credential',
            userId: 'pw-user',
            password: userData.passwordHash,
          }),
        }),
      );
    });

    it('skips the credential account when no password is provided', async () => {
      vi.mocked(globalDb.user.findUnique).mockResolvedValue(null);
      vi.mocked(globalDb.user.create).mockResolvedValue(castUser(mockUser({ id: 'no-pw' })) as never);

      await UserService.create(
        { email: 'nopw@example.com', name: 'No Pw' },
        mockCtx('PLATFORM_ADMIN'),
      );

      const userData = (vi.mocked(globalDb.user.create).mock.calls[0][0].data) as { passwordHash?: string };
      expect(userData.passwordHash).toBeUndefined();
      expect(globalDb.account.create).not.toHaveBeenCalled();
    });

    it('PLATFORM_ADMIN can assign a newly created user to a specific organization', async () => {
      vi.mocked(globalDb.user.findUnique).mockResolvedValue(null);
      vi.mocked(globalDb.user.create).mockResolvedValue(castUser(mockUser({ id: 'org-assign' })) as never);
      vi.mocked(globalDb.member.create).mockResolvedValue({ id: 'm-1' } as never);

      await UserService.create(
        { email: 'assign@example.com', name: 'Assign', organizationId: 'target-org-5' },
        mockCtx('PLATFORM_ADMIN'),
      );

      expect(globalDb.member.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'org-assign', orgId: 'target-org-5', role: 'member' }),
        }),
      );
    });
  });

  describe('list — platform admin org/role/team filters', () => {
    it('filters users by organization through the member table', async () => {
      vi.mocked(globalDb.member.findMany).mockResolvedValue([
        { userId: 'user-1' },
        { userId: 'user-2' },
      ] as never);
      vi.mocked(globalDb.user.findMany).mockResolvedValue([] as never[]);
      vi.mocked(globalDb.user.count).mockResolvedValue(0);

      await UserService.list({ organizationId: 'org-1' } , { page: 1, pageSize: 20 }, mockCtx('PLATFORM_ADMIN'));

      expect(globalDb.member.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { orgId: 'org-1' } }),
      );
      expect(globalDb.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: { in: ['user-1', 'user-2'] } }) }),
      );
    });

    it('scopes member lookups by both organization and role', async () => {
      vi.mocked(globalDb.member.findMany).mockResolvedValue([{ userId: 'user-1' }] as never);
      vi.mocked(globalDb.user.findMany).mockResolvedValue([] as never[]);
      vi.mocked(globalDb.user.count).mockResolvedValue(0);

      await UserService.list({ organizationId: 'org-1', role: 'admin' }, { page: 1, pageSize: 20 }, mockCtx('PLATFORM_ADMIN'));

      expect(globalDb.member.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { orgId: 'org-1', role: 'admin' } }),
      );
    });

    it('intersects org membership with team membership when both filters are set', async () => {
      vi.mocked(globalDb.member.findMany).mockResolvedValue([
        { userId: 'user-1' },
        { userId: 'user-2' },
      ] as never);
      vi.mocked(globalDb.teamMember.findMany).mockResolvedValue([
        { userId: 'user-2' },
        { userId: 'user-3' },
      ] as never);
      vi.mocked(globalDb.user.findMany).mockResolvedValue([] as never[]);
      vi.mocked(globalDb.user.count).mockResolvedValue(0);

      await UserService.list({ organizationId: 'org-1', teamId: 'team-1' }, { page: 1, pageSize: 20 }, mockCtx('PLATFORM_ADMIN'));

      expect(globalDb.teamMember.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { teamId: 'team-1' } }),
      );
      // Only user-2 is in both the org and the team
      expect(globalDb.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: { in: ['user-2'] } }) }),
      );
    });

    it('returns an empty id set when no users match the filters', async () => {
      vi.mocked(globalDb.member.findMany).mockResolvedValue([] as never);
      vi.mocked(globalDb.user.findMany).mockResolvedValue([] as never[]);
      vi.mocked(globalDb.user.count).mockResolvedValue(0);

      await UserService.list({ organizationId: 'org-ghost' }, { page: 1, pageSize: 20 }, mockCtx('PLATFORM_ADMIN'));

      expect(globalDb.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: { in: [] } }) }),
      );
    });

    it('applies the banned status filter', async () => {
      vi.mocked(globalDb.user.findMany).mockResolvedValue([] as never[]);
      vi.mocked(globalDb.user.count).mockResolvedValue(0);

      await UserService.list({ status: 'banned' } , { page: 1, pageSize: 20 }, mockCtx('PLATFORM_ADMIN'));

      expect(globalDb.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ banned: true }) }),
      );
    });

    it('applies the active status filter', async () => {
      vi.mocked(globalDb.user.findMany).mockResolvedValue([] as never[]);
      vi.mocked(globalDb.user.count).mockResolvedValue(0);

      await UserService.list({ status: 'active' } , { page: 1, pageSize: 20 }, mockCtx('PLATFORM_ADMIN'));

      expect(globalDb.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ banned: false }) }),
      );
    });
  });

  describe('list — tenant admin role filter within org', () => {
    it('restricts the member scope to users with the requested role in their org', async () => {
      vi.mocked(globalDb.user.findMany).mockResolvedValue([] as never[]);
      vi.mocked(globalDb.user.count).mockResolvedValue(0);

      await UserService.list({ role: 'admin' } , { page: 1, pageSize: 20 }, mockCtx('TENANT_ADMIN', 'org-1'));

      expect(globalDb.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            members: { some: { orgId: 'org-1', role: 'admin' } },
          }),
        }),
      );
    });
  });

  describe('update — email changes', () => {
    it('allows changing to an unused email', async () => {
      (globalDb.user.findUnique as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        async (args: { where: { id?: string; email?: string } }) => {
          if (args.where.email === 'fresh@example.com') return null;
          return castUser(mockUser()); // the existing user by id
        },
      ) as never;
      vi.mocked(globalDb.user.update).mockResolvedValue({ id: 'user-1', name: 'Test User', email: 'fresh@example.com' } as never);

      const result = await UserService.update('user-1', { email: 'fresh@example.com' }, mockCtx('PLATFORM_ADMIN'));

      expect(result.email).toBe('fresh@example.com');
    });

    it('skips the duplicate-email check when the email is unchanged', async () => {
      let lookups = 0;
      (globalDb.user.findUnique as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        async (args: { where: { id?: string; email?: string } }) => {
          // A second findUnique by email should never happen when the email is identical
          if (args.where.email !== undefined) lookups += 1;
          return castUser(mockUser({ email: 'test@example.com' }));
        },
      ) as never;
      vi.mocked(globalDb.user.update).mockResolvedValue({ id: 'user-1', name: 'Renamed', email: 'test@example.com' } as never);

      await UserService.update('user-1', { name: 'Renamed', email: 'test@example.com' }, mockCtx('PLATFORM_ADMIN'));

      expect(lookups).toBe(0);
    });
  });
});
