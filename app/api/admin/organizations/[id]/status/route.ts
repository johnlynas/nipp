/**
 * PATCH /api/admin/organizations/:id/status
 *
 * Super Admin only — change organization status with state machine validation.
 *
 * State machine: PENDING → ACTIVE ↔ SUSPENDED → ARCHIVED (terminal)
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import globalDb from '@/lib/global-db';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';

export const runtime = 'nodejs';

/**
 * Valid state transitions.
 */
const VALID_TRANSITIONS: Record<string, string[]> = {
  PENDING: ['ACTIVE'],
  ACTIVE: ['SUSPENDED', 'ARCHIVED'],
  SUSPENDED: ['ACTIVE', 'ARCHIVED'],
  ARCHIVED: [], // Terminal — no transitions allowed
};

/**
 * Helper function to check if user is Super Admin
 */
async function checkSuperAdmin(headersList: Headers): Promise<{ session: any; isSuperAdmin: boolean }> {
  const session = await auth.api.getSession({ headers: headersList });
  
  if (!session) {
    return { session: null, isSuperAdmin: false };
  }
  
  let isSuperAdmin = false;
  
  try {
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
    // Fallback to email check if DB is unavailable
    const userEmail = (session.user as any).email;
    const knownSuperAdminEmail = env.SUPER_ADMIN_EMAIL || 'admin@nipp.gov.uk';
    isSuperAdmin = userEmail === knownSuperAdminEmail;
  }
  
  return { session, isSuperAdmin };
}

/**
 * PATCH — Change organization status.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    console.log('[ORG_STATUS_API] PATCH request received');
    
    const { session, isSuperAdmin } = await checkSuperAdmin(request.headers);
    
    if (!session) {
      console.log('[ORG_STATUS_API] No session found');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    if (!isSuperAdmin) {
      console.log('[ORG_STATUS_API] User is not Super Admin');
      return NextResponse.json({ error: 'Super Admin access required' }, { status: 403 });
    }
    
    console.log('[ORG_STATUS_API] Session found for user:', session.user.id);

    const { id } = await params;
    const body = await request.json();
    const { status: newStatus } = body as { status: string };

    if (!newStatus || !VALID_TRANSITIONS[newStatus]) {
      return NextResponse.json(
        { error: 'Invalid status value' },
        { status: 400 }
      );
    }

    try {
      const org = await globalDb.organization.findUnique({
        where: { id },
        select: { status: true, name: true },
      });

      if (!org) {
        console.log('[ORG_STATUS_API] Organization not found:', id);
        return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
      }

      // Validate transition
      const allowed = VALID_TRANSITIONS[org.status];
      if (!allowed.includes(newStatus)) {
        return NextResponse.json(
          {
            error: `Invalid transition from ${org.status} to ${newStatus}`,
            current: org.status,
            allowedTransitions: allowed,
          },
          { status: 400 }
        );
      }

      const updated = await globalDb.organization.update({
        where: { id },
        data: { status: newStatus as any },
        select: { id: true, name: true, status: true },
      });

      // Invalidate sessions if suspending
      if (newStatus === 'SUSPENDED') {
        await invalidateOrgSessions(id);
      }

      console.log('[ORG_STATUS_API] Organization status updated:', id, 'to', newStatus);

      return NextResponse.json({ organization: updated });
    } catch (error) {
      console.error('[ORG_STATUS_API] Failed to update status:', error);
      return NextResponse.json(
        { error: 'Failed to update organization status' },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('[ORG_STATUS_API] PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * Invalidate all sessions for members of an organization.
 */
async function invalidateOrgSessions(orgId: string) {
  try {
    const members = await globalDb.member.findMany({
      where: { orgId },
      select: { userId: true },
    });

    const sessionIds = members.map((m) => `session:${m.userId}`);

    // Invalidate in Redis cache
    const { getRedis } = await import('@/lib/redis');
    const redis = getRedis();
    if (redis) {
      for (const key of sessionIds) {
        await redis.del(key);
      }
    }

    // Invalidate database sessions
    const userIds = members.map((m) => m.userId);
    if (userIds.length > 0) {
      await globalDb.session.deleteMany({
        where: { userId: { in: userIds } },
      });
    }

    console.log(`[ORG_STATUS_API] Invalidated sessions for ${members.length} members of org ${orgId}`);
  } catch (error) {
    console.error('[ORG_STATUS_API] Failed to invalidate sessions:', error);
    // Don't fail the status change if session invalidation fails
  }
}
