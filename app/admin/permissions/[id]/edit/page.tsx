'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { encryptedFetch } from '@/lib/api-client';

export default function EditPermissionPage() {
  const router = useRouter();
  const params = useParams();
  const permId = params.id as string;

  const [formKey, setFormKey] = useState('');
  const [formResource, setFormResource] = useState('');
  const [formAction, setFormAction] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (permId) {
      fetchPermission(permId);
    }
  }, [permId]);

  async function fetchPermission(id: string) {
    setLoading(true);
    try {
      const res = await encryptedFetch(`/api/admin/permissions/${id}`, { pii: true });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to fetch permission');
      }
      const data = await res.json();
      // API returns { permission: {...} } — read from the nested property
      const perm = data.permission || data;
      setFormKey(perm.key || '');
      setFormResource(perm.resource || '');
      setFormAction(perm.action || '');
      setFormDescription(perm.description || '');
    } catch (err) {
      console.error('Failed to fetch permission:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch permission');
    } finally {
      setLoading(false);
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const body = { key: formKey, resource: formResource, action: formAction, description: formDescription || undefined };

      const res = await encryptedFetch(`/api/admin/permissions/${permId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
        pii: true,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to update permission');
      }

      router.push('/admin/permissions');
      router.refresh();
    } catch (err) {
      console.error('Failed to update permission:', err);
      setError(err instanceof Error ? err.message : 'Failed to update permission');
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
          <Link href="/admin/permissions" className="text-sm text-gray-500 hover:text-gray-700 transition-colors">
            ← Back to Permissions
          </Link>
        </div>

        {/* Form Card */}
        <div className="bg-white rounded-lg shadow-md border border-gray-200">
          <form onSubmit={handleSubmit} className="p-8 space-y-6">
            <div>
              <h1 className="text-xl font-bold" style={{ color: '#1B2A4A' }}>Edit Permission</h1>
              <p className="text-sm text-gray-500 mt-1">Update permission details</p>
            </div>

            {error && (
              <div className="rounded border bg-red-50 p-3 text-sm text-red-700" role="alert">
                {error}
              </div>
            )}

            {/* Key */}
            <div>
              <label htmlFor="key" className="block text-sm font-semibold text-gray-900 mb-2">
                Key <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="key"
                value={formKey}
                onChange={(e) => setFormKey(e.target.value)}
                required
                placeholder="resource:action"
                className="w-full px-4 py-3 border border-gray-300 rounded-md text-gray-900 font-medium text-base focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono"
              />
            </div>

            {/* Resource */}
            <div>
              <label htmlFor="resource" className="block text-sm font-semibold text-gray-900 mb-2">
                Resource <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="resource"
                value={formResource}
                onChange={(e) => setFormResource(e.target.value)}
                required
                placeholder="e.g. organization"
                className="w-full px-4 py-3 border border-gray-300 rounded-md text-gray-900 font-medium text-base focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* Action */}
            <div>
              <label htmlFor="action" className="block text-sm font-semibold text-gray-900 mb-2">
                Action <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="action"
                value={formAction}
                onChange={(e) => setFormAction(e.target.value)}
                required
                placeholder="e.g. manage"
                className="w-full px-4 py-3 border border-gray-300 rounded-md text-gray-900 font-medium text-base focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* Description */}
            <div>
              <label htmlFor="description" className="block text-sm font-semibold text-gray-900 mb-2">
                Description <span className="text-gray-500 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                id="description"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Describe the permission"
                className="w-full px-4 py-3 border border-gray-300 rounded-md text-gray-900 font-medium text-base focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-4">
              <Link href="/admin/permissions" className="rounded px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100 border border-gray-300">
                Cancel
              </Link>
              <button
                type="submit"
                disabled={submitting}
                className="rounded px-5 py-2.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: '#F5A623' }}
              >
                {submitting ? 'Saving...' : 'Update Permission'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
