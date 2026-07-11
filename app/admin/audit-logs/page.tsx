'use client';

import { useState, useEffect } from 'react';
import { RequireSuperAdmin } from '@/components/auth/RequireSuperAdmin';
import { AuditLogViewer } from '@/components/admin/AuditLogViewer';

interface AuditEntry {
  id: string;
  timestamp: string;
  userId?: string | null;
  userName?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  organizationId?: string | null;
  success: boolean;
}

/**
 * Super Admin — Audit log viewer with filters.
 */
export default function AuditLogsPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [resourceFilter, setResourceFilter] = useState('');

  useEffect(() => {
    fetchAuditLogs();
  }, [resourceFilter]);

  async function fetchAuditLogs() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: '1', pageSize: '50' });
      if (resourceFilter) params.set('resourceType', resourceFilter);

      const res = await fetch(`/api/admin/audit-logs?${params}`);
      if (res.ok) {
        const data = await res.json();
        setEntries(data.auditLogs || []);
      }
    } catch (error) {
      console.error('Failed to fetch audit logs:', error);
    } finally {
      setLoading(false);
    }
  }

  return (
    <RequireSuperAdmin>
      <div className="min-h-screen">
        {/* Navy Header */}
        <header className="px-6 py-4" style={{ backgroundColor: '#1B2A4A' }}>
          <h1 className="text-xl font-semibold text-white">Property NI Admin</h1>
        </header>

        <main className="p-6">
          {/* Page Header */}
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold" style={{ color: '#1B2A4A' }}>Audit Logs</h2>
              <p className="text-sm text-gray-500">Security-relevant admin actions across all organizations</p>
            </div>
          </div>

          {/* Filters */}
          <div className="mb-4 flex gap-3">
            <select value={resourceFilter} onChange={(e) => setResourceFilter(e.target.value)} className="rounded border px-3 py-2 text-sm" aria-label="Filter by resource type">
              <option value="">All Resources</option>
              <option value="Organization">Organizations</option>
              <option value="Role">Roles</option>
              <option value="Permission">Permissions</option>
            </select>
          </div>

          {/* Audit Log Table */}
          <AuditLogViewer entries={entries} isLoading={loading} />
        </main>
      </div>
    </RequireSuperAdmin>
  );
}
