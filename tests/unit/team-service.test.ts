/**
 * Unit tests for TeamService — full CRUD, membership management, and role inheritance.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import globalDb from '@/lib/global-db';
import { env } from '@/lib/env';
import { TeamService } from '@/services/team-service';
import { ServiceContext, ForbiddenError, NotFoundError, ConflictError, ValidationError } from '@/lib/services/types';

// Mock dependencies
vi.mock('@/lib/global-db', () => ({
  default: {
    team: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn().mockResolvedValue({ id: 'team-created', name: 'Created Team' }),
      update: vi.fn().mockResolvedValue({ id: 'team-updated', name: 'Updated Team' }),
      delete: vi.fn().mockResolvedValue({ id: 'team-deleted', name: 'Deleted Team' }),
    },
    teamMember: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn().mockResolvedValue({ id: 'tm-created', userId: 'user-1' }),
      delete: vi.fn().mockResolvedValue({ id: 'tm-deleted', userId: 'user-1' }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    teamRole: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'tr-created', teamId: 'team-1', roleId: 'role-1' }),
      delete: vi.fn().mockResolvedValue({ id: 'tr-deleted', teamId: 'team-1', roleId: 'role-1' }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    member: { findFirst: vi.fn().mockResolvedValue({ id: 'member-1' }) },
    role: { findUnique: vi.fn(), findMany: vi.fn() },
    memberRole: {
      findFirst: vi.fn(),
      create: vi.fn().mockResolvedValue({ id: 'mr-created' }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      findMany: vi.fn(),
    },
    $transaction: vi.fn(async (fn: (tx: { team: typeof globalDb.team; teamMember: typeof globalDb.teamMember; teamRole: typeof globalDb.teamRole; memberRole: typeof globalDb.memberRole }) => Promise<unknown>) => {
      const tx = { team: globalDb.team, teamMember: globalDb.teamMember, teamRole: globalDb.teamRole, memberRole: globalDb.memberRole };
      return fn(tx as never);
    }),
  },
}));

vi.mock('@/lib/env', () => ({
  env: { PLATFORM_ORGANIZATION_ID: 'platform-org-123' },
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/audit-log', () => ({
  recordAuditLog: vi.fn(),
}));

const mockCtx = (role: 'PLATFORM_ADMIN' | 'TENANT_ADMIN' | 'MEMBER', orgId?: string): ServiceContext => ({
  userId: 'user-1',
  role,
  organizationId: orgId,
});

const mockTeam = (overrides: Record<string, unknown> = {}) => ({
  id: 'team-1',
  name: 'Test Team',
  slug: 'test-team',
  description: 'A test team',
  organizationId: 'org-1',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
}) as Record<string, unknown>;

describe('TeamService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createTeam', () => {
    it('creates team for PLATFORM_ADMIN in any org', async () => {
      vi.mocked(globalDb.$transaction).mockImplementation(async (fn) => {
        return mockTeam({ id: 'new-team' });
      });

      const result = await TeamService.createTeam({ name: 'New Team' }, 'org-1', mockCtx('PLATFORM_ADMIN'));

      expect(result).toBeDefined();
    });

    it('creates team for TENANT_ADMIN in own org', async () => {
      vi.mocked(globalDb.$transaction).mockImplementation(async (fn) => {
        return mockTeam({ id: 'new-team' });
      });

      const result = await TeamService.createTeam({ name: 'New Team' }, 'org-1', mockCtx('TENANT_ADMIN', 'org-1'));

      expect(result).toBeDefined();
    });

    it('throws ForbiddenError for TENANT_ADMIN in different org', async () => {
      await expect(
        TeamService.createTeam({ name: 'New Team' }, 'org-2', mockCtx('TENANT_ADMIN', 'org-1'))
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ForbiddenError for MEMBER', async () => {
      await expect(
        TeamService.createTeam({ name: 'New Team' }, 'org-1', mockCtx('MEMBER'))
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ValidationError for empty name', async () => {
      vi.mocked(globalDb.$transaction).mockImplementation(async (fn) => {
        const tx = { team: globalDb.team, teamMember: globalDb.teamMember, teamRole: globalDb.teamRole, memberRole: globalDb.memberRole };
        return fn(tx as never);
      });

      await expect(
        TeamService.createTeam({ name: '' }, 'org-1', mockCtx('PLATFORM_ADMIN'))
      ).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError for name over 100 chars', async () => {
      vi.mocked(globalDb.$transaction).mockImplementation(async (fn) => {
        const tx = { team: globalDb.team, teamMember: globalDb.teamMember, teamRole: globalDb.teamRole, memberRole: globalDb.memberRole };
        return fn(tx as never);
      });

      await expect(
        TeamService.createTeam({ name: 'a'.repeat(101) }, 'org-1', mockCtx('PLATFORM_ADMIN'))
      ).rejects.toThrow(ValidationError);
    });

    it('auto-generates slug from name', async () => {
      let capturedSlug: string | undefined;
      vi.mocked(globalDb.$transaction).mockImplementation(async (fn) => {
        const tx = { team: globalDb.team, teamMember: globalDb.teamMember, teamRole: globalDb.teamRole, memberRole: globalDb.memberRole };
        // Intercept the create call to verify slug
        const originalCreate = tx.team.create.bind(tx.team);
        (tx as any).team = { ...tx.team, create: async (args: any) => {
          capturedSlug = args.data.slug;
          return originalCreate(args);
        }};
        await fn(tx as never);
        expect(capturedSlug).toBe('new-team');
        return mockTeam({ id: 'new-team' });
      });

      await TeamService.createTeam({ name: 'New Team' }, 'org-1', mockCtx('PLATFORM_ADMIN'));
    });

    it('uses provided slug when given', async () => {
      let capturedSlug: string | undefined;
      vi.mocked(globalDb.$transaction).mockImplementation(async (fn) => {
        const tx = { team: globalDb.team, teamMember: globalDb.teamMember, teamRole: globalDb.teamRole, memberRole: globalDb.memberRole };
        const originalCreate = tx.team.create.bind(tx.team);
        (tx as any).team = { ...tx.team, create: async (args: any) => {
          capturedSlug = args.data.slug;
          return originalCreate(args);
        }};
        await fn(tx as never);
        expect(capturedSlug).toBe('custom-slug');
        return mockTeam({ id: 'new-team' });
      });

      await TeamService.createTeam({ name: 'New Team', slug: 'custom-slug' }, 'org-1', mockCtx('PLATFORM_ADMIN'));
    });
  });

  describe('getTeamById', () => {
    it('returns team for PLATFORM_ADMIN', async () => {
      vi.mocked(globalDb.team.findUnique).mockResolvedValue(mockTeam() as never);

      const result = await TeamService.getTeamById('team-1', mockCtx('PLATFORM_ADMIN'));

      expect(result).toBeDefined();
    });

    it('returns team for TENANT_ADMIN in own org', async () => {
      vi.mocked(globalDb.team.findUnique).mockResolvedValue(mockTeam({ organizationId: 'org-1' }) as never);

      const result = await TeamService.getTeamById('team-1', mockCtx('TENANT_ADMIN', 'org-1'));

      expect(result).toBeDefined();
    });

    it('throws ForbiddenError for TENANT_ADMIN in different org', async () => {
      vi.mocked(globalDb.team.findUnique).mockResolvedValue(mockTeam({ organizationId: 'org-2' }) as never);

      await expect(
        TeamService.getTeamById('team-1', mockCtx('TENANT_ADMIN', 'org-1'))
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ForbiddenError for MEMBER', async () => {
      await expect(
        TeamService.getTeamById('team-1', mockCtx('MEMBER'))
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws NotFoundError when team does not exist', async () => {
      vi.mocked(globalDb.team.findUnique).mockResolvedValue(null);

      await expect(
        TeamService.getTeamById('team-999', mockCtx('PLATFORM_ADMIN'))
      ).rejects.toThrow(NotFoundError);
    });

    it('includes members and roles in response', async () => {
      vi.mocked(globalDb.team.findUnique).mockResolvedValue({
        ...mockTeam(),
        members: [{ id: 'tm-1', userId: 'user-2', user: { name: 'User Two', email: 'u2@test.com' }, createdAt: new Date() }],
      } as never);
      vi.mocked(globalDb.teamRole.findMany).mockResolvedValue([
        { id: 'tr-1', role: { id: 'role-1', name: 'Viewer', description: null } },
      ] as never);

      const result = await TeamService.getTeamById('team-1', mockCtx('PLATFORM_ADMIN'));

      expect(result.members).toHaveLength(1);
      expect(result.roles).toHaveLength(1);
    });
  });

  describe('getTeamsByOrg', () => {
    it('returns paginated teams for PLATFORM_ADMIN', async () => {
      vi.mocked(globalDb.team.findMany).mockResolvedValue([mockTeam() as never]);
      vi.mocked(globalDb.team.count).mockResolvedValue(1);

      const result = await TeamService.getTeamsByOrg('org-1', mockCtx('PLATFORM_ADMIN'), 1, 20);

      expect(result.teams).toHaveLength(1);
      expect(result.pagination.total).toBe(1);
    });

    it('returns paginated teams for TENANT_ADMIN in own org', async () => {
      vi.mocked(globalDb.team.findMany).mockResolvedValue([]);
      vi.mocked(globalDb.team.count).mockResolvedValue(0);

      await TeamService.getTeamsByOrg('org-1', mockCtx('TENANT_ADMIN', 'org-1'), 1, 20);

      expect(globalDb.team.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: 'org-1' } }),
      );
    });

    it('throws ForbiddenError for TENANT_ADMIN in different org', async () => {
      await expect(
        TeamService.getTeamsByOrg('org-2', mockCtx('TENANT_ADMIN', 'org-1'))
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ForbiddenError for MEMBER', async () => {
      await expect(
        TeamService.getTeamsByOrg('org-1', mockCtx('MEMBER'))
      ).rejects.toThrow(ForbiddenError);
    });

    it('applies pagination', async () => {
      vi.mocked(globalDb.team.findMany).mockResolvedValue([]);
      vi.mocked(globalDb.team.count).mockResolvedValue(0);

      await TeamService.getTeamsByOrg('org-1', mockCtx('PLATFORM_ADMIN'), 2, 10);

      expect(globalDb.team.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 }),
      );
    });
  });

  describe('updateTeam', () => {
    it('updates team for PLATFORM_ADMIN', async () => {
      vi.mocked(globalDb.team.findUnique).mockResolvedValue(mockTeam() as never);
      vi.mocked(globalDb.team.update).mockResolvedValue({ ...mockTeam(), name: 'Updated Team' } as never);

      const result = await TeamService.updateTeam('team-1', { name: 'Updated Team' }, mockCtx('PLATFORM_ADMIN'));

      expect(result.name).toBe('Updated Team');
    });

    it('updates description for PLATFORM_ADMIN', async () => {
      vi.mocked(globalDb.team.findUnique).mockResolvedValue(mockTeam() as never);
      vi.mocked(globalDb.team.update).mockResolvedValue({ ...mockTeam(), description: 'New desc' } as never);

      const result = await TeamService.updateTeam('team-1', { description: 'New desc' }, mockCtx('PLATFORM_ADMIN'));

      expect(result.description).toBe('New desc');
    });

    it('throws NotFoundError when team does not exist', async () => {
      vi.mocked(globalDb.team.findUnique).mockResolvedValue(null);

      await expect(
        TeamService.updateTeam('team-999', { name: 'X' }, mockCtx('PLATFORM_ADMIN'))
      ).rejects.toThrow(NotFoundError);
    });

    it('throws ForbiddenError for TENANT_ADMIN in different org', async () => {
      vi.mocked(globalDb.team.findUnique).mockResolvedValue(mockTeam({ organizationId: 'org-2' }) as never);

      await expect(
        TeamService.updateTeam('team-1', { name: 'X' }, mockCtx('TENANT_ADMIN', 'org-1'))
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ForbiddenError for MEMBER', async () => {
      await expect(
        TeamService.updateTeam('team-1', { name: 'X' }, mockCtx('MEMBER'))
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ValidationError for empty name', async () => {
      vi.mocked(globalDb.team.findUnique).mockResolvedValue(mockTeam() as never);

      await expect(
        TeamService.updateTeam('team-1', { name: '' }, mockCtx('PLATFORM_ADMIN'))
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('deleteTeam', () => {
    it('deletes empty team for PLATFORM_ADMIN', async () => {
      vi.mocked(globalDb.team.findUnique).mockResolvedValue(mockTeam({ _count: { members: 0 } }) as never);

      const result = await TeamService.deleteTeam('team-1', mockCtx('PLATFORM_ADMIN'));

      expect(result.success).toBe(true);
    });

    it('deletes non-empty team for PLATFORM_ADMIN', async () => {
      vi.mocked(globalDb.team.findUnique).mockResolvedValue(mockTeam({ _count: { members: 3 } }) as never);

      const result = await TeamService.deleteTeam('team-1', mockCtx('PLATFORM_ADMIN'));

      expect(result.success).toBe(true);
    });

    it('deletes empty team for TENANT_ADMIN in own org', async () => {
      vi.mocked(globalDb.team.findUnique).mockResolvedValue(mockTeam({ organizationId: 'org-1', _count: { members: 0 } }) as never);

      const result = await TeamService.deleteTeam('team-1', mockCtx('TENANT_ADMIN', 'org-1'));

      expect(result.success).toBe(true);
    });

    it('throws ConflictError for TENANT_ADMIN trying to delete non-empty team', async () => {
      vi.mocked(globalDb.team.findUnique).mockResolvedValue(mockTeam({ organizationId: 'org-1', _count: { members: 2 } }) as never);

      await expect(
        TeamService.deleteTeam('team-1', mockCtx('TENANT_ADMIN', 'org-1'))
      ).rejects.toThrow(ConflictError);
    });

    it('throws ForbiddenError for TENANT_ADMIN in different org', async () => {
      vi.mocked(globalDb.team.findUnique).mockResolvedValue(mockTeam({ organizationId: 'org-2', _count: { members: 0 } }) as never);

      await expect(
        TeamService.deleteTeam('team-1', mockCtx('TENANT_ADMIN', 'org-1'))
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ForbiddenError for MEMBER', async () => {
      await expect(
        TeamService.deleteTeam('team-1', mockCtx('MEMBER'))
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws NotFoundError when team does not exist', async () => {
      vi.mocked(globalDb.team.findUnique).mockResolvedValue(null);

      await expect(
        TeamService.deleteTeam('team-999', mockCtx('PLATFORM_ADMIN'))
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('addTeamMember', () => {
    it('adds member for PLATFORM_ADMIN with role inheritance', async () => {
      vi.mocked(globalDb.team.findUnique).mockResolvedValue(mockTeam() as never);
      vi.mocked(globalDb.member.findFirst).mockResolvedValue({ id: 'member-1' } as never);
      vi.mocked(globalDb.teamMember.findFirst).mockResolvedValue(null);
      vi.mocked(globalDb.$transaction).mockImplementation(async (fn) => {
        return mockTeam({ id: 'tm-1' });
      });

      const result = await TeamService.addTeamMember('team-1', { userId: 'user-2' }, mockCtx('PLATFORM_ADMIN'));

      expect(result).toBeDefined();
    });

    it('adds member for TENANT_ADMIN in own org', async () => {
      vi.mocked(globalDb.team.findUnique).mockResolvedValue(mockTeam({ organizationId: 'org-1' }) as never);
      vi.mocked(globalDb.member.findFirst).mockResolvedValue({ id: 'member-1' } as never);
      vi.mocked(globalDb.teamMember.findFirst).mockResolvedValue(null);
      vi.mocked(globalDb.$transaction).mockImplementation(async (fn) => {
        const tx = { team: globalDb.team, teamMember: globalDb.teamMember, teamRole: globalDb.teamRole, memberRole: globalDb.memberRole };
        return fn(tx as never);
      });

      const result = await TeamService.addTeamMember('team-1', { userId: 'user-2' }, mockCtx('TENANT_ADMIN', 'org-1'));

      expect(result).toBeDefined();
    });

    it('throws NotFoundError when team does not exist', async () => {
      vi.mocked(globalDb.team.findUnique).mockResolvedValue(null);

      await expect(
        TeamService.addTeamMember('team-999', { userId: 'user-2' }, mockCtx('PLATFORM_ADMIN'))
      ).rejects.toThrow(NotFoundError);
    });

    it('throws ValidationError when user is not an org member', async () => {
      vi.mocked(globalDb.team.findUnique).mockResolvedValue(mockTeam() as never);
      vi.mocked(globalDb.member.findFirst).mockResolvedValue(null);

      await expect(
        TeamService.addTeamMember('team-1', { userId: 'user-2' }, mockCtx('PLATFORM_ADMIN'))
      ).rejects.toThrow(ValidationError);
    });

    it('throws ConflictError when user is already a team member', async () => {
      vi.mocked(globalDb.team.findUnique).mockResolvedValue(mockTeam() as never);
      vi.mocked(globalDb.member.findFirst).mockResolvedValue({ id: 'member-1' } as never);
      vi.mocked(globalDb.teamMember.findFirst).mockResolvedValue({ id: 'existing-tm' } as never);

      await expect(
        TeamService.addTeamMember('team-1', { userId: 'user-2' }, mockCtx('PLATFORM_ADMIN'))
      ).rejects.toThrow(ConflictError);
    });

    it('throws ForbiddenError for TENANT_ADMIN in different org', async () => {
      vi.mocked(globalDb.team.findUnique).mockResolvedValue(mockTeam({ organizationId: 'org-2' }) as never);

      await expect(
        TeamService.addTeamMember('team-1', { userId: 'user-2' }, mockCtx('TENANT_ADMIN', 'org-1'))
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ForbiddenError for MEMBER', async () => {
      await expect(
        TeamService.addTeamMember('team-1', { userId: 'user-2' }, mockCtx('MEMBER'))
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('removeTeamMember', () => {
    it('removes member for PLATFORM_ADMIN with role revocation', async () => {
      vi.mocked(globalDb.team.findUnique).mockResolvedValue(mockTeam() as never);
      vi.mocked(globalDb.teamMember.findFirst).mockResolvedValue({ id: 'tm-1' } as never);
      vi.mocked(globalDb.member.findFirst).mockResolvedValue({ id: 'member-1' } as never);
      vi.mocked(globalDb.$transaction).mockImplementation(async (fn) => {
        const tx = { team: globalDb.team, teamMember: globalDb.teamMember, teamRole: globalDb.teamRole, memberRole: globalDb.memberRole };
        return fn(tx as never);
      });

      const result = await TeamService.removeTeamMember('team-1', 'user-2', mockCtx('PLATFORM_ADMIN'));

      expect(result.success).toBe(true);
    });

    it('removes member for TENANT_ADMIN in own org', async () => {
      vi.mocked(globalDb.team.findUnique).mockResolvedValue(mockTeam({ organizationId: 'org-1' }) as never);
      vi.mocked(globalDb.teamMember.findFirst).mockResolvedValue({ id: 'tm-1' } as never);
      vi.mocked(globalDb.member.findFirst).mockResolvedValue({ id: 'member-1' } as never);
      vi.mocked(globalDb.$transaction).mockImplementation(async (fn) => {
        const tx = { team: globalDb.team, teamMember: globalDb.teamMember, teamRole: globalDb.teamRole, memberRole: globalDb.memberRole };
        return fn(tx as never);
      });

      const result = await TeamService.removeTeamMember('team-1', 'user-2', mockCtx('TENANT_ADMIN', 'org-1'));

      expect(result.success).toBe(true);
    });

    it('throws NotFoundError when team does not exist', async () => {
      vi.mocked(globalDb.team.findUnique).mockResolvedValue(null);

      await expect(
        TeamService.removeTeamMember('team-999', 'user-2', mockCtx('PLATFORM_ADMIN'))
      ).rejects.toThrow(NotFoundError);
    });

    it('throws NotFoundError when user is not a team member', async () => {
      vi.mocked(globalDb.team.findUnique).mockResolvedValue(mockTeam() as never);
      vi.mocked(globalDb.teamMember.findFirst).mockResolvedValue(null);

      await expect(
        TeamService.removeTeamMember('team-1', 'user-999', mockCtx('PLATFORM_ADMIN'))
      ).rejects.toThrow(NotFoundError);
    });

    it('throws ForbiddenError for TENANT_ADMIN in different org', async () => {
      vi.mocked(globalDb.team.findUnique).mockResolvedValue(mockTeam({ organizationId: 'org-2' }) as never);

      await expect(
        TeamService.removeTeamMember('team-1', 'user-2', mockCtx('TENANT_ADMIN', 'org-1'))
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ForbiddenError for MEMBER', async () => {
      await expect(
        TeamService.removeTeamMember('team-1', 'user-2', mockCtx('MEMBER'))
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('listTeamMembers', () => {
    it('returns paginated members for PLATFORM_ADMIN', async () => {
      vi.mocked(globalDb.team.findUnique).mockResolvedValue(mockTeam() as never);
      vi.mocked(globalDb.teamMember.findMany).mockResolvedValue([]);
      vi.mocked(globalDb.teamMember.count).mockResolvedValue(0);

      const result = await TeamService.listTeamMembers('team-1', mockCtx('PLATFORM_ADMIN'), 1, 20);

      expect(result.members).toHaveLength(0);
    });

    it('returns paginated members for TENANT_ADMIN in own org', async () => {
      vi.mocked(globalDb.team.findUnique).mockResolvedValue(mockTeam({ organizationId: 'org-1' }) as never);
      vi.mocked(globalDb.teamMember.findMany).mockResolvedValue([]);
      vi.mocked(globalDb.teamMember.count).mockResolvedValue(0);

      const result = await TeamService.listTeamMembers('team-1', mockCtx('TENANT_ADMIN', 'org-1'), 1, 20);

      expect(result.pagination.total).toBe(0);
    });

    it('throws NotFoundError when team does not exist', async () => {
      vi.mocked(globalDb.team.findUnique).mockResolvedValue(null);

      await expect(
        TeamService.listTeamMembers('team-999', mockCtx('PLATFORM_ADMIN'))
      ).rejects.toThrow(NotFoundError);
    });

    it('throws ForbiddenError for TENANT_ADMIN in different org', async () => {
      vi.mocked(globalDb.team.findUnique).mockResolvedValue(mockTeam({ organizationId: 'org-2' }) as never);

      await expect(
        TeamService.listTeamMembers('team-1', mockCtx('TENANT_ADMIN', 'org-1'))
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ForbiddenError for MEMBER', async () => {
      await expect(
        TeamService.listTeamMembers('team-1', mockCtx('MEMBER'))
      ).rejects.toThrow(ForbiddenError);
    });

    it('includes roles in member response', async () => {
      vi.mocked(globalDb.team.findUnique).mockResolvedValue(mockTeam() as never);
      vi.mocked(globalDb.teamMember.findMany).mockResolvedValue([{
        id: 'tm-1', userId: 'user-2', user: { name: 'User Two', email: 'u2@test.com' }, createdAt: new Date(),
      }] as never);
      vi.mocked(globalDb.teamMember.count).mockResolvedValue(1);
      vi.mocked(globalDb.memberRole.findMany).mockResolvedValue([{
        role: { id: 'role-1', name: 'Viewer' },
      }] as never);

      const result = await TeamService.listTeamMembers('team-1', mockCtx('PLATFORM_ADMIN'));

      expect(result.members[0].roles).toHaveLength(1);
      expect(result.members[0].roles[0].name).toBe('Viewer');
    });
  });

  describe('assignTeamRole', () => {
    it('assigns role for PLATFORM_ADMIN', async () => {
      vi.mocked(globalDb.team.findUnique).mockResolvedValue(mockTeam() as never);
      vi.mocked(globalDb.role.findUnique).mockResolvedValue({ id: 'role-1', organizationId: 'org-1' } as never);
      vi.mocked(globalDb.teamRole.findFirst).mockResolvedValue(null);
      vi.mocked(globalDb.$transaction).mockImplementation(async (fn) => {
        const tx = { team: globalDb.team, teamMember: globalDb.teamMember, teamRole: globalDb.teamRole, memberRole: globalDb.memberRole };
        return fn(tx as never);
      });

      const result = await TeamService.assignTeamRole('team-1', { roleId: 'role-1' }, mockCtx('PLATFORM_ADMIN'));

      expect(result).toBeDefined();
    });

    it('assigns role for TENANT_ADMIN in own org', async () => {
      vi.mocked(globalDb.team.findUnique).mockResolvedValue(mockTeam({ organizationId: 'org-1' }) as never);
      vi.mocked(globalDb.role.findUnique).mockResolvedValue({ id: 'role-1', organizationId: 'org-1' } as never);
      vi.mocked(globalDb.teamRole.findFirst).mockResolvedValue(null);
      vi.mocked(globalDb.$transaction).mockImplementation(async (fn) => {
        const tx = { team: globalDb.team, teamMember: globalDb.teamMember, teamRole: globalDb.teamRole, memberRole: globalDb.memberRole };
        return fn(tx as never);
      });

      const result = await TeamService.assignTeamRole('team-1', { roleId: 'role-1' }, mockCtx('TENANT_ADMIN', 'org-1'));

      expect(result).toBeDefined();
    });

    it('throws NotFoundError when team does not exist', async () => {
      vi.mocked(globalDb.team.findUnique).mockResolvedValue(null);

      await expect(
        TeamService.assignTeamRole('team-999', { roleId: 'role-1' }, mockCtx('PLATFORM_ADMIN'))
      ).rejects.toThrow(NotFoundError);
    });

    it('throws NotFoundError when role does not exist', async () => {
      vi.mocked(globalDb.team.findUnique).mockResolvedValue(mockTeam() as never);
      vi.mocked(globalDb.role.findUnique).mockResolvedValue(null);

      await expect(
        TeamService.assignTeamRole('team-1', { roleId: 'role-999' }, mockCtx('PLATFORM_ADMIN'))
      ).rejects.toThrow(NotFoundError);
    });

    it('throws ValidationError when role belongs to different org', async () => {
      vi.mocked(globalDb.team.findUnique).mockResolvedValue(mockTeam({ organizationId: 'org-1' }) as never);
      vi.mocked(globalDb.role.findUnique).mockResolvedValue({ id: 'role-1', organizationId: 'org-2' } as never);

      await expect(
        TeamService.assignTeamRole('team-1', { roleId: 'role-1' }, mockCtx('PLATFORM_ADMIN'))
      ).rejects.toThrow(ValidationError);
    });

    it('throws ConflictError for duplicate role assignment', async () => {
      vi.mocked(globalDb.team.findUnique).mockResolvedValue(mockTeam() as never);
      vi.mocked(globalDb.role.findUnique).mockResolvedValue({ id: 'role-1', organizationId: 'org-1' } as never);
      vi.mocked(globalDb.teamRole.findFirst).mockResolvedValue({ id: 'existing-tr' } as never);

      await expect(
        TeamService.assignTeamRole('team-1', { roleId: 'role-1' }, mockCtx('PLATFORM_ADMIN'))
      ).rejects.toThrow(ConflictError);
    });

    it('throws ForbiddenError for TENANT_ADMIN in different org', async () => {
      vi.mocked(globalDb.team.findUnique).mockResolvedValue(mockTeam({ organizationId: 'org-2' }) as never);

      await expect(
        TeamService.assignTeamRole('team-1', { roleId: 'role-1' }, mockCtx('TENANT_ADMIN', 'org-1'))
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ForbiddenError for MEMBER', async () => {
      await expect(
        TeamService.assignTeamRole('team-1', { roleId: 'role-1' }, mockCtx('MEMBER'))
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('removeTeamRole', () => {
    it('removes role for PLATFORM_ADMIN', async () => {
      vi.mocked(globalDb.team.findUnique).mockResolvedValue(mockTeam() as never);
      vi.mocked(globalDb.teamRole.findFirst).mockResolvedValue({ id: 'tr-1' } as never);

      const result = await TeamService.removeTeamRole('team-1', 'role-1', mockCtx('PLATFORM_ADMIN'));

      expect(result.success).toBe(true);
    });

    it('removes role for TENANT_ADMIN in own org', async () => {
      vi.mocked(globalDb.team.findUnique).mockResolvedValue(mockTeam({ organizationId: 'org-1' }) as never);
      vi.mocked(globalDb.teamRole.findFirst).mockResolvedValue({ id: 'tr-1' } as never);

      const result = await TeamService.removeTeamRole('team-1', 'role-1', mockCtx('TENANT_ADMIN', 'org-1'));

      expect(result.success).toBe(true);
    });

    it('throws NotFoundError when team does not exist', async () => {
      vi.mocked(globalDb.team.findUnique).mockResolvedValue(null);

      await expect(
        TeamService.removeTeamRole('team-999', 'role-1', mockCtx('PLATFORM_ADMIN'))
      ).rejects.toThrow(NotFoundError);
    });

    it('throws NotFoundError when role is not assigned to team', async () => {
      vi.mocked(globalDb.team.findUnique).mockResolvedValue(mockTeam() as never);
      vi.mocked(globalDb.teamRole.findFirst).mockResolvedValue(null);

      await expect(
        TeamService.removeTeamRole('team-1', 'role-999', mockCtx('PLATFORM_ADMIN'))
      ).rejects.toThrow(NotFoundError);
    });

    it('throws ForbiddenError for TENANT_ADMIN in different org', async () => {
      vi.mocked(globalDb.team.findUnique).mockResolvedValue(mockTeam({ organizationId: 'org-2' }) as never);

      await expect(
        TeamService.removeTeamRole('team-1', 'role-1', mockCtx('TENANT_ADMIN', 'org-1'))
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ForbiddenError for MEMBER', async () => {
      await expect(
        TeamService.removeTeamRole('team-1', 'role-1', mockCtx('MEMBER'))
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getTeamRoles', () => {
    it('returns roles for PLATFORM_ADMIN', async () => {
      vi.mocked(globalDb.team.findUnique).mockResolvedValue(mockTeam() as never);
      vi.mocked(globalDb.teamRole.findMany).mockResolvedValue([
        { id: 'tr-1', role: { id: 'role-1', name: 'Viewer', description: null } },
      ] as never);

      const result = await TeamService.getTeamRoles('team-1', mockCtx('PLATFORM_ADMIN'));

      expect(result).toHaveLength(1);
    });

    it('returns roles for TENANT_ADMIN in own org', async () => {
      vi.mocked(globalDb.team.findUnique).mockResolvedValue(mockTeam({ organizationId: 'org-1' }) as never);
      vi.mocked(globalDb.teamRole.findMany).mockResolvedValue([]);

      const result = await TeamService.getTeamRoles('team-1', mockCtx('TENANT_ADMIN', 'org-1'));

      expect(result).toHaveLength(0);
    });

    it('throws NotFoundError when team does not exist', async () => {
      vi.mocked(globalDb.team.findUnique).mockResolvedValue(null);

      await expect(
        TeamService.getTeamRoles('team-999', mockCtx('PLATFORM_ADMIN'))
      ).rejects.toThrow(NotFoundError);
    });

    it('throws ForbiddenError for TENANT_ADMIN in different org', async () => {
      vi.mocked(globalDb.team.findUnique).mockResolvedValue(mockTeam({ organizationId: 'org-2' }) as never);

      await expect(
        TeamService.getTeamRoles('team-1', mockCtx('TENANT_ADMIN', 'org-1'))
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ForbiddenError for MEMBER', async () => {
      await expect(
        TeamService.getTeamRoles('team-1', mockCtx('MEMBER'))
      ).rejects.toThrow(ForbiddenError);
    });
  });
});
