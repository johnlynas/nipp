'use client';

import { useState, useEffect } from 'react';
import { Eye, Pencil, Trash2 } from 'lucide-react';
import { RequireSuperAdmin } from '@/components/auth/RequireSuperAdmin';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { EditModal } from '@/components/admin/EditModal';
import { encryptedFetch } from '@/lib/api-client';

interface User {
  id: string;
  name?: string | null;
  email: string;
  _count?: { members: number };
  createdAt: string | Date;
}

interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 8, total: 0, totalPages: 0 });
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [viewingUser, setViewingUser] = useState<User | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Debounce search input
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 200);
    return () => clearTimeout(timer);
  }, [search]);

  // Track filter changes to reset pagination
  const [fetchKey, setFetchKey] = useState(0);

  useEffect(() => {
    setPagination((p) => ({ ...p, page: 1 }));
    setFetchKey((k) => k + 1);
  }, [debouncedSearch]);

  // Fetch users
  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          page: String(pagination.page),
          pageSize: String(pagination.pageSize),
        });
        if (debouncedSearch) params.set('search', debouncedSearch);

        const res = await encryptedFetch(`/api/admin/users?${params}`, { pii: true });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to fetch users');
        }

        const data = await res.json();
        setUsers(data.items || []);

        const total = data.pagination?.total ?? 0;
        const pageSizeFromApi = data.pagination?.pageSize || pagination.pageSize || 8;
        const totalPages = Math.max(1, Math.ceil(total / pageSizeFromApi));

        setPagination({
          page: pagination.page,
          pageSize: pageSizeFromApi,
          total,
          totalPages,
        });
      } catch (err) {
        console.error('Failed to fetch users:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch users');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [fetchKey, pagination.page, pagination.pageSize]);

  // Open edit modal with pre-filled data
  function openEditModal(user: User) {
    setEditingUser(user);
    setFormName(user.name || '');
    setFormEmail(user.email);
    setShowCreateModal(true);
  }

  // Open create modal with empty form
  function openCreateModal() {
    setEditingUser(null);
    setFormName('');
    setFormEmail('');
    setShowCreateModal(true);
  }

  // Submit create or update
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const body = { name: formName, email: formEmail };

      let res;
      if (editingUser) {
        res = await encryptedFetch(`/api/admin/users/${editingUser.id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
          pii: true,
        });
      } else {
        res = await encryptedFetch('/api/admin/users', {
          method: 'POST',
          body: JSON.stringify(body),
          pii: true,
        });
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to save user');
      }

      setShowCreateModal(false);
      setFetchKey((k) => k + 1); // Re-fetch table
    } catch (err) {
      console.error('Failed to save user:', err);
      setError(err instanceof Error ? err.message : 'Failed to save user');
    } finally {
      setSubmitting(false);
    }
  }

  // Delete user
  async function handleDelete(id: string) {
    try {
      const res = await encryptedFetch(`/api/admin/users/${id}`, { method: 'DELETE', pii: true });
      if (res.ok) {
        setFetchKey((k) => k + 1); // Re-fetch table
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Failed to delete user');
      }
    } catch (err) {
      console.error('Failed to delete user:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete user');
    } finally {
      setDeleteConfirm(null);
    }
  }

  const formatDate = (date: string | Date) => {
    return new Date(date).toLocaleDateString('en-GB', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <RequireSuperAdmin>
      <div className="min-h-screen">
        <main className="p-6">
          {/* Page Header */}
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold" style={{ color: '#1B2A4A' }}>Users</h2>
              <p className="text-sm text-gray-500">Manage platform users</p>
            </div>
            <button
              onClick={openCreateModal}
              className="rounded px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
              style={{ backgroundColor: '#F5A623' }}
            >
              + Add User
            </button>
          </div>

          {/* Error Banner */}
          {error && (
            <div className="mb-4 rounded border bg-red-50 p-3 text-sm text-red-700" role="alert">
              {error}
            </div>
          )}

          {/* Filters */}
          <div className="mb-4 flex gap-3">
            <input
              type="text"
              placeholder="Search users..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="rounded border px-3 py-2 text-sm bg-white hover:bg-gray-100 text-gray-700 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Search users"
            />
          </div>

          {/* Table */}
          {loading ? (
            <p className="py-8 text-center">Loading...</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200" role="table">
                <thead className="bg-[#1B2A4A]">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-white" scope="col">Name</th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-white" scope="col">Email</th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-white" scope="col">Memberships</th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-white" scope="col">Created At</th>
                    <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-white" scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {users.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-8 text-center text-sm text-gray-500">
                        No users found.
                      </td>
                    </tr>
                  ) : (
                    users.map((user) => (
                      <tr key={user.id} className="hover:bg-gray-50">
                        <td className="whitespace-nowrap px-6 py-4 text-sm font-medium" style={{ color: '#1B2A4A' }}>
                          {user.name || '—'}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-sm">{user.email}</td>
                        <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                          {user._count?.members ?? 0}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                          {formatDate(user.createdAt)}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-right">
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => setViewingUser(user)}
                              className="text-blue-600 hover:text-blue-800 transition-colors"
                              title="View"
                              aria-label={`View ${user.name || user.email}`}
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => openEditModal(user)}
                              className="text-amber-600 hover:text-amber-800 transition-colors"
                              title="Edit"
                              aria-label={`Edit ${user.name || user.email}`}
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => setDeleteConfirm(user.id)}
                              className="text-red-600 hover:text-red-800 transition-colors"
                              title="Delete"
                              aria-label={`Delete ${user.name || user.email}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between">
              <p className="text-sm text-gray-500">
                Showing {((pagination.page - 1) * pagination.pageSize) + 1}–{Math.min(pagination.page * pagination.pageSize, pagination.total)} of {pagination.total}
              </p>
              <div className="flex gap-2">
                <button
                  disabled={pagination.page <= 1}
                  onClick={() => setPagination((p) => ({ ...p, page: p.page - 1 }))}
                  className="rounded border px-3 py-1 text-sm disabled:opacity-50 disabled:cursor-not-allowed bg-white hover:bg-gray-100 text-gray-700 font-medium transition-colors"
                  aria-label="Previous page"
                >
                  Previous
                </button>
                <button
                  disabled={pagination.page >= pagination.totalPages}
                  onClick={() => setPagination((p) => ({ ...p, page: p.page + 1 }))}
                  className="rounded border px-3 py-1 text-sm disabled:opacity-50 disabled:cursor-not-allowed bg-white hover:bg-gray-100 text-gray-700 font-medium transition-colors"
                  aria-label="Next page"
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {/* Create/Edit Modal */}
          <EditModal
            isOpen={showCreateModal}
            onClose={() => setShowCreateModal(false)}
            title={editingUser ? 'Edit User' : 'New User'}
          >
            <form onSubmit={handleSubmit}>
              <div className="space-y-3">
                <input type="text" placeholder="name" required value={formName} onChange={(e) => setFormName(e.target.value)} className="w-full rounded border px-3 py-2 text-sm" aria-label="User name" />
                <input type="email" placeholder="email" required value={formEmail} onChange={(e) => setFormEmail(e.target.value)} className="w-full rounded border px-3 py-2 text-sm" aria-label="User email" />
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" onClick={() => setShowCreateModal(false)} className="rounded px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100">
                  Cancel
                </button>
                <button type="submit" disabled={submitting} className="rounded px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90" style={{ backgroundColor: '#F5A623' }}>
                  {submitting ? 'Saving...' : editingUser ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </EditModal>

          {/* View Modal */}
          {viewingUser && (
            <EditModal
              isOpen={!!viewingUser}
              onClose={() => setViewingUser(null)}
              title="User Details"
            >
              <div className="space-y-2 text-sm">
                <div><span className="font-medium" style={{ color: '#1B2A4A' }}>Name:</span> <span className="ml-2">{viewingUser.name || '—'}</span></div>
                <div><span className="font-medium" style={{ color: '#1B2A4A' }}>Email:</span> <span className="ml-2">{viewingUser.email}</span></div>
                <div><span className="font-medium" style={{ color: '#1B2A4A' }}>Memberships:</span> <span className="ml-2">{viewingUser._count?.members ?? 0}</span></div>
                <div><span className="font-medium" style={{ color: '#1B2A4A' }}>Created At:</span> <span className="ml-2">{formatDate(viewingUser.createdAt)}</span></div>
              </div>
              <div className="mt-4 flex justify-end">
                <button onClick={() => setViewingUser(null)} className="rounded px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100">
                  Close
                </button>
              </div>
            </EditModal>
          )}

          {/* Delete Confirmation */}
          <ConfirmDialog
            isOpen={!!deleteConfirm}
            title="Delete User"
            message="Are you sure you want to delete this user? This action cannot be undone."
            confirmLabel="Delete"
            danger
            onConfirm={() => deleteConfirm && handleDelete(deleteConfirm)}
            onCancel={() => setDeleteConfirm(null)}
          />
        </main>
      </div>
    </RequireSuperAdmin>
  );
}
