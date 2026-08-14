'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Eye, Pencil, Trash2, Layers } from 'lucide-react';
import { logClientError } from '@/lib/client-error-logger';
import { SearchBar } from '@/components/dashboard/SearchBar';
import { DataTable } from '@/components/dashboard/DataTable';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { StatCard } from '@/components/dashboard/StatCard';
import { Modal } from '@/components/dashboard/Modal';
import { ConfirmDialog } from '@/components/dashboard/ConfirmDialog';
import { PaginationControls } from '@/components/admin/PaginationControls';

interface ResourceRole {
  id: string;
  createdAt: Date;
  roleId: string;
  role: {
    id: string;
    name: string;
    description: string | null;
    organizationId: string;
  };
}

interface Resource {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  resourceRoles: ResourceRole[];
}

interface PaginationState {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export default function ResourcesPage() {
  const [resources, setResources] = useState<Resource[]>([]);
  const [pagination, setPagination] = useState<PaginationState>({ page: 1, pageSize: 8, total: 0, totalPages: 0 });
  const [totalResourcesCount, setTotalResourcesCount] = useState<number>(0);
  const [totalRoleAssignmentsCount, setTotalRoleAssignmentsCount] = useState<number>(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal states
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedResource, setSelectedResource] = useState<Resource | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', description: '' });

  // Edit modal states
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', description: '' });

  // Abort controller to cancel stale fetch requests on rapid filter changes
  const abortControllerRef = useRef<AbortController | null>(null);

  // Fetch total counts (unfiltered)
  async function fetchCounts() {
    try {
      const res = await fetch('/api/dashboard/admin/resources?pageSize=1');
      if (res.ok) {
        const data = await res.json();
        setTotalResourcesCount(data.pagination?.total ?? 0);

        // Calculate total role assignments from all resources
        const rolesRes = await fetch('/api/dashboard/admin/resources?pageSize=100');
        if (rolesRes.ok) {
          const rolesData = await rolesRes.json();
          const totalRoles = (rolesData.items as Resource[] || []).reduce(
            (sum, r) => sum + (r.resourceRoles?.length ?? 0),
            0,
          );
          setTotalRoleAssignmentsCount(totalRoles);
        }
      }
    } catch (err) {
      console.error('Failed to fetch total counts:', err);
    }
  }

  useEffect(() => {
    fetchCounts();
  }, []);

  // Fetch resources
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

      const res = await fetch(`/api/dashboard/admin/resources?${params}`, {
        signal: abortControllerRef.current.signal,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to fetch resources');
      }

      const data = await res.json();
      setResources(data.items || []);

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
      const message = err instanceof Error ? err.message : 'Failed to fetch resources';
      console.error('Failed to fetch resources:', err);
      logClientError(message, 'resources', 'fetch');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.pageSize, search]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Reset to page 1 when search changes
  useEffect(() => {
    setPagination((p) => ({ ...p, page: 1 }));
  }, [search]);

  // Auto-dismiss error banners after 6 seconds
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(timer);
  }, [error]);

  // Handle view resource
  const handleView = (r: Resource) => {
    setSelectedResource(r);
    setDetailModalOpen(true);
  };

  // Handle edit resource
  const handleEditClick = (r: Resource) => {
    setSelectedResource(r);
    setEditForm({ name: r.name, description: r.description || '' });
    setEditModalOpen(true);
  };

  // Handle delete resource
  const handleDeleteClick = (r: Resource) => {
    setSelectedResource(r);
    setDeleteModalOpen(true);
  };

  // Handle create resource
  const handleCreate = async () => {
    if (!createForm.name.trim()) {
      return; // Client-side validation — show error in form
    }

    try {
      const res = await fetch('/api/dashboard/admin/resources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: createForm.name, description: createForm.description || undefined }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to create resource');
      }

      setCreateModalOpen(false);
      setCreateForm({ name: '', description: '' });
      fetchData();
      fetchCounts();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create resource';
      console.error('Failed to create resource:', err);
      logClientError(message, 'resources', 'create');
      setError(message);
    }
  };

  // Handle update resource
  const handleUpdate = async () => {
    if (!editForm.name.trim() || !selectedResource) return;

    try {
      const res = await fetch(`/api/dashboard/admin/resources/${selectedResource.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editForm.name, description: editForm.description || undefined }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to update resource');
      }

      setEditModalOpen(false);
      fetchData();
      fetchCounts();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update resource';
      console.error('Failed to update resource:', err);
      logClientError(message, 'resources', 'update');
      setError(message);
    }
  };

  // Handle delete resource
  const handleDelete = async () => {
    if (!selectedResource) return;

    try {
      const res = await fetch(`/api/dashboard/admin/resources/${selectedResource.id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete resource');
      }

      setDeleteModalOpen(false);
      fetchData();
      fetchCounts();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete resource';
      console.error('Failed to delete resource:', err);
      logClientError(message, 'resources', 'delete');
      setError(message);
    }
  };

  // Table columns definition
  const columns = [
    { key: 'name', label: 'Name' },
    {
      key: 'description',
      label: 'Description',
      render: (r: Resource) => r.description || '—',
    },
    {
      key: 'roles',
      label: 'Roles Assigned',
      render: (r: Resource) => {
        if (!r.resourceRoles || r.resourceRoles.length === 0) return 'None';
        return r.resourceRoles.map((rr) => rr.role.name).join(', ');
      },
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (r: Resource) => (
        <div className="flex items-center gap-1">
          <button
            onClick={() => handleView(r)}
            className="rounded p-1.5 text-gray-500 hover:bg-[#f8f9fa] transition-colors"
            aria-label="View resource details"
          >
            <Eye className="h-4 w-4" />
          </button>
          <button
            onClick={() => handleEditClick(r)}
            className="rounded p-1.5 text-gray-500 hover:bg-[#f8f9fa] transition-colors"
            aria-label="Edit resource"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            onClick={() => handleDeleteClick(r)}
            className="rounded p-1.5 text-gray-500 hover:bg-[#f8f9fa] transition-colors"
            aria-label="Delete resource"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Resources" description="Feature modules and their role-based access control">
        <button
          onClick={() => setCreateModalOpen(true)}
          className="flex items-center gap-2 rounded px-4 py-2 text-sm font-medium text-white"
          style={{ backgroundColor: '#F5A623' }}
        >
          <Layers className="h-4 w-4" />
          Create Resource
        </button>
      </PageHeader>

      {/* Stat Cards */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard label="Total Resources" value={totalResourcesCount} />
        <StatCard label="Assigned Roles" value={totalRoleAssignmentsCount} />
      </div>

      {/* Error Banner */}
      {error && (
        <div className="mb-4 rounded border p-3 text-sm" style={{ borderColor: '#dee2e6', backgroundColor: '#fee2e2' }}>
          <div className="flex items-center justify-between">
            <span style={{ color: '#991b1b' }}>{error}</span>
            <button onClick={() => setError(null)} className="text-red-700 hover:text-red-900">
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Search */}
      <SearchBar value={search} onChange={setSearch} placeholder="Search resources..." />

      {/* Data Table */}
      <div className="mt-4">
        <DataTable<Resource>
          columns={columns}
          data={resources}
          loading={loading}
          emptyMessage="No results found"
        />

        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between">
            <span className="text-sm" style={{ color: '#6b7280' }}>
              Showing {pagination.total > 0 ? (pagination.page - 1) * pagination.pageSize + 1 : 0}–
              {Math.min(pagination.page * pagination.pageSize, pagination.total)} of {pagination.total} results
            </span>
            <PaginationControls
              currentPage={pagination.page}
              totalPages={pagination.totalPages}
              totalItems={pagination.total}
              pageSize={pagination.pageSize}
              onPageChange={(page) => setPagination((p) => ({ ...p, page }))}
            />
          </div>
        )}
      </div>

      {/* Create Modal */}
      <Modal isOpen={createModalOpen} onClose={() => setCreateModalOpen(false)} title="Create Resource">
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium" style={{ color: '#1B2A4A' }}>
              Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={createForm.name}
              onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full rounded border px-3 py-2 text-sm"
              style={{ borderColor: '#dee2e6' }}
              placeholder="e.g., Maintenance Requests"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" style={{ color: '#1B2A4A' }}>
              Description
            </label>
            <textarea
              value={createForm.description}
              onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))}
              className="w-full rounded border px-3 py-2 text-sm"
              style={{ borderColor: '#dee2e6' }}
              rows={3}
              placeholder="Manage maintenance requests..."
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={() => setCreateModalOpen(false)}
              className="rounded border px-4 py-2 text-sm font-medium"
              style={{ borderColor: '#dee2e6', color: '#1B2A4A' }}
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              className="rounded px-4 py-2 text-sm font-medium text-white"
              style={{ backgroundColor: '#F5A623' }}
            >
              Save
            </button>
          </div>
        </div>
      </Modal>

      {/* Edit Modal */}
      <Modal isOpen={editModalOpen} onClose={() => setEditModalOpen(false)} title="Edit Resource">
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium" style={{ color: '#1B2A4A' }}>
              Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={editForm.name}
              onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full rounded border px-3 py-2 text-sm"
              style={{ borderColor: '#dee2e6' }}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" style={{ color: '#1B2A4A' }}>
              Description
            </label>
            <textarea
              value={editForm.description}
              onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
              className="w-full rounded border px-3 py-2 text-sm"
              style={{ borderColor: '#dee2e6' }}
              rows={3}
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={() => setEditModalOpen(false)}
              className="rounded border px-4 py-2 text-sm font-medium"
              style={{ borderColor: '#dee2e6', color: '#1B2A4A' }}
            >
              Cancel
            </button>
            <button
              onClick={handleUpdate}
              className="rounded px-4 py-2 text-sm font-medium text-white"
              style={{ backgroundColor: '#F5A623' }}
            >
              Save
            </button>
          </div>
        </div>
      </Modal>

      {/* Detail Modal */}
      <Modal isOpen={detailModalOpen} onClose={() => setDetailModalOpen(false)} title="Resource Details">
        {selectedResource && (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-medium" style={{ color: '#6b7280' }}>Name</h3>
              <p className="mt-1 text-base font-semibold" style={{ color: '#1B2A4A' }}>{selectedResource.name}</p>
            </div>
            <div>
              <h3 className="text-sm font-medium" style={{ color: '#6b7280' }}>Description</h3>
              <p className="mt-1 text-sm" style={{ color: '#374151' }}>
                {selectedResource.description || 'No description'}
              </p>
            </div>
            <div>
              <h3 className="text-sm font-medium" style={{ color: '#6b7280' }}>Assigned Roles</h3>
              {selectedResource.resourceRoles && selectedResource.resourceRoles.length > 0 ? (
                <ul className="mt-1 space-y-1">
                  {selectedResource.resourceRoles.map((rr) => (
                    <li key={rr.id} className="text-sm" style={{ color: '#374151' }}>
                      {rr.role.name} <span style={{ color: '#6b7280' }}>(via {rr.role.organizationId})</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-sm italic" style={{ color: '#6b7280' }}>No roles assigned</p>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        onConfirm={handleDelete}
        title="Delete Resource"
        message={
          selectedResource && selectedResource.resourceRoles.length > 0
            ? `Are you sure you want to delete "${selectedResource.name}"? This resource has ${selectedResource.resourceRoles.length} role(s) assigned. Remove them first.`
            : 'Are you sure you want to delete this resource?'
        }
        confirmLabel="Delete"
      />
    </>
  );
}
