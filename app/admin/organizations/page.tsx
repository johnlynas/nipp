'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { RequireSuperAdmin } from '@/components/auth/RequireSuperAdmin';
import { OrgTable } from '@/components/admin/OrgTable';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { EditModal } from '@/components/admin/EditModal';
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
  const [error, setError] = useState<string | null>(null);

  // Modal states
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingOrg, setEditingOrg] = useState<Organization | null>(null);
  const [viewingOrg, setViewingOrg] = useState<Organization | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Edit form state
  const [formName, setFormName] = useState('');
  const [formSlug, setFormSlug] = useState('');
  const [formStatus, setFormStatus] = useState<'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED'>('ACTIVE');
  const [submitting, setSubmitting] = useState(false);

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
      setError(null);
      try {
        const params = new URLSearchParams({
          page: String(pagination.page),
          pageSize: String(pagination.pageSize),
        });
        if (debouncedSearch) params.set('search', debouncedSearch);
        if (statusFilter) params.set('status', statusFilter);

        const res = await encryptedFetch(`/api/admin/organizations?${params}`, { pii: true });
        const data = await res.json();

        setOrganizations(data.organizations || []);

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
        console.error('Failed to fetch organizations:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch organizations');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [fetchKey, pagination.page, pagination.pageSize]);

  // Open edit modal with pre-filled data
  function openEditModal(org: Organization) {
    setEditingOrg(org);
    setFormName(org.name);
    setFormSlug(org.slug || '');
    setFormStatus(org.status);
    setShowEditModal(true);
  }

  // Submit edit
  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingOrg) return;

    setSubmitting(true);
    setError(null);

    try {
      const body: { name?: string; slug?: string; status?: string } = {};
      if (formName !== editingOrg.name) body.name = formName;
      if (formSlug !== editingOrg.slug) body.slug = formSlug;
      if (formStatus !== editingOrg.status) body.status = formStatus;

      if (Object.keys(body).length === 0) {
        setShowEditModal(false);
        return;
      }

      const res = await encryptedFetch(`/api/admin/organizations/${editingOrg.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
        pii: true,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to update organization');
      }

      setShowEditModal(false);
      setFetchKey((k) => k + 1); // Re-fetch table
    } catch (err) {
      console.error('Failed to update organization:', err);
      setError(err instanceof Error ? err.message : 'Failed to update organization');
    } finally {
      setSubmitting(false);
    }
  }

  // Delete organization (archive)
  async function handleDelete(id: string) {
    try {
      const res = await encryptedFetch(`/api/admin/organizations/${id}`, { method: 'DELETE', pii: true });
      if (res.ok) {
        setFetchKey((k) => k + 1); // Re-fetch table
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Failed to archive organization');
      }
    } catch (err) {
      console.error('Failed to archive organization:', err);
      setError(err instanceof Error ? err.message : 'Failed to archive organization');
    } finally {
      setDeleteConfirm(null);
    }
  }

  // View organization details
  async function handleView(id: string) {
    try {
      const res = await encryptedFetch(`/api/admin/organizations/${id}`, { pii: true });
      if (!res.ok) {
        throw new Error('Failed to fetch organization details');
      }
      const data = await res.json();
      setViewingOrg({
        id: data.id,
        name: data.name,
        slug: data.slug,
        status: data.status,
        memberCount: data.memberCount ?? 0,
        createdAt: data.createdAt || '',
      });
    } catch (err) {
      console.error('Failed to fetch organization details:', err);
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
              <option value="">All</option>
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
            <OrgTable
              organizations={organizations}
              onView={(id) => handleView(id)}
              onEdit={(id) => {
                const org = organizations.find((o) => o.id === id);
                if (org) openEditModal(org);
              }}
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

          {/* Edit Modal */}
          <EditModal
            isOpen={showEditModal}
            onClose={() => setShowEditModal(false)}
            title="Edit Organization"
          >
            <form onSubmit={handleEditSubmit}>
              <div className="space-y-3">
                <input type="text" placeholder="name" required value={formName} onChange={(e) => setFormName(e.target.value)} className="w-full rounded border px-3 py-2 text-sm" aria-label="Organization name" />
                <input type="text" placeholder="slug (optional)" value={formSlug} onChange={(e) => setFormSlug(e.target.value)} className="w-full rounded border px-3 py-2 text-sm" aria-label="Organization slug" />
                <select value={formStatus} onChange={(e) => setFormStatus(e.target.value as Organization['status'])} className="w-full rounded border px-3 py-2 text-sm" aria-label="Organization status">
                  <option value="PENDING">Pending</option>
                  <option value="ACTIVE">Active</option>
                  <option value="SUSPENDED">Suspended</option>
                  <option value="ARCHIVED">Archived</option>
                </select>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" onClick={() => setShowEditModal(false)} className="rounded px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100">
                  Cancel
                </button>
                <button type="submit" disabled={submitting} className="rounded px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90" style={{ backgroundColor: '#F5A623' }}>
                  {submitting ? 'Saving...' : 'Update'}
                </button>
              </div>
            </form>
          </EditModal>

          {/* View Modal */}
          {viewingOrg && (
            <EditModal
              isOpen={!!viewingOrg}
              onClose={() => setViewingOrg(null)}
              title="Organization Details"
            >
              <div className="space-y-2 text-sm">
                <div><span className="font-medium" style={{ color: '#1B2A4A' }}>Name:</span> <span className="ml-2">{viewingOrg.name}</span></div>
                <div><span className="font-medium" style={{ color: '#1B2A4A' }}>Slug:</span> <span className="ml-2">{viewingOrg.slug || '—'}</span></div>
                <div><span className="font-medium" style={{ color: '#1B2A4A' }}>Status:</span> <span className="ml-2">{viewingOrg.status}</span></div>
                <div><span className="font-medium" style={{ color: '#1B2A4A' }}>Members:</span> <span className="ml-2">{viewingOrg.memberCount}</span></div>
              </div>
              <div className="mt-4 flex justify-end">
                <button onClick={() => setViewingOrg(null)} className="rounded px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100">
                  Close
                </button>
              </div>
            </EditModal>
          )}

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
        </main>
      </div>
    </RequireSuperAdmin>
  );
}
