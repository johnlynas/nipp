import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { checkAdminRateLimit } from '@/lib/rate-limiter';
import globalDb from '@/lib/global-db';

import { TeamService } from '@/services/team-service';
import { notifyTeamOperation } from '@/lib/notification-push';

export const runtime = 'nodejs';

/** Best effort: resolve a team's name for notification labels. */
async function getTeamLabel(id: string): Promise<string> {
  try {
    const team = await globalDb.team.findUnique({
      where: { id },
      select: { name: true },
    });
    return team ? `Team "${team.name}" (${id})` : id;
  } catch {
    return id;
  }
}

/** Best effort: resolve a team's organization ID for notification scoping. */
async function getTeamOrgId(id: string): Promise<string | null> {
  try {
    const team = await globalDb.team.findUnique({
      where: { id },
      select: { organizationId: true },
    });
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
    const result = await TeamService.getTeamById(id, {
      userId: auth.session!.user.id,
      role: 'PLATFORM_ADMIN',
    });

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
  const [targetLabel, orgId] = await Promise.all([getTeamLabel(id), getTeamOrgId(id)]);

  try {
    const result = await TeamService.updateTeam(
      id,
      {
        name: body.name,
        description: body.description ?? undefined,
      },
      { userId: auth.session!.user.id, role: 'PLATFORM_ADMIN' }
    );

    await notifyTeamOperation('update', targetLabel, true, undefined, orgId);

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === 'Team not found') {
      await notifyTeamOperation('update', id, false, 'Team not found');
      return NextResponse.json({ error: 'Team not found' }, { status: 404 });
    }
    console.error('Failed to update team:', error);
    const message = error instanceof Error && error.message ? error.message : 'Failed to update team';
    await notifyTeamOperation('update', targetLabel, false, message, orgId);
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
  const [targetLabel, orgId] = await Promise.all([getTeamLabel(id), getTeamOrgId(id)]);

  try {
    await TeamService.deleteTeam(id, {
      userId: auth.session!.user.id,
      role: 'PLATFORM_ADMIN',
    });

    await notifyTeamOperation('delete', targetLabel, true, undefined, orgId);

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'Team not found') {
      await notifyTeamOperation('delete', id, false, 'Team not found', orgId);
      return NextResponse.json({ error: 'Team not found' }, { status: 404 });
    }
    console.error('Failed to delete team:', error);
    const message = error instanceof Error && error.message ? error.message : 'Failed to delete team';
    await notifyTeamOperation('delete', targetLabel, false, message, orgId);
    return NextResponse.json({ error: 'Failed to delete team' }, { status: 500 });
  }
}
