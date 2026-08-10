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
});
