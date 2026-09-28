import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { checkAdminRateLimit } from '@/lib/rate-limiter';

import tenantDb from '@/lib/tenant-db';
import { withPlatformContext, withTenantAdminContext } from '@/lib/platform-db';
import { TeamService } from '@/services/team-service';
import { NotFoundError, ValidationError, ConflictError, ForbiddenError } from '@/lib/services/types';

export const runtime = 'nodejs';

/** Best effort: resolve a team's org for a write context (verified platform read). */
async function resolveTeamOrg(sessionUserId: string, id: string): Promise<string | null> {
  try {
    const team = await withPlatformContext(sessionUserId, () =>
      tenantDb.team.findUnique({ where: { id }, select: { organizationId: true } }),
    );
    return team?.organizationId ?? null;
  } catch {
    return null;
  }
}

/**
 * GET /api/dashboard/admin/teams/[id]/roles
 * List roles assigned to the team.
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
    // Verified platform context for the team-role listing.
    const result = await withPlatformContext(auth.session!.user.id, () =>
      TeamService.getTeamRoles(id, {
        userId: auth.session!.user.id,
        role: 'PLATFORM_ADMIN',
      })
    );

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: 'Team not found' }, { status: 404 });
    }
    console.error('Failed to list team roles:', error);
    return NextResponse.json({ error: 'Failed to fetch team roles' }, { status: 500 });
  }
}

/**
 * POST /api/dashboard/admin/teams/[id]/roles
 * Assign a role to the team (role inheritance).
 */
export async function POST(
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

    if (!body.roleId) {
      return NextResponse.json({ error: 'Role ID is required' }, { status: 400 });
    }

    // RLS: TeamRole INSERT's WITH CHECK binds to app.current_org_id — bind the
    // team's org (platform context 42501s on non-platform-org rows).
    const orgId = await resolveTeamOrg(auth.session!.user.id, id);
    if (!orgId) {
      console.error(`Failed to assign team role: team not found ${id}`);
      return NextResponse.json({ error: 'Team not found' }, { status: 404 });
    }

    const result = await withTenantAdminContext(auth.session!.user.id, orgId, () =>
      TeamService.assignTeamRole(id, { roleId: body.roleId }, {
        userId: auth.session!.user.id,
        role: 'PLATFORM_ADMIN',
      })
    );

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof ConflictError) {
      console.error('Failed to assign team role:', error);
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof ValidationError) {
      // Role exists in a different organization than the team.
      console.error('Failed to assign team role:', error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof NotFoundError) {
      // Team or role missing.
      console.error('Failed to assign team role:', error);
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    console.error('Failed to assign team role:', error);
    return NextResponse.json({ error: 'Failed to assign team role' }, { status: 500 });
  }
}

/**
 * DELETE /api/dashboard/admin/teams/[id]/roles
 * Revoke a role from the team.
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
    if (!checkAdminRateLimit(auth.session!.user.id)) {
    return NextResponse.json({'error': 'rate_limited'}, {status: 429});
  }

  const body = await request.json();

    if (!body.roleId) {
      return NextResponse.json({ error: 'Role ID is required' }, { status: 400 });
    }

    // Verified platform context for the team-role revocation.
    await withPlatformContext(auth.session!.user.id, () =>
      TeamService.removeTeamRole(id, body.roleId, {
        userId: auth.session!.user.id,
        role: 'PLATFORM_ADMIN',
      })
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    if (
      error instanceof NotFoundError &&
      error.message === 'Role is not assigned to this team'
    ) {
      console.error('Failed to revoke team role:', error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof ForbiddenError) {
      console.error('Failed to revoke team role:', error);
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof NotFoundError) {
      // Team or role missing.
      console.error('Failed to revoke team role:', error);
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    console.error('Failed to revoke team role:', error);
    return NextResponse.json({ error: 'Failed to revoke team role' }, { status: 500 });
  }
}
