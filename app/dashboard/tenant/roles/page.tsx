'use client';

import { useState, useEffect } from 'react';
import { PageSkeleton } from '@/components/dashboard/PageSkeleton';

interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  createdAt: string;
  _count?: { memberRoles: number };
}

/**
 * Tenant roles — view-only list of the organization's roles, served by the
 * membership-scoped GET route. No create/edit/delete: role management stays
 * a platform-admin operation under /dashboard/admin.
 */
export default function TenantRolesPage() {
  const [orgName, setOrgName] = useState('');
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function init() {
      try {
        // Active org from session, localStorage fallback.
        let orgId: string | null = null;
        try {
          const meRes = await fetch('/api/auth/me');
          if (meRes.ok) {
            const me = await meRes.json();
            if (me.activeOrganizationId) {
              orgId = me.activeOrganizationId;
              if (me.organizationName) setOrgName(me.organizationName);
            }
          }
        } catch { /* fall through */ }
        if (!orgId) orgId = localStorage.getItem('nipp-active-org-id');
        if (!orgId) {
          setError('No organization selected');
          setLoading(false);
          return;
        }

        const res = await fetch(`/api/organizations/${orgId}/roles`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Failed to load roles (${res.status})`);
        }
        const data = await res.json();
        setRoles(data.roles || []);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load roles');
        setRoles([]);
      } finally {
        setLoading(false);
      }
    }

    init();
  }, []);

  if (loading) return <PageSkeleton rows={4} cols={3} />;

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <p style={{ color: 'var(--color-slate-700)' }}>{error}</p>
      </div>
    );
  }

  const defaultRoles = roles.filter((r) => r.isDefault);
  const customRoles = roles.filter((r) => !r.isDefault);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--color-navy-850)' }}>
          Roles{orgName ? ` — ${orgName}` : ''}
        </h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--color-slate-500)' }}>
          Read-only list of your organization&apos;s roles. Management is handled by platform administrators.
        </p>
      </div>

      <section className={customRoles.length > 0 ? 'mb-8' : ''}>
        <h2 className="mb-3 text-base font-semibold" style={{ color: 'var(--color-navy-850)' }}>
          Default Roles
        </h2>
        <RoleTable roles={defaultRoles} />
      </section>

      {customRoles.length > 0 && (
        <section>
          <h2 className="mb-3 text-base font-semibold" style={{ color: 'var(--color-navy-850)' }}>
            Custom Roles
          </h2>
          <RoleTable roles={customRoles} />
        </section>
      )}
    </div>
  );
}

function RoleTable({ roles }: { roles: RoleRow[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border bg-white" style={{ borderColor: 'var(--color-slate-200)' }}>
      <table className="min-w-full divide-y" style={{ borderColor: 'var(--color-slate-200)' }}>
        <thead className="bg-canvas-subtle">
          <tr>
            {['Role', 'Description', 'In Use'].map((h) => (
              <th
                key={h}
                scope="col"
                className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider"
                style={{ color: 'var(--color-slate-500)' }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y" style={{ borderColor: 'var(--color-slate-100)' }}>
          {roles.length === 0 ? (
            <tr>
              <td colSpan={3} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--color-slate-500)' }}>
                No roles to show
              </td>
            </tr>
          ) : (
            roles.map((role) => (
              <tr key={role.id} className="hover:bg-canvas-subtle transition-colors">
                <td className="px-4 py-2.5 text-sm font-medium whitespace-nowrap" style={{ color: 'var(--color-navy-850)' }}>
                  {role.name}
                  <span
                    className={`ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${role.isDefault ? 'bg-slate-100 text-slate-500' : 'text-white'}`}
                    style={role.isDefault ? undefined : { backgroundColor: 'var(--color-navy-700)' }}
                  >
                    {role.isDefault ? 'Default' : 'Custom'}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-sm" style={{ color: 'var(--color-slate-600)' }}>
                  {role.description || '—'}
                </td>
                <td className="px-4 py-2.5 text-sm tabular-nums" style={{ color: 'var(--color-slate-600)' }}>
                  {role._count?.memberRoles ?? 0} members
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
