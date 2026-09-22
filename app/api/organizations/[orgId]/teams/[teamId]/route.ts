/**
 * Individual team endpoints.
 *
 * GET    /api/organizations/[orgId]/teams/[teamId]      — Get team details with members and roles
 * PATCH  /api/organizations/[orgId]/teams/[teamId]      — Update team details
 * DELETE /api/organizations/[orgId]/teams/[teamId]      — Delete a team
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
// RLS Phase 3: verified-context tenantDb (unscoped globalDb deleted).
import tenantDb from '@/lib/tenant-db';
import { withRLSContext } from '@/lib/rls-transaction';
import { TeamService } from '@/services/team-service';
import { isSameSiteRequest } from '@/lib/csrf';
import { checkCalendarRateLimit } from '@/lib/rate-limiter';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// GET — Get team details with members and roles
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
return withRLSContext({ userId: session.user.id, orgId, isPlatformAdmin: false }, async () => {
  const teamId = (await params).teamId;

  // Verify the user is a member of this organization
  const membership = await tenantDb.member.findFirst({
    where: { userId: session.user.id, orgId },
  });

  if (!membership) {
    return NextResponse.json({ error: 'Not a member of this organization' }, { status: 403 });
  }

  // Determine user role context
  const role = membership.role === 'admin' ? ('TENANT_ADMIN' as const) : ('MEMBER' as const);
  const ctx = { userId: session.user.id, role, organizationId: orgId };

  // Only admins can view team details
  if (role === 'MEMBER') {
    return NextResponse.json({ error: 'Forbidden: admin access required' }, { status: 403 });
  }

  try {
    const team = await TeamService.getTeamById(teamId, ctx);
    return NextResponse.json({ team });
  } catch (error: unknown) {
    if (error instanceof Error) {
      const status = error.message.includes('not found') ? 404 : 403;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
  });
}

// ---------------------------------------------------------------------------
// PATCH — Update team details
// ---------------------------------------------------------------------------

export async function PATCH(
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
return withRLSContext({ userId: session.user.id, orgId, isPlatformAdmin: false }, async () => {
  const teamId = (await params).teamId;

  // Verify the user is a member of this organization
  const membership = await tenantDb.member.findFirst({
    where: { userId: session.user.id, orgId },
  });

  if (!membership) {
    return NextResponse.json({ error: 'Not a member of this organization' }, { status: 403 });
  }

  // Determine user role context
  const role = membership.role === 'admin' ? ('TENANT_ADMIN' as const) : ('MEMBER' as const);
  const ctx = { userId: session.user.id, role, organizationId: orgId };

  // Only admins can update teams
  if (role === 'MEMBER') {
    return NextResponse.json({ error: 'Forbidden: admin access required' }, { status: 403 });
  }

  // Rate limit write operations
  if (!checkCalendarRateLimit(session.user.id)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const body = await req.json();
  const { name, description } = body as { name?: string; description?: string };

  if (!name && description === undefined) {
    return NextResponse.json({ error: 'At least one field (name or description) is required' }, { status: 400 });
  }

  try {
    const team = await TeamService.updateTeam(teamId, { name, description }, ctx);
    return NextResponse.json({ team });
  } catch (error: unknown) {
    if (error instanceof Error) {
      const status = error.message.includes('not found') ? 404 : error.message.includes('already') ? 409 : 400;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
  });
}

// ---------------------------------------------------------------------------
// DELETE — Delete a team
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
return withRLSContext({ userId: session.user.id, orgId, isPlatformAdmin: false }, async () => {
  const teamId = (await params).teamId;

  // Verify the user is a member of this organization
  const membership = await tenantDb.member.findFirst({
    where: { userId: session.user.id, orgId },
  });

  if (!membership) {
    return NextResponse.json({ error: 'Not a member of this organization' }, { status: 403 });
  }

  // Determine user role context
  const role = membership.role === 'admin' ? ('TENANT_ADMIN' as const) : ('MEMBER' as const);
  const ctx = { userId: session.user.id, role, organizationId: orgId };

  // Only admins can delete teams
  if (role === 'MEMBER') {
    return NextResponse.json({ error: 'Forbidden: admin access required' }, { status: 403 });
  }

  try {
    await TeamService.deleteTeam(teamId, ctx);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    if (error instanceof Error) {
      const status = error.message.includes('not found') ? 404 : error.message.includes('Cannot delete team with existing members') ? 409 : 403;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
  });
}
