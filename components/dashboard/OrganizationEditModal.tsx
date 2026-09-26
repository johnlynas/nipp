'use client';

import { useState } from 'react';
import { Modal } from '@/components/dashboard/Modal';
import { logClientError } from '@/lib/client-error-logger';

export type OrganizationStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';

interface OrganizationEditModalProps {
  isOpen: boolean;
  org: { id: string; name: string; description?: string | null; status: OrganizationStatus } | null;
  onClose: () => void;
  /** Called after a successful save so the caller can refresh its data. */
  onSaved?: () => void;
}

/**
 * Edit modal for an organization (name, description, status).
 *
 * Status changes go through the /status endpoint so ban/unban side effects
 * fire; name/description use the generic PATCH. Extracted from the admin
 * organizations page so the org-chart right panel can open it in place.
 */
export function OrganizationEditModal({ isOpen, org, onClose, onSaved }: OrganizationEditModalProps) {
  const [saving, setSaving] = useState(false);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Edit Organization" size="md">
      {org && (
        <OrganizationEditForm
          key={`${org.id}-${isOpen ? 'open' : ''}`}
          org={org}
          saving={saving}
          onSaveState={setSaving}
          onCancel={onClose}
          onSaved={() => {
            onClose();
            onSaved?.();
          }}
        />
      )}
    </Modal>
  );
}

function OrganizationEditForm({
  org,
  saving,
  onSaveState,
  onCancel,
  onSaved,
}: {
  org: NonNullable<OrganizationEditModalProps['org']>;
  saving: boolean;
  onSaveState: (v: boolean) => void;
  onCancel: () => void;
  onSaved: () => void;
}) {
  // key=org.id remounts this form for each org, so initializing from props here is safe.
  const [form, setForm] = useState({
    name: org.name,
    description: org.description || '',
    status: org.status as OrganizationStatus,
  });
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    try {
      onSaveState(true);
      setError(null);
      // Status changes delegate to /status so ban/unban logic fires.
      if (form.status && form.status !== org.status) {
        const res = await fetch(`/api/dashboard/admin/organizations/${org.id}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: form.status }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to update organization status');
        }

        const nameChanged = form.name !== org.name;
        const descChanged = (form.description || '') !== (org.description || '');
        if (nameChanged || descChanged) {
          const res2 = await fetch(`/api/dashboard/admin/organizations/${org.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: form.name, description: form.description }),
          });
          if (!res2.ok) {
            const data = await res2.json().catch(() => ({}));
            throw new Error(data.error || 'Failed to update organization details');
          }
        }
      } else {
        const res = await fetch(`/api/dashboard/admin/organizations/${org.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: form.name, description: form.description }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to update organization');
        }
      }

      onSaved();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update organization';
      console.error('Failed to update org:', err);
      logClientError(message, 'organizations', 'update');
      setError(message);
    } finally {
      onSaveState(false);
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="rounded border p-2 text-sm" style={{ borderColor: 'var(--color-danger)', color: 'var(--color-danger)' }}>
          {error}
        </p>
      )}
      <div>
        <label htmlFor="edit-org-name" className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-slate-500)' }}>Name</label>
        <input
          id="edit-org-name"
          type="text"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          className="w-full rounded border px-3 py-2 text-sm focus:outline-none"
          style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
        />
      </div>
      <div>
        <label htmlFor="edit-org-description" className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-slate-500)' }}>Description</label>
        <textarea
          id="edit-org-description"
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          className="w-full rounded border px-3 py-2 text-sm focus:outline-none resize-y"
          style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
          rows={3}
          placeholder="Organization description"
        />
      </div>
      <div>
        <label htmlFor="edit-org-status" className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-slate-500)' }}>Status</label>
        <select
          id="edit-org-status"
          value={form.status}
          onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as OrganizationStatus }))}
          className="w-full rounded border px-3 py-2 text-sm focus:outline-none"
          style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
        >
          <option value="PENDING">Pending</option>
          <option value="ACTIVE">Active</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="ARCHIVED">Archived</option>
        </select>
      </div>
      <div className="flex justify-end gap-3">
        <button
          onClick={onCancel}
          disabled={saving}
          className="rounded border px-4 py-2 text-sm font-medium transition-colors hover:bg-slate-50"
          style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={!form.name.trim() || saving}
          className="rounded px-4 py-2 text-sm font-medium text-accent-ink transition-colors hover:opacity-90 disabled:opacity-50"
          style={{ backgroundColor: 'var(--color-accent)' }}
        >
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}
