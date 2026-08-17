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
  recurrenceId?: string | null;
  /** Recurrence rule details (present when the event repeats). */
  recurrence?: CalendarEventRecurrence | null;
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

export interface CalendarRecurrence {
  id: string;
  frequency: CalendarRecurrenceFrequency;
  interval: number;
  endDate?: Date | null;
  count?: number | null;
  byDay?: string | null;
  byMonthDay?: number | null;
}

// ---------------------------------------------------------------------------
// View Types
// ---------------------------------------------------------------------------

export type CalendarView = 'month' | 'week' | 'day';

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

export const RECURRENCE_FREQUENCIES: { value: CalendarRecurrenceFrequency; label: string }[] = [
  { value: 'DAILY', label: 'Daily' },
  { value: 'WEEKLY', label: 'Weekly' },
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'QUARTERLY', label: 'Quarterly' },
  { value: 'SEMI_ANNUALLY', label: 'Semi-Annually' },
  { value: 'ANNUALLY', label: 'Annually' },
];

export const EVENT_TYPES: { value: CalendarEventType; label: string }[] = [
  { value: 'VIEWING', label: 'Viewing' },
  { value: 'INSPECTION', label: 'Inspection' },
  { value: 'MAINTENANCE', label: 'Maintenance' },
  { value: 'LEASE_SIGNING', label: 'Lease Signing' },
  { value: 'LEASE_RENEWAL', label: 'Lease Renewal' },
  { value: 'KEY_EXCHANGE', label: 'Key Exchange' },
  { value: 'OTHER', label: 'Other' },
];
