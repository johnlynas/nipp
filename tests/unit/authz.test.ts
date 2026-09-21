import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/permissions/resolver', () => ({
  resolvePermissions: vi.fn(),
}));

vi.mock('@/lib/env', () => ({
  env: {
    PLATFORM_ORGANIZATION_ID: 'platform-org-id',
  },
}));

vi.mock('@/lib/tenant-context', () => ({
  runWithTenant: vi.fn(async (_orgId: string, fn: () => Promise<unknown>) => fn()),
}));

// verifySuperAdmin resolves the platform-org membership read under a verified
// RLS context (withPlatformContext). Unit tests exercise the DB call itself via
// the tenantDb mock below — the wrapper is a pass-through here.
vi.mock('@/lib/platform-db', () => ({
  withPlatformContext: (_userId: string, op: () => unknown) => op(),
}));

vi.mock('@/lib/tenant-db', () => {
  const mockTenantDb = {
    member: { findFirst: vi.fn() },
    memberRole: { findMany: vi.fn() },
    organization: { findFirst: vi.fn() },
  };
  return { default: mockTenantDb, tenantDb: mockTenantDb };
});

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { hasPermission, isSuperAdmin, verifySuperAdmin, getPlatformOrgId } from '@/lib/authz';
import { resolvePermissions } from '@/lib/permissions/resolver';
import tenantDb from '@/lib/tenant-db';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

describe('authz', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset env mock to default state
    env.PLATFORM_ORGANIZATION_ID = 'platform-org-id';
  });

  describe('hasPermission', () => {
    it('returns true when user has the permission', async () => {
      vi.mocked(resolvePermissions).mockResolvedValue(['properties:view', 'properties:create']);

      const result = await hasPermission('user-1', 'org-1', 'properties:create');

      expect(result).toBe(true);
      expect(resolvePermissions).toHaveBeenCalledWith('user-1', 'org-1');
    });

    it('returns false when user lacks the permission', async () => {
      vi.mocked(resolvePermissions).mockResolvedValue(['properties:view']);

      const result = await hasPermission('user-1', 'org-1', 'properties:create');

      expect(result).toBe(false);
    });

    it('returns false when resolver returns empty array', async () => {
      vi.mocked(resolvePermissions).mockResolvedValue([]);

      const result = await hasPermission('user-1', 'org-1', 'properties:create');

      expect(result).toBe(false);
    });

    it('returns false when resolver throws (graceful degradation)', async () => {
      vi.mocked(resolvePermissions).mockRejectedValue(new Error('Redis down'));

      const result = await hasPermission('user-1', 'org-1', 'properties:create');

      expect(result).toBe(false);
    });
  });

  describe('getPlatformOrgId', () => {
    it('returns ID from env.PLATFORM_ORGANIZATION_ID when set', async () => {
      const result = await getPlatformOrgId();

      expect(result).toBe('platform-org-id');
      expect(tenantDb.organization.findFirst).not.toHaveBeenCalled();
    });

    it('returns ID from database when env is not set', async () => {
      env.PLATFORM_ORGANIZATION_ID = '';
      vi.mocked(tenantDb.organization.findFirst).mockResolvedValue({ id: 'db-platform-id' } as any);

      const result = await getPlatformOrgId();

      expect(result).toBe('db-platform-id');
      expect(tenantDb.organization.findFirst).toHaveBeenCalledWith({
        where: { name: 'Platform' },
        select: { id: true },
      });
    });

    it('returns null when env is not set and database returns no org', async () => {
      env.PLATFORM_ORGANIZATION_ID = '';
      vi.mocked(tenantDb.organization.findFirst).mockResolvedValue(null);

      const result = await getPlatformOrgId();

      expect(result).toBeNull();
    });

    it('returns null on P1001 database connection error', async () => {
      env.PLATFORM_ORGANIZATION_ID = '';
      vi.mocked(tenantDb.organization.findFirst).mockRejectedValue(new Error("Can't reach database server at localhost:5432 (P1001)"));

      const result = await getPlatformOrgId();

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        'Database unavailable fetching platform organization ID'
      );
    });

    it('returns null on other database errors', async () => {
      env.PLATFORM_ORGANIZATION_ID = '';
      vi.mocked(tenantDb.organization.findFirst).mockRejectedValue(new Error('Unexpected error'));

      const result = await getPlatformOrgId();

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        'Error fetching platform organization ID'
      );
    });
  });

  describe('verifySuperAdmin', () => {
    it('returns authorized: false with error when platform organization is not found', async () => {
      env.PLATFORM_ORGANIZATION_ID = '';
      vi.mocked(tenantDb.organization.findFirst).mockResolvedValue(null);

      const result = await verifySuperAdmin('user-1');

      expect(result).toEqual({ authorized: false, error: 'Platform organization not found' });
      expect(logger.error).toHaveBeenCalledWith(
        { userId: 'user-1' },
        'Platform organization not found in database'
      );
    });

    it('returns authorized: false when orgId is provided but does not match platform org', async () => {
      const result = await verifySuperAdmin('user-1', 'tenant-org-id');

      expect(result).toEqual({ authorized: false, error: 'Not the platform organization' });
      expect(tenantDb.member.findFirst).not.toHaveBeenCalled();
    });

    it('returns authorized: true when user is member of Platform Organization', async () => {
      vi.mocked(tenantDb.member.findFirst).mockResolvedValue({
        id: 'member-1',
        userId: 'user-1',
        orgId: 'platform-org-id',
      } as any);

      const result = await verifySuperAdmin('user-1');

      expect(result).toEqual({ authorized: true });
    });

    it('returns authorized: true when user is member of Platform Organization and orgId matches', async () => {
      vi.mocked(tenantDb.member.findFirst).mockResolvedValue({
        id: 'member-1',
        userId: 'user-1',
        orgId: 'platform-org-id',
      } as any);

      const result = await verifySuperAdmin('user-1', 'platform-org-id');

      expect(result).toEqual({ authorized: true });
    });

    it('returns authorized: false when user is not found in platform organization', async () => {
      vi.mocked(tenantDb.member.findFirst).mockResolvedValue(null);

      const result = await verifySuperAdmin('user-1');

      expect(result).toEqual({ authorized: false, error: 'User is not a member of the platform organization' });
      expect(logger.warn).toHaveBeenCalledWith(
        { userId: 'user-1', orgId: undefined },
        'User is not a member of the platform organization'
      );
    });

    it('returns authorized: false with specific error on P1001 database error', async () => {
      vi.mocked(tenantDb.member.findFirst).mockRejectedValue(new Error("Can't reach database server at localhost:5432 (P1001)"));

      const result = await verifySuperAdmin('user-1');

      expect(result).toEqual({
        authorized: false,
        error: 'Database unavailable, authorization cannot be verified',
      });
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', err: expect.any(Error) }),
        'Database unavailable during super admin verification'
      );
    });

    it('returns authorized: false with generic error on unexpected exceptions', async () => {
      vi.mocked(tenantDb.member.findFirst).mockRejectedValue(new Error('Unexpected error'));

      const result = await verifySuperAdmin('user-1');

      expect(result).toEqual({
        authorized: false,
        error: 'Internal server error during authorization',
      });
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', err: expect.any(Error) }),
        'Error verifying super admin status'
      );
    });
  });

  describe('isSuperAdmin', () => {
    it('returns true when user is member of Platform Organization', async () => {
      vi.mocked(tenantDb.member.findFirst).mockResolvedValue({
        id: 'member-1',
        createdAt: new Date(),
        updatedAt: new Date(),
        userId: 'user-1',
        orgId: 'platform-org-id',
        teamId: null,
        role: 'admin',
      });

      const result = await isSuperAdmin('user-1', 'platform-org-id');

      expect(result).toBe(true);
    });

    it('returns false when user is in a different organization', async () => {
      vi.mocked(tenantDb.member.findFirst).mockResolvedValue(null);

      const result = await isSuperAdmin('user-1', 'tenant-org-id');

      expect(result).toBe(false);
    });

    it('returns false when orgId is undefined', async () => {
      vi.mocked(tenantDb.member.findFirst).mockResolvedValue(null);

      const result = await isSuperAdmin('user-1', undefined);

      expect(result).toBe(false);
    });

    it('returns false when platform organization is not found', async () => {
      env.PLATFORM_ORGANIZATION_ID = '';
      vi.mocked(tenantDb.organization.findFirst).mockResolvedValue(null);

      const result = await isSuperAdmin('user-1');

      expect(result).toBe(false);
    });

    it('returns false when database is unavailable', async () => {
      vi.mocked(tenantDb.member.findFirst).mockRejectedValue(new Error("Can't reach database server (P1001)"));

      const result = await isSuperAdmin('user-1');

      expect(result).toBe(false);
    });
  });
});
