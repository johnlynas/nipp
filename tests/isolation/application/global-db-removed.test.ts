/**
 * Application-layer isolation test: unscoped client removal (RLS Phase 3B)
 *
 * The unscoped `globalDb` Prisma client and its TS-only runtime guard
 * (`getGlobalDb` / `superAdminStorage`) have been DELETED. This test is the
 * structural guarantee that they stay deleted: importing them must fail, so a
 * future regression re-introducing a bypass client breaks CI explicitly
 * instead of silently re-opening a cross-tenant read path.
 *
 * Cross-tenant reads are now only possible through `lib/platform-db.ts`
 * (withPlatformContext / withTenantAdminContext), which runs under verified
 * platform-admin RLS context — that behaviour is covered by the Phase 2
 * database-layer probes and `tests/unit/rls-transaction.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../../../');

describe('unscoped globalDb client — deleted (RLS Phase 3B)', () => {
  it('lib/global-db.ts no longer exists', () => {
    expect(existsSync(resolve(root, 'lib/global-db.ts'))).toBe(false);
  });

  it('lib/global-db-guard.ts no longer exists', () => {
    expect(existsSync(resolve(root, 'lib/global-db-guard.ts'))).toBe(false);
  });

  it('no source file imports @/lib/global-db(-guard)', async () => {
    // Source-level assertion: a re-introduced import is the regression this
    // project must not get back. In-process scan (deliberately no external
    // binary — CI/subprocess PATHs vary) so the guard is hermetic.
    const { readdirSync, readFileSync } = await import('node:fs');
    const bad = new Set<string>();
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(resolve(dir, entry.name));
        else if (/\.(ts|tsx|mjs|cjs|js)$/.test(entry.name) && !/node_modules|next\/dist/.test(entry.name)) {
          const p = resolve(dir, entry.name);
          if (readFileSync(p, 'utf8').includes('@/lib/global-db')) bad.add(p);
        }
      }
    };
    for (const sub of ['lib', 'app', 'services']) walk(resolve(root, sub));
    expect([...bad].map((p) => p.slice(root.length + 1))).toEqual([]);
  });
});
