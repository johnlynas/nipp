import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { checkAdminRateLimit } from '@/lib/rate-limiter';

import globalDb from '@/lib/global-db';
import { ResourceService } from '@/services/resource-service';
import { notifyResourceOperation } from '@/lib/notification-push';

export const runtime = 'nodejs';

/**
 * GET /api/dashboard/admin/resources
 * List resources with pagination and search.
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

    const filters: import('@/services/resource-service').ResourceFilters = {};
    if (search) filters.search = search;

    const result = await ResourceService.list(filters, { page, pageSize }, {
      userId: auth.session!.user.id,
      role: 'PLATFORM_ADMIN',
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to list resources:', error);
    return NextResponse.json({ error: 'Failed to fetch resources' }, { status: 500 });
  }
}

/**
 * POST /api/dashboard/admin/resources
 * Create a new resource. Platform Admin only.
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

    if (!body.name || body.name.trim() === '') {
      return NextResponse.json({ error: 'Resource name is required' }, { status: 400 });
    }

    const targetLabel = body.name ? `Resource "${body.name.trim()}"` : 'resource';

    try {
      const result = await ResourceService.create(
        { name: body.name, description: body.description, roleIds: body.roleIds },
        { userId: auth.session!.user.id, role: 'PLATFORM_ADMIN' }
      );

      await notifyResourceOperation('create', targetLabel, true);

      return NextResponse.json(result, { status: 201 });
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : 'Failed to create resource';
      await notifyResourceOperation('create', targetLabel, false, message);
      if (error instanceof Error && error.message?.includes('already exists')) {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
      if (error instanceof Error && error.message?.includes('required')) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      console.error('Failed to create resource:', error);
      return NextResponse.json({ error: 'Failed to create resource' }, { status: 500 });
    }
  } catch (error) {
    console.error('Failed to create resource:', error);
    return NextResponse.json({ error: 'Failed to create resource' }, { status: 500 });
  }
}
