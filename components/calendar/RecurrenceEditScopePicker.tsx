'use client';

import { useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EditScope = 'this' | 'following' | 'all';

interface RecurrenceEditScopePickerProps {
  /** Whether the event being edited is a recurring instance. */
  isRecurringInstance: boolean;
  /** Currently selected edit scope (defaults to 'this'). */
  value?: EditScope;
  onChange: (scope: EditScope | undefined) => void;
}

// ---------------------------------------------------------------------------
// Option definitions
// ---------------------------------------------------------------------------

const OPTIONS: { value: EditScope; label: string; description: string }[] = [
  {
    value: 'this',
    label: 'This occurrence',
    description: 'Only change this instance',
  },
  {
    value: 'following',
    label: 'This & following',
    description: 'Change this and all future occurrences',
  },
  {
    value: 'all',
    label: 'All occurrences',
    description: 'Change the entire recurring series',
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function RecurrenceEditScopePicker({
  isRecurringInstance,
  value = 'this',
  onChange,
}: RecurrenceEditScopePickerProps) {
  const [selected, setSelected] = useState<EditScope>(value);

  if (!isRecurringInstance) return null;

  const handleSelect = (scope: EditScope) => {
    setSelected(scope);
    onChange(scope);
  };

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium" style={{ color: 'var(--color-slate-800)' }}>
        Edit scope
      </label>
      <div className="flex flex-col gap-1.5">
        {OPTIONS.map((opt) => (
          <label
            key={opt.value}
            className={`flex items-start gap-2.5 px-3 py-2 rounded border cursor-pointer transition-colors text-sm ${
              selected === opt.value
                ? 'border-accent bg-canvas-subtle'
                : 'border-slate-200 hover:bg-slate-50'
            }`}
          >
            <input
              type="radio"
              name="editScope"
              checked={selected === opt.value}
              onChange={() => handleSelect(opt.value)}
              className="mt-0.5 accent-amber-500"
            />
            <div className="flex-1 min-w-0">
              <span className={`font-medium ${selected === opt.value ? 'text-slate-900 font-semibold' : ''}`}>
                {opt.label}
              </span>
              <div className="text-xs text-slate-500 mt-0.5">{opt.description}</div>
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}
