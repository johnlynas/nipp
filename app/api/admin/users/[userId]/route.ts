/**
 * GET /api/admin/users/[userId]
 * PATCH /api/admin/users/[userId]
 * DELETE /api/admin/users/[userId]
 *
 * Super Admin only — single user CRUD via UserService.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { UserService, UpdateUserInput } from '@/services/user-service';
// RLS Phase 3: super-admin ops run under a verified platform context.
import { withPlatformContext } from '@/lib/platform-db';
import { ServiceContext } from '@/lib/services/types';
import { recordAuditLog } from '@/lib/audit-log';
import { logger } from '@/lib/logger';
import { wrapPiiRoute, PiiRouteParams } from '@/lib/payload-middleware';
import { checkAdminRateLimit } from '@/lib/rate-limiter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ---------------------------------------------------------------------------
// GET — Fetch user by ID via UserService
// ---------------------------------------------------------------------------

export const GET = wrapPiiRoute(async (request, _decryptedBody, params) => {
  try {
    logger.info({ route: '/api/admin/users/[userId]', method: 'GET' }, 'Request received');

    const authResult = await requireSuperAdmin(request.headers);
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: authResult.status });
    }

    const session = authResult.session!;
    const userId = params?.userId;
    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    const ctx: ServiceContext = {
      userId: session.user.id,
      role: 'PLATFORM_ADMIN',
    };

    // Verified platform context for the user read.
    const user = await withPlatformContext(session.user.id, () =>
      UserService.getById(userId, ctx)
    );

    return NextResponse.json({ user });
  } catch (error) {
    if (error instanceof Error && error.name === 'NotFoundError') {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    const isDbError = error instanceof Error && error.message.includes("Can't reach database server");
    logger.error({ err: error, route: '/api/admin/users/[userId]', method: 'GET' }, isDbError ? '[Users API] Database unavailable' : '[Users API] Unexpected error');
    return NextResponse.json({ error: isDbError ? 'Database unavailable' : 'Internal server error' }, { status: isDbError ? 503 : 500 });
  }
});

// ---------------------------------------------------------------------------
// PATCH — Update user via UserService
// ---------------------------------------------------------------------------

export const PATCH = wrapPiiRoute(async (request, decryptedBody, params) => {
  try {
    logger.info({ route: '/api/admin/users/[userId]', method: 'PATCH' }, 'Request received');

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

    const userId = params?.userId;
    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    // Parse body from decrypted payload or raw JSON
    let body: UpdateUserInput;
    if (decryptedBody && typeof decryptedBody === 'object') {
      body = decryptedBody as UpdateUserInput;
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

    // Verified platform context for the user update.
    const updatedUser = await withPlatformContext(session.user.id, () =>
      UserService.update(userId, body, ctx)
    );

    logger.info({ userId: session.user.id, targetUserId: userId }, '[Users API] User updated');

    await recordAuditLog({
      userId: session.user.id,
      userName: (session.user as { name?: string }).name ?? undefined,
      action: 'user.updated',
      resourceType: 'User',
      resourceId: userId,
      success: true,
    }).catch((err) => logger.error({ err }, 'Failed to record audit log for user update'));

    return NextResponse.json({ user: updatedUser });
  } catch (error) {
    if (error instanceof Error && error.name === 'NotFoundError') {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof Error && error.message === 'A user with this email already exists') {
      return NextResponse.json({ error: 'A user with this email already exists' }, { status: 409 });
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    const isDbError = error instanceof Error && error.message.includes("Can't reach database server");
    logger.error({ err: error, route: '/api/admin/users/[userId]', method: 'PATCH' }, isDbError ? '[Users API] Database unavailable' : '[Users API] Unexpected error');
    return NextResponse.json({ error: isDbError ? 'Database unavailable' : 'Internal server error' }, { status: isDbError ? 503 : 500 });
  }
});

// ---------------------------------------------------------------------------
// DELETE — Delete user via UserService
// ---------------------------------------------------------------------------

export const DELETE = wrapPiiRoute(async (request, _decryptedBody, params) => {
  try {
    logger.info({ route: '/api/admin/users/[userId]', method: 'DELETE' }, 'Request received');

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

    const userId = params?.userId;
    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    const ctx: ServiceContext = {
      userId: session.user.id,
      role: 'PLATFORM_ADMIN',
    };

    // Verified platform context for the user delete.
    await withPlatformContext(session.user.id, () =>
      UserService.delete(userId, ctx)
    );

    logger.info({ userId: session.user.id, targetUserId: userId }, '[Users API] User deleted');

    await recordAuditLog({
      userId: session.user.id,
      userName: (session.user as { name?: string }).name ?? undefined,
      action: 'user.deleted',
      resourceType: 'User',
      resourceId: userId,
      success: true,
    }).catch((err) => logger.error({ err }, 'Failed to record audit log for user delete'));

    return NextResponse.json({ message: 'User deleted' });
  } catch (error) {
    if (error instanceof Error && error.name === 'NotFoundError') {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    const isDbError = error instanceof Error && error.message.includes("Can't reach database server");
    logger.error({ err: error, route: '/api/admin/users/[userId]', method: 'DELETE' }, isDbError ? '[Users API] Database unavailable' : '[Users API] Unexpected error');
    return NextResponse.json({ error: isDbError ? 'Database unavailable' : 'Internal server error' }, { status: isDbError ? 503 : 500 });
  }
});
