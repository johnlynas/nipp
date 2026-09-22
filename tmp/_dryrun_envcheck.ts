
// Simulate the spawned dev server's env: .env.test into process.env, non-test path.
import { readFileSync } from 'node:fs';
import { envSchema } from '../lib/env-schema';

const raw = readFileSync(new URL('../.env.test', import.meta.url), 'utf8');
function parse(line: string): [string, string] | null {
  const t = line.trim();
  if (!t || t.startsWith('#')) return null;
  const i = t.indexOf('=');
  if (i === -1) return null;
  let v = t.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  return [t.slice(0, i).trim(), v];
}
const fileEnv: Record<string, string> = {};
for (const line of raw.split('\n')) { const kv = parse(line); if (kv) fileEnv[kv[0]] = kv[1]; }
for (const k of Object.keys(fileEnv)) {
  let v = fileEnv[k];
  for (let i = 0; i < 5 && /\$\{[^}]+\}/.test(v); i++) v = v.replace(/\$\{([^}]+)\}/g, (_, n: string) => fileEnv[n] ?? process.env[n] ?? '');
  fileEnv[k] = v;
}
process.env.NODE_ENV = 'development'; // force the non-test validation path
for (const [k, v] of Object.entries(fileEnv)) process.env[k] = v;

const res = envSchema.safeParse(process.env);
if (res.success) { console.log('ENV SCHEMA OK (non-test path)'); process.exit(0); }
for (const iss of res.error.issues) console.log('FAIL', iss.path.join('.'), '|', iss.message);
process.exit(1);
