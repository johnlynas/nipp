'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { RequireSuperAdmin } from '@/components/auth/RequireSuperAdmin';
import { TenantMemberForm } from '@/components/admin/TenantMemberForm';
import { encryptedFetch } from '@/lib/api-client';

interface Member {
  id: string;
  role: string;
  createdAt: string;
  user: { id: string; name: string | null; email: string };
  memberRoles: Array<{ role: { name: string; isDefault: boolean } }>;
}

interface OrgInfo {
  id: string;
  name: string;
  slug: string | null;
}

export default function TenantMembersPage({ params }: { params: Promise<{ orgId: string }> }) {
  const [orgInfo, setOrgInfo] = useState<OrgInfo | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingMember, setEditingMember] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, [params]);

  async function loadData() {
    setLoading(true);
    try {
      const resolvedParams = await params;

      // Fetch org info
      const orgRes = await encryptedFetch(`/api/admin/organizations/${resolvedParams.orgId}`, { pii: true });
      if (orgRes.ok) {
        const orgData = await orgRes.json();
        setOrgInfo({ id: orgData.id, name: orgData.name, slug: orgData.slug });
      }

      // Fetch members
      const res = await encryptedFetch(`/api/admin/organizations/${resolvedParams.orgId}/members`, { pii: true });
      if (res.ok) {
        const data = await res.json();
        setMembers(data.members || []);
      }
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleAddMember(formData: { email: string; role: string }) {
    try {
      const resolvedParams = await params;
      const res = await encryptedFetch(`/api/admin/organizations/${resolvedParams.orgId}/members`, {
        method: 'POST',
        pii: true,
        body: JSON.stringify(formData),
      });

      if (res.ok) {
        setShowForm(false);
        loadData();
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to add member');
      }
    } catch (error) {
      console.error('Failed to add member:', error);
    }
  }

  async function handleUpdateRole(memberId: string, role: string) {
    try {
      const resolvedParams = await params;
      const res = await encryptedFetch(`/api/admin/organizations/${resolvedParams.orgId}/members/${memberId}`, {
        method: 'PATCH',
        pii: true,
        body: JSON.stringify({ role }),
      });

      if (res.ok) {
        setEditingMember(null);
        loadData();
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to update role');
      }
    } catch (error) {
      console.error('Failed to update role:', error);
    }
  }

  async function handleDeleteMember(memberId: string) {
    if (!confirm('Are you sure you want to remove this member?')) return;

    try {
      const resolvedParams = await params;
      const res = await encryptedFetch(`/api/admin/organizations/${resolvedParams.orgId}/members/${memberId}`, {
        method: 'DELETE',
        pii: true,
      });

      if (res.ok) {
        loadData();
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to remove member');
      }
    } catch (error) {
      console.error('Failed to remove member:', error);
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
                {orgInfo?.name} — Members
              </h2>
              <p className="text-sm text-gray-500">Manage members of this organization</p>
            </div>
            <button
              onClick={() => setShowForm(true)}
              className="rounded px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
              style={{ backgroundColor: '#F5A623' }}
            >
              + Add Member
            </button>
          </div>

          {/* Add Member Form */}
          {showForm && (
            <TenantMemberForm
              onSubmit={handleAddMember}
              onCancel={() => setShowForm(false)}
            />
          )}

          {/* Members Table */}
          <div className="overflow-x-auto rounded border border-gray-200">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: '#1B2A4A' }} className="text-left text-white">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Role</th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {members.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                      No members found. Add a member to get started.
                    </td>
                  </tr>
                ) : (
                  members.map((member) => (
                    <MemberRow
                      key={member.id}
                      member={member}
                      editing={editingMember === member.id}
                      onEdit={() => setEditingMember(member.id)}
                      onUpdateRole={(role) => handleUpdateRole(member.id, role)}
                      onCancelEdit={() => setEditingMember(null)}
                      onDelete={() => handleDeleteMember(member.id)}
                    />
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

// ---------------------------------------------------------------------------
// Member Row Component
// ---------------------------------------------------------------------------

function MemberRow({
  member,
  editing,
  onEdit,
  onUpdateRole,
  onCancelEdit,
  onDelete,
}: {
  member: Member;
  editing: boolean;
  onEdit: () => void;
  onUpdateRole: (role: string) => void;
  onCancelEdit: () => void;
  onDelete: () => void;
}) {
  const [editRole, setEditRole] = useState(member.role);

  useEffect(() => {
    setEditRole(member.role);
  }, [member.role]);

  if (editing) {
    return (
      <tr className="bg-amber-50">
        <td className="px-4 py-3">{member.user.name || member.user.email}</td>
        <td className="px-4 py-3">{member.user.email}</td>
        <td className="px-4 py-3">
          <select
            value={editRole}
            onChange={(e) => setEditRole(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
            <option value="property-manager">Property Manager</option>
            <option value="viewer">Viewer</option>
          </select>
        </td>
        <td className="px-4 py-3">
          <div className="flex gap-2">
            <button
              onClick={() => { onUpdateRole(editRole); onCancelEdit(); }}
              className="rounded px-2 py-1 text-xs font-medium text-white"
              style={{ backgroundColor: '#F5A623' }}
            >
              Save
            </button>
            <button
              onClick={onCancelEdit}
              className="rounded px-2 py-1 text-xs font-medium text-gray-600 hover:text-gray-800"
            >
              Cancel
            </button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="hover:bg-gray-50">
      <td className="px-4 py-3 font-medium">{member.user.name || member.user.email}</td>
      <td className="px-4 py-3 text-gray-600">{member.user.email}</td>
      <td className="px-4 py-3">
        <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ backgroundColor: '#1B2A4A', color: 'white' }}>
          {member.role}
        </span>
      </td>
      <td className="px-4 py-3">
        <div className="flex gap-2">
          <button
            onClick={onEdit}
            className="text-sm text-[#F5A623] hover:underline"
          >
            ✎
          </button>
          <button
            onClick={onDelete}
            className="text-sm text-red-500 hover:underline"
          >
            ✕
          </button>
        </div>
      </td>
    </tr>
  );
}
