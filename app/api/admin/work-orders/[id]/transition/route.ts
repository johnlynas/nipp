import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { checkAdminRateLimit } from '@/lib/rate-limiter';
import { withTenantAdminContext, withPlatformContext } from '@/lib/platform-db';
import tenantDb from '@/lib/tenant-db';
import { isSameSiteRequest } from '@/lib/csrf';
import { handleServiceError } from '@/lib/services/error-handler';
import { ValidationError } from '@/lib/services/types';
import type { WorkOrderState } from '@prisma/client';
import { WorkOrderService, WORK_ORDER_STATES, setWorkOrderEmailDispatcher } from '@/services/work-order-service';
import { sendWorkOrderEmailEvent } from '@/services/work-order-email';

export const runtime = 'nodejs';

/** Build a service ctx for the (verified) super admin actor. */
function adminCtx(userId: string) {
  return { userId, role: 'PLATFORM_ADMIN' as const };
}

/**
 * POST /api/admin/work-orders/[id]/transition — one-hop state change with
 * side effects (design §State Machine). Body:
 *   { to, contractorIds?, quotesDue?, quoteId?, paid? }
 * The mutation runs under the row's own org tenant RLS context (policy WITH
 * CHECK requires app.current_org_id; a pure platform context fails closed).
 */
export async function POST(
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

  let body: {
    to?: string;
    contractorIds?: string[];
    quotesDue?: string | null;
    quoteId?: string;
    paid?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.to || !(WORK_ORDER_STATES as readonly string[]).includes(body.to)) {
    return NextResponse.json({ error: `to must be one of: ${WORK_ORDER_STATES.join(', ')}` }, { status: 400 });
  }

  // Parse quotesDue when provided (ISO string) — the service validates the rest.
  let quotesDue: Date | null | undefined;
  if (body.quotesDue !== undefined && body.quotesDue !== null) {
    const parsed = new Date(body.quotesDue);
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json({ error: 'Invalid quotesDue format. Use ISO 8601.' }, { status: 400 });
    }
    quotesDue = parsed;
  }

  const id = (await params).id;

  try {
    // Platform probe first to learn the row's org (no tenant ctx exists yet).
    const row = await withPlatformContext(adminUserId, () =>
      tenantDb.workOrder.findUnique({ where: { workOrderId: id }, select: { organizationId: true } }),
    );
    if (!row) return NextResponse.json({ error: 'Work order not found' }, { status: 404 });

    return await withTenantAdminContext(adminUserId, row.organizationId, async () => {
      // Wire the real email dispatcher for this module instance (dev double-
      // evaluation safe: idempotent set). Email dispatch runs AFTER the
      // transition commits and inherits this tenant RLS context.
      setWorkOrderEmailDispatcher(sendWorkOrderEmailEvent);
      const updated = await WorkOrderService.transition(
        id,
        body.to as WorkOrderState,
        {
          ...(body.contractorIds !== undefined ? { contractorIds: body.contractorIds } : {}),
          ...(quotesDue !== undefined ? { quotesDue } : {}),
          ...(body.quoteId !== undefined ? { quoteId: body.quoteId } : {}),
          ...(body.paid !== undefined ? { paid: body.paid } : {}),
        },
        adminCtx(adminUserId),
      );
      return NextResponse.json(updated);
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      // Illegal transition + missing opts → 409 per repo conventions (design §API).
      const status = /Illegal transition/.test((error as Error).message) ? 409 : 422;
      return NextResponse.json({ error: (error as Error).message }, { status });
    }
    return handleServiceError(error);
  }
}
