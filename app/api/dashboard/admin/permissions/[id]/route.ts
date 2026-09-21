import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { checkAdminRateLimit } from '@/lib/rate-limiter';

// RLS Phase 3: permission ops run under a verified platform context.
import tenantDb from '@/lib/tenant-db';
import { withPlatformContext } from '@/lib/platform-db';
import { PermissionService } from '@/services/permission-service';
import { notifyPermissionOperation } from '@/lib/notification-push';

export const runtime = 'nodejs';

/** Best effort: resolve a permission's key for notification labels (verified platform context). */
async function getPermissionLabel(sessionUserId: string, id: string): Promise<string> {
  try {
    const permission = await withPlatformContext(sessionUserId, () =>
      tenantDb.permission.findUnique({ where: { id }, select: { key: true } })
    );
    return permission ? `Permission "${permission.key}" (${id})` : id;
  } catch {
    return id;
  }
}

/**
 * GET /api/dashboard/admin/permissions/[id]
 * Get a single permission by ID.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireSuperAdmin(_request.headers);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const id = (await params).id;
    // RLS: verified platform context for the permission read.
    const result = await withPlatformContext(auth.session!.user.id, () =>
      PermissionService.getById(id, { userId: auth.session!.user.id, role: 'PLATFORM_ADMIN' })
    );

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === 'Permission not found') {
      return NextResponse.json({ error: 'Permission not found' }, { status: 404 });
    }
    console.error('Failed to get permission:', error);
    return NextResponse.json({ error: 'Failed to fetch permission' }, { status: 500 });
  }
}

/**
 * PATCH /api/dashboard/admin/permissions/[id]
 * Update a permission. Platform Admin only.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireSuperAdmin(request.headers);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const id = (await params).id;
    if (!checkAdminRateLimit(auth.session!.user.id)) {
      return NextResponse.json({ 'error': 'rate_limited' }, { status: 429 });
    }

    const body = await request.json();

    // Capture the permission key for notification labels before a rename happens.
    const targetLabel = await getPermissionLabel(auth.session!.user.id, id);

    try {
      // RLS: verified platform context wraps the update (writes stay ctx-bound via RLS).
      const result = await withPlatformContext(
        auth.session!.user.id,
        async () =>
          PermissionService.update(
            id,
            {
              key: body.key,
              resource: body.resource,
              action: body.action,
              description: body.description,
              isDefault: body.isDefault,
            },
            { userId: auth.session!.user.id, role: 'PLATFORM_ADMIN' }
          )
      );

      await notifyPermissionOperation('update', targetLabel, true);

      return NextResponse.json(result);
    } catch (error) {
      if (error instanceof Error && error.message === 'Permission not found') {
        await notifyPermissionOperation('update', id, false, 'Permission not found');
        return NextResponse.json({ error: 'Permission not found' }, { status: 404 });
      }
      console.error('Failed to update permission:', error);
      const message = error instanceof Error && error.message ? error.message : 'Failed to update permission';
      await notifyPermissionOperation('update', targetLabel, false, message);
      if (error instanceof Error && error.message?.includes('already exists')) {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
      return NextResponse.json({ error: 'Failed to update permission' }, { status: 500 });
    }
  } catch (error) {
    console.error('Failed to update permission:', error);
    return NextResponse.json({ error: 'Failed to update permission' }, { status: 500 });
  }
}

/**
 * DELETE /api/dashboard/admin/permissions/[id]
 * Delete a permission. Platform Admin only.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireSuperAdmin(request.headers);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const id = (await params).id;

    // Capture a label for the notification before the permission disappears.
    const targetLabel = await getPermissionLabel(auth.session!.user.id, id);

    let result;
    try {
      // RLS: verified platform context wraps the delete.
      result = await withPlatformContext(
        auth.session!.user.id,
        () => PermissionService.delete(id, { userId: auth.session!.user.id, role: 'PLATFORM_ADMIN' })
      );
    } catch (error) {
      await notifyPermissionOperation('delete', id, false, error instanceof Error && error.message ? error.message : 'Failed to delete permission');
      throw error;
    }

    if (result === null) {
      await notifyPermissionOperation('delete', targetLabel, false, 'Cannot delete permission — it is either assigned to roles or is a default (bootstrapped) permission');
      return NextResponse.json({ error: 'Cannot delete permission — it is either assigned to roles or is a default (bootstrapped) permission' }, { status: 409 });
    }

    await notifyPermissionOperation('delete', targetLabel, true);

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'Permission not found') {
      return NextResponse.json({ error: 'Permission not found' }, { status: 404 });
    }
    console.error('Failed to delete permission:', error);
    return NextResponse.json({ error: 'Failed to delete permission' }, { status: 500 });
  }
}
