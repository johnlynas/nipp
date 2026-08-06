'use client';

import { useState, useEffect } from 'react';
import { Eye, Pencil, Trash2 } from 'lucide-react';
import { RequireSuperAdmin } from '@/components/auth/RequireSuperAdmin';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { EditModal } from '@/components/admin/EditModal';
import { encryptedFetch } from '@/lib/api-client';

interface Role {
  id: string;
  name: string;
  description?: string | null;
  isDefault: boolean;
  _count?: { memberRoles: number };
}

interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export default function RolesPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 8, total: 0, totalPages: 0 });
  const [search, setSearch] = useState('');
  const [isDefaultFilter, setIsDefaultFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [viewingRole, setViewingRole] = useState<Role | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formIsDefault, setFormIsDefault] = useState(false);
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
  }, [debouncedSearch, isDefaultFilter]);

  // Fetch roles
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
        if (isDefaultFilter === 'true') params.set('isDefault', 'true');
        else if (isDefaultFilter === 'false') params.set('isDefault', 'false');

        const res = await encryptedFetch(`/api/admin/roles?${params}`, { pii: true });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to fetch roles');
        }

        const data = await res.json();
        setRoles(data.items || []);

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
        console.error('Failed to fetch roles:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch roles');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [fetchKey, pagination.page, pagination.pageSize]);

  // Open edit modal with pre-filled data
  function openEditModal(role: Role) {
    setEditingRole(role);
    setFormName(role.name);
    setFormDescription(role.description || '');
    setFormIsDefault(role.isDefault);
    setShowCreateModal(true);
  }

  // Open create modal with empty form
  function openCreateModal() {
    setEditingRole(null);
    setFormName('');
    setFormDescription('');
    setFormIsDefault(false);
    setShowCreateModal(true);
  }

  // Submit create or update
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const body = { name: formName, description: formDescription || undefined, isDefault: formIsDefault };

      let res;
      if (editingRole) {
        res = await encryptedFetch(`/api/admin/roles/${editingRole.id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
          pii: true,
        });
      } else {
        res = await encryptedFetch('/api/admin/roles', {
          method: 'POST',
          body: JSON.stringify(body),
          pii: true,
        });
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to save role');
      }

      setShowCreateModal(false);
      setFetchKey((k) => k + 1); // Re-fetch table
    } catch (err) {
      console.error('Failed to save role:', err);
      setError(err instanceof Error ? err.message : 'Failed to save role');
    } finally {
      setSubmitting(false);
    }
  }

  // Delete role
  async function handleDelete(id: string) {
    try {
      const res = await encryptedFetch(`/api/admin/roles/${id}`, { method: 'DELETE', pii: true });
      if (res.ok) {
        setFetchKey((k) => k + 1); // Re-fetch table
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Failed to delete role');
      }
    } catch (err) {
      console.error('Failed to delete role:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete role');
    } finally {
      setDeleteConfirm(null);
    }
  }

  return (
    <RequireSuperAdmin>
      <div className="min-h-screen">
        <main className="p-6">
          {/* Page Header */}
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold" style={{ color: '#1B2A4A' }}>Roles</h2>
              <p className="text-sm text-gray-500">Manage platform roles and permissions</p>
            </div>
            <button
              onClick={openCreateModal}
              className="rounded px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
              style={{ backgroundColor: '#F5A623' }}
            >
              + Add Role
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
              placeholder="Search roles..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="rounded border px-3 py-2 text-sm bg-white hover:bg-gray-100 text-gray-700 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Search roles"
            />
            <select
              value={isDefaultFilter}
              onChange={(e) => {
                setIsDefaultFilter(e.target.value);
                setSearch('');
              }}
              className="rounded border px-3 py-2 text-sm bg-white hover:bg-gray-100 text-gray-700 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Filter by default status"
            >
              <option value="">All</option>
              <option value="true">Default Only</option>
              <option value="false">Custom Only</option>
            </select>
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
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-white" scope="col">Description</th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-white" scope="col">Type</th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-white" scope="col">Members</th>
                    <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-white" scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {roles.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-8 text-center text-sm text-gray-500">
                        No roles found.
                      </td>
                    </tr>
                  ) : (
                    roles.map((role) => (
                      <tr key={role.id} className="hover:bg-gray-50">
                        <td className="whitespace-nowrap px-6 py-4 text-sm font-medium" style={{ color: '#1B2A4A' }}>
                          {role.name}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">{role.description || '—'}</td>
                        <td className="whitespace-nowrap px-6 py-4">
                          {role.isDefault ? (
                            <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">Default</span>
                          ) : (
                            <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">Custom</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                          {role._count?.memberRoles ?? 0}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-right">
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => setViewingRole(role)}
                              className="text-blue-600 hover:text-blue-800 transition-colors"
                              title="View"
                              aria-label={`View ${role.name}`}
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => openEditModal(role)}
                              className="text-amber-600 hover:text-amber-800 transition-colors"
                              title="Edit"
                              aria-label={`Edit ${role.name}`}
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => setDeleteConfirm(role.id)}
                              className="text-red-600 hover:text-red-800 transition-colors"
                              title="Delete"
                              aria-label={`Delete ${role.name}`}
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
            title={editingRole ? 'Edit Role' : 'New Role'}
          >
            <form onSubmit={handleSubmit}>
              <div className="space-y-3">
                <input type="text" placeholder="name" required value={formName} onChange={(e) => setFormName(e.target.value)} className="w-full rounded border px-3 py-2 text-sm" aria-label="Role name" />
                <input type="text" placeholder="description (optional)" value={formDescription} onChange={(e) => setFormDescription(e.target.value)} className="w-full rounded border px-3 py-2 text-sm" aria-label="Role description" />
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={formIsDefault} onChange={(e) => setFormIsDefault(e.target.checked)} className="rounded border-gray-300" />
                  Default role
                </label>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" onClick={() => setShowCreateModal(false)} className="rounded px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100">
                  Cancel
                </button>
                <button type="submit" disabled={submitting} className="rounded px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90" style={{ backgroundColor: '#F5A623' }}>
                  {submitting ? 'Saving...' : editingRole ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </EditModal>

          {/* View Modal */}
          {viewingRole && (
            <EditModal
              isOpen={!!viewingRole}
              onClose={() => setViewingRole(null)}
              title="Role Details"
            >
              <div className="space-y-2 text-sm">
                <div><span className="font-medium" style={{ color: '#1B2A4A' }}>Name:</span> <span className="ml-2">{viewingRole.name}</span></div>
                <div><span className="font-medium" style={{ color: '#1B2A4A' }}>Description:</span> <span className="ml-2">{viewingRole.description || '—'}</span></div>
                <div><span className="font-medium" style={{ color: '#1B2A4A' }}>Is Default:</span> <span className="ml-2">{viewingRole.isDefault ? 'Yes' : 'No'}</span></div>
                <div><span className="font-medium" style={{ color: '#1B2A4A' }}>Members:</span> <span className="ml-2">{viewingRole._count?.memberRoles ?? 0}</span></div>
              </div>
              <div className="mt-4 flex justify-end">
                <button onClick={() => setViewingRole(null)} className="rounded px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100">
                  Close
                </button>
              </div>
            </EditModal>
          )}

          {/* Delete Confirmation */}
          <ConfirmDialog
            isOpen={!!deleteConfirm}
            title="Delete Role"
            message="Are you sure you want to delete this role? This action cannot be undone."
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
