import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { checkAdminRateLimit } from '@/lib/rate-limiter';
import { withTenantAdminContext, withPlatformContext } from '@/lib/platform-db';
import tenantDb from '@/lib/tenant-db';
import { isSameSiteRequest } from '@/lib/csrf';
import { handleServiceError } from '@/lib/services/error-handler';
import { QuotationService } from '@/services/quote-service';

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
