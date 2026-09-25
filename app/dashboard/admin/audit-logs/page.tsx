'use client';

import { useState, useEffect } from 'react';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { AuditLogViewer } from '@/components/admin/AuditLogViewer';
import { encryptedFetch } from '@/lib/api-client';

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

export default function AuditLogsPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [resourceFilter, setResourceFilter] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAuditLogs();
  }, [resourceFilter]);

  async function fetchAuditLogs() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: '1', pageSize: '50' });
      if (resourceFilter) params.set('resourceType', resourceFilter);

      const res = await encryptedFetch(`/api/admin/audit-logs?${params}`, { pii: true, cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load audit logs');
      const data = await res.json();
      setEntries(data.auditLogs || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <PageHeader title="" description="Security-relevant actions across all organizations" />

      {error && (
        <div className="mb-4 rounded-lg border border-danger-border bg-danger-tint p-3 text-sm text-danger-ink" role="alert">
          Failed to load audit logs. Check your connection and try again.
        </div>
      )}

      {/* Filters */}
      <div className="mb-4 flex gap-3">
        <select
          value={resourceFilter}
          onChange={(e) => setResourceFilter(e.target.value)}
          className="rounded border px-3 py-2 text-sm bg-white"
          aria-label="Filter by resource type"
        >
          <option value="">All Resources</option>
          <option value="Organization">Organizations</option>
          <option value="Role">Roles</option>
          <option value="Permission">Permissions</option>
        </select>
      </div>

      {/* Audit Log Table */}
      {!error && <AuditLogViewer entries={entries} isLoading={loading} />}
    </div>
  );
}
