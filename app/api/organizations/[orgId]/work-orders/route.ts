/**
 * Tenant work order reads — /api/organizations/[orgId]/work-orders
 *
 * GET -- List the organization's own work orders (paginated, state/search
 * filters). Membership OR super admin; rows are org-isolated by RLS.
 */

import { NextRequest, NextResponse } from 'next/server';
import type { WorkOrderState } from '@prisma/client';
import { auth } from '@/lib/auth';
import { resolveTenantAccess, toTenantContext } from '@/lib/tenant-access';
import { withRLSContext } from '@/lib/rls-transaction';
import { WorkOrderService, WORK_ORDER_STATES } from '@/services/work-order-service';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const session = await auth.api.getSession({ headers: req.headers });

  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const orgId = (await params).orgId;

  // Membership OR super admin (platform team can view any tenant's work orders).
  const access = await resolveTenantAccess(req, session.user.id, orgId);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  return withRLSContext(toTenantContext(access, session.user.id), async () => {
    const ctx = access.ctx;

    const url = new URL(req.url);
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
      const result = await WorkOrderService.list(
        { search, state, organizationId: orgId },
        { page, pageSize },
        ctx,
      );
      return NextResponse.json(result);
    } catch (error) {
      if (error instanceof Error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  });
}
