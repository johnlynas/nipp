import { Prisma } from '@prisma/client';
import tenantDb from '@/lib/tenant-db';
import { logger } from '@/lib/logger';

export interface CreateOrganizationInput {
  name: string;
  slug?: string;
  adminEmail?: string;
}

export interface OrganizationWithCount {
  id: string;
  name: string;
  slug: string | null; // ← Prisma schema allows null
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
}

/**
 * Attempt to create an organization, retrying with a numeric suffix
 * on slug uniqueness collisions (P2002).
 */
async function createWithUniqueSlug(
  tx: Prisma.TransactionClient,
  name: string,
  baseSlug: string,
) {
  try {
    return await tx.organization.create({
      data: { name, slug: baseSlug },
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

/**
 * Service responsible for managing Organization business logic.
 * Decouples API routes from direct Prisma database operations.
 */
export const OrganizationService = {
  /**
   * Fetches a paginated list of organizations.
   */
  async getPaginatedOrganizations(page: number, pageSize: number): Promise<PaginatedOrganizations> {
    const skip = (page - 1) * pageSize;

    const [organizations, total] = await Promise.all([
      tenantDb.organization.findMany({
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { members: true } } },
      }),
      tenantDb.organization.count(),
    ]);

    return {
      organizations,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  },

  /**
   * Creates a new organization and optionally bootstraps an admin user/member.
   * Uses a transaction to ensure atomicity between organization and admin creation.
   */
  async createOrganization(input: CreateOrganizationInput) {
    const { name, slug, adminEmail } = input;

    return await tenantDb.$transaction(async (tx) => {
      // 1. Check for existing organization by name
      const existingOrgByName = await tx.organization.findFirst({
        where: { name: { equals: name, mode: 'insensitive' } },
      });

      if (existingOrgByName) {
        throw new Error('An organization with this name already exists');
      }

      // 2. Create organization with unique slug (retry on collision)
      const generatedSlug = slug || name.toLowerCase().replace(/\s+/g, '-');
      const organization = await createWithUniqueSlug(tx, name, generatedSlug);

      logger.info(
        { orgId: organization.id, method: 'Service.createOrganization' },
        'Organization created in transaction',
      );

      // 3. Handle Admin Bootstrap if email provided
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

      // 4. Return the created organization
      return organization;
    });
  },
};