'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { RequireSuperAdmin } from '@/components/auth/RequireSuperAdmin';
import { OrgTable } from '@/components/admin/OrgTable';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { encryptedFetch } from '@/lib/api-client';

interface Organization {
  id: string;
  name: string;
  slug: string | null;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
  memberCount: number;
  createdAt: string;
}

interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/**
 * Super Admin — Organization list view with real-time search (cached) and status filter.
 * - Name-only search uses the cached /api/admin/organizations/search endpoint (L1+L2)
 * - Status filtering uses the paginated /api/admin/organizations endpoint
 */
export default function OrganizationsPage() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 8, total: 0, totalPages: 0 });
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Debounce search input to avoid excessive API calls
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 200);
    return () => clearTimeout(timer);
  }, [search]);

  // Track whether we just reset to page 1 (filter changed) vs navigating pages
  const [fetchKey, setFetchKey] = useState(0);

  // Reset to page 1 whenever filters change, triggering a re-fetch
  useEffect(() => {
    setPagination((p) => ({ ...p, page: 1 }));
    setFetchKey((k) => k + 1);
  }, [debouncedSearch, statusFilter]);

  // Fetch organizations whenever fetchKey or pagination.page changes
  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        // If there's a search query, use the cached search endpoint for name filtering
        if (debouncedSearch) {
          // If status filter is active, use paginated endpoint with both filters
          if (statusFilter) {
            const params = new URLSearchParams({
              page: String(pagination.page),
              pageSize: String(pagination.pageSize),
              status: statusFilter,
              search: debouncedSearch,
            });

            const res = await encryptedFetch(`/api/admin/organizations?${params}`, { pii: true });
            const data = await res.json();

            setOrganizations(data.organizations || []);

            const total = data.pagination?.total ?? 0;
            const pageSizeFromApi = data.pagination?.pageSize || pagination.pageSize || 20;
            const totalPages = Math.max(1, Math.ceil(total / pageSizeFromApi));

            setPagination({
              page: pagination.page,
              pageSize: pageSizeFromApi,
              total,
              totalPages,
            });

          } else {
            // Name-only search: use cached endpoint (no status filter needed)
            const searchParams = new URLSearchParams({ q: debouncedSearch });
            const res = await encryptedFetch(`/api/admin/organizations/search?${searchParams}`, { pii: true });
            if (!res.ok) {
              throw new Error('Failed to fetch organizations');
            }

            const data = await res.json();
            // Search endpoint returns { id, name, slug } — fill in defaults for table display
            const results: Organization[] = (data.results || []).map((org: { id: string; name: string; slug: string | null }) => ({
              ...org,
              status: 'ACTIVE' as const,
              memberCount: 0,
              createdAt: '',
            }));

            setOrganizations(results);
            setPagination({
              page: 1,
              pageSize: results.length,
              total: data.total || results.length,
              totalPages: 1,
            });

          }

        } else {
          // No search query — use paginated endpoint with optional status filter
          const params = new URLSearchParams({
            page: String(pagination.page),
            pageSize: String(pagination.pageSize),
          });
          if (statusFilter) params.set('status', statusFilter);

          const res = await encryptedFetch(`/api/admin/organizations?${params}`, { pii: true });
          const data = await res.json();

          setOrganizations(data.organizations || []);

          const total = data.pagination?.total ?? 0;
          const pageSizeFromApi = data.pagination?.pageSize || pagination.pageSize || 20;
          const totalPages = Math.max(1, Math.ceil(total / pageSizeFromApi));

          setPagination({
            page: pagination.page,
            pageSize: pageSizeFromApi,
            total,
            totalPages,
          });
        }
      } catch (error) {
        console.error('Failed to fetch organizations:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [fetchKey, pagination.page, pagination.pageSize]);

  async function handleDelete(id: string) {
    try {
      const res = await encryptedFetch(`/api/admin/organizations/${id}`, { method: 'DELETE', pii: true });
      if (res.ok) {
        setOrganizations((prev) => prev.filter((o) => o.id !== id));
      }
    } catch (error) {
      console.error('Failed to delete organization:', error);
    } finally {
      setDeleteConfirm(null);
    }
  }

  // When using search results (no status filter), show a simpler table without status/members/date columns
  const isSearchResults = !!debouncedSearch && !statusFilter;

  return (
    <RequireSuperAdmin>
      <div className="min-h-screen">
        <main className="p-6">
          {/* Page Header */}
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold" style={{ color: '#1B2A4A' }}>Organizations</h2>
              <p className="text-sm text-gray-500">Manage tenant organizations</p>
            </div>
            <Link
              href="/admin/organizations/create"
              className="rounded px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
              style={{ backgroundColor: '#F5A623' }}
            >
              + Create Organization
            </Link>
          </div>

          {/* Filters */}
          <div className="mb-4 flex gap-3">
            <input
              type="text"
              placeholder="Search organizations..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="rounded border px-3 py-2 text-sm bg-white hover:bg-gray-100 text-gray-700 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Search organizations"
            />
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setSearch('');
              }}
              className="rounded border px-3 py-2 text-sm bg-white hover:bg-gray-100 text-gray-700 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Filter by status"
            >
              <option value="">Status</option>
              <option value="ACTIVE">Active</option>
              <option value="PENDING">Pending</option>
              <option value="SUSPENDED">Suspended</option>
              <option value="ARCHIVED">Archived</option>
            </select>
          </div>

          {/* Table */}
          {loading ? (
            <p className="py-8 text-center">Loading...</p>
          ) : (
            <>
              {isSearchResults ? (
                /* Simple table for search results — no status/members/date columns */
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200" role="table">
                    <thead className="bg-[#1B2A4A]">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-white" scope="col">
                          Organization Name
                        </th>
                        <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-white" scope="col">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 bg-white">
                      {organizations.map((org) => (
                        <tr key={org.id}>
                          <td className="whitespace-nowrap px-6 py-4 text-sm font-medium" style={{ color: '#1B2A4A' }}>
                            {org.name}
                          </td>
                          <td className="whitespace-nowrap px-6 py-4 text-right text-sm">
                            <button
                              onClick={() => window.location.href = `/admin/organizations/${org.id}`}
                              className="mr-3 text-blue-600 hover:text-blue-800"
                              aria-label={`View ${org.name}`}
                            >
                              View
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <OrgTable
                  organizations={organizations}
                  onView={(id) => window.location.href = `/admin/organizations/${id}`}
                  onDelete={(id) => setDeleteConfirm(id)}
                />
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
            </>
          )}
        </main>

        {/* Delete Confirmation */}
        <ConfirmDialog
          isOpen={!!deleteConfirm}
          title="Archive Organization"
          message="Are you sure you want to archive this organization? This action is terminal."
          confirmLabel="Archive"
          danger
          onConfirm={() => deleteConfirm && handleDelete(deleteConfirm)}
          onCancel={() => setDeleteConfirm(null)}
        />
      </div>
    </RequireSuperAdmin>
  );
}
