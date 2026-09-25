'use client';

import { useState } from 'react';

interface TenantRoleFormProps {
  onSubmit: (formData: { name: string; description: string }) => Promise<void>;
  onCancel: () => void;
}

export function TenantRoleForm({ onSubmit, onCancel }: TenantRoleFormProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    setSubmitting(true);
    try {
      await onSubmit({ name: name.trim(), description: description.trim() });
      setName('');
      setDescription('');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mb-6 rounded-lg border border-slate-200 p-4" style={{ backgroundColor: '#FAFAF9' }}>
      <h3 className="mb-3 text-sm font-semibold" style={{ color: 'var(--color-navy-850)' }}>Create New Role</h3>
      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="role-name" className="mb-1 block text-xs font-medium text-slate-600">
            Role Name
          </label>
          <input
            id="role-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Custom Role"
            className="w-48 rounded border border-slate-300 px-3 py-2 text-sm focus:border-accent focus:outline-none"
            required
          />
        </div>

        <div>
          <label htmlFor="role-desc" className="mb-1 block text-xs font-medium text-slate-600">
            Description
          </label>
          <input
            id="role-desc"
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description"
            className="w-64 rounded border border-slate-300 px-3 py-2 text-sm focus:border-accent focus:outline-none"
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="rounded px-4 py-2 text-sm font-medium text-accent-ink transition hover:opacity-90 disabled:opacity-50"
          style={{ backgroundColor: 'var(--color-accent)' }}
        >
          {submitting ? 'Creating...' : 'Create Role'}
        </button>

        <button
          type="button"
          onClick={onCancel}
          className="rounded px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800"
        >
          Cancel
        </button>
      </form>
    </div>
  );
}
