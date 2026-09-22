const fs = require('fs');
const p = '/Users/johnlynas/dev/nipp-0807/.env.test';
let raw = fs.readFileSync(p, 'utf8');
const nl = raw.includes('\r\n') ? '\r\n' : '\n';

// Strip trailing "  # comment" that follows a quoted value on the same line,
// for lines that set a key (not pure comment / blank). Keeps inline comments
// safe for the Playwright parseEnvFile which has no comment handling.
const cleanedLines = raw.split(nl).map(line => {
  const m = line.match(/^([A-Z0-9_]+=)(.*?["']?)\s+#.*$/);
  if (!m) return line;
  // Only re-quote/trim if what precedes the comment is a quoted token.
  const head = (m[1] + m[2]).replace(/\s+#.*$/, '');
  return head;
});
raw = cleanedLines.join(nl);

// Ensure PGBOUNCER_PASSWORD present (required by non-test env schema path).
if (!/^PGBOUNCER_PASSWORD=/.test(raw)) {
  const anchor = 'REDIS_URL=';
  idx = raw.indexOf(anchor);
  ins = 'PGBOUNCER_PASSWORD="postgres"' + nl + nl;
  if (idx >= 0) {
    raw = raw.slice(0, idx) + ins + raw.slice(idx);
  } else {
    raw += '\n' + ins;
  }
}

fs.writeFileSync(p, raw);
console.log('wrote .env.test', 'NL=' + nl.length);