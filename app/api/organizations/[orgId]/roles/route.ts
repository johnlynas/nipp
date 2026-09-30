/**
 * GET /api/organizations/[orgId]/roles — membership-scoped role list (read-only).
 *
 * Any member of the organization can read its roles; super admins can read
 * any (via the platform fallback in resolveTenantAccess). Writes remain on
 * the admin-gated endpoints (/api/admin/organizations/[orgId]/roles and
 * /api/roles), so this route intentionally only implements GET.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { resolveTenantAccess, toTenantContext } from '@/lib/tenant-access';
// RLS Phase 3: verified-context tenantDb (unscoped globalDb deleted).
import tenantDb from '@/lib/tenant-db';
import { withRLSContext } from '@/lib/rls-transaction';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// GET — list roles for a viewer's own organization
// ---------------------------------------------------------------------------

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const session = await auth.api.getSession({ headers: req.headers });

  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const orgId = (await params).orgId;

  // Membership OR super admin (mirrors the calendar and org-chart routes).
  const access = await resolveTenantAccess(req, session.user.id, orgId);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  return withRLSContext(toTenantContext(access, session.user.id), async () => {
    try {
      const roles = await tenantDb.role.findMany({
        where: { organizationId: orgId },
        include: { _count: { select: { memberRoles: true } } },
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      });

      return NextResponse.json({ roles });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load roles';
      const status = message.toLowerCase().includes('not found') ? 404 : 500;
      return NextResponse.json({ error: message }, { status });
    }
  });
}
