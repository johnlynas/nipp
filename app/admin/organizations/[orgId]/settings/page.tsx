'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { RequireSuperAdmin } from '@/components/auth/RequireSuperAdmin';

interface OrgInfo {
  id: string;
  name: string;
  slug: string | null;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
}

export default function TenantSettingsPage({ params }: { params: Promise<{ orgId: string }> }) {
  const [orgInfo, setOrgInfo] = useState<OrgInfo | null>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [status, setStatus] = useState<'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED'>('ACTIVE');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, [params]);

  async function loadData() {
    setLoading(true);
    try {
      const resolvedParams = await params;

      // Fetch org info from the existing detail endpoint
      const res = await fetch(`/api/admin/organizations/${resolvedParams.orgId}`);
      if (res.ok) {
        const data = await res.json();
        setOrgInfo({ id: data.id, name: data.name, slug: data.slug || '', status: data.status });
        setName(data.name);
        setSlug(data.slug || '');
        setStatus(data.status);
      }
    } catch (error) {
      console.error('Failed to load org info:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);

    const changes: string[] = [];
    if (name !== orgInfo?.name) changes.push('name');
    if (slug !== orgInfo?.slug) changes.push('slug');
    if (status !== orgInfo?.status) changes.push('status');

    // Nothing changed
    if (changes.length === 0) {
      setMessage('No changes to save.');
      return;
    }

    // Confirm destructive actions
    if ((status === 'SUSPENDED' || status === 'ARCHIVED') && status !== orgInfo?.status) {
      const action = status === 'SUSPENDED' ? 'suspend' : 'archive';
      if (!confirm(`Are you sure you want to ${action} this organization? This action cannot be easily undone.`)) {
        return;
      }
    }

    setSaving(true);
    try {
      const resolvedParams = await params;
      const res = await fetch(`/api/admin/organizations/${resolvedParams.orgId}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, slug, status }),
      });

      if (res.ok) {
        setMessage('Organization updated successfully.');
        // Refresh org info
        const data = await res.json();
        setOrgInfo(data.organization);
      } else {
        const data = await res.json();
        setMessage(data.error || 'Failed to update organization.');
      }
    } catch (error) {
      console.error('Failed to update settings:', error);
      setMessage('An unexpected error occurred.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <RequireSuperAdmin>
        <div className="flex items-center justify-center py-12">
          <p className="text-gray-500">Loading...</p>
        </div>
      </RequireSuperAdmin>
    );
  }

  return (
    <RequireSuperAdmin>
      <div className="min-h-screen">
        <main className="p-6">
          {/* Back link */}
          <div className="mb-4">
            <Link
              href="/admin/organizations"
              className="text-sm text-gray-500 hover:text-[#F5A623]"
            >
              ← Back to Organizations
            </Link>
          </div>

          {/* Page Header */}
          <div className="mb-6">
            <h2 className="text-2xl font-bold" style={{ color: '#1B2A4A' }}>
              {orgInfo?.name} — Settings
            </h2>
            <p className="text-sm text-gray-500">Modify organization configuration</p>
          </div>

          {/* Success/Error Message */}
          {message && (
            <div className="mb-4 rounded border px-4 py-2 text-sm" style={{
              backgroundColor: message.startsWith('Failed') || message.startsWith('No changes') ? '#FEF2F2' : '#F0FDF4',
              borderColor: message.startsWith('Failed') || message.startsWith('No changes') ? '#FECACA' : '#BBF7D0',
              color: message.startsWith('Failed') || message.startsWith('No changes') ? '#DC2626' : '#15803D',
            }}>
              {message}
            </div>
          )}

          {/* Settings Form */}
          <form onSubmit={handleSave} className="max-w-lg space-y-4">
            {/* Name */}
            <div>
              <label htmlFor="org-name" className="mb-1 block text-sm font-medium text-gray-700">
                Name
              </label>
              <input
                id="org-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-[#F5A623] focus:outline-none"
                required
              />
            </div>

            {/* Slug */}
            <div>
              <label htmlFor="org-slug" className="mb-1 block text-sm font-medium text-gray-700">
                Slug
              </label>
              <input
                id="org-slug"
                type="text"
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''))}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-[#F5A623] focus:outline-none"
                placeholder="auto-generated-from-name"
              />
            </div>

            {/* Status */}
            <div>
              <label htmlFor="org-status" className="mb-1 block text-sm font-medium text-gray-700">
                Status
              </label>
              <select
                id="org-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as OrgInfo['status'])}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-[#F5A623] focus:outline-none"
              >
                <option value="PENDING">Pending</option>
                <option value="ACTIVE">Active</option>
                <option value="SUSPENDED">Suspended</option>
                <option value="ARCHIVED">Archived</option>
              </select>
            </div>

            {/* Save Button */}
            <button
              type="submit"
              disabled={saving}
              className="rounded px-6 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: '#F5A623' }}
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </form>
        </main>
      </div>
    </RequireSuperAdmin>
  );
}
