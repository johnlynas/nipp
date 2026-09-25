import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { checkAdminRateLimit } from '@/lib/rate-limiter';

// RLS Phase 3: team list runs under a verified platform context (cross-org);
// the create TARGETS ONE specific org, so it runs under a verified tenant-admin
// context bound to that org — the Team policy's INSERT WITH CHECK binds writes
// to app.current_org_id, which must equal the target org (42501 otherwise).
import tenantDb from '@/lib/tenant-db';
import { withPlatformContext, withTenantAdminContext } from '@/lib/platform-db';
import { TeamService } from '@/services/team-service';
import { notifyTeamOperation } from '@/lib/notification-push';

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

    // RLS: one verified platform context for the whole cross-org listing.
    return withPlatformContext(auth.session!.user.id, async () => {
    // If no organizationId, fetch teams across all organizations
    if (!organizationId) {
      const allOrgs = await tenantDb.organization.findMany({ select: { id: true } });

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

    // Single-org listing under the same platform context (Team RLS is flag-gated).
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
    });
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
    // Rate limit write operations by session
    if (!checkAdminRateLimit(auth.session!.user.id)) {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    }

    let body: { name?: string; slug?: string; description?: string | null; organizationId?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const targetLabel = body.name ? `Team "${body.name}"` : 'team';

    if (!body.organizationId) {
      return NextResponse.json({ error: 'Organization ID is required' }, { status: 400 });
    }
    if (!body.name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    try {
      // Capture to consts so narrowing survives into the closure.
      const teamName = body.name;
      const targetOrgId = body.organizationId;
      // RLS: binding must carry the TARGET org (Team INSERT's WITH CHECK binds
      // the row to app.current_org_id). Platform-org context 42501s here.
      const result = await withTenantAdminContext(auth.session!.user.id, targetOrgId, () =>
        TeamService.createTeam(
          { name: teamName, slug: body.slug, description: body.description ?? undefined },
          targetOrgId,
          { userId: auth.session!.user.id, role: 'PLATFORM_ADMIN' }
        )
      );

      await notifyTeamOperation('create', targetLabel, true, undefined, result.organizationId);

      return NextResponse.json(result, { status: 201 });
    } catch (error) {
      console.error('Failed to create team:', error);
      const message = error instanceof Error && error.message ? error.message : 'Failed to create team';
      await notifyTeamOperation('create', targetLabel, false, message, body.organizationId!);
      return NextResponse.json({ error: 'Failed to create team' }, { status: 500 });
    }
  } catch (error) {
    console.error('Failed to create team:', error);
    return NextResponse.json({ error: 'Failed to create team' }, { status: 500 });
  }
}
