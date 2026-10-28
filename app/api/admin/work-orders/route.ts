import { NextRequest, NextResponse } from 'next/server';
import type { WorkOrderState } from '@prisma/client';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { checkAdminRateLimit } from '@/lib/rate-limiter';
import { withTenantAdminContext, withPlatformContext } from '@/lib/platform-db';
import tenantDb from '@/lib/tenant-db';
import { isSameSiteRequest } from '@/lib/csrf';
import { handleServiceError } from '@/lib/services/error-handler';
import { WorkOrderService, WORK_ORDER_STATES } from '@/services/work-order-service';

export const runtime = 'nodejs';

/**
 * GET /api/admin/work-orders — platform-wide list (all orgs) with state
 * search filter. Super-admin only; reads run under the verified platform
 * context (RLS admits all org rows for platform admins). The tenant-scoped
 * read route (`/api/organizations/[orgId]/work-orders`) cannot serve this —
 * it is path-bound to one org. Row objects gain `organizationName` (joined
 * server-side) so the admin table doesn't fetch a second list.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSuperAdmin(request.headers);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const adminUserId = auth.session!.user.id;

  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get('page') || '1', 10);
  const pageSize = parseInt(url.searchParams.get('pageSize') || '20', 10);
  const search = url.searchParams.get('search')?.trim() || undefined;
  const stateParam = url.searchParams.get('state');
  const state = stateParam && (WORK_ORDER_STATES as readonly string[]).includes(stateParam)
    ? (stateParam as WorkOrderState)
    : undefined;

  if (stateParam && !state) {
    return NextResponse.json(
      { error: `state must be one of: ${WORK_ORDER_STATES.join(', ')}` },
      { status: 400 },
    );
  }

  try {
    const orgNameById = new Map<string, string>();
    const result = await withPlatformContext(adminUserId, async () => {
      const list = await WorkOrderService.list(
        { search, state },
        { page, pageSize },
        { userId: adminUserId, role: 'PLATFORM_ADMIN' },
      );
      const orgs = await tenantDb.organization.findMany({
        where: { id: { in: list.items.map((w) => w.organizationId) } },
        select: { id: true, name: true },
      });
      for (const o of orgs) orgNameById.set(o.id, o.name);
      return list;
    });
    // Per-state counts (unfiltered except active search) — stat tiles.
    const where: Record<string, unknown> = {};
    if (search) {
      where.OR = [
        { description: { contains: search, mode: 'insensitive' } },
        { openedBy: { contains: search, mode: 'insensitive' } },
      ];
    }
    const grouped = await withPlatformContext(adminUserId, () =>
      tenantDb.workOrder.groupBy({ by: ['state'], where, _count: { _all: true } }),
    );
    const counts: Record<string, number> = {};
    for (const row of grouped) counts[row.state] = row._count._all;
    const items = result.items.map((w) => ({ ...w, organizationName: orgNameById.get(w.organizationId) ?? w.organizationId }));
    return NextResponse.json({ ...result, items, counts });
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/admin/work-orders — create a work order in CREATED for an org.
 * Super-admin only; the write runs under the tenant RLS context pinned to the
 * target organization (policy WITH CHECK requires app.current_org_id).
 */
export async function POST(request: NextRequest) {
  if (!isSameSiteRequest(request.method, request.headers)) {
    return NextResponse.json({ error: 'Forbidden: cross-site request blocked' }, { status: 403 });
  }

  const auth = await requireSuperAdmin(request.headers);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const adminUserId = auth.session!.user.id;
  if (!checkAdminRateLimit(adminUserId)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  let body: { description?: string; organizationId?: string; openedBy?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.organizationId || !body.description) {
    return NextResponse.json({ error: 'description and organizationId are required' }, { status: 400 });
  }

  // The opener's email is the super admin by default; callers may key in a
  // third-party org contact on their behalf (D4).
  const openedBy = body.openedBy?.trim() || auth.session!.user.email || '';

  try {
    return await withTenantAdminContext(adminUserId, body.organizationId, async () => {
      const ctx = { userId: adminUserId, role: 'PLATFORM_ADMIN' as const };
      const created = await WorkOrderService.create(
        {
          description: body.description!,
          openedBy,
          ...(auth.session!.user.email ? { openedById: auth.session!.user.id } : {}),
          organizationId: body.organizationId!,
        },
        ctx,
      );
      return NextResponse.json(created, { status: 201 });
    });
  } catch (error) {
    return handleServiceError(error);
  }
}
