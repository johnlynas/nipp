import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { checkAdminRateLimit } from '@/lib/rate-limiter';

import tenantDb from '@/lib/tenant-db';
import { withPlatformContext, withTenantAdminContext } from '@/lib/platform-db';
import { TeamService } from '@/services/team-service';

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
 * GET /api/dashboard/admin/teams/[id]/members
 * List team members.
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
    // Verified platform context for the member listing.
    const result = await withPlatformContext(auth.session!.user.id, () =>
      TeamService.listTeamMembers(id, {
        userId: auth.session!.user.id,
        role: 'PLATFORM_ADMIN',
      })
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to list team members:', error);
    return NextResponse.json({ error: 'Failed to fetch team members' }, { status: 500 });
  }
}

/**
 * POST /api/dashboard/admin/teams/[id]/members
 * Add a member to the team.
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

    if (!body.userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    // RLS: TeamMember INSERT's WITH CHECK binds to app.current_org_id — bind the
    // team's org (platform context 42501s on non-platform-org rows).
    const orgId = await resolveTeamOrg(auth.session!.user.id, id);
    const doAdd = () =>
      TeamService.addTeamMember(id, { userId: body.userId }, {
        userId: auth.session!.user.id,
        role: 'PLATFORM_ADMIN',
      });
    let result;
    if (orgId) {
      result = await withTenantAdminContext(auth.session!.user.id, orgId, doAdd);
    } else {
      // Team vanished before the write — surface NotFound rather than 42501.
      console.error(`Failed to add team member: team not found ${id}`);
      return NextResponse.json({ error: 'Team not found' }, { status: 404 });
    }

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error('Failed to add team member:', error);
    return NextResponse.json({ error: 'Failed to add team member' }, { status: 500 });
  }
}

/**
 * DELETE /api/dashboard/admin/teams/[id]/members
 * Remove a member from the team.
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

    if (!body.userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    // Verified platform context for the membership remove.
    await withPlatformContext(auth.session!.user.id, () =>
      TeamService.removeTeamMember(id, body.userId, {
        userId: auth.session!.user.id,
        role: 'PLATFORM_ADMIN',
      })
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to remove team member:', error);
    return NextResponse.json({ error: 'Failed to remove team member' }, { status: 500 });
  }
}
