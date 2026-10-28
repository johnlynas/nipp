'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Eye, Pencil, Trash2 } from 'lucide-react';
import { logClientError } from '@/lib/client-error-logger';
import { SearchBar } from '@/components/dashboard/SearchBar';
import { DataTable } from '@/components/dashboard/DataTable';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { StatCard } from '@/components/dashboard/StatCard';
import { Modal } from '@/components/dashboard/Modal';
import { ConfirmDialog } from '@/components/dashboard/ConfirmDialog';
import { PaginationControls } from '@/components/admin/PaginationControls';
import { apiFetch } from '@/lib/api-client';

type ContractorType =
  | 'PAINTER'
  | 'ELECTRICIAN'
  | 'PLUMBER'
  | 'GAS_ENGINEER'
  | 'LIFT_MAINTENANCE'
  | 'GARDENER'
  | 'ACCOUNTANT'
  | 'FIRE_ALARMS'
  | 'SOLICITOR'
  | 'ROOFER'
  | 'WINDOW_CLEANER'
  | 'OTHER';

interface Contractor {
  contractorId: string;
  companyName: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  postCode: string;
  type: ContractorType;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PaginationState {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

const TYPE_LABELS: Record<ContractorType, string> = {
  PAINTER: 'Painter',
  ELECTRICIAN: 'Electrician',
  PLUMBER: 'Plumber',
  GAS_ENGINEER: 'Gas Engineer',
  LIFT_MAINTENANCE: 'Lift Maintenance',
  GARDENER: 'Gardener',
  ACCOUNTANT: 'Accountant',
  FIRE_ALARMS: 'Fire Alarms',
  SOLICITOR: 'Solicitor',
  ROOFER: 'Roofer',
  WINDOW_CLEANER: 'Window Cleaner',
  OTHER: 'Other',
};

const CONTRACTOR_TYPE_OPTIONS = Object.entries(TYPE_LABELS) as [ContractorType, string][];

export default function ContractorsPage() {
  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [pagination, setPagination] = useState<PaginationState>({ page: 1, pageSize: 8, total: 0, totalPages: 0 });
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [counts, setCounts] = useState<{ totalCount: number; types?: Partial<Record<ContractorType, number>> }>({ totalCount: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal states (same shape as the Users page: detail / delete + create / edit)
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedContractor, setSelectedContractor] = useState<Contractor | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);

  const emptyForm = { companyName: '', name: '', email: '', phone: '', address: '', postCode: '', type: 'OTHER' as ContractorType, description: '' };
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createForm, setCreateForm] = useState(emptyForm);

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editForm, setEditForm] = useState(emptyForm);

  // Abort controller to cancel stale fetch requests
  const abortControllerRef = useRef<AbortController | null>(null);

  // Reset to page 1 when filters change
  useEffect(() => {
    setPagination((p) => ({ ...p, page: 1 }));
  }, [search, typeFilter]);

  // Reset create form when modal opens/closes
  useEffect(() => {
    if (!createModalOpen) {
      setCreateForm(emptyForm);
    }
  }, [createModalOpen]);

  // Fetch contractors
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
      if (typeFilter) params.set('type', typeFilter);

      const res = await apiFetch(`/api/dashboard/admin/contractors?${params}`, {
        signal: abortControllerRef.current.signal,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to fetch contractors');
      }

      const data = await res.json();
      setContractors(data.items || []);

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
      const message = err instanceof Error ? err.message : 'Failed to fetch contractors';
      console.error('Failed to fetch contractors:', err);
      logClientError(message, 'contractors', 'fetch');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.pageSize, search, typeFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-dismiss error banners after 6 seconds
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(timer);
  }, [error]);

  // Handle create contractor
  const handleCreateContractor = async () => {
    if (!createForm.companyName.trim() || !createForm.name.trim() || !createForm.email.trim() || !createForm.phone.trim() || !createForm.address.trim() || !createForm.postCode.trim()) {
      const message = 'Company name, name, email, phone, address and post code are required';
      logClientError(message, 'contractors', 'create');
      setError(message);
      return;
    }

    try {
      const body: Record<string, unknown> = {
        companyName: createForm.companyName.trim(),
        name: createForm.name.trim(),
        email: createForm.email.trim(),
        phone: createForm.phone.trim(),
        address: createForm.address.trim(),
        postCode: createForm.postCode.trim(),
        type: createForm.type,
      };
      if (createForm.description.trim()) {
        body.description = createForm.description.trim();
      }

      const res = await apiFetch('/api/dashboard/admin/contractors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to create contractor');
      }

      setCreateModalOpen(false);
      fetchData();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create contractor';
      console.error('Failed to create contractor:', err);
      logClientError(message, 'contractors', 'create');
      setError(message);
    }
  };

  // Handle edit contractor
  const handleEditContractor = async () => {
    if (!selectedContractor) return;

    try {
      const body: Record<string, unknown> = {
        companyName: editForm.companyName.trim(),
        name: editForm.name.trim(),
        email: editForm.email.trim(),
        phone: editForm.phone.trim(),
        address: editForm.address.trim(),
        postCode: editForm.postCode.trim(),
        type: editForm.type,
        description: editForm.description.trim(),
      };

      const res = await apiFetch(`/api/dashboard/admin/contractors/${selectedContractor.contractorId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to update contractor');
      }

      setEditModalOpen(false);
      fetchData();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update contractor';
      console.error('Failed to update contractor:', err);
      logClientError(message, 'contractors', 'update');
      setError(message);
    }
  };

  // Handle delete contractor
  const handleDeleteContractor = async () => {
    if (!selectedContractor) return;

    try {
      const res = await apiFetch(`/api/dashboard/admin/contractors/${selectedContractor.contractorId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete contractor');
      }
      setDeleteModalOpen(false);
      fetchData();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete contractor';
      console.error('Failed to delete contractor:', err);
      logClientError(message, 'contractors', 'delete');
      setError(message);
    }
  };

  const label = (c: Contractor) => `${c.name} (${c.companyName})`;

  const columns = [
    { key: 'contractor', label: 'Contractor', render: (c: Contractor) => (
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-medium" style={{ backgroundColor: 'var(--color-navy-850)', color: '#fff' }}>
          {c.name.charAt(0).toUpperCase()}
        </div>
        <div>
          <div className="font-medium" style={{ color: 'var(--color-navy-850)' }}>{c.name}</div>
          <div className="text-xs text-slate-500">{c.companyName}</div>
        </div>
      </div>
    )},
    { key: 'contact', label: 'Contact', render: (c: Contractor) => (
      <div className="flex flex-col gap-0.5">
        <span style={{ color: 'var(--color-navy-850)' }}>{c.email}</span>
        <span className="text-xs text-slate-500">{c.phone}</span>
      </div>
    )},
    { key: 'type', label: 'Type', render: (c: Contractor) => (
      <span style={{ color: 'var(--color-navy-850)' }}>{TYPE_LABELS[c.type] || c.type}</span>
    )},
    { key: 'address', label: 'Address', render: (c: Contractor) => (
      <div>
        <div className="font-medium" style={{ color: 'var(--color-navy-850)' }}>{c.address}</div>
        <div className="text-xs text-slate-500">{c.postCode}</div>
      </div>
    )},
    { key: 'actions', label: 'Actions', render: (c: Contractor) => (
      <div className="flex items-center gap-1">
        <button
          onClick={() => { setSelectedContractor(c); setDetailModalOpen(true); }}
          title={`View ${label(c)}`}
          className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-navy-850 transition-colors"
          aria-label={`View ${label(c)}`}
        >
          <Eye className="h-4 w-4" />
        </button>
        <button
          onClick={() => {
            setSelectedContractor(c);
            setEditForm({ companyName: c.companyName, name: c.name, email: c.email, phone: c.phone, address: c.address, postCode: c.postCode, type: c.type, description: c.description || '' });
            setEditModalOpen(true);
          }}
          title={`Edit ${label(c)}`}
          className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-navy-850 transition-colors"
          aria-label={`Edit ${label(c)}`}
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          onClick={() => { setSelectedContractor(c); setDeleteModalOpen(true); }}
          title={`Delete ${label(c)}`}
          className="rounded p-1.5 text-slate-500 hover:bg-danger-tint hover:text-danger-ink transition-colors"
          aria-label={`Delete ${label(c)}`}
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

      {/* Stat Cards — one tile per contractor type, wrapping to fit container width.
          Color cycle matches the Units page tiles (default → warning → success). */}
      <div className="mb-6 grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
        {(() => {
          const colorCycle = ['default', 'warning', 'success'] as const;
          const tiles = [
            { key: 'TOTAL', label: 'Total Contractors', value: counts.totalCount },
            ...CONTRACTOR_TYPE_OPTIONS.map(([type, label]) => ({
              key: type,
              label,
              value: counts.types?.[type] ?? 0,
            })),
          ];
          return tiles.map((tile, i) => (
            <StatCard key={tile.key} label={tile.label} value={tile.value} color={colorCycle[i % colorCycle.length]} />
          ));
        })()}
      </div>

      {/* Page Header */}
      <PageHeader title="" description="Manage contractors" primaryAction={<button
          onClick={() => setCreateModalOpen(true)}
          className="w-full sm:w-auto rounded px-4 py-2 text-center text-sm font-medium text-accent-ink transition-colors hover:opacity-90"
          style={{ backgroundColor: 'var(--color-accent)' }}
        >
          + Create Contractor
        </button>} />

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchBar value={search} onChange={setSearch} placeholder="Search contractors by name, company, email, phone or address..." aria-label="Search contractors" />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded border px-3 py-2 text-sm bg-white hover:bg-slate-50 transition-colors focus:outline-none"
          style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
          aria-label="Filter by contractor type"
        >
          <option value="">All Types</option>
          {CONTRACTOR_TYPE_OPTIONS.map(([value, labelText]) => (
            <option key={value} value={value}>{labelText}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <DataTable<Contractor> columns={columns} data={contractors} loading={loading} emptyMessage="No contractors found" />

      {/* Pagination */}
      <PaginationControls
        currentPage={pagination.page}
        totalPages={pagination.totalPages}
        totalItems={pagination.total}
        pageSize={pagination.pageSize}
        onPageChange={(page) => setPagination((p) => ({ ...p, page }))}
      />

      {/* Contractor Detail Modal */}
      <Modal isOpen={detailModalOpen} onClose={() => setDetailModalOpen(false)} title="Contractor Details" size="md">
        {selectedContractor && (
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium" style={{ color: 'var(--color-slate-500)' }}>Name</label>
              <p className="mt-1" style={{ color: 'var(--color-navy-850)' }}>{selectedContractor.name}</p>
            </div>
            <div>
              <label className="text-sm font-medium" style={{ color: 'var(--color-slate-500)' }}>Company</label>
              <p className="mt-1" style={{ color: 'var(--color-navy-850)' }}>{selectedContractor.companyName}</p>
            </div>
            <div className="flex gap-4">
              <div>
                <label className="text-sm font-medium" style={{ color: 'var(--color-slate-500)' }}>Email</label>
                <p className="mt-1" style={{ color: 'var(--color-navy-850)' }}>{selectedContractor.email}</p>
              </div>
              <div>
                <label className="text-sm font-medium" style={{ color: 'var(--color-slate-500)' }}>Phone</label>
                <p className="mt-1" style={{ color: 'var(--color-navy-850)' }}>{selectedContractor.phone}</p>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium" style={{ color: 'var(--color-slate-500)' }}>Address</label>
              <p className="mt-1" style={{ color: 'var(--color-navy-850)' }}>{selectedContractor.address}, {selectedContractor.postCode}</p>
            </div>
            <div className="flex gap-4">
              <div>
                <label className="text-sm font-medium" style={{ color: 'var(--color-slate-500)' }}>Type</label>
                <p className="mt-1" style={{ color: 'var(--color-navy-850)' }}>{TYPE_LABELS[selectedContractor.type] || selectedContractor.type}</p>
              </div>
              <div>
                <label className="text-sm font-medium" style={{ color: 'var(--color-slate-500)' }}>Added</label>
                <p className="mt-1" style={{ color: 'var(--color-navy-850)' }}>{new Date(selectedContractor.createdAt).toLocaleDateString()}</p>
              </div>
            </div>
            {selectedContractor.description && (
              <div>
                <label className="text-sm font-medium" style={{ color: 'var(--color-slate-500)' }}>Description</label>
                <p className="mt-1 whitespace-pre-wrap" style={{ color: 'var(--color-navy-850)' }}>{selectedContractor.description}</p>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Delete Confirm Dialog */}
      <ConfirmDialog
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        onConfirm={handleDeleteContractor}
        title="Delete Contractor"
        message={`Are you sure you want to delete ${selectedContractor ? label(selectedContractor) : 'this contractor'}? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
      />

      {/* Create Contractor Modal */}
      <Modal isOpen={createModalOpen} onClose={() => setCreateModalOpen(false)} title="Create Contractor" size="md">
        <div className="space-y-4">
          <div>
            <label htmlFor="create-name" className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-navy-850)' }}>Name</label>
            <input
              id="create-name"
              type="text"
              value={createForm.name}
              onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full rounded border px-3 py-2 text-sm focus:outline-none"
              style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
              placeholder="Contractor name"
            />
          </div>
          <div>
            <label htmlFor="create-company" className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-navy-850)' }}>Company</label>
            <input
              id="create-company"
              type="text"
              value={createForm.companyName}
              onChange={(e) => setCreateForm((f) => ({ ...f, companyName: e.target.value }))}
              className="w-full rounded border px-3 py-2 text-sm focus:outline-none"
              style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
              placeholder="Company name"
            />
          </div>
          <div className="flex gap-4">
            <div>
              <label htmlFor="create-email" className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-navy-850)' }}>Email</label>
              <input
                id="create-email"
                type="email"
                value={createForm.email}
                onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
                className="w-full rounded border px-3 py-2 text-sm focus:outline-none"
                style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
                placeholder="e.g. jobs@example.com"
              />
            </div>
            <div>
              <label htmlFor="create-phone" className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-navy-850)' }}>Phone</label>
              <input
                id="create-phone"
                type="tel"
                value={createForm.phone}
                onChange={(e) => setCreateForm((f) => ({ ...f, phone: e.target.value }))}
                className="w-full rounded border px-3 py-2 text-sm focus:outline-none"
                style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
                placeholder="e.g. +44 28 9123 4567"
              />
            </div>
          </div>
          <div className="flex gap-4">
            <div className="flex-1">
              <label htmlFor="create-address" className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-navy-850)' }}>Address</label>
              <input
                id="create-address"
                type="text"
                value={createForm.address}
                onChange={(e) => setCreateForm((f) => ({ ...f, address: e.target.value }))}
                className="w-full rounded border px-3 py-2 text-sm focus:outline-none"
                style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
                placeholder="Business address"
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
                placeholder="BT1 2AB"
              />
            </div>
          </div>
          <div className="flex gap-4">
            <div className="flex-1">
              <label htmlFor="create-type" className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-navy-850)' }}>Type</label>
              <select
                id="create-type"
                value={createForm.type}
                onChange={(e) => setCreateForm((f) => ({ ...f, type: e.target.value as ContractorType }))}
                className="w-full rounded border px-3 py-2 text-sm bg-white focus:outline-none"
                style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
              >
                {CONTRACTOR_TYPE_OPTIONS.map(([value, labelText]) => (
                  <option key={value} value={value}>{labelText}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="create-description" className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-navy-850)' }}>Description (optional)</label>
            <textarea
              id="create-description"
              value={createForm.description}
              onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))}
              className="w-full rounded border px-3 py-2 text-sm focus:outline-none"
              style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
              rows={3}
              placeholder="Notable services, qualifications, notes..."
            />
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
              onClick={handleCreateContractor}
              disabled={!createForm.name.trim() || !createForm.email.trim()}
              className="rounded px-4 py-2 text-sm font-medium text-accent-ink transition-colors hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: 'var(--color-accent)' }}
            >
              Create Contractor
            </button>
          </div>
        </div>
      </Modal>

      {/* Edit Contractor Modal */}
      <Modal isOpen={editModalOpen} onClose={() => setEditModalOpen(false)} title="Edit Contractor" size="md">
        {selectedContractor && (
          <div className="space-y-4">
            <div>
              <label htmlFor="edit-name" className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-slate-500)' }}>Name</label>
              <input
                id="edit-name"
                type="text"
                value={editForm.name}
                onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full rounded border px-3 py-2 text-sm focus:outline-none"
                style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
              />
            </div>
            <div>
              <label htmlFor="edit-company" className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-slate-500)' }}>Company</label>
              <input
                id="edit-company"
                type="text"
                value={editForm.companyName}
                onChange={(e) => setEditForm((f) => ({ ...f, companyName: e.target.value }))}
                className="w-full rounded border px-3 py-2 text-sm focus:outline-none"
                style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
              />
            </div>
            <div className="flex gap-4">
              <div>
                <label htmlFor="edit-email" className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-slate-500)' }}>Email</label>
                <input
                  id="edit-email"
                  type="email"
                  value={editForm.email}
                  onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                  className="w-full rounded border px-3 py-2 text-sm focus:outline-none"
                  style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
                />
              </div>
              <div>
                <label htmlFor="edit-phone" className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-slate-500)' }}>Phone</label>
                <input
                  id="edit-phone"
                  type="tel"
                  value={editForm.phone}
                  onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))}
                  className="w-full rounded border px-3 py-2 text-sm focus:outline-none"
                  style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
                />
              </div>
            </div>
            <div className="flex gap-4">
              <div className="flex-1">
                <label htmlFor="edit-address" className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-slate-500)' }}>Address</label>
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
                <label htmlFor="edit-postcode" className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-slate-500)' }}>Post Code</label>
                <input
                  id="edit-postcode"
                  type="text"
                  value={editForm.postCode}
                  onChange={(e) => setEditForm((f) => ({ ...f, postCode: e.target.value }))}
                  className="w-full rounded border px-3 py-2 text-sm focus:outline-none"
                  style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
                />
              </div>
            </div>
            <div className="flex gap-4">
              <div className="flex-1">
                <label htmlFor="edit-type" className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-slate-500)' }}>Type</label>
                <select
                  id="edit-type"
                  value={editForm.type}
                  onChange={(e) => setEditForm((f) => ({ ...f, type: e.target.value as ContractorType }))}
                  className="w-full rounded border px-3 py-2 text-sm bg-white focus:outline-none"
                  style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
                >
                  {CONTRACTOR_TYPE_OPTIONS.map(([value, labelText]) => (
                    <option key={value} value={value}>{labelText}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label htmlFor="edit-description" className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-slate-500)' }}>Description (optional)</label>
              <textarea
                id="edit-description"
                value={editForm.description}
                onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                className="w-full rounded border px-3 py-2 text-sm focus:outline-none"
                style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
                rows={3}
              />
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
                onClick={handleEditContractor}
                disabled={!editForm.name.trim() || !editForm.email.trim()}
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
