/**
 * POST /api/roles
 *
 * Create a new custom role scoped to the user's organization.
 * Requires: roles:create permission in the target organization.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import prisma from '@/lib/db';

export async function POST(req: NextRequest) {
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

  // Check for roles:create permission by querying the role with this name
  const userRoles = await prisma.role.findMany({
    where: {
      organizationId,
      name: membership.role, // Member.role is a string matching Role.name
    },
    select: {
      permissions: {
        select: { permission: { select: { key: true } } },
      },
    },
  });

  const userPermissions = new Set(
    userRoles.flatMap((r) => r.permissions.map((rp) => rp.permission.key))
  );

  if (!userPermissions.has('roles:create')) {
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

  return NextResponse.json({ role }, { status: 201 });
}
