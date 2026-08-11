'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { SearchBar } from '@/components/dashboard/SearchBar';
import { DataTable } from '@/components/dashboard/DataTable';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { StatCard } from '@/components/dashboard/StatCard';
import { Modal } from '@/components/dashboard/Modal';
import { PaginationControls } from '@/components/admin/PaginationControls';

interface Permission {
  id: string;
  key: string;
  resource: string;
  action: string;
  description: string | null;
}

interface PaginationState {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export default function PermissionsPage() {
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [pagination, setPagination] = useState<PaginationState>({ page: 1, pageSize: 8, total: 0, totalPages: 0 });
  const [totalPermissionsCount, setTotalPermissionsCount] = useState<number>(0);
  const [search, setSearch] = useState('');
  const [resourceFilter, setResourceFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal states
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ key: '', resource: '', action: '', description: '' });

  // Get unique resources for filter (fetched from all permissions, not just current page)
  const [resources, setResources] = useState<string[]>([]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setPagination((p) => ({ ...p, page: 1 }));
  }, [search, resourceFilter]);

  // Abort controller to cancel stale fetch requests on rapid filter changes
  const abortControllerRef = useRef<AbortController | null>(null);

  // Fetch total count (unfiltered)
  useEffect(() => {
    async function fetchTotalCount() {
      try {
        const res = await fetch('/api/dashboard/admin/permissions?pageSize=1');
        if (res.ok) {
          const data = await res.json();
          setTotalPermissionsCount(data.pagination?.total ?? 0);
        }
      } catch (err) {
        console.error('Failed to fetch total permissions count:', err);
      }
    }
    fetchTotalCount();
  }, []);

  // Fetch all unique resources (large page size to get everything)
  useEffect(() => {
    async function fetchResources() {
      try {
        const res = await fetch('/api/dashboard/admin/permissions?pageSize=1000');
        if (res.ok) {
          const data = await res.json();
          const uniqueResources = [...new Set((data.items as Permission[] || []).map((p) => p.resource))].sort();
          setResources(uniqueResources);
        }
      } catch (err) {
        console.error('Failed to fetch resources:', err);
      }
    }
    fetchResources();
  }, []);

  // Fetch permissions
  const fetchData = useCallback(async () => {
    // Cancel any in-flight request to prevent stale responses
    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(pagination.page),
        pageSize: String(pagination.pageSize),
      });
      if (search) params.set('search', search);
      if (resourceFilter) params.set('resource', resourceFilter);

      const res = await fetch(`/api/dashboard/admin/permissions?${params}`, {
        signal: abortControllerRef.current.signal,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to fetch permissions');
      }

      const data = await res.json();
      setPermissions(data.items || []);

      const total = data.pagination?.total ?? 0;
      const pageSizeFromApi = data.pagination?.pageSize || pagination.pageSize || 10;
      const totalPages = Math.max(1, Math.ceil(total / pageSizeFromApi));

      setPagination({
        page: pagination.page,
        pageSize: pageSizeFromApi,
        total,
        totalPages,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      console.error('Failed to fetch permissions:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch permissions');
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.pageSize, search, resourceFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Handle create permission
  const handleCreate = async () => {
    try {
      const res = await fetch('/api/dashboard/admin/permissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createForm),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to create permission');
      }

      setCreateModalOpen(false);
      setCreateForm({ key: '', resource: '', action: '', description: '' });
      fetchData();
    } catch (err) {
      console.error('Failed to create permission:', err);
      setError(err instanceof Error ? err.message : 'Failed to create permission');
    }
  };

  const columns = [
    { key: 'key', label: 'Permission Key', render: (p: Permission) => (
      <code className="text-sm font-mono" style={{ color: '#1B2A4A' }}>{p.key}</code>
    )},
    { key: 'resource', label: 'Resource' },
    { key: 'action', label: 'Action' },
    { key: 'description', label: 'Description', render: (p: Permission) => p.description || '—' },
  ];

  return (
    <div>
      {/* Error Banner */}
      {error && (
        <div className="mb-4 rounded border bg-red-50 p-3 text-sm text-red-700" role="alert">
          {error}
        </div>
      )}

      {/* Stat Cards */}
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3">
        <StatCard label="Total Permissions" value={totalPermissionsCount} />
        <StatCard label="Unique Resources" value={resources.length} color="success" />
        <StatCard label="Showing" value={permissions.length} />
      </div>

      {/* Page Header */}
      <PageHeader title="Permissions" description="Global permission catalog">
        <button
          onClick={() => setCreateModalOpen(true)}
          className="rounded px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90"
          style={{ backgroundColor: '#F5A623' }}
        >
          + Create Permission
        </button>
      </PageHeader>

      {/* Filters */}
      <div className="mb-4 flex items-center gap-3">
        <SearchBar value={search} onChange={setSearch} placeholder="Search by key, resource, or action..." aria-label="Search permissions" />
        <select
          value={resourceFilter}
          onChange={(e) => setResourceFilter(e.target.value)}
          className="rounded border px-3 py-2 text-sm bg-white hover:bg-gray-50 transition-colors focus:outline-none"
          style={{ borderColor: '#dee2e6', color: '#1B2A4A' }}
          aria-label="Filter by resource"
        >
          <option value="">All Resources</option>
          {resources.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <DataTable<Permission> columns={columns} data={permissions} loading={loading} emptyMessage="No permissions found" />

      {/* Pagination */}
      <PaginationControls
        currentPage={pagination.page}
        totalPages={pagination.totalPages}
        totalItems={pagination.total}
        pageSize={pagination.pageSize}
        onPageChange={(page) => setPagination((p) => ({ ...p, page }))}
      />

      {/* Create Permission Modal */}
      <Modal isOpen={createModalOpen} onClose={() => setCreateModalOpen(false)} title="Create Permission" size="md">
        <div className="space-y-4">
          <div>
            <label htmlFor="perm-key" className="mb-1 block text-sm font-medium" style={{ color: '#6c757d' }}>Key (resource:action)</label>
            <input
              id="perm-key"
              type="text"
              value={createForm.key}
              onChange={(e) => setCreateForm((f) => ({ ...f, key: e.target.value }))}
              className="w-full rounded border px-3 py-2 text-sm focus:outline-none font-mono"
              style={{ borderColor: '#dee2e6' }}
              placeholder="properties:view"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="perm-resource" className="mb-1 block text-sm font-medium" style={{ color: '#6c757d' }}>Resource</label>
              <input
                id="perm-resource"
                type="text"
                value={createForm.resource}
                onChange={(e) => setCreateForm((f) => ({ ...f, resource: e.target.value }))}
                className="w-full rounded border px-3 py-2 text-sm focus:outline-none"
                style={{ borderColor: '#dee2e6' }}
                placeholder="properties"
              />
            </div>
            <div>
              <label htmlFor="perm-action" className="mb-1 block text-sm font-medium" style={{ color: '#6c757d' }}>Action</label>
              <input
                id="perm-action"
                type="text"
                value={createForm.action}
                onChange={(e) => setCreateForm((f) => ({ ...f, action: e.target.value }))}
                className="w-full rounded border px-3 py-2 text-sm focus:outline-none"
                style={{ borderColor: '#dee2e6' }}
                placeholder="view"
              />
            </div>
          </div>
          <div>
            <label htmlFor="perm-desc" className="mb-1 block text-sm font-medium" style={{ color: '#6c757d' }}>Description (optional)</label>
            <textarea
              id="perm-desc"
              value={createForm.description}
              onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))}
              className="w-full rounded border px-3 py-2 text-sm focus:outline-none"
              style={{ borderColor: '#dee2e6' }}
              placeholder="Permission description"
              rows={3}
            />
          </div>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setCreateModalOpen(false)}
              className="rounded border px-4 py-2 text-sm font-medium transition-colors hover:bg-gray-50"
              style={{ borderColor: '#dee2e6', color: '#1B2A4A' }}
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={!createForm.key.trim() || !createForm.resource.trim() || !createForm.action.trim()}
              className="rounded px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: '#F5A623' }}
            >
              Create Permission
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
