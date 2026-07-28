import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import tenantDb from '@/lib/tenant-db';
import { verifySuperAdmin } from '@/lib/authz';
import { logger } from '@/lib/logger';
import { setRLSContext } from '@/lib/rls'; // Adjust import as needed

// Cache audit logs for 10 seconds (P7 - server-side caching)
export const revalidate = 10;

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { authorized, error } = await verifySuperAdmin(session.user.id, undefined);
    if (!authorized) {
      const status = error?.includes('Database unavailable') ? 503 : 403;
      return NextResponse.json({ error: error || 'Super Admin access required' }, { status });
    }

    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const pageSize = parseInt(url.searchParams.get('pageSize') || '50', 10);
      
    // Wrap RLS context setting in try/catch to catch DB outages cleanly
    try {
      const orgId = session.session.activeOrganizationId;
      if (orgId) {
         await setRLSContext(session.user.id, orgId);
      }
    } catch (rlsError) {
      const isDbError = rlsError instanceof Error && rlsError.message.includes('Can\'t reach database server');
      logger.error({ userId: session.user.id, err: rlsError }, isDbError ? '[Audit Logs API] Database unavailable setting RLS context' : '[Audit Logs API] Error setting RLS context');
      return NextResponse.json({ error: 'Database unavailable, cannot fetch audit logs' }, { status: 503 });
    }

    // ... rest of your audit log fetching logic ...
    
    return NextResponse.json({ logs: [], pagination: { page, pageSize } }); // Replace with actual data
  } catch (error) {
    logger.error({ err: error }, '[Audit Logs API] Unexpected error');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}