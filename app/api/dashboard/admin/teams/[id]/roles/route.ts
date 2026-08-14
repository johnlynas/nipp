import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { TeamService } from '@/services/team-service';

export const runtime = 'nodejs';

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
    const result = await TeamService.getTeamRoles(id, {
      userId: auth.session!.user.id,
      role: 'PLATFORM_ADMIN',
    });

    return NextResponse.json(result);
  } catch (error) {
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
    const body = await request.json();

    if (!body.roleId) {
      return NextResponse.json({ error: 'Role ID is required' }, { status: 400 });
    }

    const result = await TeamService.assignTeamRole(id, { roleId: body.roleId }, {
      userId: auth.session!.user.id,
      role: 'PLATFORM_ADMIN',
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
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
    const body = await request.json();

    if (!body.roleId) {
      return NextResponse.json({ error: 'Role ID is required' }, { status: 400 });
    }

    await TeamService.removeTeamRole(id, body.roleId, {
      userId: auth.session!.user.id,
      role: 'PLATFORM_ADMIN',
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to revoke team role:', error);
    return NextResponse.json({ error: 'Failed to revoke team role' }, { status: 500 });
  }
}
