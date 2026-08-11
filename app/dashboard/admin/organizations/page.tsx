'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Eye, Pencil, Archive } from 'lucide-react';
import { SearchBar } from '@/components/dashboard/SearchBar';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { DataTable } from '@/components/dashboard/DataTable';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { StatCard } from '@/components/dashboard/StatCard';
import { Modal } from '@/components/dashboard/Modal';
import { ConfirmDialog } from '@/components/dashboard/ConfirmDialog';
import { PaginationControls } from '@/components/admin/PaginationControls';

interface Organization {
  id: string;
  name: string;
  slug: string | null;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
  memberCount: number;
  createdAt: string;
}

interface PaginationState {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export default function OrganizationsPage() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [pagination, setPagination] = useState<PaginationState>({ page: 1, pageSize: 10, total: 0, totalPages: 0 });
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal states
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null);
  const [archiveModalOpen, setArchiveModalOpen] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', slug: '' });

  // Edit modal states
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', slug: '' });

  // Reset to page 1 when filters change
  useEffect(() => {
    setPagination((p) => ({ ...p, page: 1 }));
  }, [search, statusFilter]);

  // Abort controller to cancel stale fetch requests on rapid filter changes
  const abortControllerRef = useRef<AbortController | null>(null);

  // Fetch organizations
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
      if (search) params.set('search', search);
      if (statusFilter) params.set('status', statusFilter);

      const res = await fetch(`/api/dashboard/admin/organizations?${params}`, {
        signal: abortControllerRef.current.signal,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to fetch organizations');
      }

      const data = await res.json();
      setOrganizations(data.organizations || []);

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
      console.error('Failed to fetch organizations:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch organizations');
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.pageSize, search, statusFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Handle archive
  const handleArchive = async () => {
    if (!selectedOrg) return;

    try {
      const res = await fetch(`/api/dashboard/admin/organizations/${selectedOrg.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ARCHIVED' }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to archive organization');
      }

      setArchiveModalOpen(false);
      fetchData();
    } catch (err) {
      console.error('Failed to archive org:', err);
      setError(err instanceof Error ? err.message : 'Failed to archive organization');
    }
  };

  // Handle create org
  const handleCreate = async () => {
    try {
      const res = await fetch('/api/dashboard/admin/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createForm),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to create organization');
      }

      setCreateModalOpen(false);
      setCreateForm({ name: '', slug: '' });
      fetchData();
    } catch (err) {
      console.error('Failed to create org:', err);
      setError(err instanceof Error ? err.message : 'Failed to create organization');
    }
  };

  // Handle edit org
  const handleEdit = async () => {
    if (!selectedOrg) return;

    try {
      const res = await fetch(`/api/dashboard/admin/organizations/${selectedOrg.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to update organization');
      }

      setEditModalOpen(false);
      fetchData();
    } catch (err) {
      console.error('Failed to update org:', err);
      setError(err instanceof Error ? err.message : 'Failed to update organization');
    }
  };

  const columns = [
    { key: 'name', label: 'Name', render: (o: Organization) => (
      <div className="font-medium" style={{ color: '#1B2A4A' }}>{o.name}</div>
    )},
    { key: 'status', label: 'Status', render: (o: Organization) => <StatusBadge status={o.status} /> },
    { key: 'memberCount', label: 'Members', render: (o: Organization) => o.memberCount },
    { key: 'createdAt', label: 'Created', render: (o: Organization) => new Date(o.createdAt).toLocaleDateString() },
    { key: 'actions', label: 'Actions', render: (o: Organization) => (
      <div className="flex items-center gap-1">
        <button onClick={() => { setSelectedOrg(o); setDetailModalOpen(true); }} className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-[#1B2A4A] transition-colors" aria-label={`View ${o.name}`}>
          <Eye className="h-4 w-4" />
        </button>
        {o.status !== 'ARCHIVED' && (
          <button onClick={() => { setSelectedOrg(o); setEditForm({ name: o.name, slug: o.slug || '' }); setEditModalOpen(true); }} className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-[#1B2A4A] transition-colors" aria-label={`Edit ${o.name}`}>
            <Pencil className="h-4 w-4" />
          </button>
        )}
        {o.status !== 'ARCHIVED' && (
          <button onClick={() => { setSelectedOrg(o); setArchiveModalOpen(true); }} className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-700 transition-colors" aria-label={`Archive ${o.name}`}>
            <Archive className="h-4 w-4" />
          </button>
        )}
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
        <StatCard label="Total Orgs" value={pagination.total} />
        <StatCard label="Active" value={organizations.filter((o) => o.status === 'ACTIVE').length} color="success" />
        <StatCard label="Suspended" value={organizations.filter((o) => o.status === 'SUSPENDED').length} color="warning" />
        <StatCard label="Archived" value={organizations.filter((o) => o.status === 'ARCHIVED').length} color="default" />
      </div>

      {/* Page Header */}
      <PageHeader title="Organizations" description="Manage tenant organizations">
        <button
          onClick={() => setCreateModalOpen(true)}
          className="rounded px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90"
          style={{ backgroundColor: '#F5A623' }}
        >
          + Create Organization
        </button>
      </PageHeader>

      {/* Filters */}
      <div className="mb-4 flex items-center gap-3">
        <SearchBar value={search} onChange={setSearch} placeholder="Search organizations by name" aria-label="Search organizations" />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded border px-3 py-2 text-sm bg-white hover:bg-gray-50 transition-colors focus:outline-none"
          style={{ borderColor: '#dee2e6' }}
          aria-label="Filter by status"
        >
          <option value="">All Statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="PENDING">Pending</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="ARCHIVED">Archived</option>
        </select>
      </div>

      {/* Table */}
      <DataTable<Organization> columns={columns} data={organizations} loading={loading} emptyMessage="No organizations found" />

      {/* Pagination */}
      <PaginationControls
        currentPage={pagination.page}
        totalPages={pagination.totalPages}
        totalItems={pagination.total}
        pageSize={pagination.pageSize}
        onPageChange={(page) => setPagination((p) => ({ ...p, page }))}
      />

      {/* Org Detail Modal */}
      <Modal isOpen={detailModalOpen} onClose={() => setDetailModalOpen(false)} title="Organization Details" size="md">
        {selectedOrg && (
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium" style={{ color: '#6c757d' }}>Name</label>
              <p className="mt-1" style={{ color: '#1B2A4A' }}>{selectedOrg.name}</p>
            </div>
            <div>
              <label className="text-sm font-medium" style={{ color: '#6c757d' }}>Slug</label>
              <p className="mt-1" style={{ color: '#1B2A4A' }}>{selectedOrg.slug || '—'}</p>
            </div>
            <div className="flex gap-4">
              <div>
                <label className="text-sm font-medium" style={{ color: '#6c757d' }}>Status</label>
                <div className="mt-1"><StatusBadge status={selectedOrg.status} /></div>
              </div>
              <div>
                <label className="text-sm font-medium" style={{ color: '#6c757d' }}>Members</label>
                <p className="mt-1" style={{ color: '#1B2A4A' }}>{selectedOrg.memberCount}</p>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium" style={{ color: '#6c757d' }}>Created</label>
              <p className="mt-1" style={{ color: '#1B2A4A' }}>{new Date(selectedOrg.createdAt).toLocaleDateString()}</p>
            </div>
          </div>
        )}
      </Modal>

      {/* Archive Confirm Dialog */}
      <ConfirmDialog
        isOpen={archiveModalOpen}
        onClose={() => setArchiveModalOpen(false)}
        onConfirm={handleArchive}
        title="Archive Organization"
        message={`Are you sure you want to archive "${selectedOrg?.name}"? This action will mark the organization as archived.`}
        confirmLabel="Archive"
        variant="danger"
      />

      {/* Create Org Modal */}
      <Modal isOpen={createModalOpen} onClose={() => setCreateModalOpen(false)} title="Create Organization" size="md">
        <div className="space-y-4">
          <div>
            <label htmlFor="org-name" className="mb-1 block text-sm font-medium" style={{ color: '#6c757d' }}>Name</label>
            <input
              id="org-name"
              type="text"
              value={createForm.name}
              onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full rounded border px-3 py-2 text-sm focus:outline-none"
              style={{ borderColor: '#dee2e6' }}
              placeholder="Organization name"
            />
          </div>
          <div>
            <label htmlFor="org-slug" className="mb-1 block text-sm font-medium" style={{ color: '#6c757d' }}>Slug (optional)</label>
            <input
              id="org-slug"
              type="text"
              value={createForm.slug}
              onChange={(e) => setCreateForm((f) => ({ ...f, slug: e.target.value }))}
              className="w-full rounded border px-3 py-2 text-sm focus:outline-none"
              style={{ borderColor: '#dee2e6' }}
              placeholder="auto-generated from name"
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
              Create Organization
            </button>
          </div>
        </div>
      </Modal>

      {/* Edit Organization Modal */}
      <Modal isOpen={editModalOpen} onClose={() => setEditModalOpen(false)} title="Edit Organization" size="md">
        {selectedOrg && (
          <div className="space-y-4">
            <div>
              <label htmlFor="edit-org-name" className="mb-1 block text-sm font-medium" style={{ color: '#6c757d' }}>Name</label>
              <input
                id="edit-org-name"
                type="text"
                value={editForm.name}
                onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full rounded border px-3 py-2 text-sm focus:outline-none"
                style={{ borderColor: '#dee2e6' }}
              />
            </div>
            <div>
              <label htmlFor="edit-org-slug" className="mb-1 block text-sm font-medium" style={{ color: '#6c757d' }}>Slug (optional)</label>
              <input
                id="edit-org-slug"
                type="text"
                value={editForm.slug}
                onChange={(e) => setEditForm((f) => ({ ...f, slug: e.target.value }))}
                className="w-full rounded border px-3 py-2 text-sm focus:outline-none"
                style={{ borderColor: '#dee2e6' }}
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
    </div>
  );
}
