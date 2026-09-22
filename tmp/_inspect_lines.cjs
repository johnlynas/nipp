
const fs = require('fs');
const lines = fs.readFileSync('/Users/johnlynas/dev/nipp-0807/.env.test', 'utf8').split('\n');
for (let i = 0; i < lines.length; i++) {
  if (/^RATE_LIMIT_AUTH_/.test(lines[i])) {
    // Print a redacted shape: key stays, value replaced by a masked pattern
    const m = lines[i].match(/^(RATE_LIMIT_AUTH_[A-Z]+)="?/);
    console.log('line', i + 1, 'starts:', lines[i].slice(0, 30), '... len', lines[i].length);
    // Show char codes of the tail after '=' to spot stray quotes/CR
    const eq = lines[i].indexOf('=');
    const tail = lines[i].slice(eq + 1);
    console.log('   afterEq charCodes:', [...tail.slice(0, 12)].map(c => c).join(','));
  }
}
