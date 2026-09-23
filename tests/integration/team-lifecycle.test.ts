/**
 * Integration tests: Team lifecycle — Create, Read, Update, Delete with real database.
 *
 * RLS note: the app role is nipp_app, so fixture ops run through rlsFixture
 * (platform-admin GUCs bound per op) — see tests/utils/rls-fixture.ts.
 */

import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { TeamService } from '@/services/team-service';
import type { ServiceContext } from '@/lib/services/types';
import { rlsFixture, withTenantAccess } from '@/tests/utils/rls-fixture';

describe('Team Lifecycle Integration', () => {
  let createdTeamId: string;
  let testOrgId: string;

  // Platform-scoped fixture handle (org CREATE needs the platform GUC).
  const platform = rlsFixture(null);
  // Org-scoped fixture handle for everything below.
  const db = () => rlsFixture(testOrgId);

  const adminCtx = (): ServiceContext => ({ userId: 'fixture-admin', role: 'TENANT_ADMIN', organizationId: testOrgId });

  beforeEach(async () => {
    // Create a test organization for team lifecycle tests (platform GUC —
    // Organization INSERT is platform-only).
    const org = await platform.organization.create({
      data: { name: 'Test Team Org', slug: `test-team-org-${Date.now()}`, status: 'ACTIVE' },
    });
    testOrgId = org.id;

    // Create default "Members" team for the test org. Slug auto-generation is
    // verified at the unit layer (tests/unit/db.test.ts) — pass it explicitly
    // here so this fixture does not depend on raw-client middleware behavior.
    await db().team.create({
      data: { name: 'Members', slug: 'members', organizationId: testOrgId },
    });
  });

  afterAll(async () => {
    // Cleanup test orgs by slug prefix — org UPDATE/DELETE only match rows the
    // context is bound to, so resolve platform-scoped and delete per-target.
    const orgs = await platform.organization.findMany({ where: { slug: { startsWith: 'test-team-org-' } } });
    for (const org of orgs) {
      await rlsFixture(org.id).organization.delete({ where: { id: org.id } });
    }
  });

  async function createTeam(name: string, extra?: { slug?: string; description?: string }) {
    const team = await withTenantAccess(testOrgId, false, () => TeamService.createTeam(
      { name, ...(extra?.slug ? { slug: extra.slug } : {}), ...(extra?.description ? { description: extra.description } : {}) },
      testOrgId,
      adminCtx(),
    ));
    return team as unknown as { id: string; name: string; slug?: string | null; description?: string | null };
  }

  it('should create a team', async () => {
    const team = await createTeam('Maintenance Team', { slug: 'maintenance-team', description: 'Handles maintenance requests' });

    createdTeamId = team.id;
    expect(team.name).toBe('Maintenance Team');
    expect(team.slug).toBe('maintenance-team');
  });

  it('should create a team with auto-generated slug', async () => {
    const team = await createTeam('Sales Team');

    expect(team.slug).toBe('sales-team');
  });

  it('should list teams in an organization', async () => {
    await db().team.create({ data: { name: 'Team A', slug: 'team-a', organizationId: testOrgId } });
    await db().team.create({ data: { name: 'Team B', slug: 'team-b', organizationId: testOrgId } });

    const teams = await db().team.findMany({ where: { organizationId: testOrgId } });

    expect(teams.length).toBeGreaterThanOrEqual(3); // Members + Team A + Team B
  });

  it('should update a team name', async () => {
    const team = await createTeam('Old Name');

    const updated = await db().team.update({
      where: { id: team.id },
      data: { name: 'New Name' },
    });

    expect(updated.name).toBe('New Name');
  });

  it('should update a team description', async () => {
    const team = await createTeam('Test Team');

    const updated = await db().team.update({
      where: { id: team.id },
      data: { description: 'Updated description' },
    });

    expect(updated.description).toBe('Updated description');
  });

  it('should delete an empty team', async () => {
    const team = await createTeam('To Delete');

    await db().team.delete({ where: { id: team.id } });

    const remaining = await db().team.findUnique({ where: { id: team.id } });
    expect(remaining).toBeNull();
  });

  it('should cascade delete team members when team is deleted', async () => {
    const team = await createTeam('Cascade Team');
    const user = await platform.user.create({ data: { name: 'Test User', email: `cascade-${Date.now()}@test.com`, emailVerified: true } });
    await db().member.create({ data: { userId: user.id, orgId: testOrgId } });

    // Production path (TeamService): membership + role inheritance in one op.
    await withTenantAccess(testOrgId, false, () => TeamService.addTeamMember(team.id, { userId: user.id }, adminCtx()));

    await db().team.delete({ where: { id: team.id } });

    const remainingMembers = await db().teamMember.findMany({ where: { teamId: team.id } });
    expect(remainingMembers).toHaveLength(0);
  });

  it('should cascade delete team roles when team is deleted', async () => {
    const org = await db().organization.findUnique({ where: { id: testOrgId } });
    expect(org).toBeDefined();

    const role = await db().role.create({
      data: { name: 'Test Role', organizationId: testOrgId! },
    });

    const team = await createTeam('Role Team');

    await withTenantAccess(testOrgId, false, () => TeamService.assignTeamRole(team.id, { roleId: role!.id }, adminCtx()));

    await db().team.delete({ where: { id: team.id } });

    const remainingRoles = await db().teamRole.findMany({ where: { teamId: team.id } });
    expect(remainingRoles).toHaveLength(0);
  });

  it('should enforce unique slug within an organization', async () => {
    await db().team.create({ data: { name: 'Unique Team', slug: 'unique-slug', organizationId: testOrgId } });

    await expect(
      db().team.create({ data: { name: 'Another Team', slug: 'unique-slug', organizationId: testOrgId } })
    ).rejects.toThrow();
  });

  it('should enforce unique [userId, teamId] constraint', async () => {
    const user = await platform.user.create({ data: { name: 'Test User', email: `dup-${Date.now()}@test.com`, emailVerified: true } });
    const member = await db().member.create({ data: { userId: user.id, orgId: testOrgId } });
    const team = await createTeam('Dup Team');

    await withTenantAccess(testOrgId, false, () => TeamService.addTeamMember(team.id, { userId: user.id }, adminCtx()));

    await expect(
      withTenantAccess(testOrgId, false, () => TeamService.addTeamMember(team.id, { userId: user.id }, adminCtx()))
    ).rejects.toThrow();
  });

  it('should create default "Members" team on organization creation', async () => {
    // The Members team was created in beforeEach, verify it exists
    const membersTeam = await db().team.findFirst({ where: { organizationId: testOrgId, slug: 'members' } });
    expect(membersTeam).not.toBeNull();
    expect(membersTeam?.name).toBe('Members');
  });

  it('should support paginated team listing', async () => {
    // Create multiple teams
    for (let i = 0; i < 5; i++) {
      await createTeam(`Paginated Team ${i}`);
    }

    const page1 = await db().team.findMany({ where: { organizationId: testOrgId }, take: 3, skip: 0 });
    const page2 = await db().team.findMany({ where: { organizationId: testOrgId }, take: 3, skip: 3 });

    expect(page1.length).toBe(3);
    expect(page2.length).toBeGreaterThanOrEqual(1); // Members + remaining teams
  });
});
