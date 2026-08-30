import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { checkAdminRateLimit } from '@/lib/rate-limiter';

import { RoleService } from '@/services/role-service';

export const runtime = 'nodejs';

/**
 * GET /api/dashboard/admin/roles/[id]
 * Get a single role by ID.
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
    // Get role to find its orgId first
    const url = new URL(_request.url);
    const organizationId = url.searchParams.get('organizationId');

    if (!organizationId) {
      return NextResponse.json({ error: 'Organization ID is required' }, { status: 400 });
    }

    const result = await RoleService.getById(id, organizationId, {
      userId: auth.session!.user.id,
      role: 'PLATFORM_ADMIN',
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === 'Role not found') {
      return NextResponse.json({ error: 'Role not found' }, { status: 404 });
    }
    console.error('Failed to get role:', error);
    return NextResponse.json({ error: 'Failed to fetch role' }, { status: 500 });
  }
}

/**
 * PATCH /api/dashboard/admin/roles/[id]
 * Update a role.
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
    return NextResponse.json({'error': 'rate_limited'}, {status: 429});
  }

  const body = await request.json();

    // Get role to find its orgId first
    const url = new URL(request.url);
    const organizationId = url.searchParams.get('organizationId');

    if (!organizationId) {
      return NextResponse.json({ error: 'Organization ID is required' }, { status: 400 });
    }

    const result = await RoleService.update(id, {
      name: body.name,
      description: body.description,
      isDefault: body.isDefault,
    }, organizationId, { userId: auth.session!.user.id, role: 'PLATFORM_ADMIN' });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === 'Role not found') {
      return NextResponse.json({ error: 'Role not found' }, { status: 404 });
    }
    console.error('Failed to update role:', error);
    return NextResponse.json({ error: 'Failed to update role' }, { status: 500 });
  }
}

/**
 * DELETE /api/dashboard/admin/roles/[id]
 * Delete a role.
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

    // Get role to find its orgId first
    const url = new URL(request.url);
    const organizationId = url.searchParams.get('organizationId');

    if (!organizationId) {
      return NextResponse.json({ error: 'Organization ID is required' }, { status: 400 });
    }

    await RoleService.delete(id, organizationId, {
      userId: auth.session!.user.id,
      role: 'PLATFORM_ADMIN',
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'Role not found') {
      return NextResponse.json({ error: 'Role not found' }, { status: 404 });
    }
    if (error instanceof Error && error.message?.includes('Cannot delete role')) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error('Failed to delete role:', error);
    return NextResponse.json({ error: 'Failed to delete role' }, { status: 500 });
  }
}
