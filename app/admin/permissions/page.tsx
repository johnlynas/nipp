'use client';

import { useState, useEffect } from 'react';
import { RequireSuperAdmin } from '@/components/auth/RequireSuperAdmin';

interface Permission {
  id: string;
  key: string;
  resource: string;
  action: string;
  description?: string | null;
}

/**
 * Super Admin — Global permission catalog management.
 */
export default function PermissionsPage() {
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newResource, setNewResource] = useState('');
  const [newAction, setNewAction] = useState('');
  const [newDescription, setNewDescription] = useState('');

  useEffect(() => {
    fetchPermissions();
  }, []);

  async function fetchPermissions() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/permissions');
      if (res.ok) {
        const data = await res.json();
        setPermissions(data.permissions || []);
      }
    } catch (error) {
      console.error('Failed to fetch permissions:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    try {
      const res = await fetch('/api/admin/permissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: newKey, resource: newResource, action: newAction, description: newDescription }),
      });

      if (res.ok) {
        setShowCreateForm(false);
        setNewKey('');
        setNewResource('');
        setNewAction('');
        setNewDescription('');
        fetchPermissions();
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to create permission');
      }
    } catch (error) {
      console.error('Failed to create permission:', error);
    }
  }

  return (
    <RequireSuperAdmin>
      <div className="min-h-screen">
        {/* Navy Header */}
        <header className="px-6 py-4" style={{ backgroundColor: '#1B2A4A' }}>
          <h1 className="text-xl font-semibold text-white">Property NI Admin</h1>
        </header>

        <main className="p-6">
          {/* Page Header */}
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold" style={{ color: '#1B2A4A' }}>Permissions</h2>
              <p className="text-sm text-gray-500">Global permission catalog management</p>
            </div>
            <button
              onClick={() => setShowCreateForm(!showCreateForm)}
              className="rounded px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
              style={{ backgroundColor: '#F5A623' }}
            >
              + Add Permission
            </button>
          </div>

          {/* Create Form */}
          {showCreateForm && (
            <form onSubmit={handleCreate} className="mb-6 rounded-lg border p-4" style={{ borderColor: '#1B2A4A' }}>
              <h3 className="mb-3 text-sm font-semibold" style={{ color: '#1B2A4A' }}>New Permission</h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <input type="text" placeholder="key (resource:action)" required value={newKey} onChange={(e) => setNewKey(e.target.value)} className="rounded border px-3 py-2 text-sm" aria-label="Permission key" />
                <input type="text" placeholder="resource" required value={newResource} onChange={(e) => setNewResource(e.target.value)} className="rounded border px-3 py-2 text-sm" aria-label="Resource" />
                <input type="text" placeholder="action" required value={newAction} onChange={(e) => setNewAction(e.target.value)} className="rounded border px-3 py-2 text-sm" aria-label="Action" />
                <input type="text" placeholder="description" value={newDescription} onChange={(e) => setNewDescription(e.target.value)} className="rounded border px-3 py-2 text-sm" aria-label="Description" />
              </div>
              <div className="mt-3 flex gap-2">
                <button type="submit" className="rounded px-4 py-1.5 text-sm font-medium text-white" style={{ backgroundColor: '#F5A623' }}>
                  Create
                </button>
                <button type="button" onClick={() => setShowCreateForm(false)} className="rounded px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100">
                  Cancel
                </button>
              </div>
            </form>
          )}

          {/* Permissions Table */}
          {loading ? (
            <p className="py-8 text-center">Loading...</p>
          ) : (
            <table className="min-w-full divide-y divide-gray-200" role="table">
              <thead className="bg-[#1B2A4A]">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-white" scope="col">Key</th>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-white" scope="col">Resource</th>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-white" scope="col">Action</th>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-white" scope="col">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {permissions.map((perm) => (
                  <tr key={perm.id}>
                    <td className="whitespace-nowrap px-4 py-2 text-sm font-mono" style={{ color: '#1B2A4A' }}>{perm.key}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-sm">{perm.resource}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-sm">{perm.action}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-sm text-gray-500">{perm.description || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </main>
      </div>
    </RequireSuperAdmin>
  );
}
