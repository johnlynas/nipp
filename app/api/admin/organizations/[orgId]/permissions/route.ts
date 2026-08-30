/**
 * GET /api/admin/organizations/[orgId]/permissions
 * PATCH /api/admin/organizations/[orgId]/permissions
 *
 * Super Admin only — manage permissions in any tenant organization.
 */

import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import globalDb from '@/lib/global-db';
import tenantDb from '@/lib/tenant-db';
import { runWithTenant } from '@/lib/tenant-context';
import { PermissionService } from '@/services/permission-service';
import { handleServiceError } from '@/lib/services/error-handler';
import { ServiceContext } from '@/lib/services/types';
import { recordAuditLog } from '@/lib/audit-log';
import { logger } from '@/lib/logger';
import { checkAdminRateLimit } from '@/lib/rate-limiter';

export const runtime = 'nodejs';
export const revalidate = 30;

// ---------------------------------------------------------------------------
// GET — List all role-permission assignments in a tenant organization (super admin)
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const authResult = await requireSuperAdmin();
  if (!authResult.authorized) {
    return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: authResult.status });
  }

  const session = authResult.session!;
  const { orgId } = await params;

  try {
    // Verify target org exists (globalDb)
    const org = await globalDb.organization.findUnique({ where: { id: orgId } });
    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    // Fetch all permissions in the org (globalDb — Permission is global)
    const allPermissions = await globalDb.permission.findMany({
      orderBy: [{ resource: 'asc' }, { action: 'asc' }],
    });

    // Fetch role-permission assignments within tenant context (tenantDb — orgId auto-injected by extension)
    const rolePermissions = await runWithTenant(orgId, async () => {
      return tenantDb.rolePermission.findMany({
        include: {
          role: { select: { id: true, name: true, isDefault: true } },
          permission: true,
        },
      });
    });

    // Build a lookup: roleId -> Set of permission keys
    const rolePermissionMap = new Map<string, string[]>();
    for (const rp of rolePermissions) {
      if (!rolePermissionMap.has(rp.roleId)) {
        rolePermissionMap.set(rp.roleId, []);
      }
      rolePermissionMap.get(rp.roleId)!.push(rp.permission.key);
    }

    // Fetch all roles in the org (globalDb)
    const roles = await globalDb.role.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true, isDefault: true },
    });

    // Build the response grid: roles × permissions
    const grid = roles.map((role) => ({
      roleId: role.id,
      roleName: role.name,
      isDefault: role.isDefault,
      permissions: allPermissions.map((perm) => ({
        key: perm.key,
        resource: perm.resource,
        action: perm.action,
        assigned: rolePermissionMap.get(role.id)?.includes(perm.key) ?? false,
      })),
    }));

    logger.info({ userId: session.user.id, orgId }, 'Fetched tenant permissions grid');
    return NextResponse.json({ roles: grid, allPermissions });
  } catch (error) {
    return handleDbOrServiceError(error);
  }
}

// ---------------------------------------------------------------------------
// PATCH — Assign or revoke permissions to roles in a tenant organization (super admin)
// ---------------------------------------------------------------------------

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const authResult = await requireSuperAdmin();
  if (!authResult.authorized) {
    return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: authResult.status });
  }

  const session = authResult.session!;
  const { orgId } = await params;

  // Rate limit admin write operations by session
  if (!checkAdminRateLimit(session.user.id)) {
    logger.warn({ userId: session.user.id }, 'Admin write rate limited');
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  let body: { assignments: Array<{ roleId: string; permissionKey: string; assign: boolean }> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { assignments } = body;
  if (!assignments || !Array.isArray(assignments)) {
    return NextResponse.json({ error: 'Assignments array is required' }, { status: 400 });
  }

  try {
    // Verify target org exists (globalDb)
    const org = await globalDb.organization.findUnique({ where: { id: orgId } });
    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    // Process assignments within tenant context (tenantDb)
    const results: Array<{ roleId: string; permissionKey: string; action: 'assigned' | 'revoked'; success: boolean }> = [];

    for (const assignment of assignments) {
      const { roleId, permissionKey, assign } = assignment;

      // Verify role belongs to this org (globalDb)
      const role = await globalDb.role.findFirst({ where: { id: roleId, organizationId: orgId } });
      if (!role) {
        results.push({ roleId, permissionKey, action: assign ? 'assigned' : 'revoked', success: false });
        continue;
      }

      // Verify permission exists (globalDb)
      const permission = await globalDb.permission.findUnique({ where: { key: permissionKey } });
      if (!permission) {
        results.push({ roleId, permissionKey, action: assign ? 'assigned' : 'revoked', success: false });
        continue;
      }

      try {
        if (assign) {
          // Check if already assigned
          const existing = await globalDb.rolePermission.findFirst({
            where: { roleId, permissionId: permission.id },
          });
          if (!existing) {
            await runWithTenant(orgId, async () => {
              return tenantDb.rolePermission.create({
                data: {
                  roleId,
                  permissionId: permission.id,
                  organizationId: orgId,
                },
              });
            });
          }
          results.push({ roleId, permissionKey, action: 'assigned', success: true });
        } else {
          // Revoke permission
          await runWithTenant(orgId, async () => {
            return tenantDb.rolePermission.deleteMany({
              where: { roleId, permissionId: permission.id },
            });
          });
          results.push({ roleId, permissionKey, action: 'revoked', success: true });
        }
      } catch (err) {
        results.push({ roleId, permissionKey, action: assign ? 'assigned' : 'revoked', success: false });
      }
    }

    // Audit log (globalDb) — summarize changes
    const assigned = results.filter((r) => r.action === 'assigned' && r.success).length;
    const revoked = results.filter((r) => r.action === 'revoked' && r.success).length;
    if (assigned > 0 || revoked > 0) {
      await recordAuditLog({
        userId: session.user.id,
        userName: session.user.name || undefined,
        action: 'permissions.updated',
      success: true,
        resourceType: 'Organization.Permissions',
        organizationId: orgId,
        metadata: { assignedCount: assigned, revokedCount: revoked },
      });
    }

    // Invalidate cache
    revalidateTag('org');

    logger.info({ userId: session.user.id, orgId, assigned, revoked }, 'Updated tenant permissions');
    return NextResponse.json({ message: 'Permissions updated', results });
  } catch (error) {
    return handleDbOrServiceError(error);
  }
}

/**
 * Handle both database errors (503) and service-layer errors.
 */
function handleDbOrServiceError(error: unknown): ReturnType<typeof NextResponse.json> {
  const isDbError = error instanceof Error && error.message.includes("Can't reach database server");
  if (isDbError) {
    return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });
  }
  return handleServiceError(error);
}
