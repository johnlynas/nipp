/**
 * Notifications Log Page — Persistent history of all system notifications.
 *
 * Complements the ticker (transient) and system/audit logs with a searchable,
 * filterable history of all notifications delivered via SSE.
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { Check, Trash2 } from 'lucide-react';
import { useNotifications } from '@/hooks/useNotifications';
import { PaginationControls } from '@/components/admin/PaginationControls';
import { encryptedFetch } from '@/lib/api-client';
import { ConfirmDialog } from '@/components/dashboard/ConfirmDialog';
import { StatCard } from '@/components/dashboard/StatCard';
import { DataTable } from '@/components/dashboard/DataTable';

// Priority level labels for the events table — plain colored text, no border/icon.
// CALENDAR is the "event due to start" reminder priority; JOB is the job
// scheduler's success/failure signal.
const PRIORITY_LABELS: Record<string, string> = {
  INFO: 'text-slate-600 bg-slate-100 border-slate-200',
  WARNING: 'text-warning-ink bg-warning-tint border-warning-border',
  ERROR: 'text-danger-ink bg-danger-tint border-danger-border',
  CRITICAL: 'text-white bg-danger border-danger',
  CALENDAR: 'text-success bg-success-tint border-success-border',
  JOB: 'text-slate-700 bg-canvas-subtle border-slate-200 font-semibold',
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NotificationItem {
  id: string;
  title: string;
  message: string;
  priority: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL' | 'CALENDAR' | 'JOB';
  scope?: string;
  organizationId?: string;
  organizationName?: string;
  source?: string;
  acknowledged: boolean;
  createdAt: string;
}

interface PaginationInfo {
  page: number;
  pageSize: number;
  total: number;
}

interface NotificationCounts {
  totalCount: number;
  acknowledgedCount: number;
  notAcknowledgedCount: number;
  infoCount: number;
  warningCount: number;
  errorCount: number;
  criticalCount: number;
}

interface ApiOrganization {
  id: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function NotificationsLogPage() {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [pagination, setPagination] = useState<PaginationInfo>({ page: 1, pageSize: 8, total: 0 });
  const [loading, setLoading] = useState(false);
  const [scopeFilter, setScopeFilter] = useState<string>('');
  const [priorityFilter, setPriorityFilter] = useState<string>('');
  const [organizationFilter, setOrganizationFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [organizations, setOrganizations] = useState<{ id: string; name: string }[]>([]);
  const [selectedNotification, setSelectedNotification] = useState<NotificationItem | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);

  const [acknowledgedFilter, setAcknowledgedFilter] = useState<string>('');
  const [counts, setCounts] = useState<NotificationCounts>({
    totalCount: 0,
    acknowledgedCount: 0,
    notAcknowledgedCount: 0,
    infoCount: 0,
    warningCount: 0,
    errorCount: 0,
    criticalCount: 0,
  });

  // SSE live updates — use a refreshKey to trigger an API refetch when new
  // notifications arrive, instead of merging two data sources (which races).
  const { notifications: liveNotifications } = useNotifications();
  const [sseRefreshKey, setSseRefreshKey] = useState(0);

  // When the SSE hook delivers new notifications, bump the refresh key so
  // fetchNotifications runs again and pulls fresh data from the API.
  useEffect(() => {
    if (liveNotifications.length > 0) {
      setSseRefreshKey((k) => k + 1);
    }
  }, [liveNotifications]);

  // Fetch organizations list for the filter dropdown
  useEffect(() => {
    const fetchOrgs = async () => {
      try {
        const res = await encryptedFetch('/api/admin/organizations?pageSize=200', { pii: true });
        if (!res.ok) throw new Error('Failed to fetch organizations');

        // Guard against non-JSON responses
        const contentType = res.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          const text = await res.text();
          console.error('[Notifications Log] Organizations API returned non-JSON response:', text.slice(0, 200));
          return;
        }

        const data = await res.json();
        setOrganizations(data.organizations.map((org: ApiOrganization) => ({ id: org.id, name: org.name })));
      } catch (err) {
        console.error('[Notifications Log] Failed to fetch organizations:', err);
      }
    };
    fetchOrgs();
  }, []);

  // Fetch paginated history — also re-fetch when SSE refresh key changes
  const fetchNotifications = useCallback(async (page: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '8' });
      if (scopeFilter) params.set('scope', scopeFilter);
      if (priorityFilter) params.set('priority', priorityFilter);
      if (organizationFilter) params.set('organizationId', organizationFilter);
      if (acknowledgedFilter) params.set('acknowledged', acknowledgedFilter);
      if (searchQuery.trim()) params.set('search', searchQuery.trim());

      const res = await fetch(`/api/admin/notifications?${params}`);

      // Guard against non-JSON responses (auth redirects, 500 error pages, etc.)
      const contentType = res.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await res.text();
        console.error('[Notifications Log] API returned non-JSON response:', text.slice(0, 200));
        setNotifications([]);
        return;
      }

      if (!res.ok) {
        console.warn('[Notifications Log] API returned non-OK status:', res.status);
        setNotifications([]);
        return;
      }

      const data = await res.json();
      setNotifications(data.notifications);
      setPagination(data.pagination);
      if (data.counts) {
        setCounts(data.counts);
      }
    } catch (err) {
      console.error('[Notifications Log] Failed to fetch:', err);
    } finally {
      setLoading(false);
    }
  }, [scopeFilter, priorityFilter, organizationFilter, acknowledgedFilter, searchQuery]);

  useEffect(() => {
    fetchNotifications(1);
  }, [fetchNotifications, sseRefreshKey]);

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= Math.ceil(pagination.total / pagination.pageSize)) {
      fetchNotifications(newPage);
    }
  };

  const handleFilterChange = (setter: (val: string) => void, value: string) => {
    setter(value);
  };

  // Handle delete click — open confirmation modal
  const handleDeleteClick = (n: NotificationItem) => {
    setSelectedNotification(n);
    setDeleteModalOpen(true);
  };

  // Handle delete — call API, close modal, refresh list
  const handleDelete = async () => {
    if (!selectedNotification) return;

    try {
      const res = await fetch(`/api/admin/notifications?id=${encodeURIComponent(selectedNotification.id)}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete notification');
      }

      setDeleteModalOpen(false);
      fetchNotifications(pagination.page);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete notification';
      console.error('[Notifications Log] Delete failed:', err);
    }
  };

  // Handle acknowledge — call API and refresh the list so acknowledged field updates
  const handleAcknowledge = async (n: NotificationItem) => {
    try {
      const res = await fetch(`/api/admin/notifications?id=${encodeURIComponent(n.id)}`, {
        method: 'PATCH',
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to acknowledge notification');
      }

      fetchNotifications(pagination.page);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to acknowledge notification';
      console.error('[Notifications Log] Acknowledge failed:', err);
    }
  };

  return (
    <div className="space-y-6">
      {/* Stat Cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-7">
        <StatCard label="Total" value={counts.totalCount} />
        <StatCard label="Acknowledged" value={counts.acknowledgedCount} color="success" />
        <StatCard label="Not Acknowledged" value={counts.notAcknowledgedCount} />
        <StatCard label="Info" value={counts.infoCount} />
        <StatCard label="Warning" value={counts.warningCount} color="warning" />
        <StatCard label="Error" value={counts.errorCount} color="danger" />
        <StatCard label="Critical" value={counts.criticalCount} color="danger" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-4">
        <select
          value={scopeFilter}
          onChange={(e) => handleFilterChange(setScopeFilter, e.target.value)}
          className="px-3 py-2 border rounded text-sm bg-white text-slate-900"
          style={{ borderColor: 'var(--color-slate-200)' }}
        >
          <option value="">All Scopes</option>
          <option value="GLOBAL">Global</option>
          <option value="ORG">Org</option>
        </select>

        <select
          value={priorityFilter}
          onChange={(e) => handleFilterChange(setPriorityFilter, e.target.value)}
          className="px-3 py-2 border rounded text-sm bg-white text-slate-900"
          style={{ borderColor: 'var(--color-slate-200)' }}
        >
          <option value="">All Priorities</option>
          <option value="INFO">Info</option>
          <option value="WARNING">Warning</option>
          <option value="ERROR">Error</option>
          <option value="CRITICAL">Critical</option>
          <option value="CALENDAR">Calendar</option>
          <option value="JOB">Job</option>
        </select>

        <select
          value={organizationFilter}
          onChange={(e) => handleFilterChange(setOrganizationFilter, e.target.value)}
          className="px-3 py-2 border rounded text-sm bg-white text-slate-900"
          style={{ borderColor: 'var(--color-slate-200)' }}
        >
          <option value="">All Organizations</option>
          {organizations.map((org) => (
            <option key={org.id} value={org.id}>{org.name}</option>
          ))}
        </select>

        <select
          value={acknowledgedFilter}
          onChange={(e) => handleFilterChange(setAcknowledgedFilter, e.target.value)}
          className="px-3 py-2 border rounded text-sm bg-white text-slate-900"
          style={{ borderColor: 'var(--color-slate-200)' }}
        >
          <option value="">All Statuses</option>
          <option value="true">Acknowledged</option>
          <option value="false">Not Acknowledged</option>
        </select>

        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search source or message..."
          className="px-3 py-2 border rounded text-sm bg-white text-slate-900"
          style={{ borderColor: 'var(--color-slate-200)' }}
        />
      </div>

      {/* Notifications Table */}
      <div className="bg-white rounded-lg border" style={{ borderColor: 'var(--color-slate-200)' }}>
        <DataTable
          columns={[
            {
              key: 'time',
              label: 'Time',
              render: (n) => <span className="text-xs text-slate-900 tabular-nums">{new Date(n.createdAt).toLocaleString()}</span>,
            },
            {
              key: 'priority',
              label: 'Priority',
              render: (n) => (
                <span className={`text-xs ${PRIORITY_LABELS[n.priority] || PRIORITY_LABELS.INFO}`}>
                  {n.priority}
                </span>
              ),
            },
            {
              key: 'scope',
              label: 'Scope',
              render: (n) => <span className="text-xs font-medium text-slate-900">{n.scope || 'N/A'}</span>,
            },
            {
              key: 'organizationName',
              label: 'Organization',
              render: (n) => <span className="text-xs text-slate-900">{n.organizationName || '-'}</span>,
            },
            {
              key: 'source',
              label: 'Source',
              render: (n) => <span className="text-xs text-slate-900">{n.source || '-'}</span>,
            },
            {
              key: 'message',
              label: 'Message',
              render: (n) => (
                <div>
                  <div className="font-medium text-slate-900">{n.title}</div>
                  <div className="text-xs text-slate-500 mt-1 line-clamp-2">{n.message}</div>
                </div>
              ),
            },
            {
              key: 'actions',
              label: 'Actions',
              render: (n) => (
                <div className="flex items-center gap-1">
                  <button
                    title={n.acknowledged ? 'Acknowledged' : 'Acknowledge'}
                    onClick={() => handleAcknowledge(n)}
                    disabled={n.acknowledged}
                    className={`rounded p-1.5 transition-colors ${
                      n.acknowledged
                        ? 'text-slate-300 cursor-default'
                        : 'text-slate-400 hover:bg-canvas-subtle cursor-pointer'
                    }`}
                    aria-label={n.acknowledged ? 'Acknowledged notification' : 'Acknowledge notification'}
                  >
                    <Check className="h-4 w-4" />
                  </button>
                  <button
                    title="Delete"
                    onClick={() => handleDeleteClick(n)}
                    className="rounded p-1.5 text-slate-500 hover:bg-danger-tint hover:text-danger-ink transition-colors"
                    aria-label="Delete notification"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ),
            },
          ]}
          data={notifications}
          loading={loading}
          emptyMessage="No notifications found."
          rowKey={(n) => n.id}
        />

        {/* Pagination */}
        {Math.ceil(pagination.total / pagination.pageSize) > 0 && (
          <PaginationControls
            currentPage={pagination.page}
            totalPages={Math.ceil(pagination.total / pagination.pageSize)}
            totalItems={pagination.total}
            pageSize={pagination.pageSize}
            onPageChange={handlePageChange}
          />
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        onConfirm={handleDelete}
        title="Delete Notification"
        message={`Are you sure you want to delete this notification? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
      />
    </div>
  );
}
