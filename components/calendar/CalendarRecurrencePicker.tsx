'use client';

import type { RecurrencePickerProps, CalendarRecurrenceFrequency } from './types';
import { RECURRENCE_FREQUENCIES } from './types';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CalendarRecurrencePicker({ value, onChange }: RecurrencePickerProps) {
  const frequency = value?.frequency || 'DAILY';
  const interval = value?.interval ?? 1;
  const hasEndDate = !!value?.endDate;
  const hasCount = value?.count != null && value.count > 0;

  const handleFrequencyChange = (freq: CalendarRecurrenceFrequency) => {
    onChange({
      frequency: freq,
      interval: 1,
      endDate: null,
      count: undefined,
    });
  };

  const handleIntervalChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10) || 1;
    onChange({
      frequency,
      interval: Math.max(1, val),
      endDate: value?.endDate ?? null,
      count: value?.count,
    });
  };

  const handleEndDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({
      frequency,
      interval,
      endDate: e.target.value ? new Date(e.target.value) : null,
      count: undefined,
    });
  };

  const handleCountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10) || undefined;
    onChange({
      frequency,
      interval,
      endDate: null,
      count: val && val > 0 ? val : undefined,
    });
  };

  const handleNone = () => {
    onChange(null);
  };

  return (
    <div className="space-y-3">
      {/* Frequency selector */}
      <div>
        <label className="block text-sm font-medium mb-1" style={{ color: '#1B2A4A' }}>
          Repeat
        </label>
        <div className="flex gap-2">
          <select
            value={frequency}
            onChange={(e) => handleFrequencyChange(e.target.value as CalendarRecurrenceFrequency)}
            className="flex-1 px-3 py-2 rounded border text-sm"
            style={{ borderColor: '#dee2e6' }}
          >
            {RECURRENCE_FREQUENCIES.map((freq) => (
              <option key={freq.value} value={freq.value}>
                {freq.label}
              </option>
            ))}
          </select>

          <input
            type="number"
            min={1}
            value={interval}
            onChange={handleIntervalChange}
            className="w-16 px-2 py-2 rounded border text-sm"
            style={{ borderColor: '#dee2e6' }}
          />
        </div>
      </div>

      {/* End rule */}
      <div className="flex items-center gap-3">
        <label className="text-sm" style={{ color: '#6c757d' }}>
          <input
            type="radio"
            name="endRule"
            checked={!hasEndDate && !hasCount}
            onChange={handleNone}
            className="mr-1"
          />
          Never
        </label>

        <label className="text-sm" style={{ color: '#6c757d' }}>
          <input
            type="radio"
            name="endRule"
            checked={hasCount}
            onChange={() => {}}
            className="mr-1"
          />
          After{' '}
          <input
            type="number"
            min={1}
            value={value?.count ?? 1}
            onChange={handleCountChange}
            className="w-16 px-2 py-1 rounded border text-sm inline"
            style={{ borderColor: '#dee2e6' }}
          />{' '}
          times
        </label>

        <label className="text-sm" style={{ color: '#6c757d' }}>
          <input
            type="radio"
            name="endRule"
            checked={hasEndDate}
            onChange={() => {}}
            className="mr-1"
          />
          By{' '}
          <input
            type="date"
            value={value?.endDate ? new Date(value.endDate).toISOString().slice(0, 10) : ''}
            onChange={handleEndDateChange}
            className="px-2 py-1 rounded border text-sm"
            style={{ borderColor: '#dee2e6' }}
          />
        </label>
      </div>
    </div>
  );
}
