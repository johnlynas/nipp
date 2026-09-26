'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { UsersRound, Settings, Shield, ChevronDown, Building2, ExternalLink, X, ChevronLeft } from 'lucide-react';
import type { ChartTree } from './types';
import { OrganizationEditModal } from '@/components/dashboard/OrganizationEditModal';
import { initialsOf, slugLabel } from './panel-utils';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface OrgChartSidebarProps {
  tree: ChartTree;
  isExpanded: boolean;
  onToggle: () => void;
  /** All organizations (super admin only — empty for other roles). */
  organizations?: { id: string; name: string }[];
  selectedOrgId?: string | null;
  onOrgChange?: (orgId: string, orgName?: string) => void;
  /** Fired when a team row is clicked — parent expands that team in the tree. */
  onTeamClick?: (teamId: string) => void;
  /** Fired when an unassigned member is clicked. */
  onMemberClick?: (memberUserId: string) => void;
  /** Team ids currently expanded on the canvas (sync indicator on rows). */
  openTeamIds?: Set<string>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function OrgChartSidebar({
  tree,
  isExpanded,
  onToggle,
  organizations = [],
  selectedOrgId,
  onOrgChange,
  onTeamClick,
  onMemberClick,
  openTeamIds,
}: OrgChartSidebarProps) {
  // -- org switcher popover (super admin only) ------------------------------
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [orgQuery, setOrgQuery] = useState('');
  const switcherRef = useRef<HTMLDivElement>(null);
  const orgFilterInputRef = useRef<HTMLInputElement>(null);

  // -- teams filter ----------------------------------------------------------
  const [teamQuery, setTeamQuery] = useState('');
  // "Organization settings" opens the shared org edit modal in place.
  const [orgEditOpen, setOrgEditOpen] = useState(false);

  /** Header subline counts — derived purely from the already-fetched tree. */
  const headStats = useMemo(() => {
    const teams = tree.teams.length;
    const people =
      tree.teams.reduce((sum, t) => sum + t.members.length, 0) + tree.unassigned.length;
    return teamCountLabel(teams) + ' · ' + peopleLabel(people);
  }, [tree]);

  const filteredOrganizations = useMemo(() => {
    const q = orgQuery.trim().toLowerCase();
    if (!q) return organizations;
    return organizations.filter((o) => o.name.toLowerCase().includes(q));
  }, [organizations, orgQuery]);

  const teamFilterQuery = teamQuery.trim().toLowerCase();
  const filteredTeams = useMemo(() => {
    if (!teamFilterQuery) return tree.teams;
    return tree.teams.filter(
      (t) =>
        t.name.toLowerCase().includes(teamFilterQuery) ||
        (t.description ?? '').toLowerCase().includes(teamFilterQuery),
    );
  }, [tree, teamFilterQuery]);

  // Close the switcher popover on outside click.
  useEffect(() => {
    if (!switcherOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (switcherRef.current && !switcherRef.current.contains(e.target as Node)) {
        closeSwitcher();
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  });

  // Autofocus the filter input when the popover opens.
  useEffect(() => {
    if (switcherOpen) orgFilterInputRef.current?.focus();
  }, [switcherOpen]);

  const openSwitcher = () => {
    setOrgQuery('');
    setSwitcherOpen(true);
  };
  const closeSwitcher = () => {
    setSwitcherOpen(false);
    setOrgQuery('');
  };
  const handleOrgSelect = (orgId: string, orgName: string) => {
    onOrgChange?.(orgId, orgName);
    closeSwitcher();
  };

  const manageLinks: { label: string; icon: React.ComponentType<{ className?: string }>; href?: string; opensEditor?: boolean; action?: 'members-team' }[] = [
    { label: 'Organization settings', icon: Settings, opensEditor: true },
    { label: 'Members', icon: UsersRound, action: 'members-team' },
    { label: 'Roles', href: `/admin/organizations/${tree.organization.id}/roles`, icon: Shield },
  ];

  /**
   * The org's real "Members" team — every user in the organization belongs to
   * it, expanding its column on the canvas shows the whole headcount.
   */
  const membersTeam = tree.teams.find(
    (t) => t.slug === 'members' || t.name.toLowerCase() === 'members',
  );

  const orgSwitchable = organizations.length > 0;
  const hasUnassigned = tree.unassigned.length > 0;

  return (
    <aside
      className={`flex-shrink-0 bg-navy-850 text-white flex flex-col h-full transition-all duration-200 overflow-hidden ${
        isExpanded ? 'w-80' : 'w-16'
      }`}
    >
      {isExpanded ? (
        <>
          {/* Identity header — the panel's subject: which org, how big */}
          <div className="flex items-start gap-2 px-4 py-3 border-b flex-shrink-0" style={{ borderColor: 'var(--color-navy-800)' }}>
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold leading-tight truncate text-white">{tree.organization.name}</p>
              {tree.organization.description && (
                <p className="mt-0.5 text-xs leading-snug truncate" style={{ color: '#94a3b8' }}>
                  {tree.organization.description}
                </p>
              )}
              <p className="mt-1 text-xs tabular-nums" style={{ color: '#94a3b8' }}>{headStats}</p>
            </div>

            <div className="flex items-center gap-0.5 flex-shrink-0">
              {orgSwitchable && (
                <div ref={switcherRef} className="relative">
                  <button
                    type="button"
                    onClick={() => (switcherOpen ? closeSwitcher() : openSwitcher())}
                    aria-label="Switch organization"
                    aria-expanded={switcherOpen}
                    className={`flex items-center gap-1 rounded p-1.5 transition-colors ${
                      switcherOpen ? 'bg-navy-800 text-white' : 'text-slate-400 hover:bg-navy-800 hover:text-white'
                    }`}
                  >
                    <Building2 className="h-4 w-4" />
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform ${switcherOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {switcherOpen && (
                    <div
                      className="absolute right-0 top-full mt-1.5 w-64 rounded border bg-navy-800 shadow-lg z-50"
                      style={{ borderColor: 'var(--color-navy-700)' }}
                      role="dialog"
                      aria-label="Switch organization"
                    >
                      <div className="flex items-center gap-1.5 p-2">
                        <input
                          ref={orgFilterInputRef}
                          type="text"
                          value={orgQuery}
                          onChange={(e) => setOrgQuery(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') closeSwitcher();
                            else if (e.key === 'Enter' && filteredOrganizations.length > 0) {
                              e.preventDefault();
                              handleOrgSelect(filteredOrganizations[0].id, filteredOrganizations[0].name);
                            }
                          }}
                          placeholder="Filter organizations"
                          className="w-full bg-transparent px-2 py-1.5 text-sm outline-none border rounded"
                          style={{ borderColor: 'var(--color-navy-700)', color: '#e2e8f0' }}
                        />
                      </div>
                      <div className="max-h-60 overflow-y-auto pb-1 scroll-dark">
                        {filteredOrganizations.length === 0 ? (
                          <p className="px-3 py-2 text-sm" style={{ color: '#94a3b8' }}>
                            No organizations match &ldquo;{orgQuery.trim()}&rdquo;
                          </p>
                        ) : (
                          filteredOrganizations.map((org) => (
                            <button
                              key={org.id}
                              type="button"
                              onClick={() => handleOrgSelect(org.id, org.name)}
                              className={`w-full px-3 py-2 text-left text-sm transition-colors truncate ${
                                org.id === selectedOrgId
                                  ? 'text-white font-semibold bg-navy-700/40'
                                  : 'text-slate-400 hover:bg-white/5 hover:text-white'
                              }`}
                            >
                              {org.name}
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <button
                onClick={onToggle}
                className="rounded p-1.5 text-slate-300 hover:text-white hover:bg-navy-800 transition-colors"
                aria-label="Collapse sidebar"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Manage section (edit rights only) */}
          {tree.viewerCanEdit && (
            <div className="px-4 pt-3 pb-2 flex-shrink-0 border-b" style={{ borderColor: 'var(--color-navy-800)' }}>
              <p className="pb-1.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: '#64748b' }}>
                Manage
              </p>
              <ul className="space-y-0.5">
                {manageLinks.map(({ label, href, icon: Icon, opensEditor, action }) => (
                  <li key={label}>
                    <a
                      href={href}
                      aria-disabled={opensEditor || undefined}
                      onClick={(e) => {
                        if (opensEditor) {
                          e.preventDefault();
                          setOrgEditOpen(true);
                        } else if (action === 'members-team') {
                          e.preventDefault();
                          // Expand the org's real "Members" team column on the canvas —
                          // every org user sits in that team, so it shows the whole headcount.
                          if (membersTeam) {
                            onTeamClick?.(membersTeam.id);
                          } else {
                            // Fallback: org has no Members team — open its member list instead.
                            window.location.href = `/admin/organizations/${tree.organization.id}/members`;
                          }
                        } else if (!href) {
                          e.preventDefault();
                        }
                      }}
                      className="flex items-center gap-2.5 rounded px-2 py-1.5 text-sm transition-colors"
                      style={{ color: '#cbd5e1', cursor: 'pointer' }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = 'var(--color-navy-800)';
                        e.currentTarget.style.color = '#fff';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = '';
                        e.currentTarget.style.color = '#cbd5e1';
                      }}
                    >
                      <Icon className="h-4 w-4 shrink-0 text-slate-500" />
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Organization edit modal — opened by "Organization settings" above */}
          <OrganizationEditModal
            isOpen={orgEditOpen}
            org={
              orgEditOpen
                ? {
                    id: tree.organization.id,
                    name: tree.organization.name,
                    description: tree.organization.description,
                    status: tree.organization.status,
                  }
                : null
            }
            onClose={() => setOrgEditOpen(false)}
          />

          {/* Teams section — quiet label, optional filter */}
          <div className="flex-shrink-0 pt-3 pb-1 px-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: '#64748b' }}>
              Teams
            </p>
            <div className="relative mt-1.5">
              <input
                type="search"
                value={teamQuery}
                onChange={(e) => setTeamQuery(e.target.value)}
                placeholder="Filter teams…"
                aria-label="Filter teams"
                className="w-full bg-navy-800 text-sm rounded px-2.5 py-1.5 pr-7 outline-none border transition-colors"
                style={{ borderColor: 'var(--color-navy-700)', color: '#e2e8f0' }}
              />
              {teamQuery && (
                <button
                  type="button"
                  onClick={() => setTeamQuery('')}
                  aria-label="Clear team filter"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-white transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Scrollable content */}
          <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 scroll-dark">
            {tree.teams.length === 0 ? (
              <p className="text-sm pt-2" style={{ color: '#94a3b8' }}>No teams in this organization</p>
            ) : filteredTeams.length === 0 && teamFilterQuery ? (
              <p className="text-sm pt-1" style={{ color: '#94a3b8' }}>
                No teams match &ldquo;{teamQuery.trim()}&rdquo;
              </p>
            ) : (
              <ul className="space-y-0.5">
                {filteredTeams.map((team) => {
                  const isOpen = openTeamIds?.has(team.id) ?? false;
                  return (
                    <li key={team.id}>
                      <button
                        type="button"
                        onClick={() => onTeamClick?.(team.id)}
                        title={team.description || team.name}
                        aria-current={isOpen ? 'true' : undefined}
                        className={`w-full flex items-center justify-between rounded px-2 py-2 text-left transition-colors ${
                          isOpen ? 'bg-navy-800/60' : 'hover:bg-navy-800'
                        }`}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <span
                            aria-hidden="true"
                            className="h-4 w-0.5 rounded-full flex-shrink-0 transition-opacity"
                            style={{ backgroundColor: isOpen ? 'var(--color-accent)' : 'transparent' }}
                          />
                          <span className="text-sm truncate" style={{ color: '#e2e8f0' }}>{team.name}</span>
                        </span>
                        <span
                          className="ml-2 flex-shrink-0 rounded-full px-1.5 text-xs leading-5 tabular-nums"
                          style={{ backgroundColor: 'var(--color-navy-700)', opacity: 0.5, color: '#e2e8f0' }}
                        >
                          {team.members.length}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {/* Unassigned members */}
            {hasUnassigned && (
              <>
                <p className="pt-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: '#64748b' }}>
                  Unassigned
                </p>
                <ul className="space-y-0.5">
                  {tree.unassigned.map((member) => (
                    <li key={member.userId}>
                      <button
                        type="button"
                        onClick={() => onMemberClick?.(member.userId)}
                        title="Open user profile"
                        className="w-full flex items-center gap-2.5 rounded px-2 py-1.5 text-left transition-colors hover:bg-navy-800"
                      >
                        <span
                          aria-hidden="true"
                          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-semibold"
                          style={{ backgroundColor: 'var(--color-navy-700)', opacity: 0.55, color: '#e2e8f0' }}
                        >
                          {initialsOf(member.name)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm truncate" style={{ color: '#e2e8f0' }}>{member.name}</span>
                          <span className="block text-xs truncate" style={{ color: '#94a3b8' }}>
                            {slugLabel(member.memberRole)}
                          </span>
                        </span>
                        <ExternalLink className="h-3.5 w-3.5 flex-shrink-0" style={{ color: '#64748b' }} />
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </>
      ) : (
        /* Collapsed rail — single arrow distinct from the left nav's burger */
        <div className="flex flex-col items-center pt-3">
          <button
            onClick={onToggle}
            title="Slide in panel"
            aria-label="Expand sidebar"
            className="rounded p-2 text-slate-400 hover:text-white hover:bg-navy-800 transition-colors"
          >
            <ChevronLeft className="h-[30px] w-[30px]" />
          </button>
        </div>
      )}
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Small label helpers (kept local — display-only, trivial)
// ---------------------------------------------------------------------------

function teamCountLabel(n: number): string {
  return `${n} ${n === 1 ? 'team' : 'teams'}`;
}
function peopleLabel(n: number): string {
  return `${n} ${n === 1 ? 'person' : 'people'}`;
}
