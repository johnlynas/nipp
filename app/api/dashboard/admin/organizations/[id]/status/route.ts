import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { checkAdminRateLimit } from '@/lib/rate-limiter';

import { OrganizationService } from '@/services/organization-service';
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
 * PATCH /api/dashboard/admin/organizations/[id]/status
 * Update organization status (suspend/reactivate/archive).
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

  let body: { status?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.status) {
    return NextResponse.json({ error: 'Status is required' }, { status: 400 });
  }

  const validStatuses = ['PENDING', 'ACTIVE', 'SUSPENDED', 'ARCHIVED'] as const;
  const newStatus = body.status as (typeof validStatuses)[number];
  if (!validStatuses.includes(newStatus)) {
    return NextResponse.json({ error: 'Invalid status value' }, { status: 400 });
  }

  // Capture the org name for the notification label before it possibly changes
  const targetLabel = await getOrgLabel(id, ctx);
  // Archiving is the terminal removal for organizations (they cannot be deleted)
  const operation = newStatus === 'ARCHIVED' ? ('archive' as const) : ('update' as const);

  try {
    const result = await OrganizationService.updateOrganization(
      id,
      { status: newStatus },
      ctx
    );

    await notifyOrganizationOperation(operation, targetLabel, true, undefined, id);

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === 'Organization not found') {
      await notifyOrganizationOperation(operation, id, false, 'Organization not found');
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }
    console.error('Failed to update organization status:', error);
    const message =
      error instanceof Error && error.message ? error.message : 'Failed to update organization status';
    await notifyOrganizationOperation(operation, targetLabel, false, message, id);
    return NextResponse.json({ error: 'Failed to update organization status' }, { status: 500 });
  }
}
