import { NextResponse } from 'next/server';
import globalDb from '@/lib/global-db';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { checkAdminRateLimit } from '@/lib/rate-limiter';
import { headers as nextHeaders } from 'next/headers';

// Disable caching — this is a dynamic admin API
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/admin/organizations/list
 * Returns all tenant organizations plus the Platform organization (labeled
 * "Platform", listed first) for the super-admin org switcher. Including
 * Platform is what lets a super admin navigate back to it from a tenant.
 */
export async function GET() {
  try {
    const authResult = await requireSuperAdmin(await nextHeaders());
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: authResult.status });
    }

    // Rate limit admin operations by session
    if (!checkAdminRateLimit(authResult.session!.user.id)) {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    }

    const organizations = await globalDb.organization.findMany({
      select: {
        id: true,
        name: true,
        slug: true,
      },
    });

    const platform = organizations.filter((o) => o.slug === 'platform');
    const tenants = organizations
      .filter((o) => o.slug !== 'platform')
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({
      organizations: [
        ...platform.map((o) => ({ id: o.id, name: 'Platform', isPlatform: true })),
        ...tenants.map((o) => ({ id: o.id, name: o.name })),
      ],
    });
  } catch (error) {
    console.error('Error fetching organizations list:', error);
    return NextResponse.json({ error: 'Failed to fetch organizations' }, { status: 500 });
  }
}
