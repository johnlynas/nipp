"use client";

import { useState, useEffect, useRef } from "react";
import Calendar from "@/components/calendar/Calendar";
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
        <p style={{ color: "#1B2A4A" }}>Loading calendar...</p>
      </div>
    );
  }

  if (!orgId) {
    return (
      <div className="flex items-center justify-center h-full">
        <p style={{ color: "#1B2A4A" }}>No organization selected</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Custom header */}
      <header className="bg-white border-b px-6 py-3 flex items-center justify-between shadow-sm" style={{ borderColor: '#dee2e6' }}>
        <h1 className="text-lg font-semibold" style={{ color: '#1B2A4A' }}>
          {selectedOrgName ? `${selectedOrgName} Calendar` : 'Calendar'}
        </h1>
      </header>
      <div className="flex-1 overflow-hidden">
        <Calendar
          organizationId={orgId}
          onOrganizationSelected={(id, name) => {
            setOrgId(id);
            if (name) setSelectedOrgName(name);
          }}
        />
      </div>
    </div>
  );
}
