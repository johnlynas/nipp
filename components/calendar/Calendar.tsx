'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import type { CalendarView, CalendarEvent, QuickAddInput } from './types';
import { getMonthName } from './calendar-utils';

// Sub-components
import CalendarMonthView from './CalendarMonthView';
import CalendarWeekView from './CalendarWeekView';
import CalendarDayView from './CalendarDayView';
import CalendarSidebar from './CalendarSidebar';
import CalendarEventModal from './CalendarEventModal';
import CalendarContextMenu from './CalendarContextMenu';
import { ConfirmDialog } from '@/components/dashboard/ConfirmDialog';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CalendarProps {
  organizationId: string;
  initialView?: CalendarView;
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Calendar({
  organizationId,
  initialView = 'month',
  className,
}: CalendarProps) {
  // View state
  const [view, setView] = useState<CalendarView>(initialView);

  // Date navigation state
  const today = new Date();
  const [currentDate, setCurrentDate] = useState(new Date(today));
  // Derive a stable string key for date changes (used in useEffect deps)
  const currentDateKey = currentDate.toISOString();

  // Sidebar state
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Data state
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [defaultCalendarId, setDefaultCalendarId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Modal state
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [viewMode, setViewMode] = useState(false);

  // Context menu state
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [contextMenuDate, setContextMenuDate] = useState<Date | null>(null);
  const [contextMenuEvent, setContextMenuEvent] = useState<CalendarEvent | null>(null);

  // Delete confirmation state
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [eventToDelete, setEventToDelete] = useState<CalendarEvent | null>(null);

  // Organizations for switcher (super admin only)
  const [organizations, setOrganizations] = useState<{ id: string; name: string }[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(organizationId);

  // Drag-and-drop state
  const [draggingEventId, setDraggingEventId] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // API helpers
  // ---------------------------------------------------------------------------

  const fetchCalendars = useCallback(async (orgId: string) => {
    try {
      const res = await fetch(`/api/organizations/${orgId}/calendar`);
      if (!res.ok) return;
      const calendars = await res.json();
      const def = calendars.find((c: { isDefault: boolean }) => c.isDefault);
      if (def) {
        setDefaultCalendarId(def.id);
      } else if (calendars.length > 0) {
        // No default marked — fall back to first calendar
        setDefaultCalendarId(calendars[0].id);
      }
    } catch {
      // Silently fail — calendar creation will still work with a fallback
    }
  }, []);

  const fetchEvents = useCallback(async (orgId: string, start: Date, end: Date) => {
    try {
      const res = await fetch(
        `/api/organizations/${orgId}/calendar-events?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`
      );
      if (!res.ok) return;
      const data = await res.json();
      // Convert string dates back to Date objects
      const parsed: CalendarEvent[] = data.map((e: Record<string, unknown>) => ({
        ...e,
        startDate: new Date(e.startDate as string),
        endDate: new Date(e.endDate as string),
        createdAt: new Date(e.createdAt as string),
        updatedAt: new Date(e.updatedAt as string),
      }));

      // Merge with existing events instead of replacing — keeps events from other months
      setEvents((prev) => {
        const merged = new Map<string, CalendarEvent>();

        // Keep existing events that fall outside the fetched range
        for (const event of prev) {
          const evStart = event.startDate instanceof Date ? event.startDate : new Date(event.startDate);
          const evEnd = event.endDate instanceof Date ? event.endDate : new Date(event.endDate);
          if (isNaN(evStart.getTime()) || isNaN(evEnd.getTime())) continue;
          if (evEnd < start || evStart > end) {
            merged.set(event.id, event);
          }
        }

        // Add/update with fetched events (these are in the current range)
        for (const event of parsed) {
          merged.set(event.id, event);
        }

        return Array.from(merged.values()).sort((a, b) => {
          const aStart = a.startDate instanceof Date ? a.startDate : new Date(a.startDate);
          const bStart = b.startDate instanceof Date ? b.startDate : new Date(b.startDate);
          return aStart.getTime() - bStart.getTime();
        });
      });
    } catch {
      // Silently fail — calendar will show empty
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchOrganizations = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/organizations/list');
      if (!res.ok) return;
      const data = await res.json();
      setOrganizations(data.organizations || []);
    } catch {
      // Silently fail
    }
  }, []);

  const handleOrgChange = useCallback((orgId: string) => {
    setSelectedOrgId(orgId);
    // Update URL to reflect the selected org
    const url = new URL(window.location.href);
    url.searchParams.set('org', orgId);
    window.history.pushState({}, '', url.toString());
  }, []);

  // Calculate date range based on current view
  const getDateRange = useCallback(() => {
    let start: Date, end: Date;
    if (view === 'month') {
      start = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
      end = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0, 23, 59, 59);
    } else if (view === 'week') {
      start = new Date(currentDate);
      start.setDate(start.getDate() - start.getDay()); // Sunday
      end = new Date(start);
      end.setDate(end.getDate() + 6); // Saturday
      end.setHours(23, 59, 59, 999);
    } else {
      start = new Date(currentDate);
      end = new Date(currentDate);
      end.setHours(23, 59, 59, 999);
    }
    return { start, end };
  }, [currentDate, view]);

  // Load calendars and events on mount, then re-fetch when dates change
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (cancelled) return;
      setLoading(true);
      await fetchCalendars(selectedOrgId || organizationId);

      const { start, end } = getDateRange();
      await fetchEvents(selectedOrgId || organizationId, start, end);
    };

    load();
    return () => { cancelled = true; };
  }, [selectedOrgId, organizationId, currentDateKey, view, fetchCalendars, fetchEvents, getDateRange]);

  // Fetch organizations list on mount (for super admin org switcher)
  useEffect(() => {
    fetchOrganizations();
  }, [fetchOrganizations]);

  // ---------------------------------------------------------------------------
  // Navigation handlers
  // ---------------------------------------------------------------------------

  const navigatePrev = useCallback(() => {
    setCurrentDate((prev) => {
      const next = new Date(prev);
      if (view === 'month') {
        next.setMonth(next.getMonth() - 1);
      } else if (view === 'week') {
        next.setDate(next.getDate() - 7);
      } else {
        next.setDate(next.getDate() - 1);
      }
      return next;
    });
  }, [view]);

  const navigateNext = useCallback(() => {
    setCurrentDate((prev) => {
      const next = new Date(prev);
      if (view === 'month') {
        next.setMonth(next.getMonth() + 1);
      } else if (view === 'week') {
        next.setDate(next.getDate() + 7);
      } else {
        next.setDate(next.getDate() + 1);
      }
      return next;
    });
  }, [view]);

  const navigateToday = useCallback(() => {
    setCurrentDate(new Date());
  }, []);

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------

  const handleEventClick = useCallback((event: CalendarEvent) => {
    setSelectedEvent(event);
    setModalOpen(true);
  }, []);

  const handleViewEvent = useCallback((event: CalendarEvent) => {
    setSelectedEvent(event);
    setViewMode(true);
    setModalOpen(true);
  }, []);

  const handleDateClick = useCallback((date: Date) => {
    setCurrentDate(date);
  }, []);

  const handleDateRightClick = useCallback((date: Date, e: React.MouseEvent) => {
    setContextMenuPos({ x: e.clientX, y: e.clientY });
    setContextMenuDate(date);
  }, []);

  const handleEventDragStart = useCallback((event: CalendarEvent, _e: React.DragEvent) => {
    setDraggingEventId(event.id);
  }, []);

  const handleDrop = useCallback(async (date: Date, eventId: string) => {
    // Find the event in local state
    const existing = events.find((e) => e.id === eventId);
    if (!existing || existing.id.startsWith('temp-')) return;

    const start = existing.startDate instanceof Date ? existing.startDate : new Date(existing.startDate);
    const end = existing.endDate instanceof Date ? existing.endDate : new Date(existing.endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return;

    const duration = end.getTime() - start.getTime();
    const newStart = new Date(date);
    newStart.setHours(start.getHours(), start.getMinutes());
    const newEnd = new Date(newStart.getTime() + duration);

    // Optimistically update local state so UI reflects the move immediately
    const optimisticUpdate = {
      ...existing,
      startDate: newStart,
      endDate: newEnd,
    };
    setEvents((prev) => prev.map((e) => (e.id === eventId ? optimisticUpdate : e)));

    // Persist to API in the background
    try {
      const res = await fetch(
        `/api/organizations/${organizationId}/calendar-events/${eventId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            startDate: newStart.toISOString(),
            endDate: newEnd.toISOString(),
          }),
        }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to move event' }));
        console.error('Failed to move event:', err);
        // Revert on failure
        setEvents((prev) => prev.map((e) => (e.id === eventId ? existing : e)));
        return;
      }

      const { event: updatedEvent }: { event: CalendarEvent } = await res.json();
      setEvents((prev) => prev.map((e) => (e.id === updatedEvent.id ? updatedEvent : e)));
    } catch {
      console.error('Error moving event');
      // Revert on error
      setEvents((prev) => prev.map((e) => (e.id === eventId ? existing : e)));
    }
  }, [events, organizationId]);

  const handleDragEnd = useCallback(() => {
    setDraggingEventId(null);
  }, []);

  const handleQuickAdd = useCallback(async (input: QuickAddInput) => {
    // In production, call POST API to create event
    const newEvent: CalendarEvent = {
      id: `temp-${Date.now()}`,
      title: `${input.eventType} Event`,
      startDate: new Date(`${input.date}T10:00`),
      endDate: new Date(`${input.date}T11:00`),
      eventType: input.eventType,
      calendarId: '',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    setEvents((prev) => [...prev, newEvent]);
  }, []);

  const handleSaveEvent = useCallback(async (eventData: Partial<CalendarEvent>) => {
    if (!selectedEvent) return;

    const isExisting = selectedEvent.id && !selectedEvent.id.startsWith('temp-');

    // Ensure we have a calendar ID before creating events
    let targetCalendarId = defaultCalendarId;
    if (!targetCalendarId) {
      // Try to fetch calendars again
      try {
        const calRes = await fetch(`/api/organizations/${organizationId}/calendar`);
        if (calRes.ok) {
          const calendars = await calRes.json();
          const def = calendars.find((c: { isDefault: boolean }) => c.isDefault);
          if (def) {
            targetCalendarId = def.id;
            setDefaultCalendarId(def.id);
          } else if (calendars.length > 0) {
            targetCalendarId = calendars[0].id;
            setDefaultCalendarId(calendars[0].id);
          }
        }
      } catch {
        // Silently fail
      }
    }

    if (!targetCalendarId) {
      // No calendar ID known — try to create a default one
      const calRes = await fetch(`/api/organizations/${organizationId}/calendar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Main Calendar', description: 'Default calendar' }),
      });

      if (calRes.ok) {
        const { calendar: newCal }: { calendar: { id: string } } = await calRes.json();
        targetCalendarId = newCal.id;
        setDefaultCalendarId(newCal.id);
      } else {
        // Calendar may already exist — re-fetch to find it
        const listRes = await fetch(`/api/organizations/${organizationId}/calendar`);
        if (listRes.ok) {
          const calendars = await listRes.json();
          const def = calendars.find((c: { isDefault: boolean }) => c.isDefault);
          if (def) {
            targetCalendarId = def.id;
            setDefaultCalendarId(def.id);
          } else if (calendars.length > 0) {
            // Fall back to first available calendar
            targetCalendarId = calendars[0].id;
            setDefaultCalendarId(calendars[0].id);
          }
        }
      }

      if (!targetCalendarId) {
        throw new Error('No calendar available. Please contact an admin.');
      }
    }

    if (isExisting) {
      // Update existing event via PATCH
      const res = await fetch(
        `/api/organizations/${organizationId}/calendar-events/${selectedEvent.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: eventData.title,
            description: eventData.description,
            startDate: (eventData.startDate as Date).toISOString(),
            endDate: (eventData.endDate as Date).toISOString(),
            eventType: eventData.eventType,
          }),
        }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to update event' }));
        throw new Error(err.error || 'Failed to update event');
      }

      const { event: updatedEvent }: { event: CalendarEvent } = await res.json();
      setEvents((prev) => prev.map((e) => (e.id === updatedEvent.id ? updatedEvent : e)));
    } else {
      // Create new event via POST
      const res = await fetch(`/api/organizations/${organizationId}/calendar-events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: eventData.title,
          description: eventData.description,
          startDate: (eventData.startDate as Date).toISOString(),
          endDate: (eventData.endDate as Date).toISOString(),
          calendarId: targetCalendarId,
          eventType: eventData.eventType,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to create event' }));
        throw new Error(err.error || 'Failed to create event');
      }

      const { event: createdEvent }: { event: CalendarEvent } = await res.json();
      setEvents((prev) => [...prev, createdEvent]);
    }
  }, [selectedEvent, organizationId, defaultCalendarId]);

  const handleContextMenuClose = useCallback(() => {
    setContextMenuPos(null);
    setContextMenuDate(null);
    setContextMenuEvent(null);
  }, []);

  const handleEventRightClick = useCallback((event: CalendarEvent, e: React.MouseEvent) => {
    setContextMenuPos({ x: e.clientX, y: e.clientY });
    setContextMenuEvent(event);
  }, []);

  const handleAddEventFromContext = useCallback((date: Date) => {
    // Open modal pre-populated with the clicked date
    const newEvent: CalendarEvent = {
      id: `temp-${Date.now()}`,
      title: 'New Event',
      startDate: new Date(`${date.toISOString().slice(0, 10)}T10:00`),
      endDate: new Date(`${date.toISOString().slice(0, 10)}T11:00`),
      eventType: 'OTHER',
      calendarId: '',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    setSelectedEvent(newEvent);
    setModalOpen(true);
  }, []);

  const handleEditEventFromContext = useCallback((event: CalendarEvent) => {
    // Open modal with existing event for editing
    setSelectedEvent(event);
    setViewMode(false);
    setModalOpen(true);
  }, []);

  // ---------------------------------------------------------------------------
  // Delete event handlers
  // ---------------------------------------------------------------------------

  const handleDeleteEventFromContext = useCallback((event: CalendarEvent) => {
    setEventToDelete(event);
    setDeleteConfirmOpen(true);
  }, []);

  const handleDeleteEventConfirm = useCallback(async () => {
    if (!eventToDelete) return;

    // Optimistically remove from local state
    setEvents((prev) => prev.filter((e) => e.id !== eventToDelete.id));
    setDeleteConfirmOpen(false);

    try {
      const res = await fetch(
        `/api/organizations/${organizationId}/calendar-events/${eventToDelete.id}`,
        { method: 'DELETE' }
      );

      if (!res.ok) {
        // Re-fetch events to sync with server on failure
        let start: Date, end: Date;
        if (view === 'month') {
          start = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
          end = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0, 23, 59, 59);
        } else if (view === 'week') {
          start = new Date(currentDate);
          start.setDate(start.getDate() - start.getDay());
          end = new Date(start);
          end.setDate(end.getDate() + 6);
          end.setHours(23, 59, 59, 999);
        } else {
          start = new Date(currentDate);
          end = new Date(currentDate);
          end.setHours(23, 59, 59, 999);
        }
        await fetchEvents(organizationId, start, end);
      }
    } catch {
      // Re-fetch events to sync with server on error
      let start: Date, end: Date;
      if (view === 'month') {
        start = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
        end = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0, 23, 59, 59);
      } else if (view === 'week') {
        start = new Date(currentDate);
        start.setDate(start.getDate() - start.getDay());
        end = new Date(start);
        end.setDate(end.getDate() + 6);
        end.setHours(23, 59, 59, 999);
      } else {
        start = new Date(currentDate);
        end = new Date(currentDate);
        end.setHours(23, 59, 59, 999);
      }
      await fetchEvents(organizationId, start, end);
    }
  }, [eventToDelete, organizationId, view, currentDate, fetchEvents]);

  // ---------------------------------------------------------------------------
  // Upcoming events for sidebar
  // ---------------------------------------------------------------------------

  const upcomingEvents = useMemo(() => {
    const now = new Date();
    // Deduplicate by ID (multi-day events may appear multiple times in the raw list)
    const seen = new Set<string>();
    return events
      .filter((e) => {
        if (seen.has(e.id)) return false;
        seen.add(e.id);
        return e.startDate >= now;
      })
      .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())
      .slice(0, 15);
  }, [events]);

  // ---------------------------------------------------------------------------
  // Render view title
  // ---------------------------------------------------------------------------

  const renderViewTitle = () => {
    if (view === 'month') {
      return `${getMonthName(currentDate.getMonth())} ${currentDate.getFullYear()}`;
    }

    if (view === 'week') {
      const weekStart = new Date(currentDate);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);

      return `${getMonthName(weekStart.getMonth())} ${weekStart.getFullYear()} – ${getMonthName(weekEnd.getMonth())} ${weekEnd.getDate()}, ${weekEnd.getFullYear()}`;
    }

    return currentDate.toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  };

  // ---------------------------------------------------------------------------
  // Render calendar grid based on current view
  // ---------------------------------------------------------------------------

  const renderCalendarGrid = () => {
    if (view === 'month') {
      return (
        <CalendarMonthView
          year={currentDate.getFullYear()}
          month={currentDate.getMonth()}
          events={events}
          onDateClick={handleDateClick}
          onEventClick={handleEventClick}
          onDateRightClick={handleDateRightClick}
          onEventRightClick={handleEventRightClick}
          onEventDragStart={handleEventDragStart}
          onDragEnd={handleDragEnd}
          onDrop={handleDrop}
          draggingEventId={draggingEventId}
        />
      );
    }

    if (view === 'week') {
      return (
        <CalendarWeekView
          referenceDate={currentDate}
          events={events}
          onDateClick={handleDateClick}
          onEventClick={handleEventClick}
          onDateRightClick={handleDateRightClick}
          onEventRightClick={handleEventRightClick}
          onEventDragStart={handleEventDragStart}
          onDragEnd={handleDragEnd}
          onDrop={handleDrop}
          draggingEventId={draggingEventId}
        />
      );
    }

    return (
      <CalendarDayView
        date={currentDate}
        events={events}
        onDateClick={handleDateClick}
        _onEventClick={handleEventClick}
        onDateRightClick={handleDateRightClick}
        onEventRightClick={handleEventRightClick}
        onEventDragStart={handleEventDragStart}
        onDragEnd={handleDragEnd}
        onDrop={handleDrop}
        draggingEventId={draggingEventId}
      />
    );
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className={`flex h-full ${className || ''}`} style={{ backgroundColor: '#f8f9fa' }}>
      {/* Main calendar area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-3 bg-white border-b" style={{ borderColor: '#dee2e6' }}>
          {/* Navigation */}
          <div className="flex items-center gap-2">
            <button
              onClick={navigatePrev}
              className="p-1.5 rounded hover:bg-gray-100 transition-colors"
              style={{ color: '#1B2A4A' }}
            >
              ‹
            </button>
            <button
              onClick={navigateToday}
              className="px-3 py-1.5 rounded text-sm font-medium border hover:bg-gray-50 transition-colors"
              style={{ borderColor: '#dee2e6', color: '#1B2A4A' }}
            >
              Today
            </button>
            <button
              onClick={navigateNext}
              className="p-1.5 rounded hover:bg-gray-100 transition-colors"
              style={{ color: '#1B2A4A' }}
            >
              ›
            </button>
          </div>

          {/* View title */}
          <h2 className="text-lg font-semibold" style={{ color: '#1B2A4A' }}>
            {renderViewTitle()}
          </h2>

          {/* View toggle */}
          <div className="flex items-center gap-1">
            {(['month', 'week', 'day'] as CalendarView[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                  view === v ? 'text-white' : 'hover:bg-gray-100'
                }`}
                style={view === v ? { backgroundColor: '#F5A623' } : { color: '#1B2A4A' }}
              >
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>

          {/* Sidebar toggle */}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-1.5 rounded hover:bg-gray-100 transition-colors"
            style={{ color: '#1B2A4A' }}
          >
            {sidebarOpen ? '◀' : '▶'}
          </button>
        </div>

        {/* Calendar grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center h-full" style={{ color: '#1B2A4A' }}>
              Loading calendar...
            </div>
          ) : (
            renderCalendarGrid()
          )}
        </div>
      </div>

      {/* Sidebar */}
      <CalendarSidebar
        upcomingEvents={upcomingEvents}
        isExpanded={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
        onQuickAdd={handleQuickAdd}
        organizations={organizations}
        selectedOrgId={selectedOrgId}
        onOrgChange={handleOrgChange}
      />

      {/* Event detail modal */}
      <CalendarEventModal
        key={selectedEvent?.id + (viewMode ? '-view' : '-edit')}
        event={selectedEvent}
        isOpen={modalOpen}
        onClose={() => { setModalOpen(false); setViewMode(false); setSelectedEvent(null); }}
        onSave={handleSaveEvent}
        isViewMode={viewMode}
      />

      {/* Context menu */}
      <CalendarContextMenu
        position={contextMenuPos}
        dateCell={contextMenuDate ? { date: contextMenuDate, isCurrentMonth: true } : null}
        eventCell={contextMenuEvent ? { event: contextMenuEvent } : null}
        onClose={handleContextMenuClose}
        onAddEvent={handleAddEventFromContext}
        onViewEvent={handleViewEvent}
        onEditEvent={handleEditEventFromContext}
        onDeleteEvent={handleDeleteEventFromContext}
      />

      {/* Delete confirmation dialog */}
      <ConfirmDialog
        isOpen={deleteConfirmOpen}
        onClose={() => { setDeleteConfirmOpen(false); setEventToDelete(null); }}
        onConfirm={handleDeleteEventConfirm}
        title="Delete Event"
        message={`Are you sure you want to delete "${eventToDelete?.title}"? This action cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { CalendarEventModal };
