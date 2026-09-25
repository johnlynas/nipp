"use client";

import { useState, useEffect, useRef } from "react";
import Calendar from "@/components/calendar/Calendar";
import { PageSkeleton } from '@/components/dashboard/PageSkeleton';
export default function CalendarPage() {
  const [orgId, setOrgId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedOrgName, setSelectedOrgName] = useState<string>('');

  // Track latest orgId for the async init closure below.
  const orgIdRef = useRef<string | null>(null);
  orgIdRef.current = orgId;

  useEffect(() => {
    async function init() {
      // Try to get active org from session first, then localStorage fallback
      let gotOrgFromApi = false;
      try {
        const meRes = await fetch("/api/auth/me");
        if (meRes.ok) {
          const me = await meRes.json();
          if (me.activeOrganizationId) {
            setOrgId(me.activeOrganizationId);
            setSelectedOrgName(me.organizationName || '');
            gotOrgFromApi = true;
          }
        }
      } catch { /* silently fail */ }

      if (!gotOrgFromApi) {
        const stored = localStorage.getItem("nipp-active-org-id");
        if (stored) {
          setOrgId(stored);
        }
      }

      // Super admin org switcher: ?org= selects which tenant's calendar to
      // display. When it names a different org than the session's active one,
      // resolve its name from the organizations list (super-admin only
      // endpoint) and display that org instead.
      try {
        const urlOrg = new URL(window.location.href).searchParams.get('org');
        if (urlOrg && urlOrg !== orgIdRef.current) {
          const listRes = await fetch('/api/admin/organizations/list');
          if (listRes.ok) {
            const data = await listRes.json();
            const match = (data.organizations || []).find((o: { id: string }) => o.id === urlOrg);
            if (match) {
              setOrgId(match.id);
              setSelectedOrgName(match.name);
            }
          }
        }
      } catch { /* keep the session's org */ }

      setLoading(false);
    }

    init();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <PageSkeleton rows={4} cols={3} />
      </div>
    );
  }

  if (!orgId) {
    return (
      <div className="flex items-center justify-center h-full">
        <p style={{ color: "var(--color-slate-700)" }}>No organization selected</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-hidden">
      <Calendar
        organizationId={orgId}
        organizationName={selectedOrgName}
        onOrganizationSelected={(id, name) => {
          setOrgId(id);
          if (name) setSelectedOrgName(name);
        }}
      />
    </div>
  );
}
