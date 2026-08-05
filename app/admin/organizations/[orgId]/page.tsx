'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { RequireSuperAdmin } from '@/components/auth/RequireSuperAdmin';
import { OrgStatusBadge } from '@/components/admin/OrgStatusBadge';
import { RoleManager } from '@/components/admin/RoleManager';
import { AuditLogViewer } from '@/components/admin/AuditLogViewer';
import { encryptedFetch } from '@/lib/api-client';

type Tab = 'overview' | 'members' | 'roles' | 'audit';

interface OrganizationDetail {
  id: string;
  name: string;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  memberCount: number;
  customRoleCount: number;
}

/**
 * Super Admin — Organization detail view with tabs.
 */
export default function OrganizationDetailPage() {
  const params = useParams();
  const orgId = params.orgId as string;

  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [org, setOrg] = useState<OrganizationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusChanging, setStatusChanging] = useState(false);

  useEffect(() => {
    fetchOrganization();
  }, [orgId]);

  async function fetchOrganization() {
    setLoading(true);
    try {
      const res = await encryptedFetch(`/api/admin/organizations/${orgId}`, { pii: true });
      if (res.ok) {
        const data = await res.json();
        setOrg(data);
      }
    } catch (error) {
      console.error('Failed to fetch organization:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleStatusChange(newStatus: string) {
    setStatusChanging(true);
    try {
      const res = await encryptedFetch(`/api/admin/organizations/${orgId}/status`, {
        method: 'PATCH',
        pii: true,
        body: JSON.stringify({ status: newStatus }),
      });

      if (res.ok) {
        // Optimistically update the UI — avoids stale cache issues from a second fetch
        setOrg((prev) => (prev ? { ...prev, status: newStatus as OrganizationDetail['status'] } : prev));
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to change status');
      }
    } catch (error) {
      console.error('Failed to change status:', error);
    } finally {
      setStatusChanging(false);
    }
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'members', label: 'Members' },
    { key: 'roles', label: 'Roles' },
    { key: 'audit', label: 'Audit' },
  ];

  const externalTabs = [
    { href: `/admin/organizations/${orgId}/members`, label: 'Manage Members' },
    { href: `/admin/organizations/${orgId}/roles`, label: 'Manage Roles' },
    { href: `/admin/organizations/${orgId}/permissions`, label: 'Manage Permissions' },
    { href: `/admin/organizations/${orgId}/settings`, label: 'Settings' },
  ];

  if (loading) return <div className="p-6">Loading...</div>;
  if (!org) return <div className="p-6">Organization not found</div>;

  return (
    <RequireSuperAdmin>
      <div className="min-h-screen">
        <main className="p-6">
          {/* Org Header */}
          <div className="mb-6 flex items-start justify-between">
            <div>
              <h2 className="text-2xl font-bold" style={{ color: '#1B2A4A' }}>{org.name}</h2>
            </div>
            <OrgStatusBadge status={org.status} />
          </div>

          {/* Status Actions */}
          {org.status !== 'ARCHIVED' && (
            <div className="mb-6 flex gap-2">
              {org.status === 'PENDING' && (
                <button
                  onClick={() => handleStatusChange('ACTIVE')}
                  disabled={statusChanging || loading}
                  className="rounded px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  style={{ backgroundColor: '#28a745' }}
                >
                  Activate
                </button>
              )}
              {org.status === 'ACTIVE' && (
                <button
                  onClick={() => handleStatusChange('SUSPENDED')}
                  disabled={statusChanging || loading}
                  className="rounded px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  style={{ backgroundColor: '#dc3545' }}
                >
                  Suspend
                </button>
              )}
              {(org.status === 'ACTIVE' || org.status === 'SUSPENDED') && (
                <button
                  onClick={() => handleStatusChange('ARCHIVED')}
                  disabled={statusChanging || loading}
                  className="rounded px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  style={{ backgroundColor: '#6c757d' }}
                >
                  Archive
                </button>
              )}
              {org.status === 'SUSPENDED' && (
                <button
                  onClick={() => handleStatusChange('ACTIVE')}
                  disabled={statusChanging || loading}
                  className="rounded px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  style={{ backgroundColor: '#28a745' }}
                >
                  Reactivate
                </button>
              )}
            </div>
          )}

          {/* Tabs */}
          <div className="mb-4 border-b" style={{ borderColor: '#1B2A4A' }}>
            <nav className="-mb-px flex gap-4" aria-label="Tabs">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`border-b-2 px-3 py-2 text-sm font-medium transition ${
                    activeTab === tab.key
                      ? 'border-b-2'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                  style={activeTab === tab.key ? { borderColor: '#F5A623', color: '#1B2A4A' } : {}}
                  aria-selected={activeTab === tab.key}
                  role="tab"
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>

          {/* Tab Content */}
          <div role="tabpanel">
            {activeTab === 'overview' && (
              <div className="space-y-4">
                <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <div>
                    <dt className="text-sm text-gray-500">Members</dt>
                    <dd className="text-lg font-medium" style={{ color: '#1B2A4A' }}>{org.memberCount}</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-gray-500">Custom Roles</dt>
                    <dd className="text-lg font-medium" style={{ color: '#1B2A4A' }}>{org.customRoleCount}</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-gray-500">Created</dt>
                    <dd className="text-lg font-medium" style={{ color: '#1B2A4A' }}>
                      {new Date(org.createdAt).toLocaleDateString()}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm text-gray-500">Updated</dt>
                    <dd className="text-lg font-medium" style={{ color: '#1B2A4A' }}>
                      {new Date(org.updatedAt).toLocaleDateString()}
                    </dd>
                  </div>
                </dl>
              </div>
            )}

            {activeTab === 'members' && (
              <p className="text-gray-500">Member management coming soon.</p>
            )}

            {activeTab === 'roles' && (
              <RoleManager roles={[]} canEdit={true} canDelete={true} />
            )}

            {activeTab === 'audit' && (
              <AuditLogViewer entries={[]} isLoading={false} />
            )}
          </div>

          {/* Quick Links to Dedicated Management Pages */}
          <div className="mt-8 border-t pt-6" style={{ borderColor: '#E5E7EB' }}>
            <h3 className="mb-3 text-sm font-semibold" style={{ color: '#1B2A4A' }}>Quick Links</h3>
            <div className="flex flex-wrap gap-2">
              {externalTabs.map((tab) => (
                <a
                  key={tab.label}
                  href={tab.href}
                  className="rounded px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90"
                  style={{ backgroundColor: '#F5A623' }}
                >
                  {tab.label}
                </a>
              ))}
            </div>
          </div>
        </main>
      </div>
    </RequireSuperAdmin>
  );
}
