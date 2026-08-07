'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { encryptedFetch } from '@/lib/api-client';

export default function DeleteRolePage() {
  const router = useRouter();
  const params = useParams();
  const roleId = params.id as string;

  const [roleName, setRoleName] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchRole(roleId);
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
      // API returns { role: {...} }
      const roleData = data.role || data;
      setRoleName(roleData.name);
    } catch (err) {
      console.error('Failed to fetch role:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch role');
    } finally {
      setLoading(false);
    }
  }

  const handleDelete = async () => {
    setSubmitting(true);
    setError(null);

    try {
      const res = await encryptedFetch(`/api/admin/roles/${roleId}`, { method: 'DELETE', pii: true });
      if (res.ok) {
        router.push('/admin/roles');
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete role');
      }
    } catch (err) {
      console.error('Failed to delete role:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete role');
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

        {/* Delete Confirmation Card */}
        <div className="bg-white rounded-lg shadow-md border border-gray-200">
          <div className="p-8 space-y-6">
            <div>
              <h1 className="text-xl font-bold text-red-600">Delete Role</h1>
              <p className="text-sm text-gray-500 mt-1">This action cannot be undone</p>
            </div>

            {error && (
              <div className="rounded border bg-red-50 p-3 text-sm text-red-700" role="alert">
                {error}
              </div>
            )}

            {/* Warning */}
            <div className="rounded-lg bg-red-50 border border-red-200 p-4">
              <p className="text-sm text-red-800 font-medium mb-2">Warning: This action is permanent</p>
              <p className="text-sm text-red-700">
                Are you sure you want to delete <strong>{roleName}</strong>? This will remove the role and all its associated permissions.
              </p>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-4">
              <Link href="/admin/roles" className="rounded px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100 border border-gray-300">
                Cancel
              </Link>
              <button
                onClick={handleDelete}
                disabled={submitting}
                className="rounded px-5 py-2.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50 bg-red-600"
              >
                {submitting ? 'Deleting...' : 'Delete Role'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
