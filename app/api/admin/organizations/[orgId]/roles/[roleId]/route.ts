/**
 * PATCH /api/admin/organizations/[orgId]/roles/[roleId]
 * DELETE /api/admin/organizations/[orgId]/roles/[roleId]
 *
 * Super Admin only — update or delete a role in any tenant organization.
 */

import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { requireSuperAdmin } from '@/lib/require-super-admin';
// RLS Phase 3: tenant-role updates/deletes run under a verified target-org context.
import tenantDb from '@/lib/tenant-db';
import { withTenantAdminContext } from '@/lib/platform-db';
import { recordAuditLog } from '@/lib/audit-log';
import { logger } from '@/lib/logger';
import { checkAdminRateLimit } from '@/lib/rate-limiter';

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

  // Rate limit admin write operations by session
  if (!checkAdminRateLimit(session.user.id)) {
    logger.warn({ userId: session.user.id }, 'Admin write rate limited');
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

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
    // RLS: verified target-org context for org check + role update (WITH CHECK binds write)
    return await withTenantAdminContext(session.user.id, orgId, async () => {
      // Verify target org exists
      const org = await tenantDb.organization.findUnique({ where: { id: orgId } });
      if (!org) {
        return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
      }

      // Verify role exists and belongs to this org (platform pass-through; RLS scopes)
      const existingRole = await tenantDb.role.findFirst({ where: { id: roleId, organizationId: orgId } });
      if (!existingRole) {
        return NextResponse.json({ error: 'Role not found in this organization' }, { status: 404 });
      }

      // Update role (platform ctx pass-through; orgId in where matches RLS)
      const updatedRole = await tenantDb.role.update({
        where: { id: roleId },
        data: { ...(name && { name }), ...(description !== undefined && { description }) },
      });

      // Audit log
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
      revalidateTag('org', { expire: 0 });

      logger.info({ userId: session.user.id, orgId, roleId }, 'Updated role in tenant organization');
      return NextResponse.json({ message: 'Role updated', role: updatedRole });
    });
  } catch (error) {
    const isDbError = error instanceof Error && error.message.includes("Can't reach database server");
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

  // Rate limit admin write operations by session
  if (!checkAdminRateLimit(session.user.id)) {
    logger.warn({ userId: session.user.id }, 'Admin write rate limited');
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const { orgId, roleId } = await params;

  try {
    // RLS: verified target-org context for org check + role delete (RLS DELETE binds ctx org + flag)
    return await withTenantAdminContext(session.user.id, orgId, async () => {
      // Verify target org exists
      const org = await tenantDb.organization.findUnique({ where: { id: orgId } });
      if (!org) {
        return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
      }

      // Verify role exists and belongs to this org (platform pass-through; RLS scopes)
      const existingRole = await tenantDb.role.findFirst({ where: { id: roleId, organizationId: orgId } });
      if (!existingRole) {
        return NextResponse.json({ error: 'Role not found in this organization' }, { status: 404 });
      }

      // Safety check: warn if members are assigned to this role (scoped to the org)
      const memberRoleCount = await tenantDb.memberRole.count({ where: { roleId, organizationId: orgId } });
      if (memberRoleCount > 0) {
        return NextResponse.json(
          { error: `Cannot delete role with ${memberRoleCount} assigned member(s). Reassign or remove members first.` },
          { status: 400 }
        );
      }

      // Delete role (platform ctx pass-through; orgId in where matches RLS)
      await tenantDb.role.delete({ where: { id: roleId } });

      // Audit log
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
      revalidateTag('org', { expire: 0 });

      logger.info({ userId: session.user.id, orgId, roleId }, 'Deleted role from tenant organization');
      return NextResponse.json({ message: 'Role deleted successfully' });
    });
  } catch (error) {
    const isDbError = error instanceof Error && error.message.includes("Can't reach database server");
    logger.error({ err: error, orgId, roleId }, isDbError ? 'Database unavailable deleting role' : 'Unexpected error deleting role');
    return NextResponse.json({ error: isDbError ? 'Database unavailable' : 'Internal Server Error' }, { status: isDbError ? 503 : 500 });
  }
}
