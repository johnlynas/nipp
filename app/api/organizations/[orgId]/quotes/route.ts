/**
 * Tenant quotation reads — /api/organizations/[orgId]/quotes
 *
 * GET -- List the organization's quotations (paginated, state/search filters).
 * Membership OR super admin; rows are org-isolated by RLS. Read-only: tenants
 * manage quotes through their work orders on this surface — quote mutations
 * live only under /api/admin/quotes (super admin).
 */

import { NextRequest, NextResponse } from 'next/server';
import type { QuotationState } from '@prisma/client';
import { auth } from '@/lib/auth';
import { resolveTenantAccess, toTenantContext } from '@/lib/tenant-access';
import { withRLSContext } from '@/lib/rls-transaction';
import { QuotationService, QUOTE_STATES } from '@/services/quote-service';

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

  // Membership OR super admin (platform team can view any tenant's quotations).
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
    const state = stateParam && (QUOTE_STATES as readonly string[]).includes(stateParam)
      ? (stateParam as QuotationState)
      : undefined;

    if (stateParam && !state) {
      return NextResponse.json(
        { error: `state must be one of: ${QUOTE_STATES.join(', ')}` },
        { status: 400 },
      );
    }

    try {
      const result = await QuotationService.list(
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
