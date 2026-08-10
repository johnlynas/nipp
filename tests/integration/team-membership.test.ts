/**
 * Integration tests: Team membership — Add, list, remove members with role inheritance.
 */

import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';

describe('Team Membership Integration', () => {
  let testOrgId: string;
  let teamId: string;

  afterAll(async () => {
    // Cleanup test org and all related data (cascade)
    await prisma.team.deleteMany({ where: { organizationId: testOrgId } });
    await prisma.organization.deleteMany({ where: { id: testOrgId } });
  });

  beforeEach(async () => {
    // Create a test organization
    const org = await prisma.organization.create({
      data: { name: 'Test Membership Org', slug: `test-memb-org-${Date.now()}`, status: 'ACTIVE' },
    });
    testOrgId = org.id;

    // Create default "Members" team
    await prisma.team.create({ data: { name: 'Members', slug: 'members', organizationId: testOrgId } });

    // Create a functional team for membership tests
    const team = await prisma.team.create({ data: { name: 'Test Team', organizationId: testOrgId } });
    teamId = team.id;

    // Create a role for the org (for role inheritance tests)
    await prisma.role.create({ data: { name: 'Test Role', organizationId: testOrgId } });
  });

  it('should add a user to a team', async () => {
    const user = await prisma.user.create({ data: { name: 'Team Member', email: `member-${Date.now()}@test.com`, emailVerified: true } });
    const member = await prisma.member.create({ data: { userId: user.id, orgId: testOrgId } });

    const teamMember = await prisma.teamMember.create({
      data: { teamId, userId: user.id, organizationId: testOrgId },
    });

    expect(teamMember.teamId).toBe(teamId);
    expect(teamMember.userId).toBe(user.id);

    // Cleanup
    await prisma.teamMember.delete({ where: { id: teamMember.id } });
  });

  it('should list members of a team', async () => {
    const user1 = await prisma.user.create({ data: { name: 'Member 1', email: `m1-${Date.now()}@test.com`, emailVerified: true } });
    const user2 = await prisma.user.create({ data: { name: 'Member 2', email: `m2-${Date.now()}@test.com`, emailVerified: true } });

    await prisma.member.create({ data: { userId: user1.id, orgId: testOrgId } });
    await prisma.member.create({ data: { userId: user2.id, orgId: testOrgId } });

    await prisma.teamMember.create({ data: { teamId, userId: user1.id, organizationId: testOrgId } });
    await prisma.teamMember.create({ data: { teamId, userId: user2.id, organizationId: testOrgId } });

    const members = await prisma.teamMember.findMany({ where: { teamId } });
    expect(members.length).toBe(2);

    // Cleanup
    await prisma.teamMember.deleteMany({ where: { teamId } });
  });

  it('should remove a member from a team', async () => {
    const user = await prisma.user.create({ data: { name: 'Remove Me', email: `remove-${Date.now()}@test.com`, emailVerified: true } });
    await prisma.member.create({ data: { userId: user.id, orgId: testOrgId } });

    const teamMember = await prisma.teamMember.create({
      data: { teamId, userId: user.id, organizationId: testOrgId },
    });

    await prisma.teamMember.delete({ where: { id: teamMember.id } });

    const remaining = await prisma.teamMember.findMany({ where: { teamId, userId: user.id } });
    expect(remaining).toHaveLength(0);
  });

  it('should enforce unique [userId, teamId] constraint', async () => {
    const user = await prisma.user.create({ data: { name: 'Dup User', email: `dup-${Date.now()}@test.com`, emailVerified: true } });
    await prisma.member.create({ data: { userId: user.id, orgId: testOrgId } });

    await prisma.teamMember.create({ data: { teamId, userId: user.id, organizationId: testOrgId } });

    await expect(
      prisma.teamMember.create({ data: { teamId, userId: user.id, organizationId: testOrgId } })
    ).rejects.toThrow();

    // Cleanup
    await prisma.teamMember.deleteMany({ where: { teamId, userId: user.id } });
  });

  it('should assign a role to a team', async () => {
    const role = await prisma.role.findFirst({ where: { organizationId: testOrgId } });
    expect(role).toBeDefined();

    const teamRole = await prisma.teamRole.create({
      data: { teamId, roleId: role!.id, organizationId: testOrgId },
    });

    expect(teamRole.teamId).toBe(teamId);
    expect(teamRole.roleId).toBe(role!.id);

    // Cleanup
    await prisma.teamRole.delete({ where: { id: teamRole.id } });
  });

  it('should list roles assigned to a team', async () => {
    const role = await prisma.role.findFirst({ where: { organizationId: testOrgId } });
    expect(role).toBeDefined();

    await prisma.teamRole.create({ data: { teamId, roleId: role!.id, organizationId: testOrgId } });

    const roles = await prisma.teamRole.findMany({ where: { teamId } });
    expect(roles.length).toBeGreaterThanOrEqual(1);

    // Cleanup
    await prisma.teamRole.deleteMany({ where: { teamId } });
  });

  it('should remove a role from a team', async () => {
    const role = await prisma.role.findFirst({ where: { organizationId: testOrgId } });
    expect(role).toBeDefined();

    const teamRole = await prisma.teamRole.create({ data: { teamId, roleId: role!.id, organizationId: testOrgId } });

    await prisma.teamRole.delete({ where: { id: teamRole.id } });

    const remaining = await prisma.teamRole.findMany({ where: { teamId, roleId: role!.id } });
    expect(remaining).toHaveLength(0);
  });

  it('should enforce unique [teamId, roleId] constraint', async () => {
    const role = await prisma.role.findFirst({ where: { organizationId: testOrgId } });
    expect(role).toBeDefined();

    await prisma.teamRole.create({ data: { teamId, roleId: role!.id, organizationId: testOrgId } });

    await expect(
      prisma.teamRole.create({ data: { teamId, roleId: role!.id, organizationId: testOrgId } })
    ).rejects.toThrow();

    // Cleanup
    await prisma.teamRole.deleteMany({ where: { teamId } });
  });

  it('should cascade delete TeamMember when Team is deleted', async () => {
    const user = await prisma.user.create({ data: { name: 'Cascade User', email: `cascade-${Date.now()}@test.com`, emailVerified: true } });
    await prisma.member.create({ data: { userId: user.id, orgId: testOrgId } });

    await prisma.teamMember.create({ data: { teamId, userId: user.id, organizationId: testOrgId } });

    await prisma.team.delete({ where: { id: teamId } });

    const remaining = await prisma.teamMember.findMany({ where: { teamId } });
    expect(remaining).toHaveLength(0);
  });

  it('should cascade delete TeamRole when Team is deleted', async () => {
    const role = await prisma.role.findFirst({ where: { organizationId: testOrgId } });
    expect(role).toBeDefined();

    await prisma.teamRole.create({ data: { teamId, roleId: role!.id, organizationId: testOrgId } });

    await prisma.team.delete({ where: { id: teamId } });

    const remaining = await prisma.teamRole.findMany({ where: { teamId } });
    expect(remaining).toHaveLength(0);
  });

  it('should support team membership with role inheritance', async () => {
    const role = await prisma.role.findFirst({ where: { organizationId: testOrgId } });
    expect(role).toBeDefined();

    // Assign role to team
    await prisma.teamRole.create({ data: { teamId, roleId: role!.id, organizationId: testOrgId } });

    // Create user and add to team
    const user = await prisma.user.create({ data: { name: 'Inherited User', email: `inherited-${Date.now()}@test.com`, emailVerified: true } });
    const member = await prisma.member.create({ data: { userId: user.id, orgId: testOrgId } });

    await prisma.teamMember.create({ data: { teamId, userId: user.id, organizationId: testOrgId } });

    // Verify role inheritance — member should have the team's roles
    const inheritedRoles = await prisma.memberRole.findMany({ where: { memberId: member.id } });
    expect(inheritedRoles.length).toBeGreaterThanOrEqual(1);

    // Cleanup
    await prisma.teamMember.deleteMany({ where: { teamId } });
  });

  it('should verify cross-org team isolation', async () => {
    // Create a second organization
    const org2 = await prisma.organization.create({
      data: { name: 'Other Org', slug: `other-org-${Date.now()}`, status: 'ACTIVE' },
    });

    // Create a team in the other org
    const otherTeam = await prisma.team.create({ data: { name: 'Other Team', organizationId: org2.id } });

    // Verify the team is NOT visible in the test org
    const teamsInTestOrg = await prisma.team.findMany({ where: { organizationId: testOrgId } });
    const otherTeamInTest = teamsInTestOrg.find(t => t.id === otherTeam.id);
    expect(otherTeamInTest).toBeUndefined();

    // Cleanup
    await prisma.team.deleteMany({ where: { organizationId: org2.id } });
    await prisma.organization.deleteMany({ where: { id: org2.id } });
  });
});
