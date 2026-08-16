"use client";

import { useState, useEffect } from "react";
import Calendar from "@/components/calendar/Calendar";

interface Organization {
  id: string;
  name: string;
}

export default function CalendarPage() {
  const [orgId, setOrgId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [selectedOrgName, setSelectedOrgName] = useState<string>('');

  useEffect(() => {
    async function init() {
      // Fetch available organizations for the selector (super admin only)
      try {
        const res = await fetch("/api/dashboard/admin/organizations");
        if (res.ok) {
          const data = await res.json();
          setOrgs(data.organizations || []);
        }
      } catch {
        // Silently fail — org selector will just be empty
      }

      // Try to get active org from session first, then localStorage fallback
      try {
        const meRes = await fetch("/api/auth/me");
        if (meRes.ok) {
          const me = await meRes.json();
          if (me.activeOrganizationId) {
            setOrgId(me.activeOrganizationId);
          }
        }
      } catch {
        // Fall through to localStorage
      }

      const stored = localStorage.getItem("nipp-active-org-id");
      if (stored) {
        setOrgId(stored);
      }

      setLoading(false);
    }

    init();
  }, []);

  // Fetch organization name directly when orgId is available
  useEffect(() => {
    if (!orgId) return;

    let cancelled = false;
    async function fetchOrgName() {
      try {
        const res = await fetch(`/api/organizations/${orgId}`);
        if (res.ok && !cancelled) {
          const data = await res.json();
          setSelectedOrgName(data.name || '');
        }
      } catch {
        // Silently fail — fall back to org list lookup
      }
    }

    fetchOrgName();

    // Fallback: if direct fetch failed, try the org list
    if (orgs.length > 0 && !selectedOrgName) {
      const current = orgs.find((o) => o.id === orgId);
      if (current?.name) {
        setSelectedOrgName(current.name);
      }
    }

    return () => { cancelled = true; };
  }, [orgId, orgs, selectedOrgName]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p style={{ color: "#1B2A4A" }}>Loading calendar...</p>
      </div>
    );
  }

  if (!orgId || orgs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p style={{ color: "#1B2A4A", fontSize: "1.1rem" }}>
          Select an organization to view its calendar
        </p>
        <select
          value={orgId || ""}
          onChange={(e) => {
            const id = e.target.value;
            setOrgId(id || null);
            if (id) {
              localStorage.setItem("nipp-active-org-id", id);
            } else {
              localStorage.removeItem("nipp-active-org-id");
            }
          }}
          className="px-4 py-2 rounded border text-sm min-w-[280px]"
          style={{ borderColor: "#dee2e6", color: "#1B2A4A" }}
        >
          <option value="">— Select organization —</option>
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
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
