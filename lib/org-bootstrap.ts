import tenantDb from './tenant-db';
import { getRedis } from '@/lib/redis';
import { enrollInDefaultMembersTeam } from '@/lib/org-default-team';

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
    await tenantDb.role.createMany({
      data: defaultRoles.map((name) => ({
        name,
        organizationId: organizationId,
        isDefault: true,
      })),
    });

    // Fetch the created roles
    const roles = await tenantDb.role.findMany({
      where: { organizationId, isDefault: true },
    });

    // Fetch all permissions from the catalog
    const permissions = await tenantDb.permission.findMany();

    // Define permission mappings for each role
    const rolePermissionMap: Record<string, string[]> = {
      'Organization Admin': permissions.map((p) => p.key), // Change p.name to p.key
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
        'financials:view',
        'export:financials',
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
        'export:financials',
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
        'invoice:create:financials',
      ],
    };

    // Create role-permission mappings
    const rolePermissionData = roles.flatMap((role) => {
      const permissionKeys = rolePermissionMap[role.name] || [];
      const rolePermissions = permissions.filter((p) => permissionKeys.includes(p.key)); // Change p.name to p.key

      return rolePermissions.map((permission) => ({
        roleId: role.id,
        permissionId: permission.id,
        organizationId: organizationId,
      }));
    });

    if (rolePermissionData.length > 0) {
      await tenantDb.rolePermission.createMany({
        data: rolePermissionData,
      });
    }

    // Assign creator as Organization Admin
    const orgAdminRole = roles.find((r) => r.name === 'Organization Admin');
    if (orgAdminRole) {
      // Find or create member record for the creator
      let member = await tenantDb.member.findFirst({
        where: {
          userId: creatorUserId,
          organization: { id: organizationId }, // Use relation syntax
        },
      });

      if (!member) {
        member = await tenantDb.member.create({
          data: {
            userId: creatorUserId,
            orgId: organizationId, // <-- Changed from organizationId to orgId
          },
        });
      }

      // Auto-enroll the creator in the default "Members" team (idempotent).
      // Best-effort: a Teams-side failure must NOT prevent the creator from
      // being granted Organization Admin — that role assignment is the whole
      // point of this bootstrap and runs after enrollment below.
      try {
        await enrollInDefaultMembersTeam(tenantDb, organizationId, creatorUserId);
      } catch (error) {
        console.error(`[Bootstrap] Failed to auto-enroll ${creatorUserId} in the Members team for organization ${organizationId}:`, error);
      }

      // Create member-role association
      await tenantDb.memberRole.create({
        data: {
          memberId: member.id,
          roleId: orgAdminRole.id,
          organizationId: organizationId,
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
  let body: { name?: string } | null = null;
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
  if (response.ok) {
    try {
      let orgId: string | null = null;

      // Try to extract the organization ID directly from the response body
      try {
        const data = await response.json();
        // BetterAuth typically returns the created organization object or similar structure
        if (data?.id) orgId = data.id;
        else if (data?.organization?.id) orgId = data.organization.id;
      } catch {
        // Response body might not be JSON or parseable, ignore
      }

      if (!orgId && body?.name) {
        // Fallback: If ID not found in response, look up by name
        const org = await tenantDb.organization.findFirst({
          where: { name: body.name },
          orderBy: { createdAt: 'desc' },
        });
        orgId = org?.id || null;
      }

      if (orgId) {
        const { auth } = await import('@/lib/auth');
        const { headers } = await import('next/headers');

        const session = await auth.api.getSession({
          headers: await headers(),
        });

        if (session?.user?.id) {
          await bootstrapOrganizationRoles(orgId, session.user.id);
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
    const members = await tenantDb.member.findMany({
      where: { organization: { id: organizationId } }, // Use relation syntax
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
