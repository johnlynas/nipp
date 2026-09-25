'use client';

import { Modal } from '@/components/dashboard/Modal';
import type { ChartMember } from './types';

interface OrgChartDetailModalProps {
  member: ChartMember | null;
  /** When true, show "Manage" navigation links (admin affordance). */
  canEdit?: boolean;
  organizationId?: string;
  onClose: () => void;
}

/**
 * Member detail popup: name, email, BetterAuth membership role, assigned
 * roles with expandable permission keys, and team memberships.
 */
export default function OrgChartDetailModal({
  member,
  canEdit = false,
  organizationId,
  onClose,
}: OrgChartDetailModalProps) {
  return (
    <Modal isOpen={member !== null} onClose={onClose} title={member?.name ?? 'Member details'} size="md">
      {member && (
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-slate-500 font-medium">Email</dt>
            <dd style={{ color: 'var(--color-navy-850)' }}>{member.email || '—'}</dd>
            <dt className="text-slate-500 font-medium">Membership role</dt>
            <dd style={{ color: 'var(--color-navy-850)' }}>{member.memberRole}</dd>
            <dt className="text-slate-500 font-medium">Team membership</dt>
            <dd style={{ color: 'var(--color-navy-850)' }}>
              {member.teams.length > 0
                ? member.teams.map((t) => t.replace(/-/g, ' ')).join(', ')
                : 'Unassigned'}
            </dd>
          </dl>

          <div>
            <p className="text-sm font-semibold mb-2" style={{ color: 'var(--color-navy-850)' }}>
              Assigned roles
            </p>
            {member.assignedRoles.length === 0 ? (
              <p className="text-sm text-slate-500">No roles assigned</p>
            ) : (
              <ul className="space-y-2">
                {member.assignedRoles.map((role) => (
                  <li key={role.id} className="rounded border p-2 text-sm" style={{ borderColor: 'var(--color-slate-200)' }}>
                    <p className="font-medium" style={{ color: 'var(--color-navy-850)' }}>
                      {role.name} <span className="text-slate-400">({role.permissionCount} permissions)</span>
                    </p>
                    {role.permissions.length > 0 && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-700">
                          Show permissions
                        </summary>
                        <ul className="mt-1 space-y-0.5 pl-4">
                          {role.permissions.map((key) => (
                            <li key={key} className="text-xs font-mono text-slate-600">
                              {key}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {canEdit && organizationId && (
            <div className="border-t pt-3" style={{ borderColor: 'var(--color-slate-200)' }}>
              <p className="text-sm font-semibold mb-2" style={{ color: 'var(--color-navy-850)' }}>
                Manage
              </p>
              <div className="flex flex-wrap gap-2">
                <a
                  href={`/admin/organizations/${organizationId}/members`}
                  className="rounded px-3 py-1.5 text-sm text-white transition-colors hover:opacity-90"
                  style={{ backgroundColor: 'var(--color-navy-850)' }}
                >
                  View members
                </a>
                <a
                  href={`/admin/organizations/${organizationId}/roles`}
                  className="rounded px-3 py-1.5 text-sm text-white transition-colors hover:opacity-90"
                  style={{ backgroundColor: 'var(--color-navy-850)' }}
                >
                  Manage roles
                </a>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
