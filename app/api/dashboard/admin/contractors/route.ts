import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { checkAdminRateLimit } from '@/lib/rate-limiter';

import { ContractorService, CONTRACTOR_TYPES, type ContractorTypeValue } from '@/services/contractor-service';
// RLS Phase 3: contractors is a global (non-org-scoped, RLS-exempt) table — the
// verified platform context is kept for parity with the other admin dashboard
// listings (cross-tenant reads admitted by design; see SECURITY.md Appendix B).
import tenantDb from '@/lib/tenant-db';
import { withPlatformContext } from '@/lib/platform-db';
import { ValidationError } from '@/lib/services/types';

export const runtime = 'nodejs';

/**
 * GET /api/dashboard/admin/contractors
 * List contractors with pagination, search and type filter.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSuperAdmin(request.headers);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const pageSize = parseInt(url.searchParams.get('pageSize') || '20', 10);
    const search = url.searchParams.get('search')?.trim() || undefined;
    const typeParam = url.searchParams.get('type') as ContractorTypeValue | null;
    const type = typeParam && CONTRACTOR_TYPES.includes(typeParam) ? typeParam : undefined;

    // One verified platform context for the whole listing.
    return await withPlatformContext(auth.session!.user.id, async () => {
      const ctx = { userId: auth.session!.user.id, role: 'PLATFORM_ADMIN' as const };

      const result = await ContractorService.list(
        { search, type },
        { page, pageSize },
        ctx,
      );

      // Dashboard tiles: Total is ALWAYS the full-table count (independent of
      // any filter); per-type tiles are also whole-table counts — each tile
      // answers "how many <type> contractors exist in total", so it ignores
      // search/type filters AND pagination (a 42-row table must show its real
      // type split even when the list view renders one 8-row page).
      const [totalCount, byType] = await Promise.all([
        tenantDb.contractors.count(),
        tenantDb.contractors.groupBy({ by: ['type'], _count: { _all: true } }),
      ]);

      // Seed every enum value so absent types read 0 (groupBy omits them).
      const typeCounts: Record<ContractorTypeValue, number> = Object.fromEntries(
        CONTRACTOR_TYPES.map((t) => [t, 0]),
      ) as Record<ContractorTypeValue, number>;
      for (const row of byType) {
        typeCounts[row.type] = row._count._all;
      }

      return NextResponse.json({
        ...result,
        counts: { totalCount, types: typeCounts },
      });
    });
  } catch (error) {
    console.error('Failed to list contractors:', error);
    return NextResponse.json({ error: 'Failed to fetch contractors' }, { status: 500 });
  }
}

/**
 * POST /api/dashboard/admin/contractors
 * Create a new contractor in the global directory.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSuperAdmin(request.headers);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // Rate limit write operations by session
  if (!checkAdminRateLimit(auth.session!.user.id)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  let body: {
    companyName?: string;
    name?: string;
    email?: string;
    phone?: string;
    address?: string;
    postCode?: string;
    type?: ContractorTypeValue;
    description?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.companyName || !body.name || !body.email || !body.phone || !body.address || !body.postCode) {
    return NextResponse.json({ error: 'Company name, name, email, phone, address and post code are required' }, { status: 400 });
  }
  if (body.type !== undefined && !CONTRACTOR_TYPES.includes(body.type)) {
    return NextResponse.json(
      { error: `Type must be one of: ${CONTRACTOR_TYPES.join(', ')}` },
      { status: 400 },
    );
  }

  const adminUserId = auth.session!.user.id;

  try {
    const created = await withPlatformContext(adminUserId, () =>
      ContractorService.create(
        {
          companyName: body.companyName!,
          name: body.name!,
          email: body.email!,
          phone: body.phone!,
          address: body.address!,
          postCode: body.postCode!,
          ...(body.type !== undefined ? { type: body.type } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
        },
        { userId: adminUserId, role: 'PLATFORM_ADMIN' },
      ),
    );

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('Failed to create contractor:', error);
    return NextResponse.json({ error: 'Failed to create contractor' }, { status: 500 });
  }
}
