import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { checkAdminRateLimit } from '@/lib/rate-limiter';
import { withTenantAdminContext, withPlatformContext } from '@/lib/platform-db';
import tenantDb from '@/lib/tenant-db';
import { isSameSiteRequest } from '@/lib/csrf';
import { handleServiceError } from '@/lib/services/error-handler';
import { WorkOrderNoteService } from '@/services/work-order-note-service';

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
 * POST /api/admin/work-order-notes — add a note to a work order.
 * Body: { workOrderId, note }. Super-admin only.
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

  let body: { workOrderId?: string; note?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!body.workOrderId || !body.note) {
    return NextResponse.json({ error: 'workOrderId and note are required' }, { status: 400 });
  }

  try {
    const orgId = await orgOfWorkOrder(body.workOrderId, adminUserId);
    if (!orgId) return NextResponse.json({ error: 'Work order not found' }, { status: 404 });

    return await withTenantAdminContext(adminUserId, orgId, async () => {
      const note = await WorkOrderNoteService.create(
        { workOrderId: body.workOrderId!, note: body.note!, createdById: auth.session!.user.id },
        adminCtx(adminUserId),
      );
      return NextResponse.json(note, { status: 201 });
    });
  } catch (error) {
    return handleServiceError(error);
  }
}
