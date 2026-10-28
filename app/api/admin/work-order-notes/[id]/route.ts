import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { checkAdminRateLimit } from '@/lib/rate-limiter';
import { withTenantAdminContext, withPlatformContext } from '@/lib/platform-db';
import tenantDb from '@/lib/tenant-db';
import { isSameSiteRequest } from '@/lib/csrf';
import { handleServiceError } from '@/lib/services/error-handler';
import { NotFoundError } from '@/lib/services/types';
import { WorkOrderNoteService } from '@/services/work-order-note-service';

export const runtime = 'nodejs';

function adminCtx(userId: string) {
  return { userId, role: 'PLATFORM_ADMIN' as const };
}

/** Org of the note's parent work order (platform probe — no tenant ctx yet). */
async function orgOfNote(noteId: string, adminUserId: string) {
  const note = await withPlatformContext(adminUserId, () =>
    tenantDb.workOrderNote.findUnique({ where: { workOrderNoteId: noteId }, select: { workOrderId: true } }),
  );
  if (!note) return null;
  const wo = await withPlatformContext(adminUserId, () =>
    tenantDb.workOrder.findUnique({ where: { workOrderId: note.workOrderId }, select: { organizationId: true } }),
  );
  return wo?.organizationId ?? null;
}

/**
 * PATCH /api/admin/work-order-notes/[id] — edit note text. Super-admin only.
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

  let body: { note?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!body.note) {
    return NextResponse.json({ error: 'note is required' }, { status: 400 });
  }

  const id = (await params).id;
  try {
    const orgId = await orgOfNote(id, adminUserId);
    if (!orgId) return NextResponse.json({ error: 'Work order note not found' }, { status: 404 });

    return await withTenantAdminContext(adminUserId, orgId, async () => {
      const updated = await WorkOrderNoteService.update(id, { note: body.note! }, adminCtx(adminUserId));
      return NextResponse.json(updated);
    });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: 'Work order note not found' }, { status: 404 });
    }
    return handleServiceError(error);
  }
}

/**
 * DELETE /api/admin/work-order-notes/[id] -- delete a note. Super-admin only.
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
    const orgId = await orgOfNote(id, adminUserId);
    if (!orgId) return NextResponse.json({ error: 'Work order note not found' }, { status: 404 });

    return await withTenantAdminContext(adminUserId, orgId, async () => {
      const result = await WorkOrderNoteService.delete(id, adminCtx(adminUserId));
      return NextResponse.json(result);
    });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: 'Work order note not found' }, { status: 404 });
    }
    return handleServiceError(error);
  }
}
