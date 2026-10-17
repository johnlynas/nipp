import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { checkAdminRateLimit } from '@/lib/rate-limiter';
import { withTenantAdminContext, withPlatformContext } from '@/lib/platform-db';
import tenantDb from '@/lib/tenant-db';
import { isSameSiteRequest } from '@/lib/csrf';
import { handleServiceError } from '@/lib/services/error-handler';
import { NotFoundError } from '@/lib/services/types';
import { QuotationService, type UpdateQuotationInput } from '@/services/quote-service';

export const runtime = 'nodejs';

function adminCtx(userId: string) {
  return { userId, role: 'PLATFORM_ADMIN' as const };
}

/** Org of the quote's parent work order (platform probe — no tenant ctx yet). */
async function orgOfQuote(quoteId: string, adminUserId: string) {
  const quote = await withPlatformContext(adminUserId, () =>
    tenantDb.quotation.findUnique({ where: { quoteId }, select: { workOrderId: true } }),
  );
  if (!quote) return null;
  const wo = await withPlatformContext(adminUserId, () =>
    tenantDb.workOrder.findUnique({ where: { workOrderId: quote.workOrderId }, select: { organizationId: true } }),
  );
  return wo?.organizationId ?? null;
}

/**
 * PATCH /api/admin/quotes/[id] — fill price/description/quoteLink as quotes
 * arrive (price fill auto-moves OUT_FOR_QUOTES → QUOTES_IN). Super-admin only.
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

  let body: UpdateQuotationInput;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (Object.keys(body).length === 0) {
    return NextResponse.json({ error: 'No fields to update (price / description / quoteLink)' }, { status: 400 });
  }

  const id = (await params).id;
  try {
    const orgId = await orgOfQuote(id, adminUserId);
    if (!orgId) return NextResponse.json({ error: 'Quotation not found' }, { status: 404 });

    return await withTenantAdminContext(adminUserId, orgId, async () => {
      const updated = await QuotationService.update(id, body, adminCtx(adminUserId));
      return NextResponse.json(updated);
    });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: 'Quotation not found' }, { status: 404 });
    }
    return handleServiceError(error);
  }
}

/**
 * DELETE /api/admin/quotes/[id] — blocked once the work order is INVOICED /
 * FINISHED / CLOSED (409). Super-admin only.
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
    const orgId = await orgOfQuote(id, adminUserId);
    if (!orgId) return NextResponse.json({ error: 'Quotation not found' }, { status: 404 });

    return await withTenantAdminContext(adminUserId, orgId, async () => {
      const result = await QuotationService.delete(id, adminCtx(adminUserId));
      return NextResponse.json(result);
    });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: 'Quotation not found' }, { status: 404 });
    }
    return handleServiceError(error);
  }
}
