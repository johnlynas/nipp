/**
 * Integration tests: Team membership — Add, list, remove members with role inheritance.
 *
 * RLS note: the app role is nipp_app, so fixture ops run through rlsFixture
 * (platform-admin GUCs bound per op) and membership mutations go through the
 * production path (TeamService) under a verified tenant context — see
 * tests/utils/rls-fixture.ts. Role inheritance on raw prisma.teamMember.create
 * is app-layer middleware in lib/db.ts that runs OUTSIDE the fixture's pinned
 * GUC connection, so it 42501s on sibling lookups; TeamService.addTeamMember
 * performs membership + role inheritance within a single bound transaction.
 */

import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { TeamService } from '@/services/team-service';
import type { ServiceContext } from '@/lib/services/types';
import { rlsFixture, withTenantAccess } from '@/tests/utils/rls-fixture';

describe('Team Membership Integration', () => {
  let testOrgId: string;
  let teamId: string;

  // Platform-scoped fixture handle (org CREATE needs the platform GUC).
  const platform = rlsFixture(null);
  // Org-scoped fixture handle for everything below.
  const db = () => rlsFixture(testOrgId);

  const adminCtx = (): ServiceContext => ({ userId: 'fixture-admin', role: 'TENANT_ADMIN', organizationId: testOrgId });

  beforeEach(async () => {
    // Create a test organization (platform GUC — Organization INSERT is platform-only).
    const org = await platform.organization.create({
      data: { name: 'Test Membership Org', slug: `test-memb-org-${Date.now()}`, status: 'ACTIVE' },
    });
    testOrgId = org.id;

    // Create default "Members" team
    await db().team.create({ data: { name: 'Members', slug: 'members', organizationId: testOrgId } });

    // Create a functional team for membership tests
    const team = await db().team.create({ data: { name: 'Test Team', organizationId: testOrgId } });
    teamId = team.id;

    // Create a role for the org (for role inheritance tests)
    await db().role.create({ data: { name: 'Test Role', organizationId: testOrgId } });
  });

  afterAll(async () => {
    // Cleanup test orgs by slug prefix — members/teams are DB-cascaded from
    // the org row; resolve platform-scoped and delete each under its own
    // target-org context (Organization UPDATE/DELETE policy).
    const orgs = await platform.organization.findMany({ where: { slug: { startsWith: 'test-memb-org-' } } });
    for (const org of orgs) {
      await rlsFixture(org.id).organization.delete({ where: { id: org.id } });
    }
  });

  async function addMember(teamIdArg: string, userCreator: { name: string; email: string }) {
    const user = await platform.user.create({ data: { ...userCreator, emailVerified: true } });
    await db().member.create({ data: { userId: user.id, orgId: testOrgId } });
    return withTenantAccess(testOrgId, false, () => TeamService.addTeamMember(teamIdArg, { userId: user.id }, adminCtx()));
  }

  it('should add a user to a team', async () => {
    const teamMember = await addMember(teamId, { name: 'Team Member', email: `member-${Date.now()}@test.com` });

    expect(teamMember.teamId).toBe(teamId);
    expect(teamMember.userId).toBeDefined();

    // Cleanup
    await db().teamMember.delete({ where: { id: teamMember.id } });
  });

  it('should list members of a team', async () => {
    const user1 = await platform.user.create({ data: { name: 'Member 1', email: `m1-${Date.now()}@test.com`, emailVerified: true } });
    const user2 = await platform.user.create({ data: { name: 'Member 2', email: `m2-${Date.now()}@test.com`, emailVerified: true } });

    await db().member.create({ data: { userId: user1.id, orgId: testOrgId } });
    await db().member.create({ data: { userId: user2.id, orgId: testOrgId } });

    await withTenantAccess(testOrgId, false, () => TeamService.addTeamMember(teamId, { userId: user1.id }, adminCtx()));
    await withTenantAccess(testOrgId, false, () => TeamService.addTeamMember(teamId, { userId: user2.id }, adminCtx()));

    const members = await db().teamMember.findMany({ where: { teamId } });
    expect(members.length).toBe(2);

    // Cleanup
    await db().teamMember.deleteMany({ where: { teamId } });
  });

  it('should remove a member from a team', async () => {
    const user = await platform.user.create({ data: { name: 'Remove Me', email: `remove-${Date.now()}@test.com`, emailVerified: true } });
    await db().member.create({ data: { userId: user.id, orgId: testOrgId } });

    const teamMember = await withTenantAccess(testOrgId, false, () => TeamService.addTeamMember(teamId, { userId: user.id }, adminCtx()));

    await db().teamMember.delete({ where: { id: teamMember.id } });

    const remaining = await db().teamMember.findMany({ where: { teamId, userId: user.id } });
    expect(remaining).toHaveLength(0);
  });

  it('should enforce unique [userId, teamId] constraint', async () => {
    const user = await platform.user.create({ data: { name: 'Dup User', email: `dup-${Date.now()}@test.com`, emailVerified: true } });
    await db().member.create({ data: { userId: user.id, orgId: testOrgId } });

    await withTenantAccess(testOrgId, false, () => TeamService.addTeamMember(teamId, { userId: user.id }, adminCtx()));

    await expect(
      withTenantAccess(testOrgId, false, () => TeamService.addTeamMember(teamId, { userId: user.id }, adminCtx()))
    ).rejects.toThrow();

    // Cleanup
    await db().teamMember.deleteMany({ where: { teamId, userId: user.id } });
  });

  it('should assign a role to a team', async () => {
    const role = await db().role.findFirst({ where: { organizationId: testOrgId } });
    expect(role).toBeDefined();

    const teamRole = await withTenantAccess(testOrgId, false, () => TeamService.assignTeamRole(teamId, { roleId: role!.id }, adminCtx()));

    expect((teamRole as { teamId?: string }).teamId).toBe(teamId);

    // Cleanup
    const stored = await db().teamRole.findFirst({ where: { teamId, roleId: role!.id } });
    if (stored) await db().teamRole.delete({ where: { id: stored.id } });
  });

  it('should list roles assigned to a team', async () => {
    const role = await db().role.findFirst({ where: { organizationId: testOrgId } });
    expect(role).toBeDefined();

    await withTenantAccess(testOrgId, false, () => TeamService.assignTeamRole(teamId, { roleId: role!.id }, adminCtx()));

    const roles = await db().teamRole.findMany({ where: { teamId } });
    expect(roles.length).toBeGreaterThanOrEqual(1);

    // Cleanup
    await db().teamRole.deleteMany({ where: { teamId } });
  });

  it('should remove a role from a team', async () => {
    const role = await db().role.findFirst({ where: { organizationId: testOrgId } });
    expect(role).toBeDefined();

    await withTenantAccess(testOrgId, false, () => TeamService.assignTeamRole(teamId, { roleId: role!.id }, adminCtx()));

    const stored = await db().teamRole.findFirst({ where: { teamId, roleId: role!.id } });
    expect(stored).not.toBeNull();
    await db().teamRole.delete({ where: { id: stored!.id } });

    const remaining = await db().teamRole.findMany({ where: { teamId, roleId: role!.id } });
    expect(remaining).toHaveLength(0);
  });

  it('should enforce unique [teamId, roleId] constraint', async () => {
    const role = await db().role.findFirst({ where: { organizationId: testOrgId } });
    expect(role).toBeDefined();

    await withTenantAccess(testOrgId, false, () => TeamService.assignTeamRole(teamId, { roleId: role!.id }, adminCtx()));

    // A duplicate assignment is rejected by the service (already assigned) —
    // the DB unique constraint backstops it.
    await expect(
      withTenantAccess(testOrgId, false, () => TeamService.assignTeamRole(teamId, { roleId: role!.id }, adminCtx()))
    ).rejects.toThrow();

    // Cleanup
    await db().teamRole.deleteMany({ where: { teamId } });
  });

  it('should cascade delete TeamMember when Team is deleted', async () => {
    const team = await db().team.create({ data: { name: 'Cascade TM Team', organizationId: testOrgId } });
    const user = await platform.user.create({ data: { name: 'Cascade User', email: `cascade-${Date.now()}@test.com`, emailVerified: true } });
    await db().member.create({ data: { userId: user.id, orgId: testOrgId } });

    await withTenantAccess(testOrgId, false, () => TeamService.addTeamMember(team.id, { userId: user.id }, adminCtx()));

    await db().team.delete({ where: { id: team.id } });

    const remaining = await db().teamMember.findMany({ where: { teamId: team.id } });
    expect(remaining).toHaveLength(0);
  });

  it('should cascade delete TeamRole when Team is deleted', async () => {
    const role = await db().role.findFirst({ where: { organizationId: testOrgId } });
    expect(role).toBeDefined();

    const team = await db().team.create({ data: { name: 'Cascade TR Team', organizationId: testOrgId } });
    await withTenantAccess(testOrgId, false, () => TeamService.assignTeamRole(team.id, { roleId: role!.id }, adminCtx()));

    await db().team.delete({ where: { id: team.id } });

    const remaining = await db().teamRole.findMany({ where: { teamId: team.id } });
    expect(remaining).toHaveLength(0);
  });

  it('should support team membership with role inheritance', async () => {
    const role = await db().role.findFirst({ where: { organizationId: testOrgId } });
    expect(role).toBeDefined();

    // Assign role to team
    await withTenantAccess(testOrgId, false, () => TeamService.assignTeamRole(teamId, { roleId: role!.id }, adminCtx()));

    // Create user and add to team (production path — inherits the team's roles)
    const user = await platform.user.create({ data: { name: 'Inherited User', email: `inherited-${Date.now()}@test.com`, emailVerified: true } });
    const member = await db().member.create({ data: { userId: user.id, orgId: testOrgId } });

    await withTenantAccess(testOrgId, false, () => TeamService.addTeamMember(teamId, { userId: user.id }, adminCtx()));

    // Verify role inheritance — member should have the team's roles
    const inheritedRoles = await db().memberRole.findMany({ where: { memberId: member.id } });
    expect(inheritedRoles.length).toBeGreaterThanOrEqual(1);
    expect(inheritedRoles.some((r) => r.roleId === role!.id)).toBe(true);

    // Cleanup
    await db().teamMember.deleteMany({ where: { teamId } });
  });

  it('should verify cross-org team isolation', async () => {
    // Create a second organization (platform GUC)
    const org2 = await platform.organization.create({
      data: { name: 'Other Org', slug: `other-org-${Date.now()}`, status: 'ACTIVE' },
    });

    // Create a team in the other org
    const otherTeam = await rlsFixture(org2.id).team.create({ data: { name: 'Other Team', organizationId: org2.id } });

    // Verify the team is NOT visible in the test org
    const teamsInTestOrg = await db().team.findMany({ where: { organizationId: testOrgId } });
    const otherTeamInTest = teamsInTestOrg.find(t => t.id === otherTeam.id);
    expect(otherTeamInTest).toBeUndefined();

    // Cleanup (each org under its own target context — RLS qual binds the txn to it)
    await rlsFixture(org2.id).team.deleteMany({ where: { organizationId: org2.id } });
    await rlsFixture(org2.id).organization.delete({ where: { id: org2.id } });
  });
});
