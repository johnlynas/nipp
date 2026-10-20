import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { checkAdminRateLimit } from '@/lib/rate-limiter';
import { withTenantAdminContext, withPlatformContext } from '@/lib/platform-db';
import tenantDb from '@/lib/tenant-db';
import { isSameSiteRequest } from '@/lib/csrf';
import { handleServiceError } from '@/lib/services/error-handler';
import { InvoiceService, buildInvoiceWhere } from '@/services/invoice-service';
import { WORK_ORDER_STATE_LABELS, type WorkOrderState } from '@/lib/work-order-state';

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
 * GET /api/admin/invoices — platform-wide invoice list (all orgs). Super-admin
 * only; reads run under the verified platform context (RLS admits all rows for
 * platform admins). Rows gain `workOrder.description` + `workOrder.state` and
 * `contractor` joins from InvoiceService.list. Filters: page, pageSize, search,
 * workOrderState, organizationId, workOrderId, contractorId. Stat counts are
 * grouped by the PARENT work order state (an invoice has no lifecycle of its
 * own — it follows the billing tail) and returned as `counts` shaped for the
 * admin tiles: Awaiting Invoicing / Invoiced / Paid + Closed.
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
  const stateParam = url.searchParams.get('workOrderState');
  const organizationId = url.searchParams.get('organizationId') || undefined;
  const workOrderId = url.searchParams.get('workOrderId') || undefined;
  const contractorId = url.searchParams.get('contractorId') || undefined;

  try {
    // Validate state up-front (invalid enum → 400, mirroring the quotes route).
    let workOrderState: WorkOrderState | undefined;
    if (stateParam) {
      if (!(WORK_ORDER_STATE_LABELS as Record<string, unknown>)[stateParam]) {
        return NextResponse.json({ error: `workOrderState must be one of: ${Object.keys(WORK_ORDER_STATE_LABELS).join(', ')}` }, { status: 400 });
      }
      workOrderState = stateParam as WorkOrderState;
    }

    const filters = { search, organizationId, workOrderId, contractorId, workOrderState };
    const result = await withPlatformContext(adminUserId, () =>
      InvoiceService.list(filters, { page, pageSize }, adminCtx(adminUserId)),
    );

    // Stat tiles: group the SAME filtered population by parent work order state.
    const grouped = await withPlatformContext(adminUserId, () =>
      tenantDb.invoice.groupBy({
        by: ['workOrderId'],
        where: buildInvoiceWhere(filters),
      }).then(async (invoices) => {
        if (invoices.length === 0) return new Map<string, number>();
        const wos = await tenantDb.workOrder.findMany({
          where: { workOrderId: { in: invoices.map((i) => i.workOrderId) } },
          select: { state: true },
        });
        const counts = new Map<string, number>();
        for (const wo of wos) counts.set(wo.state, (counts.get(wo.state) ?? 0) + 1);
        return counts;
      }),
    );

    // Organization names for the table join (the list rows carry organizationId).
    const orgNameById = new Map<string, string>();
    const orgIds = [...new Set(result.items.map((i) => i.organizationId))];
    if (orgIds.length > 0) {
      const orgs = await withPlatformContext(adminUserId, () =>
        tenantDb.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } }),
      );
      for (const o of orgs) orgNameById.set(o.id, o.name);
    }
    const items = result.items.map((i) => ({ ...i, organizationName: orgNameById.get(i.organizationId) ?? i.organizationId }));

    const counts: Record<string, number> = {};
    for (const [state, n] of grouped) counts[state] = n;

    return NextResponse.json({ ...result, items, counts });
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/admin/invoices — record the 1:1 invoice for a COMPLETE work order.
 * Body: { workOrderId, contractorId, invoiceDate, price, dueDate, invoiceLink? }.
 * Super-admin only (409 on duplicate via service ValidationError).
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

  let body: {
    workOrderId?: string;
    contractorId?: string;
    invoiceDate?: string;
    price?: number | string;
    dueDate?: string;
    invoiceLink?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!body.workOrderId || !body.contractorId || !body.invoiceDate || !body.dueDate || body.price === undefined) {
    return NextResponse.json(
      { error: 'workOrderId, contractorId, invoiceDate, price and dueDate are required' },
      { status: 400 },
    );
  }

  const invoiceDate = new Date(body.invoiceDate);
  const dueDate = new Date(body.dueDate);
  if (Number.isNaN(invoiceDate.getTime()) || Number.isNaN(dueDate.getTime())) {
    return NextResponse.json({ error: 'invoiceDate/dueDate must be ISO 8601 dates' }, { status: 400 });
  }

  try {
    const orgId = await orgOfWorkOrder(body.workOrderId, adminUserId);
    if (!orgId) return NextResponse.json({ error: 'Work order not found' }, { status: 404 });

    return await withTenantAdminContext(adminUserId, orgId, async () => {
      const invoice = await InvoiceService.create(
        {
          workOrderId: body.workOrderId!,
          contractorId: body.contractorId!,
          invoiceDate,
          dueDate,
          price: Number(body.price),
          ...(body.invoiceLink ? { invoiceLink: body.invoiceLink } : {}),
        },
        adminCtx(adminUserId),
      );
      return NextResponse.json(invoice, { status: 201 });
    });
  } catch (error) {
    // Duplicate invoice → 409 per repo conventions (design §API Surface).
    const message = error instanceof Error ? error.message : '';
    if (/already exists/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return handleServiceError(error);
  }
}
