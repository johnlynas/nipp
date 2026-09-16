const later = require('@breejs/later');
later.date.localTime();
function next(expr, t, tz) {
  const s = later.schedule(later.parse.cron(expr, false, tz));
  const p = s.next(1, new Date(t));
  return p instanceof Date ? p.toISOString() : 'NEVER';
}
const fmt = (l, e, t) => console.log(l.padEnd(28), e.padEnd(14), '→', next(e, t));

// minute cron, next(1, X):
fmt('min', '* * * * *', '2026-01-01T00:00:00.000Z'); // exact occurrence — inclusive or after?
fmt('min', '* * * * *', '2026-01-01T00:00:30.000Z');
fmt('min', '* * * * *', '2026-01-01T00:00:30.500Z');
fmt('min', '* * * * *', '2026-01-01T00:01:00.000Z');
// 5-min cron, next(1, X):
fmt('5m',  '*/5 * * * *', '2026-01-01T00:00:00.000Z'); // exact occurrence
fmt('5m',  '*/5 * * * *', '2026-01-01T00:00:00.001Z'); // one ms after
fmt('5m',  '*/5 * * * *', '2026-01-01T00:00:30.500Z');
// daily + tz: next(1, X) with timezone
fmt('daily SG', '0 1 * * *', '2026-01-01T16:45:00.000Z'); // 00:45 local (UTC+8) → expect 01:00 local = 17:00Z
fmt('daily SG', '0 1 * * *', '2026-01-01T17:30:00.000Z'); // 01:30 local → expect next day 01:00 local = 17:00Z Jan2
