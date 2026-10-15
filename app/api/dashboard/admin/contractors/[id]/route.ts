import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { checkAdminRateLimit } from '@/lib/rate-limiter';

import { ContractorService, CONTRACTOR_TYPES, type ContractorTypeValue } from '@/services/contractor-service';
// RLS Phase 3: contractors is a global (non-org-scoped, RLS-exempt) table — the
// verified platform context is kept for parity with the other admin routes.
import { withPlatformContext } from '@/lib/platform-db';
import { NotFoundError, ValidationError } from '@/lib/services/types';

export const runtime = 'nodejs';

/**
 * GET /api/dashboard/admin/contractors/[id]
 * Get a single contractor by ID.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireSuperAdmin(_request.headers);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const id = (await params).id;
    const result = await withPlatformContext(auth.session!.user.id, () =>
      ContractorService.getById(id, { userId: auth.session!.user.id, role: 'PLATFORM_ADMIN' }),
    );

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: 'Contractor not found' }, { status: 404 });
    }
    console.error('Failed to get contractor:', error);
    return NextResponse.json({ error: 'Failed to fetch contractor' }, { status: 500 });
  }
}

/**
 * PATCH /api/dashboard/admin/contractors/[id]
 * Update a contractor.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireSuperAdmin(request.headers);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const adminUserId = auth.session!.user.id;
  const id = (await params).id;

  // Rate limit write operations by session
  if (!checkAdminRateLimit(adminUserId)) {
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

  if (body.type !== undefined && !CONTRACTOR_TYPES.includes(body.type)) {
    return NextResponse.json(
      { error: `Type must be one of: ${CONTRACTOR_TYPES.join(', ')}` },
      { status: 400 },
    );
  }
  // At least one field must be provided so a no-op PATCH is explicit.
  if (Object.keys(body).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  try {
    const result = await withPlatformContext(adminUserId, () =>
      ContractorService.update(id, body, { userId: adminUserId, role: 'PLATFORM_ADMIN' }),
    );

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: 'Contractor not found' }, { status: 404 });
    }
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('Failed to update contractor:', error);
    return NextResponse.json({ error: 'Failed to update contractor' }, { status: 500 });
  }
}

/**
 * DELETE /api/dashboard/admin/contractors/[id]
 * Delete a contractor.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireSuperAdmin(_request.headers);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const id = (await params).id;
    const result = await withPlatformContext(auth.session!.user.id, () =>
      ContractorService.delete(id, { userId: auth.session!.user.id, role: 'PLATFORM_ADMIN' }),
    );

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: 'Contractor not found' }, { status: 404 });
    }
    console.error('Failed to delete contractor:', error);
    return NextResponse.json({ error: 'Failed to delete contractor' }, { status: 500 });
  }
}
