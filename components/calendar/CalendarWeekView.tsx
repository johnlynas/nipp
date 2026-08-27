'use client';

import { useMemo, useCallback, useRef, type RefObject } from 'react';
import type { CalendarEvent } from './types';
import { generateWeekGrid, generateHourlySlots, isToday, formatTime, getEventInstanceKey } from './calendar-utils';
import { useVerticalDragScroll } from './hooks/useVerticalDragScroll';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CalendarWeekViewProps {
  referenceDate: Date;
  events: CalendarEvent[];
  onDateClick?: (date: Date) => void;
  onEventClick?: (event: CalendarEvent) => void;
  onDateRightClick?: (date: Date, e: React.MouseEvent) => void;
  onEventRightClick?: (event: CalendarEvent, e: React.MouseEvent) => void;
  onEventDragStart?: (event: CalendarEvent, e: React.DragEvent) => void;
  onDragEnd?: () => void;
  onDrop?: (date: Date, eventId: string, dragEvent?: React.DragEvent) => void;
  draggingEventId?: string | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CalendarWeekView({
  referenceDate,
  events,
  onDateClick,
  onEventClick,
  onDateRightClick,
  onEventRightClick,
  onEventDragStart,
  onDragEnd,
  onDrop,
  draggingEventId,
}: CalendarWeekViewProps) {
  const weekDays = useMemo(() => generateWeekGrid(referenceDate), [referenceDate]);
  const hours = useMemo(() => generateHourlySlots(), []);

  // Stable ref to the scrollable time-grid wrapper so autoscroll keeps tracking
  // the same DOM node across renders.
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Drive vertical autoscroll during a day/week drag.
  const { begin: beginAutoscroll, cancel: cancelAutoscroll } = useVerticalDragScroll(
    scrollRef as RefObject<HTMLElement | null>,
  );

  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLElement>) => {
      beginAutoscroll(e.clientY);
    },
    [beginAutoscroll],
  );

  // Group events by day and determine position (start/middle/end/single)
  const eventsByDay = useMemo(() => {
    // For each event, determine which days it spans and its position on each day
    const map: Record<string, Array<CalendarEvent & { position: 'start' | 'middle' | 'end' | 'single' }>> = {};

    for (const day of weekDays) {
      const dayStr = formatDateKey(day);
      map[dayStr] = [];
    }

    // Deduplicate by instance key — keep the latest entry for each occurrence
    // (recurring events expand into instances that share the base event id)
    const seen = new Set<string>();
    const uniqueEvents: CalendarEvent[] = [];
    for (const event of events) {
      const key = getEventInstanceKey(event);
      if (!seen.has(key)) {
        seen.add(key);
        uniqueEvents.push(event);
      }
    }

    for (const event of uniqueEvents) {
      const eventStart = new Date(event.startDate);
      eventStart.setHours(0, 0, 0, 0);

      const eventEnd = new Date(event.endDate);
      eventEnd.setHours(23, 59, 59, 999);

      // Calculate the number of days this event spans (using date-only comparison)
      const startDay = new Date(eventStart);
      let dayCount = 0;
      while (startDay <= eventEnd) {
        startDay.setDate(startDay.getDate() + 1);
        dayCount++;
      }

      // Now assign position for each day the event spans
      let currentDay = new Date(eventStart);
      let dayIndex = 0;
      while (currentDay <= eventEnd) {
        const dayStr = formatDateKey(currentDay);
        let position: 'start' | 'middle' | 'end' | 'single';

        if (dayCount === 1) {
          position = 'single';
        } else if (dayIndex === 0) {
          position = 'start';
        } else if (dayIndex === dayCount - 1) {
          position = 'end';
        } else {
          position = 'middle';
        }

        if (map[dayStr]) {
          map[dayStr].push({ ...event, position });
        }

        currentDay = new Date(currentDay.getTime() + 86400000);
        dayIndex++;
      }
    }

    return map;
  }, [events, weekDays]);

  const handleDrop = (e: React.DragEvent, date: Date) => {
    e.preventDefault();
    const eventId = e.dataTransfer.getData('text/plain');
    if (eventId) {
      console.log('[WeekView][drop] capture', {
        id: eventId,
        draggingEventId,
        date,
        clientY: e.clientY,
        clientX: e.clientX,
        atTop: e.clientY - (e.currentTarget as HTMLElement).getBoundingClientRect().top,
      });
      onDrop?.(date, eventId, e);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border overflow-hidden" style={{ borderColor: '#dee2e6' }}>
      {/* Single scrollable grid holding BOTH the day-header row and the time
          body. Both rows share identical track widths — a fixed 4rem time-label
          column plus equal-width day columns — so the header day dividers line
          up exactly with the day columns' vertical borders beneath, and the
          "GMT" cell takes no more width than the Day view's times column. */}
      <div
        ref={scrollRef}
        className="grid grid-cols-[4rem_repeat(7,minmax(0,1fr))]"
        style={{ maxHeight: '600px', overflowY: 'auto' }}
        onDragStart={handleDragStart}
        onDragEnd={cancelAutoscroll}
      >
        {/* Day headers (sticky so they stay pinned while the body scrolls) */}
        <div
          className="sticky top-0 z-20 bg-white py-2 px-1 text-center text-xs font-semibold border-b border-r"
          style={{ color: '#6c757d', borderBottomColor: '#dee2e6', borderRightColor: '#f0f0f0' }}
        >
          GMT
        </div>
        {weekDays.map((day, i) => (
          <div
            key={i}
            className="sticky top-0 z-20 bg-white py-2 text-center border-b border-l"
            style={{ borderBottomColor: '#dee2e6', borderLeftColor: '#f0f0f0' }}
          >
            <div className="text-xs font-medium" style={{ color: '#6c757d' }}>
              {day.toLocaleDateString('en-GB', { weekday: 'short' })}
            </div>
            <div className={`text-lg font-bold ${isToday(day) ? 'rounded-full w-8 h-8 flex items-center justify-center mx-auto' : ''}`}
              style={isToday(day) ? { backgroundColor: '#F5A623', color: '#ffffff' } : { color: '#1B2A4A' }}
            >
              {day.getDate()}
            </div>
          </div>
        ))}

        {/* Time labels column — 4rem wide, matching the Day view's w-16 */}
        <div className="border-r border-b" style={{ borderColor: '#f0f0f0' }}>
          {hours.map((hour) => (
            <div
              key={hour}
              className="text-xs text-right pr-2 py-0"
              style={{ height: '64px', color: '#6c757d' }}
            >
              {hour === 0 ? '' : formatTime(new Date(2000, 0, 1, hour, 0))}
            </div>
          ))}
        </div>

        {/* Day columns */}
        {weekDays.map((day, dayIndex) => {
          const dayStr = formatDateKey(day);
          const dayEvents = eventsByDay[dayStr] || [];
          return (
            <div
              key={dayIndex}
              className="border-l relative"
              style={{ borderColor: '#f0f0f0' }}
              onClick={() => onDateClick?.(day)}
              onContextMenu={(e) => { e.preventDefault(); onDateRightClick?.(day, e); }}
              onDrop={(e) => handleDrop(e, day)}
              onDragOver={handleDragOver}
            >
              {/* Hourly grid lines */}
              {hours.map((hour) => (
                <div
                  key={hour}
                  className="border-b"
                  style={{ height: '64px', borderColor: '#f0f0f0' }}
                />
              ))}

              {/* Event overlays */}
              {dayEvents.map((event) => {
                const start = event.startDate instanceof Date ? event.startDate : new Date(event.startDate);
                const end = event.endDate instanceof Date ? event.endDate : new Date(event.endDate);
                if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
                const startHour = start.getHours() + start.getMinutes() / 60;
                const endHour = end.getHours() + end.getMinutes() / 60;
                const duration = Math.max(endHour - startHour, 0.5);

                // Multi-day events: render differently based on position
                if (event.position === 'middle') {
                  // Just a colored bar spanning the cell width — draggable + context menu
                  const isDragging = event.id === draggingEventId;
                  return (
                    <div
                      key={`${getEventInstanceKey(event)}-${event.position}`}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', event.id);
                        e.dataTransfer.effectAllowed = 'move';
                        onEventDragStart?.(event, e as unknown as React.DragEvent);
                      }}
                      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onEventRightClick?.(event, e); }}
                      className="absolute left-0.5 right-0.5 rounded cursor-grab hover:brightness-95 transition-all"
                      style={{
                        top: `${startHour * 64}px`,
                        height: `${duration * 64}px`,
                        backgroundColor: `${event.color || '#2A9D8F'}30`,
                        borderLeft: `3px solid ${event.color || '#2A9D8F'}`,
                        zIndex: 10,
                        opacity: isDragging ? 0.5 : 1,
                      }}
                    />
                  );
                }

                if (event.position === 'start') {
                  // Title with left indicator and colored bar — draggable + context menu
                  const isDragging = event.id === draggingEventId;
                  return (
                    <div
                      key={`${getEventInstanceKey(event)}-${event.position}`}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', event.id);
                        e.dataTransfer.effectAllowed = 'move';
                        onEventDragStart?.(event, e as unknown as React.DragEvent);
                      }}
                      onDragEnd={() => onDragEnd?.()}
                      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onEventRightClick?.(event, e); }}
                      className="absolute left-0.5 right-0.5 rounded cursor-grab hover:brightness-95 transition-all"
                      style={{
                        top: `${startHour * 64}px`,
                        height: `${duration * 64}px`,
                        backgroundColor: `${event.color || '#2A9D8F'}30`,
                        borderLeft: `3px solid ${event.color || '#2A9D8F'}`,
                        zIndex: 10,
                        opacity: isDragging ? 0.5 : 1,
                      }}
                    >
                      <div className="px-1.5 py-0.5 overflow-hidden" style={{ maxHeight: '100%' }}>
                        <div className="text-xs font-semibold truncate" style={{ color: event.color || '#1B2A4A' }}>
                          ▸ {event.recurrence && <span title="Recurring event">↻</span>} {event.title}
                        </div>
                        <div className="text-[10px] text-gray-500">
                          {formatTime(start)} – {formatTime(end)}
                        </div>
                      </div>
                    </div>
                  );
                }

                if (event.position === 'end') {
                  // Title with right indicator and colored bar — draggable + context menu
                  const isDragging = event.id === draggingEventId;
                  return (
                    <div
                      key={`${getEventInstanceKey(event)}-${event.position}`}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', event.id);
                        e.dataTransfer.effectAllowed = 'move';
                        onEventDragStart?.(event, e as unknown as React.DragEvent);
                      }}
                      onDragEnd={() => onDragEnd?.()}
                      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onEventRightClick?.(event, e); }}
                      className="absolute left-0.5 right-0.5 rounded cursor-grab hover:brightness-95 transition-all"
                      style={{
                        top: `${startHour * 64}px`,
                        height: `${duration * 64}px`,
                        backgroundColor: `${event.color || '#2A9D8F'}30`,
                        borderLeft: `3px solid ${event.color || '#2A9D8F'}`,
                        zIndex: 10,
                        opacity: isDragging ? 0.5 : 1,
                      }}
                    >
                      <div className="px-1.5 py-0.5 overflow-hidden" style={{ maxHeight: '100%' }}>
                        <div className="text-xs font-semibold truncate" style={{ color: event.color || '#1B2A4A' }}>
                          {event.recurrence && <span title="Recurring event">↻</span>} {event.title} ◂
                        </div>
                        <div className="text-[10px] text-gray-500">
                          {formatTime(start)} – {formatTime(end)}
                        </div>
                      </div>
                    </div>
                  );
                }

                // Single-day event: render normally with time — draggable + context menu
                const isDragging = event.id === draggingEventId;
                return (
                  <div
                    key={`${getEventInstanceKey(event)}-${event.position}`}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', event.id);
                      e.dataTransfer.effectAllowed = 'move';
                      onEventDragStart?.(event, e as unknown as React.DragEvent);
                    }}
                    onDragEnd={() => onDragEnd?.()}
                    onClick={(e) => { e.stopPropagation(); onEventClick?.(event); }}
                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onEventRightClick?.(event, e); }}
                    className="absolute left-0.5 right-0.5 rounded cursor-grab hover:brightness-95 transition-all"
                    style={{
                      top: `${startHour * 64}px`,
                      height: `${duration * 64}px`,
                      backgroundColor: `${event.color || '#2A9D8F'}30`,
                      borderLeft: `3px solid ${event.color || '#2A9D8F'}`,
                      zIndex: 10,
                      opacity: isDragging ? 0.5 : 1,
                    }}
                  >
                    <div className="px-1.5 py-0.5 overflow-hidden" style={{ maxHeight: '100%' }}>
                      <div className="text-xs font-semibold truncate" style={{ color: event.color || '#1B2A4A' }}>
                        {event.recurrence && <span title="Recurring event">↻</span>} {event.title}
                      </div>
                      <div className="text-[10px] text-gray-500">
                        {formatTime(start)} – {formatTime(end)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
