import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { checkAdminRateLimit } from '@/lib/rate-limiter';

import globalDb from '@/lib/global-db';
import { RoleService } from '@/services/role-service';
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

    // If no organizationId, fetch roles across all organizations
    if (!organizationId) {
      const allOrgs = await globalDb.organization.findMany({
        select: { id: true },
      });

      // Fetch ALL roles from each org (no per-org pagination), then paginate the merged result
      const allRoles = await Promise.all(
        allOrgs.map((org) =>
          RoleService.list(org.id, { search } as import('@/lib/services/types').RoleFilters, { page: 1, pageSize: 10000 }, {
            userId: auth.session!.user.id,
            role: 'PLATFORM_ADMIN',
          })
        )
      );

      // Merge results from all orgs
      const items = allRoles.flatMap((r) => r.items);
      const total = items.length;

      // Apply isDefault filter client-side if specified
      let filteredItems = items;
      if (isDefault !== null && isDefault !== undefined) {
        const filterVal = isDefault === 'true';
        filteredItems = items.filter((r) => r.isDefault === filterVal);
      }

      const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
      const start = (page - 1) * pageSize;

      // Dashboard counts: always from the full dataset, independent of filters
      const allRolesAcrossOrgs = await Promise.all(
        allOrgs.map((org) =>
          globalDb.role.findMany({
            where: { organizationId: org.id },
            include: {
              _count: { select: { memberRoles: true, teamRoles: true } },
            },
          })
        )
      );
      const allRolesFlat = allRolesAcrossOrgs.flat();
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
    }

    const filters: Record<string, unknown> = {};
    if (search) filters.search = search;
    if (isDefault !== null && isDefault !== undefined) {
      filters.isDefault = isDefault === 'true';
    }

    const result = await RoleService.list(organizationId, filters as import('@/lib/services/types').RoleFilters, { page, pageSize }, {
      userId: auth.session!.user.id,
      role: 'PLATFORM_ADMIN',
    });

    // Dashboard counts: always from the full dataset, independent of filters
    const allRoles = await globalDb.role.findMany({
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

    const result = await RoleService.create(
      { name: body.name, description: body.description, isDefault: body.isDefault ?? false },
      organizationId,
      { userId: auth.session!.user.id, role: 'PLATFORM_ADMIN' }
    );

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message?.includes('already exists')) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error('Failed to create role:', error);
    return NextResponse.json({ error: 'Failed to create role' }, { status: 500 });
  }
}
