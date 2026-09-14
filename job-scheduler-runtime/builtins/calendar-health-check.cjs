/**
 * Built-in handler: `calendar-health-check`
 *
 * Probes the calendar "due to start" notification pipeline from inside a forked
 * worker by running the same discovery the live scanner uses (single +
 * rrule-recurring events whose start falls in (now, now + 15m]). Recurring series
 * are expanded with the app's `rrule` engine, mapped from the stored RruleJson
 * contract exactly as lib/recurrence-rrule.ts does (worker-side cannot import the
 * TS module; the mapping is mirrored here).
 *
 * If discovery throws — query shape drift or DB unreachable from a worker — the
 * job FAILS, so a broken calendar-notification substrate is visible in execution
 * history instead of failing silently.
 */
'use strict';

const LEAD_MINUTES = 15;
const MAX_OCCURRENCES_CAP = 200; // expansion safety cap for the health probe

// ---------------------------------------------------------------------------
// RRule engine — mirror of lib/recurrence-rrule.ts mapping (worker-side CJS).
// The stored rrule JSON contract: { freq, interval, dtstart, until, count,
// byweekday?, bymonthday? } with freq in DAILY|WEEKLY|MONTHLY|QUARTERLY|
// SEMI_ANNUALLY|YEARLY.
// ---------------------------------------------------------------------------

let RRule = null;
try {
  const mod = require('rrule');
  RRule = mod.RRule || (mod.default && mod.default.RRule) || mod;
} catch { /* expansion disabled if the engine is unresolvable */ }

const FREQ_MAP = { DAILY: 'DAILY', WEEKLY: 'WEEKLY', MONTHLY: 'MONTHLY', QUARTERLY: 'MONTHLY', SEMI_ANNUALLY: 'MONTHLY', YEARLY: 'YEARLY' };
const DAY_KEYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

function mapFrequency(freq) {
  const f = FREQ_MAP[freq];
  return RRule ? RRule[f] : f; // RRule.DAILY etc.
}

function mapInterval(freq, interval) {
  if (freq === 'QUARTERLY') return interval * 3;
  if (freq === 'SEMI_ANNUALLY') return interval * 6;
  return interval;
}

/** Build an RRule instance from the stored JSON contract (null if unbuildable). */
function buildRrule(rruleJson) {
  if (!RRule || !rruleJson) return null;
  try {
    const dtstart = new Date(rruleJson.dtstart);
    if (Number.isNaN(dtstart.getTime())) return null;
    const normFreq = String(rruleJson.freq).toUpperCase();
    const opts = {
      freq: mapFrequency(normFreq),
      interval: mapInterval(normFreq, Number(rruleJson.interval) || 1),
      dtstart,
    };
    if (rruleJson.count != null) opts.count = Number(rruleJson.count);
    if (rruleJson.until != null) {
      const u = new Date(rruleJson.until);
      if (!Number.isNaN(u.getTime())) opts.until = u;
    }
    if (Array.isArray(rruleJson.byweekday)) {
      const days = rruleJson.byweekday.map((d) => RRule[DAY_KEYS.includes(d) ? d : 'MO']).filter(Boolean);
      if (days.length) opts.byweekday = days;
    }
    if (Array.isArray(rruleJson.bymonthday) && rruleJson.bymonthday.length) {
      opts.bymonthday = rruleJson.bymonthday.map(Number).filter((n) => Number.isFinite(n));
    }
    return new RRule(opts);
  } catch {
    return null;
  }
}

function parseRruleRaw(raw) {
  if (raw == null) return null;
  try {
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return obj && obj.freq ? obj : null;
  } catch {
    return null;
  }
}

function exdateSet(raw) {
  const set = new Set();
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (Array.isArray(arr)) for (const d of arr) set.add(String(d).slice(0, 10));
  } catch { /* no exdates */ }
  return set;
}

function ymd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

async function execute(ctx) {
  const db = ctx.db();
  const now = new Date();
  const windowEnd = new Date(now.getTime() + LEAD_MINUTES * 60_000);

  let dueInstances = 0;
  const samples = [];
  let singles = [];
  let recurringSeries = [];

  // Events starting in the lead window. Prisma rejects JSON null-equality on
  // `rrule`, so — exactly like the live scanner (lib/calendar-event-scheduler.ts)
  // — we branch on rrule in code rather than a DB-level filter.
  try {
    const candidates = await db.calendarEvent.findMany({
      where: { startDate: { gte: now, lte: windowEnd } },
      orderBy: { startDate: 'asc' },
      select: { id: true, title: true, eventType: true, organizationId: true, startDate: true, endDate: true, rrule: true, exdates: true },
    });
    for (const ev of candidates) {
      if (parseRruleRaw(ev.rrule)) recurringSeries.push(ev);
      else singles.push(ev);
    }
  } catch (e) {
    throw new Error(`calendar discovery query failed: ${String(e.message).split('\n')[0]}`);
  }

  for (const ev of singles) {
    const start = new Date(ev.startDate);
    if (start > now && start <= windowEnd) {
      dueInstances++;
      samples.push(sample(ev, start));
      if (samples.length >= 5) break;
    }
  }

  for (const ev of recurringSeries) {
    const rule = buildRrule(parseRruleRaw(ev.rrule));
    if (!rule) continue; // malformed series — the live scanner skips it too
    const exdates = exdateSet(ev.exdates);
    const durationMs = Math.max(0, new Date(ev.endDate).getTime() - new Date(ev.startDate).getTime());
    // Efficient range expansion (mirrors lib/recurrence-rrule.ts): query a small
    // window extended by the event duration, not the whole series history.
    const queryStart = new Date(now.getTime() - Math.max(86_400_000, durationMs));
    const queryEnd = new Date(windowEnd.getTime() + durationMs);
    try {
      let count = 0;
      for (const occ of rule.between(queryStart, queryEnd, true)) {
        count++;
        if (count > MAX_OCCURRENCES_CAP) break; // hard safety cap
        const start = new Date(occ);
        if (start.getTime() < now.getTime()) continue;
        if (exdates.has(ymd(start))) continue;
        dueInstances++;
        if (samples.length < 5) samples.push(sample(ev, start));
      }
    } catch { /* malformed expansion → treat as no occurrences */ }
  }

  return {
    handler: 'calendar-health-check',
    pipelineReachable: true,
    rruleEngineAvailable: Boolean(RRule),
    scannedSingle: singles.length,
    scannedRecurring: recurringSeries.length,
    dueInstances,
    samples,
    checkedAt: now.toISOString(),
  };
}

function sample(ev, start) {
  return {
    eventId: ev.id,
    title: ev.title,
    organizationId: ev.organizationId,
    startsAt: start.toISOString(),
  };
}

module.exports = { execute };
