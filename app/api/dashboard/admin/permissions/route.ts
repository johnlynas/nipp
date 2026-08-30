import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { checkAdminRateLimit } from '@/lib/rate-limiter';

import { PermissionService } from '@/services/permission-service';

export const runtime = 'nodejs';

/**
 * GET /api/dashboard/admin/permissions
 * List the global permission catalog with pagination and search.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSuperAdmin(request.headers);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const pageSize = parseInt(url.searchParams.get('pageSize') || '20', 10);
    const search = url.searchParams.get('search') || undefined;
    const resource = url.searchParams.get('resource') || undefined;
    const isDefault = url.searchParams.get('isDefault');

    const filters: Record<string, unknown> = {};
    if (search) filters.search = search;
    if (resource) filters.resource = resource;
    if (isDefault !== null) filters.isDefault = isDefault === 'true';

    const result = await PermissionService.list(filters as import('@/lib/services/types').PermissionFilters, { page, pageSize }, {
      userId: auth.session!.user.id,
      role: 'PLATFORM_ADMIN',
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to list permissions:', error);
    return NextResponse.json({ error: 'Failed to fetch permissions' }, { status: 500 });
  }
}

/**
 * POST /api/dashboard/admin/permissions
 * Create a new permission. Platform Admin only.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSuperAdmin(request.headers);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    // Rate limit write operations by session
    if (!checkAdminRateLimit(auth.session!.user.id)) {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    }

    const body = await request.json();

    if (!body.key || !body.resource || !body.action) {
      return NextResponse.json({ error: 'Key, resource, and action are required' }, { status: 400 });
    }

    const result = await PermissionService.create(
      { key: body.key, resource: body.resource, action: body.action, description: body.description, isDefault: body.isDefault ?? false },
      { userId: auth.session!.user.id, role: 'PLATFORM_ADMIN' }
    );

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message?.includes('already exists')) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error('Failed to create permission:', error);
    return NextResponse.json({ error: 'Failed to create permission' }, { status: 500 });
  }
}
