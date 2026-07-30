/**
 * PATCH /api/admin/organizations/[orgId]/roles/[roleId]
 * DELETE /api/admin/organizations/[orgId]/roles/[roleId]
 *
 * Super Admin only — update or delete a role in any tenant organization.
 */

import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import globalDb from '@/lib/global-db';
import tenantDb from '@/lib/tenant-db';
import { runWithTenant } from '@/lib/tenant-context';
import { recordAuditLog } from '@/lib/audit-log';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const revalidate = 30;

// ---------------------------------------------------------------------------
// PATCH — Update a role in a tenant organization (super admin)
// ---------------------------------------------------------------------------

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string; roleId: string }> }
) {
  const authResult = await requireSuperAdmin();
  if (!authResult.authorized) {
    return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: authResult.status });
  }

  const session = authResult.session!;
  const { orgId, roleId } = await params;

  let body: { name?: string; description?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { name, description } = body;
  if (!name && !description) {
    return NextResponse.json({ error: 'Provide name or description to update' }, { status: 400 });
  }

  try {
    // Verify target org exists (globalDb)
    const org = await globalDb.organization.findUnique({ where: { id: orgId } });
    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    // Verify role exists and belongs to this org (globalDb)
    const existingRole = await globalDb.role.findFirst({ where: { id: roleId, organizationId: orgId } });
    if (!existingRole) {
      return NextResponse.json({ error: 'Role not found in this organization' }, { status: 404 });
    }

    // Update role within tenant context (tenantDb)
    const updatedRole = await runWithTenant(orgId, async () => {
      return tenantDb.role.update({
        where: { id: roleId },
        data: { ...(name && { name }), ...(description !== undefined && { description }) },
      });
    });

    // Audit log (globalDb)
    await recordAuditLog({
      userId: session.user.id,
      userName: session.user.name || undefined,
      action: 'role.updated',
      success: true,
      resourceType: 'Organization.Role',
      resourceId: roleId,
      organizationId: orgId,
    });

    // Invalidate cache
    revalidateTag('org');

    logger.info({ userId: session.user.id, orgId, roleId }, 'Updated role in tenant organization');
    return NextResponse.json({ message: 'Role updated', role: updatedRole });
  } catch (error) {
    const isDbError = error instanceof Error && error.message.includes('Can\'t reach database server');
    logger.error({ err: error, orgId, roleId }, isDbError ? 'Database unavailable updating role' : 'Unexpected error updating role');
    return NextResponse.json({ error: isDbError ? 'Database unavailable' : 'Internal Server Error' }, { status: isDbError ? 503 : 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE — Delete a role from a tenant organization (super admin)
// ---------------------------------------------------------------------------

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string; roleId: string }> }
) {
  const authResult = await requireSuperAdmin();
  if (!authResult.authorized) {
    return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: authResult.status });
  }

  const session = authResult.session!;
  const { orgId, roleId } = await params;

  try {
    // Verify target org exists (globalDb)
    const org = await globalDb.organization.findUnique({ where: { id: orgId } });
    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    // Verify role exists and belongs to this org (globalDb)
    const existingRole = await globalDb.role.findFirst({ where: { id: roleId, organizationId: orgId } });
    if (!existingRole) {
      return NextResponse.json({ error: 'Role not found in this organization' }, { status: 404 });
    }

    // Safety check: warn if members are assigned to this role
    const memberRoleCount = await globalDb.memberRole.count({ where: { roleId } });
    if (memberRoleCount > 0) {
      return NextResponse.json(
        { error: `Cannot delete role with ${memberRoleCount} assigned member(s). Reassign or remove members first.` },
        { status: 400 }
      );
    }

    // Delete role within tenant context (tenantDb)
    await runWithTenant(orgId, async () => {
      return tenantDb.role.delete({ where: { id: roleId } });
    });

    // Audit log (globalDb)
    await recordAuditLog({
      userId: session.user.id,
      userName: session.user.name || undefined,
      action: 'role.deleted',
      success: true,
      resourceType: 'Organization.Role',
      resourceId: roleId,
      organizationId: orgId,
    });

    // Invalidate cache
    revalidateTag('org');

    logger.info({ userId: session.user.id, orgId, roleId }, 'Deleted role from tenant organization');
    return NextResponse.json({ message: 'Role deleted successfully' });
  } catch (error) {
    const isDbError = error instanceof Error && error.message.includes('Can\'t reach database server');
    logger.error({ err: error, orgId, roleId }, isDbError ? 'Database unavailable deleting role' : 'Unexpected error deleting role');
    return NextResponse.json({ error: isDbError ? 'Database unavailable' : 'Internal Server Error' }, { status: isDbError ? 503 : 500 });
  }
}
