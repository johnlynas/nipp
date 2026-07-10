/**
 * POST /api/roles/:roleId/members
 *
 * Assign a custom role to a member of the organization.
 * Requires: members:update permission in the target organization.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import prisma from '@/lib/db';

export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ roleId: string }> }
) {
  const session = await auth.api.getSession({ headers: req.headers });

  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
  const role = await prisma.role.findFirst({
    where: { id: roleId },
    include: { organization: true },
  });

  if (!role) {
    return NextResponse.json({ error: 'Role not found' }, { status: 404 });
  }

  // Verify requester membership and get their role name
  const requesterMembership = await prisma.member.findFirst({
    where: { userId: session.user.id, orgId: role.organizationId },
    select: { role: true },
  });

  if (!requesterMembership) {
    return NextResponse.json(
      { error: 'Not a member of this organization' },
      { status: 403 }
    );
  }

  // Check for members:update permission by querying the role with this name
  const requesterRoles = await prisma.role.findMany({
    where: {
      organizationId: role.organizationId,
      name: requesterMembership.role, // Member.role is a string matching Role.name
    },
    select: {
      permissions: {
        select: { permission: { select: { key: true } } },
      },
    },
  });

  const requesterPermissions = new Set(
    requesterRoles.flatMap((r) => r.permissions.map((rp) => rp.permission.key))
  );

  if (!requesterPermissions.has('members:update')) {
    return NextResponse.json(
      { error: 'Forbidden: insufficient permissions' },
      { status: 403 }
    );
  }

  // Verify the target user is a member of this organization
  const targetMembership = await prisma.member.findFirst({
    where: { userId, orgId: role.organizationId },
  });

  if (!targetMembership) {
    return NextResponse.json(
      { error: 'User is not a member of this organization' },
      { status: 400 }
    );
  }

  // Update the member's role (store custom role name in the string field)
  await prisma.member.update({
    where: { id: targetMembership.id },
    data: { role: role.name },
  });

  // Invalidate permission cache for the target user
  const { invalidateUserCache } = await import('@/lib/permissions/resolver');
  await invalidateUserCache(userId);

  return NextResponse.json({ success: true });
}
