import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { checkAdminRateLimit } from '@/lib/rate-limiter';
import { withTenantAdminContext, withPlatformContext } from '@/lib/platform-db';
import tenantDb from '@/lib/tenant-db';
import { isSameSiteRequest } from '@/lib/csrf';
import { handleServiceError } from '@/lib/services/error-handler';
import { NotFoundError } from '@/lib/services/types';
import { InvoiceService, type UpdateInvoiceInput } from '@/services/invoice-service';

export const runtime = 'nodejs';

function adminCtx(userId: string) {
  return { userId, role: 'PLATFORM_ADMIN' as const };
}

/** Org of the invoice's parent work order (platform probe — no tenant ctx yet). */
async function orgOfInvoice(invoiceId: string, adminUserId: string) {
  const inv = await withPlatformContext(adminUserId, () =>
    tenantDb.invoice.findUnique({ where: { invoiceId }, select: { workOrderId: true } }),
  );
  if (!inv) return null;
  const wo = await withPlatformContext(adminUserId, () =>
    tenantDb.workOrder.findUnique({ where: { workOrderId: inv.workOrderId }, select: { organizationId: true } }),
  );
  return wo?.organizationId ?? null;
}

/**
 * PATCH /api/admin/invoices/[id] — edit price/dates/link while the work order
 * is COMPLETE or INVOICED (corrections before payment). Super-admin only.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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

  let body: UpdateInvoiceInput & { invoiceDate?: string; dueDate?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (Object.keys(body).length === 0) {
    return NextResponse.json({ error: 'No fields to update (price / invoiceDate / dueDate / invoiceLink)' }, { status: 400 });
  }

  const serviceBody: UpdateInvoiceInput = {};
  if (body.price !== undefined) serviceBody.price = Number(body.price);
  if (body.invoiceLink !== undefined) serviceBody.invoiceLink = body.invoiceLink;
  if (body.invoiceDate) {
    const d = new Date(body.invoiceDate);
    if (Number.isNaN(d.getTime())) return NextResponse.json({ error: 'Invalid invoiceDate' }, { status: 400 });
    serviceBody.invoiceDate = d;
  }
  if (body.dueDate) {
    const d = new Date(body.dueDate);
    if (Number.isNaN(d.getTime())) return NextResponse.json({ error: 'Invalid dueDate' }, { status: 400 });
    serviceBody.dueDate = d;
  }

  const id = (await params).id;
  try {
    const orgId = await orgOfInvoice(id, adminUserId);
    if (!orgId) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });

    return await withTenantAdminContext(adminUserId, orgId, async () => {
      const updated = await InvoiceService.update(id, serviceBody, adminCtx(adminUserId));
      return NextResponse.json(updated);
    });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }
    return handleServiceError(error);
  }
}

/**
 * DELETE /api/admin/invoices/[id] — v1 correction flow; only while the work
 * order is INVOICED (409 once FINISHED/CLOSED, 422 otherwise). Super-admin only.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isSameSiteRequest(_request.method, _request.headers)) {
    return NextResponse.json({ error: 'Forbidden: cross-site request blocked' }, { status: 403 });
  }

  const auth = await requireSuperAdmin(_request.headers);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const adminUserId = auth.session!.user.id;
  const id = (await params).id;

  try {
    const orgId = await orgOfInvoice(id, adminUserId);
    if (!orgId) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });

    return await withTenantAdminContext(adminUserId, orgId, async () => {
      const result = await InvoiceService.delete(id, adminCtx(adminUserId));
      return NextResponse.json(result);
    });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }
    return handleServiceError(error);
  }
}
