import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import tenantDb from '@/lib/tenant-db';
import { logger } from '@/lib/logger';
import { verifySuperAdmin, getPlatformOrgId } from '@/lib/authz';

// NOTE: Uncomment and adjust this import to match your actual permissions resolver
// import { resolvePermissions } from '@/lib/permissions/resolver';

// User-specific permissions must never be cached (P7 - dynamic data)
export const revalidate = 0;

export async function GET() {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    
    if (!session) {
      logger.warn({ route: '/api/auth/permissions' }, 'No session found');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;
    logger.info({ userId }, '[Permissions API] Session found');

    let activeOrganizationId: string | null = null;
    let platformOrgId: string | null = null;
    let isSuperAdmin = false;

    try {
      // 1. Fetch user's active organization
      const user = await tenantDb.user.findUnique({
        where: { id: userId },
        select: { activeOrganizationId: true },
      });
      activeOrganizationId = user?.activeOrganizationId || null;
      logger.info({ userId, activeOrganizationId }, '[Permissions API] User activeOrganizationId fetched');

      // 2. Fetch platform org ID and check super admin status
      platformOrgId = await getPlatformOrgId();
      const currentOrgId = activeOrganizationId;
      
      if (platformOrgId && currentOrgId === platformOrgId) {
        const { authorized } = await verifySuperAdmin(userId, platformOrgId);
        isSuperAdmin = authorized;
      }

      logger.info({ platformOrgId, currentOrgId, isSuperAdmin }, '[Permissions API] Org context resolved');

      // 3. Resolve permissions 
      // TODO: Replace this placeholder with your actual resolvePermissions call
      // const permissions = await resolvePermissions(userId, activeOrganizationId || undefined);
      const permissions: string[] = []; 

      logger.info({ userId, permissionsCount: permissions.length }, '[Permissions API] Resolved permissions');

      return NextResponse.json({
        userId,
        activeOrganizationId,
        platformOrgId,
        isSuperAdmin,
        permissions,
      });

    } catch (dbError) {
      // Detect if this is a Prisma DB connection error
      const isDbError = dbError instanceof Error && dbError.message.includes('Can\'t reach database server');
      const logMessage = isDbError 
        ? '[Permissions API] Database unavailable fetching user context' 
        : '[Permissions API] Error fetching user context';
      
      // SECURE LOGGING: Log the FULL error object (including stack trace) to Pino
      logger.error({ userId, err: dbError }, logMessage);
      
      // GRACEFUL DEGRADATION: Return empty permissions rather than crashing the UI
      // Do NOT leak the stack trace or DB details to the client
      return NextResponse.json({ 
        userId,
        activeOrganizationId: null,
        platformOrgId: null,
        isSuperAdmin: false,
        permissions: [],
        warning: 'Database unavailable, permissions may be limited'
      }, { status: 503 });
    }

  } catch (error) {
    // Catch-all for any other unexpected errors
    logger.error({ err: error, route: '/api/auth/permissions' }, '[Permissions API] Unexpected error');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}