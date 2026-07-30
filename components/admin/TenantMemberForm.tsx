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
    <div className="mb-6 rounded-lg border border-gray-200 p-4" style={{ backgroundColor: '#FAFAF9' }}>
      <h3 className="mb-3 text-sm font-semibold" style={{ color: '#1B2A4A' }}>Add New Member</h3>
      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="member-email" className="mb-1 block text-xs font-medium text-gray-600">
            Email Address
          </label>
          <input
            id="member-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="user@example.com"
            className="w-64 rounded border border-gray-300 px-3 py-2 text-sm focus:border-[#F5A623] focus:outline-none"
            required
          />
        </div>

        <div>
          <label htmlFor="member-role" className="mb-1 block text-xs font-medium text-gray-600">
            Role
          </label>
          <select
            id="member-role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="rounded border border-gray-300 px-3 py-2 text-sm focus:border-[#F5A623] focus:outline-none"
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
          className="rounded px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
          style={{ backgroundColor: '#F5A623' }}
        >
          {submitting ? 'Adding...' : 'Add Member'}
        </button>

        <button
          type="button"
          onClick={onCancel}
          className="rounded px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800"
        >
          Cancel
        </button>
      </form>
    </div>
  );
}
