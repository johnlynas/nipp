/**
 * GET /api/admin/permissions
 * POST /api/admin/permissions
 * PATCH /api/admin/permissions/:id
 * DELETE /api/admin/permissions/:id
 *
 * Super Admin only — global permission catalog CRUD.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin, enterSuperAdminContext } from '@/lib/require-super-admin';
import { recordAuditLog } from '@/lib/audit-log';
import { prisma } from '@/lib/db';
import { setRLSContext } from '@/lib/rls';
import { env } from '@/lib/env';
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
// GET — List all permissions (super admin)
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireSuperAdmin();
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: authResult.status });
    }

    const session = authResult.session!;
    const orgId = (session as any).session?.activeOrganizationId || env.PLATFORM_ORGANIZATION_ID!;

    try {
      await setRLSContext(session.user.id, orgId);
    } catch (rlsError) {
      const isDbError = rlsError instanceof Error && rlsError.message.includes('Can\'t reach database server');
      logger.error({ userId: session.user.id, err: rlsError }, isDbError ? '[Permissions API] Database unavailable setting RLS context' : '[Permissions API] Error setting RLS context');
      return NextResponse.json({ error: 'Database unavailable, cannot fetch permissions' }, { status: 503 });
    }

    const searchParams = request.nextUrl.searchParams;
    const resource = searchParams.get('resource');
    const search = searchParams.get('search') || '';

    const where: any = {};
    if (resource) {
      where.resource = resource;
    }
    if (search) {
      where.OR = [
        { key: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const permissions = await prisma.permission.findMany({
      where,
      orderBy: [{ resource: 'asc' }, { action: 'asc' }],
    });

    logger.info({ userId: session.user.id, count: permissions.length }, '[Permissions API] Fetched permissions');
    return NextResponse.json({ permissions });
  } catch (error) {
    const isDbError = error instanceof Error && error.message.includes('Can\'t reach database server');
    logger.error({ err: error, route: '/api/admin/permissions', method: 'GET' }, isDbError ? '[Permissions API] Database unavailable' : '[Permissions API] Unexpected error');
    return NextResponse.json({ error: isDbError ? 'Database unavailable' : 'Internal Server Error' }, { status: isDbError ? 503 : 500 });
  }
}

// ---------------------------------------------------------------------------
// POST — Create permission (super admin)
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
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
    const orgId = (session as any).session?.activeOrganizationId || env.PLATFORM_ORGANIZATION_ID!;

    try {
      await setRLSContext(session.user.id, orgId);
    } catch (rlsError) {
      const isDbError = rlsError instanceof Error && rlsError.message.includes('Can\'t reach database server');
      logger.error({ userId: session.user.id, err: rlsError }, isDbError ? '[Permissions API] Database unavailable setting RLS context' : '[Permissions API] Error setting RLS context');
      return NextResponse.json({ error: 'Database unavailable, cannot create permission' }, { status: 503 });
    }

    let body;
    try {
      body = await request.json();
    } catch (parseError) {
      logger.error({ err: parseError, route: '/api/admin/permissions', method: 'POST' }, '[Permissions API] Failed to parse request body');
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const { key, resource, action, description } = body;

    if (!key || !resource || !action) {
      return NextResponse.json({ error: 'Key, resource, and action are required' }, { status: 400 });
    }

    const permission = await prisma.permission.create({
      data: { key, resource, action, description },
    });

    logger.info({ userId: session.user.id, permissionId: permission.id }, '[Permissions API] Permission created');
    return NextResponse.json({ permission }, { status: 201 });
  } catch (error) {
    const isDbError = error instanceof Error && error.message.includes('Can\'t reach database server');
    logger.error({ err: error, route: '/api/admin/permissions', method: 'POST' }, isDbError ? '[Permissions API] Database unavailable' : '[Permissions API] Unexpected error');
    return NextResponse.json({ error: isDbError ? 'Database unavailable' : 'Internal Server Error' }, { status: isDbError ? 503 : 500 });
  }
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
      logger.error({ err: parseError, route: '/api/admin/permissions', method: 'PATCH' }, '[Permissions API] Failed to parse request body');
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
    return NextResponse.json({ permission });
  } catch (error) {
    const isDbError = error instanceof Error && error.message.includes('Can\'t reach database server');
    logger.error({ err: error, route: '/api/admin/permissions', method: 'PATCH' }, isDbError ? '[Permissions API] Database unavailable' : '[Permissions API] Unexpected error');
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
    return NextResponse.json({ success: true, message: 'Permission deleted' });
  } catch (error) {
    const isDbError = error instanceof Error && error.message.includes('Can\'t reach database server');
    logger.error({ err: error, route: '/api/admin/permissions', method: 'DELETE' }, isDbError ? '[Permissions API] Database unavailable' : '[Permissions API] Unexpected error');
    return NextResponse.json({ error: isDbError ? 'Database unavailable' : 'Internal Server Error' }, { status: isDbError ? 503 : 500 });
  }
}
