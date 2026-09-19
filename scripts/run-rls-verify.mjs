/**
 * run-rls-verify.mjs — env loader wrapper for scripts/rls-phase2-verify.mjs.
 * Parses .env (handles quoted values, CRLF), populates process.env, imports the verifier.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const envPath = path.join(import.meta.dirname, '..', '.env');
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = /^\s*([A-Z0-9_]+)=(.*)$/.exec(line);
  if (!m) continue;
  let v = m[2].trim().replace(/\r$/, '');
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  process.env[m[1]] ??= v;
}
await import('./rls-phase2-verify.mjs');
