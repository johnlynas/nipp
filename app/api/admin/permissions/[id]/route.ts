/**
 * GET /api/admin/permissions/[id]
 * PATCH /api/admin/permissions/[id]
 * DELETE /api/admin/permissions/[id]
 *
 * Super Admin only — single permission CRUD via PermissionService.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { PermissionService, UpdatePermissionInput } from '@/services/permission-service';
import { ServiceContext } from '@/lib/services/types';
import { recordAuditLog } from '@/lib/audit-log';
import { logger } from '@/lib/logger';
import { wrapPiiRoute, PiiRouteParams } from '@/lib/payload-middleware';
import { checkAdminRateLimit } from '@/lib/rate-limiter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ---------------------------------------------------------------------------
// GET — Fetch permission by ID via PermissionService
// ---------------------------------------------------------------------------

export const GET = wrapPiiRoute(async (request, _decryptedBody, params) => {
  try {
    logger.info({ route: '/api/admin/permissions/[id]', method: 'GET' }, 'Request received');

    const authResult = await requireSuperAdmin(request.headers);
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: authResult.status });
    }

    const session = authResult.session!;
    const permissionId = params?.id;
    if (!permissionId) {
      return NextResponse.json({ error: 'Permission ID is required' }, { status: 400 });
    }

    const ctx: ServiceContext = {
      userId: session.user.id,
      role: 'PLATFORM_ADMIN',
    };

    const permission = await PermissionService.getById(permissionId, ctx);

    return NextResponse.json({ permission });
  } catch (error) {
    if (error instanceof Error && error.name === 'NotFoundError') {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    const isDbError = error instanceof Error && error.message.includes("Can't reach database server");
    logger.error({ err: error, route: '/api/admin/permissions/[id]', method: 'GET' }, isDbError ? '[Permissions API] Database unavailable' : '[Permissions API] Unexpected error');
    return NextResponse.json({ error: isDbError ? 'Database unavailable' : 'Internal server error' }, { status: isDbError ? 503 : 500 });
  }
});

// ---------------------------------------------------------------------------
// PATCH — Update permission via PermissionService
// ---------------------------------------------------------------------------

export const PATCH = wrapPiiRoute(async (request, decryptedBody, params) => {
  try {
    logger.info({ route: '/api/admin/permissions/[id]', method: 'PATCH' }, 'Request received');

    const authResult = await requireSuperAdmin(request.headers);
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: authResult.status });
    }

    const session = authResult.session!;

    // Rate limit admin write operations by session
    if (!checkAdminRateLimit(session.user.id)) {
      logger.warn({ userId: session.user.id }, 'Admin write rate limited');
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    }

    const permissionId = params?.id;
    if (!permissionId) {
      return NextResponse.json({ error: 'Permission ID is required' }, { status: 400 });
    }

    // Parse body from decrypted payload or raw JSON
    let body: UpdatePermissionInput;
    if (decryptedBody && typeof decryptedBody === 'object') {
      body = decryptedBody as UpdatePermissionInput;
    } else {
      const contentType = request.headers.get('Content-Type') || '';
      if (contentType.includes('application/octet-stream')) {
        return NextResponse.json(
          { error: 'Payload encryption is enabled on the client but disabled on the server. Set PAYLOAD_ENCRYPTION_MODE=permissive or enforce.' },
          { status: 400 },
        );
      }
      try {
        body = await request.json();
      } catch {
        return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
      }
    }

    const ctx: ServiceContext = {
      userId: session.user.id,
      role: 'PLATFORM_ADMIN',
    };

    const updatedPermission = await PermissionService.update(permissionId, body, ctx);

    logger.info({ userId: session.user.id, permissionId }, '[Permissions API] Permission updated');

    await recordAuditLog({
      userId: session.user.id,
      userName: (session.user as { name?: string }).name ?? undefined,
      action: 'permission.updated',
      resourceType: 'Permission',
      resourceId: permissionId,
      success: true,
    }).catch((err) => logger.error({ err }, 'Failed to record audit log for permission update'));

    return NextResponse.json({ permission: updatedPermission });
  } catch (error) {
    if (error instanceof Error && error.name === 'NotFoundError') {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof Error && error.name === 'ConflictError') {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof Error && error.name === 'ValidationError') {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const isDbError = error instanceof Error && error.message.includes("Can't reach database server");
    logger.error({ err: error, route: '/api/admin/permissions/[id]', method: 'PATCH' }, isDbError ? '[Permissions API] Database unavailable' : '[Permissions API] Unexpected error');
    return NextResponse.json({ error: isDbError ? 'Database unavailable' : 'Internal server error' }, { status: isDbError ? 503 : 500 });
  }
});

// ---------------------------------------------------------------------------
// DELETE — Delete permission via PermissionService
// ---------------------------------------------------------------------------

export const DELETE = wrapPiiRoute(async (request, _decryptedBody, params) => {
  try {
    logger.info({ route: '/api/admin/permissions/[id]', method: 'DELETE' }, 'Request received');

    const authResult = await requireSuperAdmin(request.headers);
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: authResult.status });
    }

    const session = authResult.session!;

    // Rate limit admin write operations by session
    if (!checkAdminRateLimit(session.user.id)) {
      logger.warn({ userId: session.user.id }, 'Admin write rate limited');
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    }

    const permissionId = params?.id;
    if (!permissionId) {
      return NextResponse.json({ error: 'Permission ID is required' }, { status: 400 });
    }

    const ctx: ServiceContext = {
      userId: session.user.id,
      role: 'PLATFORM_ADMIN',
    };

    await PermissionService.delete(permissionId, ctx);

    logger.info({ userId: session.user.id, permissionId }, '[Permissions API] Permission deleted');

    await recordAuditLog({
      userId: session.user.id,
      userName: (session.user as { name?: string }).name ?? undefined,
      action: 'permission.deleted',
      resourceType: 'Permission',
      resourceId: permissionId,
      success: true,
    }).catch((err) => logger.error({ err }, 'Failed to record audit log for permission delete'));

    return NextResponse.json({ message: 'Permission deleted' });
  } catch (error) {
    if (error instanceof Error && error.name === 'NotFoundError') {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof Error && error.name === 'ConflictError') {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    const isDbError = error instanceof Error && error.message.includes("Can't reach database server");
    logger.error({ err: error, route: '/api/admin/permissions/[id]', method: 'DELETE' }, isDbError ? '[Permissions API] Database unavailable' : '[Permissions API] Unexpected error');
    return NextResponse.json({ error: isDbError ? 'Database unavailable' : 'Internal server error' }, { status: isDbError ? 503 : 500 });
  }
});
