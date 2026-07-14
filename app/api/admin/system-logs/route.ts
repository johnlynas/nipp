import { NextResponse } from 'next/server';
import { getSystemLogs } from '@/lib/system-logs';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { headers } from 'next/headers';

export async function GET(request: Request) {
  try {
    let session;
    try {
      session = await auth.api.getSession({
        headers: await headers(),
      });
    } catch (sessionError) {
      // If DB is down and cache expired, we cannot authenticate
      console.log('[SYSTEM_LOGS] Session validation failed (likely DB down + cache expired)');
      return NextResponse.json({ error: 'Service temporarily unavailable' }, { status: 503 });
    }
    
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    let isSuperAdmin = false;
    
    try {
      // Tier 1: Try database check (works when DB is up)
      const { getPlatformOrgId } = await import('@/lib/authz');
      const platformOrgId = await getPlatformOrgId();
      
      const superAdminCheck = await prisma.member.findFirst({
        where: {
          userId: session.user.id,
          orgId: platformOrgId,
        },
      });
      
      isSuperAdmin = !!superAdminCheck;
    } catch (error) {
      // Tier 2: Fallback to session email check (works when DB is down)
      // This is safe because the email is cryptographically signed in the session cookie
      const userEmail = (session.user as any).email;
      const knownSuperAdminEmail = process.env.SUPER_ADMIN_EMAIL || 'admin@nipp.gov.uk';
      
      console.log(`[SYSTEM_LOGS] DB unavailable, falling back to email check for: ${userEmail}`);
      isSuperAdmin = userEmail === knownSuperAdminEmail;
    }

    if (!isSuperAdmin) {
      return NextResponse.json({ error: 'Super Admin access required' }, { status: 403 });
    }
    
    // Get query parameter for limit
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    
    const logs = getSystemLogs(Math.min(limit, 100));
    
    return NextResponse.json({
      logs,
      count: logs.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[ADMIN_LOGS] Failed to retrieve logs:', error);
    return NextResponse.json({ error: 'Failed to retrieve logs' }, { status: 500 });
  }
}
