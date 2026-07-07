/**
 * Organization creation interceptor.
 *
 * Intercepts POST /api/auth/organization/create-organization to automatically
 * bootstrap default roles for the newly created organization (7.1-7.2).
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { invalidatePermissionCache } from '@/lib/permissions/resolver';

/**
 * Bootstrap the 7 default roles for a newly created organization.
 */
export async function bootstrapOrganizationRoles(orgId: string): Promise<void> {
  try {
    // Fetch all permissions from the catalog
    const allPermissions = await prisma.permission.findMany({
      select: { id: true, key: true },
    });

    const permissionMap = new Map<string, string>(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      allPermissions.map((p: any) => [p.key, p.id])
    );

    // Import default role definitions
    const { DEFAULT_ROLE_PERMISSIONS } = await import('@/lib/constants');

    // Create the 7 default roles and map permissions (7.2)
    for (const roleName of Object.keys(DEFAULT_ROLE_PERMISSIONS)) {
      const rolePermissionKeys = DEFAULT_ROLE_PERMISSIONS[roleName as keyof typeof DEFAULT_ROLE_PERMISSIONS];

      await prisma.role.create({
        data: {
          name: roleName,
          isDefault: true,
          organizationId: orgId,
          permissions: {
            create: rolePermissionKeys
              .map((permKey) => {
                const permId = permissionMap.get(permKey);
                return permId
                  ? { permissionId: permId, organizationId: orgId }
                  : null;
              })
              .filter((p): p is NonNullable<typeof p> => p !== null),
          },
        },
      });
    }

    // Invalidate permission cache for all members of this org (roles just created)
    const members = await prisma.member.findMany({
      where: { orgId },
      select: { userId: true },
    });

    for (const member of members) {
      await invalidatePermissionCache(member.userId, orgId);
    }
  } catch {
    // Silently fail — organization creation should not be blocked by role bootstrapping
  }
}

/**
 * Handle organization creation with automatic role bootstrapping.
 */
export async function handleCreateOrganization(req: NextRequest): Promise<Response | null> {
  // Only intercept POST to create-organization
  const url = new URL(req.url);
  if (req.method !== 'POST' || !url.pathname.includes('create-organization')) {
    return null; // Not our endpoint — let the catch-all handler deal with it
  }

  // Forward to BetterAuth handler
  const forwardReq = new NextRequest(req.url, {
    method: 'POST',
    headers: req.headers,
    body: req.body,
  });

  const response = await fetch(forwardReq);

  // If creation succeeded, bootstrap roles
  if (response.ok) {
    try {
      const body = await req.json();
      const orgId = (body as { data?: { id: string } })?.data?.id;

      if (orgId) {
        await bootstrapOrganizationRoles(orgId);
      }
    } catch {
      // Role bootstrapping failure should not affect organization creation
    }
  }

  return response;
}
