/**
 * GET /api/admin/permissions
 * POST /api/admin/permissions
 *
 * Super Admin only — global permission catalog CRUD.
 * PATCH and DELETE live in ./[id]/route.ts
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { PermissionService, CreatePermissionInput } from '@/services/permission-service';
// RLS Phase 3: super-admin ops run under a verified platform context.
import { withPlatformContext } from '@/lib/platform-db';
import { ServiceContext } from '@/lib/services/types';
import { recordAuditLog } from '@/lib/audit-log';
import { logger } from '@/lib/logger';
import { wrapPiiRoute } from '@/lib/payload-middleware';
import { checkAdminRateLimit } from '@/lib/rate-limiter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ---------------------------------------------------------------------------
// GET — List permissions (paginated) via PermissionService
// ---------------------------------------------------------------------------

export const GET = wrapPiiRoute(async (request) => {
  try {
    logger.info({ route: '/api/admin/permissions', method: 'GET' }, 'Request received');

    const authResult = await requireSuperAdmin(request.headers);
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: authResult.status });
    }

    const session = authResult.session!;

    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const pageSize = parseInt(url.searchParams.get('pageSize') || '8', 10);
    const resource = url.searchParams.get('resource') || undefined;
    const search = url.searchParams.get('search') || undefined;

    const ctx: ServiceContext = {
      userId: session.user.id,
      role: 'PLATFORM_ADMIN',
    };

    // One verified platform context for the catalog listing.
    const result = await withPlatformContext(session.user.id, () =>
      PermissionService.list(
        { resource, search },
        { page, pageSize },
        ctx,
      )
    );

    logger.info({ userId: session.user.id, count: result.items.length }, '[Permissions API] Fetched permissions');
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
    });
  } catch (error) {
    const isDbError = error instanceof Error && error.message.includes("Can't reach database server");
    logger.error({ err: error, route: '/api/admin/permissions', method: 'GET' }, isDbError ? '[Permissions API] Database unavailable' : '[Permissions API] Unexpected error');
    return NextResponse.json({ error: isDbError ? 'Database unavailable' : 'Internal server error' }, { status: isDbError ? 503 : 500 });
  }
});

// ---------------------------------------------------------------------------
// POST — Create permission via PermissionService
// ---------------------------------------------------------------------------

export const POST = wrapPiiRoute(async (request, decryptedBody) => {
  try {
    logger.info({ route: '/api/admin/permissions', method: 'POST' }, 'Request received');

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

    // Parse body from decrypted payload or raw JSON
    let body: CreatePermissionInput;
    if (decryptedBody && typeof decryptedBody === 'object') {
      body = decryptedBody as CreatePermissionInput;
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

    // Verified platform context for the catalog insert.
    const permission = await withPlatformContext(session.user.id, () =>
      PermissionService.create(body, ctx)
    );

    logger.info({ userId: session.user.id, permissionId: permission.id }, '[Permissions API] Permission created');

    await recordAuditLog({
      userId: session.user.id,
      userName: (session.user as { name?: string }).name ?? undefined,
      action: 'permission.created',
      resourceType: 'Permission',
      resourceId: permission.id,
      success: true,
    }).catch((err) => logger.error({ err }, 'Failed to record audit log for permission creation'));

    return NextResponse.json({ permission }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.name === 'ValidationError') {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof Error && error.name === 'ConflictError') {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    const isDbError = error instanceof Error && error.message.includes("Can't reach database server");
    logger.error({ err: error, route: '/api/admin/permissions', method: 'POST' }, isDbError ? '[Permissions API] Database unavailable' : '[Permissions API] Unexpected error');
    return NextResponse.json({ error: isDbError ? 'Database unavailable' : 'Internal server error' }, { status: isDbError ? 503 : 500 });
  }
});
