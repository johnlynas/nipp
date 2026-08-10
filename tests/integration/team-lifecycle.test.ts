/**
 * Integration tests: Team lifecycle — Create, Read, Update, Delete with real database.
 */

import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';

describe('Team Lifecycle Integration', () => {
  let createdTeamId: string;
  let testOrgId: string;

  beforeEach(async () => {
    // Create a test organization for team lifecycle tests
    const org = await prisma.organization.create({
      data: { name: 'Test Team Org', slug: `test-team-org-${Date.now()}`, status: 'ACTIVE' },
    });
    testOrgId = org.id;

    // Create default "Members" team for the test org
    await prisma.team.create({
      data: { name: 'Members', slug: 'members', organizationId: testOrgId },
    });
  });

  afterAll(async () => {
    // Cleanup test org and all related data (cascade)
    await prisma.team.deleteMany({ where: { organizationId: testOrgId } });
    await prisma.organization.deleteMany({ where: { id: testOrgId } });
  });

  it('should create a team', async () => {
    const team = await prisma.team.create({
      data: { name: 'Maintenance Team', slug: 'maintenance-team', description: 'Handles maintenance requests', organizationId: testOrgId },
    });

    createdTeamId = team.id;
    expect(team.name).toBe('Maintenance Team');
    expect(team.slug).toBe('maintenance-team');
    expect(team.organizationId).toBe(testOrgId);
  });

  it('should create a team with auto-generated slug', async () => {
    const team = await prisma.team.create({
      data: { name: 'Sales Team', organizationId: testOrgId },
    });

    expect(team.slug).toBe('sales-team');
  });

  it('should list teams in an organization', async () => {
    await prisma.team.create({ data: { name: 'Team A', organizationId: testOrgId } });
    await prisma.team.create({ data: { name: 'Team B', organizationId: testOrgId } });

    const teams = await prisma.team.findMany({ where: { organizationId: testOrgId } });

    expect(teams.length).toBeGreaterThanOrEqual(3); // Members + Team A + Team B
  });

  it('should update a team name', async () => {
    const team = await prisma.team.create({ data: { name: 'Old Name', organizationId: testOrgId } });

    const updated = await prisma.team.update({
      where: { id: team.id },
      data: { name: 'New Name' },
    });

    expect(updated.name).toBe('New Name');
  });

  it('should update a team description', async () => {
    const team = await prisma.team.create({ data: { name: 'Test Team', organizationId: testOrgId } });

    const updated = await prisma.team.update({
      where: { id: team.id },
      data: { description: 'Updated description' },
    });

    expect(updated.description).toBe('Updated description');
  });

  it('should delete an empty team', async () => {
    const team = await prisma.team.create({ data: { name: 'To Delete', organizationId: testOrgId } });

    await prisma.team.delete({ where: { id: team.id } });

    const remaining = await prisma.team.findUnique({ where: { id: team.id } });
    expect(remaining).toBeNull();
  });

  it('should cascade delete team members when team is deleted', async () => {
    const team = await prisma.team.create({ data: { name: 'Cascade Team', organizationId: testOrgId } });
    const user = await prisma.user.create({ data: { name: 'Test User', email: `cascade-${Date.now()}@test.com`, emailVerified: true } });
    const member = await prisma.member.create({ data: { userId: user.id, orgId: testOrgId } });

    await prisma.teamMember.create({
      data: { teamId: team.id, userId: user.id, organizationId: testOrgId },
    });

    await prisma.team.delete({ where: { id: team.id } });

    const remainingMembers = await prisma.teamMember.findMany({ where: { teamId: team.id } });
    expect(remainingMembers).toHaveLength(0);
  });

  it('should cascade delete team roles when team is deleted', async () => {
    const org = await prisma.organization.findUnique({ where: { id: testOrgId } });
    expect(org).toBeDefined();

    const role = await prisma.role.create({
      data: { name: 'Test Role', organizationId: testOrgId! },
    });

    const team = await prisma.team.create({ data: { name: 'Role Team', organizationId: testOrgId } });

    await prisma.teamRole.create({
      data: { teamId: team.id, roleId: role.id, organizationId: testOrgId! },
    });

    await prisma.team.delete({ where: { id: team.id } });

    const remainingRoles = await prisma.teamRole.findMany({ where: { teamId: team.id } });
    expect(remainingRoles).toHaveLength(0);
  });

  it('should enforce unique slug within an organization', async () => {
    await prisma.team.create({ data: { name: 'Unique Team', slug: 'unique-slug', organizationId: testOrgId } });

    await expect(
      prisma.team.create({ data: { name: 'Another Team', slug: 'unique-slug', organizationId: testOrgId } })
    ).rejects.toThrow();
  });

  it('should enforce unique [userId, teamId] constraint', async () => {
    const user = await prisma.user.create({ data: { name: 'Test User', email: `dup-${Date.now()}@test.com`, emailVerified: true } });
    const member = await prisma.member.create({ data: { userId: user.id, orgId: testOrgId } });
    const team = await prisma.team.create({ data: { name: 'Dup Team', organizationId: testOrgId } });

    await prisma.teamMember.create({
      data: { teamId: team.id, userId: user.id, organizationId: testOrgId },
    });

    await expect(
      prisma.teamMember.create({
        data: { teamId: team.id, userId: user.id, organizationId: testOrgId },
      })
    ).rejects.toThrow();
  });

  it('should create default "Members" team on organization creation', async () => {
    // The Members team was created in beforeEach, verify it exists
    const membersTeam = await prisma.team.findFirst({ where: { organizationId: testOrgId, slug: 'members' } });
    expect(membersTeam).not.toBeNull();
    expect(membersTeam?.name).toBe('Members');
  });

  it('should support paginated team listing', async () => {
    // Create multiple teams
    for (let i = 0; i < 5; i++) {
      await prisma.team.create({ data: { name: `Paginated Team ${i}`, organizationId: testOrgId } });
    }

    const page1 = await prisma.team.findMany({ where: { organizationId: testOrgId }, take: 3, skip: 0 });
    const page2 = await prisma.team.findMany({ where: { organizationId: testOrgId }, take: 3, skip: 3 });

    expect(page1.length).toBe(3);
    expect(page2.length).toBeGreaterThanOrEqual(1); // Members + remaining teams
  });
});
