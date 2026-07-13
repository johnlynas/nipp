import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { setRLSContext } from '@/lib/rls';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // ✅ CRITICAL: Set RLS Context before ANY database queries
    const orgId = session.session.activeOrganizationId || process.env.PLATFORM_ORG_ID!;
    await setRLSContext(session.user.id, orgId);

    // Get query parameters for filtering/pagination
    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const resource = searchParams.get('resource'); // Matches frontend filter

    const skip = (page - 1) * limit;

    // Build where clause
    const where: any = {};
    
    if (resource) {
      where.resourceType = resource;
    }

    // ✅ Fetch audit logs - RLS allows Super Admin to see all orgs
    const [auditLogs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { timestamp: 'desc' },
        include: {
          organization: true, // Include organization details
        },
      }),
      prisma.auditLog.count({ where }),
    ]);

    // Fetch user details for each audit log (since there's no direct relation)
    const userIds = [...new Set(auditLogs.map(log => log.userId).filter((id): id is string => id !== null))]; // Filter out null values
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        name: true,
        email: true,
      },
    });

    // Create a user lookup map
    const userMap = new Map(users.map(u => [u.id, u]));

    // Attach user info to each audit log
    const auditLogsWithUsers = auditLogs.map(log => ({
      ...log,
      user: userMap.get(log.userId!) || { 
        id: log.userId, 
        name: log.userName || 'Unknown', 
        email: 'Unknown' 
      },
    }));

    return NextResponse.json({
      auditLogs: auditLogsWithUsers,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('[Audit Logs API] Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
