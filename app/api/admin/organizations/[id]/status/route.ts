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
import { requireSuperAdmin, getRequestMetadata } from '@/lib/require-super-admin';
import { recordAuditLog } from '@/lib/audit-log';

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
 * PATCH — Change organization status.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireSuperAdmin(request.headers);
  if (authError) return authError;

  const { id } = await params;
  const body = await request.json();
  const { status: newStatus } = body as { status: string };

  if (!newStatus || !VALID_TRANSITIONS[newStatus]) {
    return NextResponse.json(
      { error: 'Invalid status value' },
      { status: 400 }
    );
  }

  const session = await auth.api.getSession({ headers: request.headers });
  const { ipAddress, userAgent } = getRequestMetadata(request);

  try {
    const org = await globalDb.organization.findUnique({
      where: { id },
      select: { status: true, name: true },
    });

    if (!org) {
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

    await recordAuditLog({
      userId: session?.user?.id,
      userName: session?.user?.name,
      action: `organization.${newStatus.toLowerCase()}`,
      resourceType: 'Organization',
      resourceId: id,
      organizationId: null,
      ipAddress,
      userAgent,
      success: true,
      metadata: { from: org.status, to: newStatus, name: org.name },
    });

    // Invalidate sessions if suspending
    if (newStatus === 'SUSPENDED') {
      await invalidateOrgSessions(id);
    }

    return NextResponse.json({ organization: updated });
  } catch (error) {
    console.error('[Admin Org Status] Failed to update status:', error);
    return NextResponse.json(
      { error: 'Failed to update organization status' },
      { status: 500 }
    );
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

    console.log(`[Admin Org Status] Invalidated sessions for ${members.length} members of org ${orgId}`);
  } catch (error) {
    console.error('[Admin Org Status] Failed to invalidate sessions:', error);
    // Don't fail the status change if session invalidation fails
  }
}
