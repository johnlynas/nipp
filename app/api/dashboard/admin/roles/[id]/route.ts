import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { checkAdminRateLimit } from '@/lib/rate-limiter';

import globalDb from '@/lib/global-db';
import { RoleService } from '@/services/role-service';
import { notifyRoleOperation } from '@/lib/notification-push';

export const runtime = 'nodejs';

/** Best effort: resolve a role's name for notification labels. */
async function getRoleLabel(id: string): Promise<string> {
  try {
    const role = await globalDb.role.findUnique({
      where: { id },
      select: { name: true },
    });
    return role ? `Role "${role.name}" (${id})` : id;
  } catch {
    return id;
  }
}

/** Best effort: resolve a role's organization ID for notification scoping. */
async function getRoleOrgId(id: string): Promise<string | null> {
  try {
    const role = await globalDb.role.findUnique({
      where: { id },
      select: { organizationId: true },
    });
    return role?.organizationId ?? null;
  } catch {
    return null;
  }
}

/**
 * GET /api/dashboard/admin/roles/[id]
 * Get a single role by ID.
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
    // Get role to find its orgId first
    const url = new URL(_request.url);
    const organizationId = url.searchParams.get('organizationId');

    if (!organizationId) {
      return NextResponse.json({ error: 'Organization ID is required' }, { status: 400 });
    }

    const result = await RoleService.getById(id, organizationId, {
      userId: auth.session!.user.id,
      role: 'PLATFORM_ADMIN',
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === 'Role not found') {
      return NextResponse.json({ error: 'Role not found' }, { status: 404 });
    }
    console.error('Failed to get role:', error);
    return NextResponse.json({ error: 'Failed to fetch role' }, { status: 500 });
  }
}

/**
 * PATCH /api/dashboard/admin/roles/[id]
 * Update a role.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireSuperAdmin(request.headers);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const id = (await params).id;
    if (!checkAdminRateLimit(auth.session!.user.id)) {
    return NextResponse.json({'error': 'rate_limited'}, {status: 429});
  }

  const body = await request.json();

    // Get role to find its orgId first
    const url = new URL(request.url);
    const organizationId = url.searchParams.get('organizationId');

    if (!organizationId) {
      return NextResponse.json({ error: 'Organization ID is required' }, { status: 400 });
    }

    // Capture the role name for notification labels before a rename happens
    const [targetLabel] = await Promise.all([getRoleLabel(id)]);

    try {
      const result = await RoleService.update(id, {
        name: body.name,
        description: body.description,
        isDefault: body.isDefault,
      }, organizationId, { userId: auth.session!.user.id, role: 'PLATFORM_ADMIN' });

      await notifyRoleOperation('update', targetLabel, true, undefined, organizationId);

      return NextResponse.json(result);
    } catch (error) {
      if (error instanceof Error && error.message === 'Role not found') {
        await notifyRoleOperation('update', id, false, 'Role not found');
        return NextResponse.json({ error: 'Role not found' }, { status: 404 });
      }
      console.error('Failed to update role:', error);
      const message = error instanceof Error && error.message ? error.message : 'Failed to update role';
      await notifyRoleOperation('update', targetLabel, false, message, organizationId);
      return NextResponse.json({ error: 'Failed to update role' }, { status: 500 });
    }
  } catch (error) {
    console.error('Failed to update role:', error);
    return NextResponse.json({ error: 'Failed to update role' }, { status: 500 });
  }
}

/**
 * DELETE /api/dashboard/admin/roles/[id]
 * Delete a role.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireSuperAdmin(request.headers);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const id = (await params).id;

    // Get role to find its orgId first
    const url = new URL(request.url);
    const organizationId = url.searchParams.get('organizationId');

    if (!organizationId) {
      return NextResponse.json({ error: 'Organization ID is required' }, { status: 400 });
    }

    // Capture a label and org context for the notification before the role disappears
    const [targetLabel, orgId] = await Promise.all([getRoleLabel(id), getRoleOrgId(id)]);

    try {
      await RoleService.delete(id, organizationId, {
        userId: auth.session!.user.id,
        role: 'PLATFORM_ADMIN',
      });

      await notifyRoleOperation('delete', targetLabel, true, undefined, orgId);

      return NextResponse.json({ success: true });
    } catch (error) {
      if (error instanceof Error && error.message === 'Role not found') {
        await notifyRoleOperation('delete', id, false, 'Role not found', orgId);
        return NextResponse.json({ error: 'Role not found' }, { status: 404 });
      }
      console.error('Failed to delete role:', error);
      const message = error instanceof Error && error.message ? error.message : 'Failed to delete role';
      await notifyRoleOperation('delete', targetLabel, false, message, orgId);
      if (error instanceof Error && error.message?.includes('Cannot delete role')) {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
      return NextResponse.json({ error: 'Failed to delete role' }, { status: 500 });
    }
  } catch (error) {
    console.error('Failed to delete role:', error);
    return NextResponse.json({ error: 'Failed to delete role' }, { status: 500 });
  }
}
