'use client';

import { useState, useEffect } from 'react';
import { Eye, Pencil, Trash2 } from 'lucide-react';
import { RequireSuperAdmin } from '@/components/auth/RequireSuperAdmin';
import Link from 'next/link';
import { encryptedFetch } from '@/lib/api-client';

interface User {
  id: string;
  name?: string | null;
  email: string;
  _count?: { members: number };
  createdAt: string | Date;
  members?: Array<{ organization: { id: string; name: string } }>;
}

interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface Organization {
  id: string;
  name: string;
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 8, total: 0, totalPages: 0 });
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [orgFilter, setOrgFilter] = useState('');
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);





  // Debounce search input
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 200);
    return () => clearTimeout(timer);
  }, [search]);

  // Fetch organizations for the dropdown
  useEffect(() => {
    async function fetchOrganizations() {
      try {
        const res = await encryptedFetch('/api/admin/organizations?page=1&pageSize=500', { pii: true });
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

  // Track filter changes to reset pagination
  const [fetchKey, setFetchKey] = useState(0);

  useEffect(() => {
    setPagination((p) => ({ ...p, page: 1 }));
    setFetchKey((k) => k + 1);
  }, [debouncedSearch, roleFilter, orgFilter]);

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
        if (roleFilter) params.set('role', roleFilter);
        if (orgFilter) params.set('organizationId', orgFilter);

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
            <Link
              href="/admin/users/create"
              className="rounded px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
              style={{ backgroundColor: '#F5A623' }}
            >
              + Add User
            </Link>
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
            <select
              value={orgFilter}
              onChange={(e) => setOrgFilter(e.target.value)}
              className="rounded border px-3 py-2 text-sm bg-white hover:bg-gray-100 text-gray-700 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Filter by organization"
            >
              <option value="">All Organizations</option>
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="rounded border px-3 py-2 text-sm bg-white hover:bg-gray-100 text-gray-700 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Filter by role"
            >
              <option value="">All Roles</option>
              <option value="admin">Admin</option>
              <option value="property-manager">Property Manager</option>
              <option value="member">Member</option>
              <option value="viewer">Viewer</option>
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
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-white" scope="col">Email</th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-white" scope="col">Organization</th>
                    <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-white" scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {users.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-6 py-8 text-center text-sm text-gray-500">
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
                        <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-700">
                          {user.members?.[0]?.organization?.name || '—'}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-right">
                          <div className="flex justify-end gap-2">
                            <Link href={`/admin/users/${user.id}/view`} className="text-blue-600 hover:text-blue-800 transition-colors" title="View" aria-label={`View ${user.name || user.email}`}>
                              <Eye className="w-4 h-4" />
                            </Link>
                            <Link href={`/admin/users/${user.id}/edit`} className="text-amber-600 hover:text-amber-800 transition-colors" title="Edit" aria-label={`Edit ${user.name || user.email}`}>
                              <Pencil className="w-4 h-4" />
                            </Link>
                            <Link href={`/admin/users/${user.id}/delete`} className="text-red-600 hover:text-red-800 transition-colors" title="Delete" aria-label={`Delete ${user.name || user.email}`}>
                              <Trash2 className="w-4 h-4" />
                            </Link>
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



        </main>
      </div>
    </RequireSuperAdmin>
  );
}
