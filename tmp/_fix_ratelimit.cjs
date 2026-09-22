
const fs = require('fs');
const p = '/Users/johnlynas/dev/nipp-0807/.env.test';
let raw = fs.readFileSync(p, 'utf8');
// Replace the redacted (literal "***") auth rate-limit values with plain numbers.
raw = raw.replace(/^RATE_LIMIT_AUTH_MAX=.*/m, 'RATE_LIMIT_AUTH_MAX="50"');
raw = raw.replace(/^RATE_LIMIT_AUTH_WINDOW=.*/m, 'RATE_LIMIT_AUTH_WINDOW="60"');
fs.writeFileSync(p, raw);
let bad = 0;
for (const line of raw.split('\n')) {
  const m = line.match(/^(RATE_LIMIT_[A-Z_]+)="?([^"]*)"?\s*$/);
  if (m && !/^\d+$/.test(m[2])) { console.log('STILL BAD:', m[1]); bad++; }
}
console.log(bad === 0 ? 'ALL RATE_LIMIT VALUES CLEAN' : bad + ' bad values remain');
