'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { encryptedFetch } from '@/lib/api-client';

export default function EditRolePage() {
  const router = useRouter();
  const params = useParams();
  const roleId = params.id as string;

  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formIsDefault, setFormIsDefault] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (roleId) {
      fetchRole(roleId);
    }
  }, [roleId]);

  async function fetchRole(id: string) {
    setLoading(true);
    try {
      const res = await encryptedFetch(`/api/admin/roles/${id}`, { pii: true });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to fetch role');
      }
      const data = await res.json();
      // API returns { role: {...} } — read from the nested property
      const role = data.role || data;
      setFormName(role.name || '');
      setFormDescription(role.description || '');
      setFormIsDefault(!!role.isDefault);
    } catch (err) {
      console.error('Failed to fetch role:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch role');
    } finally {
      setLoading(false);
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const body = { name: formName, description: formDescription || undefined, isDefault: formIsDefault };

      const res = await encryptedFetch(`/api/admin/roles/${roleId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
        pii: true,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to update role');
      }

      router.push('/admin/roles');
      router.refresh();
    } catch (err) {
      console.error('Failed to update role:', err);
      setError(err instanceof Error ? err.message : 'Failed to update role');
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
          <Link href="/admin/roles" className="text-sm text-gray-500 hover:text-gray-700 transition-colors">
            ← Back to Roles
          </Link>
        </div>

        {/* Form Card */}
        <div className="bg-white rounded-lg shadow-md border border-gray-200">
          <form onSubmit={handleSubmit} className="p-8 space-y-6">
            <div>
              <h1 className="text-xl font-bold" style={{ color: '#1B2A4A' }}>Edit Role</h1>
              <p className="text-sm text-gray-500 mt-1">Update role details</p>
            </div>

            {error && (
              <div className="rounded border bg-red-50 p-3 text-sm text-red-700" role="alert">
                {error}
              </div>
            )}

            {/* Role Name */}
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
                placeholder="e.g. Manager"
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
                placeholder="Describe the role"
                className="w-full px-4 py-3 border border-gray-300 rounded-md text-gray-900 font-medium text-base focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* Default Role */}
            <div>
              <label className="flex items-center gap-3 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={formIsDefault}
                  onChange={(e) => setFormIsDefault(e.target.checked)}
                  className="rounded border-gray-300 w-4 h-4"
                />
                Default role (automatically assigned to new users)
              </label>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-4">
              <Link href="/admin/roles" className="rounded px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100 border border-gray-300">
                Cancel
              </Link>
              <button
                type="submit"
                disabled={submitting}
                className="rounded px-5 py-2.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: '#F5A623' }}
              >
                {submitting ? 'Saving...' : 'Update Role'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
