'use client';

import { useMemo } from 'react';
import type { CalendarEvent } from './types';
import { generateYearMonths, getEventColor, isToday } from './calendar-utils';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CalendarYearViewProps {
  year: number;
  events: CalendarEvent[];
  /** Called when a month cell is clicked — drills into the Month view. */
  onMonthClick?: (month: number) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CalendarYearView({ year, events, onMonthClick }: CalendarYearViewProps) {
  const months = useMemo(() => generateYearMonths(year, events), [year, events]);

  const now = new Date();
  const isCurrentYear = now.getFullYear() === year;

  return (
    <div className="bg-white rounded-lg shadow-sm border" style={{ borderColor: 'var(--color-slate-200)' }}>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 p-3">
        {months.map((m) => {
          const isCurrentMonth = isCurrentYear && now.getMonth() === m.month;

          return (
            <button
              key={m.month}
              type="button"
              onClick={() => onMonthClick?.(m.month)}
              title={`${m.name} ${year}`}
              className="text-left rounded-lg border p-2 transition-colors hover:bg-slate-50"
              style={{
                borderColor: isCurrentMonth ? 'var(--color-accent)' : 'var(--color-slate-200)',
                borderWidth: isCurrentMonth ? 2 : 1,
              }}
            >
              {/* Month header */}
              <div className="flex items-center justify-between mb-1">
                <span
                  className={`text-xs font-semibold ${isCurrentMonth ? 'text-accent' : ''}`}
                  style={isCurrentMonth ? undefined : { color: 'var(--color-slate-600)' }}
                >
                  {m.name}
                </span>
                {m.totalEvents > 0 && (
                  <span
                    className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full text-accent-ink"
                    style={{ backgroundColor: 'var(--color-accent)' }}
                  >
                    {m.totalEvents}
                  </span>
                )}
              </div>

              {/* Mini day grid */}
              <div className="grid grid-cols-7 gap-y-0.5">
                {Array.from({ length: m.firstDayOfWeek }, (_, i) => (
                  <span key={`pad-${i}`} />
                ))}
                {Array.from({ length: m.daysInMonth }, (_, i) => {
                  const day = i + 1;
                  const dayEvents = m.eventsByDay.get(day) || [];
                  const isTodayCell = isCurrentMonth && isToday(new Date(year, m.month, day));

                  return (
                    <span key={day} className="flex flex-col items-center">
                      <span
                        className={`text-[10px] leading-3 ${isTodayCell ? 'font-bold text-accent' : ''}`}
                        style={isTodayCell ? undefined : { color: 'var(--color-slate-600)' }}
                      >
                        {day}
                      </span>
                      <span className="flex gap-px h-1">
                        {dayEvents.slice(0, 3).map((event, idx) => (
                          <span
                            key={idx}
                            className="w-1 h-1 rounded-full"
                            style={{ backgroundColor: event.color || getEventColor(event.eventType) }}
                          />
                        ))}
                      </span>
                    </span>
                  );
                })}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
