import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { checkAdminRateLimit } from '@/lib/rate-limiter';

import { UserService } from '@/services/user-service';
import { notifyUserOperation } from '@/lib/notification-push';
// RLS Phase 3: user reads/updates run under verified platform contexts.
import tenantDb from '@/lib/tenant-db';
import { withPlatformContext } from '@/lib/platform-db';

export const runtime = 'nodejs';

/** Resolve the user's first organization ID (best effort, verified platform context). */
async function getFirstOrgId(sessionUserId: string, targetUserId: string): Promise<string | null> {
  try {
    const member = await withPlatformContext(sessionUserId, () =>
      tenantDb.member.findFirst({ where: { userId: targetUserId }, select: { orgId: true } })
    );
    return member?.orgId ?? null;
  } catch {
    return null;
  }
}

/**
 * GET /api/dashboard/admin/users/[id]
 * Get a single user by ID.
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
    // RLS: verified platform context for the user read (User has no RLS; ctx kept).
    const result = await withPlatformContext(auth.session!.user.id, () =>
      UserService.getById(id, { userId: auth.session!.user.id, role: 'PLATFORM_ADMIN' })
    );

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === 'User not found') {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    console.error('Failed to get user:', error);
    return NextResponse.json({ error: 'Failed to fetch user' }, { status: 500 });
  }
}

/**
 * PATCH /api/dashboard/admin/users/[id]
 * Update a user.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireSuperAdmin(request.headers);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const id = (await params).id;
  if (!checkAdminRateLimit(auth.session!.user.id)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  try {
    const body = await request.json();
    const targetLabel = body?.email || body?.name || id;

    // RLS: verified platform context for the update; org lookup likewise.
    const result = await withPlatformContext(auth.session!.user.id, () =>
      UserService.update(id, body, { userId: auth.session!.user.id, role: 'PLATFORM_ADMIN' })
    );

    const orgId = await getFirstOrgId(auth.session!.user.id, id);
    await notifyUserOperation('update', targetLabel, true, undefined, orgId);

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === 'User not found') {
      await notifyUserOperation('update', id, false, 'User not found');
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    console.error('Failed to update user:', error);
    const message =
      error instanceof Error && error.message ? error.message : 'Failed to update user';
    await notifyUserOperation('update', id, false, message, await getFirstOrgId(auth.session!.user.id, id));
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
  }
}

/**
 * DELETE /api/dashboard/admin/users/[id]
 * Delete a user.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireSuperAdmin(_request.headers);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const id = (await params).id;
    // Capture a label and org context for the notification before the user disappears
    // RLS: verified platform context wraps read + delete (User has no RLS; Member lookup is ctx-scoped).
    const existing = await withPlatformContext(auth.session!.user.id, () =>
      UserService.getById(id, { userId: auth.session!.user.id, role: 'PLATFORM_ADMIN' })
    );
    const targetLabel = existing ? `${existing.name ?? 'Unknown'} (${existing.email})` : id;
    const orgId = await getFirstOrgId(auth.session!.user.id, id);

    await withPlatformContext(auth.session!.user.id, () =>
      UserService.delete(id, { userId: auth.session!.user.id, role: 'PLATFORM_ADMIN' })
    );

    await notifyUserOperation('delete', targetLabel, true, undefined, orgId);

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'User not found') {
      await notifyUserOperation('delete', (await params).id, false, 'User not found');
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    console.error('Failed to delete user:', error);
    const message =
      error instanceof Error && error.message ? error.message : 'Failed to delete user';
    await notifyUserOperation('delete', (await params).id, false, message, await getFirstOrgId(auth.session!.user.id, (await params).id));
    return NextResponse.json({ error: 'Failed to delete user' }, { status: 500 });
  }
}
