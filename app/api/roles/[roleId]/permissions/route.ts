/**
 * POST /api/roles/:roleId/permissions
 *
 * Assign permissions to a custom role.
 * Requires: roles:update permission in the target organization.
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
  const { permissionKeys } = body as { permissionKeys: string[] };

  if (!permissionKeys || !Array.isArray(permissionKeys) || permissionKeys.length === 0) {
    return NextResponse.json(
      { error: 'permissionKeys array is required' },
      { status: 400 }
    );
  }

  // Get the role and verify it belongs to an org the user is part of
  const role = await prisma.role.findFirst({
    where: { id: roleId },
    include: { organization: true },
  });

  if (!role) {
    return NextResponse.json({ error: 'Role not found' }, { status: 404 });
  }

  // Verify membership and get role name
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

  // Check for roles:update permission by querying the role with this name
  const userRoles = await prisma.role.findMany({
    where: {
      organizationId: role.organizationId,
      name: membership.role, // Member.role is a string matching Role.name
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

  if (!userPermissions.has('roles:update')) {
    return NextResponse.json(
      { error: 'Forbidden: insufficient permissions' },
      { status: 403 }
    );
  }

  // Validate all permission keys exist in the catalog
  const existingPermissions = await prisma.permission.findMany({
    where: { key: { in: permissionKeys } },
    select: { id: true, key: true },
  });

  const validPermissionIds = new Set(existingPermissions.map((p) => p.id));
  const invalidKeys = permissionKeys.filter((k) => !validPermissionIds.has(k));

  if (invalidKeys.length > 0) {
    return NextResponse.json(
      { error: `Invalid permission keys: ${invalidKeys.join(', ')}` },
      { status: 400 }
    );
  }

  // Upsert role-permission mappings (avoid duplicates)
  const validPermissionObjects = existingPermissions.map((p) => ({
    permissionId: p.id,
    roleId,
    organizationId: role.organizationId,
  }));

  for (const permObj of validPermissionObjects) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: { roleId, permissionId: permObj.permissionId },
      },
      update: {},
      create: { ...permObj },
    });
  }

  // Invalidate cache for all members in the org
  const { invalidateUserCache } = await import('@/lib/permissions/resolver');
  const members = await prisma.member.findMany({
    where: { orgId: role.organizationId },
    select: { userId: true },
  });

  for (const member of members) {
    await invalidateUserCache(member.userId);
  }

  return NextResponse.json({ success: true });
}
