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
   */
  async createOrganization(input: CreateOrganizationInput) {
    const { name, slug, adminEmail } = input;

    // 1. Check for existing organization by name
    const existingOrgByName = await prisma.organization.findFirst({
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
      const existingOrg = await prisma.organization.findUnique({ where: { slug: uniqueSlug } });
      if (!existingOrg) break;
      uniqueSlug = `${generatedSlug}-${slugSuffix}`;
      slugSuffix++;
      if (slugSuffix > 100) {
        throw new Error('Unable to generate unique slug');
      }
    }

    // 3. Create the organization
    const organization = await prisma.organization.create({
      data: { name, slug: uniqueSlug },
    });

    logger.info({ orgId: organization.id, method: 'Service.createOrganization' }, 'Organization created');

    // 4. Handle Admin Bootstrap if email provided
    if (adminEmail) {
      try {
        let user = await prisma.user.findUnique({ where: { email: adminEmail } });
        if (!user) {
          user = await prisma.user.create({
            data: { 
              email: adminEmail, 
              name: adminEmail.split('@')[0], 
              emailVerified: true 
            },
          });
          logger.debug({ userId: user.id, method: 'Service.createOrganization' }, 'User created');
        }

        await prisma.member.create({
          data: { 
            userId: user.id, 
            orgId: organization.id, 
            role: 'admin' 
          },
        });
        logger.debug({ userId: user.id, orgId: organization.id, method: 'Service.createOrganization' }, 'Member relationship created');
      } catch (userError) {
        // We log the error but don't fail the whole request since the organization was successfully created
        logger.error({ 
          err: userError, 
          adminEmail, 
          orgId: organization.id, 
          method: 'Service.createOrganization' 
        }, 'Error creating user/member, but organization was created');
      }
    }

    return organization;
  },
};
