'use client';

import { useState, useRef, useEffect } from 'react';
import type { UpcomingEvent, QuickAddInput, CalendarEventType } from './types';
import { EVENT_TYPES } from './types';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CalendarSidebarProps {
  upcomingEvents: UpcomingEvent[];
  isExpanded: boolean;
  onToggle: () => void;
  onQuickAdd?: (input: QuickAddInput) => Promise<void>;
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
  onQuickAdd,
  organizations = [],
  selectedOrgId,
  onOrgChange,
}: CalendarSidebarProps) {
  const [quickAddType, setQuickAddType] = useState<CalendarEventType>('VIEWING');
  const [quickAddDate, setQuickAddDate] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [orgDropdownOpen, setOrgDropdownOpen] = useState(false);
  const orgDropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (orgDropdownRef.current && !orgDropdownRef.current.contains(e.target as Node)) {
        setOrgDropdownOpen(false);
      }
    };
    if (orgDropdownOpen) {
      document.addEventListener('mousedown', handleClick);
      return () => document.removeEventListener('mousedown', handleClick);
    }
  }, [orgDropdownOpen]);

  const handleOrgSelect = (orgId: string) => {
    onOrgChange?.(orgId);
    setOrgDropdownOpen(false);
  };

  const selectedOrgName = organizations.find((o) => o.id === selectedOrgId)?.name || '';

  const handleQuickAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!quickAddDate) return;

    setIsSubmitting(true);
    try {
      await onQuickAdd?.({ eventType: quickAddType, date: quickAddDate });
      setQuickAddDate('');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Format event date/time for display in upcoming events list
  const formatEventDateTime = (event: UpcomingEvent): string => {
    const isMultiDay = event.startDate.toDateString() !== event.endDate.toDateString();

    if (isMultiDay) {
      // Multi-day: show date range with times
      const startOpts: Intl.DateTimeFormatOptions = {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
      };
      const endOpts: Intl.DateTimeFormatOptions = {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
      };
      return `${event.startDate.toLocaleDateString('en-GB', startOpts)} – ${event.endDate.toLocaleDateString('en-GB', endOpts)}`;
    }

    // Single day with time range: show date and both times
    const dateOpts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
    const timeOpts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
    return `${event.startDate.toLocaleDateString('en-GB', dateOpts)} ${event.startDate.toLocaleTimeString('en-GB', timeOpts)} – ${event.endDate.toLocaleTimeString('en-GB', timeOpts)}`;
  };

  return (
    <aside
      className={`flex-shrink-0 bg-[#1B2A4A] text-white flex flex-col h-full transition-all duration-200 overflow-hidden ${
        isExpanded ? 'w-80' : 'w-16'
      }`}
    >
      {/* Toggle button / title bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0" style={{ borderColor: '#24355c' }}>
        {isExpanded && (
          <span className="text-sm font-semibold">Upcoming Events</span>
        )}
        <button
          onClick={onToggle}
          className="text-gray-300 hover:text-white transition-colors"
          aria-label={isExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          {isExpanded ? '◀' : '▶'}
        </button>
      </div>

      {isExpanded && (
        <>
          {/* Organization Switcher */}
          {organizations.length > 0 && (
            <div className="px-4 pb-3 border-b flex-shrink-0" style={{ borderColor: '#24355c' }}>
              <div className="relative" ref={orgDropdownRef}>
                <button
                  onClick={() => setOrgDropdownOpen(!orgDropdownOpen)}
                  className="w-full px-3 py-2 rounded text-sm bg-[#24355c] border text-left flex items-center justify-between"
                  style={{ borderColor: '#3a4f7a', color: orgDropdownOpen ? '#F5A623' : '#e2e8f0' }}
                >
                  <span className="truncate">{selectedOrgName || 'Select organization'}</span>
                  <svg
                    className={`w-4 h-4 flex-shrink-0 ml-2 transition-transform ${orgDropdownOpen ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {orgDropdownOpen && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-[#24355c] border rounded shadow-lg z-50 max-h-60 overflow-y-auto" style={{ borderColor: '#3a4f7a' }}>
                    {organizations.map((org) => (
                      <button
                        key={org.id}
                        onClick={() => handleOrgSelect(org.id)}
                        className={`w-full px-3 py-2 text-left text-sm transition-colors truncate ${
                          org.id === selectedOrgId
                            ? 'bg-[#1B2A4A] text-[#F5A623]'
                            : 'text-gray-300 hover:bg-[#1B2A4A] hover:text-white'
                        }`}
                      >
                        {org.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Quick Add Form */}
          <div className="px-4 pb-3 border-b flex-shrink-0" style={{ borderColor: '#24355c' }}>
            <h3 className="text-sm font-semibold mb-2">Quick Add</h3>
            <form onSubmit={handleQuickAddSubmit} className="space-y-2">
              {/* Event Type dropdown */}
              <select
                value={quickAddType}
                onChange={(e) => setQuickAddType(e.target.value as CalendarEventType)}
                className="w-full px-3 py-2 rounded text-sm bg-[#24355c] border text-white"
                style={{ borderColor: '#3a4f7a' }}
              >
                {EVENT_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>

              {/* Date input */}
              <input
                type="date"
                value={quickAddDate}
                onChange={(e) => setQuickAddDate(e.target.value)}
                className="w-full px-3 py-2 rounded text-sm bg-[#24355c] border text-white"
                style={{ borderColor: '#3a4f7a' }}
              />

              {/* Add Event button */}
              <button
                type="submit"
                disabled={isSubmitting || !quickAddDate}
                className="w-full py-2 rounded text-sm font-semibold text-white transition-colors disabled:opacity-50"
                style={{ backgroundColor: '#F5A623' }}
              >
                {isSubmitting ? 'Adding...' : 'Add Event'}
              </button>
            </form>
          </div>

          {/* Upcoming Events List - scrollable container */}
          <div className="flex-1 overflow-y-auto px-4 pb-4">
            {upcomingEvents.length === 0 ? (
              <p className="text-sm text-gray-400">No upcoming events</p>
            ) : (
              <ul className="space-y-2">
                {upcomingEvents.map((event) => (
                  <li key={event.id}>
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
