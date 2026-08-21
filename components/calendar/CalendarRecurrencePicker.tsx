'use client';

import type { RecurrencePickerProps, CalendarRecurrenceFrequency } from './types';
import { RECURRENCE_FREQUENCIES } from './types';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CalendarRecurrencePicker({ value, onChange }: RecurrencePickerProps) {
  const hasRecurrence = !!value;
  const frequency = value?.frequency || 'WEEKLY';
  const interval = value?.interval ?? 1;
  const count = value?.count != null && value.count > 0 ? value.count : 1;

  const handleFrequencyChange = (freq: string) => {
    if (!freq || freq === 'NONE') {
      onChange(null);
      return;
    }
    onChange({
      frequency: freq as CalendarRecurrenceFrequency,
      interval: 1,
      count: Math.max(1, count),
    });
  };

  const handleIntervalChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10) || 1;
    onChange({
      frequency,
      interval: Math.max(1, val),
      count: Math.max(1, count),
    });
  };

  const handleCountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10) || 1;
    onChange({
      frequency,
      interval,
      count: Math.max(1, val),
    });
  };

  return (
    <div className="space-y-3">
      {/* Frequency selector */}
      <div>
        <label className="block text-sm font-medium mb-1" style={{ color: '#1B2A4A' }}>
          Repeat
        </label>
          <select
            value={hasRecurrence ? frequency : ('NONE' as CalendarRecurrenceFrequency)}
            onChange={(e) => handleFrequencyChange(e.target.value as CalendarRecurrenceFrequency)}
            className="w-full px-3 py-2 rounded border text-sm"
            style={{ borderColor: '#dee2e6' }}
          >
            <option value="NONE">Does not repeat</option>
            {RECURRENCE_FREQUENCIES.map((freq) => (
              <option key={freq.value} value={freq.value}>
                {freq.label}
              </option>
            ))}
          </select>

          {hasRecurrence && (
            <div className="flex gap-2">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: '#6c757d' }}>
                  Every
                </label>
                <input
                  type="number"
                  min={1}
                  value={interval}
                  onChange={handleIntervalChange}
                  title={`Every ${frequency.toLowerCase()} (e.g. 2 = every other ${RECURRENCE_FREQUENCIES.find(f => f.value === frequency)?.label?.toLowerCase() || 'week'})`}
                  className="w-16 px-2 py-2 rounded border text-sm"
                  style={{ borderColor: '#dee2e6' }}
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: '#6c757d' }}>
                  Count
                </label>
                <input
                  type="number"
                  min={1}
                  value={count}
                  onChange={handleCountChange}
                  title="Number of times the event will repeat"
                  className="w-20 px-2 py-2 rounded border text-sm"
                  style={{ borderColor: '#dee2e6' }}
                />
              </div>
            </div>
          )}
      </div>
    </div>
  );
}
