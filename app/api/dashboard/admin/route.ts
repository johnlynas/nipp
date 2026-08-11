import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import globalDb from '@/lib/global-db';

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
    const [usersTotal, orgsTotal, teamsTotal, rolesTotal, permissionsTotal] = await Promise.all([
      globalDb.user.count(),
      globalDb.organization.count(),
      globalDb.team.count(),
      globalDb.role.count(),
      globalDb.permission.count(),
    ]);

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
