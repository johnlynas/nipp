'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Eye, Pencil, Trash2 } from 'lucide-react';
import { logClientError } from '@/lib/client-error-logger';
import { SearchBar } from '@/components/dashboard/SearchBar';
import { DataTable } from '@/components/dashboard/DataTable';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { StatCard } from '@/components/dashboard/StatCard';
import { Modal } from '@/components/dashboard/Modal';
import { ConfirmDialog } from '@/components/dashboard/ConfirmDialog';
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
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedPermission, setSelectedPermission] = useState<Permission | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ key: '', resource: '', action: '', description: '' });

  // Edit modal states
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editForm, setEditForm] = useState({ key: '', resource: '', action: '', description: '' });

  // Get unique resources for filter (fetched from all permissions, not just current page)
  const [resources, setResources] = useState<string[]>([]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setPagination((p) => ({ ...p, page: 1 }));
  }, [search, resourceFilter]);

  // Reset edit form when modal opens/closes
  useEffect(() => {
    if (!editModalOpen) {
      setEditForm({ key: '', resource: '', action: '', description: '' });
    }
  }, [editModalOpen]);

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
      const totalPages = Math.max(1, Math.ceil(total / pagination.pageSize));

      setPagination({
        page: pagination.page,
        pageSize: pagination.pageSize,
        total,
        totalPages,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const message = err instanceof Error ? err.message : 'Failed to fetch permissions';
      console.error('Failed to fetch permissions:', err);
      logClientError(message, 'permissions', 'fetch');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.pageSize, search, resourceFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-dismiss error banners after 6 seconds
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(timer);
  }, [error]);

  // Handle view permission
  const handleView = (p: Permission) => {
    setSelectedPermission(p);
    setDetailModalOpen(true);
  };

  // Handle edit permission
  const handleEditClick = (p: Permission) => {
    setSelectedPermission(p);
    setEditForm({ key: p.key, resource: p.resource, action: p.action, description: p.description || '' });
    setEditModalOpen(true);
  };

  // Handle delete permission
  const handleDeleteClick = (p: Permission) => {
    setSelectedPermission(p);
    setDeleteModalOpen(true);
  };

  // Handle update permission
  const handleUpdate = async () => {
    if (!selectedPermission) return;

    try {
      const res = await fetch(`/api/dashboard/admin/permissions/${selectedPermission.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to update permission');
      }

      setEditModalOpen(false);
      fetchData();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update permission';
      console.error('Failed to update permission:', err);
      logClientError(message, 'permissions', 'update');
      setError(message);
    }
  };

  // Handle delete permission
  const handleDelete = async () => {
    if (!selectedPermission) return;

    try {
      const res = await fetch(`/api/dashboard/admin/permissions/${selectedPermission.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.error?.includes('assigned to roles')) {
          throw new Error(`Cannot delete permission "${selectedPermission.key}" because it is assigned to roles`);
        }
        throw new Error(data.error || 'Failed to delete permission');
      }

      setDeleteModalOpen(false);
      fetchData();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete permission';
      console.error('Failed to delete permission:', err);
      logClientError(message, 'permissions', 'delete');
      setError(message);
    }
  };

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
      const message = err instanceof Error ? err.message : 'Failed to create permission';
      console.error('Failed to create permission:', err);
      logClientError(message, 'permissions', 'create');
      setError(message);
    }
  };

  const columns = [
    { key: 'key', label: 'Permission Key', render: (p: Permission) => (
      <code className="text-sm font-mono" style={{ color: '#1B2A4A' }}>{p.key}</code>
    )},
    { key: 'resource', label: 'Resource' },
    { key: 'description', label: 'Description', render: (p: Permission) => p.description || '—' },
    { key: 'actions', label: 'Actions', render: (p: Permission) => (
      <div className="flex items-center gap-1">
        <button
          onClick={() => handleView(p)}
          title={`View ${p.key}`}
          className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-[#1B2A4A] transition-colors"
          aria-label={`View ${p.key}`}
        >
          <Eye className="h-4 w-4" />
        </button>
        <button
          onClick={() => handleEditClick(p)}
          title={`Edit ${p.key}`}
          className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-[#1B2A4A] transition-colors"
          aria-label={`Edit ${p.key}`}
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          onClick={() => handleDeleteClick(p)}
          title={`Delete ${p.key}`}
          className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-700 transition-colors"
          aria-label={`Delete ${p.key}`}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    )},
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
        <StatCard label="Total Resources" value={resources.length} color="success" />
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

      {/* Permission Detail Modal */}
      <Modal isOpen={detailModalOpen} onClose={() => setDetailModalOpen(false)} title="Permission Details" size="md">
        {selectedPermission && (
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium" style={{ color: '#6c757d' }}>Key</label>
              <p className="mt-1 font-mono text-sm" style={{ color: '#1B2A4A' }}>{selectedPermission.key}</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium" style={{ color: '#6c757d' }}>Resource</label>
                <p className="mt-1" style={{ color: '#1B2A4A' }}>{selectedPermission.resource}</p>
              </div>
              <div>
                <label className="text-sm font-medium" style={{ color: '#6c757d' }}>Action</label>
                <p className="mt-1" style={{ color: '#1B2A4A' }}>{selectedPermission.action}</p>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium" style={{ color: '#6c757d' }}>Description</label>
              <p className="mt-1" style={{ color: '#1B2A4A' }}>{selectedPermission.description || '—'}</p>
            </div>
          </div>
        )}
      </Modal>

      {/* Delete Confirm Dialog */}
      <ConfirmDialog
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        onConfirm={handleDelete}
        title="Delete Permission"
        message={`Are you sure you want to delete "${selectedPermission?.key}"? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
      />

      {/* Edit Permission Modal */}
      <Modal isOpen={editModalOpen} onClose={() => setEditModalOpen(false)} title="Edit Permission" size="md">
        {selectedPermission && (
          <div className="space-y-4">
            <div>
              <label htmlFor="edit-perm-key" className="mb-1 block text-sm font-medium" style={{ color: '#6c757d' }}>Key (resource:action)</label>
              <input
                id="edit-perm-key"
                type="text"
                value={editForm.key}
                onChange={(e) => setEditForm((f) => ({ ...f, key: e.target.value }))}
                className="w-full rounded border px-3 py-2 text-sm focus:outline-none font-mono"
                style={{ borderColor: '#dee2e6', color: '#1B2A4A' }}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="edit-perm-resource" className="mb-1 block text-sm font-medium" style={{ color: '#6c757d' }}>Resource</label>
                <input
                  id="edit-perm-resource"
                  type="text"
                  value={editForm.resource}
                  onChange={(e) => setEditForm((f) => ({ ...f, resource: e.target.value }))}
                  className="w-full rounded border px-3 py-2 text-sm focus:outline-none"
                  style={{ borderColor: '#dee2e6', color: '#1B2A4A' }}
                />
              </div>
              <div>
                <label htmlFor="edit-perm-action" className="mb-1 block text-sm font-medium" style={{ color: '#6c757d' }}>Action</label>
                <input
                  id="edit-perm-action"
                  type="text"
                  value={editForm.action}
                  onChange={(e) => setEditForm((f) => ({ ...f, action: e.target.value }))}
                  className="w-full rounded border px-3 py-2 text-sm focus:outline-none"
                  style={{ borderColor: '#dee2e6', color: '#1B2A4A' }}
                />
              </div>
            </div>
            <div>
              <label htmlFor="edit-perm-desc" className="mb-1 block text-sm font-medium" style={{ color: '#6c757d' }}>Description (optional)</label>
              <textarea
                id="edit-perm-desc"
                value={editForm.description}
                onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                className="w-full rounded border px-3 py-2 text-sm focus:outline-none"
                style={{ borderColor: '#dee2e6', color: '#1B2A4A' }}
                rows={3}
              />
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setEditModalOpen(false)}
                className="rounded border px-4 py-2 text-sm font-medium transition-colors hover:bg-gray-50"
                style={{ borderColor: '#dee2e6', color: '#1B2A4A' }}
              >
                Cancel
              </button>
              <button
                onClick={handleUpdate}
                disabled={!editForm.key.trim() || !editForm.resource.trim() || !editForm.action.trim()}
                className="rounded px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: '#F5A623' }}
              >
                Save Changes
              </button>
            </div>
          </div>
        )}
      </Modal>

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
