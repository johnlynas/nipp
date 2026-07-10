/**
 * DELETE /api/roles/:roleId
 *
 * Delete a custom role with safety checks:
 * - Default roles (isDefault=true) cannot be deleted — 403 Forbidden.
 * - Roles with assigned members get a warning with member count — 400 Bad Request.
 * - Custom roles with 0 members can be deleted.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import prisma from '@/lib/db';
import { recordAuditLog } from '@/lib/audit-log';

export const runtime = 'nodejs';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ roleId: string }> }
) {
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { roleId } = await params;

  // Get the role with organization info
  const role = await prisma.role.findUnique({
    where: { id: roleId },
    include: { organization: true },
  });

  if (!role) {
    return NextResponse.json({ error: 'Role not found' }, { status: 404 });
  }

  // Verify requester is a member of this organization
  const membership = await prisma.member.findFirst({
    where: { userId: session.user.id, orgId: role.organizationId },
    select: { role: true },
  });

  if (!membership) {
    return NextResponse.json(
      { error: 'Not a member of this organization' },
      { status: 403 }
    );
  }

  // Check for roles:delete permission
  const userRoles = await prisma.role.findMany({
    where: {
      organizationId: role.organizationId,
      name: membership.role,
    },
    select: {
      permissions: {
        select: { permission: { select: { key: true } } },
      },
    },
  });

  const userPermissions = new Set(
    userRoles.flatMap((r) => r.permissions.map((rp) => rp.permission.key))
  );

  if (!userPermissions.has('roles:delete')) {
    return NextResponse.json(
      { error: 'Forbidden: insufficient permissions' },
      { status: 403 }
    );
  }

  // Safety check: default roles cannot be deleted
  if (role.isDefault) {
    return NextResponse.json(
      { error: 'Cannot delete default roles' },
      { status: 403 }
    );
  }

  // Safety check: count assigned members
  const memberCount = await prisma.memberRole.count({
    where: { roleId },
  });

  if (memberCount > 0) {
    return NextResponse.json(
      {
        error: `Cannot delete role with ${memberCount} assigned member(s)`,
        memberCount,
      },
      { status: 400 }
    );
  }

  // Delete the role (cascades to RolePermission)
  await prisma.role.delete({ where: { id: roleId } });

  // Audit log
  await recordAuditLog({
    userId: session.user.id,
    userName: session.user.name,
    action: 'role.deleted',
    resourceType: 'Role',
    resourceId: roleId,
    organizationId: role.organizationId,
    ipAddress: request.headers.get('x-forwarded-for') || 'unknown',
    userAgent: request.headers.get('user-agent') || 'unknown',
    success: true,
    metadata: { name: role.name },
  });

  return NextResponse.json({ success: true, message: 'Role deleted' });
}
