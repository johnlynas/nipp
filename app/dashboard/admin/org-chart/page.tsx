'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import OrgChart from '@/components/org-chart/OrgChart';
import OrgChartSidebar from '@/components/org-chart/OrgChartSidebar';
import type { ChartTree } from '@/components/org-chart/types';
import { PageSkeleton } from '@/components/dashboard/PageSkeleton';

export default function OrgChartPage() {
  const [orgId, setOrgId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tree, setTree] = useState<ChartTree | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [organizations, setOrganizations] = useState<{ id: string; name: string }[]>([]);
  const [focusTeamId, setFocusTeamId] = useState<string | null>(null);

  // Track latest orgId for the async init closure below.
  const orgIdRef = useRef<string | null>(null);
  orgIdRef.current = orgId;

  // -----------------------------------------------------------------------
  // Init: active org from session, localStorage fallback, ?org= super-admin
  // override (mirrors app/dashboard/admin/calendar/page.tsx).
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
        if (stored) {
          setOrgId(stored);
        }
      }

      // Super admin org switcher: ?org= selects which tenant's chart to show.
      try {
        const urlOrg = new URL(window.location.href).searchParams.get('org');
        const listRes = await fetch('/api/admin/organizations/list');
        if (listRes.ok) {
          const data = await listRes.json();
          const orgs: { id: string; name: string }[] = data.organizations || [];
          setOrganizations(orgs);
          if (urlOrg && urlOrg !== orgIdRef.current) {
            const match = orgs.find((o) => o.id === urlOrg);
            if (match) {
              setOrgId(match.id);
            }
          }
        }
      } catch { /* keep the session's org; combobox stays hidden */ }

      setLoading(false);
    }

    init();
  }, []);

  // -----------------------------------------------------------------------
  // Tree fetch — refetch whenever the displayed org changes.
  // -----------------------------------------------------------------------
  const fetchTree = useCallback(async (targetOrgId: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/organizations/${targetOrgId}/org-chart`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || `Failed to load org chart (${res.status})`);
        setTree(null);
        return;
      }
      const data: ChartTree = await res.json();
      setTree(data);
    } catch {
      setError('Failed to load org chart');
      setTree(null);
    }
  }, []);

  useEffect(() => {
    if (orgId) {
      fetchTree(orgId);
    }
  }, [orgId, fetchTree]);

  // -----------------------------------------------------------------------
  // Render states
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

  if (error && !tree) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2">
        <p style={{ color: 'var(--color-navy-850)' }}>{error}</p>
        <button
          onClick={() => fetchTree(orgId)}
          className="rounded px-4 py-2 text-sm text-white"
          style={{ backgroundColor: 'var(--color-navy-850)' }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!tree) return null;

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Interactive canvas */}
      <OrgChart
        tree={tree}
        canEdit={tree.viewerCanEdit}
        organizationId={orgId}
        focusTeamId={focusTeamId}
        onFocusTeamHandled={() => setFocusTeamId(null)}
      />

      {/* Right slide-in panel (calendar-sidebar pattern) */}
      <OrgChartSidebar
        tree={tree}
        isExpanded={sidebarOpen}
        onToggle={() => setSidebarOpen((open) => !open)}
        organizations={organizations}
        selectedOrgId={orgId}
        onOrgChange={(id) => setOrgId(id)}
        onTeamClick={(teamId) => {
          setSidebarOpen(false); // reveal canvas — auto-expanded by focusTeamId
          setFocusTeamId(teamId);
        }}
        onMemberClick={(userId) => {
          window.location.href = `/admin/users/${userId}/view`;
        }}
      />
    </div>
  );
}
