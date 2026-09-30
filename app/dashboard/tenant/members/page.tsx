'use client';

import { useState, useEffect } from 'react';
import { PageSkeleton } from '@/components/dashboard/PageSkeleton';
import { initialsOf, slugLabel } from '@/components/org-chart/panel-utils';

interface MemberRow {
  userId: string;
  name: string;
  email: string | null;
  image: string | null;
  memberRole: string;
  roleNames: string[];
  teamNames: string[];
}

/**
 * Tenant members — view-only roster of the user's own organization, derived
 * from the org-chart payload (the member endpoint itself is admin-gated and
 * the super-admin list endpoint is platform-scoped). No create/edit/delete.
 */
export default function TenantMembersPage() {
  const [orgName, setOrgName] = useState('');
  const [members, setMembers] = useState<MemberRow[]>([]);
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
          throw new Error(body.error || `Failed to load members (${res.status})`);
        }
        const tree = await res.json();

        const rows = new Map<string, MemberRow>();
        const put = (member: {
          userId: string; name: string; email: string | null; image: string | null;
          memberRole: string; assignedRoles?: { name: string }[]; teams?: string[];
        }, teamNameHint: string | null) => {
          const existing: MemberRow = rows.get(member.userId) ?? {
            userId: member.userId,
            name: member.name,
            email: member.email,
            image: member.image,
            memberRole: member.memberRole,
            roleNames: [],
            teamNames: [],
          };
          if (teamNameHint && !existing.teamNames.includes(teamNameHint)) {
            existing.teamNames.push(teamNameHint);
          }
          for (const role of member.assignedRoles ?? []) {
            if (!existing.roleNames.includes(role.name)) existing.roleNames.push(role.name);
          }
          rows.set(member.userId, existing);
        };

        for (const team of tree.teams) {
          for (const m of team.members) put(m, team.name);
        }
        // Unassigned members keep no team — their roles are still recorded.
        for (const m of tree.unassigned) put(m, null);

        setOrgName(tree.organization?.name || '');
        setMembers(
          [...rows.values()].sort((a, b) => a.name.localeCompare(b.name) || (a.email ?? '').localeCompare(b.email ?? '')),
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load members');
        setMembers([]);
      } finally {
        setLoading(false);
      }
    }

    init();
  }, []);

  if (loading) return <PageSkeleton rows={6} cols={5} />;

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <p style={{ color: 'var(--color-slate-700)' }}>{error}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--color-navy-850)' }}>
            Members{orgName ? ` — ${orgName}` : ''}
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--color-slate-500)' }}>
            Read-only roster of your organization.
          </p>
        </div>
        <span className="text-sm tabular-nums" style={{ color: 'var(--color-slate-500)' }}>
          {members.length} {members.length === 1 ? 'person' : 'people'}
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border bg-white" style={{ borderColor: 'var(--color-slate-200)' }}>
        <table className="min-w-full divide-y" style={{ borderColor: 'var(--color-slate-200)' }}>
          <thead className="bg-canvas-subtle">
            <tr>
              {['Name', 'Email', 'Role', 'Roles', 'Teams'].map((h) => (
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
            {members.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--color-slate-500)' }}>
                  No members in this organization
                </td>
              </tr>
            ) : (
              members.map((m) => (
                <tr key={m.userId} className="hover:bg-canvas-subtle transition-colors">
                  <td className="px-4 py-2.5 text-sm font-medium whitespace-nowrap" style={{ color: 'var(--color-navy-850)' }}>
                    <span className="flex items-center gap-2.5">
                      <span
                        aria-hidden="true"
                        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                        style={{ backgroundColor: 'var(--color-navy-700)' }}
                      >
                        {initialsOf(m.name)}
                      </span>
                      {m.name}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-sm" style={{ color: 'var(--color-slate-600)' }}>{m.email ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                      style={{ backgroundColor: 'var(--color-canvas-subtle)', color: 'var(--color-slate-600)' }}
                    >
                      {slugLabel(m.memberRole)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-sm" style={{ color: 'var(--color-slate-600)' }}>
                    {m.roleNames.length > 0 ? m.roleNames.join(', ') : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-sm" style={{ color: 'var(--color-slate-600)' }}>
                    {m.teamNames.length > 0 ? m.teamNames.join(', ') : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
