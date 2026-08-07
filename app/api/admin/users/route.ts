/**
 * GET /api/admin/users
 * POST /api/admin/users
 *
 * Super Admin only — user catalog CRUD via UserService.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { UserService, CreateUserInput } from '@/services/user-service';
import { ServiceContext } from '@/lib/services/types';
import { recordAuditLog } from '@/lib/audit-log';
import { logger } from '@/lib/logger';
import { wrapPiiRoute } from '@/lib/payload-middleware';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ---------------------------------------------------------------------------
// GET — List users (paginated) via UserService
// ---------------------------------------------------------------------------

export const GET = wrapPiiRoute(async (request) => {
  try {
    logger.info({ route: '/api/admin/users', method: 'GET' }, 'Request received');

    const authResult = await requireSuperAdmin(request.headers);
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: authResult.status });
    }

    const session = authResult.session!;

    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const pageSize = parseInt(url.searchParams.get('pageSize') || '8', 10);
    const search = url.searchParams.get('search') || undefined;
    const role = url.searchParams.get('role') || undefined;
    const organizationId = url.searchParams.get('organizationId') || undefined;

    const ctx: ServiceContext = {
      userId: session.user.id,
      role: 'PLATFORM_ADMIN',
    };

    const result = await UserService.list({ search, role, organizationId }, { page, pageSize }, ctx);

    logger.info({ userId: session.user.id, count: result.items.length }, '[Users API] Fetched users');
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
    });
  } catch (error) {
    const isDbError = error instanceof Error && error.message.includes('Can\'t reach database server');
    logger.error({ err: error, route: '/api/admin/users', method: 'GET' }, isDbError ? '[Users API] Database unavailable' : '[Users API] Unexpected error');
    return NextResponse.json({ error: isDbError ? 'Database unavailable' : 'Internal server error' }, { status: isDbError ? 503 : 500 });
  }
});

// ---------------------------------------------------------------------------
// POST — Create user via UserService
// ---------------------------------------------------------------------------

export const POST = wrapPiiRoute(async (request, decryptedBody) => {
  try {
    logger.info({ route: '/api/admin/users', method: 'POST' }, 'Request received');

    const authResult = await requireSuperAdmin(request.headers);
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: authResult.status });
    }

    const session = authResult.session!;

    // Parse body from decrypted payload or raw JSON
    let body: CreateUserInput;
    if (decryptedBody && typeof decryptedBody === 'object') {
      body = decryptedBody as CreateUserInput;
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

    // Accept optional organizationId from body for platform admins to target specific orgs.
    const targetOrgId = body.organizationId;

    const ctx: ServiceContext = {
      userId: session.user.id,
      role: 'PLATFORM_ADMIN',
      organizationId: targetOrgId,
    };

    const user = await UserService.create(body, ctx);

    logger.info({ userId: session.user.id, createdUserId: user.id }, '[Users API] User created');

    await recordAuditLog({
      userId: session.user.id,
      userName: (session.user as { name?: string }).name ?? undefined,
      action: 'user.created',
      resourceType: 'User',
      resourceId: user.id,
      success: true,
    }).catch((err) => logger.error({ err }, 'Failed to record audit log for user creation'));

    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.name === 'ValidationError') {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof Error && error.message === 'A user with this email already exists') {
      return NextResponse.json({ error: 'A user with this email already exists' }, { status: 409 });
    }
    const isDbError = error instanceof Error && error.message.includes('Can\'t reach database server');
    logger.error({ err: error, route: '/api/admin/users', method: 'POST' }, isDbError ? '[Users API] Database unavailable' : '[Users API] Unexpected error');
    return NextResponse.json({ error: isDbError ? 'Database unavailable' : 'Internal server error' }, { status: isDbError ? 503 : 500 });
  }
});
