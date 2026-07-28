/**
 * GET /api/admin/permissions
 * POST /api/admin/permissions
 *
 * Super Admin only — global permission catalog CRUD.
 * PATCH and DELETE live in ./[id]/route.ts
 */

import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { requireSuperAdmin, enterSuperAdminContext } from '@/lib/require-super-admin';
// Admin routes use globalDb for super-admin operations
import { setRLSContext } from '@/lib/rls';
import globalDb from '@/lib/global-db';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { isSameSiteRequest } from '@/lib/csrf';

export const runtime = 'nodejs';

// Cache permission catalog for 60 seconds (P7 - server-side caching)
export const revalidate = 60;

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
    const orgId = (session as { session?: { activeOrganizationId?: string } }).session?.activeOrganizationId || env.PLATFORM_ORGANIZATION_ID!;

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

    const where: {
      resource?: string;
      OR?: Array<
        | { key: { contains: string; mode: 'insensitive' } }
        | { description: { contains: string; mode: 'insensitive' } }
      >;
    } = {};
    if (resource) {
      where.resource = resource;
    }
    if (search) {
      where.OR = [
        { key: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const permissions = await globalDb.permission.findMany({
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
    const orgId = (session as { session?: { activeOrganizationId?: string } }).session?.activeOrganizationId || env.PLATFORM_ORGANIZATION_ID!;

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

    const permission = await globalDb.permission.create({
      data: { key, resource, action, description },
    });

    logger.info({ userId: session.user.id, permissionId: permission.id }, '[Permissions API] Permission created');
    // P7: Invalidate cached permissions
    revalidateTag('permission');
    return NextResponse.json({ permission }, { status: 201 });
  } catch (error) {
    const isDbError = error instanceof Error && error.message.includes('Can\'t reach database server');
    logger.error({ err: error, route: '/api/admin/permissions', method: 'POST' }, isDbError ? '[Permissions API] Database unavailable' : '[Permissions API] Unexpected error');
    return NextResponse.json({ error: isDbError ? 'Database unavailable' : 'Internal Server Error' }, { status: isDbError ? 503 : 500 });
  }
}