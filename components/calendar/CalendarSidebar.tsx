'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import type { UpcomingEvent } from './types';
import { getEventInstanceKey } from './calendar-utils';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CalendarSidebarProps {
  upcomingEvents: UpcomingEvent[];
  isExpanded: boolean;
  onToggle: () => void;
  organizations?: { id: string; name: string }[];
  selectedOrgId?: string | null;
  onOrgChange?: (orgId: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CalendarSidebar({
  upcomingEvents,
  isExpanded,
  onToggle,
  organizations = [],
  selectedOrgId,
  onOrgChange,
}: CalendarSidebarProps) {
  const [orgDropdownOpen, setOrgDropdownOpen] = useState(false);
  const orgDropdownRef = useRef<HTMLDivElement>(null);
  const orgInputRef = useRef<HTMLInputElement>(null);
  // Whether the org input currently has focus (edit mode).
  const [orgFocused, setOrgFocused] = useState(false);
  // Text the user has typed into the org combobox. '' means "no filter".
  const [orgQuery, setOrgQuery] = useState('');
  // Free-text filter for the upcoming events list (matched against event titles)
  const [searchQuery, setSearchQuery] = useState('');

  const selectedOrgName = organizations.find((o) => o.id === selectedOrgId)?.name || '';

  // What the org input displays:
  //  - edit mode (focused): exactly what the user typed, including empty
  //    (so the first character CAN be deleted);
  //  - otherwise: the selected org's name.
  const displayedOrgText = orgFocused ? orgQuery : selectedOrgName;

  // The query actually used for filtering. An untouched focused field (no
  // characters typed yet) must NOT filter, so typing a single character is
  // already a genuine search. Focused-only → filter off.
  const effectiveOrgQuery = orgFocused ? orgQuery : '';

  // Orgs matching the current query (case-insensitive substring match on name).
  // Empty query → full list, so Platform first by default.
  const filteredOrganizations = useMemo(() => {
    const q = effectiveOrgQuery.trim().toLowerCase();
    if (!q) return organizations;
    return organizations.filter((o) => o.name.toLowerCase().includes(q));
  }, [organizations, effectiveOrgQuery]);

  const filteredUpcomingEvents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return upcomingEvents;
    return upcomingEvents.filter((e) => e.title.toLowerCase().includes(q));
  }, [upcomingEvents, searchQuery]);

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
    // Start editing from a clean slate: the selected name is only shown as a
    // placeholder-ish display before any keystroke.
    setOrgQuery('');
    setOrgDropdownOpen(true);
  };

  const handleOrgBlur = () => {
    // Drop edit mode; the input falls back to showing the selected org name.
    setOrgFocused(false);
    setOrgDropdownOpen(false);
    setOrgQuery('');
  };

  const handleOrgSelect = (orgId: string) => {
    onOrgChange?.(orgId);
    setOrgFocused(false);
    setOrgDropdownOpen(false);
    setOrgQuery('');
  };

  const handleOrgKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && filteredOrganizations.length > 0) {
      e.preventDefault();
      handleOrgSelect(filteredOrganizations[0].id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      // Back to the selected org; keep focus on the input.
      setOrgFocused(false);
      setOrgDropdownOpen(false);
      setOrgQuery('');
    }
  };

  // Format event date/time for display in upcoming events list
  const formatEventDateTime = (event: UpcomingEvent): string => {
    const start = event.startDate instanceof Date ? event.startDate : new Date(event.startDate);
    const end = event.endDate instanceof Date ? event.endDate : new Date(event.endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return '';

    const isMultiDay = start.toDateString() !== end.toDateString();

    if (isMultiDay) {
      // Multi-day: show date range with times
      const startOpts: Intl.DateTimeFormatOptions = {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
      };
      const endOpts: Intl.DateTimeFormatOptions = {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
      };
      return `${start.toLocaleDateString('en-GB', startOpts)} – ${end.toLocaleDateString('en-GB', endOpts)}`;
    }

    // Single day with time range: show date and both times
    const dateOpts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
    const timeOpts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
    return `${start.toLocaleDateString('en-GB', dateOpts)} ${start.toLocaleTimeString('en-GB', timeOpts)} – ${end.toLocaleTimeString('en-GB', timeOpts)}`;
  };

  return (
    <aside
      className={`flex-shrink-0 bg-[#1B2A4A] text-white flex flex-col h-full transition-all duration-200 overflow-hidden ${
        isExpanded ? 'w-80' : 'w-16'
      }`}
    >
      {/* Title bar — toggle only; the "Upcoming Events" label has moved
          down between the org selector and the search field */}
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
          {/* Organization Switcher — typeable combobox: focusing opens the list
              and the visible orgs filter live as you type */}
          {organizations.length > 0 && (
            <div className="px-4 py-3 border-b flex-shrink-0" style={{ borderColor: '#24355c' }}>
              <p className="text-sm font-semibold mt-1 mb-1.5" style={{ color: '#e2e8f0' }}>
                Organization
              </p>
              <div className="relative" ref={orgDropdownRef}>
                <input
                  ref={orgInputRef}
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
                          onClick={() => handleOrgSelect(org.id)}
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
            </div>
          )}

          {/* "Upcoming Events" section label — sits between the org selector
              and the search field */}
          <p className="px-4 pt-3 pb-1 text-sm font-semibold" style={{ color: '#e2e8f0' }}>
            Upcoming Events
          </p>

          {/* Search box — filters the upcoming events list below by event title */}
          <div className="px-4 py-3 border-b flex-shrink-0" style={{ borderColor: '#24355c' }}>
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search upcoming events..."
                className="w-full pl-3 pr-8 py-2 rounded text-sm bg-[#24355c] border placeholder:text-gray-500 focus:outline-none"
                style={{ borderColor: '#3a4f7a', color: '#e2e8f0' }}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                  aria-label="Clear search"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {/* Upcoming Events List - scrollable container (min-h-0 lets the
              flex child shrink so a scrollbar appears instead of the list
              overflowing the sidebar page) */}
          <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
            {upcomingEvents.length === 0 ? (
              <p className="text-sm text-gray-400">No upcoming events</p>
            ) : filteredUpcomingEvents.length === 0 ? (
              <p className="text-sm text-gray-400">No events match "{searchQuery.trim()}"</p>
            ) : (
              <ul className="space-y-2">
                {filteredUpcomingEvents.map((event) => (
                  <li key={getEventInstanceKey(event)}>
                    <div className="flex items-start gap-2 p-2 rounded hover:bg-[#24355c] transition-colors">
                      <div
                        className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0"
                        style={{ backgroundColor: event.color || '#2A9D8F' }}
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: '#e2e8f0' }}>{event.title}</p>
                        <p className="text-xs truncate" style={{ color: '#94a3b8' }}>
                          {formatEventDateTime(event)}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
