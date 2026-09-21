import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { checkAdminRateLimit } from '@/lib/rate-limiter';
// RLS Phase 3: dashboard role listing/creation run under verified contexts.
import tenantDb from '@/lib/tenant-db';
import { withPlatformContext, withTenantAdminContext } from '@/lib/platform-db';

import { RoleService } from '@/services/role-service';
import { notifyRoleOperation } from '@/lib/notification-push';
import type { Prisma } from '@prisma/client';

export const runtime = 'nodejs';

/**
 * GET /api/dashboard/admin/roles
 * List roles with pagination, search, and org filter.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSuperAdmin(request.headers);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const pageSize = parseInt(url.searchParams.get('pageSize') || '20', 10);
    const organizationId = url.searchParams.get('organizationId') || undefined;
    const search = url.searchParams.get('search') || undefined;
    const isDefault = url.searchParams.get('isDefault');

    if (!organizationId) {
      // Cross-org listing: one verified platform context for the whole body.
      return await withPlatformContext(auth.session!.user.id, async () => {
        const allOrgs = await tenantDb.organization.findMany({
          select: { id: true },
        });

        // Fetch ALL roles from each org (no per-org pagination), then paginate the merged result
        const allRoles = [];
        for (const org of allOrgs) {
          allRoles.push(
            await RoleService.list(org.id, { search } as import('@/lib/services/types').RoleFilters, { page: 1, pageSize: 10000 }, {
              userId: auth.session!.user.id,
              role: 'PLATFORM_ADMIN',
            }),
          );
        }

        // Merge results from all orgs
        const items = allRoles.flatMap((r) => r.items);

        // Apply isDefault filter client-side if specified
        let filteredItems = items;
        if (isDefault !== null && isDefault !== undefined) {
          const filterVal = isDefault === 'true';
          filteredItems = items.filter((r) => r.isDefault === filterVal);
        }

        const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
        const start = (page - 1) * pageSize;

        // Dashboard counts: always from the full dataset, independent of filters
        const allRolesFlat = await tenantDb.role.findMany({
          include: {
            _count: { select: { memberRoles: true, teamRoles: true } },
          },
        });
        const defaultCount = allRolesFlat.filter((r) => r.isDefault).length;
        const customCount = allRolesFlat.filter((r) => !r.isDefault).length;
        const rolesInUseCount = allRolesFlat.filter(
          (r) => (r._count.memberRoles ?? 0) > 0 || (r._count.teamRoles ?? 0) > 0
        ).length;

        return NextResponse.json({
          items: filteredItems.slice(start, start + pageSize),
          pagination: { page, pageSize, total: filteredItems.length, totalPages },
          counts: { defaultCount, customCount, rolesInUseCount },
        });
      });
    }

    // Org-scoped listing: one verified target-org context.
    return await withTenantAdminContext(auth.session!.user.id, organizationId, async () => {
      const filters: Record<string, unknown> = {};
      if (search) filters.search = search;
      if (isDefault !== null && isDefault !== undefined) {
        filters.isDefault = isDefault === 'true';
      }

      const result = await RoleService.list(organizationId, filters as import('@/lib/services/types').RoleFilters, { page, pageSize }, {
        userId: auth.session!.user.id,
        role: 'PLATFORM_ADMIN',
      });

      // Dashboard counts: always from the full dataset (org-scoped), independent of filters
      const allRoles = await tenantDb.role.findMany({
        where: { organizationId },
        include: {
          _count: { select: { memberRoles: true, teamRoles: true } },
        },
      });
      const defaultCount = allRoles.filter((r) => r.isDefault).length;
      const customCount = allRoles.filter((r) => !r.isDefault).length;
      const rolesInUseCount = allRoles.filter(
        (r) => (r._count.memberRoles ?? 0) > 0 || (r._count.teamRoles ?? 0) > 0
      ).length;

      return NextResponse.json({ ...result, counts: { defaultCount, customCount, rolesInUseCount } });
    });
  } catch (error) {
    console.error('Failed to list roles:', error);
    return NextResponse.json({ error: 'Failed to fetch roles' }, { status: 500 });
  }
}

/**
 * POST /api/dashboard/admin/roles
 * Create a new role.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSuperAdmin(request.headers);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    // Rate limit write operations by session
    if (!checkAdminRateLimit(auth.session!.user.id)) {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    }

    const body = await request.json();
    const organizationId = body.organizationId;

    if (!organizationId) {
      return NextResponse.json({ error: 'Organization ID is required' }, { status: 400 });
    }

    const targetLabel = body.name ? `Role "${body.name}"` : 'role';

    try {
      // RLS: verified target-org context — RoleService.create's WITH CHECK writes bind to it.
      const result = await withTenantAdminContext(auth.session!.user.id, organizationId, () =>
        RoleService.create(
          { name: body.name, description: body.description, isDefault: body.isDefault ?? false },
          organizationId,
          { userId: auth.session!.user.id, role: 'PLATFORM_ADMIN' }
        ),
      );

      await notifyRoleOperation('create', targetLabel, true, undefined, result.organizationId);

      return NextResponse.json(result, { status: 201 });
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : 'Failed to create role';
      await notifyRoleOperation('create', targetLabel, false, message, organizationId);
      if (error instanceof Error && error.message?.includes('already exists')) {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
      console.error('Failed to create role:', error);
      return NextResponse.json({ error: 'Failed to create role' }, { status: 500 });
    }
  } catch (error) {
    console.error('Failed to create role:', error);
    return NextResponse.json({ error: 'Failed to create role' }, { status: 500 });
  }
}
