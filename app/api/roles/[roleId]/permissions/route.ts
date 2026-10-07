/**
 * POST /api/roles/:roleId/permissions
 *
 * Assign permissions to a custom role.
 * Requires: roles:update permission in the target organization.
 */

import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { auth } from '@/lib/auth';
import tenantDb from '@/lib/tenant-db';
import { checkAdminRateLimit } from '@/lib/rate-limiter';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// POST — Assign permissions to role (requires roles:update)
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
  const { permissionKeys } = body as { permissionKeys: string[] };

  if (!permissionKeys || !Array.isArray(permissionKeys) || permissionKeys.length === 0) {
    return NextResponse.json(
      { error: 'permissionKeys array is required' },
      { status: 400 }
    );
  }

  // Get the role and verify it belongs to an org the user is part of
  const role = await tenantDb.role.findFirst({
    where: { id: roleId },
    include: { organization: true },
  });

  if (!role) {
    return NextResponse.json({ error: 'Role not found' }, { status: 404 });
  }

  // Verify membership and get role name
  const membership = await tenantDb.member.findFirst({
    where: { userId: session.user.id, orgId: role.organizationId },
    select: { role: true },
  });

  if (!membership) {
    return NextResponse.json(
      { error: 'Not a member of this organization' },
      { status: 403 }
    );
  }

  // PERFORMANCE (P1): Use cached resolvePermissions() instead of 3 sequential DB queries.
  const { resolvePermissions } = await import('@/lib/permissions/resolver');
  const userPermissions = await resolvePermissions(session.user.id, role.organizationId);

  if (!userPermissions.includes('roles:update')) {
    return NextResponse.json(
      { error: 'Forbidden: insufficient permissions' },
      { status: 403 }
    );
  }

  // Validate all permission keys exist in the catalog
  const existingPermissions = await tenantDb.permission.findMany({
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
    await tenantDb.rolePermission.upsert({
      where: {
        roleId_permissionId: { roleId, permissionId: permObj.permissionId },
      },
      update: {},
      create: { ...permObj },
    });
  }

  // Invalidate cache for all members in the org
  const { invalidateUserCache } = await import('@/lib/permissions/resolver');
  const members = await tenantDb.member.findMany({
    where: { orgId: role.organizationId },
    select: { userId: true },
  });

  for (const member of members) {
    await invalidateUserCache(member.userId);
  }

  // P7: Invalidate cached org details (role permissions changed)
  revalidateTag('org', { expire: 0 });

  return NextResponse.json({ success: true });
}
