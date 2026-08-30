import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { checkAdminRateLimit } from '@/lib/rate-limiter';

import { RoleService } from '@/services/role-service';

export const runtime = 'nodejs';

/**
 * GET /api/dashboard/admin/roles/[id]/permissions
 * List permissions assigned to the role.
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
    const url = new URL(_request.url);
    const organizationId = url.searchParams.get('organizationId');

    if (!organizationId) {
      return NextResponse.json({ error: 'Organization ID is required' }, { status: 400 });
    }

    const result = await RoleService.getRolePermissions(id, organizationId, {
      userId: auth.session!.user.id,
      role: 'PLATFORM_ADMIN',
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to list role permissions:', error);
    return NextResponse.json({ error: 'Failed to fetch role permissions' }, { status: 500 });
  }
}

/**
 * POST /api/dashboard/admin/roles/[id]/permissions
 * Assign a permission to the role.
 */
export async function POST(
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
    return NextResponse.json({'error': 'rate_limited'}, {status: 429});
  }

  const body = await request.json();

    if (!body.permissionId) {
      return NextResponse.json({ error: 'Permission ID is required' }, { status: 400 });
    }

    const url = new URL(request.url);
    const organizationId = url.searchParams.get('organizationId');

    if (!organizationId) {
      return NextResponse.json({ error: 'Organization ID is required' }, { status: 400 });
    }

    const result = await RoleService.assignPermission(id, organizationId, { permissionId: body.permissionId }, {
      userId: auth.session!.user.id,
      role: 'PLATFORM_ADMIN',
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error('Failed to assign permission:', error);
    return NextResponse.json({ error: 'Failed to assign permission' }, { status: 500 });
  }
}

/**
 * DELETE /api/dashboard/admin/roles/[id]/permissions
 * Revoke a permission from the role.
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
    if (!checkAdminRateLimit(auth.session!.user.id)) {
    return NextResponse.json({'error': 'rate_limited'}, {status: 429});
  }

  const body = await request.json();

    if (!body.permissionId) {
      return NextResponse.json({ error: 'Permission ID is required' }, { status: 400 });
    }

    const url = new URL(request.url);
    const organizationId = url.searchParams.get('organizationId');

    if (!organizationId) {
      return NextResponse.json({ error: 'Organization ID is required' }, { status: 400 });
    }

    await RoleService.revokePermission(id, organizationId, body.permissionId, {
      userId: auth.session!.user.id,
      role: 'PLATFORM_ADMIN',
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to revoke permission:', error);
    return NextResponse.json({ error: 'Failed to revoke permission' }, { status: 500 });
  }
}
