/**
 * GET /api/admin/permissions/resources
 *
 * Super Admin only — returns a sorted list of all unique resource types.
 */

import { NextResponse } from 'next/server';
// RLS Phase 3: resource-type listing runs under the verified platform context.
import tenantDb from '@/lib/tenant-db';
import { withPlatformContext } from '@/lib/platform-db';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { checkAdminRateLimit } from '@/lib/rate-limiter';
import { wrapPiiRoute } from '@/lib/payload-middleware';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const GET = wrapPiiRoute(async (request) => {
  try {
    const authResult = await requireSuperAdmin(request.headers);
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: authResult.status });
    }

    // Rate limit admin operations by session
    if (!checkAdminRateLimit(authResult.session!.user.id)) {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    }

    const resources = await withPlatformContext(authResult.session!.user.id, () =>
      tenantDb.permission.findMany({
        select: { resource: true },
        distinct: ['resource'],
        orderBy: { resource: 'asc' },
      }),
    );

    return NextResponse.json({ resources: resources.map((r) => r.resource) });
  } catch (error) {
    const isDbError = error instanceof Error && error.message.includes('Can\'t reach database server');
    return NextResponse.json(
      { error: isDbError ? 'Database unavailable' : 'Internal server error' },
      { status: isDbError ? 503 : 500 },
    );
  }
});
