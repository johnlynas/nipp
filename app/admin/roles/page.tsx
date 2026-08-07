'use client';

import { useState, useEffect, useRef } from 'react';
import { Eye, Pencil, Trash2 } from 'lucide-react';
import { RequireSuperAdmin } from '@/components/auth/RequireSuperAdmin';
import Link from 'next/link';
import { encryptedFetch } from '@/lib/api-client';

interface Organization {
  id: string;
  name: string;
}

interface Role {
  id: string;
  name: string;
  description?: string | null;
  isDefault: boolean;
  organizationId: string;
  organization?: Organization;
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
  const [orgFilter, setOrgFilter] = useState('');
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Debounce search input
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Refs to always have the latest values inside async callbacks
  const orgFilterRef = useRef(orgFilter);
  const isDefaultFilterRef = useRef(isDefaultFilter);
  const debouncedSearchRef = useRef(debouncedSearch);

  useEffect(() => { orgFilterRef.current = orgFilter; }, [orgFilter]);
  useEffect(() => { isDefaultFilterRef.current = isDefaultFilter; }, [isDefaultFilter]);
  useEffect(() => { debouncedSearchRef.current = debouncedSearch; }, [debouncedSearch]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 200);
    return () => clearTimeout(timer);
  }, [search]);

  // Track filter changes to reset pagination
  const [fetchKey, setFetchKey] = useState(0);

  useEffect(() => {
    setPagination((p) => ({ ...p, page: 1 }));
    setFetchKey((k) => k + 1);
  }, [debouncedSearch, isDefaultFilter, orgFilter]);

  // Fetch organizations for the filter dropdown
  useEffect(() => {
    async function fetchOrgs() {
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
    fetchOrgs();
  }, []);

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
        if (debouncedSearchRef.current) params.set('search', debouncedSearchRef.current);
        if (isDefaultFilterRef.current === 'true') params.set('isDefault', 'true');
        else if (isDefaultFilterRef.current === 'false') params.set('isDefault', 'false');
        if (orgFilterRef.current) params.set('orgId', orgFilterRef.current);

        const url = `/api/admin/roles?${params}`;
        console.log('[RolesPage] Fetching:', url);

        const res = await encryptedFetch(url, { pii: true });
        console.log('[RolesPage] Response status:', res.status);

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to fetch roles');
        }

        const data = await res.json();
        console.log('[RolesPage] Roles count:', (data.items || []).length);
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

  const getOrgName = (role: Role) => {
    if (role.organization?.name) return role.organization.name;
    // Fallback: look up from organizations list
    const org = organizations.find((o) => o.id === role.organizationId);
    return org?.name || '—';
  };

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
            <Link
              href="/admin/roles/create"
              className="rounded px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
              style={{ backgroundColor: '#F5A623' }}
            >
              + Add Role
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
              placeholder="Search roles..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="rounded border px-3 py-2 text-sm bg-white hover:bg-gray-100 text-gray-700 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Search roles"
            />
            <select
              value={orgFilter}
              onChange={(e) => {
                setOrgFilter(e.target.value);
                setSearch('');
              }}
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
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-white" scope="col">Organization</th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-white" scope="col">Description</th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-white" scope="col">Type</th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-white" scope="col">Members</th>
                    <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-white" scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {roles.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-8 text-center text-sm text-gray-500">
                        No roles found.
                      </td>
                    </tr>
                  ) : (
                    roles.map((role) => (
                      <tr key={role.id} className="hover:bg-gray-50">
                        <td className="whitespace-nowrap px-6 py-4 text-sm font-medium" style={{ color: '#1B2A4A' }}>
                          {role.name}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-700">
                          {getOrgName(role)}
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
                            <Link href={`/admin/roles/${role.id}/view`} className="text-blue-600 hover:text-blue-800 transition-colors" title="View" aria-label={`View ${role.name}`}>
                              <Eye className="w-4 h-4" />
                            </Link>
                            <Link href={`/admin/roles/${role.id}/edit`} className="text-amber-600 hover:text-amber-800 transition-colors" title="Edit" aria-label={`Edit ${role.name}`}>
                              <Pencil className="w-4 h-4" />
                            </Link>
                            <Link href={`/admin/roles/${role.id}/delete`} className="text-red-600 hover:text-red-800 transition-colors" title="Delete" aria-label={`Delete ${role.name}`}>
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
