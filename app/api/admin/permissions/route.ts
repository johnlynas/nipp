/**
 * GET /api/admin/permissions
 * POST /api/admin/permissions
 * PATCH /api/admin/permissions/:id
 * DELETE /api/admin/permissions/:id
 *
 * Super Admin only — global permission catalog CRUD.
 */

import { NextRequest, NextResponse } from 'next/server';
import globalDb from '@/lib/global-db';
import { requireSuperAdmin, getRequestMetadata } from '@/lib/require-super-admin';
import { recordAuditLog } from '@/lib/audit-log';

export const runtime = 'nodejs';

/**
 * GET — List all permissions in the global catalog.
 */
export async function GET(request: NextRequest) {
  const authError = await requireSuperAdmin(request.headers);
  if (authError) return authError;

  const permissions = await globalDb.permission.findMany({
    orderBy: { resource: 'asc' },
  });

  return NextResponse.json({ permissions });
}

/**
 * POST — Create a new permission in the global catalog.
 */
export async function POST(request: NextRequest) {
  const authError = await requireSuperAdmin(request.headers);
  if (authError) return authError;

  const body = await request.json();
  const { key, resource, action, description } = body as {
    key: string;
    resource: string;
    action: string;
    description?: string;
  };

  if (!key || !resource || !action) {
    return NextResponse.json(
      { error: 'key, resource, and action are required' },
      { status: 400 }
    );
  }

  // Validate resource:action format
  if (!key.includes(':')) {
    return NextResponse.json(
      { error: 'Permission key must follow resource:action format' },
      { status: 400 }
    );
  }

  // Check for duplicate key
  const existing = await globalDb.permission.findUnique({ where: { key } });
  if (existing) {
    return NextResponse.json(
      { error: `Permission with key "${key}" already exists` },
      { status: 409 }
    );
  }

  const session = await (await import('@/lib/auth')).auth.api.getSession({
    headers: request.headers,
  });

  const permission = await globalDb.permission.create({
    data: { key, resource, action, description },
  });

  await recordAuditLog({
    userId: session?.user?.id,
    userName: session?.user?.name,
    action: 'permission.created',
    resourceType: 'Permission',
    resourceId: permission.id,
    organizationId: null,
    ipAddress: request.headers.get('x-forwarded-for') || 'unknown',
    userAgent: request.headers.get('user-agent') || 'unknown',
    success: true,
    metadata: { key },
  });

  return NextResponse.json({ permission }, { status: 201 });
}

/**
 * PATCH — Update a permission.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireSuperAdmin(request.headers);
  if (authError) return authError;

  const { id } = await params;
  const body = await request.json();
  const { description, key } = body as { description?: string; key?: string };

  if (!description && !key) {
    return NextResponse.json(
      { error: 'Provide description or key to update' },
      { status: 400 }
    );
  }

  const session = await (await import('@/lib/auth')).auth.api.getSession({
    headers: request.headers,
  });

  const permission = await globalDb.permission.update({
    where: { id },
    data: { ...(description && { description }), ...(key && { key }) },
  });

  await recordAuditLog({
    userId: session?.user?.id,
    userName: session?.user?.name,
    action: 'permission.updated',
    resourceType: 'Permission',
    resourceId: permission.id,
    organizationId: null,
    ipAddress: request.headers.get('x-forwarded-for') || 'unknown',
    userAgent: request.headers.get('user-agent') || 'unknown',
    success: true,
    metadata: { key: permission.key },
  });

  return NextResponse.json({ permission });
}

/**
 * DELETE — Delete a permission from the global catalog.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireSuperAdmin(_request.headers);
  if (authError) return authError;

  const { id } = await params;

  const session = await (await import('@/lib/auth')).auth.api.getSession({
    headers: _request.headers,
  });

  const permission = await globalDb.permission.findUnique({ where: { id } });
  if (!permission) {
    return NextResponse.json({ error: 'Permission not found' }, { status: 404 });
  }

  // Check if permission is used by any roles
  const usageCount = await globalDb.rolePermission.count({
    where: { permissionId: id },
  });

  if (usageCount > 0) {
    return NextResponse.json(
      { error: `Cannot delete permission used by ${usageCount} role(s)` },
      { status: 400 }
    );
  }

  await globalDb.permission.delete({ where: { id } });

  await recordAuditLog({
    userId: session?.user?.id,
    userName: session?.user?.name,
    action: 'permission.deleted',
    resourceType: 'Permission',
    resourceId: id,
    organizationId: null,
    ipAddress: _request.headers.get('x-forwarded-for') || 'unknown',
    userAgent: _request.headers.get('user-agent') || 'unknown',
    success: true,
    metadata: { key: permission.key },
  });

  return NextResponse.json({ success: true, message: 'Permission deleted' });
}
