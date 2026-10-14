import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { checkAdminRateLimit } from '@/lib/rate-limiter';
// RLS Phase 3: unit list runs under a verified platform context (cross-org);
// the create TARGETS ONE specific org, so it runs under a verified tenant-admin
// context bound to that org — the Units policy's INSERT WITH CHECK binds writes
// to app.current_org_id, which must equal the target org (42501 otherwise).
import tenantDb from '@/lib/tenant-db';
import { withPlatformContext, withTenantAdminContext } from '@/lib/platform-db';
import type { Prisma } from '@prisma/client';
import { UnitService, UNIT_TYPES, type UnitTypeValue } from '@/services/unit-service';
import { ValidationError, ForbiddenError } from '@/lib/services/types';

export const runtime = 'nodejs';

/**
 * GET /api/dashboard/admin/units
 * List units with pagination, search, org filter and rented-state filter.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSuperAdmin(request.headers);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const url = new URL(request.url);
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('pageSize') || '20', 10) || 20));
    const organizationId = url.searchParams.get('organizationId') || undefined;
    const search = url.searchParams.get('search')?.trim() || undefined;
    const rentedParam = url.searchParams.get('rented');
    const rented = rentedParam === 'true' ? true : rentedParam === 'false' ? false : undefined;
    const typeParam = url.searchParams.get('type') as UnitTypeValue | null;
    const type = typeParam && UNIT_TYPES.includes(typeParam) ? typeParam : undefined;

    // RLS: one verified platform context for the whole cross-org listing.
    return withPlatformContext(auth.session!.user.id, async () => {
      const ctx = { userId: auth.session!.user.id, role: 'PLATFORM_ADMIN' as const };

      // Base where shared by the count queries (search + scope).
      const searchWhere: Prisma.UnitsWhereInput = {};
      if (search) {
        searchWhere.OR = [
          { owner: { contains: search, mode: 'insensitive' } },
          { address: { contains: search, mode: 'insensitive' } },
          { postCode: { contains: search, mode: 'insensitive' } },
        ];
      }
      const filteredWhere: Prisma.UnitsWhereInput = {
        ...searchWhere,
        ...(organizationId ? { organizationId } : {}),
        ...(rented !== undefined ? { rented } : {}),
        ...(type !== undefined ? { type } : {}),
      };

      // Counts over the full dataset (filter-aware, pagination-independent).
      const [totalCount, rentedCount, ownerOccupiedCount] = await Promise.all([
        tenantDb.units.count({ where: filteredWhere }),
        tenantDb.units.count({ where: { ...filteredWhere, rented: true } }),
        // Owner-occupied = not rented out.
        tenantDb.units.count({ where: { ...filteredWhere, rented: false } }),
      ]);

      if (!organizationId) {
        // All-organizations listing (same shape as admin teams GET): fetch per
        // org at max page size, merge, then filter + paginate in the route.
        const allOrgs = await tenantDb.organization.findMany({ select: { id: true } });

        const perOrg = await Promise.all(
          allOrgs.map((org) =>
            UnitService.getUnitsByOrg(org.id, ctx, 1, 100, undefined, rented, type),
          ),
        );
        let items = perOrg.flatMap((r) => r.items);

        // Cross-org search on top of the fetched set.
        if (search) {
          const q = search.toLowerCase();
          items = items.filter(
            (u) =>
              u.owner.toLowerCase().includes(q) ||
              u.address.toLowerCase().includes(q) ||
              u.postCode.toLowerCase().includes(q),
          );
        }

        items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        const total = items.length;
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        const start = (page - 1) * pageSize;
        const pageItems = items.slice(start, start + pageSize);

        return NextResponse.json({
          items: pageItems,
          pagination: { page, pageSize, total, totalPages },
          counts: { totalCount, rentedCount, ownerOccupiedCount },
        });
      }

      // Single-org listing.
      const result = await UnitService.getUnitsByOrg(organizationId, ctx, page, pageSize, search, rented, type);

      return NextResponse.json({
        ...result,
        counts: { totalCount, rentedCount, ownerOccupiedCount },
      });
    });
  } catch (error) {
    console.error('Failed to list units:', error);
    return NextResponse.json({ error: 'Failed to fetch units' }, { status: 500 });
  }
}

/**
 * POST /api/dashboard/admin/units
 * Create a new unit.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSuperAdmin(request.headers);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // Rate limit write operations by session
  if (!checkAdminRateLimit(auth.session!.user.id)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  let body: {
    owner?: string;
    address?: string;
    postCode?: string;
    rented?: boolean;
    type?: UnitTypeValue;
    organizationId?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.organizationId) {
    return NextResponse.json({ error: 'Organization ID is required' }, { status: 400 });
  }
  if (!body.owner || !body.address || !body.postCode) {
    return NextResponse.json({ error: 'Owner, address and post code are required' }, { status: 400 });
  }
  if (body.type !== undefined && !UNIT_TYPES.includes(body.type)) {
    return NextResponse.json(
      { error: `Type must be one of: ${UNIT_TYPES.join(', ')}` },
      { status: 400 },
    );
  }

  const adminUserId = auth.session!.user.id;

  try {
    // Capture to consts so narrowing survives into the closure.
    const targetOrgId = body.organizationId;
    const input = {
      owner: body.owner,
      address: body.address,
      postCode: body.postCode,
      ...(body.rented !== undefined ? { rented: body.rented } : {}),
      ...(body.type !== undefined ? { type: body.type } : {}),
    };

    // RLS: binding must carry the TARGET org (Units INSERT's WITH CHECK binds
    // the row to app.current_org_id). Platform-org context 42501s here.
    // Audit logging is handled inside UnitService.createUnit (team-route pattern).
    const result = await withTenantAdminContext(adminUserId, targetOrgId, () =>
      UnitService.createUnit(input, targetOrgId, { userId: adminUserId, role: 'PLATFORM_ADMIN' }),
    );

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError || error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: error instanceof ForbiddenError ? 403 : 400 });
    }
    console.error('Failed to create unit:', error);
    return NextResponse.json({ error: 'Failed to create unit' }, { status: 500 });
  }
}
