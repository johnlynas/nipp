'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { RequireSuperAdmin } from '@/components/auth/RequireSuperAdmin';
import { OrgTable } from '@/components/admin/OrgTable';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';

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
 * Super Admin — Organization list view with search, filter by status, pagination.
 */
export default function OrganizationsPage() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 8, total: 0, totalPages: 0 });
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  useEffect(() => {
    fetchOrganizations();
  }, [pagination.page, search, statusFilter]);

  async function fetchOrganizations() {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(pagination.page),
        pageSize: String(pagination.pageSize),
      });
      if (search) params.set('search', search);
      if (statusFilter) params.set('status', statusFilter);

      const res = await fetch(`/api/admin/organizations?${params}`);
      const data = await res.json();
      
      // Debug: log the raw response to verify pagination data
      console.log('[Organizations] API Response:', {
        organizationsCount: data.organizations?.length,
        pagination: data.pagination,
      });

      setOrganizations(data.organizations || []);
      
      // Ensure pagination state always has valid totalPages
      const total = data.pagination?.total ?? 0;
      const pageSizeFromApi = data.pagination?.pageSize || pagination.pageSize || 20;
      const totalPages = Math.max(1, Math.ceil(total / pageSizeFromApi));
      
      console.log('[Organizations] Calculated pagination:', {
        total,
        pageSizeFromApi,
        totalPages,
        currentPage: pagination.page,
      });
      
      setPagination({
        page: data.pagination?.page ?? pagination.page,
        pageSize: pageSizeFromApi,
        total,
        totalPages,
      });
    } catch (error) {
      console.error('Failed to fetch organizations:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/admin/organizations/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setOrganizations((prev) => prev.filter((o) => o.id !== id));
      }
    } catch (error) {
      console.error('Failed to delete organization:', error);
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
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded border px-3 py-2 text-sm bg-white hover:bg-gray-100 text-gray-700 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
          {loading ? (
            <p className="py-8 text-center">Loading...</p>
          ) : (
            <>
              <OrgTable
                organizations={organizations}
                onView={(id) => window.location.href = `/admin/organizations/${id}`}
                onDelete={(id) => setDeleteConfirm(id)}
              />

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
