'use client';

import { useState, useEffect } from 'react';
import { Eye, Pencil, Trash2 } from 'lucide-react';
import { RequireSuperAdmin } from '@/components/auth/RequireSuperAdmin';
import { Pagination } from '@/components/admin/Pagination';
import Link from 'next/link';
import { encryptedFetch } from '@/lib/api-client';

interface Permission {
  id: string;
  key: string;
  resource: string;
  action: string;
  description?: string | null;
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
  const [search, setSearch] = useState('');
  const [resourceFilter, setResourceFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);





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
  }, [debouncedSearch, resourceFilter]);

  // Fetch permissions
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
        if (resourceFilter) params.set('resource', resourceFilter);

        const res = await encryptedFetch(`/api/admin/permissions?${params}`, { pii: true });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to fetch permissions');
        }

        const data = await res.json();
        setPermissions(data.items || []);

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
        console.error('Failed to fetch permissions:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch permissions');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [fetchKey, pagination.page, pagination.pageSize]);





  

  // Unique resource types fetched from API (independent of filter)
  const [resourceTypes, setResourceTypes] = useState<string[]>([]);

  useEffect(() => {
    async function fetchResources() {
      try {
        const res = await encryptedFetch('/api/admin/permissions/resources', { pii: true });
        if (res.ok) {
          const data = await res.json();
          setResourceTypes(data.resources || []);
        }
      } catch (err) {
        console.error('Failed to fetch resource types:', err);
      }
    }
    fetchResources();
  }, []);

  return (
    <RequireSuperAdmin>
      <div className="min-h-screen">
        <main className="p-6">
          {/* Page Header */}
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold" style={{ color: '#1B2A4A' }}>Permissions</h2>
              <p className="text-sm text-gray-500">Global permission catalog management</p>
            </div>
            <Link
              href="/admin/permissions/create"
              className="rounded px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
              style={{ backgroundColor: '#F5A623' }}
            >
              + Add Permission
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
              placeholder="Search permissions..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="rounded border px-3 py-2 text-sm bg-white hover:bg-gray-100 text-gray-700 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Search permissions"
            />
            <select
              value={resourceFilter}
              onChange={(e) => {
                setResourceFilter(e.target.value);
                setSearch('');
              }}
              className="rounded border px-3 py-2 text-sm bg-white hover:bg-gray-100 text-gray-700 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Filter by resource type"
            >
              <option value="">All</option>
              {resourceTypes.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
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
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-white" scope="col">Key</th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-white" scope="col">Resource</th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-white" scope="col">Action</th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-white" scope="col">Description</th>
                    <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-white" scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {permissions.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-8 text-center text-sm text-gray-500">
                        No permissions found.
                      </td>
                    </tr>
                  ) : (
                    permissions.map((perm) => (
                      <tr key={perm.id} className="hover:bg-gray-50">
                        <td className="whitespace-nowrap px-6 py-4 text-sm font-mono" style={{ color: '#1B2A4A' }}>
                          {perm.key}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-sm">{perm.resource}</td>
                        <td className="whitespace-nowrap px-6 py-4 text-sm">{perm.action}</td>
                        <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">{perm.description || '—'}</td>
                        <td className="whitespace-nowrap px-6 py-4 text-right">
                          <div className="flex justify-end gap-2">
                            <Link href={`/admin/permissions/${perm.id}/view`} className="text-blue-600 hover:text-blue-800 transition-colors" title="View" aria-label={`View ${perm.key}`}>
                              <Eye className="w-4 h-4" />
                            </Link>
                            <Link href={`/admin/permissions/${perm.id}/edit`} className="text-amber-600 hover:text-amber-800 transition-colors" title="Edit" aria-label={`Edit ${perm.key}`}>
                              <Pencil className="w-4 h-4" />
                            </Link>
                            <Link href={`/admin/permissions/${perm.id}/delete`} className="text-red-600 hover:text-red-800 transition-colors" title="Delete" aria-label={`Delete ${perm.key}`}>
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
          <Pagination
            currentPage={pagination.page}
            totalPages={pagination.totalPages}
            totalItems={pagination.total}
            pageSize={pagination.pageSize}
            onPageChange={(page) => setPagination((p) => ({ ...p, page }))}
          />



        </main>
      </div>
    </RequireSuperAdmin>
  );
}
