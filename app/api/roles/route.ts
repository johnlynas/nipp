/**
 * POST /api/roles
 *
 * Create a new custom role scoped to the user's organization.
 * Requires: roles:create permission in the target organization.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import prisma from '@/lib/db';
import { recordAuditLog } from '@/lib/audit-log';
import { getClientIp } from '@/lib/ip';
import { isSameSiteRequest } from '@/lib/csrf';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// POST — Create role (requires roles:create)
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
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

  const body = await req.json();
  const { name, description, organizationId } = body as {
    name: string;
    description?: string;
    organizationId: string;
  };

  if (!name || !organizationId) {
    return NextResponse.json(
      { error: 'Name and organizationId are required' },
      { status: 400 }
    );
  }

  // SECURITY (S4): Validate that the role name corresponds to an existing Role
  const { isValidRoleName } = await import('@/lib/roles/validation');
  if (await isValidRoleName(name, organizationId)) {
    return NextResponse.json(
      { error: 'A role with this name already exists in this organization' },
      { status: 409 }
    );
  }

  // Verify the user is a member of this organization and get their role name
  const membership = await prisma.member.findFirst({
    where: {
      userId: session.user.id,
      orgId: organizationId,
    },
    select: { role: true },
  });

  if (!membership) {
    return NextResponse.json(
      { error: 'Not a member of this organization' },
      { status: 403 }
    );
  }

  // PERFORMANCE (P1): Use cached resolvePermissions() instead of 3 sequential DB queries.
  // Previously this did: (1) find member, (2) find roles by name, (3) extract permissions.
  // Now it reuses the Redis-cached permission resolution from lib/permissions/resolver.ts.
  const { resolvePermissions } = await import('@/lib/permissions/resolver');
  const userPermissions = await resolvePermissions(session.user.id, organizationId);

  if (!userPermissions.includes('roles:create')) {
    return NextResponse.json(
      { error: 'Forbidden: insufficient permissions' },
      { status: 403 }
    );
  }

  // Create the custom role (isDefault: false)
  const role = await prisma.role.create({
    data: {
      name,
      description,
      isDefault: false,
      organizationId,
    },
  });

  // Audit log the role creation
  await recordAuditLog({
    userId: session.user.id,
    userName: session.user.name,
    action: 'role.created',
    resourceType: 'Role',
    resourceId: role.id,
    organizationId,
    ipAddress: getClientIp(req.headers.get('x-forwarded-for')),
    userAgent: req.headers.get('user-agent') || 'unknown',
    success: true,
    metadata: { name },
  });

  return NextResponse.json({ role }, { status: 201 });
}
