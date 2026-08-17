'use client';

import { useState } from 'react';
import type { CalendarEvent, CalendarEventType } from './types';
import { getEventIcon, getEventColor, formatTime } from './calendar-utils';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CalendarEventCardProps {
  event: CalendarEvent;
  compact?: boolean;
  onClick?: (event: CalendarEvent) => void;
  onDragStart?: (event: CalendarEvent, e: React.DragEvent) => void;
  onDragEnd?: () => void;
  onRightClick?: (event: CalendarEvent, e: React.MouseEvent) => void;
  isDragging?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CalendarEventCard({
  event,
  compact = true,
  onClick,
  onDragStart,
  onDragEnd,
  onRightClick,
  isDragging = false,
}: CalendarEventCardProps) {
  const [expanded, setExpanded] = useState(false);

  const color = event.color || getEventColor(event.eventType);
  const icon = getEventIcon(event.eventType);

  const handleClick = () => {
    if (compact && event.title) {
      setExpanded(!expanded);
    } else {
      onClick?.(event);
    }
  };

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('text/plain', event.id);
    e.dataTransfer.effectAllowed = 'move';
    onDragStart?.(event, e);
  };

  const handleDragEnd = () => {
    onDragEnd?.();
  };

  const handleRightClick = (e: React.MouseEvent) => {
    e.preventDefault();
    onRightClick?.(event, e);
  };

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onClick={handleClick}
      onContextMenu={handleRightClick}
      className={`rounded cursor-pointer transition-all ${
        isDragging ? 'opacity-50 shadow-lg' : 'shadow-sm hover:shadow-md'
      } ${expanded ? '' : 'hover:brightness-95'}`}
      style={{
        borderLeft: `3px solid ${color}`,
        backgroundColor: expanded ? '#ffffff' : `${color}15`,
      }}
    >
      {/* Compact view */}
      {!expanded && (
        <div className="px-2 py-1">
          <div className="flex items-center gap-1.5 min-w-0">
            {/* Icon placeholder */}
            <span className="text-xs flex-shrink-0" title={icon}>●</span>
            <span className="text-xs font-medium truncate text-[#1B2A4A]">
              {event.title}
            </span>
            <RecurrenceIndicator hasRecurrence={!!event.recurrence} />
          </div>
        </div>
      )}

      {/* Expanded view */}
      {expanded && (
        <div className="px-3 py-2">
          <div className="flex items-center gap-1.5 mb-1">
            <span style={{ color }} className="text-sm">●</span>
            <h4 className="font-semibold text-[#1B2A4A]">{event.title}</h4>
            <RecurrenceIndicator hasRecurrence={!!event.recurrence} />
          </div>
          {event.description && (
            <p className="text-xs text-gray-600 mb-1">{event.description}</p>
          )}
          <div className="text-xs text-gray-500">
            {formatTime(event.startDate)} – {formatTime(event.endDate)}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overflow indicator for dates with many events
// ---------------------------------------------------------------------------

interface EventOverflowIndicatorProps {
  count: number;
}

export function EventOverflowIndicator({ count }: EventOverflowIndicatorProps) {
  return (
    <div className="text-xs text-gray-500 font-medium px-1 py-0.5">
      +{count} more
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recurrence indicator icon
// ---------------------------------------------------------------------------

interface RecurrenceIndicatorProps {
  hasRecurrence: boolean;
}

export function RecurrenceIndicator({ hasRecurrence }: RecurrenceIndicatorProps) {
  if (!hasRecurrence) return null;

  return (
    <span className="text-xs ml-1" title="Recurring event">
      ↻
    </span>
  );
}

// ---------------------------------------------------------------------------
// Export types
// ---------------------------------------------------------------------------

export type { CalendarEvent, CalendarEventType };
