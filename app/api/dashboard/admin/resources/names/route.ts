import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { checkAdminRateLimit } from '@/lib/rate-limiter';

// RLS Phase 3: verified platform context for the platform resource catalog.
import tenantDb from '@/lib/tenant-db';
import { withPlatformContext } from '@/lib/platform-db';

export const runtime = 'nodejs';

/**
 * GET /api/dashboard/admin/resources/names
 * Returns a sorted list of all resource names. Used by the permissions page
 * to populate its "Filter by Resource" dropdown directly from the resource catalog.
 */
export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    // Resource is RLS-exempt (platform catalog); verified context kept for consistency.
    const resources = await withPlatformContext(auth.session!.user.id, () =>
      tenantDb.resource.findMany({ select: { name: true }, orderBy: { name: 'asc' } })
    );

    const names = resources.map((r) => r.name);
    return NextResponse.json({ names });
  } catch (error) {
    console.error('Failed to fetch resource names:', error);
    return NextResponse.json({ error: 'Failed to fetch resource names' }, { status: 500 });
  }
}
