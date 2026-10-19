import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { checkAdminRateLimit } from '@/lib/rate-limiter';
import { withTenantAdminContext, withPlatformContext } from '@/lib/platform-db';
import tenantDb from '@/lib/tenant-db';
import { isSameSiteRequest } from '@/lib/csrf';
import { handleServiceError } from '@/lib/services/error-handler';
import { QuotationService, QUOTE_STATES, buildQuotationWhere } from '@/services/quote-service';

export const runtime = 'nodejs';

function adminCtx(userId: string) {
  return { userId, role: 'PLATFORM_ADMIN' as const };
}

/** Org of the parent work order (platform probe — no tenant ctx yet). */
async function orgOfWorkOrder(workOrderId: string, adminUserId: string) {
  const row = await withPlatformContext(adminUserId, () =>
    tenantDb.workOrder.findUnique({ where: { workOrderId }, select: { organizationId: true } }),
  );
  return row?.organizationId ?? null;
}

/**
 * GET /api/admin/quotes — platform-wide quotation list (all orgs). Super-admin
 * only; reads run under the verified platform context (RLS admits all rows for
 * platform admins). Rows gain `workOrder.description` + `workOrder.state` and
 * `contractor` joins from QuotationService.list. Filters: page, pageSize,
 * search, state, organizationId, workOrderId, contractorId. Per-quote-state
 * counts (search-filtered) power the stat tiles.
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
  const organizationId = url.searchParams.get('organizationId') || undefined;
  const workOrderId = url.searchParams.get('workOrderId') || undefined;
  const contractorId = url.searchParams.get('contractorId') || undefined;

  try {
    const filters = { search, organizationId, workOrderId, contractorId };
    // Validate state up-front (throws ValidationError → 400 via the catch).
    const state = stateParam && (QUOTE_STATES as readonly string[]).includes(stateParam)
      ? (stateParam as (typeof QUOTE_STATES)[number])
      : undefined;
    if (stateParam && !state) {
      return NextResponse.json(
        { error: `state must be one of: ${QUOTE_STATES.join(', ')}` },
        { status: 400 },
      );
    }

    const [result, grouped] = await Promise.all([
      withPlatformContext(adminUserId, () =>
        QuotationService.list({ ...filters, state }, { page, pageSize }, adminCtx(adminUserId)),
      ),
      withPlatformContext(adminUserId, () =>
        tenantDb.quotation.groupBy({ by: ['state'], where: buildQuotationWhere(filters), _count: { _all: true } }),
      ),
    ]);

    // Organization names for the table join (the list rows carry organizationId).
    const orgNameById = new Map<string, string>();
    const orgIds = [...new Set(result.items.map((q) => q.organizationId))];
    if (orgIds.length > 0) {
      const orgs = await withPlatformContext(adminUserId, () =>
        tenantDb.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } }),
      );
      for (const o of orgs) orgNameById.set(o.id, o.name);
    }
    const items = result.items.map((q) => ({ ...q, organizationName: orgNameById.get(q.organizationId) ?? q.organizationId }));

    const counts: Record<string, number> = {};
    for (const row of grouped) counts[row.state] = row._count._all;

    return NextResponse.json({ ...result, items, counts });
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/admin/quotes — open a quotation row for a contractor on a work
 * order. Body: { workOrderId, contractorId, dueDate }. Super-admin only.
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

  let body: { workOrderId?: string; contractorId?: string; dueDate?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!body.workOrderId || !body.contractorId || !body.dueDate) {
    return NextResponse.json({ error: 'workOrderId, contractorId and dueDate are required' }, { status: 400 });
  }

  const dueDate = new Date(body.dueDate);
  if (Number.isNaN(dueDate.getTime())) {
    return NextResponse.json({ error: 'Invalid dueDate format. Use ISO 8601.' }, { status: 400 });
  }

  try {
    const orgId = await orgOfWorkOrder(body.workOrderId, adminUserId);
    if (!orgId) return NextResponse.json({ error: 'Work order not found' }, { status: 404 });

    return await withTenantAdminContext(adminUserId, orgId, async () => {
      const quote = await QuotationService.create(
        { workOrderId: body.workOrderId!, contractorId: body.contractorId!, dueDate },
        adminCtx(adminUserId),
      );
      return NextResponse.json(quote, { status: 201 });
    });
  } catch (error) {
    return handleServiceError(error);
  }
}
