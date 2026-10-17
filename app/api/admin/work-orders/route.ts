import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { checkAdminRateLimit } from '@/lib/rate-limiter';
import { withTenantAdminContext } from '@/lib/platform-db';
import { isSameSiteRequest } from '@/lib/csrf';
import { handleServiceError } from '@/lib/services/error-handler';
import { WorkOrderService } from '@/services/work-order-service';

export const runtime = 'nodejs';

/**
 * POST /api/admin/work-orders — create a work order in CREATED for an org.
 * Super-admin only; the write runs under the tenant RLS context pinned to the
 * target organization (policy WITH CHECK requires app.current_org_id).
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

  let body: { description?: string; organizationId?: string; openedBy?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.organizationId || !body.description) {
    return NextResponse.json({ error: 'description and organizationId are required' }, { status: 400 });
  }

  // The opener's email is the super admin by default; callers may key in a
  // third-party org contact on their behalf (D4).
  const openedBy = body.openedBy?.trim() || auth.session!.user.email || '';

  try {
    return await withTenantAdminContext(adminUserId, body.organizationId, async () => {
      const ctx = { userId: adminUserId, role: 'PLATFORM_ADMIN' as const };
      const created = await WorkOrderService.create(
        {
          description: body.description!,
          openedBy,
          ...(auth.session!.user.email ? { openedById: auth.session!.user.id } : {}),
          organizationId: body.organizationId!,
        },
        ctx,
      );
      return NextResponse.json(created, { status: 201 });
    });
  } catch (error) {
    return handleServiceError(error);
  }
}
