'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { RequireSuperAdmin } from '@/components/auth/RequireSuperAdmin';

interface RolePermissionGrid {
  roleId: string;
  roleName: string;
  isDefault: boolean;
  permissions: Array<{ key: string; resource: string; action: string; assigned: boolean }>;
}

interface OrgInfo {
  id: string;
  name: string;
  slug: string | null;
}

export default function TenantPermissionsPage({ params }: { params: Promise<{ orgId: string }> }) {
  const [orgInfo, setOrgInfo] = useState<OrgInfo | null>(null);
  const [grid, setGrid] = useState<RolePermissionGrid[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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

      // Fetch permissions grid
      const res = await fetch(`/api/admin/organizations/${resolvedParams.orgId}/permissions`);
      if (res.ok) {
        const data = await res.json();
        setGrid(data.roles || []);
      }
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleTogglePermission(roleId: string, permissionKey: string) {
    // Optimistic update
    setGrid((prev) =>
      prev.map((role) =>
        role.roleId === roleId
          ? {
              ...role,
              permissions: role.permissions.map((p) =>
                p.key === permissionKey ? { ...p, assigned: !p.assigned } : p
              ),
            }
          : role
      )
    );

    setSaving(true);
    try {
      const resolvedParams = await params;
      const res = await fetch(`/api/admin/organizations/${resolvedParams.orgId}/permissions`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignments: [
            { roleId, permissionKey, assign: !grid.find((r) => r.roleId === roleId)?.permissions.find((p) => p.key === permissionKey)?.assigned },
          ],
        }),
      });

      if (!res.ok) {
        // Revert on failure
        loadData();
      }
    } catch (error) {
      console.error('Failed to update permission:', error);
      loadData();
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveAll() {
    setSaving(true);
    try {
      const resolvedParams = await params;

      // Collect all changed assignments
      const assignments: Array<{ roleId: string; permissionKey: string; assign: boolean }> = [];
      for (const role of grid) {
        for (const perm of role.permissions) {
          assignments.push({ roleId: role.roleId, permissionKey: perm.key, assign: perm.assigned });
        }
      }

      const res = await fetch(`/api/admin/organizations/${resolvedParams.orgId}/permissions`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignments }),
      });

      if (!res.ok) {
        loadData();
      } else {
        // Refresh to get server state
        await loadData();
      }
    } catch (error) {
      console.error('Failed to save permissions:', error);
      loadData();
    } finally {
      setSaving(false);
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

  // Group permissions by resource for display
  const resources = Array.from(new Set(grid.flatMap((r) => r.permissions.map((p) => p.resource))));

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
                {orgInfo?.name} — Permissions
              </h2>
              <p className="text-sm text-gray-500">Assign permissions to roles</p>
            </div>
          </div>

          {/* Permissions Grid */}
          <div className="overflow-x-auto rounded border border-gray-200">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: '#1B2A4A' }} className="text-left text-white">
                  <th className="px-4 py-3 font-medium" style={{ minWidth: '160px' }}>Role</th>
                  {resources.map((resource) => (
                    <th key={resource} className="px-4 py-3 font-medium" style={{ minWidth: '120px' }}>
                      {resource}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {grid.map((role) => (
                  <tr key={role.roleId} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">
                      {role.roleName}
                      {role.isDefault && (
                        <span className="ml-2 rounded-full px-1.5 py-0.5 text-xs" style={{ backgroundColor: '#E8E8E8', color: '#666' }}>
                          Default
                        </span>
                      )}
                    </td>
                    {resources.map((resource) => {
                      const resourcePerms = role.permissions.filter((p) => p.resource === resource);
                      return (
                        <td key={resource} className="px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            {resourcePerms.map((perm) => (
                              <label key={perm.key} className="flex items-center gap-1 text-xs">
                                <input
                                  type="checkbox"
                                  checked={perm.assigned}
                                  disabled={role.isDefault}
                                  onChange={() => handleTogglePermission(role.roleId, perm.key)}
                                  className="rounded border-gray-300 text-[#F5A623] focus:ring-[#F5A623]"
                                />
                                <span className="text-gray-600">{perm.action}</span>
                              </label>
                            ))}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Save Button */}
          <div className="mt-4 flex justify-end">
            <button
              onClick={handleSaveAll}
              disabled={saving}
              className="rounded px-6 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: '#F5A623' }}
            >
              {saving ? 'Saving...' : 'Save All Changes'}
            </button>
          </div>
        </main>
      </div>
    </RequireSuperAdmin>
  );
}
