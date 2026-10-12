/**
 * UserService — Full CRUD for the User model.
 *
 * Model locality: Global (non-org-scoped). Uses tenantDb for all queries.
 * Tenant Admin access is enforced by filtering through the Member join table
 * (i.e., a Tenant Admin can only see/manage users who are members of their org).
 */

import { Prisma } from '@prisma/client';
// RLS plan Phase 3: tenantDb (unscoped bypass) removed — org-scoped models go
// through tenantDb; Member/TeamMember calls are wrapped in runWithTenant so the
// Prisma extension's tenant scoping resolves a context. User/Account are global
// (non-org-scoped) and need no wrapper.
import tenantDb from '@/lib/tenant-db';
import { runWithTenant } from '@/lib/tenant-context';
import { logger } from '@/lib/logger';
import { ServiceContext, NotFoundError, ForbiddenError, ValidationError } from '@/lib/services/types';
import { env } from '@/lib/env';
import { requireAnyAdmin, logFailedAuth } from '@/lib/services/base-service';
import { normalizePagination, PaginatedResult, UserFilters } from '@/lib/services/types';
import { hashPassword } from 'better-auth/crypto';
import { enrollInDefaultMembersTeam } from '@/lib/org-default-team';
import { TeamService } from './team-service';

// ---------------------------------------------------------------------------
// Input Types
// ---------------------------------------------------------------------------

export interface CreateUserInput {
  email: string;
  name: string;
  password?: string;
  organizationId?: string;
  /**
   * Optional ADDITIONAL team to enroll the user in, on top of the org's
   * default "Members" team (which is ALWAYS attached at creation). Must belong
   * to the target org — enforced here, so a cross-org teamId is rejected before
   * any rows are written.
   */
  teamId?: string;
}

export interface UpdateUserInput {
  name?: string;
  email?: string;
}

// ---------------------------------------------------------------------------
// Service singleton
// ---------------------------------------------------------------------------

export const UserService = {
  /**
   * Create a new user.
   * Platform Admin: global creation. Tenant Admin: create + add to own org via Member join.
   */
  async create(data: CreateUserInput, ctx: ServiceContext) {
    requireAnyAdmin(ctx);

    const { email, name, password } = data;

    // Validate required fields
    if (!email) {
      throw new ValidationError('Email is required');
    }
    if (!name) {
      throw new ValidationError('Name is required');
    }

    // Check for duplicate email
    const existing = await tenantDb.user.findUnique({ where: { email } });
    if (existing) {
      throw new Error('A user with this email already exists');
    }

    // The organization the user is being created for. TENANT_ADMIN always
    // knows it from ctx; PLATFORM_ADMIN passes it explicitly. Without it the
    // user has no workspace (access denied on every page) and no isolation
    // boundary — so pin activeOrganizationId at create time (the session hook in
    // lib/auth.ts only backfills on first sign-in).
    const orgForUser =
      ctx.role === 'TENANT_ADMIN'
        ? ctx.organizationId
        : data.organizationId ?? null;

    // INVARIANT (isolation boundary, local AND Google users): EVERY user is
    // created INTO an organization — a user without one sees nothing and
    // therefore must not exist. Reject before any rows are written. The Members
    // team auto-enrollment below gives the user their default team (the canonical
    // "all members of this org" reporting surface); a chosen specific team is
    // additional to it, and teams carry 1:M roles for permission refinement.
    if (!orgForUser) {
      throw new ValidationError(
        'Organization is required — every user must belong to an organization (local password and Google accounts alike) at creation',
      );
    }

    // A requested team must belong to the same organization as the membership
    // being created — checked BEFORE any rows are written (cross-org teamId
    // attack surface stays closed, per plan risk #2).
    let targetTeam: { id: string; organizationId: string } | null = null;
    if (data.teamId) {
      targetTeam = await runWithTenant(orgForUser, () =>
        tenantDb.team.findUnique({ where: { id: data.teamId! }, select: { id: true, organizationId: true } }),
      );
      if (!targetTeam) {
        throw new ValidationError('Team not found');
      }
      if (targetTeam.organizationId !== orgForUser) {
        throw new ValidationError('The selected team does not belong to the selected organization');
      }
    }

    // Build user data — include passwordHash if provided
    const userData: { email: string; name: string; passwordHash?: string; activeOrganizationId?: string | null } = {
      email,
      name,
    };

    let passwordHash: string | undefined;
    if (password) {
      passwordHash = await hashPassword(password);
      userData.passwordHash = passwordHash;
    }

    if (orgForUser) {
      userData.activeOrganizationId = orgForUser;
    }

    const user = await tenantDb.user.create({
      data: userData,
    });

    // Create credential account so Better Auth sign-in works
    if (passwordHash) {
      await tenantDb.account.create({
        data: { id: user.id, accountId: user.id, providerId: 'credential', password: passwordHash, userId: user.id },
      });
    }

    // One membership path for both roles: TENANT_ADMIN creates a Member row
    // for their own org, PLATFORM_ADMIN for the explicitly targeted org.
    const addMembership = async (organizationId: string) => {
      // Member row first — TeamService.addTeamMember requires it.
      await runWithTenant(organizationId, () =>
        tenantDb.member.create({
          data: { userId: user.id, orgId: organizationId, role: 'member' },
        }),
      );

      // INVARIANT: every user joins the org's default "Members" team on
      // creation (idempotent, self-heals legacy orgs missing the team). This is
      // the canonical reporting surface for all members of an organization.
      await runWithTenant(organizationId, () =>
        enrollInDefaultMembersTeam(tenantDb, organizationId, user.id),
      );

      if (targetTeam) {
        // An additional specific team on TOP of the Members default (admin chose
        // one on the create form); addTeamMember re-verifies the Member row plus
        // applies TeamRole inheritance. Pin the (already cross-checked) org on
        // the ctx so its internal contextOrgId fallback never reaches for an
        // unset platform-org env in edge cases.
        await TeamService.addTeamMember(targetTeam.id, { userId: user.id }, {
          ...ctx,
          organizationId: targetTeam.organizationId,
        });
      }
    };

    await addMembership(orgForUser);

    logger.info(
      { userId: ctx.userId, createdUserId: user.id, method: 'UserService.create' },
      'User created',
    );

    return user;
  },

  /**
   * Retrieve a single user by ID.
   * Platform Admin: any user. Tenant Admin: own org members only (via Member join).
   */
  async getById(id: string, ctx: ServiceContext) {
    requireAnyAdmin(ctx);

    const user = await tenantDb.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Tenant Admin can only access users who are members of their org
    if (ctx.role === 'TENANT_ADMIN' && ctx.organizationId) {
      const member = await runWithTenant(ctx.organizationId, () =>
        tenantDb.member.findFirst({
          where: { userId: id, orgId: ctx.organizationId! },
        }),
      );
      if (!member) {
        logFailedAuth(ctx, 'getById');
        throw new ForbiddenError('Cannot access users outside your organization');
      }
    }

    return user;
  },

  /**
   * Paginated list of users with optional filtering.
   * Platform Admin: all users. Tenant Admin: own org members only (via Member join).
   */
  async list(filters: UserFilters = {}, paginationInput: { page?: number; pageSize?: number } = {}, ctx: ServiceContext): Promise<PaginatedResult<Prisma.UserGetPayload<{ include: { _count: { select: { members: true } } } }>>> {
    requireAnyAdmin(ctx);

    const { page, pageSize } = normalizePagination(paginationInput);
    const skip = (page - 1) * pageSize;

    // Build where clause
    const where: Prisma.UserWhereInput = {};
    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { email: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    // Tenant Admin scope: only members of their org
    if (ctx.role === 'TENANT_ADMIN' && ctx.organizationId) {
      where.members = {
        some: { orgId: ctx.organizationId },
      };

      // Apply role filter within the org context
      if (filters.role) {
        where.members = {
          ...where.members,
          some: { orgId: ctx.organizationId, role: filters.role },
        };
      }
    }

    // Platform Admin scope: filter by organization, role, or team
    if (ctx.role === 'PLATFORM_ADMIN') {
      const hasFilter = filters.organizationId || filters.role || filters.teamId;

      if (hasFilter) {
        // Build organization/role filter set
        const memberWhere: Prisma.MemberWhereInput = {};

        if (filters.organizationId) {
          memberWhere.orgId = filters.organizationId;
        }
        if (filters.role) {
          memberWhere.role = filters.role;
        }

        let userIds: string[] = [];

        if (filters.organizationId || filters.role) {
          // Membership lookup needs one org context: the filtered org when given,
          // else the caller's own (super admins list from their platform org).
          const lookupOrg =
            filters.organizationId ?? ctx.organizationId ?? env.PLATFORM_ORGANIZATION_ID!;
          const matchingMembers = await runWithTenant(lookupOrg, () =>
            tenantDb.member.findMany({
              where: memberWhere,
              select: { userId: true },
            }),
          );
          userIds = matchingMembers.map((m) => m.userId);
        }

        // Apply team filter if specified (intersection with existing userIds).
        // Platform-admin listing is cross-org by product model (the platform org
        // can reference any tenant's team); the env-derived platform org provides
        // the extension context.
        if (filters.teamId) {
          const teamMemberWhere: Prisma.TeamMemberWhereInput = { teamId: filters.teamId };
          const matchingTeamMembers: { userId: string }[] = await runWithTenant(
            env.PLATFORM_ORGANIZATION_ID!,
            () =>
              tenantDb.teamMember.findMany({
                where: teamMemberWhere,
                select: { userId: true },
              }),
          );
          const teamUserIds = new Set(matchingTeamMembers.map((tm) => tm.userId));

          if (userIds.length > 0) {
            // Intersection: users must be in both the org/role set AND the team
            userIds = userIds.filter((id) => teamUserIds.has(id));
          } else {
            userIds = Array.from(teamUserIds);
          }
        }

        if (userIds.length > 0) {
          where.id = { in: userIds };
        } else {
          // No users match the filter(s) — return empty
          where.id = { in: [] };
        }
      }
    }

    // Apply status filter (active/banned)
    if (filters.status === 'banned') {
      where.banned = true;
    } else if (filters.status === 'active') {
      where.banned = false;
    }

    const [users, total] = await Promise.all([
      tenantDb.user.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { members: true } },
          members: { take: 1, include: { organization: { select: { id: true, name: true } } } },
          teamMembers: {
            include: {
              team: { select: { id: true, name: true } },
              organization: { select: { id: true, name: true } },
            },
          },
        },
      }),
      tenantDb.user.count({ where }),
    ]);

    return {
      items: users,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  },

  /**
   * Update a user.
   * Platform Admin: any user. Tenant Admin: own org members only.
   */
  async update(id: string, data: UpdateUserInput, ctx: ServiceContext) {
    requireAnyAdmin(ctx);

    // Verify user exists first
    const existingUser = await tenantDb.user.findUnique({ where: { id } });
    if (!existingUser) {
      throw new NotFoundError('User not found');
    }

    // Tenant Admin can only update users who are members of their org
    if (ctx.role === 'TENANT_ADMIN' && ctx.organizationId) {
      const member = await runWithTenant(ctx.organizationId, () =>
        tenantDb.member.findFirst({
          where: { userId: id, orgId: ctx.organizationId! },
        }),
      );
      if (!member) {
        logFailedAuth(ctx, 'update');
        throw new ForbiddenError('Cannot update users outside your organization');
      }
    }

    // Validate email uniqueness if changing
    if (data.email && data.email !== existingUser.email) {
      const emailExists = await tenantDb.user.findUnique({ where: { email: data.email } });
      if (emailExists) {
        throw new Error('A user with this email already exists');
      }
    }

    // Build update data — only include provided fields
    const updateData: Prisma.UserUpdateInput = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.email !== undefined) updateData.email = data.email;

    const updatedUser = await tenantDb.user.update({
      where: { id },
      data: updateData,
    });

    logger.info(
      { userId: ctx.userId, targetUserId: id, method: 'UserService.update' },
      'User updated',
    );

    return updatedUser;
  },

  /**
   * Delete a user.
   * Platform Admin: any user. Tenant Admin: own org members only (removes Member relationship first).
   */
  async delete(id: string, ctx: ServiceContext) {
    requireAnyAdmin(ctx);

    // Verify user exists first
    const existingUser = await tenantDb.user.findUnique({ where: { id } });
    if (!existingUser) {
      throw new NotFoundError('User not found');
    }

    // Tenant Admin can only delete users who are members of their org
    if (ctx.role === 'TENANT_ADMIN' && ctx.organizationId) {
      const member = await runWithTenant(ctx.organizationId, () =>
        tenantDb.member.findFirst({
          where: { userId: id, orgId: ctx.organizationId! },
        }),
      );
      if (!member) {
        logFailedAuth(ctx, 'delete');
        throw new ForbiddenError('Cannot delete users outside your organization');
      }

      // Remove Member relationship first (User is global, so we can't cascade delete)
      // Remove this user's memberships in their org (extension-scoped write).
      await runWithTenant(ctx.organizationId, () =>
        tenantDb.member.deleteMany({ where: { userId: id } }),
      );
    }

    // Hard delete — cascading deletes handled by Prisma onDelete: Cascade relations
    await tenantDb.user.delete({ where: { id } });

    logger.info(
      { userId: ctx.userId, targetUserId: id, method: 'UserService.delete' },
      'User deleted',
    );

    return { success: true };
  },
};
