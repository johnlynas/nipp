/**
 * Default "Members" team auto-enrollment (betterauth-teams-integration).
 *
 * Every organization has a default team with slug `members` ("Members").
 * Whenever a user becomes part of an organization (Member row created), they
 * are automatically added to that org's Members team. This helper is shared by
 * all membership-creation paths:
 *   - services/user-service.ts          (admin-created users)
 *   - services/organization-service.ts  (org bootstrap admin)
 *   - app/api/admin/organizations/[orgId]/members/route.ts (super admin add member)
 *   - lib/org-bootstrap.ts              (BetterAuth org-creation flow)
 *
 * Behavior:
 *   - Idempotent: an existing Members team is reused; an existing TeamMember
 *     row is left alone.
 *   - Self-healing: legacy orgs created before the Teams feature get their
 *     default Members team created on first enrollment.
 *   - Role inheritance: any roles bound to the Members team via TeamRole are
 *     granted to the new member (same rule as TeamService.addTeamMember).
 *
 * The caller must pass a client that already carries the correct tenant/RLS
 * context — an interactive-transaction client from runWithTenant /
 * withTenantAdminContext. Explicit organizationId values are written on every
 * row, matching the RLS WITH CHECK policies for Team/TeamMember/TeamRole.
 */

import { Prisma } from '@prisma/client';
import { logger } from '@/lib/logger';

/** Canonical slug of the default team every org gets. */
export const DEFAULT_MEMBERS_TEAM_SLUG = 'members';
const DEFAULT_MEMBERS_TEAM_NAME = 'Members';

type ScopeClient = Prisma.TransactionClient;

/**
 * Ensure the organization's default "Members" team exists and return it.
 * Creates it (idempotently) when missing — legacy orgs are healed on first use.
 */
export async function ensureDefaultMembersTeam(
  db: ScopeClient,
  organizationId: string,
): Promise<{ id: string; slug: string | null }> {
  const existing = await db.team.findFirst({
    where: { organizationId, slug: DEFAULT_MEMBERS_TEAM_SLUG },
    select: { id: true, slug: true },
  });

  if (existing) {
    return existing;
  }

  // Unique per org ([organizationId, slug]) and we just proved no row exists.
  const created = await db.team.create({
    data: {
      name: DEFAULT_MEMBERS_TEAM_NAME,
      slug: DEFAULT_MEMBERS_TEAM_SLUG,
      organizationId,
    },
  });

  logger.info(
    { orgId: organizationId, teamId: created.id, method: 'ensureDefaultMembersTeam' },
    'Created default Members team',
  );

  return { id: created.id, slug: created.slug ?? DEFAULT_MEMBERS_TEAM_SLUG };
}

/**
 * Grant all roles bound to the team to the member (role inheritance),
 * skipping roles the member already holds. Mirrors TeamService behavior.
 */
async function assignTeamRolesToMember(
  db: ScopeClient,
  memberId: string,
  teamId: string,
  organizationId: string,
): Promise<void> {
  const teamRoles = await db.teamRole.findMany({
    where: { teamId, organizationId },
    select: { roleId: true },
  });

  for (const teamRole of teamRoles) {
    const existing = await db.memberRole.findFirst({
      where: { memberId, roleId: teamRole.roleId },
    });
    if (!existing) {
      await db.memberRole.create({
        data: { memberId, roleId: teamRole.roleId, organizationId },
      });
    }
  }
}

/**
 * Add a user to their organization's default "Members" team.
 * No-op when the user is already enrolled; self-heals missing teams.
 */
export async function enrollInDefaultMembersTeam(
  db: ScopeClient,
  organizationId: string,
  userId: string,
): Promise<void> {
  const team = await ensureDefaultMembersTeam(db, organizationId);

  const existingMembership = await db.teamMember.findFirst({
    where: { userId, teamId: team.id },
    select: { id: true },
  });

  if (existingMembership) {
    return; // Already a member of this team — nothing to do.
  }

  await db.teamMember.create({ data: { userId, teamId: team.id, organizationId } });

  logger.info(
    { userId, orgId: organizationId, teamId: team.id, method: 'enrollInDefaultMembersTeam' },
    'User auto-enrolled in the org default Members team',
  );

  // Role inheritance (the Members team normally carries no TeamRoles; this is
  // kept for parity with TeamService.addTeamMember so the invariant survives
  // anyone binding roles to the default team).
  const member = await db.member.findFirst({
    where: { userId, orgId: organizationId },
    select: { id: true },
  });

  if (member) {
    await assignTeamRolesToMember(db, member.id, team.id, organizationId);
  }
}
