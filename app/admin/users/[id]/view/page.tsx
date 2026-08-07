'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { Pencil } from 'lucide-react';
import { encryptedFetch } from '@/lib/api-client';

interface User {
  id: string;
  name?: string | null;
  email: string;
  _count?: { members: number };
  createdAt: string | Date;
}

export default function ViewUserPage() {
  const router = useRouter();
  const params = useParams();
  const userId = params.id as string;

  const [user, setUser] = useState<User | null>(null);
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
      setUser({
        id: userData.id,
        name: userData.name,
        email: userData.email,
        _count: userData._count || { members: 0 },
        createdAt: userData.createdAt,
      });
    } catch (err) {
      console.error('Failed to fetch user:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch user');
    } finally {
      setLoading(false);
    }
  }

  const formatDate = (date: string | Date) => {
    return new Date(date).toLocaleDateString('en-GB', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  if (loading) {
    return (
      <div className="flex-1 p-8">
        <p className="py-8 text-center">Loading...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex-1 p-8">
        <p className="py-8 text-center text-red-600">User not found.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 p-8">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <Link href="/admin/users" className="text-sm text-gray-500 hover:text-gray-700 transition-colors">
            ← Back to Users
          </Link>
          <div className="flex gap-2">
            <Link href={`/admin/users/${user.id}/edit`} className="text-amber-600 hover:text-amber-800 transition-colors p-2 rounded hover:bg-gray-100" title="Edit">
              <Pencil className="w-4 h-4" />
            </Link>
          </div>
        </div>

        {/* Detail Card */}
        <div className="bg-white rounded-lg shadow-md border border-gray-200">
          <div className="p-8 space-y-6">
            <div>
              <h1 className="text-xl font-bold" style={{ color: '#1B2A4A' }}>User Details</h1>
              <p className="text-sm text-gray-500 mt-1">View user information</p>
            </div>

            {error && (
              <div className="rounded border bg-red-50 p-3 text-sm text-red-700" role="alert">
                {error}
              </div>
            )}

            {/* Name */}
            <div className="flex items-start gap-4">
              <span className="text-sm font-semibold text-gray-900 min-w-[120px]">Name:</span>
              <span className="text-sm text-gray-700">{user.name || '—'}</span>
            </div>

            {/* Email */}
            <div className="flex items-start gap-4">
              <span className="text-sm font-semibold text-gray-900 min-w-[120px]">Email:</span>
              <span className="text-sm text-gray-700">{user.email}</span>
            </div>

            {/* Memberships */}
            <div className="flex items-start gap-4">
              <span className="text-sm font-semibold text-gray-900 min-w-[120px]">Memberships:</span>
              <span className="text-sm text-gray-700">{user._count?.members ?? 0}</span>
            </div>

            {/* Created At */}
            <div className="flex items-start gap-4">
              <span className="text-sm font-semibold text-gray-900 min-w-[120px]">Created At:</span>
              <span className="text-sm text-gray-700">{formatDate(user.createdAt)}</span>
            </div>

            {/* Actions */}
            <div className="flex justify-end pt-4">
              <Link href="/admin/users" className="rounded px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100 border border-gray-300">
                Close
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
