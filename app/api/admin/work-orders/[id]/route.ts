import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { checkAdminRateLimit } from '@/lib/rate-limiter';
import { withTenantAdminContext, withPlatformContext } from '@/lib/platform-db';
import tenantDb from '@/lib/tenant-db';
import { isSameSiteRequest } from '@/lib/csrf';
import { handleServiceError } from '@/lib/services/error-handler';
import { WorkOrderService } from '@/services/work-order-service';

export const runtime = 'nodejs';

/** Build a service ctx for the (verified) super admin actor. */
function adminCtx(userId: string) {
  return { userId, role: 'PLATFORM_ADMIN' as const };
}

/**
 * Resolve a work order's organizationId under a platform context (platform
 * reads are RLS-visible on every org policy). Returns null when it does not
 * exist. No tenant context exists yet at this point, so a platform probe is
 * the only way to learn which org owns the row before pinning writes/reads.
 */
async function resolveOrgOfWorkOrder(workOrderId: string, adminUserId: string): Promise<string | null> {
  const row = await withPlatformContext(adminUserId, () =>
    tenantDb.workOrder.findUnique({ where: { workOrderId }, select: { organizationId: true } }),
  );
  return row?.organizationId ?? null;
}

/**
 * GET /api/admin/work-orders/[id] — full detail incl. notes/quotes/invoice.
 * Super-admin only; reads run under the row's own org tenant context (RLS).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireSuperAdmin(_request.headers);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const adminUserId = auth.session!.user.id;
  const id = (await params).id;

  const organizationId = await resolveOrgOfWorkOrder(id, adminUserId);
  if (!organizationId) {
    return NextResponse.json({ error: 'Work order not found' }, { status: 404 });
  }

  try {
    return await withTenantAdminContext(adminUserId, organizationId, async () => {
      const workOrder = await WorkOrderService.getById(id, adminCtx(adminUserId));
      const [notes, quotes, invoice] = await Promise.all([
        tenantDb.workOrderNote.findMany({ where: { workOrderId: id }, orderBy: { createdAt: 'asc' } }),
        tenantDb.quotation.findMany({ where: { workOrderId: id }, orderBy: { price: 'asc' } }),
        tenantDb.invoice.findUnique({ where: { workOrderId: id } }),
      ]);
      return NextResponse.json({ ...workOrder, notes, quotes, invoice });
    });
  } catch (error) {
    return handleServiceError(error);
  }
}

/**
 * PATCH /api/admin/work-orders/[id] — update description/openedBy only
 * (state goes through /transition). Super-admin only.
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

  let body: { description?: string; openedBy?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (Object.keys(body).length === 0) {
    return NextResponse.json({ error: 'No fields to update (description / openedBy only — use transition for state)' }, { status: 400 });
  }

  const id = (await params).id;
  try {
    const orgId = await resolveOrgOfWorkOrder(id, adminUserId);
    if (!orgId) return NextResponse.json({ error: 'Work order not found' }, { status: 404 });

    return await withTenantAdminContext(adminUserId, orgId, async () => {
      const updated = await WorkOrderService.update(id, body, adminCtx(adminUserId));
      return NextResponse.json(updated);
    });
  } catch (error) {
    return handleServiceError(error);
  }
}

/**
 * DELETE /api/admin/work-orders/[id] — delete the work order; notes/quotes/
 * invoice cascade via FKs. Super-admin only.
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
    const orgId = await resolveOrgOfWorkOrder(id, adminUserId);
    if (!orgId) return NextResponse.json({ error: 'Work order not found' }, { status: 404 });

    return await withTenantAdminContext(adminUserId, orgId, async () => {
      const result = await WorkOrderService.delete(id, adminCtx(adminUserId));
      return NextResponse.json(result);
    });
  } catch (error) {
    return handleServiceError(error);
  }
}
