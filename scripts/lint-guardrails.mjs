#!/usr/bin/env node
/**
 * lint-guardrails — structural misuse scanner (RLS plan Task 4B, design §5.2).
 *
 * Complements ESLint with checks the rule system can't express:
 *   1. `new PrismaClient(` may only appear in lib/db.ts — the single canonical
 *      instance everyone else imports (tenant platform-db wrappers included).
 *      A second client breaks pooled-connection assumptions the RLS context
 *      binding relies on (GUCs are set per physical connection).
 *   2. No stray `set_config('app.current_*')` outside lib/rls-context.ts —
 *      every GUC bind must flow through the choke point builder.
 *
 * Wired into `npm run lint`. Exits non-zero on any violation (blocks CI).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = new URL('..', import.meta.url).pathname;
const IGNORED_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'job-scheduler-runtime', 'tmp']);
const SCAN_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

/**
 * Relative-path exemptions (documented, by design):
 *  - this scanner itself (its patterns live as literals in comments/regexes)
 *  - prisma seed & migration scripts: one-off OWNER-role tooling; a separate
 *    client is Prisma's standard for seeds and never rides request traffic
 *  - tests/**: unit tests assert the GUC SQL shape directly (they don't bind)
 *  - throwaway probe/verify scripts (tmp-*, *probe*, rls-*-verify): they drive
 *    raw pg connections as a specific role — exactly the point of §5.1 probes
 */
const REL_EXEMPT = /^(scripts\/lint-guardrails\.mjs|prisma\/(seed\.(ts|js)|migration-scripts\/.*|rls-.*))|^tests\/|(tmp-[^/]*\.(mjs|cjs|ts)$|[^/]*probe[^/]*\.(mjs|cjs)$|scripts\/rls-phase2-verify\.mjs$|scripts\/rls-perf-benchmark\.ts$)/;

/** @type {{rel: string, abs: string}[]} */
const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (IGNORED_DIRS.has(entry)) continue;
    const abs = path.join(dir, entry);
    const st = statSync(abs);
    const rel = path.relative(ROOT, abs);
    if (st.isDirectory()) walk(abs);
    else if (SCAN_EXTS.has(path.extname(entry)) && !REL_EXEMPT.test(rel)) {
      files.push({ rel, abs });
    }
  }
})(ROOT);

let violations = 0;
function fail(rel, line, msg) {
  violations++;
  console.error(`✗ ${rel}:${line + 1}  ${msg}`);
}

for (const { rel, abs } of files) {
  const text = readFileSync(abs, 'utf8');
  if (!text.includes('PrismaClient') && !text.includes("set_config('app.")) continue;
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 1. new PrismaClient( — canonical instance lives exclusively in lib/db.ts.
    if (/new\s+PrismaClient\s*\(/.test(line) && rel !== 'lib/db.ts') {
      fail(rel, i, `new PrismaClient(...) forbidden outside lib/db.ts (pool/connection assumptions of the RLS context binding).`);
    }

    // 2. GUC binds must go through buildRLSContextQueries (lib/rls-context.ts).
    //    Test fixtures that set GUCs DIRECTLY on a raw pg client are exempt —
    //    they exercise the DB layer independently of app code by design (§5.1).
    if (/set_config\(\s*['"]app\./.test(line)) {
      const allowed = rel.startsWith('lib/rls-context') || rel.startsWith('tests/isolation/database/') || rel.startsWith('scripts/tmp-');
      if (!allowed) {
        fail(rel, i, `set_config('app.*') GUC bind must go through lib/rls-context.ts (single choke point).`);
      }
    }
  }
}

if (violations > 0) {
  console.error(`\nlint-guardrails: ${violations} violation(s)`);
  process.exit(1);
}
console.log('lint-guardrails: OK — no PrismaClient/set_config misuse');
