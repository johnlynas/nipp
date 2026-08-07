'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { Pencil } from 'lucide-react';
import { encryptedFetch } from '@/lib/api-client';

interface Permission {
  id: string;
  key: string;
  resource: string;
  action: string;
  description?: string | null;
}

export default function ViewPermissionPage() {
  const router = useRouter();
  const params = useParams();
  const permId = params.id as string;

  const [permission, setPermission] = useState<Permission | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPermission(permId);
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
      // API returns { permission: {...} }
      const permData = data.permission || data;
      setPermission({
        id: permData.id,
        key: permData.key,
        resource: permData.resource,
        action: permData.action,
        description: permData.description,
      });
    } catch (err) {
      console.error('Failed to fetch permission:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch permission');
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex-1 p-8">
        <p className="py-8 text-center">Loading...</p>
      </div>
    );
  }

  if (!permission) {
    return (
      <div className="flex-1 p-8">
        <p className="py-8 text-center text-red-600">Permission not found.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 p-8">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <Link href="/admin/permissions" className="text-sm text-gray-500 hover:text-gray-700 transition-colors">
            ← Back to Permissions
          </Link>
          <div className="flex gap-2">
            <Link href={`/admin/permissions/${permission.id}/edit`} className="text-amber-600 hover:text-amber-800 transition-colors p-2 rounded hover:bg-gray-100" title="Edit">
              <Pencil className="w-4 h-4" />
            </Link>
          </div>
        </div>

        {/* Detail Card */}
        <div className="bg-white rounded-lg shadow-md border border-gray-200">
          <div className="p-8 space-y-6">
            <div>
              <h1 className="text-xl font-bold" style={{ color: '#1B2A4A' }}>Permission Details</h1>
              <p className="text-sm text-gray-500 mt-1">View permission information</p>
            </div>

            {error && (
              <div className="rounded border bg-red-50 p-3 text-sm text-red-700" role="alert">
                {error}
              </div>
            )}

            {/* Key */}
            <div className="flex items-start gap-4">
              <span className="text-sm font-semibold text-gray-900 min-w-[120px]">Key:</span>
              <code className="text-sm text-gray-700 font-mono">{permission.key}</code>
            </div>

            {/* Resource */}
            <div className="flex items-start gap-4">
              <span className="text-sm font-semibold text-gray-900 min-w-[120px]">Resource:</span>
              <span className="text-sm text-gray-700">{permission.resource}</span>
            </div>

            {/* Action */}
            <div className="flex items-start gap-4">
              <span className="text-sm font-semibold text-gray-900 min-w-[120px]">Action:</span>
              <span className="text-sm text-gray-700">{permission.action}</span>
            </div>

            {/* Description */}
            <div className="flex items-start gap-4">
              <span className="text-sm font-semibold text-gray-900 min-w-[120px]">Description:</span>
              <span className="text-sm text-gray-700">{permission.description || '—'}</span>
            </div>

            {/* Actions */}
            <div className="flex justify-end pt-4">
              <Link href="/admin/permissions" className="rounded px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100 border border-gray-300">
                Close
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
