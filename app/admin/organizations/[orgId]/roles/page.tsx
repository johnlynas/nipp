'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { RequireSuperAdmin } from '@/components/auth/RequireSuperAdmin';
import { TenantRoleForm } from '@/components/admin/TenantRoleForm';

interface Role {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  _count: { memberRoles: number };
}

interface OrgInfo {
  id: string;
  name: string;
  slug: string | null;
}

export default function TenantRolesPage({ params }: { params: Promise<{ orgId: string }> }) {
  const [orgInfo, setOrgInfo] = useState<OrgInfo | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    loadData();
  }, [params]);

  async function loadData() {
    setLoading(true);
    try {
      const resolvedParams = await params;

      // Fetch org info
      const orgRes = await fetch(`/api/admin/organizations/${resolvedParams.orgId}`);
      if (orgRes.ok) {
        const orgData = await orgRes.json();
        setOrgInfo({ id: orgData.id, name: orgData.name, slug: orgData.slug });
      }

      // Fetch roles
      const res = await fetch(`/api/admin/organizations/${resolvedParams.orgId}/roles`);
      if (res.ok) {
        const data = await res.json();
        setRoles(data.roles || []);
      }
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateRole(formData: { name: string; description: string }) {
    try {
      const resolvedParams = await params;
      const res = await fetch(`/api/admin/organizations/${resolvedParams.orgId}/roles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (res.ok) {
        setShowForm(false);
        loadData();
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to create role');
      }
    } catch (error) {
      console.error('Failed to create role:', error);
    }
  }

  async function handleDeleteRole(roleId: string, roleName: string) {
    if (!confirm(`Are you sure you want to delete "${roleName}"?`)) return;

    try {
      const resolvedParams = await params;
      const res = await fetch(`/api/admin/organizations/${resolvedParams.orgId}/roles/${roleId}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        loadData();
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to delete role');
      }
    } catch (error) {
      console.error('Failed to delete role:', error);
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
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold" style={{ color: '#1B2A4A' }}>
                {orgInfo?.name} — Roles
              </h2>
              <p className="text-sm text-gray-500">Manage roles and permissions</p>
            </div>
            <button
              onClick={() => setShowForm(true)}
              className="rounded px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
              style={{ backgroundColor: '#F5A623' }}
            >
              + Create Role
            </button>
          </div>

          {/* Create Role Form */}
          {showForm && (
            <TenantRoleForm
              onSubmit={handleCreateRole}
              onCancel={() => setShowForm(false)}
            />
          )}

          {/* Roles Table */}
          <div className="overflow-x-auto rounded border border-gray-200">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: '#1B2A4A' }} className="text-left text-white">
                  <th className="px-4 py-3 font-medium">Role Name</th>
                  <th className="px-4 py-3 font-medium">Default</th>
                  <th className="px-4 py-3 font-medium">Members</th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {roles.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                      No roles found. Create a role to get started.
                    </td>
                  </tr>
                ) : (
                  roles.map((role) => (
                    <tr key={role.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium">{role.name}</td>
                      <td className="px-4 py-3">
                        {role.isDefault ? (
                          <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ backgroundColor: '#1B2A4A', color: 'white' }}>
                            ✓
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{role._count.memberRoles}</td>
                      <td className="px-4 py-3">
                        {role.isDefault ? (
                          <span className="text-xs text-gray-400">Protected</span>
                        ) : (
                          <button
                            onClick={() => handleDeleteRole(role.id, role.name)}
                            className="text-sm text-red-500 hover:underline"
                          >
                            ✕
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </main>
      </div>
    </RequireSuperAdmin>
  );
}
