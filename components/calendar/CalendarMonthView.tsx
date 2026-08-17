'use client';

import { useMemo } from 'react';
import type { CalendarEvent } from './types';
import { generateMonthDays, isToday, getEventInstanceKey } from './calendar-utils';
import CalendarEventCard, { EventOverflowIndicator } from './CalendarEventCard';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CalendarMonthViewProps {
  year: number;
  month: number;
  events: CalendarEvent[];
  onDateClick?: (date: Date) => void;
  onEventClick?: (event: CalendarEvent) => void;
  onDateRightClick?: (date: Date, e: React.MouseEvent) => void;
  onEventRightClick?: (event: CalendarEvent, e: React.MouseEvent) => void;
  onEventDragStart?: (event: CalendarEvent, e: React.DragEvent) => void;
  onDragEnd?: () => void;
  onDrop?: (date: Date, eventId: string) => void;
  draggingEventId?: string | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CalendarMonthView({
  year,
  month,
  events,
  onDateClick,
  onEventClick,
  onDateRightClick,
  onEventRightClick,
  onEventDragStart,
  onDragEnd,
  onDrop,
  draggingEventId,
}: CalendarMonthViewProps) {
  // Generate month grid days (42 cells max, with prev/next month padding)
  const days = useMemo(() => generateMonthDays(year, month), [year, month]);

  // Group events by date and determine position (start/middle/end/single)
  console.log('[MonthView] events received:', events.length, JSON.stringify(events.map(e => ({ id: e.id, title: e.title, startDate: e.startDate }))));
  const eventsByDate = useMemo(() => {
    // For each event, determine which days it spans and its position on each day
    const map: Record<string, Array<CalendarEvent & { position: 'start' | 'middle' | 'end' | 'single' }>> = {};

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

        if (!map[dayStr]) map[dayStr] = [];
        map[dayStr].push({ ...event, position });

        currentDay = new Date(currentDay.getTime() + 86400000);
        dayIndex++;
      }
    }

    return map;
  }, [events]);

  const handleDateClick = (date: Date) => {
    onDateClick?.(date);
  };

  const handleDateRightClick = (e: React.MouseEvent, date: Date) => {
    e.preventDefault();
    onDateRightClick?.(date, e);
  };

  const handleDrop = (e: React.DragEvent, date: Date) => {
    e.preventDefault();
    const eventId = e.dataTransfer.getData('text/plain');
    if (eventId) {
      onDrop?.(date, eventId);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border" style={{ borderColor: '#dee2e6' }}>
      {/* Day headers */}
      <div className="grid grid-cols-7 border-b" style={{ borderColor: '#dee2e6' }}>
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
          <div
            key={day}
            className="py-2 text-center text-xs font-semibold uppercase tracking-wide"
            style={{ color: '#1B2A4A' }}
          >
            {day}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7">
        {days.map(({ date, isCurrentMonth }, index) => {
          const dayStr = formatDateKey(date);
          const dayEvents = eventsByDate[dayStr] || [];
          const todayClass = isToday(date) ? 'bg-[#F5A623]/10' : '';
          const currentMonthClass = isCurrentMonth ? 'text-[#1B2A4A]' : 'text-gray-400';

          return (
            <div
              key={index}
              className={`min-h-[100px] border-r border-b p-1 transition-colors ${
                isCurrentMonth ? 'bg-white' : 'bg-gray-50'
              } ${todayClass}`}
              style={{ borderColor: '#f0f0f0' }}
              onClick={() => handleDateClick(date)}
              onContextMenu={(e) => handleDateRightClick(e, date)}
              onDrop={(e) => handleDrop(e, date)}
              onDragOver={handleDragOver}
            >
              {/* Day number */}
              <div className={`text-xs font-medium mb-1 text-right ${isToday(date) ? 'text-[#F5A623]' : currentMonthClass}`}>
                {date.getDate()}
              </div>

              {/* Events */}
              <div className="space-y-0.5">
                {dayEvents.slice(0, 3).map((event) => {
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
                        onDragEnd={() => onDragEnd?.()}
                        onContextMenu={(e) => { e.preventDefault(); onEventRightClick?.(event, e); }}
                        className="w-full h-4 rounded cursor-grab hover:brightness-95 transition-all"
                        style={{
                          backgroundColor: `${event.color || '#2A9D8F'}30`,
                          borderLeft: `3px solid ${event.color || '#2A9D8F'}`,
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
                        onContextMenu={(e) => { e.preventDefault(); onEventRightClick?.(event, e); }}
                        className="flex items-center gap-1 px-1 py-0.5 rounded cursor-grab hover:brightness-95 transition-all overflow-hidden"
                        style={{
                          backgroundColor: `${event.color || '#2A9D8F'}30`,
                          borderLeft: `3px solid ${event.color || '#2A9D8F'}`,
                          opacity: isDragging ? 0.5 : 1,
                        }}
                      >
                        <span className="text-xs font-medium truncate" style={{ color: event.color || '#1B2A4A' }}>
                          ▸ {event.recurrence && <span title="Recurring event">↻</span>} {event.title}
                        </span>
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
                        onContextMenu={(e) => { e.preventDefault(); onEventRightClick?.(event, e); }}
                        className="flex items-center gap-1 px-1 py-0.5 rounded cursor-grab hover:brightness-95 transition-all overflow-hidden"
                        style={{
                          backgroundColor: `${event.color || '#2A9D8F'}30`,
                          borderLeft: `3px solid ${event.color || '#2A9D8F'}`,
                          opacity: isDragging ? 0.5 : 1,
                        }}
                      >
                        <span className="text-xs font-medium truncate" style={{ color: event.color || '#1B2A4A' }}>
                          {event.recurrence && <span title="Recurring event">↻</span>} {event.title} ◂
                        </span>
                      </div>
                    );
                  }

                  // Single-day event: render as normal card
                  return (
                    <CalendarEventCard
                      key={`${getEventInstanceKey(event)}-${event.position}`}
                      event={event}
                      compact
                      onClick={() => onEventClick?.(event)}
                      onDragStart={onEventDragStart}
                      onDragEnd={() => onDragEnd?.()}
                      onRightClick={(ev, e) => onEventRightClick?.(ev, e)}
                      isDragging={event.id === draggingEventId}
                    />
                  );
                })}

                {/* Overflow indicator (only for single-day events) */}
                {dayEvents.filter((e) => e.position === 'single').length > 3 && (
                  <EventOverflowIndicator count={dayEvents.filter((e) => e.position === 'single').length - 3} />
                )}
              </div>
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
