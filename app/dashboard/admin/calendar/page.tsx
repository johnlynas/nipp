"use client";

import { useState, useEffect } from "react";
import Calendar from "@/components/calendar/Calendar";
export default function CalendarPage() {
  const [orgId, setOrgId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedOrgName, setSelectedOrgName] = useState<string>('');

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
        <Calendar organizationId={orgId} />
      </div>
    </div>
  );
}
