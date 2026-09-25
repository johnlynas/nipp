'use client';

import { useState } from 'react';

interface TenantMemberFormProps {
  onSubmit: (formData: { email: string; role: string }) => Promise<void>;
  onCancel: () => void;
}

export function TenantMemberForm({ onSubmit, onCancel }: TenantMemberFormProps) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;

    setSubmitting(true);
    try {
      await onSubmit({ email: email.trim(), role });
      setEmail('');
      setRole('member');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mb-6 rounded-lg border border-slate-200 p-4" style={{ backgroundColor: '#FAFAF9' }}>
      <h3 className="mb-3 text-sm font-semibold" style={{ color: 'var(--color-navy-850)' }}>Add New Member</h3>
      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="member-email" className="mb-1 block text-xs font-medium text-slate-600">
            Email Address
          </label>
          <input
            id="member-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="user@example.com"
            className="w-64 rounded border border-slate-300 px-3 py-2 text-sm focus:border-accent focus:outline-none"
            required
          />
        </div>

        <div>
          <label htmlFor="member-role" className="mb-1 block text-xs font-medium text-slate-600">
            Role
          </label>
          <select
            id="member-role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="rounded border border-slate-300 px-3 py-2 text-sm focus:border-accent focus:outline-none"
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
            <option value="property-manager">Property Manager</option>
            <option value="viewer">Viewer</option>
          </select>
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="rounded px-4 py-2 text-sm font-medium text-accent-ink transition hover:opacity-90 disabled:opacity-50"
          style={{ backgroundColor: 'var(--color-accent)' }}
        >
          {submitting ? 'Adding...' : 'Add Member'}
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
