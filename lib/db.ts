import { PrismaClient } from '@/lib/prisma';
import { PrismaPg } from '@prisma/adapter-pg';
import { env } from '@/lib/env';
import { teamMembershipKey } from '@/lib/team-membership-key';

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

// Prisma 7 requires a driver adapter for client construction. The `pg`
// connection pool defaults differ from v6 (notably no default connect
// timeout), so pin the v6 behavior explicitly. URL comes from lib/env —
// already validated and NODE-ENV aware (test fixtures in tests).
const adapter = new PrismaPg({
  connectionString: env.DATABASE_URL,
  connectionTimeoutMillis: 5_000,
});

const basePrisma = globalForPrisma.prisma || new PrismaClient({ adapter });

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
        // 1.7 schema requires TeamMember.membershipKey (unique, NOT NULL) and the
        // organization plugin computes it on its own writes. App code inserting
        // directly must supply the identical canonical key — inject centrally when
        // a caller forgot, computed from (teamId, userId). Transaction-scoped tx
        // paths don't hit this extension, so those call sites pass it explicitly.
        if (!('membershipKey' in (args.data as Record<string, unknown>))) {
          const d = args.data as { teamId?: string; userId?: string };
          if (d.teamId && d.userId) {
            args.data = { ...args.data, membershipKey: teamMembershipKey(d.teamId, d.userId) };
          }
        }
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
            where: { userId, organizationId: organizationId},
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