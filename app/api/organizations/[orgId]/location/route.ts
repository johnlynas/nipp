/**
 * Organization location read endpoint.
 *
 * GET /api/organizations/[orgId]/location — returns the organization's map
 * location (stored under `metadata.location` as `{ address }`) so the tenant
 * workspace Map page can centre on the organization.
 *
 * Authorization (mirrors the org-chart route):
 *   - membership OR super admin via resolveTenantAccess (401 / 403 / 503)
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { resolveTenantAccess, toTenantContext } from '@/lib/tenant-access';
// RLS Phase 3: verified-context tenantDb (unscoped globalDb deleted).
import tenantDb from '@/lib/tenant-db';
import { withRLSContext } from '@/lib/rls-transaction';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const session = await auth.api.getSession({ headers: req.headers });

  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const orgId = (await params).orgId;

  // Membership OR super admin (platform super admin can view any tenant's map)
  const access = await resolveTenantAccess(req, session.user.id, orgId);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  return withRLSContext(toTenantContext(access, session.user.id), async () => {
    try {
      const org = await tenantDb.organization.findUnique({
        where: { id: orgId },
        select: { name: true, metadata: true },
      });

      if (!org) {
        return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
      }

      // Location is best-effort JSON: { address?: string }. Anything unexpected
      // (old shapes, strings, booleans) simply means "no location set".
      const meta = org.metadata as Record<string, unknown> | null;
      const rawLocation = meta?.location;
      let address: string | null = null;
      if (rawLocation && typeof rawLocation === 'object' && !Array.isArray(rawLocation)) {
        const addr = (rawLocation as Record<string, unknown>).address;
        if (typeof addr === 'string' && addr.trim().length > 0) address = addr.trim();
      }

      return NextResponse.json({ name: org.name, location: address ? { address } : null });
    } catch (error) {
      if (error instanceof Error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  });
}
