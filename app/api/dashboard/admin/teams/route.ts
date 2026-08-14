import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import globalDb from '@/lib/global-db';
import { TeamService } from '@/services/team-service';

export const runtime = 'nodejs';

/**
 * GET /api/dashboard/admin/teams
 * List teams with pagination, search, and org filter.
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
    const organizationId = url.searchParams.get('organizationId') || undefined;
    const search = url.searchParams.get('search') || undefined;

    // If no organizationId, fetch teams across all organizations
    if (!organizationId) {
      const allOrgs = await globalDb.organization.findMany({
        select: { id: true },
      });

      // Fetch ALL teams from each org (no per-org pagination), then paginate the merged result
      const allTeams = await Promise.all(
        allOrgs.map((org) =>
          TeamService.getTeamsByOrg(org.id, {
            userId: auth.session!.user.id,
            role: 'PLATFORM_ADMIN',
          }, 1, 10000)
        )
      );

      // Merge results from all orgs
      const teams = allTeams.flatMap((r) => r.teams);
      const total = teams.length;

      // Apply search filter client-side
      let filteredTeams = teams;
      if (search) {
        filteredTeams = teams.filter((t) =>
          t.name.toLowerCase().includes(search.toLowerCase()) ||
          (t.slug && t.slug.toLowerCase().includes(search.toLowerCase()))
        );
      }

      const totalPages = Math.max(1, Math.ceil(filteredTeams.length / pageSize));
      const start = (page - 1) * pageSize;

      return NextResponse.json({
        teams: filteredTeams.slice(start, start + pageSize),
        pagination: { page, pageSize, total: filteredTeams.length, totalPages },
      });
    }

    const result = await TeamService.getTeamsByOrg(organizationId, {
      userId: auth.session!.user.id,
      role: 'PLATFORM_ADMIN',
    }, page, pageSize);

    // Apply search filter client-side since the service doesn't support it
    if (search) {
      result.teams = result.teams.filter((t) =>
        t.name.toLowerCase().includes(search.toLowerCase()) ||
        (t.slug && t.slug.toLowerCase().includes(search.toLowerCase()))
      );
      result.pagination.total = result.teams.length;
      result.pagination.totalPages = Math.max(1, Math.ceil(result.pagination.total / result.pagination.pageSize));
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to list teams:', error);
    return NextResponse.json({ error: 'Failed to fetch teams' }, { status: 500 });
  }
}

/**
 * POST /api/dashboard/admin/teams
 * Create a new team.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSuperAdmin(request.headers);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const body = await request.json();
    const organizationId = body.organizationId;

    if (!organizationId) {
      return NextResponse.json({ error: 'Organization ID is required' }, { status: 400 });
    }

    const result = await TeamService.createTeam(
      { name: body.name, slug: body.slug, description: body.description },
      organizationId,
      { userId: auth.session!.user.id, role: 'PLATFORM_ADMIN' }
    );

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error('Failed to create team:', error);
    return NextResponse.json({ error: 'Failed to create team' }, { status: 500 });
  }
}
