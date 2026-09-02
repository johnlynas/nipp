'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Eye, Pencil, Trash2 } from 'lucide-react';
import { useIsSuperAdmin } from '@/hooks/usePermission';
import { logClientError } from '@/lib/client-error-logger';
import { SearchBar } from '@/components/dashboard/SearchBar';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
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
  isDefault: boolean;
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
  const [typeFilter, setTypeFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal states
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedPermission, setSelectedPermission] = useState<Permission | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ resource: '', action: '', description: '', isDefault: false });

  // Check if current user is a platform super admin
  const isSuperAdmin = useIsSuperAdmin();

  const availableActions = ['create', 'read', 'update', 'delete'];

  // Edit modal states
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editForm, setEditForm] = useState({ resource: '', action: '', description: '', isDefault: false });

  // Resource names for filter dropdown (fetched from the resources catalog)
  const [resources, setResources] = useState<string[]>([]);
  const [resourcesLoading, setResourcesLoading] = useState(true);
  const [resourcesLoadError, setResourcesLoadError] = useState(false);

  // Reset to page 1 when filters change
  useEffect(() => {
    setPagination((p) => ({ ...p, page: 1 }));
  }, [search, resourceFilter, typeFilter]);

  // Reset edit form when modal opens/closes
  useEffect(() => {
    if (!editModalOpen) {
      setEditForm({ resource: '', action: '', description: '', isDefault: false });
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

  // Fetch resource names from the resources catalog for the filter and modal dropdowns
  useEffect(() => {
    let cancelled = false;
    async function fetchResourceNames() {
      try {
        const res = await fetch('/api/dashboard/admin/resources/names');
        if (!res.ok) throw new Error('Failed to fetch resource names');
        const data = await res.json();
        // De-duplicate defensively and keep the DB's ascending sort order
        const names = Array.from(new Set<string>(data.names || [])).sort((a, b) => a.localeCompare(b));
        if (!cancelled) {
          setResources(names);
          setResourcesLoadError(false);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to fetch resource names:', err);
          setResourcesLoadError(true);
        }
      } finally {
        if (!cancelled) setResourcesLoading(false);
      }
    }
    fetchResourceNames();
    return () => { cancelled = true; };
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
      if (typeFilter === 'default') params.set('isDefault', 'true');
      else if (typeFilter === 'custom') params.set('isDefault', 'false');

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
  }, [pagination.page, pagination.pageSize, search, resourceFilter, typeFilter]);

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
    setEditForm({ resource: p.resource, action: p.action, description: p.description || '', isDefault: p.isDefault });
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

  // Auto-generate key when resource or action changes
  useEffect(() => {
    if (createForm.resource && createForm.action) {
      setCreateForm((f) => ({ ...f, key: `${f.resource}:${f.action}` }));
    }
  }, [createForm.resource, createForm.action]);

  // Handle create permission
  const handleCreate = async () => {
    try {
      if (!createForm.resource || !createForm.action) return;

      const key = `${createForm.resource}:${createForm.action}`;
      const res = await fetch('/api/dashboard/admin/permissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, resource: createForm.resource, action: createForm.action, description: createForm.description, isDefault: createForm.isDefault }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to create permission');
      }

      setCreateModalOpen(false);
      setCreateForm({ resource: '', action: '', description: '', isDefault: false });
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
    { key: 'isDefault', label: 'Type', render: (p: Permission) => <StatusBadge status={p.isDefault ? 'Default' : 'Custom'} /> },
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
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded border px-3 py-2 text-sm bg-white hover:bg-gray-50 transition-colors focus:outline-none"
          style={{ borderColor: '#dee2e6', color: '#1B2A4A' }}
          aria-label="Filter by type"
        >
          <option value="">All Types</option>
          <option value="default">Default</option>
          <option value="custom">Custom</option>
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
              <label className="text-sm font-medium" style={{ color: '#6c757d' }}>Type</label>
              <div className="mt-1"><StatusBadge status={selectedPermission.isDefault ? 'Default' : 'Custom'} /></div>
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
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="edit-perm-resource" className="mb-1 block text-sm font-medium" style={{ color: '#6c757d' }}>Resource</label>
                <select
                  id="edit-perm-resource"
                  value={editForm.resource}
                  onChange={(e) => setEditForm((f) => ({ ...f, resource: e.target.value }))}
                  className="w-full rounded border px-3 py-2 text-sm focus:outline-none"
                  style={{ borderColor: '#dee2e6', color: '#1B2A4A' }}
                >
                  <option value="" disabled>Select resource</option>
                  {resourcesLoading && <option value="" disabled>Loading resources...</option>}
                  {!resourcesLoading && resourcesLoadError && <option value="" disabled>Failed to load resources — try again later</option>}
                  {/* Keep the current value selectable even if it predates the resource catalog */}
                  {editForm.resource && !resources.includes(editForm.resource) && (
                    <option key={editForm.resource} value={editForm.resource}>{editForm.resource}</option>
                  )}
                  {resources.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="edit-perm-action" className="mb-1 block text-sm font-medium" style={{ color: '#6c757d' }}>Action</label>
                <select
                  id="edit-perm-action"
                  value={editForm.action}
                  onChange={(e) => setEditForm((f) => ({ ...f, action: e.target.value }))}
                  className="w-full rounded border px-3 py-2 text-sm focus:outline-none"
                  style={{ borderColor: '#dee2e6', color: '#1B2A4A' }}
                >
                  <option value="" disabled>Select action</option>
                  {availableActions.map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
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
            <div className="flex items-center gap-2">
              <input
                id="edit-perm-isDefault"
                type="checkbox"
                checked={editForm.isDefault}
                onChange={(e) => setEditForm((f) => ({ ...f, isDefault: e.target.checked }))}
                className="h-4 w-4 rounded"
              />
              <label htmlFor="edit-perm-isDefault" className="text-sm font-medium" style={{ color: '#6c757d' }}>Default</label>
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
                disabled={!editForm.resource || !editForm.action}
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
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="perm-resource" className="mb-1 block text-sm font-medium" style={{ color: '#6c757d' }}>Resource</label>
              <select
                id="perm-resource"
                value={createForm.resource}
                onChange={(e) => setCreateForm((f) => ({ ...f, resource: e.target.value }))}
                className="w-full rounded border px-3 py-2 text-sm focus:outline-none"
                style={{ borderColor: '#dee2e6', color: '#1B2A4A' }}
              >
                <option value="" disabled>Select resource</option>
                {resources.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="perm-action" className="mb-1 block text-sm font-medium" style={{ color: '#6c757d' }}>Action</label>
              <select
                id="perm-action"
                value={createForm.action}
                onChange={(e) => setCreateForm((f) => ({ ...f, action: e.target.value }))}
                className="w-full rounded border px-3 py-2 text-sm focus:outline-none"
                style={{ borderColor: '#dee2e6', color: '#1B2A4A' }}
              >
                <option value="" disabled>Select action</option>
                {availableActions.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="perm-desc" className="mb-1 block text-sm font-medium" style={{ color: '#6c757d' }}>Description (optional)</label>
            <textarea
              id="perm-desc"
              value={createForm.description}
              onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))}
              className="w-full rounded border px-3 py-2 text-sm focus:outline-none"
              style={{ borderColor: '#dee2e6', color: '#1B2A4A' }}
              placeholder="Permission description"
              rows={3}
            />
          </div>
          {isSuperAdmin === true && (
            <div className="flex items-center gap-2">
              <input
                id="perm-isDefault"
                type="checkbox"
                checked={createForm.isDefault}
                onChange={(e) => setCreateForm((f) => ({ ...f, isDefault: e.target.checked }))}
                className="h-4 w-4 rounded"
              />
              <label htmlFor="perm-isDefault" className="text-sm font-medium" style={{ color: '#6c757d' }}>Default</label>
            </div>
          )}
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
              disabled={!createForm.resource || !createForm.action}
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
