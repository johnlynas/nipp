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

interface Team {
  id: string;
  name: string;
  slug: string | null;
  description: string | null;
  createdAt: string;
  organizationId: string;
  _count?: { members: number };
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

export default function TeamsPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [pagination, setPagination] = useState<PaginationState>({ page: 1, pageSize: 8, total: 0, totalPages: 0 });
  const [search, setSearch] = useState('');
  const [orgFilter, setOrgFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal states
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
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
  }, [search, orgFilter]);

  // Reset edit form when modal opens/closes
  useEffect(() => {
    if (!editModalOpen) {
      setEditForm({ name: '', description: '' });
    }
  }, [editModalOpen]);

  // Sync create modal org with page filter when modal opens
  useEffect(() => {
    if (createModalOpen && !createOrgId) {
      setCreateOrgId(orgFilter);
    }
  }, [createModalOpen]);

  // Reset create form when modal opens/closes
  useEffect(() => {
    if (!createModalOpen) {
      setCreateForm({ name: '', description: '' });
      setCreateOrgId('');
    }
  }, [createModalOpen]);

  // Abort controller to cancel stale fetch requests on rapid filter changes
  const abortControllerRef = useRef<AbortController | null>(null);

  // Fetch teams
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

      const res = await fetch(`/api/dashboard/admin/teams?${params}`, {
        signal: abortControllerRef.current.signal,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to fetch teams');
      }

      const data = await res.json();
      setTeams(data.teams || []);

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
      console.error('Failed to fetch teams:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch teams');
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.pageSize, search, orgFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Handle edit team
  const handleEdit = async () => {
    if (!selectedTeam) return;

    try {
      const res = await fetch(`/api/dashboard/admin/teams/${selectedTeam.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to update team');
      }

      setEditModalOpen(false);
      fetchData();
    } catch (err) {
      console.error('Failed to update team:', err);
      setError(err instanceof Error ? err.message : 'Failed to update team');
    }
  };

  // Handle delete team
  const handleDelete = async () => {
    if (!selectedTeam) return;

    try {
      const res = await fetch(`/api/dashboard/admin/teams/${selectedTeam.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete team');
      }
      setDeleteModalOpen(false);
      fetchData();
    } catch (err) {
      console.error('Failed to delete team:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete team');
    }
  };

  // Handle create team
  const handleCreate = async () => {
    if (!createOrgId) {
      setError('Please select an organization before creating a team');
      return;
    }

    try {
      const res = await fetch('/api/dashboard/admin/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...createForm, organizationId: createOrgId }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to create team');
      }

      setCreateModalOpen(false);
      setCreateForm({ name: '', description: '' });
      setCreateOrgId('');
      fetchData();
    } catch (err) {
      console.error('Failed to create team:', err);
      setError(err instanceof Error ? err.message : 'Failed to create team');
    }
  };

  const columns = [
    { key: 'name', label: 'Team Name', render: (t: Team) => (
      <div className="font-medium" style={{ color: '#1B2A4A' }}>{t.name}</div>
    )},
    { key: '_count', label: 'Members', render: (t: Team) => t._count?.members ?? 0 },
    { key: 'organization', label: 'Organization', render: (t: Team) => {
      const org = organizations.find((o) => o.id === t.organizationId);
      return <span style={{ color: '#1B2A4A' }}>{org?.name || '—'}</span>;
    }},
    { key: 'actions', label: 'Actions', render: (t: Team) => (
      <div className="flex items-center gap-1">
        <button onClick={() => { setSelectedTeam(t); setDetailModalOpen(true); }} className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-[#1B2A4A] transition-colors" aria-label={`View ${t.name}`}>
          <Eye className="h-4 w-4" />
        </button>
        <button onClick={() => { setSelectedTeam(t); setEditForm({ name: t.name, description: t.description || '' }); setEditModalOpen(true); }} className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-[#1B2A4A] transition-colors" aria-label={`Edit ${t.name}`}>
          <Pencil className="h-4 w-4" />
        </button>
        <button onClick={() => { setSelectedTeam(t); setDeleteModalOpen(true); }} className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-700 transition-colors" aria-label={`Delete ${t.name}`}>
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
        <StatCard label="Total Teams" value={pagination.total} />
        <StatCard label="Total Members" value={teams.reduce((sum, t) => sum + (t._count?.members ?? 0), 0)} color="success" />
        <StatCard label="Teams With Roles" value={teams.length} color="success" />
      </div>

      {/* Page Header */}
      <PageHeader title="Teams" description="Manage teams within organizations">
        <button
          onClick={() => setCreateModalOpen(true)}
          className="rounded px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90"
          style={{ backgroundColor: '#F5A623' }}
        >
          + Create Team
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
        <SearchBar value={search} onChange={setSearch} placeholder="Search teams by name..." aria-label="Search teams" />
      </div>

      {/* Table */}
      <DataTable<Team> columns={columns} data={teams} loading={loading} emptyMessage="No teams found" />

      {/* Pagination */}
      <PaginationControls
        currentPage={pagination.page}
        totalPages={pagination.totalPages}
        totalItems={pagination.total}
        pageSize={pagination.pageSize}
        onPageChange={(page) => setPagination((p) => ({ ...p, page }))}
      />

      {/* Team Detail Modal */}
      <Modal isOpen={detailModalOpen} onClose={() => setDetailModalOpen(false)} title="Team Details" size="md">
        {selectedTeam && (
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium" style={{ color: '#6c757d' }}>Name</label>
              <p className="mt-1" style={{ color: '#1B2A4A' }}>{selectedTeam.name}</p>
            </div>
            <div>
              <label className="text-sm font-medium" style={{ color: '#6c757d' }}>Slug</label>
              <p className="mt-1" style={{ color: '#1B2A4A' }}>{selectedTeam.slug || '—'}</p>
            </div>
            <div>
              <label className="text-sm font-medium" style={{ color: '#6c757d' }}>Description</label>
              <p className="mt-1" style={{ color: '#1B2A4A' }}>{selectedTeam.description || '—'}</p>
            </div>
            <div className="flex gap-4">
              <div>
                <label className="text-sm font-medium" style={{ color: '#6c757d' }}>Members</label>
                <p className="mt-1" style={{ color: '#1B2A4A' }}>{selectedTeam._count?.members ?? 0}</p>
              </div>
              <div>
                <label className="text-sm font-medium" style={{ color: '#6c757d' }}>Organization</label>
                <p className="mt-1" style={{ color: '#1B2A4A' }}>
                  {organizations.find((o) => o.id === selectedTeam.organizationId)?.name || '—'}
                </p>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Delete Confirm Dialog */}
      <ConfirmDialog
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        onConfirm={handleDelete}
        title="Delete Team"
        message={`Are you sure you want to delete "${selectedTeam?.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
      />

      {/* Edit Team Modal */}
      <Modal isOpen={editModalOpen} onClose={() => setEditModalOpen(false)} title="Edit Team" size="md">
        {selectedTeam && (
          <div className="space-y-4">
            <div>
              <label htmlFor="edit-team-name" className="mb-1 block text-sm font-medium" style={{ color: '#6c757d' }}>Name</label>
              <input
                id="edit-team-name"
                type="text"
                value={editForm.name}
                onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full rounded border px-3 py-2 text-sm focus:outline-none"
                style={{ borderColor: '#dee2e6' }}
              />
            </div>
            <div>
              <label htmlFor="edit-team-desc" className="mb-1 block text-sm font-medium" style={{ color: '#6c757d' }}>Description (optional)</label>
              <textarea
                id="edit-team-desc"
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

      {/* Create Team Modal */}
      <Modal isOpen={createModalOpen} onClose={() => setCreateModalOpen(false)} title="Create Team" size="md">
        <div className="space-y-4">
          <div>
            <label htmlFor="create-team-org" className="mb-1 block text-sm font-medium" style={{ color: '#6c757d' }}>Organization <span className="text-red-500">*</span></label>
            <select
              id="create-team-org"
              value={createOrgId}
              onChange={(e) => setCreateOrgId(e.target.value)}
              className="w-full rounded border px-3 py-2 text-sm bg-white focus:outline-none"
              style={{ borderColor: '#dee2e6', color: '#1B2A4A' }}
              required
            >
              <option value="">Select organization</option>
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>{org.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="team-name" className="mb-1 block text-sm font-medium" style={{ color: '#6c757d' }}>Name</label>
            <input
              id="team-name"
              type="text"
              value={createForm.name}
              onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full rounded border px-3 py-2 text-sm focus:outline-none"
              style={{ borderColor: '#dee2e6' }}
              placeholder="Team name"
            />
          </div>
          <div>
            <label htmlFor="team-desc" className="mb-1 block text-sm font-medium" style={{ color: '#6c757d' }}>Description (optional)</label>
            <textarea
              id="team-desc"
              value={createForm.description}
              onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))}
              className="w-full rounded border px-3 py-2 text-sm focus:outline-none"
              style={{ borderColor: '#dee2e6' }}
              placeholder="Team description"
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
              Create Team
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
