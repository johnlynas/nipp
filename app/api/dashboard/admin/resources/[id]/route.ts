import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { checkAdminRateLimit } from '@/lib/rate-limiter';

// RLS Phase 3: resource ops run under a verified platform context.
import tenantDb from '@/lib/tenant-db';
import { withPlatformContext } from '@/lib/platform-db';
import { ResourceService } from '@/services/resource-service';
import { notifyResourceOperation } from '@/lib/notification-push';

export const runtime = 'nodejs';

/** Best effort: resolve a resource's name for notification labels (verified platform context). */
async function getResourceLabel(sessionUserId: string, id: string): Promise<string> {
  try {
    const resource = await withPlatformContext(sessionUserId, () =>
      tenantDb.resource.findUnique({ where: { id }, select: { name: true } })
    );
    return resource ? `Resource "${resource.name}" (${id})` : id;
  } catch {
    return id;
  }
}

/**
 * GET /api/dashboard/admin/resources/[id]
 * Get a single resource by ID with assigned roles.
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
    // RLS: verified platform context for the resource read.
    const result = await withPlatformContext(auth.session!.user.id, () =>
      ResourceService.getById(id, { userId: auth.session!.user.id, role: 'PLATFORM_ADMIN' })
    );

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === 'Resource not found') {
      return NextResponse.json({ error: 'Resource not found' }, { status: 404 });
    }
    console.error('Failed to get resource:', error);
    return NextResponse.json({ error: 'Failed to fetch resource' }, { status: 500 });
  }
}

/**
 * PATCH /api/dashboard/admin/resources/[id]
 * Update a resource. Platform Admin only.
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

    // Capture the resource name for notification labels before a rename happens.
    const targetLabel = await getResourceLabel(auth.session!.user.id, id);

    try {
      // RLS: verified platform context wraps the update (writes stay ctx-bound via RLS).
      const result = await withPlatformContext(
        auth.session!.user.id,
        async () =>
          ResourceService.update(
            id,
            {
              name: body.name,
              description: body.description,
              roleIds: body.roleIds,
            },
            { userId: auth.session!.user.id, role: 'PLATFORM_ADMIN' }
          )
      );

      await notifyResourceOperation('update', targetLabel, true);

      return NextResponse.json(result);
    } catch (error) {
      if (error instanceof Error && error.message === 'Resource not found') {
        await notifyResourceOperation('update', id, false, 'Resource not found');
        return NextResponse.json({ error: 'Resource not found' }, { status: 404 });
      }
      console.error('Failed to update resource:', error);
      const message = error instanceof Error && error.message ? error.message : 'Failed to update resource';
      await notifyResourceOperation('update', targetLabel, false, message);
      if (error instanceof Error && error.message?.includes('already exists')) {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
      return NextResponse.json({ error: 'Failed to update resource' }, { status: 500 });
    }
  } catch (error) {
    console.error('Failed to update resource:', error);
    return NextResponse.json({ error: 'Failed to update resource' }, { status: 500 });
  }
}

/**
 * DELETE /api/dashboard/admin/resources/[id]
 * Delete a resource. Platform Admin only.
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

    // Capture a label for the notification before the resource disappears.
    const targetLabel = await getResourceLabel(auth.session!.user.id, id);

    let result;
    try {
      // RLS: verified platform context wraps the delete.
      result = await withPlatformContext(
        auth.session!.user.id,
        () => ResourceService.delete(id, { userId: auth.session!.user.id, role: 'PLATFORM_ADMIN' })
      );
    } catch (error) {
      await notifyResourceOperation('delete', id, false, error instanceof Error && error.message ? error.message : 'Failed to delete resource');
      throw error;
    }

    if (result === null) {
      await notifyResourceOperation('delete', targetLabel, false, 'Cannot delete resource with assigned roles');
      return NextResponse.json({ error: 'Cannot delete resource with assigned roles' }, { status: 409 });
    }

    await notifyResourceOperation('delete', targetLabel, true);

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'Resource not found') {
      return NextResponse.json({ error: 'Resource not found' }, { status: 404 });
    }
    if (error instanceof Error && error.message === 'Cannot delete resource with assigned roles') {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error('Failed to delete resource:', error);
    return NextResponse.json({ error: 'Failed to delete resource' }, { status: 500 });
  }
}
