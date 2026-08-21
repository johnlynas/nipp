/**
 * Shared TypeScript types for the calendar component.
 */

// ---------------------------------------------------------------------------
// Event Types
// ---------------------------------------------------------------------------

export type CalendarEventType =
  | 'VIEWING'
  | 'INSPECTION'
  | 'MAINTENANCE'
  | 'LEASE_SIGNING'
  | 'LEASE_RENEWAL'
  | 'KEY_EXCHANGE'
  | 'OTHER';

export type CalendarRecurrenceFrequency =
  | 'DAILY'
  | 'WEEKLY'
  | 'MONTHLY'
  | 'QUARTERLY'
  | 'SEMI_ANNUALLY'
  | 'ANNUALLY';

export interface CalendarEventRecurrence {
  frequency: CalendarRecurrenceFrequency;
  interval: number;
  endDate?: Date | null;
  count?: number | null;
  /** ISO date strings (YYYY-MM-DD) excluded from expansion. */
  excludedDates?: string[];
}

export interface CalendarEvent {
  id: string;
  title: string;
  description?: string | null;
  startDate: Date;
  endDate: Date;
  eventType: CalendarEventType;
  color?: string | null;
  calendarId: string;
  /** Recurrence rule details (present when the event repeats). */
  recurrence?: CalendarEventRecurrence | null;
  /** RFC 5545 rrule JSON string (raw, for debugging/API consumers).
   *  Format: { freq, interval, dtstart, until, count, byweekday?, bymonthday? }
   *  freq: DAILY|WEEKLY|MONTHLY|YEARLY (QUARTERLY/SEMI_ANNUALLY stored as MONTHLY with interval×3/×6)
   *  dtstart: ISO date string for the first occurrence
   *  until: optional end date (ISO string) or null for infinite recurrence
   *  count: optional occurrence count or null when using until
   */
  rrule?: string | null;
  /** Excluded dates from expansion (YYYY-MM-DD strings). */
  exdates?: string[];
  propertyId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Calendar {
  id: string;
  name: string;
  description?: string | null;
  color: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// View Types
// ---------------------------------------------------------------------------

export type CalendarView = 'month' | 'week' | 'day' | 'year';

// ---------------------------------------------------------------------------
// Component Props
// ---------------------------------------------------------------------------

export interface CalendarProps {
  organizationId: string;
  initialView?: CalendarView;
  className?: string;
}

export interface MonthGridCell {
  date: Date;
  isCurrentMonth: boolean;
  events: CalendarEvent[];
}

export interface WeekDay {
  date: Date;
  events: CalendarEvent[];
}

export interface DaySlot {
  hour: number;
  events: CalendarEvent[];
}

// ---------------------------------------------------------------------------
// Sidebar Types
// ---------------------------------------------------------------------------

export interface UpcomingEvent {
  id: string;
  title: string;
  startDate: Date;
  endDate: Date;
  eventType: CalendarEventType;
  color?: string | null;
}

export interface QuickAddInput {
  eventType: CalendarEventType;
  date: string; // YYYY-MM-DD format
}

// ---------------------------------------------------------------------------
// Modal Types
// ---------------------------------------------------------------------------

export interface EventModalProps {
  event: CalendarEvent | null;
  isOpen: boolean;
  onClose: () => void;
  onSave?: (event: Partial<CalendarEvent>) => Promise<void>;
  onDelete?: (eventId: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Context Menu Types
// ---------------------------------------------------------------------------

export interface ContextMenuPosition {
  x: number;
  y: number;
}

export interface ContextMenuDateCell {
  date: Date;
  isCurrentMonth: boolean;
}

export interface ContextMenuEventCell {
  event: CalendarEvent;
}

// ---------------------------------------------------------------------------
// Recurrence Picker Types
// ---------------------------------------------------------------------------

export interface RecurrencePickerValue {
  frequency: CalendarRecurrenceFrequency;
  interval: number;
  endDate?: Date | null;
  count?: number | null;
}

export interface RecurrencePickerProps {
  /** The current recurrence rule, or null/undefined when the event does not repeat. */
  value?: RecurrencePickerValue | null;
  onChange: (value: RecurrencePickerValue | null) => void;
}

// Re-export from lib for convenience — components can import directly from either place.
export { RECURRENCE_FREQUENCIES } from '@/lib/recurrence';

export const EVENT_TYPES: { value: CalendarEventType; label: string }[] = [
  { value: 'VIEWING', label: 'Viewing' },
  { value: 'INSPECTION', label: 'Inspection' },
  { value: 'MAINTENANCE', label: 'Maintenance' },
  { value: 'LEASE_SIGNING', label: 'Lease Signing' },
  { value: 'LEASE_RENEWAL', label: 'Lease Renewal' },
  { value: 'KEY_EXCHANGE', label: 'Key Exchange' },
  { value: 'OTHER', label: 'Other' },
];
