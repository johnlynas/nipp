import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { checkAdminRateLimit } from '@/lib/rate-limiter';
import { withTenantAdminContext, withPlatformContext } from '@/lib/platform-db';
import tenantDb from '@/lib/tenant-db';
import { isSameSiteRequest } from '@/lib/csrf';
import { handleServiceError } from '@/lib/services/error-handler';
import { InvoiceService } from '@/services/invoice-service';

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
