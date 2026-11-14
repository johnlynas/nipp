-- ============================================================
-- CalendarEvent: add allDay flag for first-class "All day" events.
-- Additive, non-destructive: existing rows become allDay = false
-- via the column default (no data backfill needed — no existing
-- event is all-day).
-- ============================================================

ALTER TABLE "CalendarEvent" ADD COLUMN "allDay" BOOLEAN NOT NULL DEFAULT false;
