/**
 * Unit tests for lib/org-default-team — default "Members" team auto-enrollment.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import globalDb from '@/lib/tenant-db';
import {
  enrollInDefaultMembersTeam,
  ensureDefaultMembersTeam,
  DEFAULT_MEMBERS_TEAM_SLUG,
} from '@/lib/org-default-team';

// Mock dependencies
vi.mock('@/lib/tenant-db', () => ({
  default: {
    team: { findFirst: vi.fn(), create: vi.fn() },
    teamMember: { findFirst: vi.fn(), create: vi.fn() },
    teamRole: { findMany: vi.fn() },
    memberRole: { findFirst: vi.fn(), create: vi.fn() },
    member: { findFirst: vi.fn() },
    organization: { findUnique: vi.fn() },
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('org-default-team', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('ensureDefaultMembersTeam', () => {
    it('returns the existing Members team without creating a new one', async () => {
      vi.mocked(globalDb.team.findFirst).mockResolvedValue({ id: 'existing-team', slug: 'members' } as never);

      const team = await ensureDefaultMembersTeam(globalDb, 'org-1');

      expect(team.id).toBe('existing-team');
      expect(globalDb.team.create).not.toHaveBeenCalled();
    });

    it('creates the default Members team for a legacy org when missing', async () => {
      vi.mocked(globalDb.team.findFirst).mockResolvedValue(null as never);
      vi.mocked(globalDb.organization.findUnique).mockResolvedValue({ name: 'Legacy Org' } as never);
      vi.mocked(globalDb.team.create).mockResolvedValue({ id: 'new-team', slug: 'members' } as never);

      const team = await ensureDefaultMembersTeam(globalDb, 'legacy-org');

      expect(team.id).toBe('new-team');
      expect(globalDb.team.create).toHaveBeenCalledWith({
        data: {
          name: 'Members',
          slug: DEFAULT_MEMBERS_TEAM_SLUG,
          description: 'All members of organization Legacy Org',
          organizationId: 'legacy-org',
        },
      });
    });
  });

  describe('enrollInDefaultMembersTeam', () => {
    it('creates a TeamMember row in the existing Members team', async () => {
      vi.mocked(globalDb.team.findFirst).mockResolvedValue({ id: 'members-team', slug: 'members' } as never);
      vi.mocked(globalDb.teamMember.findFirst).mockResolvedValue(null as never);
      vi.mocked(globalDb.teamMember.create).mockResolvedValue({ id: 'tm-1' } as never);
      // No TeamRoles bound to the default team
      vi.mocked(globalDb.teamRole.findMany).mockResolvedValue([] as never);

      await enrollInDefaultMembersTeam(globalDb, 'org-1', 'user-9');

      expect(globalDb.teamMember.create).toHaveBeenCalledWith({
        data: { userId: 'user-9', teamId: 'members-team', organizationId: 'org-1' },
      });
    });

    it('heals a missing Members team and then enrolls the user', async () => {
      vi.mocked(globalDb.team.findFirst).mockResolvedValue(null as never);
      vi.mocked(globalDb.organization.findUnique).mockResolvedValue({ name: 'Legacy Org' } as never);
      vi.mocked(globalDb.team.create).mockResolvedValue({ id: 'healed-team', slug: 'members' } as never);
      vi.mocked(globalDb.teamMember.findFirst).mockResolvedValue(null as never);
      vi.mocked(globalDb.teamMember.create).mockResolvedValue({ id: 'tm-1' } as never);
      vi.mocked(globalDb.teamRole.findMany).mockResolvedValue([] as never);

      await enrollInDefaultMembersTeam(globalDb, 'legacy-org', 'user-9');

      expect(globalDb.team.create).toHaveBeenCalledWith({
        data: {
          name: 'Members',
          slug: 'members',
          description: 'All members of organization Legacy Org',
          organizationId: 'legacy-org',
        },
      });
      expect(globalDb.teamMember.create).toHaveBeenCalledWith({
        data: { userId: 'user-9', teamId: 'healed-team', organizationId: 'legacy-org' },
      });
    });

    it('is a no-op when the user is already enrolled in the Members team', async () => {
      vi.mocked(globalDb.team.findFirst).mockResolvedValue({ id: 'members-team', slug: 'members' } as never);
      vi.mocked(globalDb.teamMember.findFirst).mockResolvedValue({ id: 'tm-existing' } as never);

      await enrollInDefaultMembersTeam(globalDb, 'org-1', 'user-9');

      expect(globalDb.teamMember.create).not.toHaveBeenCalled();
      expect(globalDb.memberRole.create).not.toHaveBeenCalled();
    });

    it('grants roles bound to the Members team via TeamRole (role inheritance)', async () => {
      vi.mocked(globalDb.team.findFirst).mockResolvedValue({ id: 'members-team', slug: 'members' } as never);
      vi.mocked(globalDb.teamMember.findFirst).mockResolvedValue(null as never);
      vi.mocked(globalDb.teamMember.create).mockResolvedValue({ id: 'tm-1' } as never);
      vi.mocked(globalDb.teamRole.findMany).mockResolvedValue([{ roleId: 'role-a' }] as never);
      vi.mocked(globalDb.member.findFirst).mockResolvedValue({ id: 'member-row' } as never);
      // memberRole.findFirst: first call "has role-a?" → null (grant it)
      vi.mocked(globalDb.memberRole.findFirst).mockResolvedValue(null as never);

      await enrollInDefaultMembersTeam(globalDb, 'org-1', 'user-9');

      expect(globalDb.memberRole.create).toHaveBeenCalledWith({
        data: { memberId: 'member-row', roleId: 'role-a', organizationId: 'org-1' },
      });
    });

    it('does not duplicate a role the member already holds', async () => {
      vi.mocked(globalDb.team.findFirst).mockResolvedValue({ id: 'members-team', slug: 'members' } as never);
      vi.mocked(globalDb.teamMember.findFirst).mockResolvedValue(null as never);
      vi.mocked(globalDb.teamMember.create).mockResolvedValue({ id: 'tm-1' } as never);
      vi.mocked(globalDb.teamRole.findMany).mockResolvedValue([{ roleId: 'role-a' }] as never);
      vi.mocked(globalDb.member.findFirst).mockResolvedValue({ id: 'member-row' } as never);
      // Member already holds role-a
      vi.mocked(globalDb.memberRole.findFirst).mockResolvedValue({ id: 'mr-existing' } as never);

      await enrollInDefaultMembersTeam(globalDb, 'org-1', 'user-9');

      expect(globalDb.memberRole.create).not.toHaveBeenCalled();
    });
  });
});
