/**
 * Team membership endpoints.
 *
 * GET    /api/organizations/[orgId]/teams/[teamId]/members  — List team members
 * POST   /api/organizations/[orgId]/teams/[teamId]/members  — Add a member to the team
 * DELETE /api/organizations/[orgId]/teams/[teamId]/members  — Remove a member from the team
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import globalDb from '@/lib/global-db';
import { TeamService } from '@/services/team-service';
import { isSameSiteRequest } from '@/lib/csrf';
import { checkCalendarRateLimit } from '@/lib/rate-limiter';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// GET — List team members (paginated)
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

  // Only admins can list team members
  if (role === 'MEMBER') {
    return NextResponse.json({ error: 'Forbidden: admin access required' }, { status: 403 });
  }

  const page = Number(req.nextUrl.searchParams.get('page')) || 1;
  const pageSize = Number(req.nextUrl.searchParams.get('pageSize')) || 20;

  try {
    const result = await TeamService.listTeamMembers(teamId, ctx, page, pageSize);
    return NextResponse.json(result);
  } catch (error: unknown) {
    if (error instanceof Error) {
      const status = error.message.includes('not found') ? 404 : 403;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST — Add a member to the team
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

  // Only admins can add team members
  if (role === 'MEMBER') {
    return NextResponse.json({ error: 'Forbidden: admin access required' }, { status: 403 });
  }

  // Rate limit write operations
  if (!checkCalendarRateLimit(session.user.id)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const body = await req.json();
  const { userId } = body as { userId: string };

  if (!userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }

  try {
    const teamMember = await TeamService.addTeamMember(teamId, { userId }, ctx);
    return NextResponse.json({ teamMember }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof Error) {
      const status = error.message.includes('already') ? 409 : error.message.includes('not found') ? 404 : 400;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE — Remove a member from the team
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

  // Only admins can remove team members
  if (role === 'MEMBER') {
    return NextResponse.json({ error: 'Forbidden: admin access required' }, { status: 403 });
  }

  const userId = req.nextUrl.searchParams.get('userId');

  if (!userId) {
    return NextResponse.json({ error: 'userId query parameter is required' }, { status: 400 });
  }

  try {
    await TeamService.removeTeamMember(teamId, userId, ctx);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    if (error instanceof Error) {
      const status = error.message.includes('not found') ? 404 : 403;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
