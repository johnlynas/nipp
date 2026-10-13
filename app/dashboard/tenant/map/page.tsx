'use client';

import { useState, useEffect } from 'react';
import OrgMap from '@/components/maps/OrgMap';
import { PageSkeleton } from '@/components/dashboard/PageSkeleton';
import { useTenantScope } from '@/hooks/useTenantScope';

/**
 * Tenant map — Google Maps of the organization's location. Read-only for
 * every tenant role (same scoping model as the org-chart page); super admins
 * keep the ?org= override so any tenant can be shown. The organization's
 * stored address (metadata.location.address) centres and pins the map; the
 * postcode field lets the viewer jump anywhere.
 */
export default function TenantMapPage() {
  const { isReadOnly } = useTenantScope();
  const [orgId, setOrgId] = useState<string | null>(null);
  const [orgName, setOrgName] = useState<string>('');
  const [address, setAddress] = useState<string | null>(null);
  // Stored coordinates + zoom — preferred centre over the geocoded address.
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [zoom, setZoom] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // -----------------------------------------------------------------------
  // Init: active org from session, localStorage fallback, ?org= super-admin
  // override (mirrors app/dashboard/admin/org-chart/page.tsx).
  // -----------------------------------------------------------------------
  useEffect(() => {
    async function init() {
      let gotOrgFromApi = false;
      try {
        const meRes = await fetch('/api/auth/me');
        if (meRes.ok) {
          const me = await meRes.json();
          if (me.activeOrganizationId) {
            setOrgId(me.activeOrganizationId);
            gotOrgFromApi = true;
          }
        }
      } catch { /* silently fail */ }

      if (!gotOrgFromApi) {
        const stored = localStorage.getItem('nipp-active-org-id');
        if (stored) setOrgId(stored);
      }

      // Super admin org switcher: ?org= selects which tenant to show.
      if (!isReadOnly) {
        const urlOrg = new URL(window.location.href).searchParams.get('org');
        if (urlOrg) setOrgId(urlOrg);
      }

      setLoading(false);
    }

    init();
  }, [isReadOnly]);

  // -----------------------------------------------------------------------
  // Org identity + stored location.
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!orgId) return;
    let cancel = false;

    (async () => {
      setError(null);
      setAddress(null);
      setLat(null);
      setLng(null);
      setZoom(null);
      setOrgName('');
      try {
        const res = await fetch(`/api/organizations/${orgId}/location`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Failed to load location (${res.status})`);
        }
        const data: { name?: string; location?: { lat?: number; lng?: number; zoom?: number; address?: string } | null } = await res.json();
        if (cancel) return;
        setOrgName(data.name ?? '');
        setAddress(data.location?.address ?? null);
        setLat(typeof data.location?.lat === 'number' ? data.location!.lat : null);
        setLng(typeof data.location?.lng === 'number' ? data.location!.lng : null);
        setZoom(typeof data.location?.zoom === 'number' ? data.location!.zoom : null);
      } catch (e) {
        if (!cancel) setError(e instanceof Error ? e.message : 'Failed to load location');
      }
    })();

    return () => {
      cancel = true;
    };
  }, [orgId]);

  // -----------------------------------------------------------------------
  // Render states (same pattern as the org-chart page)
  // -----------------------------------------------------------------------
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <PageSkeleton rows={4} cols={4} />
      </div>
    );
  }

  if (!orgId) {
    return (
      <div className="flex items-center justify-center h-full">
        <p style={{ color: 'var(--color-navy-850)' }}>No organization selected</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2">
        <p style={{ color: 'var(--color-navy-850)' }}>{error}</p>
      </div>
    );
  }

  return <OrgMap orgName={orgName || 'Organization'} address={address} lat={lat} lng={lng} zoom={zoom} />;
}
