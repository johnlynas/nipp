/**
 * PATCH /api/admin/permissions/:id
 * DELETE /api/admin/permissions/:id
 *
 * Super Admin only — update/delete a single permission.
 */

import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { requireSuperAdmin, enterSuperAdminContext } from '@/lib/require-super-admin';
import { recordAuditLog } from '@/lib/audit-log';
import { logger } from '@/lib/logger';
import { getClientIp } from '@/lib/ip';
import { isSameSiteRequest } from '@/lib/csrf';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// Helper: get the global (unscoped) Prisma client via runtime guard.
// SECURITY (S7): This throws if called outside a super-admin context.
// ---------------------------------------------------------------------------

async function getGlobalDb() {
  const { getGlobalDb: g } = await import('@/lib/global-db-guard');
  return g();
}

// ---------------------------------------------------------------------------
// PATCH — Update permission (super admin)
// ---------------------------------------------------------------------------

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // SECURITY (S8): Validate CSRF for state-changing requests
    if (!isSameSiteRequest(request.method, request.headers)) {
      return NextResponse.json(
        { error: 'Forbidden: cross-site request blocked' },
        { status: 403 }
      );
    }

    const authResult = await requireSuperAdmin();
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: authResult.status });
    }

    // SECURITY (S7): Enter super-admin context for globalDb access
    await enterSuperAdminContext();

    const session = authResult.session!;
    const { id } = await params;

    let body;
    try {
      body = await request.json();
    } catch (parseError) {
      logger.error({ err: parseError, route: '/api/admin/permissions/[id]', method: 'PATCH' }, '[Permissions API] Failed to parse request body');
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const { description, key } = body as { description?: string; key?: string };

    if (!description && !key) {
      return NextResponse.json({ error: 'Provide description or key to update' }, { status: 400 });
    }

    const db = await getGlobalDb();
    const permission = await db.permission.update({
      where: { id },
      data: { ...(description && { description }), ...(key && { key }) },
    });

    await recordAuditLog({
      userId: session.user.id,
      userName: session.user.name,
      action: 'permission.updated',
      resourceType: 'Permission',
      resourceId: permission.id,
      organizationId: null,
      ipAddress: getClientIp(request.headers.get('x-forwarded-for')),
      userAgent: request.headers.get('user-agent') || 'unknown',
      success: true,
      metadata: { key: permission.key },
    });

    logger.info({ userId: session.user.id, permissionId: id }, '[Permissions API] Permission updated');
    // P7: Invalidate cached permissions
    revalidateTag('permission');
    return NextResponse.json({ permission });
  } catch (error) {
    const isDbError = error instanceof Error && error.message.includes('Can\'t reach database server');
    logger.error({ err: error, route: '/api/admin/permissions/[id]', method: 'PATCH' }, isDbError ? '[Permissions API] Database unavailable' : '[Permissions API] Unexpected error');
    return NextResponse.json({ error: isDbError ? 'Database unavailable' : 'Internal Server Error' }, { status: isDbError ? 503 : 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE — Delete permission (super admin)
// ---------------------------------------------------------------------------

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // SECURITY (S8): Validate CSRF for state-changing requests
    if (!isSameSiteRequest(request.method, request.headers)) {
      return NextResponse.json(
        { error: 'Forbidden: cross-site request blocked' },
        { status: 403 }
      );
    }

    const authResult = await requireSuperAdmin();
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: authResult.status });
    }

    // SECURITY (S7): Enter super-admin context for globalDb access
    await enterSuperAdminContext();

    const session = authResult.session!;
    const { id } = await params;

    const db = await getGlobalDb();
    const permission = await db.permission.findUnique({ where: { id } });
    if (!permission) {
      return NextResponse.json({ error: 'Permission not found' }, { status: 404 });
    }

    const usageCount = await db.rolePermission.count({
      where: { permissionId: id },
    });

    if (usageCount > 0) {
      return NextResponse.json(
        { error: `Cannot delete permission used by ${usageCount} role(s)` },
        { status: 400 }
      );
    }

    await db.permission.delete({ where: { id } });

    await recordAuditLog({
      userId: session.user.id,
      userName: session.user.name,
      action: 'permission.deleted',
      resourceType: 'Permission',
      resourceId: id,
      organizationId: null,
      ipAddress: getClientIp(request.headers.get('x-forwarded-for')),
      userAgent: request.headers.get('user-agent') || 'unknown',
      success: true,
      metadata: { key: permission.key },
    });

    logger.info({ userId: session.user.id, permissionId: id }, '[Permissions API] Permission deleted');
    // P7: Invalidate cached permissions
    revalidateTag('permission');
    return NextResponse.json({ success: true, message: 'Permission deleted' });
  } catch (error) {
    const isDbError = error instanceof Error && error.message.includes('Can\'t reach database server');
    logger.error({ err: error, route: '/api/admin/permissions/[id]', method: 'DELETE' }, isDbError ? '[Permissions API] Database unavailable' : '[Permissions API] Unexpected error');
    return NextResponse.json({ error: isDbError ? 'Database unavailable' : 'Internal Server Error' }, { status: isDbError ? 503 : 500 });
  }
}