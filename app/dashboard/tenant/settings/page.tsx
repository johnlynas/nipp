'use client';

import { useState, useEffect } from 'react';
import { PageSkeleton } from '@/components/dashboard/PageSkeleton';
import { StatusBadge } from '@/components/dashboard/StatusBadge';

interface OrgDetail {
  name: string;
  description?: string | null;
  status: string;
}

interface TeamRow {
  id: string;
  name: string;
  description?: string | null;
  memberCount: number;
}

/**
 * Tenant organization setup — view-only. Organization identity (name,
 * description, status) plus the team structure with headcounts, all derived
 * from the membership-scoped org-chart endpoint. Editing stays on the
 * platform-admin side under /dashboard/admin.
 */
export default function TenantSettingsPage() {
  const [org, setOrg] = useState<OrgDetail | null>(null);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [unassignedCount, setUnassignedCount] = useState(0);
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
            if (me.activeOrganizationId) orgId = me.activeOrganizationId;
          }
        } catch { /* fall through */ }
        if (!orgId) orgId = localStorage.getItem('nipp-active-org-id');
        if (!orgId) {
          setError('No organization selected');
          setLoading(false);
          return;
        }

        const res = await fetch(`/api/organizations/${orgId}/org-chart`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Failed to load organization (${res.status})`);
        }
        const tree = await res.json();

        setOrg({
          name: tree.organization?.name ?? '',
          description: tree.organization?.description,
          status: tree.organization?.status ?? 'Unknown',
        });
        setTeams(
          tree.teams.map((t: { id: string; name: string; description?: string | null; members: unknown[] }) => ({
            id: t.id,
            name: t.name,
            description: t.description,
            memberCount: t.members?.length ?? 0,
          })),
        );
        setUnassignedCount(tree.unassigned?.length ?? 0);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load organization');
      } finally {
        setLoading(false);
      }
    }

    init();
  }, []);

  if (loading) return <PageSkeleton rows={5} cols={3} />;

  if (error || !org) {
    return (
      <div className="flex items-center justify-center h-full">
        <p style={{ color: 'var(--color-slate-700)' }}>{error || 'Organization not found'}</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--color-navy-850)' }}>
          Organization Setup
        </h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--color-slate-500)' }}>
          Your organization is read-only here — contact your platform administrator for changes.
        </p>
      </div>

      {/* Organization identity */}
      <section className="mb-8 rounded-lg border bg-white p-5" style={{ borderColor: 'var(--color-slate-200)' }}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold" style={{ color: 'var(--color-navy-850)' }}>{org.name}</h2>
            {org.description && (
              <p className="mt-1 text-sm" style={{ color: 'var(--color-slate-600)' }}>{org.description}</p>
            )}
          </div>
          <StatusBadge status={org.status} />
        </div>
      </section>

      {/* Teams */}
      <section>
        <h2 className="mb-3 text-base font-semibold" style={{ color: 'var(--color-navy-850)' }}>Teams</h2>
        <div className="overflow-x-auto rounded-lg border bg-white" style={{ borderColor: 'var(--color-slate-200)' }}>
          <table className="min-w-full divide-y" style={{ borderColor: 'var(--color-slate-200)' }}>
            <thead className="bg-canvas-subtle">
              <tr>
                {['Team', 'Description', 'Members'].map((h) => (
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
              {teams.length === 0 && unassignedCount === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--color-slate-500)' }}>
                    No teams set up yet
                  </td>
                </tr>
              ) : (
                <>
                  {teams.map((t) => (
                    <tr key={t.id} className="hover:bg-canvas-subtle transition-colors">
                      <td className="px-4 py-2.5 text-sm font-medium whitespace-nowrap" style={{ color: 'var(--color-navy-850)' }}>
                        {t.name}
                      </td>
                      <td className="px-4 py-2.5 text-sm" style={{ color: 'var(--color-slate-600)' }}>
                        {t.description || '—'}
                      </td>
                      <td className="px-4 py-2.5 text-sm tabular-nums" style={{ color: 'var(--color-slate-600)' }}>
                        {t.memberCount}
                      </td>
                    </tr>
                  ))}
                  {unassignedCount > 0 && (
                    <tr className="hover:bg-canvas-subtle transition-colors">
                      <td className="px-4 py-2.5 text-sm font-medium whitespace-nowrap" style={{ color: 'var(--color-navy-850)' }}>
                        Unassigned
                      </td>
                      <td className="px-4 py-2.5 text-sm italic" style={{ color: 'var(--color-slate-500)' }}>
                        Members without a team
                      </td>
                      <td className="px-4 py-2.5 text-sm tabular-nums" style={{ color: 'var(--color-slate-600)' }}>
                        {unassignedCount}
                      </td>
                    </tr>
                  )}
                </>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
