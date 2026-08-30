/**
 * Team role assignment endpoints.
 *
 * GET    /api/organizations/[orgId]/teams/[teamId]/roles  — List team roles
 * POST   /api/organizations/[orgId]/teams/[teamId]/roles  — Assign a role to the team
 * DELETE /api/organizations/[orgId]/teams/[teamId]/roles  — Remove a role from the team
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import globalDb from '@/lib/global-db';
import { TeamService } from '@/services/team-service';
import { isSameSiteRequest } from '@/lib/csrf';
import { checkCalendarRateLimit } from '@/lib/rate-limiter';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// GET — List team roles
// ---------------------------------------------------------------------------

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string; teamId: string }> },
) {
  const session = await auth.api.getSession({ headers: req.headers });

  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const orgId = (await params).orgId;
  const teamId = (await params).teamId;

  // Verify the user is a member of this organization
  const membership = await globalDb.member.findFirst({
    where: { userId: session.user.id, orgId },
  });

  if (!membership) {
    return NextResponse.json({ error: 'Not a member of this organization' }, { status: 403 });
  }

  // Determine user role context
  const role = membership.role === 'admin' ? ('TENANT_ADMIN' as const) : ('MEMBER' as const);
  const ctx = { userId: session.user.id, role, organizationId: orgId };

  // Only admins can list team roles
  if (role === 'MEMBER') {
    return NextResponse.json({ error: 'Forbidden: admin access required' }, { status: 403 });
  }

  try {
    const roles = await TeamService.getTeamRoles(teamId, ctx);
    return NextResponse.json({ roles });
  } catch (error: unknown) {
    if (error instanceof Error) {
      const status = error.message.includes('not found') ? 404 : 403;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST — Assign a role to the team
// ---------------------------------------------------------------------------

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string; teamId: string }> },
) {
  // SECURITY (S8): Validate CSRF for state-changing requests
  if (!isSameSiteRequest(req.method, req.headers)) {
    return NextResponse.json(
      { error: 'Forbidden: cross-site request blocked' },
      { status: 403 }
    );
  }

  const session = await auth.api.getSession({ headers: req.headers });

  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const orgId = (await params).orgId;
  const teamId = (await params).teamId;

  // Verify the user is a member of this organization
  const membership = await globalDb.member.findFirst({
    where: { userId: session.user.id, orgId },
  });

  if (!membership) {
    return NextResponse.json({ error: 'Not a member of this organization' }, { status: 403 });
  }

  // Determine user role context
  const role = membership.role === 'admin' ? ('TENANT_ADMIN' as const) : ('MEMBER' as const);
  const ctx = { userId: session.user.id, role, organizationId: orgId };

  // Only admins can assign team roles
  if (role === 'MEMBER') {
    return NextResponse.json({ error: 'Forbidden: admin access required' }, { status: 403 });
  }

  // Rate limit write operations
  if (!checkCalendarRateLimit(session.user.id)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const body = await req.json();
  const { roleId } = body as { roleId: string };

  if (!roleId) {
    return NextResponse.json({ error: 'roleId is required' }, { status: 400 });
  }

  try {
    const teamRole = await TeamService.assignTeamRole(teamId, { roleId }, ctx);
    return NextResponse.json({ teamRole }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof Error) {
      const status = error.message.includes('already') ? 409 : error.message.includes('not found') ? 404 : 400;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE — Remove a role from the team
// ---------------------------------------------------------------------------

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string; teamId: string }> },
) {
  // SECURITY (S8): Validate CSRF for state-changing requests
  if (!isSameSiteRequest(req.method, req.headers)) {
    return NextResponse.json(
      { error: 'Forbidden: cross-site request blocked' },
      { status: 403 }
    );
  }

  const session = await auth.api.getSession({ headers: req.headers });

  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const orgId = (await params).orgId;
  const teamId = (await params).teamId;

  // Verify the user is a member of this organization
  const membership = await globalDb.member.findFirst({
    where: { userId: session.user.id, orgId },
  });

  if (!membership) {
    return NextResponse.json({ error: 'Not a member of this organization' }, { status: 403 });
  }

  // Determine user role context
  const role = membership.role === 'admin' ? ('TENANT_ADMIN' as const) : ('MEMBER' as const);
  const ctx = { userId: session.user.id, role, organizationId: orgId };

  // Only admins can remove team roles
  if (role === 'MEMBER') {
    return NextResponse.json({ error: 'Forbidden: admin access required' }, { status: 403 });
  }

  const roleId = req.nextUrl.searchParams.get('roleId');

  if (!roleId) {
    return NextResponse.json({ error: 'roleId query parameter is required' }, { status: 400 });
  }

  try {
    await TeamService.removeTeamRole(teamId, roleId, ctx);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    if (error instanceof Error) {
      const status = error.message.includes('not found') ? 404 : 403;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
