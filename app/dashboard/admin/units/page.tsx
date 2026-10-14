'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Eye, Pencil, Trash2 } from 'lucide-react';
import { logClientError } from '@/lib/client-error-logger';
import { SearchBar } from '@/components/dashboard/SearchBar';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { DataTable } from '@/components/dashboard/DataTable';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { StatCard } from '@/components/dashboard/StatCard';
import { Modal } from '@/components/dashboard/Modal';
import { ConfirmDialog } from '@/components/dashboard/ConfirmDialog';
import { PaginationControls } from '@/components/admin/PaginationControls';

interface Unit {
  unitId: string;
  organizationId: string;
  owner: string;
  address: string;
  postCode: string;
  rented: boolean;
  type: 'HOUSE' | 'APARTMENT' | 'OTHER';
  createdAt: string;
  updatedAt: string;
  organization?: { id: string; name: string } | null;
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

const TYPE_LABELS: Record<Unit['type'], string> = {
  HOUSE: 'House',
  APARTMENT: 'Apartment',
  OTHER: 'Other',
};

export default function UnitsPage() {
  const [units, setUnits] = useState<Unit[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [pagination, setPagination] = useState<PaginationState>({ page: 1, pageSize: 8, total: 0, totalPages: 0 });
  const [search, setSearch] = useState('');
  const [orgFilter, setOrgFilter] = useState('');
  const [rentedFilter, setRentedFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [counts, setCounts] = useState<{ totalCount: number; rentedCount: number; ownerOccupiedCount: number }>({ totalCount: 0, rentedCount: 0, ownerOccupiedCount: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal states
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedUnit, setSelectedUnit] = useState<Unit | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);

  // Create modal states
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ owner: '', address: '', postCode: '', rented: false, type: 'APARTMENT' as Unit['type'] });
  const [createOrgId, setCreateOrgId] = useState('');

  // Edit modal states
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editForm, setEditForm] = useState({ owner: '', address: '', postCode: '', rented: false, type: 'APARTMENT' as Unit['type'] });

  // Abort controller to cancel stale fetch requests
  const abortControllerRef = useRef<AbortController | null>(null);

  // Fetch organizations for dropdowns
  useEffect(() => {
    async function fetchOrganizations() {
      try {
        const res = await fetch('/api/dashboard/admin/organizations?page=1&pageSize=8');
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
  }, [search, orgFilter, rentedFilter, typeFilter]);

  // Reset create form when modal opens/closes
  useEffect(() => {
    if (!createModalOpen) {
      setCreateForm({ owner: '', address: '', postCode: '', rented: false, type: 'APARTMENT' });
      setCreateOrgId('');
    }
  }, [createModalOpen]);

  // Fetch units
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
      if (rentedFilter) params.set('rented', rentedFilter);
      if (typeFilter) params.set('type', typeFilter);

      const res = await fetch(`/api/dashboard/admin/units?${params}`, {
        signal: abortControllerRef.current.signal,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to fetch units');
      }

      const data = await res.json();
      setUnits(data.items || []);

      const total = data.pagination?.total ?? 0;
      const totalPages = Math.max(1, Math.ceil(total / pagination.pageSize));

      setPagination({
        page: pagination.page,
        pageSize: pagination.pageSize,
        total,
        totalPages,
      });

      if (data.counts) {
        setCounts(data.counts);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const message = err instanceof Error ? err.message : 'Failed to fetch units';
      console.error('Failed to fetch units:', err);
      logClientError(message, 'units', 'fetch');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.pageSize, search, orgFilter, rentedFilter, typeFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-dismiss error banners after 6 seconds
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(timer);
  }, [error]);

  // Handle create unit
  const handleCreateUnit = async () => {
    if (!createForm.owner.trim() || !createForm.address.trim() || !createForm.postCode.trim()) {
      const message = 'Owner, address and post code are required';
      logClientError(message, 'units', 'create');
      setError(message);
      return;
    }

    if (!createOrgId) {
      const message = 'Organization is required';
      logClientError(message, 'units', 'create');
      setError(message);
      return;
    }

    try {
      const body = {
        owner: createForm.owner.trim(),
        address: createForm.address.trim(),
        postCode: createForm.postCode.trim(),
        rented: createForm.rented,
        type: createForm.type,
        organizationId: createOrgId,
      };

      const res = await fetch('/api/dashboard/admin/units', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to create unit');
      }

      setCreateModalOpen(false);
      fetchData();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create unit';
      console.error('Failed to create unit:', err);
      logClientError(message, 'units', 'create');
      setError(message);
    }
  };

  // Handle edit unit
  const handleEditUnit = async () => {
    if (!selectedUnit) return;

    try {
      const res = await fetch(`/api/dashboard/admin/units/${selectedUnit.unitId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to update unit');
      }

      setEditModalOpen(false);
      fetchData();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update unit';
      console.error('Failed to update unit:', err);
      logClientError(message, 'units', 'update');
      setError(message);
    }
  };

  // Handle delete unit
  const handleDeleteUnit = async () => {
    if (!selectedUnit) return;

    try {
      const res = await fetch(`/api/dashboard/admin/units/${selectedUnit.unitId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete unit');
      }
      setDeleteModalOpen(false);
      fetchData();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete unit';
      console.error('Failed to delete unit:', err);
      logClientError(message, 'units', 'delete');
      setError(message);
    }
  };

  const columns = [
    { key: 'address', label: 'Address', render: (u: Unit) => (
      <div>
        <div className="font-medium" style={{ color: 'var(--color-navy-850)' }}>{u.address}</div>
        <div className="text-xs text-slate-500">{u.postCode}</div>
      </div>
    )},
    { key: 'owner', label: 'Owner', render: (u: Unit) => (
      <span style={{ color: 'var(--color-navy-850)' }}>{u.owner}</span>
    )},
    { key: 'type', label: 'Type', render: (u: Unit) => (
      <span style={{ color: 'var(--color-navy-850)' }}>{TYPE_LABELS[u.type] || u.type}</span>
    )},
    { key: 'organization', label: 'Organization', render: (u: Unit) => (
      <span style={{ color: 'var(--color-navy-850)' }}>{u.organization?.name || '—'}</span>
    )},
    { key: 'rented', label: 'Occupancy', render: (u: Unit) => (
      <StatusBadge status={u.rented ? 'Rented' : 'Owner Occupied'} />
    )},
    { key: 'actions', label: 'Actions', render: (u: Unit) => (
      <div className="flex items-center gap-1">
        <button
          onClick={() => { setSelectedUnit(u); setDetailModalOpen(true); }}
          title={`View ${u.address}`}
          className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-navy-850 transition-colors"
          aria-label={`View ${u.address}`}
        >
          <Eye className="h-4 w-4" />
        </button>
        <button
          onClick={() => {
            setSelectedUnit(u);
            setEditForm({ owner: u.owner, address: u.address, postCode: u.postCode, rented: u.rented, type: u.type });
            setEditModalOpen(true);
          }}
          title={`Edit ${u.address}`}
          className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-navy-850 transition-colors"
          aria-label={`Edit ${u.address}`}
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          onClick={() => { setSelectedUnit(u); setDeleteModalOpen(true); }}
          title={`Delete ${u.address}`}
          className="rounded p-1.5 text-slate-500 hover:bg-danger-tint hover:text-danger-ink transition-colors"
          aria-label={`Delete ${u.address}`}
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
        <div className="mb-4 rounded border bg-danger-tint border-danger-border p-3 text-sm text-danger-ink" role="alert">
          {error}
        </div>
      )}

      {/* Stat Cards */}
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Total Units" value={counts.totalCount} />
        <StatCard label="Rented" value={counts.rentedCount} color="warning" />
        <StatCard label="Owner Occupied" value={counts.ownerOccupiedCount} color="success" />
      </div>

      {/* Page Header */}
      <PageHeader title="" description="Manage units (properties)" primaryAction=<button
          onClick={() => setCreateModalOpen(true)}
          className="w-full sm:w-auto rounded px-4 py-2 text-center text-sm font-medium text-accent-ink transition-colors hover:opacity-90"
          style={{ backgroundColor: 'var(--color-accent)' }}
        >
          + Add Unit
        </button> />

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchBar value={search} onChange={setSearch} placeholder="Search units by owner, address or post code..." aria-label="Search units" />
        <select
          value={orgFilter}
          onChange={(e) => setOrgFilter(e.target.value)}
          className="rounded border px-3 py-2 text-sm bg-white hover:bg-slate-50 transition-colors focus:outline-none"
          style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
          aria-label="Filter by organization"
        >
          <option value="">All Organizations</option>
          {organizations.map((org) => (
            <option key={org.id} value={org.id}>{org.name}</option>
          ))}
        </select>
        <select
          value={rentedFilter}
          onChange={(e) => setRentedFilter(e.target.value)}
          className="rounded border px-3 py-2 text-sm bg-white hover:bg-slate-50 transition-colors focus:outline-none"
          style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
          aria-label="Filter by occupancy"
        >
          <option value="">All Occupancy</option>
          <option value="true">Rented</option>
          <option value="false">Owner Occupied</option>
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded border px-3 py-2 text-sm bg-white hover:bg-slate-50 transition-colors focus:outline-none"
          style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
          aria-label="Filter by unit type"
        >
          <option value="">All Types</option>
          <option value="APARTMENT">Apartment</option>
          <option value="HOUSE">House</option>
          <option value="OTHER">Other</option>
        </select>
      </div>

      {/* Table */}
      <DataTable<Unit> columns={columns} data={units} loading={loading} emptyMessage="No units found" />

      {/* Pagination */}
      <PaginationControls
        currentPage={pagination.page}
        totalPages={pagination.totalPages}
        totalItems={pagination.total}
        pageSize={pagination.pageSize}
        onPageChange={(page) => setPagination((p) => ({ ...p, page }))}
      />

      {/* Unit Detail Modal */}
      <Modal isOpen={detailModalOpen} onClose={() => setDetailModalOpen(false)} title="Unit Details" size="md">
        {selectedUnit && (
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium" style={{ color: 'var(--color-slate-500)' }}>Address</label>
              <p className="mt-1" style={{ color: 'var(--color-navy-850)' }}>{selectedUnit.address}, {selectedUnit.postCode}</p>
            </div>
            <div>
              <label className="text-sm font-medium" style={{ color: 'var(--color-slate-500)' }}>Owner</label>
              <p className="mt-1" style={{ color: 'var(--color-navy-850)' }}>{selectedUnit.owner}</p>
            </div>
            <div className="flex gap-4">
              <div>
                <label className="text-sm font-medium" style={{ color: 'var(--color-slate-500)' }}>Type</label>
                <div className="mt-1"><StatusBadge status={TYPE_LABELS[selectedUnit.type] || selectedUnit.type} /></div>
              </div>
              <div>
                <label className="text-sm font-medium" style={{ color: 'var(--color-slate-500)' }}>Occupancy</label>
                <div className="mt-1">
                  <StatusBadge status={selectedUnit.rented ? 'Rented' : 'Owner Occupied'} />
                </div>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium" style={{ color: 'var(--color-slate-500)' }}>Organization</label>
              <p className="mt-1" style={{ color: 'var(--color-navy-850)' }}>{selectedUnit.organization?.name || '—'}</p>
            </div>
            <div>
              <label className="text-sm font-medium" style={{ color: 'var(--color-slate-500)' }}>Added</label>
              <p className="mt-1" style={{ color: 'var(--color-navy-850)' }}>{new Date(selectedUnit.createdAt).toLocaleDateString()}</p>
            </div>
          </div>
        )}
      </Modal>

      {/* Delete Confirm Dialog */}
      <ConfirmDialog
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        onConfirm={handleDeleteUnit}
        title="Delete Unit"
        message={`Are you sure you want to delete ${selectedUnit?.address}, ${selectedUnit?.postCode}? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
      />

      {/* Create Unit Modal */}
      <Modal isOpen={createModalOpen} onClose={() => setCreateModalOpen(false)} title="Add Unit" size="md">
        <div className="space-y-4">
          <div>
            <label htmlFor="create-owner" className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-navy-850)' }}>Owner</label>
            <input
              id="create-owner"
              type="text"
              value={createForm.owner}
              onChange={(e) => setCreateForm((f) => ({ ...f, owner: e.target.value }))}
              className="w-full rounded border px-3 py-2 text-sm focus:outline-none"
              style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
              placeholder="Unit owner name"
            />
          </div>
          <div>
            <label htmlFor="create-address" className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-navy-850)' }}>Address</label>
            <input
              id="create-address"
              type="text"
              value={createForm.address}
              onChange={(e) => setCreateForm((f) => ({ ...f, address: e.target.value }))}
              className="w-full rounded border px-3 py-2 text-sm focus:outline-none"
              style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
              placeholder="Street address"
            />
          </div>
          <div>
            <label htmlFor="create-postcode" className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-navy-850)' }}>Post Code</label>
            <input
              id="create-postcode"
              type="text"
              value={createForm.postCode}
              onChange={(e) => setCreateForm((f) => ({ ...f, postCode: e.target.value }))}
              className="w-full rounded border px-3 py-2 text-sm focus:outline-none"
              style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
              placeholder="e.g. BT48 6XX"
            />
          </div>
          <div className="flex gap-4">
            <div>
              <label htmlFor="create-type" className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-slate-500)' }}>Type</label>
              <select
                id="create-type"
                value={createForm.type}
                onChange={(e) => setCreateForm((f) => ({ ...f, type: e.target.value as Unit['type'] }))}
                className="w-full rounded border px-3 py-2 text-sm bg-white focus:outline-none"
                style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
              >
                <option value="APARTMENT">Apartment</option>
                <option value="HOUSE">House</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-slate-500)' }}>Occupancy</label>
              <select
                value={createForm.rented ? 'true' : 'false'}
                onChange={(e) => setCreateForm((f) => ({ ...f, rented: e.target.value === 'true' }))}
                className="w-full rounded border px-3 py-2 text-sm bg-white focus:outline-none"
                style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
                aria-label="Occupancy"
              >
                <option value="false">Owner Occupied</option>
                <option value="true">Rented</option>
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="create-org" className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-navy-850)' }}>Organization</label>
            <select
              id="create-org"
              value={createOrgId}
              onChange={(e) => setCreateOrgId(e.target.value)}
              className="w-full rounded border px-3 py-2 text-sm bg-white focus:outline-none"
              style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
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
              className="rounded border px-4 py-2 text-sm font-medium transition-colors hover:bg-slate-50"
              style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
            >
              Cancel
            </button>
            <button
              onClick={handleCreateUnit}
              disabled={!createForm.owner.trim() || !createForm.address.trim() || !createForm.postCode.trim() || !createOrgId}
              className="rounded px-4 py-2 text-sm font-medium text-accent-ink transition-colors hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: 'var(--color-accent)' }}
            >
              Add Unit
            </button>
          </div>
        </div>
      </Modal>

      {/* Edit Unit Modal */}
      <Modal isOpen={editModalOpen} onClose={() => setEditModalOpen(false)} title="Edit Unit" size="md">
        {selectedUnit && (
          <div className="space-y-4">
            <div>
              <label htmlFor="edit-owner" className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-navy-850)' }}>Owner</label>
              <input
                id="edit-owner"
                type="text"
                value={editForm.owner}
                onChange={(e) => setEditForm((f) => ({ ...f, owner: e.target.value }))}
                className="w-full rounded border px-3 py-2 text-sm focus:outline-none"
                style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
              />
            </div>
            <div>
              <label htmlFor="edit-address" className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-navy-850)' }}>Address</label>
              <input
                id="edit-address"
                type="text"
                value={editForm.address}
                onChange={(e) => setEditForm((f) => ({ ...f, address: e.target.value }))}
                className="w-full rounded border px-3 py-2 text-sm focus:outline-none"
                style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
              />
            </div>
            <div>
              <label htmlFor="edit-postcode" className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-navy-850)' }}>Post Code</label>
              <input
                id="edit-postcode"
                type="text"
                value={editForm.postCode}
                onChange={(e) => setEditForm((f) => ({ ...f, postCode: e.target.value }))}
                className="w-full rounded border px-3 py-2 text-sm focus:outline-none"
                style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
              />
            </div>
            <div className="flex gap-4">
              <div>
                <label htmlFor="edit-type" className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-slate-500)' }}>Type</label>
                <select
                  id="edit-type"
                  value={editForm.type}
                  onChange={(e) => setEditForm((f) => ({ ...f, type: e.target.value as Unit['type'] }))}
                  className="w-full rounded border px-3 py-2 text-sm bg-white focus:outline-none"
                  style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
                >
                  <option value="APARTMENT">Apartment</option>
                  <option value="HOUSE">House</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-slate-500)' }}>Occupancy</label>
                <select
                  value={editForm.rented ? 'true' : 'false'}
                  onChange={(e) => setEditForm((f) => ({ ...f, rented: e.target.value === 'true' }))}
                  className="w-full rounded border px-3 py-2 text-sm bg-white focus:outline-none"
                  style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
                  aria-label="Occupancy"
                >
                  <option value="false">Owner Occupied</option>
                  <option value="true">Rented</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setEditModalOpen(false)}
                className="rounded border px-4 py-2 text-sm font-medium transition-colors hover:bg-slate-50"
                style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleEditUnit}
                disabled={!editForm.owner.trim() || !editForm.address.trim() || !editForm.postCode.trim()}
                className="rounded px-4 py-2 text-sm font-medium text-accent-ink transition-colors hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: 'var(--color-accent)' }}
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
