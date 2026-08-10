import { PrismaClient } from '@prisma/client';
import { env } from '@/lib/env';

/**
 * Generate a URL-friendly slug from a string.
 * Converts to lowercase, replaces spaces/special chars with hyphens,
 * and collapses multiple hyphens.
 */
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100);
}

/**
 * Prisma Client singleton with middleware.
 *
 * In development, we use a global variable to prevent multiple instances
 * during hot-reloading. In production, a single instance is created per process.
 */
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

const basePrisma = globalForPrisma.prisma || new PrismaClient();

// Auto-generate slug for Team model and handle role inheritance for TeamMember
const prismaClient = basePrisma.$extends({
  query: {
    team: {
      create({ args, query }) {
        if (!args.data.slug && args.data.name) {
          args.data.slug = generateSlug(args.data.name);
        }
        return query(args);
      },
      createMany({ args, query }) {
        if (args.data && Array.isArray(args.data)) {
          for (const item of args.data) {
            if (!item.slug && item.name) {
              item.slug = generateSlug(item.name);
            }
          }
        }
        return query(args);
      },
    },
    teamMember: {
      async create({ args, query }) {
        const result = await query(args);
        
        // Role inheritance: assign all team roles to the new member
        const { teamId, userId, organizationId } = args.data as { 
          teamId: string; 
          userId: string; 
          organizationId: string; 
        };
        
        if (teamId && userId && organizationId) {
          // Find the Member record for this user in this org
          const member = await basePrisma.member.findFirst({
            where: { userId, orgId: organizationId },
          });

          if (member) {
            // Get all roles assigned to this team
            const teamRoles = await basePrisma.teamRole.findMany({
              where: { teamId, organizationId },
              select: { roleId: true },
            });

            // Assign each team role to the member (skip if already assigned)
            for (const tr of teamRoles) {
              const existing = await basePrisma.memberRole.findFirst({
                where: { memberId: member.id, roleId: tr.roleId },
              });

              if (!existing) {
                await basePrisma.memberRole.create({
                  data: {
                    member: { connect: { id: member.id } },
                    role: { connect: { id: tr.roleId } },
                    organization: { connect: { id: organizationId } },
                  },
                });
              }
            }
          }
        }
        
        return result;
      },
    },
  },
});

// Cast to PrismaClient to satisfy TypeScript (extensions add methods but keep the base interface)
const typedPrisma = prismaClient as unknown as PrismaClient;

if (env.NODE_ENV !== 'production') globalForPrisma.prisma = typedPrisma;

export { typedPrisma as prisma };
export default typedPrisma;