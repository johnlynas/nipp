'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import type { CalendarView, CalendarEvent } from './types';
import { getMonthName, getEventInstanceKey, getEventPosition, toLocalDateInputValue } from './calendar-utils';

// Sub-components
import CalendarMonthView from './CalendarMonthView';
import CalendarWeekView from './CalendarWeekView';
import CalendarDayView from './CalendarDayView';
import CalendarYearView from './CalendarYearView';
import CalendarSidebar from './CalendarSidebar';
import CalendarEventModal from './CalendarEventModal';
import CalendarContextMenu from './CalendarContextMenu';
import { ConfirmDialog } from '@/components/dashboard/ConfirmDialog';
import { PageSkeleton } from '@/components/dashboard/PageSkeleton';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CalendarProps {
  organizationId: string;
  initialView?: CalendarView;
  className?: string;
  /** Display name of the organisation whose calendar is shown (header title). */
  organizationName?: string;
  /** Fired when the super admin org switcher picks a different tenant org. */
  onOrganizationSelected?: (orgId: string, orgName: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Calendar({
  organizationId,
  initialView = 'month',
  className,
  organizationName,
  onOrganizationSelected,
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

  // Organizations for switcher (super admin only). The displayed org is the
  // one from the ?org= URL param when present (survives refresh), otherwise
  // the caller's own org.
  const [organizations, setOrganizations] = useState<{ id: string; name: string; isPlatform?: boolean }[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return organizationId;
    return new URL(window.location.href).searchParams.get('org');
  });

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

  // Fetch organizations list on mount (for super admin org switcher). When the
  // super admin has not explicitly picked an org (no ?org= param), default to
  // the Platform organization so the platform calendar is shown first.
  useEffect(() => {
    let cancelled = false;
    const loadOrgs = async () => {
      try {
        const res = await fetch('/api/admin/organizations/list');
        if (!res.ok) return;
        const data = await res.json();
        const orgs: { id: string; name: string; isPlatform?: boolean }[] = data.organizations || [];
        if (cancelled) return;
        setOrganizations(orgs);
        const urlHasOrg = new URLSearchParams(window.location.search).has('org');
        if (!urlHasOrg) {
          const platform = orgs.find((o) => o.isPlatform);
          if (platform) setSelectedOrgId(platform.id);
        }
      } catch {
        // Silently fail
      }
    };
    loadOrgs();
    return () => { cancelled = true; };
  }, []);

  const handleOrgChange = useCallback((orgId: string) => {
    setSelectedOrgId(orgId);
    // Update URL to reflect the selected org (survives refresh)
    const url = new URL(window.location.href);
    url.searchParams.set('org', orgId);
    window.history.pushState({}, '', url.toString());
    // Let the page update the header with the org name
    onOrganizationSelected?.(orgId, organizations.find((o) => o.id === orgId)?.name || '');
  }, [onOrganizationSelected, organizations]);

  // The organization currently displayed. For super admins this may differ
  // from `organizationId` (their own active org) when they use the org switcher.
  const effectiveOrgId = useMemo(
    () => selectedOrgId || organizationId,
    [selectedOrgId, organizationId]
  );

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
      await fetchCalendars(effectiveOrgId);

      const { start, end } = getDateRange();
      console.log('[Calendar] Fetching events for org:', effectiveOrgId, 'range:', start.toISOString(), '-', end.toISOString());
      await fetchEvents(effectiveOrgId, start, end, controller.signal);
    };

    load();
    return () => { cancelled = true; abortRef.current?.abort(); };
  }, [effectiveOrgId, organizationId, selectedOrgId, currentDateKey, view, fetchCalendars, fetchEvents, getDateRange]);

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

  // Clicking an Upcoming Events row in the sidebar jumps the main calendar
  // to the day view for that event's start date.
  const handleSidebarEventClick = useCallback((event: Pick<CalendarEvent, 'startDate'>) => {
    const start = event.startDate instanceof Date ? event.startDate : new Date(event.startDate);
    if (isNaN(start.getTime())) return;
    setCurrentDate(new Date(start.getFullYear(), start.getMonth(), start.getDate()));
    setView('day');
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

  const handleEventDragStart = useCallback((event: CalendarEvent, e: React.DragEvent) => {
    setDraggingEventId(event.id);
    // Attach recurrence info to drag data for use in handleDrop
    e.dataTransfer.setData(
      'application/recurrence',
      JSON.stringify(event.recurrence ?? null),
    );
  }, []);

  const handleDrop = useCallback(async (date: Date, eventId: string, e?: React.DragEvent) => {
    // Find the event in local state
    const existing = events.find((e) => e.id === eventId);
    if (!existing || existing.id.startsWith('temp-')) return;

    const start = existing.startDate instanceof Date ? existing.startDate : new Date(existing.startDate);
    const end = existing.endDate instanceof Date ? existing.endDate : new Date(existing.endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return;

    const duration = end.getTime() - start.getTime();

    // The Month view lays events out on a 2D week grid, so dragging a chip
    // between day cells only shifts the DATE — the time-of-day and duration are
    // preserved. It is the only view that does not forward a drag event (`e`),
    // which is how we tell it apart from the Week/Day views below. Those views
    // map the pointer's Y offset to a new hour instead, so they keep their
    // midnight baseline and adjust it in the block under `if (e)`.
    const newStart = new Date(date);
    if (!e) {
      newStart.setHours(start.getHours(), start.getMinutes(), 0, 0);
    }
    let newEnd = new Date(newStart.getTime() + duration);

    // VERTICAL DRAG → change the hour of day. We read the drag event's Y offset
    // relative to the month-grid container. `getEventPosition` returns the event's
    // current pixel top (startHour * 64) in the same coordinate space, so the
    // difference between the drop position and the original position, divided by
    // 64px per hour, is how many hours the event was dragged vertically. On a
    // horizontal drag the pointer returns to where it started, so this delta is
    // ~0 and the hour is preserved.
    if (e) {
      const container = e.currentTarget;
      if (container) {
        const rect = container.getBoundingClientRect();
        // Pixel position of the drop, measured from the TOP of the day column
        // (the same space the event `top` positions use).
        const dropY = e.clientY - rect.top;
        // Original top-of-event position, in that same container space.
        const containerPos = getEventPosition(existing).top;
        // Whole-hour distance dragged (64px per hour).
        const hoursMoved = Math.round(dropY / 64) - Math.round(containerPos / 64);
        let hour = start.getHours() + hoursMoved;
        // Clamp so an event can't be dragged outside 00:00–23:59 of its day.
        hour = Math.max(0, Math.min(23, hour));
        newStart.setHours(hour, start.getMinutes());
        // Re-derive the end from the new start by the original duration so the
        // event keeps its length in BOTH directions (forward and backward
        // dragging) and `end > start` always holds after the move.
        newEnd = new Date(newStart.getTime() + duration);
      }
    }

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
          `/api/organizations/${effectiveOrgId}/calendar-events/${eventId}`,
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
        // Replace ONLY the moved instance. Every expanded occurrence of a
        // recurring series shares the base event id, so an id-only match would
        // replace ALL instances with one record — producing N duplicate
        // entries (and duplicate React keys) in local state.
        const movedInstanceKey = getEventInstanceKey(existing);
        setEvents((prev) => prev.map((e) => (e.id === eventId && getEventInstanceKey(e) === movedInstanceKey ? overrideEvent : e)));
      } else {
        const res = await fetch(
          `/api/organizations/${effectiveOrgId}/calendar-events/${eventId}`,
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
  }, [events, effectiveOrgId]);

  const handleDragEnd = useCallback(() => {
    setDraggingEventId(null);
  }, []);

  const handleSaveEvent = useCallback(async (eventData: Partial<CalendarEvent>, saveOptions?: { editScope?: string; clickedDate?: string }) => {
    if (!selectedEvent) return;

    const isExisting = selectedEvent.id && !selectedEvent.id.startsWith('temp-');

    console.log('[Calendar] handleSaveEvent:', { 
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
        const listRes = await fetch(`/api/organizations/${effectiveOrgId}/calendar`);
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
          `/api/organizations/${effectiveOrgId}/calendar-events/${selectedEvent.id}`,
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

        const createRes = await fetch(`/api/organizations/${effectiveOrgId}/calendar-events`, {
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
          // Swap ONLY the edited instance for the new one-off record. All
          // expanded occurrences share the base id, so matching on id alone
          // would overwrite every other occurrence with this one record.
          const editedInstanceKey = getEventInstanceKey(selectedEvent);
          setEvents((prev) => prev.map((e) => (getEventInstanceKey(e) === editedInstanceKey ? oneOff : e)));
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
          `/api/organizations/${effectiveOrgId}/calendar-events/${selectedEvent.id}`,
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
          await fetchEvents(effectiveOrgId, start, end);
        } else {
          setEvents((prev) => prev.map((e) => (e.id === updatedEvent.id ? updatedEvent : e)));
        }
      }
    } else {
      // Create new event via POST
      const res = await fetch(`/api/organizations/${effectiveOrgId}/calendar-events`, {
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
        await fetchEvents(effectiveOrgId, start, end);
      } else {
        setEvents((prev) => [...prev, createdEvent]);
      }
    }
  }, [selectedEvent, effectiveOrgId, defaultCalendarId, getDateRange, fetchEvents]);

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
    // Always open in create mode — a previously viewed event must not carry
    // its view-only state into a fresh "Create Event".
    setViewMode(false);
    setModalOpen(true);
  }, []);

  // Toolbar "+ Create Event": open the Add Event modal pre-populated with the
  // currently displayed date.
  const handleCreateNewEvent = useCallback(() => {
    handleAddEventFromContext(currentDate);
  }, [currentDate, handleAddEventFromContext]);

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
        `/api/organizations/${effectiveOrgId}/calendar-events/${eventToDelete.id}`,
        { method: 'DELETE' }
      );

      if (!res.ok) {
        // Re-fetch events to sync with server on failure
        const { start, end } = getDateRange();
        await fetchEvents(effectiveOrgId, start, end);
      }
    } catch {
      // Re-fetch events to sync with server on error
      const { start, end } = getDateRange();
      await fetchEvents(effectiveOrgId, start, end);
    }
  }, [eventToDelete, effectiveOrgId, getDateRange, fetchEvents]);

  // ---------------------------------------------------------------------------
  // Upcoming events for sidebar
  // ---------------------------------------------------------------------------

  const upcomingEvents = useMemo(() => {
    // In Month/Week/Day views only show events that fall inside the currently
    // displayed date range; in Year view fall back to everything from now on.
    const { start: rangeStart, end: rangeEnd } = getDateRange();
    const lowerBound = view === 'year' ? new Date() : rangeStart;
    const upperBound = view === 'year' ? null : rangeEnd;
    // Deduplicate by instance key (multi-day events and recurring instances may
    // appear multiple times in the raw list)
    const seen = new Set<string>();
    return events
      .filter((e) => {
        const key = getEventInstanceKey(e);
        if (seen.has(key)) return false;
        seen.add(key);
        const start = e.startDate instanceof Date ? e.startDate : new Date(e.startDate);
        if (isNaN(start.getTime())) return false;
        if (start < lowerBound) return false;
        return upperBound ? start <= upperBound : true;
      })
      .sort((a, b) => {
        const aStart = a.startDate instanceof Date ? a.startDate : new Date(a.startDate);
        const bStart = b.startDate instanceof Date ? b.startDate : new Date(b.startDate);
        return aStart.getTime() - bStart.getTime();
      })
      .slice(0, 15);
  }, [events, view, getDateRange]);

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
    <div className={`flex h-full ${className || ''}`} style={{ backgroundColor: 'var(--color-canvas-subtle)' }}>
      {/* Main calendar area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Org title bar — lives inside the left column so the right-hand
            Upcoming Events sidebar extends to the top of the screen. */}
        {organizationName && (
          <div className="bg-white border-b px-4 py-3 flex items-center shadow-sm flex-shrink-0" style={{ borderColor: 'var(--color-slate-200)' }}>
            <h1 className="text-lg font-semibold" style={{ color: 'var(--color-slate-800)' }}>
              {organizationName} Calendar
            </h1>
          </div>
        )}
        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-3 bg-white border-b" style={{ borderColor: 'var(--color-slate-200)' }}>


          {/* View title */}
          <h2 className="text-lg font-semibold" style={{ color: 'var(--color-slate-800)' }}>
            {renderViewTitle()}
          </h2>

          {/* View toggle — evenly spaced in the toolbar; the three flex-1
              spacers split the free space equally so the Create button
              lands midway between "Year" and the nav controls */}
          <div className="flex-1" />
          <div className="flex items-center gap-1">
            {(['month', 'week', 'day', 'year'] as CalendarView[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                  view === v ? 'text-accent-ink' : 'hover:bg-slate-100'
                }`}
                style={view === v ? { backgroundColor: 'var(--color-navy-850)', color: '#fff' } : undefined}
              >
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
          <div className="flex-1" />

          {/* Create Event */}
          <button
            onClick={handleCreateNewEvent}
            className="px-3 py-1.5 rounded text-sm font-medium transition-colors hover:opacity-90"
            style={{ backgroundColor: 'var(--color-accent)', color: '#ffffff' }}
          >
            + Create Event
          </button>
          <div className="flex-1" />

          {/* Navigation */}
          <div className="flex items-center gap-2">
            <button
              onClick={navigatePrev}
              className="p-1.5 rounded hover:bg-slate-100 transition-colors"
              style={{ color: 'var(--color-slate-800)' }}
            >
              ‹
            </button>
            <button
              onClick={navigateToday}
              className="px-3 py-1.5 rounded text-sm font-medium border hover:bg-slate-50 transition-colors"
              style={{ borderColor: 'var(--color-slate-200)', color: '#1B2A4A' }}
            >
              Today
            </button>
            <button
              onClick={navigateNext}
              className="p-1.5 rounded hover:bg-slate-100 transition-colors"
              style={{ color: 'var(--color-slate-800)' }}
            >
              ›
            </button>
          </div>
        </div>

        {/* Calendar grid */}
        <div className="flex-1 flex flex-col overflow-y-auto p-4">
          {loading ? (
            <PageSkeleton rows={6} cols={7} />
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
        organizations={organizations}
        selectedOrgId={selectedOrgId}
        onOrgChange={handleOrgChange}
        onEventClick={handleSidebarEventClick}
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
