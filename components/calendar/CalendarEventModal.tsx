'use client';

import { useState, useEffect } from 'react';
import type { CalendarEvent, CalendarEventType } from './types';
import { EVENT_TYPES } from './types';
import { Modal } from '@/components/dashboard/Modal';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CalendarEventModalProps {
  event: CalendarEvent | null;
  isOpen: boolean;
  onClose: () => void;
  onSave?: (event: Partial<CalendarEvent>) => Promise<void>;
  isViewMode?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CalendarEventModal({
  event,
  isOpen,
  onClose,
  onSave,
  isViewMode = false,
}: CalendarEventModalProps) {
  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [eventType, setEventType] = useState<CalendarEventType>('OTHER');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Error state for save failures
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (event) {
      setTitle(event.title);
      setDescription(event.description || '');
      setEventType(event.eventType);
      setStartDate(
        event.startDate instanceof Date
          ? event.startDate.toISOString().slice(0, 16)
          : String(event.startDate).slice(0, 16)
      );
      setEndDate(
        event.endDate instanceof Date
          ? event.endDate.toISOString().slice(0, 16)
          : String(event.endDate).slice(0, 16)
      );
    }
    // Clear error when event changes
    setSaveError(null);
  }, [event]);

  if (!isOpen || !event) return null;

  const isExisting = event.id && !event.id.startsWith('temp-');
  const modalTitle = isViewMode ? 'Event Details' : (isExisting ? 'Edit Event' : 'Add Event');

  const handleSave = async () => {
    if (!title.trim()) return;

    try {
      await onSave?.({
        title: title.trim(),
        description: description || null,
        eventType,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
      });

      onClose();
    } catch (error) {
      // Don't close modal on error — let user fix the issue
      const message = error instanceof Error ? error.message : 'Failed to save event';
      setSaveError(message);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={modalTitle} size="md">
      <div className="space-y-4">
        {/* Title */}
        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: '#1B2A4A' }}>
            Title
          </label>
          {isViewMode ? (
            <div className="w-full px-3 py-2 rounded border text-sm" style={{ borderColor: '#dee2e6', color: '#1B2A4A' }}>{event.title}</div>
          ) : (
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 rounded border text-sm focus:outline-none"
              style={{ borderColor: '#dee2e6', color: '#1B2A4A' }}
            />
          )}
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: '#1B2A4A' }}>
            Description
          </label>
          {isViewMode ? (
            <div className="w-full px-3 py-2 rounded border text-sm min-h-[60px] whitespace-pre-wrap" style={{ borderColor: '#dee2e6', color: '#1B2A4A' }}>{event.description || '—'}</div>
          ) : (
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 rounded border text-sm resize-none focus:outline-none"
              style={{ borderColor: '#dee2e6', color: '#1B2A4A' }}
            />
          )}
        </div>

        {/* Event Type */}
        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: '#1B2A4A' }}>
            Event Type
          </label>
          {isViewMode ? (
            <div className="w-full px-3 py-2 rounded border text-sm" style={{ borderColor: '#dee2e6', color: '#1B2A4A' }}>
              {EVENT_TYPES.find((t) => t.value === event.eventType)?.label || event.eventType}
            </div>
          ) : (
            <select
              value={eventType}
              onChange={(e) => setEventType(e.target.value as CalendarEventType)}
              className="w-full px-3 py-2 rounded border text-sm focus:outline-none"
              style={{ borderColor: '#dee2e6', color: '#1B2A4A' }}
            >
              {EVENT_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Date/Time */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: '#1B2A4A' }}>
              Start
            </label>
            {isViewMode ? (
              <div className="w-full px-3 py-2 rounded border text-sm" style={{ borderColor: '#dee2e6', color: '#1B2A4A' }}>
                {event.startDate.toLocaleString()}
              </div>
            ) : (
              <input
                type="datetime-local"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 rounded border text-sm focus:outline-none"
                style={{ borderColor: '#dee2e6', color: '#1B2A4A' }}
              />
            )}
          </div>
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: '#1B2A4A' }}>
              End
            </label>
            {isViewMode ? (
              <div className="w-full px-3 py-2 rounded border text-sm" style={{ borderColor: '#dee2e6', color: '#1B2A4A' }}>
                {event.endDate.toLocaleString()}
              </div>
            ) : (
              <input
                type="datetime-local"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2 rounded border text-sm focus:outline-none"
                style={{ borderColor: '#dee2e6', color: '#1B2A4A' }}
              />
            )}
          </div>
        </div>
      </div>

      {/* Error message */}
      {saveError && (
        <div className="mt-4 p-3 rounded bg-red-50 border text-sm" style={{ borderColor: '#f5c6cb', color: '#dc3545' }}>
          {saveError}
        </div>
      )}

      {/* Footer */}
      <div className="mt-4 flex justify-end gap-2">
        {isViewMode ? (
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded text-sm font-semibold text-white"
            style={{ backgroundColor: '#F5A623' }}
          >
            Close
          </button>
        ) : (
          <>
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded text-sm font-medium border"
              style={{ borderColor: '#dee2e6', color: '#1B2A4A' }}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!title.trim()}
              className="px-4 py-1.5 rounded text-sm font-semibold text-white disabled:opacity-50"
              style={{ backgroundColor: '#F5A623' }}
            >
              {isExisting ? 'Save Changes' : 'Add Event'}
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
