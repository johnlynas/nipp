'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import type { ChartTree } from './types';

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
}: OrgChartSidebarProps) {
  const [orgDropdownOpen, setOrgDropdownOpen] = useState(false);
  const orgDropdownRef = useRef<HTMLDivElement>(null);
  // Whether the org input currently has focus (edit mode).
  const [orgFocused, setOrgFocused] = useState(false);
  // Text the user has typed into the org combobox. '' means "no filter".
  const [orgQuery, setOrgQuery] = useState('');

  const selectedOrgName = useMemo(() => {
    const selected = organizations.find((o) => o.id === selectedOrgId);
    return selected?.name || tree.organization.name;
  }, [organizations, selectedOrgId, tree.organization.name]);

  const displayedOrgText = orgFocused ? orgQuery : selectedOrgName;
  const effectiveOrgQuery = orgFocused ? orgQuery : '';

  const filteredOrganizations = useMemo(() => {
    const q = effectiveOrgQuery.trim().toLowerCase();
    if (!q) return organizations;
    return organizations.filter((o) => o.name.toLowerCase().includes(q));
  }, [organizations, effectiveOrgQuery]);

  // Reset the combobox when focus lands elsewhere (outside click, blur).
  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (orgDropdownRef.current && !orgDropdownRef.current.contains(e.target as Node)) {
        setOrgDropdownOpen(false);
      }
    };
    if (orgDropdownOpen) {
      document.addEventListener('mousedown', handleOutside);
      return () => document.removeEventListener('mousedown', handleOutside);
    }
  }, [orgDropdownOpen]);

  const handleOrgFocus = () => {
    setOrgFocused(true);
    setOrgQuery('');
    setOrgDropdownOpen(true);
  };

  const handleOrgBlur = () => {
    setOrgFocused(false);
    setOrgDropdownOpen(false);
    setOrgQuery('');
  };

  const handleOrgSelect = (orgId: string, orgName: string) => {
    onOrgChange?.(orgId, orgName);
    setOrgFocused(false);
    setOrgDropdownOpen(false);
    setOrgQuery('');
  };

  const handleOrgKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && filteredOrganizations.length > 0) {
      e.preventDefault();
      const first = filteredOrganizations[0];
      handleOrgSelect(first.id, first.name);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOrgFocused(false);
      setOrgDropdownOpen(false);
      setOrgQuery('');
    }
  };

  const orgSwitchable = organizations.length > 0;

  const manageLinks: { label: string; href: string }[] = [
    { label: 'Organization settings', href: `/admin/organizations/${tree.organization.id}/settings` },
    { label: 'Members', href: `/admin/organizations/${tree.organization.id}/members` },
    { label: 'Roles', href: `/admin/organizations/${tree.organization.id}/roles` },
  ];

  return (
    <aside
      className={`flex-shrink-0 bg-[#1B2A4A] text-white flex flex-col h-full transition-all duration-200 overflow-hidden ${
        isExpanded ? 'w-80' : 'w-16'
      }`}
    >
      {/* Title bar — toggle only */}
      <div className="flex items-center justify-end px-4 py-3 border-b flex-shrink-0" style={{ borderColor: '#24355c' }}>
        <button
          onClick={onToggle}
          className="text-gray-300 hover:text-white transition-colors"
          aria-label={isExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          {isExpanded ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
        </button>
      </div>

      {isExpanded && (
        <>
          {/* Organization switcher — typeable combobox (super admin only) */}
          <div className="px-4 py-3 border-b flex-shrink-0" style={{ borderColor: '#24355c' }}>
            <p className="text-sm font-semibold mt-1 mb-1.5" style={{ color: '#e2e8f0' }}>
              Organization
            </p>
            {orgSwitchable ? (
              <div className="relative" ref={orgDropdownRef}>
                <input
                  type="text"
                  value={displayedOrgText}
                  onChange={(e) => { setOrgFocused(true); setOrgQuery(e.target.value); setOrgDropdownOpen(true); }}
                  onFocus={handleOrgFocus}
                  onBlur={handleOrgBlur}
                  onKeyDown={handleOrgKeyDown}
                  placeholder="Select organization"
                  className="w-full pl-3 pr-8 py-2 rounded text-sm bg-[#24355c] border placeholder:text-gray-500 focus:outline-none"
                  style={{ borderColor: orgDropdownOpen ? '#F5A623' : '#3a4f7a', color: '#e2e8f0' }}
                />
                <svg
                  className={`w-4 h-4 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none transition-transform ${orgDropdownOpen ? 'rotate-180 text-[#F5A623]' : 'text-gray-400'}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>

                {orgDropdownOpen && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-[#24355c] border rounded shadow-lg z-50 max-h-60 overflow-y-auto" style={{ borderColor: '#3a4f7a' }}>
                    {filteredOrganizations.length === 0 ? (
                      <div className="px-3 py-2 text-sm" style={{ color: '#94a3b8' }}>
                        No organizations match "{effectiveOrgQuery.trim()}"
                      </div>
                    ) : (
                      filteredOrganizations.map((org) => (
                        <button
                          key={org.id}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => handleOrgSelect(org.id, org.name)}
                          className={`w-full px-3 py-2 text-left text-sm transition-colors truncate ${
                            org.id === selectedOrgId
                              ? 'bg-[#1B2A4A] text-[#F5A623]'
                              : 'text-gray-300 hover:bg-[#1B2A4A] hover:text-white'
                          }`}
                        >
                          {org.name}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm truncate" style={{ color: '#e2e8f0' }}>
                {selectedOrgName}
              </p>
            )}
          </div>

          {/* Manage section (edit rights only) */}
          {tree.viewerCanEdit && (
            <div className="px-4 py-3 border-b flex-shrink-0" style={{ borderColor: '#24355c' }}>
              <p className="text-sm font-semibold mb-1.5" style={{ color: '#e2e8f0' }}>
                Manage
              </p>
              <ul className="space-y-1">
                {manageLinks.map((link) => (
                  <li key={link.href}>
                    <a
                      href={link.href}
                      className="block rounded px-2 py-1.5 text-sm text-gray-300 hover:bg-[#24355c] hover:text-white transition-colors"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Teams list */}
          <p className="px-4 pt-3 pb-1 text-sm font-semibold flex-shrink-0" style={{ color: '#e2e8f0' }}>
            Teams
          </p>

          {/* Scrollable content */}
          <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
            {tree.teams.length === 0 ? (
              <p className="text-sm text-gray-400 pt-2">No teams in this organization</p>
            ) : (
              <ul className="space-y-1">
                {tree.teams.map((team) => (
                  <li key={team.id}>
                    <button
                      type="button"
                      onClick={() => onTeamClick?.(team.id)}
                      className="w-full flex items-center justify-between rounded px-2 py-2 text-left hover:bg-[#24355c] transition-colors"
                    >
                      <span className="text-sm truncate" style={{ color: '#e2e8f0' }}>{team.name}</span>
                      <span className="text-xs ml-2 flex-shrink-0" style={{ color: '#94a3b8' }}>
                        {team.members.length}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {/* Unassigned members */}
            {tree.unassigned.length > 0 && (
              <>
                <p className="pt-3 pb-1 text-sm font-semibold" style={{ color: '#e2e8f0' }}>
                  Unassigned
                </p>
                <ul className="space-y-1">
                  {tree.unassigned.map((member) => (
                    <li key={member.userId}>
                      <button
                        type="button"
                        onClick={() => onMemberClick?.(member.userId)}
                        className="w-full rounded px-2 py-1.5 text-left hover:bg-[#24355c] transition-colors"
                      >
                        <p className="text-sm truncate" style={{ color: '#e2e8f0' }}>{member.name}</p>
                        <p className="text-xs truncate" style={{ color: '#94a3b8' }}>{member.memberRole}</p>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
