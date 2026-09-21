/**
 * TeamService — Business logic for team CRUD, membership management, and role inheritance.
 *
 * Follows the established service layer pattern:
 * - Input types for all operations
 * - Authorization guards (requirePlatformAdmin, requireAnyAdmin)
 * - Typed error classes (ValidationError, NotFoundError, ConflictError, ForbiddenError)
 * - Audit logging for all mutations
 *
 * RLS plan Phase 3 (kill the unscoped bypass):
 * All queries run through tenantDb. Operations on a specific org are wrapped in
 * runWithTenant(targetOrgId) so the Prisma extension resolves a context; per-ID
 * lookups without an explicit target fall back to the caller's ctx org — with
 * the env-derived platform org as the last-resort context for super-admin paths.
 */

import { Prisma } from '@prisma/client';
import tenantDb from '@/lib/tenant-db';
import { runWithTenant } from '@/lib/tenant-context';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { recordAuditLog } from '@/lib/audit-log';
import { ServiceContext, ValidationError, NotFoundError, ConflictError, ForbiddenError } from '@/lib/services/types';
import { requireAnyAdmin, logFailedAuth } from '@/lib/services/base-service';
import { normalizePagination } from '@/lib/services/types';

// ---------------------------------------------------------------------------
// Input / Output Types
// ---------------------------------------------------------------------------

export interface CreateTeamInput {
  name: string;
  slug?: string;
  description?: string;
}

export interface UpdateTeamInput {
  name?: string;
  description?: string;
}

export interface AddTeamMemberInput {
  userId: string;
}

export interface AssignTeamRoleInput {
  roleId: string;
}

/** Team data returned by service methods. */
export interface TeamData {
  id: string;
  name: string;
  slug: string | null;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  organizationId: string;
}

/** Team with members and roles included. */
export interface TeamWithDetails extends TeamData {
  members: {
    id: string;
    userId: string;
    user: { name: string; email: string };
    createdAt: Date;
  }[];
  roles: {
    id: string;
    name: string;
    description: string | null;
  }[];
}

/** Paginated team list. */
export interface PaginatedTeams {
  teams: TeamData[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

/** Paginated team members list. */
export interface PaginatedTeamMembers {
  members: TeamWithDetails['members'] & { roles: { id: string; name: string }[] }[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Context org for a service call: caller's org, platform org as fallback. */
function contextOrgId(ctx: ServiceContext): string {
  return ctx.organizationId ?? env.PLATFORM_ORGANIZATION_ID!;
}

/**
 * Generate a URL-friendly slug from a team name.
 */
function generateSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * Attempt to create a team with unique slug (retry on collision).
 */
async function createWithUniqueSlug(
  tx: Prisma.TransactionClient,
  organizationId: string,
  name: string,
  baseSlug: string,
  description?: string,
) {
  try {
    return await tx.team.create({
      data: { name, slug: baseSlug, description, organizationId },
    });
  } catch (error: unknown) {
    if ((error as { code?: string }).code !== 'P2002') throw error;
  }

  // Slug collision — retry with suffix
  for (let suffix = 1; suffix <= 100; suffix++) {
    try {
      return await tx.team.create({
        data: { name, slug: `${baseSlug}-${suffix}`, description, organizationId },
      });
    } catch (err: unknown) {
      if ((err as { code?: string }).code !== 'P2002') throw err;
    }
  }

  throw new Error('Unable to generate unique slug');
}

/**
 * Assign all team roles to a member (role inheritance).
 */
async function assignTeamRolesToMember(
  tx: Prisma.TransactionClient,
  memberId: string,
  teamId: string,
  organizationId: string,
): Promise<void> {
  const teamRoles = await tx.teamRole.findMany({
    where: { teamId, organizationId },
    select: { roleId: true },
  });

  for (const tr of teamRoles) {
    // Check if member already has this role to avoid duplicates
    const existing = await tx.memberRole.findFirst({
      where: { memberId, roleId: tr.roleId },
    });

    if (!existing) {
      await tx.memberRole.create({
        data: {
          memberId,
          roleId: tr.roleId,
          organizationId,
        },
      });
    }
  }
}

/**
 * Revoke team-inherited roles from a member.
 * Preserves org-level roles that were not assigned via this team.
 */
async function revokeTeamRolesFromMember(
  tx: Prisma.TransactionClient,
  memberId: string,
  teamId: string,
  organizationId: string,
): Promise<void> {
  const teamRoles = await tx.teamRole.findMany({
    where: { teamId, organizationId },
    select: { roleId: true },
  });

  for (const tr of teamRoles) {
    await tx.memberRole.deleteMany({
      where: { memberId, roleId: tr.roleId },
    });
  }
}

// ---------------------------------------------------------------------------
// Service singleton — full CRUD with authorization
// ---------------------------------------------------------------------------

/**
 * Service responsible for managing Team business logic.
 * Decouples API routes from direct Prisma database operations.
 */
export const TeamService = {
  /**
   * Create a new team within an organization.
   * Platform Admin: any org. Tenant Admin: own org only.
   */
  async createTeam(input: CreateTeamInput, organizationId: string, ctx: ServiceContext) {
    requireAnyAdmin(ctx);

    // Tenant Admin can only create in their own org
    if (ctx.role === 'TENANT_ADMIN') {
      if (organizationId !== ctx.organizationId) {
        logFailedAuth(ctx, 'createTeam');
        throw new ForbiddenError('Cannot create teams outside your organization');
      }
    }

    // Validate name length
    if (!input.name || input.name.trim().length === 0) {
      throw new ValidationError('Team name is required');
    }
    if (input.name.length > 100) {
      throw new ValidationError('Team name must be at most 100 characters');
    }

    const slug = input.slug || generateSlug(input.name);

    return runWithTenant(organizationId, async () =>
      tenantDb.$transaction(async (tx) => {
        const team = await createWithUniqueSlug(tx, organizationId, input.name, slug, input.description);

        logger.info(
          { teamId: team.id, orgId: organizationId, method: 'TeamService.createTeam' },
          'Team created',
        );

        // Audit log
        await recordAuditLog({
          userId: ctx.userId,
          action: 'team.created',
          resourceType: 'Team',
          resourceId: team.id,
          organizationId,
          success: true,
          metadata: { name: team.name },
        });

        return team;
      }),
    );
  },

  /**
   * Retrieve a single team by ID with its members and assigned roles.
   * Platform Admin: any org. Tenant Admin: own org only.
   */
  async getTeamById(teamId: string, ctx: ServiceContext) {
    requireAnyAdmin(ctx);

    const team = await runWithTenant(contextOrgId(ctx), () =>
      tenantDb.team.findUnique({
        where: { id: teamId },
        include: {
          members: {
            select: {
              id: true,
              userId: true,
              user: { select: { name: true, email: true } },
              createdAt: true,
            },
          },
        },
      }),
    );

    if (!team) {
      throw new NotFoundError('Team not found');
    }

    // Fetch roles separately to avoid type issues with nested includes
    const teamRoles = await runWithTenant(team.organizationId, () =>
      tenantDb.teamRole.findMany({
        where: { teamId },
        include: {
          role: { select: { id: true, name: true, description: true } },
        },
      }),
    );

    const teamWithDetails = {
      ...team,
      roles: teamRoles.map((tr) => ({
        id: tr.role.id,
        name: tr.role.name,
        description: tr.role.description,
      })),
    };

    // Tenant Admin can only read teams in their own org
    if (ctx.role === 'TENANT_ADMIN') {
      if (team.organizationId !== ctx.organizationId) {
        logFailedAuth(ctx, 'getTeamById');
        throw new ForbiddenError('Cannot access teams outside your organization');
      }
    }

    return teamWithDetails;
  },

  /**
   * List all teams in an organization (paginated).
   * Platform Admin: any org. Tenant Admin: own org only.
   */
  async getTeamsByOrg(organizationId: string, ctx: ServiceContext, page = 1, pageSize = 20) {
    requireAnyAdmin(ctx);

    // Tenant Admin can only list teams in their own org
    if (ctx.role === 'TENANT_ADMIN') {
      if (organizationId !== ctx.organizationId) {
        logFailedAuth(ctx, 'getTeamsByOrg');
        throw new ForbiddenError('Cannot access teams outside your organization');
      }
    }

    const { page: normalizedPage, pageSize: normalizedPageSize } = normalizePagination({ page, pageSize });
    const skip = (normalizedPage - 1) * normalizedPageSize;

    return runWithTenant(organizationId, async () => {
      const [teams, total] = await Promise.all([
        tenantDb.team.findMany({
          where: { organizationId },
          skip,
          take: normalizedPageSize,
          orderBy: { name: 'asc' },
          include: {
            _count: { select: { members: true } },
          },
        }),
        tenantDb.team.count({ where: { organizationId } }),
      ]);

      return {
        teams: teams.map(({ id, name, slug, description, createdAt, updatedAt, organizationId: orgId, _count }) => ({
          id, name, slug, description, createdAt, updatedAt, organizationId: orgId,
          _count: { members: _count.members },
        })),
        pagination: {
          page: normalizedPage,
          pageSize: normalizedPageSize,
          total,
          totalPages: Math.ceil(total / normalizedPageSize),
        },
      };
    });
  },

  /**
   * Update a team's name or description.
   * Platform Admin: any org. Tenant Admin: own org only (slug immutable).
   */
  async updateTeam(teamId: string, input: UpdateTeamInput, ctx: ServiceContext) {
    requireAnyAdmin(ctx);

    // Verify team exists first and get its org
    const existingTeam = await runWithTenant(contextOrgId(ctx), () =>
      tenantDb.team.findUnique({ where: { id: teamId } }),
    );
    if (!existingTeam) {
      throw new NotFoundError('Team not found');
    }

    // Tenant Admin can only update teams in their own org
    if (ctx.role === 'TENANT_ADMIN') {
      if (existingTeam.organizationId !== ctx.organizationId) {
        logFailedAuth(ctx, 'updateTeam');
        throw new ForbiddenError('Cannot update teams outside your organization');
      }
    }

    // Build update data — only include provided fields
    const updateData: Prisma.TeamUpdateInput = {};
    if (input.name !== undefined) {
      if (input.name.trim().length === 0) {
        throw new ValidationError('Team name cannot be empty');
      }
      if (input.name.length > 100) {
        throw new ValidationError('Team name must be at most 100 characters');
      }
      updateData.name = input.name;
    }
    if (input.description !== undefined) {
      updateData.description = input.description;
    }

    const updatedTeam = await runWithTenant(existingTeam.organizationId, () =>
      tenantDb.team.update({
        where: { id: teamId },
        data: updateData,
      }),
    );

    logger.info(
      { userId: ctx.userId, teamId, method: 'TeamService.updateTeam' },
      'Team updated',
    );

    // Audit log
    await recordAuditLog({
      userId: ctx.userId,
      action: 'team.updated',
      resourceType: 'Team',
      resourceId: teamId,
      organizationId: existingTeam.organizationId,
      success: true,
    });

    return updatedTeam;
  },

  /**
   * Delete a team. Must be empty (no members) or platform admin can force delete.
   * Platform Admin only for non-empty teams; Tenant Admin can delete empty teams in their org.
   */
  async deleteTeam(teamId: string, ctx: ServiceContext) {
    requireAnyAdmin(ctx);

    const team = await runWithTenant(contextOrgId(ctx), () =>
      tenantDb.team.findUnique({
        where: { id: teamId },
        include: { _count: { select: { members: true } } },
      }),
    );

    if (!team) {
      throw new NotFoundError('Team not found');
    }

    // Tenant Admin can only delete teams in their own org
    if (ctx.role === 'TENANT_ADMIN') {
      if (team.organizationId !== ctx.organizationId) {
        logFailedAuth(ctx, 'deleteTeam');
        throw new ForbiddenError('Cannot delete teams outside your organization');
      }

      // Tenant Admin can only delete empty teams
      if (team._count.members > 0) {
        throw new ConflictError('Cannot delete team with existing members. Remove all members first.');
      }
    }

    // Platform Admin can delete any team (including non-empty)
    await runWithTenant(team.organizationId, () => tenantDb.team.delete({ where: { id: teamId } }));

    logger.info(
      { userId: ctx.userId, teamId, method: 'TeamService.deleteTeam' },
      'Team deleted',
    );

    // Audit log
    await recordAuditLog({
      userId: ctx.userId,
      action: 'team.deleted',
      resourceType: 'Team',
      resourceId: teamId,
      organizationId: team.organizationId,
      success: true,
    });

    return { success: true };
  },

  /**
   * Add a user to a team. User must be an org member first.
   * Automatically assigns all team roles via MemberRole junction (role inheritance).
   */
  async addTeamMember(teamId: string, input: AddTeamMemberInput, ctx: ServiceContext) {
    requireAnyAdmin(ctx);

    // Wrap the whole operation under one org context (the team's org once known;
    // the per-ID lookups use the caller/platform fallback below).
    const team = await runWithTenant(contextOrgId(ctx), () =>
      tenantDb.team.findUnique({ where: { id: teamId } }),
    );
    if (!team) {
      throw new NotFoundError('Team not found');
    }

    // Tenant Admin can only add members to teams in their own org
    if (ctx.role === 'TENANT_ADMIN') {
      if (team.organizationId !== ctx.organizationId) {
        logFailedAuth(ctx, 'addTeamMember');
        throw new ForbiddenError('Cannot add members to teams outside your organization');
      }
    }

    return runWithTenant(team.organizationId, async () => {
      // Verify user is a member of the same organization
      const member = await tenantDb.member.findFirst({
        where: { userId: input.userId, orgId: team.organizationId },
      });

      if (!member) {
        throw new ValidationError('User is not a member of this organization');
      }

      // Check if already a team member (unique constraint on [userId, teamId])
      const existing = await tenantDb.teamMember.findFirst({
        where: { userId: input.userId, teamId },
      });

      if (existing) {
        throw new ConflictError('User is already a member of this team');
      }

      return tenantDb.$transaction(async (tx) => {
        // Create team membership
        const teamMember = await tx.teamMember.create({
          data: {
            userId: input.userId,
            teamId,
            organizationId: team.organizationId,
          },
        });

        // Assign all team roles (role inheritance)
        await assignTeamRolesToMember(tx, member.id, teamId, team.organizationId);

        logger.info(
          { userId: input.userId, teamId, method: 'TeamService.addTeamMember' },
          'User added to team with role inheritance',
        );

        // Audit log
        await recordAuditLog({
          userId: ctx.userId,
          action: 'team.member_added',
          resourceType: 'TeamMember',
          resourceId: teamMember.id,
          organizationId: team.organizationId,
          success: true,
          metadata: { userId: input.userId, teamName: team.name },
        });

        return teamMember;
      });
    });
  },

  /**
   * Remove a user from a team. Revokes team-inherited roles; preserves org-level roles.
   */
  async removeTeamMember(teamId: string, userId: string, ctx: ServiceContext) {
    requireAnyAdmin(ctx);

    // Verify team exists and get its org
    const team = await runWithTenant(contextOrgId(ctx), () =>
      tenantDb.team.findUnique({ where: { id: teamId } }),
    );
    if (!team) {
      throw new NotFoundError('Team not found');
    }

    // Tenant Admin can only remove members from teams in their own org
    if (ctx.role === 'TENANT_ADMIN') {
      if (team.organizationId !== ctx.organizationId) {
        logFailedAuth(ctx, 'removeTeamMember');
        throw new ForbiddenError('Cannot remove members from teams outside your organization');
      }
    }

    return runWithTenant(team.organizationId, async () => {
      // Find the team member record
      const teamMember = await tenantDb.teamMember.findFirst({
        where: { userId, teamId },
      });

      if (!teamMember) {
        throw new NotFoundError('User is not a member of this team');
      }

      // Find the corresponding Member record for role revocation
      const member = await tenantDb.member.findFirst({
        where: { userId, orgId: team.organizationId },
      });

      return tenantDb.$transaction(async (tx) => {
        // Revoke team-inherited roles first
        if (member) {
          await revokeTeamRolesFromMember(tx, member.id, teamId, team.organizationId);
        }

        // Remove team membership
        await tx.teamMember.delete({ where: { id: teamMember.id } });

        logger.info(
          { userId, teamId, method: 'TeamService.removeTeamMember' },
          'User removed from team with role revocation',
        );

        // Audit log
        await recordAuditLog({
          userId: ctx.userId,
          action: 'team.member_removed',
          resourceType: 'TeamMember',
          resourceId: teamMember.id,
          organizationId: team.organizationId,
          success: true,
          metadata: { userId },
        });

        return { success: true };
      });
    });
  },

  /**
   * List all members of a team with their roles.
   */
  async listTeamMembers(teamId: string, ctx: ServiceContext, page = 1, pageSize = 20) {
    requireAnyAdmin(ctx);

    const team = await runWithTenant(contextOrgId(ctx), () =>
      tenantDb.team.findUnique({ where: { id: teamId } }),
    );
    if (!team) {
      throw new NotFoundError('Team not found');
    }

    // Tenant Admin can only list members of teams in their own org
    if (ctx.role === 'TENANT_ADMIN') {
      if (team.organizationId !== ctx.organizationId) {
        logFailedAuth(ctx, 'listTeamMembers');
        throw new ForbiddenError('Cannot access team members outside your organization');
      }
    }

    return runWithTenant(team.organizationId, async () => {
      const { page: normalizedPage, pageSize: normalizedPageSize } = normalizePagination({ page, pageSize });
      const skip = (normalizedPage - 1) * normalizedPageSize;

      // Get team members with their roles
      const [members, total] = await Promise.all([
        tenantDb.teamMember.findMany({
          where: { teamId },
          skip,
          take: normalizedPageSize,
          include: {
            user: { select: { name: true, email: true } },
          },
        }),
        tenantDb.teamMember.count({ where: { teamId } }),
      ]);

      // Fetch roles for each member separately to avoid type issues with nested includes
      const membersWithRoles = await Promise.all(
        members.map(async (tm) => {
          const memberRoles = await tenantDb.memberRole.findMany({
            where: { memberId: tm.id },
            include: { role: { select: { id: true, name: true } } },
          });
          return {
            id: tm.id,
            userId: tm.userId,
            user: tm.user,
            createdAt: tm.createdAt,
            roles: memberRoles.map((mr) => ({ id: mr.role.id, name: mr.role.name })),
          };
        }),
      );

      return {
        members: membersWithRoles,
        pagination: {
          page: normalizedPage,
          pageSize: normalizedPageSize,
          total,
          totalPages: Math.ceil(total / normalizedPageSize),
        },
      };
    });
  },

  /**
   * Assign an organization role to a team (creates TeamRole record).
   * Platform Admin: any org. Tenant Admin: own org only.
   */
  async assignTeamRole(teamId: string, input: AssignTeamRoleInput, ctx: ServiceContext) {
    requireAnyAdmin(ctx);

    // Verify team exists and get its org
    const team = await runWithTenant(contextOrgId(ctx), () =>
      tenantDb.team.findUnique({ where: { id: teamId } }),
    );
    if (!team) {
      throw new NotFoundError('Team not found');
    }

    // Tenant Admin can only assign roles to teams in their own org
    if (ctx.role === 'TENANT_ADMIN') {
      if (team.organizationId !== ctx.organizationId) {
        logFailedAuth(ctx, 'assignTeamRole');
        throw new ForbiddenError('Cannot assign roles to teams outside your organization');
      }
    }

    return runWithTenant(team.organizationId, async () => {
      // Verify role belongs to the same organization
      const role = await tenantDb.role.findUnique({ where: { id: input.roleId } });
      if (!role) {
        throw new NotFoundError('Role not found');
      }
      if (role.organizationId !== team.organizationId) {
        throw new ValidationError('Role must belong to the same organization as the team');
      }

      return tenantDb.$transaction(async (tx) => {
        // Check for duplicate assignment
        const existing = await tx.teamRole.findFirst({
          where: { teamId, roleId: input.roleId },
        });

        if (existing) {
          throw new ConflictError('Role is already assigned to this team');
        }

        const teamRole = await tx.teamRole.create({
          data: {
            teamId,
            roleId: input.roleId,
            organizationId: team.organizationId,
          },
        });

        logger.info(
          { teamId, roleId: input.roleId, method: 'TeamService.assignTeamRole' },
          'Role assigned to team',
        );

        // Audit log
        await recordAuditLog({
          userId: ctx.userId,
          action: 'team.role_assigned',
          resourceType: 'TeamRole',
          resourceId: teamRole.id,
          organizationId: team.organizationId,
          success: true,
          metadata: { roleId: input.roleId },
        });

        return teamRole;
      });
    });
  },

  /**
   * Remove a role assignment from a team.
   */
  async removeTeamRole(teamId: string, roleId: string, ctx: ServiceContext) {
    requireAnyAdmin(ctx);

    // Verify team exists and get its org
    const team = await runWithTenant(contextOrgId(ctx), () =>
      tenantDb.team.findUnique({ where: { id: teamId } }),
    );
    if (!team) {
      throw new NotFoundError('Team not found');
    }

    // Tenant Admin can only remove roles from teams in their own org
    if (ctx.role === 'TENANT_ADMIN') {
      if (team.organizationId !== ctx.organizationId) {
        logFailedAuth(ctx, 'removeTeamRole');
        throw new ForbiddenError('Cannot remove roles from teams outside your organization');
      }
    }

    return runWithTenant(team.organizationId, async () => {
      // Find the TeamRole record
      const teamRole = await tenantDb.teamRole.findFirst({
        where: { teamId, roleId },
      });

      if (!teamRole) {
        throw new NotFoundError('Role is not assigned to this team');
      }

      await tenantDb.teamRole.delete({ where: { id: teamRole.id } });

      logger.info(
        { teamId, roleId, method: 'TeamService.removeTeamRole' },
        'Role removed from team',
      );

      // Audit log
      await recordAuditLog({
        userId: ctx.userId,
        action: 'team.role_removed',
        resourceType: 'TeamRole',
        resourceId: teamRole.id,
        organizationId: team.organizationId,
        success: true,
      });

      return { success: true };
    });
  },

  /**
   * List all roles assigned to a team.
   */
  async getTeamRoles(teamId: string, ctx: ServiceContext) {
    requireAnyAdmin(ctx);

    const team = await runWithTenant(contextOrgId(ctx), () =>
      tenantDb.team.findUnique({ where: { id: teamId } }),
    );
    if (!team) {
      throw new NotFoundError('Team not found');
    }

    // Tenant Admin can only list roles for teams in their own org
    if (ctx.role === 'TENANT_ADMIN') {
      if (team.organizationId !== ctx.organizationId) {
        logFailedAuth(ctx, 'getTeamRoles');
        throw new ForbiddenError('Cannot access team roles outside your organization');
      }
    }

    const roles = await runWithTenant(team.organizationId, () =>
      tenantDb.teamRole.findMany({
        where: { teamId },
        select: {
          id: true,
          role: { select: { id: true, name: true, description: true } },
        },
      }),
    );

    return roles.map((tr) => ({
      id: tr.id,
      roleId: tr.role.id,
      name: tr.role.name,
      description: tr.role.description,
    }));
  },
};
