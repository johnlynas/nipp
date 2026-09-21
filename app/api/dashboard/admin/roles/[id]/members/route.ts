import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { checkAdminRateLimit } from '@/lib/rate-limiter';

import { RoleService } from '@/services/role-service';
// RLS Phase 3: role member listing runs under a verified target-org context.
import { withTenantAdminContext } from '@/lib/platform-db';

export const runtime = 'nodejs';

/**
 * GET /api/dashboard/admin/roles/[id]/members
 * List members assigned to the role.
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
    const url = new URL(_request.url);
    const organizationId = url.searchParams.get('organizationId');

    if (!organizationId) {
      return NextResponse.json({ error: 'Organization ID is required' }, { status: 400 });
    }

    // Verified target-org context (flag=1, ctx=target org) for the member read.
    const result = await withTenantAdminContext(auth.session!.user.id, organizationId, () =>
      RoleService.getRoleMembers(id, organizationId, {
        userId: auth.session!.user.id,
        role: 'PLATFORM_ADMIN',
      })
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to list role members:', error);
    return NextResponse.json({ error: 'Failed to fetch role members' }, { status: 500 });
  }
}
