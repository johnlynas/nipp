import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { checkAdminRateLimit } from '@/lib/rate-limiter';

import { OrganizationService, type UpdateOrganizationInput } from '@/services/organization-service';
import type { ServiceContext } from '@/lib/services/types';
import { notifyOrganizationOperation } from '@/lib/notification-push';
// RLS Phase 3: org read/update run under verified platform contexts.
import { withPlatformContext, withTenantAdminContext } from '@/lib/platform-db';

export const runtime = 'nodejs';

/** Resolve an organization's name for notification labels (best effort). */
async function getOrgLabel(id: string, ctx: ServiceContext): Promise<string> {
  try {
    const org = await OrganizationService.getOrganizationById(id, ctx);
    return org ? `Organization "${org.name}" (${id})` : id;
  } catch {
    return id;
  }
}

/**
 * GET /api/dashboard/admin/organizations/[id]
 * Get a single organization by ID.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireSuperAdmin(_request.headers);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const id = (await params).id;
    // Verified target-org context for the org read.
    const result = await withTenantAdminContext(auth.session!.user.id, id, () =>
      OrganizationService.getOrganizationById(id, {
        userId: auth.session!.user.id,
        role: 'PLATFORM_ADMIN',
      })
    );

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === 'Organization not found') {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }
    console.error('Failed to get organization:', error);
    return NextResponse.json({ error: 'Failed to fetch organization' }, { status: 500 });
  }
}

/**
 * PATCH /api/dashboard/admin/organizations/[id]
 * Update an organization.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireSuperAdmin(request.headers);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const ctx: ServiceContext = {
    userId: auth.session!.user.id,
    role: 'PLATFORM_ADMIN',
  };
  const id = (await params).id;

  // Rate limit write operations by session
  if (!checkAdminRateLimit(ctx.userId)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  let body: UpdateOrganizationInput;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Notification label defaults to the id; replaced with the org's name once
  // looked up inside the verified context below.
  let targetLabel = id;
  try {
    // One verified target-org context covers label lookup + update.
    const { label, updated: result } = await withTenantAdminContext(
      auth.session!.user.id,
      id,
      async () => ({
        label: await getOrgLabel(id, ctx),
        updated: await OrganizationService.updateOrganization(id, body, ctx),
      })
    );
    targetLabel = label;

    // P7: Invalidate cached org details on update (same tag the admin-scope
    // route uses — keeps GET /api/admin/organizations/[id] from serving a
    // stale snapshot for its 30s revalidate window).
    revalidateTag('org', { expire: 0 });

    await notifyOrganizationOperation('update', targetLabel, true, undefined, id);

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === 'Organization not found') {
      await notifyOrganizationOperation('update', id, false, 'Organization not found');
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }
    console.error('Failed to update organization:', error);
    const message =
      error instanceof Error && error.message ? error.message : 'Failed to update organization';
    await notifyOrganizationOperation('update', targetLabel, false, message, id);
    return NextResponse.json({ error: 'Failed to update organization' }, { status: 500 });
  }
}

/**
 * DELETE /api/dashboard/admin/organizations/[id]
 * Delete an organization. Platform Admin only.
 *
 * Safety semantics live in OrganizationService.deleteOrganization: the
 * Platform Organization is protected, and organizations with existing members
 * are refused (archive those instead). Memberless orgs — including archived
 * ones — are hard-deleted.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireSuperAdmin(request.headers);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const ctx: ServiceContext = {
    userId: auth.session!.user.id,
    role: 'PLATFORM_ADMIN',
  };
  const id = (await params).id;

  // Rate limit write operations by session
  if (!checkAdminRateLimit(ctx.userId)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  try {
    // One verified target-org context covers label lookup + delete.
    const { label, deleted } = await withTenantAdminContext(
      auth.session!.user.id,
      id,
      async () => ({
        label: await getOrgLabel(id, ctx),
        deleted: await OrganizationService.deleteOrganization(id, ctx),
      })
    );

    // No organizationId on success: the org row is gone, and Notification's
    // FK to Organization would reject it. The target label already carries
    // the org name in the message.
    await notifyOrganizationOperation('delete', label, true);

    // P7: Invalidate cached org details on delete (same tag the admin-scope
    // route uses — a hard-deleted org must not keep serving from cache).
    revalidateTag('org', { expire: 0 });

    return NextResponse.json(deleted);
  } catch (error) {
    if (error instanceof Error && error.message === 'Organization not found') {
      await notifyOrganizationOperation('delete', id, false, 'Organization not found');
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }
    console.error('Failed to delete organization:', error);
    const message =
      error instanceof Error && error.message ? error.message : 'Failed to delete organization';
    await notifyOrganizationOperation('delete', id, false, message, id);
    if (error instanceof Error && error.name === 'ConflictError') {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof Error && error.name === 'ForbiddenError') {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json({ error: 'Failed to delete organization' }, { status: 500 });
  }
}
