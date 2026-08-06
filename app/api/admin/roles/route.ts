/**
 * GET /api/admin/roles
 * POST /api/admin/roles
 *
 * Super Admin only — global role catalog CRUD via RoleService.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { RoleService, CreateRoleInput } from '@/services/role-service';
import { ServiceContext } from '@/lib/services/types';
import { recordAuditLog } from '@/lib/audit-log';
import { logger } from '@/lib/logger';
import { wrapPiiRoute } from '@/lib/payload-middleware';
import { env } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ---------------------------------------------------------------------------
// GET — List roles (paginated) via RoleService
// ---------------------------------------------------------------------------

export const GET = wrapPiiRoute(async (request) => {
  try {
    logger.info({ route: '/api/admin/roles', method: 'GET' }, 'Request received');

    const authResult = await requireSuperAdmin(request.headers);
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: authResult.status });
    }

    const session = authResult.session!;
    const targetOrgId = env.PLATFORM_ORGANIZATION_ID!;

    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const pageSize = parseInt(url.searchParams.get('pageSize') || '8', 10);
    const search = url.searchParams.get('search') || undefined;
    const isDefaultRaw = url.searchParams.get('isDefault');
    const isDefault = isDefaultRaw === 'true' ? true : isDefaultRaw === 'false' ? false : undefined;

    const ctx: ServiceContext = {
      userId: session.user.id,
      role: 'PLATFORM_ADMIN',
    };

    const result = await RoleService.list(targetOrgId, { search, isDefault }, { page, pageSize }, ctx);

    logger.info({ userId: session.user.id, count: result.items.length }, '[Roles API] Fetched roles');
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
    });
  } catch (error) {
    const isDbError = error instanceof Error && error.message.includes('Can\'t reach database server');
    logger.error({ err: error, route: '/api/admin/roles', method: 'GET' }, isDbError ? '[Roles API] Database unavailable' : '[Roles API] Unexpected error');
    return NextResponse.json({ error: isDbError ? 'Database unavailable' : 'Internal server error' }, { status: isDbError ? 503 : 500 });
  }
});

// ---------------------------------------------------------------------------
// POST — Create role via RoleService
// ---------------------------------------------------------------------------

export const POST = wrapPiiRoute(async (request, decryptedBody) => {
  try {
    logger.info({ route: '/api/admin/roles', method: 'POST' }, 'Request received');

    const authResult = await requireSuperAdmin(request.headers);
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: authResult.status });
    }

    const session = authResult.session!;
    const targetOrgId = env.PLATFORM_ORGANIZATION_ID!;

    // Parse body from decrypted payload or raw JSON
    let body: CreateRoleInput;
    if (decryptedBody && typeof decryptedBody === 'object') {
      body = decryptedBody as CreateRoleInput;
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

    const role = await RoleService.create(body, targetOrgId, ctx);

    logger.info({ userId: session.user.id, roleId: role.id }, '[Roles API] Role created');

    await recordAuditLog({
      userId: session.user.id,
      userName: (session.user as { name?: string }).name ?? undefined,
      action: 'role.created',
      resourceType: 'Role',
      resourceId: role.id,
      success: true,
    }).catch((err) => logger.error({ err }, 'Failed to record audit log for role creation'));

    return NextResponse.json({ role }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.name === 'ValidationError') {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof Error && error.name === 'ConflictError') {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    const isDbError = error instanceof Error && error.message.includes('Can\'t reach database server');
    logger.error({ err: error, route: '/api/admin/roles', method: 'POST' }, isDbError ? '[Roles API] Database unavailable' : '[Roles API] Unexpected error');
    return NextResponse.json({ error: isDbError ? 'Database unavailable' : 'Internal server error' }, { status: isDbError ? 503 : 500 });
  }
});
