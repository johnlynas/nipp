import tenantDb from './tenant-db';

/**
 * Sets PostgreSQL session variables for Row Level Security (RLS).
 * MUST be called at the start of every API route before any Prisma query.
 * 
 * Implements a fallback for PLATFORM_ORG_ID to ensure RLS policies 
 * (specifically the Super Admin bypass EXISTS clause) continue to function
 * even if the environment variable is not explicitly set.
 */
export async function setRLSContext(userId: string, orgId: string) {
  // 1. Try to get it from the environment (Production standard)
  let platformOrgId = process.env.PLATFORM_ORG_ID?.trim();
  
  // 2. Fallback: If not in env, fetch it directly from the database
  if (!platformOrgId) {
    const platformOrg = await tenantDb.organization.findFirst({
      where: { slug: 'platform' },
      select: { id: true },
    });

    if (!platformOrg) {
      throw new Error(
        'PLATFORM_ORG_ID is not set in environment variables, and no Platform organization (slug: "platform") exists in the database. Run the seed script first.'
      );
    }
    
    platformOrgId = platformOrg.id;
  }

  // 3. Set the Postgres session variables for this request
  await tenantDb.$executeRaw`
    SELECT set_config('app.current_user_id', ${userId}, true),
           set_config('app.current_org_id', ${orgId}, true),
           set_config('app.platform_org_id', ${platformOrgId}, true)
  `;
}