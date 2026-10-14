import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { checkAdminRateLimit } from '@/lib/rate-limiter';
// RLS Phase 3: unit reads run under verified platform contexts; UPDATE/DELETE
// target an org-scoped row, which the Units policy's WITH CHECK binds to
// app.current_org_id — so they run under a verified target-org (tenant-admin) context.
import tenantDb from '@/lib/tenant-db';
import { withPlatformContext, withTenantAdminContext } from '@/lib/platform-db';
import { UnitService, UNIT_TYPES, type UnitTypeValue } from '@/services/unit-service';
import { NotFoundError, ValidationError, ForbiddenError } from '@/lib/services/types';

export const runtime = 'nodejs';

/** Best effort: resolve a unit's address for labels + its organization (verified platform context). */
async function getUnitRef(adminUserId: string, id: string): Promise<{ label: string; orgId: string | null }> {
  try {
    const unit = await withPlatformContext(adminUserId, () =>
      tenantDb.units.findUnique({ where: { unitId: id }, select: { address: true, organizationId: true } }),
    );
    return unit ? { label: `Unit at ${unit.address} (${id})`, orgId: unit.organizationId } : { label: id, orgId: null };
  } catch {
    return { label: id, orgId: null };
  }
}

/**
 * GET /api/dashboard/admin/units/[id]
 * Get a single unit by ID (with organization).
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
    // RLS: verified platform context (Units is RLS-scoped; flag admits cross-tenant reads).
    const result = await withPlatformContext(auth.session!.user.id, () =>
      UnitService.getUnitById(id, { userId: auth.session!.user.id, role: 'PLATFORM_ADMIN' }),
    );

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: 'Unit not found' }, { status: 404 });
    }
    console.error('Failed to get unit:', error);
    return NextResponse.json({ error: 'Failed to fetch unit' }, { status: 500 });
  }
}

/**
 * PATCH /api/dashboard/admin/units/[id]
 * Update a unit.
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

  let body: { owner?: string; address?: string; postCode?: string; rented?: boolean; type?: UnitTypeValue };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (body.type !== undefined && !UNIT_TYPES.includes(body.type)) {
    return NextResponse.json(
      { error: `Type must be one of: ${UNIT_TYPES.join(', ')}` },
      { status: 400 },
    );
  }
  // At least one field must be provided so a no-op PATCH is explicit.
  if (Object.keys(body).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  const { orgId: unitOrgId } = await getUnitRef(adminUserId, id);

  try {
    const doUpdate = () =>
      UnitService.updateUnit(id, body, { userId: adminUserId, role: 'PLATFORM_ADMIN' });
    // RLS: UPDATE's WITH CHECK binds to app.current_org_id — bind the unit's org.
    if (unitOrgId) {
      await withTenantAdminContext(adminUserId, unitOrgId, doUpdate);
    } else {
      // Pre-update lookup failed; a successful update is impossible without it —
      // report not found rather than running platform-wide.
      return NextResponse.json({ error: 'Unit not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: 'Unit not found' }, { status: 404 });
    }
    console.error('Failed to update unit:', error);
    const message = error instanceof Error && error.message ? error.message : 'Failed to update unit';
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: message }, { status: 403 });
    }
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Failed to update unit' }, { status: 500 });
  }
}

/**
 * DELETE /api/dashboard/admin/units/[id]
 * Delete a unit.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireSuperAdmin(_request.headers);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const adminUserId = auth.session!.user.id;
  const id = (await params).id;

  // Capture org context before the unit disappears (audit is logged in the service).
  const { orgId } = await getUnitRef(adminUserId, id);

  try {
    // RLS: DELETE's WITH CHECK binds to app.current_org_id — bind the unit's org.
    if (orgId) {
      await withTenantAdminContext(adminUserId, orgId, () =>
        UnitService.deleteUnit(id, { userId: adminUserId, role: 'PLATFORM_ADMIN' }),
      );
    } else {
      return NextResponse.json({ error: 'Unit not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: 'Unit not found' }, { status: 404 });
    }
    console.error('Failed to delete unit:', error);
    const message = error instanceof Error && error.message ? error.message : 'Failed to delete unit';
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: message }, { status: 403 });
    }
    return NextResponse.json({ error: 'Failed to delete unit' }, { status: 500 });
  }
}
