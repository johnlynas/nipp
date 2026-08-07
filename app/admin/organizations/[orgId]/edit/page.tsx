'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { encryptedFetch } from '@/lib/api-client';

interface Organization {
  id: string;
  name: string;
  slug: string | null;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
}

export default function EditOrganizationPage() {
  const router = useRouter();
  const params = useParams();
  const orgId = params.orgId as string;

  const [formName, setFormName] = useState('');
  const [formSlug, setFormSlug] = useState('');
  const [formStatus, setFormStatus] = useState<'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED'>('ACTIVE');
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchOrganization(orgId);
  }, [orgId]);

  async function fetchOrganization(id: string) {
    setLoading(true);
    try {
      const res = await encryptedFetch(`/api/admin/organizations/${id}`, { pii: true });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to fetch organization');
      }
      const data = await res.json();
      setFormName(data.name);
      setFormSlug(data.slug || '');
      setFormStatus(data.status);
    } catch (err) {
      console.error('Failed to fetch organization:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch organization');
    } finally {
      setLoading(false);
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const body: { name?: string; slug?: string; status?: string } = {};
      if (formName) body.name = formName;
      if (formSlug) body.slug = formSlug;
      if (formStatus) body.status = formStatus;

      const res = await encryptedFetch(`/api/admin/organizations/${orgId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
        pii: true,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to update organization');
      }

      router.push('/admin/organizations');
      router.refresh();
    } catch (err) {
      console.error('Failed to update organization:', err);
      setError(err instanceof Error ? err.message : 'Failed to update organization');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 p-8">
        <p className="py-8 text-center">Loading...</p>
      </div>
    );
  }

  return (
    <div className="flex-1 p-8">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex items-center gap-4">
          <Link href="/admin/organizations" className="text-sm text-gray-500 hover:text-gray-700 transition-colors">
            ← Back to Organizations
          </Link>
        </div>

        {/* Form Card */}
        <div className="bg-white rounded-lg shadow-md border border-gray-200">
          <form onSubmit={handleSubmit} className="p-8 space-y-6">
            <div>
              <h1 className="text-xl font-bold" style={{ color: '#1B2A4A' }}>Edit Organization</h1>
              <p className="text-sm text-gray-500 mt-1">Update organization details</p>
            </div>

            {error && (
              <div className="rounded border bg-red-50 p-3 text-sm text-red-700" role="alert">
                {error}
              </div>
            )}

            {/* Name */}
            <div>
              <label htmlFor="name" className="block text-sm font-semibold text-gray-900 mb-2">
                Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                required
                className="w-full px-4 py-3 border border-gray-300 rounded-md text-gray-900 font-medium text-base focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* Slug */}
            <div>
              <label htmlFor="slug" className="block text-sm font-semibold text-gray-900 mb-2">
                Slug <span className="text-gray-500 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                id="slug"
                value={formSlug}
                onChange={(e) => setFormSlug(e.target.value)}
                placeholder="organization-slug"
                className="w-full px-4 py-3 border border-gray-300 rounded-md text-gray-900 font-medium text-base focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* Status */}
            <div>
              <label htmlFor="status" className="block text-sm font-semibold text-gray-900 mb-2">
                Status <span className="text-red-500">*</span>
              </label>
              <select
                id="status"
                value={formStatus}
                onChange={(e) => setFormStatus(e.target.value as Organization['status'])}
                className="w-full px-4 py-3 border border-gray-300 rounded-md text-gray-900 font-medium text-base focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="PENDING">Pending</option>
                <option value="ACTIVE">Active</option>
                <option value="SUSPENDED">Suspended</option>
                <option value="ARCHIVED">Archived</option>
              </select>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-4">
              <Link href="/admin/organizations" className="rounded px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100 border border-gray-300">
                Cancel
              </Link>
              <button
                type="submit"
                disabled={submitting}
                className="rounded px-5 py-2.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: '#F5A623' }}
              >
                {submitting ? 'Saving...' : 'Update Organization'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
