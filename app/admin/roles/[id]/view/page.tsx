'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { Eye, Pencil } from 'lucide-react';
import { encryptedFetch } from '@/lib/api-client';

interface Role {
  id: string;
  name: string;
  description?: string | null;
  isDefault: boolean;
  _count?: { memberRoles: number };
}

export default function ViewRolePage() {
  const router = useRouter();
  const params = useParams();
  const roleId = params.id as string;

  const [role, setRole] = useState<Role | null>(null);
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
      setRole({
        id: roleData.id,
        name: roleData.name,
        description: roleData.description,
        isDefault: roleData.isDefault,
        _count: roleData._count || { memberRoles: 0 },
      });
    } catch (err) {
      console.error('Failed to fetch role:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch role');
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

  if (!role) {
    return (
      <div className="flex-1 p-8">
        <p className="py-8 text-center text-red-600">Role not found.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 p-8">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <Link href="/admin/roles" className="text-sm text-gray-500 hover:text-gray-700 transition-colors">
            ← Back to Roles
          </Link>
          <div className="flex gap-2">
            <Link href={`/admin/roles/${role.id}/edit`} className="text-amber-600 hover:text-amber-800 transition-colors p-2 rounded hover:bg-gray-100" title="Edit">
              <Pencil className="w-4 h-4" />
            </Link>
          </div>
        </div>

        {/* Detail Card */}
        <div className="bg-white rounded-lg shadow-md border border-gray-200">
          <div className="p-8 space-y-6">
            <div>
              <h1 className="text-xl font-bold" style={{ color: '#1B2A4A' }}>Role Details</h1>
              <p className="text-sm text-gray-500 mt-1">View role information</p>
            </div>

            {error && (
              <div className="rounded border bg-red-50 p-3 text-sm text-red-700" role="alert">
                {error}
              </div>
            )}

            {/* Name */}
            <div className="flex items-start gap-4">
              <span className="text-sm font-semibold text-gray-900 min-w-[120px]">Name:</span>
              <span className="text-sm text-gray-700">{role.name}</span>
            </div>

            {/* Description */}
            <div className="flex items-start gap-4">
              <span className="text-sm font-semibold text-gray-900 min-w-[120px]">Description:</span>
              <span className="text-sm text-gray-700">{role.description || '—'}</span>
            </div>

            {/* Is Default */}
            <div className="flex items-start gap-4">
              <span className="text-sm font-semibold text-gray-900 min-w-[120px]">Is Default:</span>
              <span className="text-sm text-gray-700">{role.isDefault ? 'Yes' : 'No'}</span>
            </div>

            {/* Members */}
            <div className="flex items-start gap-4">
              <span className="text-sm font-semibold text-gray-900 min-w-[120px]">Members:</span>
              <span className="text-sm text-gray-700">{role._count?.memberRoles ?? 0}</span>
            </div>

            {/* Actions */}
            <div className="flex justify-end pt-4">
              <Link href="/admin/roles" className="rounded px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100 border border-gray-300">
                Close
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
