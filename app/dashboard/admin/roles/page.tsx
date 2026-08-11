'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Eye, Pencil, Trash2 } from 'lucide-react';
import { SearchBar } from '@/components/dashboard/SearchBar';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { DataTable } from '@/components/dashboard/DataTable';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { StatCard } from '@/components/dashboard/StatCard';
import { Modal } from '@/components/dashboard/Modal';
import { ConfirmDialog } from '@/components/dashboard/ConfirmDialog';
import { PaginationControls } from '@/components/admin/PaginationControls';

interface Role {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  createdAt: string;
  organizationId: string;
  _count?: { memberRoles: number };
}

interface Organization {
  id: string;
  name: string;
}

interface PaginationState {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export default function RolesPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [pagination, setPagination] = useState<PaginationState>({ page: 1, pageSize: 8, total: 0, totalPages: 0 });
  const [search, setSearch] = useState('');
  const [orgFilter, setOrgFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal states
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', description: '' });
  const [createOrgId, setCreateOrgId] = useState('');

  // Edit modal states
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', description: '' });

  // Fetch organizations for dropdown
  useEffect(() => {
    async function fetchOrganizations() {
      try {
        const res = await fetch('/api/dashboard/admin/organizations?page=1&pageSize=500');
        if (res.ok) {
          const data = await res.json();
          setOrganizations(data.organizations || []);
        }
      } catch (err) {
        console.error('Failed to fetch organizations:', err);
      }
    }
    fetchOrganizations();
  }, []);

  // Reset to page 1 when filters change
  useEffect(() => {
    setPagination((p) => ({ ...p, page: 1 }));
  }, [search, orgFilter, typeFilter]);

  // Reset edit form when modal opens/closes
  useEffect(() => {
    if (!editModalOpen) {
      setEditForm({ name: '', description: '' });
    }
  }, [editModalOpen]);

  // Abort controller to cancel stale fetch requests on rapid filter changes
  const abortControllerRef = useRef<AbortController | null>(null);

  // Fetch roles
  const fetchData = useCallback(async () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(pagination.page),
        pageSize: String(pagination.pageSize),
      });
      if (orgFilter) params.set('organizationId', orgFilter);
      if (search) params.set('search', search);
      if (typeFilter === 'default') params.set('isDefault', 'true');
      else if (typeFilter === 'custom') params.set('isDefault', 'false');

      const res = await fetch(`/api/dashboard/admin/roles?${params}`, {
        signal: abortControllerRef.current.signal,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to fetch roles');
      }

      const data = await res.json();
      setRoles(data.items || []);

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
      console.error('Failed to fetch roles:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch roles');
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.pageSize, search, orgFilter, typeFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Handle delete role
  const handleDelete = async () => {
    if (!selectedRole) return;

    try {
      const res = await fetch(`/api/dashboard/admin/roles/${selectedRole.id}?organizationId=${selectedRole.organizationId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete role');
      }
      setDeleteModalOpen(false);
      fetchData();
    } catch (err) {
      console.error('Failed to delete role:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete role');
    }
  };

  // Handle edit role
  const handleEdit = async () => {
    if (!selectedRole) return;

    try {
      const res = await fetch(`/api/dashboard/admin/roles/${selectedRole.id}?organizationId=${selectedRole.organizationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to update role');
      }

      setEditModalOpen(false);
      fetchData();
    } catch (err) {
      console.error('Failed to update role:', err);
      setError(err instanceof Error ? err.message : 'Failed to update role');
    }
  };

  // Handle create role
  const handleCreate = async () => {
    if (!createOrgId) {
      setError('Please select an organization before creating a role');
      return;
    }

    try {
      const res = await fetch('/api/dashboard/admin/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...createForm, organizationId: createOrgId }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to create role');
      }

      setCreateModalOpen(false);
      setCreateForm({ name: '', description: '' });
      setCreateOrgId('');
      fetchData();
    } catch (err) {
      console.error('Failed to create role:', err);
      setError(err instanceof Error ? err.message : 'Failed to create role');
    }
  };

  const columns = [
    { key: 'name', label: 'Role Name', render: (r: Role) => (
      <div>
        <div className="font-medium" style={{ color: '#1B2A4A' }}>{r.name}</div>
        <div className="text-xs text-gray-500">{r.description || '—'}</div>
      </div>
    )},
    { key: 'isDefault', label: 'Type', render: (r: Role) => <StatusBadge status={r.isDefault ? 'Default' : 'Custom'} /> },
    { key: '_count', label: 'Members', render: (r: Role) => r._count?.memberRoles ?? 0 },
    { key: 'createdAt', label: 'Created', render: (r: Role) => new Date(r.createdAt).toLocaleDateString() },
    { key: 'actions', label: 'Actions', render: (r: Role) => (
      <div className="flex items-center gap-1">
        <button onClick={() => { setSelectedRole(r); setDetailModalOpen(true); }} className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-[#1B2A4A] transition-colors" aria-label={`View ${r.name}`}>
          <Eye className="h-4 w-4" />
        </button>
        <button onClick={() => { setSelectedRole(r); setEditForm({ name: r.name, description: r.description || '' }); setEditModalOpen(true); }} className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-[#1B2A4A] transition-colors" aria-label={`Edit ${r.name}`}>
          <Pencil className="h-4 w-4" />
        </button>
        <button onClick={() => { setSelectedRole(r); setDeleteModalOpen(true); }} className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-700 transition-colors" aria-label={`Delete ${r.name}`}>
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
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Total Roles" value={pagination.total} />
        <StatCard label="Default Roles" value={roles.filter((r) => r.isDefault).length} color="success" />
        <StatCard label="Custom Roles" value={roles.filter((r) => !r.isDefault).length} />
        <StatCard label="Roles With Members" value={roles.filter((r) => (r._count?.memberRoles ?? 0) > 0).length} color="success" />
      </div>

      {/* Page Header */}
      <PageHeader title="Roles" description="Manage roles within organizations">
        <button
          onClick={() => setCreateModalOpen(true)}
          className="rounded px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90"
          style={{ backgroundColor: '#F5A623' }}
        >
          + Create Role
        </button>
      </PageHeader>

      {/* Filters */}
      <div className="mb-4 flex items-center gap-3">
        <select
          value={orgFilter}
          onChange={(e) => setOrgFilter(e.target.value)}
          className="rounded border px-3 py-2 text-sm bg-white hover:bg-gray-50 transition-colors focus:outline-none"
          style={{ borderColor: '#dee2e6', color: '#1B2A4A' }}
          aria-label="Filter by organization"
        >
          <option value="">All Organizations</option>
          {organizations.map((org) => (
            <option key={org.id} value={org.id}>{org.name}</option>
          ))}
        </select>
        <SearchBar value={search} onChange={setSearch} placeholder="Search roles by name..." aria-label="Search roles" />
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
      <DataTable<Role> columns={columns} data={roles} loading={loading} emptyMessage="No roles found" />

      {/* Pagination */}
      <PaginationControls
        currentPage={pagination.page}
        totalPages={pagination.totalPages}
        totalItems={pagination.total}
        pageSize={pagination.pageSize}
        onPageChange={(page) => setPagination((p) => ({ ...p, page }))}
      />

      {/* Role Detail Modal */}
      <Modal isOpen={detailModalOpen} onClose={() => setDetailModalOpen(false)} title="Role Details" size="md">
        {selectedRole && (
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium" style={{ color: '#6c757d' }}>Name</label>
              <p className="mt-1" style={{ color: '#1B2A4A' }}>{selectedRole.name}</p>
            </div>
            <div>
              <label className="text-sm font-medium" style={{ color: '#6c757d' }}>Description</label>
              <p className="mt-1" style={{ color: '#1B2A4A' }}>{selectedRole.description || '—'}</p>
            </div>
            <div className="flex gap-4">
              <div>
                <label className="text-sm font-medium" style={{ color: '#6c757d' }}>Type</label>
                <div className="mt-1"><StatusBadge status={selectedRole.isDefault ? 'Default' : 'Custom'} /></div>
              </div>
              <div>
                <label className="text-sm font-medium" style={{ color: '#6c757d' }}>Members</label>
                <p className="mt-1" style={{ color: '#1B2A4A' }}>{selectedRole._count?.memberRoles ?? 0}</p>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium" style={{ color: '#6c757d' }}>Created</label>
              <p className="mt-1" style={{ color: '#1B2A4A' }}>{new Date(selectedRole.createdAt).toLocaleDateString()}</p>
            </div>
          </div>
        )}
      </Modal>

      {/* Delete Confirm Dialog */}
      <ConfirmDialog
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        onConfirm={handleDelete}
        title="Delete Role"
        message={`Are you sure you want to delete "${selectedRole?.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
      />

      {/* Edit Role Modal */}
      <Modal isOpen={editModalOpen} onClose={() => setEditModalOpen(false)} title="Edit Role" size="md">
        {selectedRole && (
          <div className="space-y-4">
            <div>
              <label htmlFor="edit-role-name" className="mb-1 block text-sm font-medium" style={{ color: '#6c757d' }}>Name</label>
              <input
                id="edit-role-name"
                type="text"
                value={editForm.name}
                onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full rounded border px-3 py-2 text-sm focus:outline-none"
                style={{ borderColor: '#dee2e6' }}
              />
            </div>
            <div>
              <label htmlFor="edit-role-desc" className="mb-1 block text-sm font-medium" style={{ color: '#6c757d' }}>Description (optional)</label>
              <textarea
                id="edit-role-desc"
                value={editForm.description}
                onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                className="w-full rounded border px-3 py-2 text-sm focus:outline-none"
                style={{ borderColor: '#dee2e6' }}
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
                onClick={handleEdit}
                disabled={!editForm.name.trim()}
                className="rounded px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: '#F5A623' }}
              >
                Save Changes
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Create Role Modal */}
      <Modal isOpen={createModalOpen} onClose={() => { setCreateModalOpen(false); setCreateOrgId(''); }} title="Create Role" size="md">
        <div className="space-y-4">
          <div>
            <label htmlFor="create-org" className="mb-1 block text-sm font-medium" style={{ color: '#6c757d' }}>Organization</label>
            <select
              id="create-org"
              value={createOrgId}
              onChange={(e) => setCreateOrgId(e.target.value)}
              className="w-full rounded border px-3 py-2 text-sm bg-white hover:bg-gray-50 transition-colors focus:outline-none"
              style={{ borderColor: '#dee2e6', color: '#1B2A4A' }}
              aria-label="Select organization for new role"
            >
              <option value="">Select Organization</option>
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>{org.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="role-name" className="mb-1 block text-sm font-medium" style={{ color: '#6c757d' }}>Name</label>
            <input
              id="role-name"
              type="text"
              value={createForm.name}
              onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full rounded border px-3 py-2 text-sm focus:outline-none"
              style={{ borderColor: '#dee2e6' }}
              placeholder="Role name"
            />
          </div>
          <div>
            <label htmlFor="role-desc" className="mb-1 block text-sm font-medium" style={{ color: '#6c757d' }}>Description (optional)</label>
            <textarea
              id="role-desc"
              value={createForm.description}
              onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))}
              className="w-full rounded border px-3 py-2 text-sm focus:outline-none"
              style={{ borderColor: '#dee2e6' }}
              placeholder="Role description"
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
              disabled={!createForm.name.trim()}
              className="rounded px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: '#F5A623' }}
            >
              Create Role
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
