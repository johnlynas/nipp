'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { encryptedFetch } from '@/lib/api-client';

export default function DeleteUserPage() {
  const router = useRouter();
  const params = useParams();
  const userId = params.id as string;

  const [userName, setUserName] = useState<string>('');
  const [userEmail, setUserEmail] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchUser(userId);
  }, [userId]);

  async function fetchUser(id: string) {
    setLoading(true);
    try {
      const res = await encryptedFetch(`/api/admin/users/${id}`, { pii: true });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to fetch user');
      }
      const data = await res.json();
      // API returns { user: {...} }
      const userData = data.user || data;
      setUserName(userData.name || '');
      setUserEmail(userData.email);
    } catch (err) {
      console.error('Failed to fetch user:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch user');
    } finally {
      setLoading(false);
    }
  }

  const handleDelete = async () => {
    setSubmitting(true);
    setError(null);

    try {
      const res = await encryptedFetch(`/api/admin/users/${userId}`, { method: 'DELETE', pii: true });
      if (res.ok) {
        router.push('/admin/users');
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete user');
      }
    } catch (err) {
      console.error('Failed to delete user:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete user');
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
          <Link href="/admin/users" className="text-sm text-gray-500 hover:text-gray-700 transition-colors">
            ← Back to Users
          </Link>
        </div>

        {/* Delete Confirmation Card */}
        <div className="bg-white rounded-lg shadow-md border border-gray-200">
          <div className="p-8 space-y-6">
            <div>
              <h1 className="text-xl font-bold text-red-600">Delete User</h1>
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
                Are you sure you want to delete <strong>{userName || '—'}</strong> ({userEmail})? This will remove the user and all their memberships.
              </p>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-4">
              <Link href="/admin/users" className="rounded px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100 border border-gray-300">
                Cancel
              </Link>
              <button
                onClick={handleDelete}
                disabled={submitting}
                className="rounded px-5 py-2.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50 bg-red-600"
              >
                {submitting ? 'Deleting...' : 'Delete User'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
