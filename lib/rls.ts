import { prisma } from '@/lib/db';
import { env } from '@/lib/env';

/**
 * Sets PostgreSQL session variables for Row Level Security (RLS).
 * MUST be called at the start of every API route before any Prisma query.
 */
export async function setRLSContext(userId: string, orgId: string) {
  const platformOrgId = env.PLATFORM_ORGANIZATION_ID;
  
  if (!platformOrgId) {
    throw new Error('PLATFORM_ORG_ID is not set in environment variables');
  }

  // Use Prisma's tagged template literal to safely pass variables and prevent SQL injection
  await prisma.$executeRaw`
    SELECT set_config('app.current_user_id', ${userId}, true),
           set_config('app.current_org_id', ${orgId}, true),
           set_config('app.platform_org_id', ${platformOrgId}, true)
  `;
}