/**
 * GET /api/admin/roles/[roleId]
 * PATCH /api/admin/roles/[roleId]
 * DELETE /api/admin/roles/[roleId]
 *
 * Super Admin only — single role CRUD via RoleService.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { RoleService, UpdateRoleInput } from '@/services/role-service';
import { ServiceContext } from '@/lib/services/types';
import { recordAuditLog } from '@/lib/audit-log';
import { logger } from '@/lib/logger';
import { wrapPiiRoute, PiiRouteParams } from '@/lib/payload-middleware';
import { env } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ---------------------------------------------------------------------------
// GET — Fetch role by ID via RoleService
// ---------------------------------------------------------------------------

export const GET = wrapPiiRoute(async (request, _decryptedBody, params) => {
  try {
    logger.info({ route: '/api/admin/roles/[roleId]', method: 'GET' }, 'Request received');

    const authResult = await requireSuperAdmin(request.headers);
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: authResult.status });
    }

    const session = authResult.session!;
    const roleId = params?.roleId;
    if (!roleId) {
      return NextResponse.json({ error: 'Role ID is required' }, { status: 400 });
    }

    const targetOrgId = env.PLATFORM_ORGANIZATION_ID!;

    const ctx: ServiceContext = {
      userId: session.user.id,
      role: 'PLATFORM_ADMIN',
    };

    const role = await RoleService.getById(roleId, targetOrgId, ctx);

    return NextResponse.json({ role });
  } catch (error) {
    if (error instanceof Error && error.name === 'NotFoundError') {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    const isDbError = error instanceof Error && error.message.includes('Can\'t reach database server');
    logger.error({ err: error, route: '/api/admin/roles/[roleId]', method: 'GET' }, isDbError ? '[Roles API] Database unavailable' : '[Roles API] Unexpected error');
    return NextResponse.json({ error: isDbError ? 'Database unavailable' : 'Internal server error' }, { status: isDbError ? 503 : 500 });
  }
});

// ---------------------------------------------------------------------------
// PATCH — Update role via RoleService
// ---------------------------------------------------------------------------

export const PATCH = wrapPiiRoute(async (request, decryptedBody, params) => {
  try {
    logger.info({ route: '/api/admin/roles/[roleId]', method: 'PATCH' }, 'Request received');

    const authResult = await requireSuperAdmin(request.headers);
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: authResult.status });
    }

    const session = authResult.session!;
    const roleId = params?.roleId;
    if (!roleId) {
      return NextResponse.json({ error: 'Role ID is required' }, { status: 400 });
    }

    // Accept optional organizationId from body for platform admins to target specific orgs.
    // Falls back to PLATFORM_ORGANIZATION_ID for backward compatibility.
    let targetOrgId = env.PLATFORM_ORGANIZATION_ID!;

    // Parse body from decrypted payload or raw JSON
    let body: UpdateRoleInput;
    if (decryptedBody && typeof decryptedBody === 'object') {
      body = decryptedBody as UpdateRoleInput;
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

    // Extract organizationId from body if provided
    const bodyOrgId = (body as Record<string, unknown>).organizationId as string | undefined;
    if (bodyOrgId) {
      targetOrgId = bodyOrgId;
    }

    const ctx: ServiceContext = {
      userId: session.user.id,
      role: 'PLATFORM_ADMIN',
    };

    const updatedRole = await RoleService.update(roleId, body, targetOrgId, ctx);

    logger.info({ userId: session.user.id, roleId }, '[Roles API] Role updated');

    await recordAuditLog({
      userId: session.user.id,
      userName: (session.user as { name?: string }).name ?? undefined,
      action: 'role.updated',
      resourceType: 'Role',
      resourceId: roleId,
      success: true,
    }).catch((err) => logger.error({ err }, 'Failed to record audit log for role update'));

    return NextResponse.json({ role: updatedRole });
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
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    const isDbError = error instanceof Error && error.message.includes('Can\'t reach database server');
    logger.error({ err: error, route: '/api/admin/roles/[roleId]', method: 'PATCH' }, isDbError ? '[Roles API] Database unavailable' : '[Roles API] Unexpected error');
    return NextResponse.json({ error: isDbError ? 'Database unavailable' : 'Internal server error' }, { status: isDbError ? 503 : 500 });
  }
});

// ---------------------------------------------------------------------------
// DELETE — Delete role via RoleService
// ---------------------------------------------------------------------------

export const DELETE = wrapPiiRoute(async (request, _decryptedBody, params) => {
  try {
    logger.info({ route: '/api/admin/roles/[roleId]', method: 'DELETE' }, 'Request received');

    const authResult = await requireSuperAdmin(request.headers);
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: authResult.status });
    }

    const session = authResult.session!;
    const roleId = params?.roleId;
    if (!roleId) {
      return NextResponse.json({ error: 'Role ID is required' }, { status: 400 });
    }

    const targetOrgId = env.PLATFORM_ORGANIZATION_ID!;

    const ctx: ServiceContext = {
      userId: session.user.id,
      role: 'PLATFORM_ADMIN',
    };

    await RoleService.delete(roleId, targetOrgId, ctx);

    logger.info({ userId: session.user.id, roleId }, '[Roles API] Role deleted');

    await recordAuditLog({
      userId: session.user.id,
      userName: (session.user as { name?: string }).name ?? undefined,
      action: 'role.deleted',
      resourceType: 'Role',
      resourceId: roleId,
      success: true,
    }).catch((err) => logger.error({ err }, 'Failed to record audit log for role delete'));

    return NextResponse.json({ message: 'Role deleted' });
  } catch (error) {
    if (error instanceof Error && error.name === 'NotFoundError') {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof Error && error.name === 'ConflictError') {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    const isDbError = error instanceof Error && error.message.includes('Can\'t reach database server');
    logger.error({ err: error, route: '/api/admin/roles/[roleId]', method: 'DELETE' }, isDbError ? '[Roles API] Database unavailable' : '[Roles API] Unexpected error');
    return NextResponse.json({ error: isDbError ? 'Database unavailable' : 'Internal server error' }, { status: isDbError ? 503 : 500 });
  }
});
