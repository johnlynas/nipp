import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';

export interface CreateOrganizationInput {
  name: string;
  slug?: string;
  adminEmail?: string;
}

export interface OrganizationWithCount {
  id: string;
  name: string;
  slug: string;
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
      prisma.organization.findMany({
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { members: true } } },
      }),
      prisma.organization.count(),
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

    return await prisma.$transaction(async (tx) => {
      // 1. Check for existing organization by name
      const existingOrgByName = await tx.organization.findFirst({
        where: { name: { equals: name, mode: 'insensitive' } },
      });

      if (existingOrgByName) {
        throw new Error('An organization with this name already exists');
      }

      // 2. Generate unique slug
      let generatedSlug = slug || name.toLowerCase().replace(/\s+/g, '-');
      let slugSuffix = 1;
      let uniqueSlug = generatedSlug;

      while (true) {
        const existingOrg = await tx.organization.findUnique({ where: { slug: uniqueSlug } });
        if (!existingOrg) break;
        uniqueSlug = `${generatedSlug}-${slugSuffix}`;
        slugSuffix++;
        if (slugSuffix > 100) {
          throw new Error('Unable to generate unique slug');
        }
      }

      // 3. Create the organization
      const organization = await tx.organization.create({
        data: { name, slug: uniqueSlug },
      });

      logger.info({ orgId: organization.id, method: 'Service.createOrganization' }, 'Organization created in transaction');

      // 4. Handle Admin Bootstrap if email provided
      if (adminEmail) {
        let user = await tx.user.findUnique({ where: { email: adminEmail } });
        if (!user) {
          user = await tx.user.create({
            data: { 
              email: adminEmail, 
              name: adminEmail.split('@')[0], 
              emailVerified: true 
            },
          });
          logger.debug({ userId: user.id, method: 'Service.createOrganization' }, 'User created in transaction');
        }

        await tx.member.create({
          data: { 
            userId: user.id, 
            orgId: organization.id, 
            role: 'admin' 
          },
        });
        logger.debug({ userId: user.id, orgId: organization.id, method: 'Service.createOrganization' }, 'Member relationship created in transaction');
      }

      return organization;
    });
  },
};
