import { Prisma } from '@prisma/client';
import globalDb from '@/lib/global-db';
import { logger } from '@/lib/logger';
import { env } from '@/lib/env';
import { ServiceContext, ValidationError, NotFoundError, ConflictError, ForbiddenError } from '@/lib/services/types';
import { requirePlatformAdmin, requireAnyAdmin, logFailedAuth } from '@/lib/services/base-service';

// ---------------------------------------------------------------------------
// Input / Output Types (preserved from original)
// ---------------------------------------------------------------------------

export interface CreateOrganizationInput {
  name: string;
  slug?: string;
  description?: string | null;
  adminEmail?: string;
}

export interface OrganizationWithCount {
  id: string;
  name: string;
  slug: string | null;
  description?: string | null;
  createdAt: Date;
  updatedAt: Date;
  _count: {
    members: number;
  };
}

export interface PaginatedOrganizations {
  organizations: OrganizationWithCount[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  globalTotal: number;
  statusCounts: {
    ACTIVE: number;
    PENDING: number;
    SUSPENDED: number;
    ARCHIVED: number;
  };
}

export interface PaginatedOrganizationsInput {
  page: number;
  pageSize: number;
  status?: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
  search?: string;
}

export interface UpdateOrganizationInput {
  name?: string;
  slug?: string;
  description?: string | null;
  status?: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
}

// ---------------------------------------------------------------------------
// Internal helpers (preserved from original)
// ---------------------------------------------------------------------------

/**
 * Attempt to create an organization, retrying with a numeric suffix
 * on slug uniqueness collisions (P2002).
 */
async function createWithUniqueSlug(
  tx: Prisma.TransactionClient,
  name: string,
  baseSlug: string,
  description?: string | null,
) {
  try {
    return await tx.organization.create({
      data: { name, slug: baseSlug, description },
    });
  } catch (error: unknown) {
    if ((error as { code?: string }).code !== 'P2002') throw error;
  }

  // Slug collision — retry with suffix
  for (let suffix = 1; suffix <= 100; suffix++) {
    try {
      return await tx.organization.create({
        data: { name, slug: `${baseSlug}-${suffix}` },
      });
    } catch (err: unknown) {
      if ((err as { code?: string }).code !== 'P2002') throw err;
    }
  }

  throw new Error('Unable to generate unique slug');
}

// ---------------------------------------------------------------------------
// Service singleton — full CRUD with authorization
// ---------------------------------------------------------------------------

/**
 * Service responsible for managing Organization business logic.
 * Decouples API routes from direct Prisma database operations.
 */
export const OrganizationService = {
  /**
   * Fetches a paginated list of organizations with optional status and name filtering.
   */
  async getPaginatedOrganizations(input: PaginatedOrganizationsInput): Promise<PaginatedOrganizations> {
    const { page, pageSize, status, search } = input;
    const skip = (page - 1) * pageSize;

    // Build where clause for optional filters
    const where: Prisma.OrganizationWhereInput = {};
    if (status) where.status = status as 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
    if (search) where.name = { contains: search, mode: 'insensitive' };

    // Global (unfiltered) counts for dashboard stat cards
    const [globalTotal, globalStatusCounts] = await Promise.all([
      globalDb.organization.count(),
      globalDb.organization.groupBy({
        by: ['status'],
        _count: { status: true },
      }),
    ]);

    const globalCountsMap: Record<string, number> = {};
    for (const entry of globalStatusCounts) {
      globalCountsMap[entry.status] = entry._count.status;
    }

    const [organizations, filteredTotal] = await Promise.all([
      globalDb.organization.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { members: true, teams: true } } },
      }),
      globalDb.organization.count({ where }),
    ]);

    return {
      organizations: organizations.map((org) => ({
        ...org,
        memberCount: org._count?.members ?? 0,
        teamCount: org._count?.teams ?? 0,
      })),
      pagination: {
        page,
        pageSize,
        total: filteredTotal,
        totalPages: Math.ceil(filteredTotal / pageSize),
      },
      globalTotal,
      statusCounts: {
        ACTIVE: globalCountsMap['ACTIVE'] ?? 0,
        PENDING: globalCountsMap['PENDING'] ?? 0,
        SUSPENDED: globalCountsMap['SUSPENDED'] ?? 0,
        ARCHIVED: globalCountsMap['ARCHIVED'] ?? 0,
      },
    };
  },

  /**
   * Creates a new organization and optionally bootstraps an admin user/member.
   */
  async createOrganization(input: CreateOrganizationInput, ctx: ServiceContext) {
    requirePlatformAdmin(ctx);

    const { name, slug, description, adminEmail } = input;

    return await globalDb.$transaction(async (tx) => {
      // 1. Check for existing organization by name
      const existingOrgByName = await tx.organization.findFirst({
        where: { name: { equals: name, mode: 'insensitive' } },
      });

      if (existingOrgByName) {
        throw new Error('An organization with this name already exists');
      }

      // 2. Create organization with unique slug (retry on collision)
      const generatedSlug = slug || name.toLowerCase().replace(/\s+/g, '-');
      const organization = await createWithUniqueSlug(tx, name, generatedSlug, description);

      logger.info(
        { orgId: organization.id, method: 'Service.createOrganization' },
        'Organization created in transaction',
      );

      // 3. Create default "Members" team for the organization
      await tx.team.create({
        data: { name: 'Members', slug: 'members', organizationId: organization.id },
      });
      logger.debug(
        { orgId: organization.id, method: 'Service.createOrganization' },
        'Default Members team created',
      );

      // 4. Create default calendar for the organization
      await tx.calendar.create({
        data: {
          name: 'Main Calendar',
          description: 'Default calendar for the organization',
          color: '#1B2A4A',
          isDefault: true,
          organizationId: organization.id,
        },
      });
      logger.debug(
        { orgId: organization.id, method: 'Service.createOrganization' },
        'Default calendar created',
      );

      // 5. Handle Admin Bootstrap if email provided
      if (adminEmail) {
        let user = await tx.user.findUnique({ where: { email: adminEmail } });

        if (!user) {
          user = await tx.user.create({
            data: {
              email: adminEmail,
              name: adminEmail.split('@')[0],
              emailVerified: true,
            },
          });
          logger.debug(
            { userId: user.id, method: 'Service.createOrganization' },
            'User created in transaction',
          );
        }

        await tx.member.create({
          data: {
            userId: user.id,
            orgId: organization.id,
            role: 'admin',
          },
        });
        logger.debug(
          { userId: user.id, orgId: organization.id, method: 'Service.createOrganization' },
          'Member relationship created in transaction',
        );
      }

      // 6. Return the created organization
      return organization;
    });
  },

  /**
   * Retrieve a single organization by ID.
   * Platform Admin: any org. Tenant Admin: own org only.
   */
  async getOrganizationById(id: string, ctx: ServiceContext) {
    requireAnyAdmin(ctx);

    const org = await globalDb.organization.findUnique({ where: { id } });
    if (!org) {
      throw new NotFoundError('Organization not found');
    }

    // Tenant Admin can only read their own org
    if (ctx.role === 'TENANT_ADMIN') {
      if (org.id !== ctx.organizationId) {
        logFailedAuth(ctx, 'getOrganizationById');
        throw new ForbiddenError('Cannot access organizations outside your organization');
      }
    }

    return org;
  },

  /**
   * Update an existing organization.
   * Platform Admin: any org (name, slug, status). Tenant Admin: own org only (name, status; slug immutable).
   */
  async updateOrganization(id: string, data: UpdateOrganizationInput, ctx: ServiceContext) {
    requireAnyAdmin(ctx);

    // Verify org exists first
    const existingOrg = await globalDb.organization.findUnique({ where: { id } });
    if (!existingOrg) {
      throw new NotFoundError('Organization not found');
    }

    // Tenant Admin can only update their own org
    if (ctx.role === 'TENANT_ADMIN') {
      if (existingOrg.id !== ctx.organizationId) {
        logFailedAuth(ctx, 'updateOrganization');
        throw new ForbiddenError('Cannot update organizations outside your organization');
      }
      // Slug is immutable after creation for Tenant Admins
      if (data.slug !== undefined) {
        throw new ValidationError('Slug cannot be changed after organization creation');
      }
    }

    // Build update data — only include provided fields
    const updateData: Prisma.OrganizationUpdateInput = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.status !== undefined) updateData.status = data.status as Prisma.EnumOrgStatusFieldUpdateOperationsInput;
    if (ctx.role === 'PLATFORM_ADMIN' && data.slug !== undefined) {
      updateData.slug = data.slug;
    }

    const updatedOrg = await globalDb.organization.update({
      where: { id },
      data: updateData,
    });

    logger.info(
      { userId: ctx.userId, orgId: id, method: 'Service.updateOrganization' },
      'Organization updated',
    );

    return updatedOrg;
  },

  /**
   * Delete an organization with safety semantics.
   * Platform Admin only. Throws ConflictError if members exist; Platform org is protected.
   */
  async deleteOrganization(id: string, ctx: ServiceContext) {
    requirePlatformAdmin(ctx);

    const org = await globalDb.organization.findUnique({
      where: { id },
      include: { _count: { select: { members: true } } },
    });

    if (!org) {
      throw new NotFoundError('Organization not found');
    }

    // Platform Organization is protected from deletion
    const platformOrgSlug = env.PLATFORM_ORGANIZATION_ID;
    if (platformOrgSlug && org.id === platformOrgSlug) {
      logFailedAuth(ctx, 'deleteOrganization');
      throw new ForbiddenError('Cannot delete the Platform Organization');
    }

    // Safety check: cannot delete org with members
    if (org._count.members > 0) {
      throw new ConflictError('Cannot delete organization with existing members');
    }

    await globalDb.organization.delete({ where: { id } });

    logger.info(
      { userId: ctx.userId, orgId: id, method: 'Service.deleteOrganization' },
      'Organization deleted',
    );

    return { success: true };
  },
};
