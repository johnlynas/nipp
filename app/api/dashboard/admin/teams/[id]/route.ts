import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { checkAdminRateLimit } from '@/lib/rate-limiter';
// RLS Phase 3: team reads run under verified platform contexts; writes UPDATE
// an org-scoped row, which the policy's WITH CHECK binds to app.current_org_id —
// so they run under a verified target-org (tenant-admin) context instead.
import tenantDb from '@/lib/tenant-db';
import { withPlatformContext, withTenantAdminContext } from '@/lib/platform-db';
import { TeamService } from '@/services/team-service';
import { notifyTeamOperation } from '@/lib/notification-push';
import { NotFoundError, ForbiddenError, ValidationError, ConflictError } from '@/lib/services/types';

export const runtime = 'nodejs';

/** Best effort: resolve a team's name for notification labels (verified platform context). */
async function getTeamLabel(sessionUserId: string, id: string): Promise<string> {
  try {
    const team = await withPlatformContext(sessionUserId, () =>
      tenantDb.team.findUnique({ where: { id }, select: { name: true } })
    );
    return team ? `Team "${team.name}" (${id})` : id;
  } catch {
    return id;
  }
}

/** Best effort: resolve a team's organization ID for notification scoping (verified platform context). */
async function getTeamOrgId(sessionUserId: string, id: string): Promise<string | null> {
  try {
    const team = await withPlatformContext(sessionUserId, () =>
      tenantDb.team.findUnique({ where: { id }, select: { organizationId: true } })
    );
    return team?.organizationId ?? null;
  } catch {
    return null;
  }
}

/**
 * GET /api/dashboard/admin/teams/[id]
 * Get a single team by ID.
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
    // RLS: verified platform context (Team is RLS-scoped; flag admits cross-tenant reads).
    const result = await withPlatformContext(auth.session!.user.id, () =>
      TeamService.getTeamById(id, { userId: auth.session!.user.id, role: 'PLATFORM_ADMIN' })
    );

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === 'Team not found') {
      return NextResponse.json({ error: 'Team not found' }, { status: 404 });
    }
    console.error('Failed to get team:', error);
    return NextResponse.json({ error: 'Failed to fetch team' }, { status: 500 });
  }
}

/**
 * PATCH /api/dashboard/admin/teams/[id]
 * Update a team.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireSuperAdmin(request.headers);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const id = (await params).id;

  // Rate limit write operations by session
  if (!checkAdminRateLimit(auth.session!.user.id)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  let body: { name?: string; description?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Capture the team name and org for notification labels before the update
  const [targetLabel, orgId] = await Promise.all([
    getTeamLabel(auth.session!.user.id, id),
    getTeamOrgId(auth.session!.user.id, id),
  ]);

  let result;
  try {
    const doUpdate = () =>
      TeamService.updateTeam(
        id,
        { name: body.name, description: body.description ?? undefined },
        { userId: auth.session!.user.id, role: 'PLATFORM_ADMIN' }
      );
    // RLS: UPDATE's WITH CHECK binds to app.current_org_id — bind the team's org.
    // If the pre-update lookup failed (orgId null), fall back to platform context
    // (the service then reports NotFound; a successful update is impossible without it).
    if (orgId) {
      result = await withTenantAdminContext(auth.session!.user.id, orgId, doUpdate);
    } else {
      result = await withPlatformContext(auth.session!.user.id, doUpdate);
    }

    await notifyTeamOperation('update', targetLabel, true, undefined, orgId);

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof NotFoundError) {
      await notifyTeamOperation('update', id, false, 'Team not found');
      return NextResponse.json({ error: 'Team not found' }, { status: 404 });
    }
    console.error('Failed to update team:', error);
    const message = error instanceof Error && error.message ? error.message : 'Failed to update team';
    await notifyTeamOperation('update', targetLabel, false, message, orgId);
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: message }, { status: 403 });
    }
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Failed to update team' }, { status: 500 });
  }
}

/**
 * DELETE /api/dashboard/admin/teams/[id]
 * Delete a team.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireSuperAdmin(_request.headers);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const id = (await params).id;

  // Capture a label and org context for the notification before the team disappears
  const [targetLabel, orgId] = await Promise.all([
    getTeamLabel(auth.session!.user.id, id),
    getTeamOrgId(auth.session!.user.id, id),
  ]);

  try {
    // RLS: verified platform context wraps the team delete.
    await withPlatformContext(auth.session!.user.id, () =>
      TeamService.deleteTeam(id, { userId: auth.session!.user.id, role: 'PLATFORM_ADMIN' })
    );

    await notifyTeamOperation('delete', targetLabel, true, undefined, orgId);

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof NotFoundError) {
      await notifyTeamOperation('delete', id, false, 'Team not found', orgId);
      return NextResponse.json({ error: 'Team not found' }, { status: 404 });
    }
    console.error('Failed to delete team:', error);
    const message = error instanceof Error && error.message ? error.message : 'Failed to delete team';
    await notifyTeamOperation('delete', targetLabel, false, message, orgId);
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: message }, { status: 403 });
    }
    if (error instanceof ConflictError) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ error: 'Failed to delete team' }, { status: 500 });
  }
}
