import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { PermissionService } from '@/services/permission-service';

export const runtime = 'nodejs';

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
    const result = await PermissionService.getById(id, {
      userId: auth.session!.user.id,
      role: 'PLATFORM_ADMIN',
    });

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
    const body = await request.json();

    const result = await PermissionService.update(id, {
      key: body.key,
      resource: body.resource,
      action: body.action,
      description: body.description,
    }, { userId: auth.session!.user.id, role: 'PLATFORM_ADMIN' });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === 'Permission not found') {
      return NextResponse.json({ error: 'Permission not found' }, { status: 404 });
    }
    if (error instanceof Error && error.message?.includes('already exists')) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
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
    const result = await PermissionService.delete(id, { userId: auth.session!.user.id, role: 'PLATFORM_ADMIN' });

    if (result === null) {
      return NextResponse.json({ error: 'Cannot delete permission assigned to roles' }, { status: 409 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'Permission not found') {
      return NextResponse.json({ error: 'Permission not found' }, { status: 404 });
    }
    console.error('Failed to delete permission:', error);
    return NextResponse.json({ error: 'Failed to delete permission' }, { status: 500 });
  }
}
