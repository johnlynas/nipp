'use client';

import { useEffect, useRef } from 'react';
import type { ContextMenuPosition, ContextMenuDateCell, ContextMenuEventCell } from './types';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CalendarContextMenuProps {
  position: ContextMenuPosition | null;
  dateCell: ContextMenuDateCell | null;
  eventCell: ContextMenuEventCell | null;
  onClose: () => void;
  onAddEvent?: (date: Date) => void;
  onViewEvent?: (event: ContextMenuEventCell['event']) => void;
  onEditEvent?: (event: ContextMenuEventCell['event']) => void;
  onDeleteEvent?: (event: ContextMenuEventCell['event']) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CalendarContextMenu({
  position,
  dateCell,
  eventCell,
  onClose,
  onAddEvent,
  onViewEvent,
  onEditEvent,
  onDeleteEvent,
}: CalendarContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!position) return;

    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [position, onClose]);

  if (!position) return null;

  const handleAddEvent = () => {
    onAddEvent?.(dateCell!.date);
    onClose();
  };

  const handleDeleteEvent = () => {
    onDeleteEvent?.(eventCell!.event);
    onClose();
  };

  return (
    <div
      ref={menuRef}
      className="fixed z-50 bg-white rounded-lg shadow-lg border py-1 min-w-[180px]"
      style={{
        left: position.x,
        top: position.y,
        borderColor: '#dee2e6',
      }}
    >
      {eventCell ? (
        /* Event context menu */
        <>
          {/* View option */}
          {onViewEvent && (
            <button
              onClick={() => {
                onViewEvent(eventCell.event);
                onClose();
              }}
              className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 transition-colors flex items-center gap-2"
              style={{ color: '#1B2A4A' }}
            >
              <span>👁</span> View Event
            </button>
          )}

          {/* Edit option */}
          {onEditEvent && (
            <button
              onClick={() => {
                onEditEvent(eventCell.event);
                onClose();
              }}
              className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 transition-colors flex items-center gap-2"
              style={{ color: '#1B2A4A' }}
            >
              <span>✏️</span> Edit Event
            </button>
          )}

          {/* Delete option */}
          <button
            onClick={handleDeleteEvent}
            className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 transition-colors flex items-center gap-2"
            style={{ color: '#E76F51' }}
          >
            <span>🗑</span> Delete Event
          </button>
        </>
      ) : (
        /* Date context menu — Add Event only */
        <>
          {/* Add Event option */}
          {onAddEvent && (
            <button
              onClick={handleAddEvent}
              className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 transition-colors flex items-center gap-2"
              style={{ color: '#1B2A4A' }}
            >
              <span>+</span> Add Event
            </button>
          )}
        </>
      )}
    </div>
  );
}
