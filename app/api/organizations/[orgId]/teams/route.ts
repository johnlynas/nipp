/**
 * Team management endpoints for an organization.
 *
 * GET    /api/organizations/[orgId]/teams      — List all teams in the organization
 * POST   /api/organizations/[orgId]/teams      — Create a new team
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import globalDb from '@/lib/global-db';
import { TeamService } from '@/services/team-service';
import { isSameSiteRequest } from '@/lib/csrf';
import { checkCalendarRateLimit } from '@/lib/rate-limiter';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// GET — List teams (paginated)
// ---------------------------------------------------------------------------

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const session = await auth.api.getSession({ headers: req.headers });

  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const orgId = (await params).orgId;

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

  // Only admins can list teams
  if (role === 'MEMBER') {
    return NextResponse.json({ error: 'Forbidden: admin access required' }, { status: 403 });
  }

  const page = Number(req.nextUrl.searchParams.get('page')) || 1;
  const pageSize = Number(req.nextUrl.searchParams.get('pageSize')) || 20;

  try {
    const result = await TeamService.getTeamsByOrg(orgId, ctx, page, pageSize);
    return NextResponse.json(result);
  } catch (error: unknown) {
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST — Create team
// ---------------------------------------------------------------------------

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
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

  // Only admins can create teams
  if (role === 'MEMBER') {
    return NextResponse.json({ error: 'Forbidden: admin access required' }, { status: 403 });
  }

  // Rate limit write operations
  if (!checkCalendarRateLimit(session.user.id)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const body = await req.json();
  const { name, slug, description } = body as {
    name: string;
    slug?: string;
    description?: string;
  };

  if (!name) {
    return NextResponse.json({ error: 'Team name is required' }, { status: 400 });
  }

  try {
    const team = await TeamService.createTeam({ name, slug, description }, orgId, ctx);
    return NextResponse.json({ team }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof Error) {
      const status = error.message.includes('already') ? 409 : 400;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
