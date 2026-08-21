'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import type { CalendarView, CalendarEvent, QuickAddInput } from './types';
import { getMonthName, getEventInstanceKey, toLocalDateInputValue } from './calendar-utils';

// Sub-components
import CalendarMonthView from './CalendarMonthView';
import CalendarWeekView from './CalendarWeekView';
import CalendarDayView from './CalendarDayView';
import CalendarYearView from './CalendarYearView';
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

  // Abort controller to cancel stale in-flight fetches when navigating months
  const abortRef = useRef<AbortController | null>(null);

  // ---------------------------------------------------------------------------
  // API helpers
  // ---------------------------------------------------------------------------

  const fetchCalendars = useCallback(async (orgId: string) => {
    console.log('[Calendar] fetchCalendars called for org:', orgId);
    try {
      const res = await fetch(`/api/organizations/${orgId}/calendar`);
      console.log('[Calendar] Calendars fetch status:', res.status, 'for org:', orgId);
      if (!res.ok) {
        const errText = await res.text();
        console.log('[Calendar] Calendars fetch error:', errText);
        return;
      }
      const calendars = await res.json();
      console.log('[Calendar] Calendars response:', calendars);
      const def = calendars.find((c: { isDefault: boolean }) => c.isDefault);
      if (def) {
        setDefaultCalendarId(def.id);
      } else if (calendars.length > 0) {
        // No default marked — fall back to first calendar
        setDefaultCalendarId(calendars[0].id);
      }
    } catch (err) {
      console.log('[Calendar] Calendars fetch exception:', err);
    }
  }, []);

  const fetchEvents = useCallback(async (orgId: string, start: Date, end: Date, signal?: AbortSignal) => {
    console.log('[Calendar] fetchEvents called:', { orgId, start: start.toISOString(), end: end.toISOString() });
    try {
      const res = await fetch(
        `/api/organizations/${orgId}/calendar-events?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`,
        { signal }
      );
      if (!res.ok) {
        console.log('[Calendar] fetchEvents failed:', res.status);
        return;
      }
      // Skip if this request was aborted while waiting for response
      if (signal?.aborted) {
        console.log('[Calendar] fetchEvents: request aborted, skipping');
        return;
      }

      const data = await res.json();
      console.log('[Calendar] fetchEvents API returned', data.length, 'events:', JSON.stringify(data.map((e: CalendarEvent) => ({ id: e.id, title: e.title, startDate: e.startDate, recurrence: !!e.recurrence }))));
      // Convert string dates back to Date objects
      const parsed: CalendarEvent[] = data.map((e: Record<string, unknown>) => ({
        ...e,
        startDate: new Date(e.startDate as string),
        endDate: new Date(e.endDate as string),
        createdAt: new Date(e.createdAt as string),
        updatedAt: new Date(e.updatedAt as string),
      }));

      // Merge with existing events instead of replacing — keeps events from other months.
      // Keyed by instance key (id + start date) so recurring events, whose expanded
      // instances share the base event id, are kept as separate occurrences.
      setEvents((prev) => {
        console.log('[Calendar] merge: prev has', prev.length, 'events');
        const merged = new Map<string, CalendarEvent>();

        // Keep existing events that fall outside the fetched range
        for (const event of prev) {
          const evStart = event.startDate instanceof Date ? event.startDate : new Date(event.startDate);
          const evEnd = event.endDate instanceof Date ? event.endDate : new Date(event.endDate);
          if (isNaN(evStart.getTime()) || isNaN(evEnd.getTime())) continue;
          if (evEnd < start || evStart > end) {
            console.log('[Calendar] merge: keeping event outside range:', getEventInstanceKey(event), evStart.toISOString());
            merged.set(getEventInstanceKey(event), event);
          }
        }

        // Add/update with fetched events (these are in the current range)
        for (const event of parsed) {
          console.log('[Calendar] merge: adding fetched event:', getEventInstanceKey(event), (event.startDate instanceof Date ? event.startDate : new Date(event.startDate)).toISOString());
          merged.set(getEventInstanceKey(event), event);
        }

        const result = Array.from(merged.values()).sort((a, b) => {
          const aStart = a.startDate instanceof Date ? a.startDate : new Date(a.startDate);
          const bStart = b.startDate instanceof Date ? b.startDate : new Date(b.startDate);
          return aStart.getTime() - bStart.getTime();
        });
        console.log('[Calendar] merge: result has', result.length, 'events');
        // [CAL-DEBUG] duplicates after merge? (should be impossible — Map is keyed by instance key)
        {
          const keys = new Map<string, number>();
          for (const e of result) {
            const k = getEventInstanceKey(e);
            keys.set(k, (keys.get(k) || 0) + 1);
          }
          const dups = [...keys.entries()].filter(([, n]) => n > 1);
          console.log(`[CAL-DEBUG] fetchEvents: merged state duplicates=${dups.length ? JSON.stringify(dups) : 'none'}`);
        }
        return result;
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
    } else if (view === 'year') {
      start = new Date(currentDate.getFullYear(), 0, 1);
      end = new Date(currentDate.getFullYear(), 11, 31, 23, 59, 59);
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

    // Cancel any in-flight fetch from a previous navigation
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const load = async () => {
      if (cancelled) return;
      console.log('[Calendar] Mount/load effect:', { selectedOrgId, organizationId });
      setLoading(true);
      await fetchCalendars(selectedOrgId || organizationId);

      const { start, end } = getDateRange();
      console.log('[Calendar] Fetching events for org:', selectedOrgId || organizationId, 'range:', start.toISOString(), '-', end.toISOString());
      await fetchEvents(selectedOrgId || organizationId, start, end, controller.signal);
    };

    load();
    return () => { cancelled = true; abortRef.current?.abort(); };
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
      } else if (view === 'year') {
        next.setFullYear(next.getFullYear() - 1);
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
      } else if (view === 'year') {
        next.setFullYear(next.getFullYear() + 1);
      } else {
        next.setDate(next.getDate() + 1);
      }
      return next;
    });
  }, [view]);

  const navigateToday = useCallback(() => {
    const today = new Date();
    setCurrentDate(today);
  }, []);

  // Drill from the Year view into a specific month (switches to Month view)
  const handleMonthClick = useCallback((month: number) => {
    setCurrentDate(new Date(currentDate.getFullYear(), month, 1));
    setView('month');
  }, [currentDate]);

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

  const handleEventDragStart = useCallback((event: CalendarEvent, e: React.DragEvent) => {
    setDraggingEventId(event.id);
    // Attach recurrence info to drag data for use in handleDrop
    e.dataTransfer.setData(
      'application/recurrence',
      JSON.stringify(event.recurrence ?? null),
    );
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

    // Recurring events: moving an instance excludes the original date and
    // creates a one-off at the new location — this avoids shifting the whole series.
    const isRecurring = !!existing.recurrence;

    if (!isRecurring) {
      // Optimistically update local state so UI reflects the move immediately
      const optimisticUpdate = {
        ...existing,
        startDate: newStart,
        endDate: newEnd,
      };
      setEvents((prev) => prev.map((e) => (e.id === eventId ? optimisticUpdate : e)));
    }

    // Persist to API in the background
    try {
      if (isRecurring) {
        // Use edit scope "this" to create a detached override at the new location.
        // This is cleaner than the old two-step (exclude + create one-off) flow.
        const patchRes = await fetch(
          `/api/organizations/${organizationId}/calendar-events/${eventId}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              startDate: newStart.toISOString(),
              endDate: newEnd.toISOString(),
              editScope: 'this',
              clickedDate: toLocalDateInputValue(start),
            }),
          }
        );

        if (!patchRes.ok) {
          const err = await patchRes.json().catch(() => ({ error: 'Failed to move event' }));
          console.error('Failed to move recurring event:', err);
          return;
        }

        const { event: overrideEvent }: { event: CalendarEvent } = await patchRes.json();
        setEvents((prev) => prev.map((e) => (e.id === eventId ? overrideEvent : e)));
      } else {
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
      }
    } catch {
      console.error('Error moving event');
      // Revert on error
      if (!isRecurring) {
        setEvents((prev) => prev.map((e) => (e.id === eventId ? existing : e)));
      }
    }
  }, [events, organizationId]);

  const handleDragEnd = useCallback(() => {
    setDraggingEventId(null);
  }, []);

  const handleQuickAdd = useCallback(async (input: QuickAddInput) => {
    // Ensure we have a calendar ID before creating the event
    let targetCalendarId = defaultCalendarId;
    if (!targetCalendarId) {
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
      } catch { /* silently fail — will use fallback below */ }
    }

    if (!targetCalendarId) {
      throw new Error('No calendar available. Please contact an admin.');
    }

    const startDate = new Date(`${input.date}T10:00`);
    const endDate = new Date(`${input.date}T11:00`);

    const res = await fetch(`/api/organizations/${organizationId}/calendar-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: `${input.eventType} Event`,
        description: null,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        calendarId: targetCalendarId,
        eventType: input.eventType,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to create event' }));
      throw new Error(err.error || 'Failed to create event');
    }

    await res.json();

    // Refresh the visible range so the new event appears immediately
    const { start, end } = getDateRange();
    await fetchEvents(selectedOrgId || organizationId, start, end);
  }, [organizationId, defaultCalendarId, selectedOrgId, getDateRange, fetchEvents]);

  const handleSaveEvent = useCallback(async (eventData: Partial<CalendarEvent>, saveOptions?: { editScope?: string; clickedDate?: string }) => {
    if (!selectedEvent) return;

    const isExisting = selectedEvent.id && !selectedEvent.id.startsWith('temp-');

    const effectiveOrgId = selectedOrgId || organizationId;
    console.log('[Calendar] handleSaveEvent:', { 
      selectedOrgId, 
      organizationId, 
      effectiveOrgId,
      defaultCalendarId,
    });

    // Ensure we have a calendar ID before creating events
    let targetCalendarId = defaultCalendarId;
    if (!targetCalendarId) {
      // Try to fetch calendars again
      try {
        console.log('[Calendar] Fetching calendars for org:', effectiveOrgId);
        const calRes = await fetch(`/api/organizations/${effectiveOrgId}/calendar`);
        console.log('[Calendar] Calendars fetch status:', calRes.status);
        if (calRes.ok) {
          const calendars = await calRes.json();
          console.log('[Calendar] Calendars response:', calendars);
          const def = calendars.find((c: { isDefault: boolean }) => c.isDefault);
          if (def) {
            targetCalendarId = def.id;
            setDefaultCalendarId(def.id);
          } else if (calendars.length > 0) {
            targetCalendarId = calendars[0].id;
            setDefaultCalendarId(calendars[0].id);
          }
        } else {
          const errBody = await calRes.text();
          console.log('[Calendar] Calendars fetch error:', errBody);
        }
      } catch (err) {
        console.log('[Calendar] Calendars fetch exception:', err);
      }
    }

    if (!targetCalendarId) {
      // No calendar ID known — try to create a default one
      console.log('[Calendar] Creating default calendar for org:', effectiveOrgId);
      const calRes = await fetch(`/api/organizations/${effectiveOrgId}/calendar`, {
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

    // Serialize the recurrence rule (null = does not repeat). Dates are
    // serialized to ISO strings by JSON.stringify.
    const recurrencePayload = eventData.recurrence ?? null;

    if (isExisting) {
      const oldStart = selectedEvent.startDate instanceof Date ? selectedEvent.startDate : new Date(selectedEvent.startDate);
      const newStart = eventData.startDate as Date;
      const newEnd = eventData.endDate as Date;
      const dateChanged = oldStart.getTime() !== newStart.getTime();

      if (selectedEvent.recurrence && dateChanged) {
        // Recurring event with changed dates: exclude original, create one-off at new location
        const patchRes = await fetch(
          `/api/organizations/${organizationId}/calendar-events/${selectedEvent.id}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ excludedDate: toLocalDateInputValue(oldStart) }),
          }
        );

        if (!patchRes.ok) {
          const err = await patchRes.json().catch(() => ({ error: 'Failed to update event' }));
          throw new Error(err.error || 'Failed to update event');
        }

        const createRes = await fetch(`/api/organizations/${organizationId}/calendar-events`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: eventData.title ?? selectedEvent.title,
            description: eventData.description ?? null,
            startDate: newStart.toISOString(),
            endDate: newEnd.toISOString(),
            calendarId: defaultCalendarId || selectedEvent.calendarId,
            eventType: eventData.eventType ?? selectedEvent.eventType,
            color: (eventData.color as string | undefined) ?? undefined,
            propertyId: (eventData.propertyId as string | undefined) ?? undefined,
          }),
        });

        if (createRes.ok) {
          const { event: oneOff } = await createRes.json();
          setEvents((prev) => prev.map((e) => (e.id === selectedEvent.id ? oneOff : e)));
        } else {
          const err = await createRes.json().catch(() => ({ error: 'Failed to create moved event' }));
          throw new Error(err.error || 'Failed to create moved event');
        }
      } else {
        // Update existing event via PATCH (non-recurring or same dates)
        const patchBody: Record<string, unknown> = {
          title: eventData.title,
          description: eventData.description,
          startDate: newStart.toISOString(),
          endDate: newEnd.toISOString(),
          eventType: eventData.eventType,
          recurrence: recurrencePayload,
          color: (eventData.color as string | undefined) ?? null,
          propertyId: (eventData.propertyId as string | undefined) ?? null,
        };

        // Include edit scope for recurring instance edits
        if (saveOptions?.editScope) {
          patchBody.editScope = saveOptions.editScope;
        }
        if (saveOptions?.clickedDate) {
          patchBody.clickedDate = saveOptions.clickedDate;
        }

        const res = await fetch(
          `/api/organizations/${organizationId}/calendar-events/${selectedEvent.id}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patchBody),
          }
        );

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Failed to update event' }));
          throw new Error(err.error || 'Failed to update event');
        }

        const patchResponse = await res.json();
        // Edit scope handlers return { event, editScope }; plain updates return { event }
        const updatedEvent: CalendarEvent = patchResponse.event;

        if (updatedEvent.recurrence) {
          // Re-fetch the visible range so every occurrence reflects the new rule.
          // The merge logic in fetchEvents preserves instances outside the range,
          // so events in other months are not lost.
          const { start, end } = getDateRange();
          await fetchEvents(selectedOrgId || organizationId, start, end);
        } else {
          setEvents((prev) => prev.map((e) => (e.id === updatedEvent.id ? updatedEvent : e)));
        }
      }
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
          recurrence: recurrencePayload,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to create event' }));
        throw new Error(err.error || 'Failed to create event');
      }

      const { event: createdEvent }: { event: CalendarEvent } = await res.json();

      if (createdEvent.recurrence) {
        // Re-fetch the visible range so all occurrences of the new series render
        const { start, end } = getDateRange();
        await fetchEvents(selectedOrgId || organizationId, start, end);
      } else {
        setEvents((prev) => [...prev, createdEvent]);
      }
    }
  }, [selectedEvent, organizationId, defaultCalendarId, selectedOrgId, getDateRange, fetchEvents]);

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
    // Open modal pre-populated with the clicked date.
    // Use LOCAL date components — toISOString() is UTC and shifts the day
    // back by one in positive-UTC-offset timezones (e.g. BST).
    const dateStr = toLocalDateInputValue(date);
    const newEvent: CalendarEvent = {
      id: `temp-${Date.now()}`,
      title: 'New Event',
      startDate: new Date(`${dateStr}T10:00`),
      endDate: new Date(`${dateStr}T11:00`),
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
        const { start, end } = getDateRange();
        await fetchEvents(organizationId, start, end);
      }
    } catch {
      // Re-fetch events to sync with server on error
      const { start, end } = getDateRange();
      await fetchEvents(organizationId, start, end);
    }
  }, [eventToDelete, organizationId, getDateRange, fetchEvents]);

  // ---------------------------------------------------------------------------
  // Upcoming events for sidebar
  // ---------------------------------------------------------------------------

  const upcomingEvents = useMemo(() => {
    const now = new Date();
    // Deduplicate by instance key (multi-day events and recurring instances may
    // appear multiple times in the raw list)
    const seen = new Set<string>();
    return events
      .filter((e) => {
        const key = getEventInstanceKey(e);
        if (seen.has(key)) return false;
        seen.add(key);
        const start = e.startDate instanceof Date ? e.startDate : new Date(e.startDate);
        return !isNaN(start.getTime()) && start >= now;
      })
      .sort((a, b) => {
        const aStart = a.startDate instanceof Date ? a.startDate : new Date(a.startDate);
        const bStart = b.startDate instanceof Date ? b.startDate : new Date(b.startDate);
        return aStart.getTime() - bStart.getTime();
      })
      .slice(0, 15);
  }, [events]);

  // ---------------------------------------------------------------------------
  // Render view title
  // ---------------------------------------------------------------------------

  const renderViewTitle = () => {
    if (view === 'month') {
      return `${getMonthName(currentDate.getMonth())} ${currentDate.getFullYear()}`;
    }

    if (view === 'year') {
      return String(currentDate.getFullYear());
    }

    if (view === 'week') {
      return `${getMonthName(currentDate.getMonth())} ${currentDate.getFullYear()}`;
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

    if (view === 'year') {
      return (
        <CalendarYearView
          year={currentDate.getFullYear()}
          events={events}
          onMonthClick={handleMonthClick}
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


          {/* View title */}
          <h2 className="text-lg font-semibold" style={{ color: '#1B2A4A' }}>
            {renderViewTitle()}
          </h2>

          {/* View toggle */}
          <div className="flex items-center gap-1">
            {(['month', 'week', 'day', 'year'] as CalendarView[]).map((v) => (
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
