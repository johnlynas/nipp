import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
// RLS Phase 3: aggregate stats run under a verified platform context.
import tenantDb from '@/lib/tenant-db';
import { withPlatformContext } from '@/lib/platform-db';

export const runtime = 'nodejs';

/**
 * GET /api/dashboard/admin/stats
 * Returns aggregate counts across all models.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSuperAdmin(request.headers);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    // Verified platform context: the flag-1 policies admit all rows, and the
    // tenant extension passes through (no org auto-injection), so these counts
    // are cross-org — matching the pre-cutover globalDb behaviour.
    const [usersTotal, orgsTotal, teamsTotal, rolesTotal, permissionsTotal] = await withPlatformContext(
      auth.session!.user.id,
      () =>
        Promise.all([
          tenantDb.user.count(),
          tenantDb.organization.count(),
          tenantDb.team.count(),
          tenantDb.role.count(),
          tenantDb.permission.count(),
        ]),
    );

    return NextResponse.json({
      users: { total: usersTotal },
      organizations: { total: orgsTotal },
      teams: { total: teamsTotal },
      roles: { total: rolesTotal },
      permissions: { total: permissionsTotal },
    });
  } catch (error) {
    console.error('Failed to fetch stats:', error);
    return NextResponse.json({ error: 'Failed to fetch statistics' }, { status: 500 });
  }
}
