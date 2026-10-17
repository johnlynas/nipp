/**
 * Tenant work order read — /api/organizations/[orgId]/work-orders/[id]
 *
 * GET -- Detail incl. notes, quotes (with contractor) and invoice. Membership
 * OR super admin; RLS makes foreign-org ids a 404 for members.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { resolveTenantAccess, toTenantContext } from '@/lib/tenant-access';
import { withRLSContext } from '@/lib/rls-transaction';
import tenantDb from '@/lib/tenant-db';
import { WorkOrderService } from '@/services/work-order-service';
import { NotFoundError } from '@/lib/services/types';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string; id: string }> },
) {
  const session = await auth.api.getSession({ headers: req.headers });

  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { orgId, id } = await params;

  // Membership OR super admin (platform team can view any tenant's work orders).
  const access = await resolveTenantAccess(req, session.user.id, orgId);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  return withRLSContext(toTenantContext(access, session.user.id), async () => {
    const ctx = access.ctx;

    try {
      // RLS scopes this to the caller's org; a foreign-org row reads as null → 404.
      const workOrder = await WorkOrderService.getById(id, ctx);

      const [notes, quotes, invoice] = await Promise.all([
        tenantDb.workOrderNote.findMany({ where: { workOrderId: id }, orderBy: { createdAt: 'asc' } }),
        tenantDb.quotation.findMany({
          where: { workOrderId: id },
          include: {
            contractor: { select: { name: true, companyName: true, email: true, phone: true, type: true } },
          },
          orderBy: { price: 'asc' },
        }),
        tenantDb.invoice.findUnique({ where: { workOrderId: id } }),
      ]);

      return NextResponse.json({ ...workOrder, notes, quotes, invoice });
    } catch (error) {
      if (error instanceof NotFoundError) {
        return NextResponse.json({ error: 'Work order not found' }, { status: 404 });
      }
      if (error instanceof Error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  });
}
