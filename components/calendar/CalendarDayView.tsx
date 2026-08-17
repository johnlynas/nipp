'use client';

import { useMemo } from 'react';
import type { CalendarEvent } from './types';
import { generateHourlySlots, isToday, formatTime, getEventInstanceKey } from './calendar-utils';

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
  onDrop?: (date: Date, eventId: string) => void;
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
      onDrop?.(date, eventId);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border overflow-hidden" style={{ borderColor: '#dee2e6' }}>
      {/* Day header */}
      <div className="py-3 px-4 border-b text-center" style={{ borderColor: '#dee2e6' }}>
        <div className="text-sm font-medium" style={{ color: '#6c757d' }}>
          {date.toLocaleDateString('en-GB', { weekday: 'long' })}
        </div>
        <div className={`text-2xl font-bold mt-1 ${isToday(date) ? 'rounded-full w-10 h-10 flex items-center justify-center mx-auto' : ''}`}
          style={isToday(date) ? { backgroundColor: '#F5A623', color: '#ffffff' } : { color: '#1B2A4A' }}
        >
          {date.getDate()}
        </div>
      </div>

      {/* Time grid */}
      <div className="relative" style={{ maxHeight: '600px', overflowY: 'auto' }}>
        {/* Time labels column */}
        <div className="flex">
          <div className="w-16 flex-shrink-0 border-r" style={{ borderColor: '#f0f0f0' }}>
            {hours.map((hour) => (
              <div
                key={hour}
                className="text-xs text-right pr-2"
                style={{ height: '64px', color: '#6c757d' }}
              >
                {hour === 0 ? '' : formatTime(new Date(2000, 0, 1, hour, 0))}
              </div>
            ))}
          </div>

          {/* Day column */}
          <div
            className="flex-1 border-l relative"
            style={{ borderColor: '#f0f0f0' }}
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
                style={{ height: '64px', borderColor: '#f0f0f0' }}
              />
            ))}

            {/* Event overlays */}
            {dayEvents.map((event) => {
              const startHour = event.startDate.getHours() + event.startDate.getMinutes() / 60;
              const endHour = event.endDate.getHours() + event.endDate.getMinutes() / 60;
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
                    borderLeft: `3px solid ${event.color || '#2A9D8F'}`,
                    zIndex: 10,
                    opacity: isDragging ? 0.5 : 1,
                  }}
                >
                  <div className="px-2 py-1 overflow-hidden" style={{ maxHeight: '100%' }}>
                    <div className="text-sm font-semibold truncate" style={{ color: event.color || '#1B2A4A' }}>
                      {event.recurrence && <span className="mr-1" title="Recurring event">↻</span>}
                      {event.title}
                    </div>
                    <div className="text-xs text-gray-500">
                      {formatTime(event.startDate)} – {formatTime(event.endDate)}
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
