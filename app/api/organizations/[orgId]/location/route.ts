/**
 * Organization location read endpoint.
 *
 * GET /api/organizations/[orgId]/location — returns the organization's map
 * location so the Map pages can centre on it: preferred are the stored
 * coordinates (`latitude`/`longitude`, plus optional `mapZoom`);
 * `metadata.location.address` remains a geocoding fallback when only an address
 * is set. Zoom is clamped to Google's 3–21 range before being returned.
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

/** Both coordinates must be finite numbers in range to count as a location. */
function isFiniteCoord(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

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
        select: { name: true, metadata: true, latitude: true, longitude: true, mapZoom: true },
      });

      if (!org) {
        return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
      }

      // Stored coordinates are preferred — the map can centre directly, no
      // geocoding call needed. Out-of-range values (bad data) are ignored.
      const lat = isFiniteCoord(org.latitude) ? org.latitude : null;
      const lng = isFiniteCoord(org.longitude) ? org.longitude : null;
      const hasCoords = lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

      // Stored zoom — optional (map falls back to its located/default zoom).
      const zoom = isFiniteCoord(org.mapZoom) ? Math.round(Math.min(21, Math.max(3, org.mapZoom!))) : null;

      // Address is best-effort JSON: { address?: string }. Anything unexpected
      // (old shapes, strings, booleans) simply means "no address set". The map
      // uses it as a geocoding fallback when coordinates are absent.
      const meta = org.metadata as Record<string, unknown> | null;
      const rawLocation = meta?.location;
      let address: string | null = null;
      if (rawLocation && typeof rawLocation === 'object' && !Array.isArray(rawLocation)) {
        const addr = (rawLocation as Record<string, unknown>).address;
        if (typeof addr === 'string' && addr.trim().length > 0) address = addr.trim();
      }

      const location = hasCoords
        ? { lat: lat!, lng: lng!, ...(zoom !== null ? { zoom } : {}), ...(address ? { address } : {}) }
        : address
          ? { address }
          : null;

      return NextResponse.json({ name: org.name, location });
    } catch (error) {
      if (error instanceof Error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  });
}
