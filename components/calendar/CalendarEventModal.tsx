'use client';

import { useState, useEffect } from 'react';
import type { CalendarEvent, CalendarEventType, CalendarEventRecurrence, CalendarRecurrenceFrequency } from './types';
import { EVENT_TYPES, RECURRENCE_FREQUENCIES } from './types';
import { getRecurrenceEndDateLabel } from './calendar-utils';
import RecurrenceEditScopePicker, { type EditScope } from './RecurrenceEditScopePicker';
import { Modal } from '@/components/dashboard/Modal';

// ---------------------------------------------------------------------------
// Repeat Option button set — maps onto the stored recurrence frequency.
// 'none' = Does Not Repeat (no recurrence rule stored).
// ---------------------------------------------------------------------------

const REPEAT_OPTIONS: { value: CalendarRecurrenceFrequency | 'none'; label: string }[] = [
  { value: 'none', label: 'Does Not Repeat' },
  { value: 'DAILY', label: 'Daily' },
  { value: 'WEEKLY', label: 'Weekly' },
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'QUARTERLY', label: 'Quarterly' },
  { value: 'SEMI_ANNUALLY', label: 'Semiannual' },
];

type RepeatOption = CalendarRecurrenceFrequency | 'none';

// Read-only value box for view mode
function ViewValue({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="w-full px-3 py-2 rounded-lg border text-sm min-h-[40px]"
      style={{ borderColor: '#dee2e6', color: '#1a1a2e' }}
    >
      {children}
    </div>
  );
}

// Label used above every field in the form
function FieldLabel({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="block text-sm font-medium mb-1.5" style={{ color: '#475569' }}>
      {children}
    </label>
  );
}

const inputStyles: React.CSSProperties = { borderColor: '#dee2e6', color: '#1a1a2e' };
const inputClasses = 'w-full px-3 py-2 rounded-lg border text-sm focus:outline-none disabled:bg-[#f1f5f9] disabled:text-[#94a3b8]';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CalendarEventModalProps {
  event: CalendarEvent | null;
  isOpen: boolean;
  onClose: () => void;
  onSave?: (event: Partial<CalendarEvent>, options?: { editScope?: EditScope; clickedDate?: string }) => Promise<void>;
  isViewMode?: boolean;
}

// ---------------------------------------------------------------------------
// Component — single dialog for Add Event / Edit Event / Event Details.
// Layout: title → description → event type → 2×2 date-time matrix →
// Repeat Option buttons → Number of times → Recurrence Rules (ends panel).
// ---------------------------------------------------------------------------

export default function CalendarEventModal({
  event,
  isOpen,
  onClose,
  onSave,
  isViewMode = false,
}: CalendarEventModalProps) {
  // Form state (dates/times split into separate fields per the layout)
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [eventType, setEventType] = useState<CalendarEventType>('OTHER');
  const [startDate, setStartDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endDate, setEndDate] = useState('');
  const [endTime, setEndTime] = useState('');
  // Recurrence state (null = Does Not Repeat) — also drives the Repeat Option buttons
  const [recurrence, setRecurrence] = useState<CalendarEventRecurrence | null>(null);
  // Number of times — always visible when repeating; defaulted to 1 on create
  const [repeatCount, setRepeatCount] = useState(1);
  // Edit scope for recurring instances (this / this & following / all)
  const [editScope, setEditScope] = useState<EditScope | undefined>(undefined);

  // Error state for save failures
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (event) {
      setTitle(event.title || '');
      setDescription(event.description || '');
      setEventType(event.eventType);
      setEditScope(undefined);

      // Split stored start into date + time — build the parts from local Date
      // components so no UTC day shift happens in non-UTC timezones.
      const start = event.startDate instanceof Date ? event.startDate : new Date(event.startDate);
      let sDate = '';
      let sTime = '';
      if (!isNaN(start.getTime())) {
        sDate = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
        sTime = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`;
      }
      setStartDate(sDate);
      setStartTime(sTime);

      const end = event.endDate instanceof Date ? event.endDate : new Date(event.endDate);
      let eDate = '';
      let eTime = '';
      if (!isNaN(end.getTime())) {
        eDate = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
        eTime = `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`;
      }
      setEndDate(eDate);
      setEndTime(eTime);

      // Recurrence pre-fill (frequency + occurrence count)
      if (event.recurrence) {
        const rec = event.recurrence;
        setRecurrence({
          frequency: rec.frequency,
          interval: rec.interval || 1,
          endDate: null,
          count: rec.count ?? null,
        });
        setRepeatCount(rec.count != null && rec.count > 0 ? rec.count : 1);
      } else {
        // New event / non-recurring: Does Not Repeat, Number of times defaults to 1
        setRecurrence(null);
        setRepeatCount(1);
      }
    }
    setSaveError(null);
  }, [event]);

  if (!isOpen || !event) return null;

  const isExisting = event.id && !event.id.startsWith('temp-');
  const isRecurringInstance = !!event.recurrence;
  const modalTitle = isViewMode ? 'Event Details' : isExisting ? 'Edit Event' : 'Add Event';
  // Currently selected repeat option (derived — buttons control `recurrence` directly)
  const selectedRepeatOption: RepeatOption = recurrence ? recurrence.frequency : 'none';

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  // Keep the end date from preceding the start date (clamps + min attribute)
  const handleStartDateChange = (value: string) => {
    setStartDate(value);
    if (endDate && endDate < value) setEndDate(value);
  };

  const handleRepeatOptionChange = (option: RepeatOption) => {
    if (option === 'none') {
      setRecurrence(null);
      return;
    }
    // Preserve interval/edit state when switching between repeating options.
    setRecurrence({
      frequency: option,
      interval: recurrence?.interval ?? 1,
      endDate: null,
      count: Math.max(1, repeatCount),
    });
  };

  const handleRepeatCountChange = (value: number) => {
    setRepeatCount(value);
    if (recurrence) {
      setRecurrence({ ...recurrence, count: value });
    }
  };

  // ---------------------------------------------------------------------------
  // Save
  // ---------------------------------------------------------------------------

  const handleSave = async () => {
    if (!title.trim()) return;

    const start = new Date(`${startDate}T${startTime}`);
    const end = new Date(`${endDate}T${endTime}`);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      setSaveError('Please provide a valid start date and end date.');
      return;
    }
    if (end <= start) {
      setSaveError('The end date and time must occur after the start date and time.');
      return;
    }

    // Recurring events are bounded by the occurrence count ("Number of times").
    const finalRecurrence: CalendarEventRecurrence | null = recurrence
      ? { ...recurrence, endDate: null, count: Math.max(1, repeatCount) }
      : null;

    try {
      await onSave?.(
        {
          title: title.trim(),
          description: description || null,
          eventType,
          startDate: start,
          endDate: end,
          recurrence: finalRecurrence,
          color: event.color ?? null,
          propertyId: event.propertyId ?? null,
        },
        { editScope, clickedDate: startDate },
      );

      onClose();
    } catch (error) {
      // Don't close modal on error — let user fix the issue
      const message = error instanceof Error ? error.message : 'Failed to save event';
      setSaveError(message);
    }
  };

  // ---------------------------------------------------------------------------
  // View-mode display values
  // ---------------------------------------------------------------------------

  const startDisplay = new Date(`${startDate}T${startTime}`);
  const endDisplay = new Date(`${endDate}T${endTime}`);
  const eventTypeLabel = EVENT_TYPES.find((t) => t.value === event.eventType)?.label || event.eventType;
  // Repeat option shown as text in view mode (button labels where available,
  // falling back to the lib labels for options outside the button set, e.g. Annually)
  const repeatOptionLabel = event.recurrence
    ? REPEAT_OPTIONS.find((o) => o.value === event.recurrence!.frequency)?.label
      || RECURRENCE_FREQUENCIES.find((f) => f.value === event.recurrence!.frequency)?.label
      || 'Repeats'
    : 'Does Not Repeat';

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={modalTitle} size="md">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!isViewMode) void handleSave();
        }}
        noValidate
      >
        {/* Event Title */}
        <div className="mb-4">
          <FieldLabel htmlFor="eventTitle">Event Title</FieldLabel>
          {isViewMode ? (
            <ViewValue>{event.title}</ViewValue>
          ) : (
            <input
              id="eventTitle"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Q3 Project Review Meeting"
              required
              className={inputClasses}
              style={inputStyles}
            />
          )}
        </div>

        {/* Description */}
        <div className="mb-4">
          <FieldLabel htmlFor="eventDescription">Description</FieldLabel>
          {isViewMode ? (
            <ViewValue>{event.description || '—'}</ViewValue>
          ) : (
            <textarea
              id="eventDescription"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Add notes, agenda, or meeting details..."
              className={`${inputClasses} resize-y`}
              style={inputStyles}
            />
          )}
        </div>

        {/* Event Type (below Description) */}
        <div className="mb-4">
          <FieldLabel htmlFor="eventType">Event Type</FieldLabel>
          {isViewMode ? (
            <ViewValue>{eventTypeLabel}</ViewValue>
          ) : (
            <select
              id="eventType"
              value={eventType}
              onChange={(e) => setEventType(e.target.value as CalendarEventType)}
              className={inputClasses}
              style={inputStyles}
            >
              {EVENT_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Date & Time matrix (2×2) */}
        <div className="grid grid-cols-2 gap-4 mb-5">
          <div>
            <FieldLabel htmlFor="startDate">Start Date</FieldLabel>
            {isViewMode ? (
              <ViewValue>{startDisplay.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</ViewValue>
            ) : (
              <input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => handleStartDateChange(e.target.value)}
                required
                className={inputClasses}
                style={inputStyles}
              />
            )}
          </div>
          <div>
            <FieldLabel htmlFor="startTime">Start Time</FieldLabel>
            {isViewMode ? (
              <ViewValue>{startDisplay.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</ViewValue>
            ) : (
              <input
                id="startTime"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className={inputClasses}
                style={inputStyles}
              />
            )}
          </div>
          <div>
            <FieldLabel htmlFor="stopDate">End Date</FieldLabel>
            {isViewMode ? (
              <ViewValue>{endDisplay.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</ViewValue>
            ) : (
              <input
                id="stopDate"
                type="date"
                value={endDate}
                min={startDate || undefined}
                onChange={(e) => setEndDate(e.target.value)}
                required
                className={inputClasses}
                style={inputStyles}
              />
            )}
          </div>
          <div>
            <FieldLabel htmlFor="stopTime">End Time</FieldLabel>
            {isViewMode ? (
              <ViewValue>{endDisplay.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</ViewValue>
            ) : (
              <input
                id="stopTime"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className={inputClasses}
                style={inputStyles}
              />
            )}
          </div>
        </div>

        {/* Repeat Option section — buttons in edit mode, text in view mode */}
        <div className="rounded-lg border p-4 mb-4" style={{ borderColor: '#dee2e6', backgroundColor: '#f8fafc' }}>
          <h3 className="m-0 mb-3 text-xs uppercase tracking-wider font-semibold" style={{ color: '#64748b' }}>
            Repeat Option
          </h3>
          {isViewMode ? (
            <ViewValue>{repeatOptionLabel}</ViewValue>
          ) : (
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Repeat Option">
              {REPEAT_OPTIONS.map((option) => {
                const selected = selectedRepeatOption === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => handleRepeatOptionChange(option.value)}
                    className={`px-2 py-2 rounded-lg text-sm border cursor-pointer transition-colors ${
                      selected ? 'font-semibold' : ''
                    }`}
                    style={
                      selected
                        ? { backgroundColor: '#F5A623', borderColor: '#F5A623', color: '#ffffff' }
                        : { backgroundColor: '#ffffff', borderColor: '#dee2e6', color: '#475569' }
                    }
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Number of times — below Repeat Option; disabled when Does Not Repeat */}
        {!isViewMode && (
          <div className="mb-4">
            <FieldLabel htmlFor="repeatCount">Number of times</FieldLabel>
            <input
              id="repeatCount"
              type="number"
              min={1}
              value={repeatCount}
              disabled={selectedRepeatOption === 'none'}
              title={selectedRepeatOption === 'none' ? 'Enabled when a repeat frequency is selected' : undefined}
              onChange={(e) => handleRepeatCountChange(Math.max(1, parseInt(e.target.value, 10) || 1))}
              className={`${inputClasses} w-28`}
              style={inputStyles}
            />
          </div>
        )}

        {/* Edit scope — shown only when editing a recurring instance */}
        {!isViewMode && isRecurringInstance && (
          <RecurrenceEditScopePicker
            isRecurringInstance={true}
            value={editScope}
            onChange={setEditScope}
          />
        )}

        {/* Recurrence summary — read-only text in view mode only (no rule editing) */}
        {isViewMode && recurrence ? (
          <div className="rounded-lg border p-4 mb-1" style={{ borderColor: '#dee2e6', backgroundColor: '#f8fafc' }}>
            <h3 className="m-0 mb-3 text-xs uppercase tracking-wider font-semibold" style={{ color: '#64748b' }}>
              Recurrence Rules
            </h3>
            <div className="px-3 py-2 rounded-lg border text-sm whitespace-pre-wrap" style={{ borderColor: '#dee2e6', backgroundColor: '#ffffff', color: '#1a1a2e' }}>
              <span className="mr-1" title="Recurring event">↻</span>
              {getRecurrenceEndDateLabel(recurrence.endDate, recurrence.count) || 'Repeats indefinitely'}
            </div>
          </div>
        ) : null}

        {/* Error message */}
        {saveError && (
          <div className="mt-4 p-3 rounded-lg border text-sm" style={{ borderColor: '#f5c6cb', backgroundColor: '#fef2f2', color: '#dc3545' }}>
            {saveError}
          </div>
        )}

        {/* Footer actions */}
        <div className="flex justify-end gap-3 mt-6">
          {isViewMode ? (
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white cursor-pointer"
              style={{ backgroundColor: '#F5A623' }}
            >
              Close
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-sm font-medium border cursor-pointer hover:bg-[#e2e8f0] transition-colors"
                style={{ borderColor: '#dee2e6', color: '#475569', backgroundColor: '#f1f5f9' }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!title.trim()}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white cursor-pointer disabled:opacity-50 transition-colors"
                style={{ backgroundColor: '#F5A623' }}
              >
                {isExisting ? 'Save Changes' : 'Add Event'}
              </button>
            </>
          )}
        </div>
      </form>
    </Modal>
  );
}
