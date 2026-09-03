import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { checkAdminRateLimit } from '@/lib/rate-limiter';

import { OrganizationService, type UpdateOrganizationInput } from '@/services/organization-service';
import type { ServiceContext } from '@/lib/services/types';
import { notifyOrganizationOperation } from '@/lib/notification-push';

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
    const result = await OrganizationService.getOrganizationById(id, {
      userId: auth.session!.user.id,
      role: 'PLATFORM_ADMIN',
    });

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

  // Capture the org name for the notification label before it possibly changes
  const targetLabel = await getOrgLabel(id, ctx);

  try {
    const result = await OrganizationService.updateOrganization(id, body, ctx);

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
