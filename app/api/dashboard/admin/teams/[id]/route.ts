import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { checkAdminRateLimit } from '@/lib/rate-limiter';

import { TeamService } from '@/services/team-service';

export const runtime = 'nodejs';

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

  try {
    const id = (await params).id;
    if (!checkAdminRateLimit(auth.session!.user.id)) {
    return NextResponse.json({'error': 'rate_limited'}, {status: 429});
  }

  const body = await request.json();

    const result = await TeamService.updateTeam(id, {
      name: body.name,
      description: body.description,
    }, { userId: auth.session!.user.id, role: 'PLATFORM_ADMIN' });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === 'Team not found') {
      return NextResponse.json({ error: 'Team not found' }, { status: 404 });
    }
    console.error('Failed to update team:', error);
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

  try {
    const id = (await params).id;
    await TeamService.deleteTeam(id, {
      userId: auth.session!.user.id,
      role: 'PLATFORM_ADMIN',
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'Team not found') {
      return NextResponse.json({ error: 'Team not found' }, { status: 404 });
    }
    console.error('Failed to delete team:', error);
    return NextResponse.json({ error: 'Failed to delete team' }, { status: 500 });
  }
}
