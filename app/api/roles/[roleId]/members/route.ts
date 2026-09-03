/**
 * POST /api/roles/:roleId/members
 *
 * Assign a custom role to a member of the organization.
 * Requires: members:update permission in the target organization.
 */

import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { auth } from '@/lib/auth';
import tenantDb from '@/lib/tenant-db';
import { checkAdminRateLimit } from '@/lib/rate-limiter';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// POST — Assign role to member (requires members:update)
// ---------------------------------------------------------------------------

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ roleId: string }> }
) {
  const session = await auth.api.getSession({ headers: req.headers });

  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Rate limit write operations by session
  if (!checkAdminRateLimit(session.user.id)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const { roleId } = await params;
  const body = await req.json();
  const { userId } = body as { userId: string };

  if (!userId) {
    return NextResponse.json(
      { error: 'userId is required' },
      { status: 400 }
    );
  }

  // Get the role and verify it belongs to an org the requester is part of
  const role = await tenantDb.role.findFirst({
    where: { id: roleId },
    include: { organization: true },
  });

  if (!role) {
    return NextResponse.json({ error: 'Role not found' }, { status: 404 });
  }

  // Verify requester membership and get their role name
  const requesterMembership = await tenantDb.member.findFirst({
    where: { userId: session.user.id, orgId: role.organizationId },
    select: { role: true },
  });

  if (!requesterMembership) {
    return NextResponse.json(
      { error: 'Not a member of this organization' },
      { status: 403 }
    );
  }

  // PERFORMANCE (P1): Use cached resolvePermissions() instead of 3 sequential DB queries.
  const { resolvePermissions } = await import('@/lib/permissions/resolver');
  const requesterPermissions = await resolvePermissions(session.user.id, role.organizationId);

  if (!requesterPermissions.includes('members:update')) {
    return NextResponse.json(
      { error: 'Forbidden: insufficient permissions' },
      { status: 403 }
    );
  }

  // Verify the target user is a member of this organization
  const targetMembership = await tenantDb.member.findFirst({
    where: { userId, orgId: role.organizationId },
  });

  if (!targetMembership) {
    return NextResponse.json(
      { error: 'User is not a member of this organization' },
      { status: 400 }
    );
  }

  // Update the member's role (store custom role name in the string field)
  await tenantDb.member.update({
    where: { id: targetMembership.id },
    data: { role: role.name },
  });

  // Invalidate permission cache for the target user
  const { invalidateUserCache } = await import('@/lib/permissions/resolver');
  await invalidateUserCache(userId);

  // P7: Invalidate cached org details (member roles changed)
  revalidateTag('org');

  return NextResponse.json({ success: true });
}
