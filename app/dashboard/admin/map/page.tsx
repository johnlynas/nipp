'use client';

import { useState, useEffect } from 'react';
import OrgMap from '@/components/maps/OrgMap';
import { PageSkeleton } from '@/components/dashboard/PageSkeleton';
import { Building2 } from 'lucide-react';

/**
 * Admin map — Google Maps of an organization's location. Uses the same
 * location endpoint as the tenant Map page (membership OR super admin), and
 * reuses the org-chart page's ?org= / admin-list pattern so any tenant's map
 * can be shown from the admin dashboard. Organization selector is a compact
 * top-left overlay; the map canvas owns the rest of the view.
 */
export default function AdminMapPage() {
  const [orgId, setOrgId] = useState<string | null>(null);
  const [orgName, setOrgName] = useState<string>('');
  const [address, setAddress] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [organizations, setOrganizations] = useState<{ id: string; name: string }[]>([]);

  // -----------------------------------------------------------------------
  // Init: active org from session, localStorage fallback, ?org= override +
  // admin org list (mirrors app/dashboard/admin/org-chart/page.tsx).
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

      // Admin org switcher: ?org= selects which tenant's map to show.
      try {
        const urlOrg = new URL(window.location.href).searchParams.get('org');
        const listRes = await fetch('/api/admin/organizations/list');
        if (listRes.ok) {
          const data = await listRes.json();
          const orgs: { id: string; name: string }[] = data.organizations || [];
          setOrganizations(orgs);
          if (urlOrg && orgs.some((o) => o.id === urlOrg)) {
            setOrgId(urlOrg);
          }
        }
      } catch { /* keep the session's org; selector lists what's available */ }

      setLoading(false);
    }

    init();
  }, []);

  // -----------------------------------------------------------------------
  // Org identity + stored location — refetch whenever the displayed org changes.
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!orgId) return;
    let cancel = false;

    (async () => {
      setError(null);
      setAddress(null);
      setOrgName('');
      try {
        const res = await fetch(`/api/organizations/${orgId}/location`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Failed to load location (${res.status})`);
        }
        const data: { name?: string; location?: { address?: string } | null } = await res.json();
        if (cancel) return;
        setOrgName(data.name ?? '');
        setAddress(data.location?.address ?? null);
      } catch (e) {
        if (!cancel) setError(e instanceof Error ? e.message : 'Failed to load location');
      }
    })();

    return () => {
      cancel = true;
    };
  }, [orgId, refreshKey]);

  // -----------------------------------------------------------------------
  // Render states (same pattern as the tenant map + org-chart pages)
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
        <button
          onClick={() => setRefreshKey((k) => k + 1)}
          className="rounded px-4 py-2 text-sm text-white"
          style={{ backgroundColor: 'var(--color-navy-850)' }}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <OrgMap orgName={orgName || 'Organization'} address={address} />

      {/* Organization selector — top-left overlay, same box style as the map's
          address field (right-side stack), so OrgMap's overlays stay intact. */}
      {organizations.length > 0 && (
        <div className="absolute left-4 top-4 z-10 w-64 rounded-md border bg-white shadow-sm" style={{ borderColor: 'var(--color-slate-200)' }}>
          <label htmlFor="admin-map-org-select" className="sr-only">
            Select organization
          </label>
          <div className="flex items-center gap-1.5 p-1.5">
            <Building2 aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-500" />
            <select
              id="admin-map-org-select"
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
              className="w-full bg-transparent text-xs outline-none"
              style={{ color: 'var(--color-navy-850)' }}
            >
              {organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}
