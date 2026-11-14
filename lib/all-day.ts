/**
 * All-day event helpers — single source of truth for all-day date conventions.
 *
 * Storage convention (see .hermes/plans/2026-11-05_125314-all-day-events-design.md):
 *   allDay = true
 *   startDate = 00:00:00.000 (local) of the first day
 *   endDate   = 23:59:59.999 (local) of the last day (inclusive)
 *
 * All date normalisation for all-day events happens in normalizeAllDayDates,
 * which the service calls on create and update. Views branch on isAllDayEvent
 * at render time — no other code may set or interpret all-day boundaries.
 */

/**
 * Clamp an event's dates to day boundaries when it is all-day.
 * Timed events pass through untouched.
 */
export function normalizeAllDayDates(
  startDate: Date,
  endDate: Date,
  allDay: boolean,
): { startDate: Date; endDate: Date } {
  if (!allDay) return { startDate, endDate };
  const s = new Date(startDate);
  s.setHours(0, 0, 0, 0);
  const e = new Date(endDate);
  e.setHours(23, 59, 59, 999);
  // Guard: an all-day event may not end before it starts. The caller is
  // responsible for validating end >= start (existing validation covers it).
  return { startDate: s, endDate: e };
}

/**
 * True when a stored event is all-day.
 *
 * Defensive — the explicit flag is authoritative; the fallback also covers
 * legacy rows written as midnight→23:59:59.999 on a single day before the
 * column existed (none exist today, but this keeps rendering consistent).
 */
export function isAllDayEvent(e: {
  allDay?: boolean;
  startDate: Date;
  endDate: Date;
}): boolean {
  if (e.allDay) return true;
  const s = e.startDate instanceof Date ? e.startDate : new Date(e.startDate);
  const en = e.endDate instanceof Date ? e.endDate : new Date(e.endDate);
  if (isNaN(s.getTime()) || isNaN(en.getTime())) return false;
  return (
    s.getHours() === 0 &&
    s.getMinutes() === 0 &&
    s.getSeconds() === 0 &&
    en.getHours() === 23 &&
    en.getMinutes() === 59 &&
    en.getSeconds() === 59 &&
    s.getDate() === en.getDate() &&
    s.getMonth() === en.getMonth() &&
    s.getFullYear() === en.getFullYear()
  );
}
