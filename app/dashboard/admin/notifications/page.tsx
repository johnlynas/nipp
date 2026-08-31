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

// Priority level labels for the events table — plain colored text, no border/icon
const PRIORITY_LABELS: Record<string, string> = {
  INFO: 'text-blue-500',
  WARNING: 'text-yellow-500',
  ERROR: 'text-red-500',
  CRITICAL: 'text-red-600 font-semibold',
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NotificationItem {
  id: string;
  title: string;
  message: string;
  priority: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
  scope?: string;
  organizationId?: string;
  organizationName?: string;
  source?: string;
  createdAt: string;
}

interface PaginationInfo {
  page: number;
  pageSize: number;
  total: number;
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

  // SSE live updates
  const { notifications: liveNotifications } = useNotifications();

  // Fetch organizations list for the filter dropdown
  useEffect(() => {
    const fetchOrgs = async () => {
      try {
        const res = await encryptedFetch('/api/admin/organizations?pageSize=200', { pii: true });
        if (!res.ok) throw new Error('Failed to fetch organizations');
        const data = await res.json();
        setOrganizations(data.organizations.map((org: ApiOrganization) => ({ id: org.id, name: org.name })));
      } catch (err) {
        console.error('[Notifications Log] Failed to fetch organizations:', err);
      }
    };
    fetchOrgs();
  }, []);

  // Fetch paginated history
  const fetchNotifications = useCallback(async (page: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '8' });
      if (scopeFilter) params.set('scope', scopeFilter);
      if (priorityFilter) params.set('priority', priorityFilter);
      if (organizationFilter) params.set('organizationId', organizationFilter);
      if (searchQuery.trim()) params.set('search', searchQuery.trim());

      const res = await fetch(`/api/admin/notifications?${params}`);
      if (!res.ok) {
        console.warn('[Notifications Log] API returned non-OK status:', res.status);
        setNotifications([]);
        return;
      }

      const data = await res.json();
      setNotifications(data.notifications);
      setPagination(data.pagination);
    } catch (err) {
      console.error('[Notifications Log] Failed to fetch:', err);
    } finally {
      setLoading(false);
    }
  }, [scopeFilter, priorityFilter, organizationFilter, searchQuery]);

  useEffect(() => {
    fetchNotifications(1);
  }, [fetchNotifications]);

  // Merge live notifications into the list (deduplicate by ID)
  useEffect(() => {
    setNotifications((prev) => {
      const merged = [...prev];
      for (const live of liveNotifications) {
        if (!merged.find((n) => n.id === live.id)) {
          merged.unshift(live as NotificationItem);
        }
      }
      return merged.slice(0, 8); // Keep max 8 entries visible (matches page size)
    });
  }, [liveNotifications]);

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= Math.ceil(pagination.total / pagination.pageSize)) {
      fetchNotifications(newPage);
    }
  };

  const handleFilterChange = (setter: (val: string) => void, value: string) => {
    setter(value);
  };

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-wrap gap-4">
        <select
          value={scopeFilter}
          onChange={(e) => handleFilterChange(setScopeFilter, e.target.value)}
          className="px-3 py-2 border rounded text-sm bg-white"
          style={{ borderColor: '#dee2e6' }}
        >
          <option value="">All Scopes</option>
          <option value="GLOBAL">Global</option>
          <option value="ORG">Org</option>
        </select>

        <select
          value={priorityFilter}
          onChange={(e) => handleFilterChange(setPriorityFilter, e.target.value)}
          className="px-3 py-2 border rounded text-sm bg-white"
          style={{ borderColor: '#dee2e6' }}
        >
          <option value="">All Priorities</option>
          <option value="INFO">Info</option>
          <option value="WARNING">Warning</option>
          <option value="ERROR">Error</option>
          <option value="CRITICAL">Critical</option>
        </select>

        <select
          value={organizationFilter}
          onChange={(e) => handleFilterChange(setOrganizationFilter, e.target.value)}
          className="px-3 py-2 border rounded text-sm bg-white"
          style={{ borderColor: '#dee2e6' }}
        >
          <option value="">All Organizations</option>
          {organizations.map((org) => (
            <option key={org.id} value={org.id}>{org.name}</option>
          ))}
        </select>

        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search source or message..."
          className="px-3 py-2 border rounded text-sm bg-white"
          style={{ borderColor: '#dee2e6' }}
        />
      </div>

      {/* Notifications Table */}
      <div className="bg-white rounded-lg border overflow-hidden" style={{ borderColor: '#dee2e6' }}>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: '#1B2A4A' }} />
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-gray-500">
            No notifications found.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#1B2A4A]">
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-white" scope="col">Time</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-white" scope="col">Priority</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-white" scope="col">Scope</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-white" scope="col">Organization</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-white" scope="col">Source</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-white" scope="col">Message</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-white" scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {notifications.map((notif) => (
                <tr key={notif.id} className="border-b hover:bg-gray-50 transition-colors" style={{ borderColor: '#f1f3f4' }}>
                  <td className="px-4 py-3">
                    <span className="text-xs text-gray-900">{new Date(notif.createdAt).toLocaleString()}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs ${PRIORITY_LABELS[notif.priority] || PRIORITY_LABELS.INFO}`}>
                      {notif.priority}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-medium">{notif.scope || 'N/A'}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-gray-900">{notif.organizationName || '-'}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-gray-900">{notif.source || '-'}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{notif.title}</div>
                    <div className="text-xs text-gray-500 mt-1 line-clamp-2">{notif.message}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button
                        title="Acknowledge"
                        className="rounded p-1.5 text-gray-500 hover:bg-[#f8f9fa] transition-colors"
                      >
                        <Check className="h-4 w-4" />
                      </button>
                      <button
                        title="Delete"
                        className="rounded p-1.5 text-gray-500 hover:bg-[#f8f9fa] transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

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
    </div>
  );
}
