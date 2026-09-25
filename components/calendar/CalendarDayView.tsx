'use client';

import { useMemo, useCallback, useRef, type RefObject } from 'react';
import type { CalendarEvent } from './types';
import { generateHourlySlots, isToday, formatTime, getEventInstanceKey } from './calendar-utils';
import { useVerticalDragScroll } from './hooks/useVerticalDragScroll';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CalendarDayViewProps {
  date: Date;
  events: CalendarEvent[];
  onDateClick?: (date: Date) => void;
  _onEventClick?: (event: CalendarEvent) => void;
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

export default function CalendarDayView({
  date,
  events,
  onDateClick,
  _onEventClick,
  onDateRightClick,
  onEventRightClick,
  onEventDragStart,
  onDragEnd,
  onDrop,
  draggingEventId,
}: CalendarDayViewProps) {
  const hours = useMemo(() => generateHourlySlots(), []);

  // Stable ref to the scrollable time-grid wrapper so autoscroll keeps tracking
  // the same DOM node across renders.
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Drive vertical autoscroll during a drag.
  const { begin: beginAutoscroll, cancel: cancelAutoscroll } = useVerticalDragScroll(
    scrollRef as RefObject<HTMLElement | null>,
  );

  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLElement>) => {
      beginAutoscroll(e.clientY);
    },
    [beginAutoscroll],
  );

  // Filter events for this day
  const dayEvents = useMemo(() => {
    return events.filter((event) => {
      const eventStart = new Date(event.startDate);
      eventStart.setHours(0, 0, 0, 0);

      const eventEnd = new Date(event.endDate);
      eventEnd.setHours(23, 59, 59, 999);

      const dayStart = new Date(date);
      dayStart.setHours(0, 0, 0, 0);

      const dayEnd = new Date(date);
      dayEnd.setHours(23, 59, 59, 999);

      return eventStart <= dayEnd && eventEnd >= dayStart;
    });
  }, [events, date]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const eventId = e.dataTransfer.getData('text/plain');
    if (eventId) {
      console.log('[DayView][drop] capture', {
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
    <div className="bg-white rounded-lg shadow-sm border overflow-hidden" style={{ borderColor: 'var(--color-slate-200)' }}>
      {/* Day header */}
      <div className="py-3 px-4 border-b text-center" style={{ borderColor: 'var(--color-slate-200)' }}>
        <div className="text-sm font-medium" style={{ color: 'var(--color-slate-500)' }}>
          {date.toLocaleDateString('en-GB', { weekday: 'long' })}
        </div>
        <div className={`text-2xl font-bold mt-1 ${isToday(date) ? 'rounded-full w-10 h-10 flex items-center justify-center mx-auto' : ''}`}
          style={isToday(date) ? { color: '#fff', backgroundColor: 'var(--color-navy-850)' } : { color: 'var(--color-slate-900)' }}
        >
          {date.getDate()}
        </div>
      </div>

      {/* Time grid */}
      <div
        ref={scrollRef}
        className="relative"
        style={{ maxHeight: '600px', overflowY: 'auto' }}
        onDragStart={handleDragStart}
        onDragEnd={cancelAutoscroll}
      >
        {/* Time labels column */}
        <div className="flex">
          <div className="w-16 flex-shrink-0 border-r" style={{ borderColor: 'var(--color-slate-200)' }}>
            {hours.map((hour) => (
              <div
                key={hour}
                className="text-xs text-right pr-2"
                style={{ height: '64px', color: 'var(--color-slate-500)' }}
              >
                {hour === 0 ? '' : formatTime(new Date(2000, 0, 1, hour, 0))}
              </div>
            ))}
          </div>

          {/* Day column */}
          <div
            className="flex-1 border-l relative"
            style={{ borderColor: 'var(--color-slate-200)' }}
            onClick={() => onDateClick?.(date)}
            onContextMenu={(e) => { e.preventDefault(); onDateRightClick?.(date, e); }}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
          >
            {/* Hourly grid lines */}
            {hours.map((hour) => (
              <div
                key={hour}
                className="border-b"
                style={{ height: '64px', borderColor: 'var(--color-slate-200)' }}
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
              const isDragging = event.id === draggingEventId;

              return (
                <div
                  key={getEventInstanceKey(event)}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', event.id);
                    e.dataTransfer.effectAllowed = 'move';
                    onEventDragStart?.(event, e as unknown as React.DragEvent);
                  }}
                  onDragEnd={() => onDragEnd?.()}
                  onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onEventRightClick?.(event, e); }}
                  className="absolute left-2 right-4 rounded cursor-grab hover:brightness-95 transition-all"
                  style={{
                    top: `${startHour * 64}px`,
                    height: `${duration * 64}px`,
                    backgroundColor: `${event.color || '#2A9D8F'}30`,
                    zIndex: 10,
                    opacity: isDragging ? 0.5 : 1,
                  }}
                >
                  <div className="px-2 py-1 overflow-hidden" style={{ maxHeight: '100%' }}>
                    <div className="text-sm font-semibold truncate" style={{ color: 'var(--color-slate-800)' }}>
                      {event.recurrence && <span className="mr-1" title="Recurring event">↻</span>}
                      {event.title}
                    </div>
                    <div className="text-xs text-slate-500">
                      {formatTime(start)} – {formatTime(end)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
