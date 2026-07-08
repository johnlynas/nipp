import { prisma } from '@/lib/db';
import { getRedis } from '@/lib/redis';
import { PERMISSIONS_CACHE_TTL } from '@/lib/constants';

/**
 * Bootstraps default roles and permissions for a newly created organization.
 * Called automatically when a new organization is created via BetterAuth.
 */
export async function bootstrapOrganizationRoles(organizationId: string, creatorUserId: string) {
  try {
    // Define the 7 default roles
    const defaultRoles = [
      'Organization Admin',
      'Property Manager',
      'Letting Agent',
      'Accountant',
      'Maintenance Staff',
      'Tenant',
      'Contractor',
    ];

    // Create all default roles in one batch
    await prisma.role.createMany({
      data: defaultRoles.map((name) => ({
        name,
        organizationId,
        isDefault: true,
      })),
    });

    // Fetch the created roles
    const roles = await prisma.role.findMany({
      where: { organizationId, isDefault: true },
    });

    // Fetch all permissions from the catalog
    const permissions = await prisma.permission.findMany();

    // Define permission mappings for each role
    const rolePermissionMap: Record<string, string[]> = {
      'Organization Admin': permissions.map((p) => p.name), // All permissions
      'Property Manager': [
        'properties:view',
        'properties:create',
        'properties:update',
        'tenants:view',
        'tenants:create',
        'tenants:update',
        'leases:view',
        'leases:create',
        'leases:update',
        'maintenance:view',
        'maintenance:create',
        'maintenance:update',
        'financials:view',
        'financials:export',
        'users:view',
        'settings:view',
      ],
      'Letting Agent': [
        'properties:view',
        'tenants:view',
        'tenants:create',
        'tenants:update',
        'leases:view',
        'leases:create',
        'leases:update',
        'maintenance:view',
        'financials:view',
        'users:view',
      ],
      Accountant: [
        'properties:view',
        'tenants:view',
        'leases:view',
        'maintenance:view',
        'financials:view',
        'financials:create',
        'financials:update',
        'financials:export',
        'users:view',
      ],
      'Maintenance Staff': [
        'properties:view',
        'tenants:view',
        'leases:view',
        'maintenance:view',
        'maintenance:create',
        'maintenance:update',
      ],
      Tenant: [
        'properties:view:own',
        'tenants:view:own',
        'leases:view:own',
        'maintenance:view:own',
        'maintenance:create',
        'financials:view:own',
        'financials:pay',
      ],
      Contractor: [
        'properties:view:assigned',
        'maintenance:view:assigned',
        'maintenance:update:assigned',
        'financials:view:own',
        'financials:invoice:create',
      ],
    };

    // Create role-permission mappings
    const rolePermissionData = roles.flatMap((role) => {
      const permissionNames = rolePermissionMap[role.name] || [];
      const rolePermissions = permissions.filter((p) => permissionNames.includes(p.name));

      return rolePermissions.map((permission) => ({
        roleId: role.id,
        permissionId: permission.id,
      }));
    });

    if (rolePermissionData.length > 0) {
      await prisma.rolePermission.createMany({
        data: rolePermissionData,
      });
    }

    // Assign creator as Organization Admin
    const orgAdminRole = roles.find((r) => r.name === 'Organization Admin');
    if (orgAdminRole) {
      // Find or create member record for the creator
      let member = await prisma.member.findFirst({
        where: {
          userId: creatorUserId,
          organizationId,
        },
      });

      if (!member) {
        member = await prisma.member.create({
          data: {
            userId: creatorUserId,
            organizationId,
          },
        });
      }

      // Create member-role association
      await prisma.memberRole.create({
        data: {
          memberId: member.id,
          roleId: orgAdminRole.id,
          organizationId,
        },
      });
    }

    // Invalidate permission cache for all members of this organization
    await invalidateOrgPermissionCache(organizationId);

    console.log(`[Bootstrap] Successfully created default roles for organization ${organizationId}`);
  } catch (error) {
    console.error(`[Bootstrap] Failed to bootstrap roles for organization ${organizationId}:`, error);
    // Don't throw - org was created successfully, roles can be added manually if needed
  }
}

/**
 * Intercepts organization creation requests to BetterAuth and bootstraps roles.
 * This is called from the auth route handler.
 */
export async function handleCreateOrganization(req: Request) {
  // Read body ONCE before forwarding
  let body: any = null;
  try {
    body = await req.clone().json();
  } catch {
    // Body may be empty or non-JSON, continue without it
  }

  // Forward to BetterAuth using a cloned request
  const forwardReq = new Request(req, {
    method: req.method,
    headers: req.headers,
    body: req.method !== 'GET' && req.method !== 'HEAD' ? await req.clone().arrayBuffer() : undefined,
  });

  const { auth } = await import('@/lib/auth');
  const response = await auth.handler(forwardReq);

  // If creation succeeded, extract org ID and bootstrap roles
  if (response.ok && body?.name) {
    try {
      const { auth } = await import('@/lib/auth');
      const { headers } = await import('next/headers');

      const session = await auth.api.getSession({
        headers: await headers(),
      });

      if (session?.user?.id) {
        // Fetch the newly created org by name (BetterAuth doesn't return ID in response body easily)
        const org = await prisma.organization.findFirst({
          where: { name: body.name },
          orderBy: { createdAt: 'desc' },
        });

        if (org) {
          await bootstrapOrganizationRoles(org.id, session.user.id);
        }
      }
    } catch (error) {
      // Log but don't fail the request - org was created successfully
      console.error('[Auth] Failed to bootstrap organization roles:', error);
    }
  }

  return response;
}


/**
 * Invalidates the permission cache for all members of an organization.
 */
async function invalidateOrgPermissionCache(organizationId: string) {
  try {
    const members = await prisma.member.findMany({
      where: { organizationId },
      select: { userId: true },
    });

    const redis = getRedis();
    if (!redis) return;

    const keys = members.map((m) => `perm:${m.userId}:${organizationId}`);

    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } catch (error) {
    console.error('[Cache] Failed to invalidate org permission cache:', error);
  }
}

