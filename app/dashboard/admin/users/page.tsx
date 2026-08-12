'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Eye, Pencil, ShieldBan, ShieldCheck, Ban, Trash2 } from 'lucide-react';
import { SearchBar } from '@/components/dashboard/SearchBar';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { DataTable } from '@/components/dashboard/DataTable';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { StatCard } from '@/components/dashboard/StatCard';
import { Modal } from '@/components/dashboard/Modal';
import { ConfirmDialog } from '@/components/dashboard/ConfirmDialog';
import { PaginationControls } from '@/components/admin/PaginationControls';

interface User {
  id: string;
  name?: string | null;
  email: string;
  emailVerified: boolean;
  banned?: boolean | null;
  createdAt: string;
  _count?: { members: number };
  members?: Array<{ organization: { id: string; name: string } }>;
  teamMembers?: Array<{
    team: { id: string; name: string };
    organization: { id: string; name: string };
  }>;
}

interface Organization {
  id: string;
  name: string;
}

interface Team {
  id: string;
  name: string;
  organizationId: string;
}

interface PaginationState {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [pagination, setPagination] = useState<PaginationState>({ page: 1, pageSize: 8, total: 0, totalPages: 0 });
  const [search, setSearch] = useState('');
  const [orgFilter, setOrgFilter] = useState('');
  const [teamFilter, setTeamFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal states
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [banModalOpen, setBanModalOpen] = useState(false);
  const [banAction, setBanAction] = useState<'ban' | 'unban'>('ban');
  const [banReason, setBanReason] = useState('');
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);

  // Create modal states
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', email: '', password: '' });
  const [createOrgId, setCreateOrgId] = useState('');

  // Edit modal states
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', email: '' });

  // Abort controller to cancel stale fetch requests
  const abortControllerRef = useRef<AbortController | null>(null);

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

  // Fetch teams for filter dropdown (scoped to selected organization)
  useEffect(() => {
    async function fetchTeams() {
      try {
        const url = orgFilter
          ? `/api/dashboard/admin/teams?organizationId=${orgFilter}&page=1&pageSize=500`
          : '/api/dashboard/admin/teams?page=1&pageSize=500';
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          setTeams(data.teams || []);
        }
      } catch (err) {
        console.error('Failed to fetch teams:', err);
      }
    }
    fetchTeams();
  }, [orgFilter]);



  // Reset to page 1 when filters change
  useEffect(() => {
    setPagination((p) => ({ ...p, page: 1 }));
  }, [search]);

  // Clear team filter when org changes (teams are scoped to org)
  useEffect(() => {
    setTeamFilter('');
  }, [orgFilter]);

  // Reset create form when modal opens/closes
  useEffect(() => {
    if (!createModalOpen) {
      setCreateForm({ name: '', email: '', password: '' });
      setCreateOrgId('');
    }
  }, [createModalOpen]);

  // Fetch users
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
      if (orgFilter) params.set('organizationId', orgFilter);
      if (teamFilter) params.set('teamId', teamFilter);

      const res = await fetch(`/api/dashboard/admin/users?${params}`, {
        signal: abortControllerRef.current.signal,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to fetch users');
      }

      const data = await res.json();
      setUsers(data.items || []);

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
      console.error('Failed to fetch users:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch users');
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.pageSize, search, orgFilter, teamFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Handle ban/unban
  const handleBanToggle = async () => {
    if (!selectedUser) return;

    try {
      const res = await fetch(`/api/dashboard/admin/users/${selectedUser.id}/ban`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ banned: banAction === 'ban', banReason }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to update ban status');
      }

      setBanModalOpen(false);
      setBanReason('');
      fetchData();
    } catch (err) {
      console.error('Failed to toggle ban:', err);
      setError(err instanceof Error ? err.message : 'Failed to update ban status');
    }
  };

  // Handle delete user
  const handleDeleteUser = async () => {
    if (!selectedUser) return;

    try {
      const res = await fetch(`/api/dashboard/admin/users/${selectedUser.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete user');
      }
      setDeleteModalOpen(false);
      fetchData();
    } catch (err) {
      console.error('Failed to delete user:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete user');
    }
  };

  // Handle create user
  const handleCreateUser = async () => {
    if (!createForm.name.trim() || !createForm.email.trim()) {
      setError('Name and email are required');
      return;
    }

    if (!createOrgId) {
      setError('Organization is required');
      return;
    }

    try {
      const body: { name: string; email: string; password?: string; organizationId: string } = {
        name: createForm.name.trim(),
        email: createForm.email.trim(),
        organizationId: createOrgId,
      };

      if (createForm.password) {
        body.password = createForm.password;
      }

      const res = await fetch('/api/dashboard/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to create user');
      }

      setCreateModalOpen(false);
      fetchData();
    } catch (err) {
      console.error('Failed to create user:', err);
      setError(err instanceof Error ? err.message : 'Failed to create user');
    }
  };

  // Handle edit user
  const handleEditUser = async () => {
    if (!selectedUser) return;

    try {
      const res = await fetch(`/api/dashboard/admin/users/${selectedUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to update user');
      }

      setEditModalOpen(false);
      fetchData();
    } catch (err) {
      console.error('Failed to update user:', err);
      setError(err instanceof Error ? err.message : 'Failed to update user');
    }
  };

  const columns = [
    { key: 'name', label: 'User', render: (u: User) => (
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-medium" style={{ backgroundColor: '#1B2A4A', color: '#F5A623' }}>
          {(u.name || u.email).charAt(0).toUpperCase()}
        </div>
        <div>
          <div className="font-medium" style={{ color: '#1B2A4A' }}>{u.name || '—'}</div>
          <div className="text-xs text-gray-500">{u.email}</div>
        </div>
      </div>
    )},
    { key: 'organization', label: 'Organization', render: (u: User) => {
      const org = u.members?.[0]?.organization;
      return <span style={{ color: '#1B2A4A' }}>{org?.name || '—'}</span>;
    }},
    { key: 'team', label: 'Team', render: (u: User) => {
      if (!u.teamMembers || u.teamMembers.length === 0) return <span style={{ color: '#6c757d' }}>—</span>;
      return (
        <div className="flex flex-col gap-0.5">
          {u.teamMembers.map((tm) => (
            <span key={tm.team.id} style={{ color: '#1B2A4A' }}>{tm.team.name}</span>
          ))}
        </div>
      );
    }},
    { key: 'banned', label: 'Status', render: (u: User) => <StatusBadge status={u.banned ? 'Banned' : 'Active'} /> },
    { key: 'actions', label: 'Actions', render: (u: User) => (
      <div className="flex items-center gap-1">
        <button
          onClick={() => { setSelectedUser(u); setDetailModalOpen(true); }}
          title={`View ${u.name || u.email}`}
          className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-[#1B2A4A] transition-colors"
          aria-label={`View ${u.name || u.email}`}
        >
          <Eye className="h-4 w-4" />
        </button>
        <button
          onClick={() => { setSelectedUser(u); setEditForm({ name: u.name || '', email: u.email }); setEditModalOpen(true); }}
          title={`Edit ${u.name || u.email}`}
          className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-[#1B2A4A] transition-colors"
          aria-label={`Edit ${u.name || u.email}`}
        >
          <Pencil className="h-4 w-4" />
        </button>
        {u.banned ? (
          <button
            onClick={() => { setSelectedUser(u); setBanAction('unban'); setDetailModalOpen(false); setBanModalOpen(true); }}
            title={`Unban ${u.name || u.email}`}
            className="rounded p-1.5 text-gray-400 hover:bg-green-50 hover:text-green-700 transition-colors"
            aria-label={`Unban ${u.name || u.email}`}
          >
            <ShieldCheck className="h-4 w-4" />
          </button>
        ) : (
          <button
            onClick={() => { setSelectedUser(u); setBanAction('ban'); setDetailModalOpen(false); setBanModalOpen(true); }}
            title={`Ban ${u.name || u.email}`}
            className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-700 transition-colors"
            aria-label={`Ban ${u.name || u.email}`}
          >
            <ShieldBan className="h-4 w-4" />
          </button>
        )}
        <button
          onClick={() => { setSelectedUser(u); setDeleteModalOpen(true); }}
          title={`Delete ${u.name || u.email}`}
          className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-700 transition-colors"
          aria-label={`Delete ${u.name || u.email}`}
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
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Total Users" value={pagination.total} />
        <StatCard label="Email Verified" value={users.filter((u) => u.emailVerified).length} color="success" />
        <StatCard label="Banned" value={users.filter((u) => u.banned).length} color="danger" />
        <StatCard label="Active Now" value={users.filter((u) => !u.banned).length} color="success" />
      </div>

      {/* Page Header */}
      <PageHeader title="Users" description="Manage platform users">
        <button
          onClick={() => setCreateModalOpen(true)}
          className="rounded px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90"
          style={{ backgroundColor: '#F5A623' }}
        >
          + Create User
        </button>
      </PageHeader>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchBar value={search} onChange={setSearch} placeholder="Search users by name or email..." aria-label="Search users" />
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
        <select
          value={teamFilter}
          onChange={(e) => setTeamFilter(e.target.value)}
          className="rounded border px-3 py-2 text-sm bg-white hover:bg-gray-50 transition-colors focus:outline-none"
          style={{ borderColor: '#dee2e6', color: '#1B2A4A' }}
          aria-label="Filter by team"
        >
          <option value="">All Teams</option>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>{team.name}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <DataTable<User> columns={columns} data={users} loading={loading} emptyMessage="No users found" />

      {/* Pagination */}
      <PaginationControls
        currentPage={pagination.page}
        totalPages={pagination.totalPages}
        totalItems={pagination.total}
        pageSize={pagination.pageSize}
        onPageChange={(page) => setPagination((p) => ({ ...p, page }))}
      />

      {/* User Detail Modal */}
      <Modal isOpen={detailModalOpen} onClose={() => setDetailModalOpen(false)} title="User Details" size="md">
        {selectedUser && (
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium" style={{ color: '#6c757d' }}>Name</label>
              <p className="mt-1" style={{ color: '#1B2A4A' }}>{selectedUser.name || '—'}</p>
            </div>
            <div>
              <label className="text-sm font-medium" style={{ color: '#6c757d' }}>Email</label>
              <p className="mt-1" style={{ color: '#1B2A4A' }}>{selectedUser.email}</p>
            </div>
            <div className="flex gap-4">
              <div>
                <label className="text-sm font-medium" style={{ color: '#6c757d' }}>Email Verified</label>
                <div className="mt-1"><StatusBadge status={selectedUser.emailVerified ? 'Verified' : 'Unverified'} /></div>
              </div>
              <div>
                <label className="text-sm font-medium" style={{ color: '#6c757d' }}>Ban Status</label>
                <div className="mt-1"><StatusBadge status={selectedUser.banned ? 'Banned' : 'Active'} /></div>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium" style={{ color: '#6c757d' }}>Joined</label>
              <p className="mt-1" style={{ color: '#1B2A4A' }}>{new Date(selectedUser.createdAt).toLocaleDateString()}</p>
            </div>
          </div>
        )}
      </Modal>

      {/* Ban/Unban Confirm Dialog */}
      <ConfirmDialog
        isOpen={banModalOpen}
        onClose={() => { setBanModalOpen(false); setBanReason(''); }}
        onConfirm={handleBanToggle}
        title={banAction === 'ban' ? 'Ban User' : 'Unban User'}
        message={banAction === 'ban' ? `Are you sure you want to ban ${selectedUser?.name || selectedUser?.email}?` : `Are you sure you want to unban ${selectedUser?.name || selectedUser?.email}?`}
        confirmLabel={banAction === 'ban' ? 'Ban User' : 'Unban User'}
        variant={banAction === 'ban' ? 'danger' : 'default'}
      />

      {/* Delete Confirm Dialog */}
      <ConfirmDialog
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        onConfirm={handleDeleteUser}
        title="Delete User"
        message={`Are you sure you want to delete ${selectedUser?.name || selectedUser?.email}? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
      />

      {/* Create User Modal */}
      <Modal isOpen={createModalOpen} onClose={() => setCreateModalOpen(false)} title="Create User" size="md">
        <div className="space-y-4">
          <div>
            <label htmlFor="create-name" className="mb-1 block text-sm font-medium" style={{ color: '#6c757d' }}>Name</label>
            <input
              id="create-name"
              type="text"
              value={createForm.name}
              onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full rounded border px-3 py-2 text-sm focus:outline-none"
              style={{ borderColor: '#dee2e6' }}
              placeholder="User name"
            />
          </div>
          <div>
            <label htmlFor="create-email" className="mb-1 block text-sm font-medium" style={{ color: '#6c757d' }}>Email</label>
            <input
              id="create-email"
              type="email"
              value={createForm.email}
              onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
              className="w-full rounded border px-3 py-2 text-sm focus:outline-none"
              style={{ borderColor: '#dee2e6' }}
              placeholder="user@example.com"
            />
          </div>
          <div>
            <label htmlFor="create-password" className="mb-1 block text-sm font-medium" style={{ color: '#6c757d' }}>Password (optional)</label>
            <input
              id="create-password"
              type="password"
              value={createForm.password}
              onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))}
              className="w-full rounded border px-3 py-2 text-sm focus:outline-none"
              style={{ borderColor: '#dee2e6' }}
              placeholder="Leave blank to send invite email"
            />
          </div>
          <div>
            <label htmlFor="create-org" className="mb-1 block text-sm font-medium" style={{ color: '#6c757d' }}>Organization <span className="text-red-500">*</span></label>
            <select
              id="create-org"
              value={createOrgId}
              onChange={(e) => { setCreateOrgId(e.target.value); }}
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

          <div className="flex justify-end gap-3">
            <button
              onClick={() => setCreateModalOpen(false)}
              className="rounded border px-4 py-2 text-sm font-medium transition-colors hover:bg-gray-50"
              style={{ borderColor: '#dee2e6', color: '#1B2A4A' }}
            >
              Cancel
            </button>
            <button
              onClick={handleCreateUser}
              disabled={!createForm.name.trim() || !createForm.email.trim()}
              className="rounded px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: '#F5A623' }}
            >
              Create User
            </button>
          </div>
        </div>
      </Modal>

      {/* Edit User Modal */}
      <Modal isOpen={editModalOpen} onClose={() => setEditModalOpen(false)} title="Edit User" size="md">
        {selectedUser && (
          <div className="space-y-4">
            <div>
              <label htmlFor="edit-name" className="mb-1 block text-sm font-medium" style={{ color: '#6c757d' }}>Name</label>
              <input
                id="edit-name"
                type="text"
                value={editForm.name}
                onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full rounded border px-3 py-2 text-sm focus:outline-none"
                style={{ borderColor: '#dee2e6' }}
              />
            </div>
            <div>
              <label htmlFor="edit-email" className="mb-1 block text-sm font-medium" style={{ color: '#6c757d' }}>Email</label>
              <input
                id="edit-email"
                type="email"
                value={editForm.email}
                onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
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
                onClick={handleEditUser}
                disabled={!editForm.name.trim() || !editForm.email.trim()}
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
