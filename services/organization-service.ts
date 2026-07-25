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

      // 2. Generate unique slug (Unique constraint + catch pattern)
      let generatedSlug = slug || name.toLowerCase().replace(/\s+/g, '-');
      
      try {
        const organization = await tx.organization.create({
          data: { name, slug: generatedSlug },
        });
        return organization;
      } catch (error: any) {
        if (error.code === 'P2002') { // Unique constraint failed on slug
          let suffix = 1;
          while (suffix <= 100) {
            const candidateSlug = `${generatedSlug}-${suffix}`;
            try {
              return await tx.organization.create({
                data: { name, slug: candidateSlug },
              });
            } catch (err: any) {
              if (err.code !== 'P2002') throw err; // Re-throw non-unique errors
              suffix++;
            }
          }
          throw new Error('Unable to generate unique slug');
        }
        throw error; // Re-throw other errors
      }

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
