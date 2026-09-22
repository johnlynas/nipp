/**
 * Application-layer hardening tests (RLS plan Task 4B, design §5.2):
 *   1. TENANT_SCOPED_MODELS must cover EXACTLY the schema models that carry a
 *      required org column — no silent drift when a model is renamed or a new
 *      org-scoped model lands un-listed.
 *   2. count / aggregate / groupBy are scoped with the same rules as findMany
 *      (org-injected where; fail-closed without context; platform passthrough).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Schema-derived source of truth for "which models carry a required org column".
// Parsed live from prisma/schema.prisma (same rules as `prisma db pull` DMMF:
// scalar field named organizationId/orgId, type String, required, not array).
// This is the drift guard itself — no hand-maintained list.
// ---------------------------------------------------------------------------
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function modelsWithRequiredOrgField(schemaText: string): string[] {
  const orgModels: string[] = [];
  for (const block of schemaText.matchAll(/^model (\w+) \{[\s\S]*?^\}/gm)) {
    const name = block[1];
    const body = block[0].replace(/^model \w+ \{/, '').replace(/\}$/, '');
    // Field lines: name <type>(?)(?) — required means no '?' and type not '[]'.
    for (const line of body.split('\n')) {
      const m = line.match(/^\s*("?)(organizationId|orgId)\1 +String(\??)(\[\])?.*$/);
      if (m && !m[3] && !m[4]) {
        orgModels.push(name);
        break; // first qualifying field wins per model
      }
    }
  }
  return orgModels;
}

const SCHEMA_ORG_SCOPED_MODELS = modelsWithRequiredOrgField(
  readFileSync(path.resolve(__dirname, '../../prisma/schema.prisma'), 'utf8'),
);

// ---------------------------------------------------------------------------
// Mock state (same shape as tenant-extension-core reads).
// ---------------------------------------------------------------------------
const mockState = { userId: null as string | null, orgId: null as string | null, flag: null as '0' | '1' | null };

vi.mock('@/lib/tenant-context', () => ({
  getCurrentOrgId: () => mockState.orgId,
  getTenantContext: () => {
    if (!mockState.userId || !mockState.orgId) return null;
    return { userId: mockState.userId, orgId: mockState.orgId, isPlatformAdmin: mockState.flag ?? '0' };
  },
}));

// A minimal Prisma client whose models accept any op and RECORD the args.
const calls: Array<{ model: string; op: string; args: Record<string, unknown> }> = [];

vi.mock('@/lib/db', () => {
  // Mini-emulation of prisma.$extends: applying an extension wraps each
  // model op with the extension's ({args, query}) handler; `query` records
  // the final args — exactly what tenant-db.ts relies on. Unhandled ops pass
  // through raw (so count/aggregate/groupBy are recorded until Task 4B adds
  // handlers for them).
  const extOps: Record<string, Record<string, (cb: { args: Record<string, unknown>; query: (a: Record<string, unknown>) => Promise<unknown> }) => Promise<unknown>>> = {};
  const base: Record<string, unknown> = {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
    $extends: (ext: { name: string; model: Record<string, Record<string, unknown>> }) => {
      for (const [modelName, ops] of Object.entries(ext.model)) {
        extOps[modelName] = ops as never;
        // Prisma exposes models camelCase on the client — register that form too.
        const camel = modelName[0].toLowerCase() + modelName.slice(1);
        if (camel !== modelName) extOps[camel] = ops as never;
      }
      return client;
    },
  };
  const client = new Proxy(base, {
    get: (t, key: string) => {
      if (key in t) return t[key];
      const name = key;
      return new Proxy({} as Record<string, (...a: unknown[]) => Promise<unknown>>, {
        get: (_mt, opName: string) => async (args?: Record<string, unknown>) => {
          const handler = extOps[name]?.[opName];
          if (handler) {
            const a: Record<string, unknown> = args ? { ...args } : {};
            return handler({
              args: a,
              query: async (q) => { calls.push({ model: name, op: opName, args: q }); return {}; },
            });
          }
          calls.push({ model: name, op: opName, args: args ?? {} });
          return {};
        },
      });
    },
    has: () => true,
  });
  return { default: client };
});

import { TENANT_SCOPED_MODELS } from '@/lib/tenant-extension-core';
import tenantDb from '@/lib/tenant-db';

function lastCallFor(op: string) {
  for (let i = calls.length - 1; i >= 0; i--) if (calls[i].op === op) return calls[i];
  throw new Error(`no recorded call for ${op}`);
}

beforeEach(() => {
  calls.length = 0;
  mockState.userId = null;
  mockState.orgId = null;
  mockState.flag = null;
});

// ---------------------------------------------------------------------------
// 1. Model coverage vs schema — the compile-time drift guard (runtime twin).
// ---------------------------------------------------------------------------
describe('TENANT_SCOPED_MODELS coverage', () => {
  it('covers exactly the required-org-column models of the schema', () => {
    const scoped = new Set<string>(TENANT_SCOPED_MODELS);
    const expected = new Set<string>(SCHEMA_ORG_SCOPED_MODELS);
    expect([...scoped].sort()).toEqual([...expected].sort());
  });

  it('every scoped model is a real client member', () => {
    for (const m of TENANT_SCOPED_MODELS) {
      expect((tenantDb as unknown as Record<string, unknown>)[m], `${m} missing on tenantDb`).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// 2. count / aggregate / groupBy scoping
// ---------------------------------------------------------------------------
describe('count/aggregate/groupBy are org-scoped', () => {
  it('count injects organizationId into where (findMany parity)', async () => {
    mockState.userId = 'u1';
    mockState.orgId = 'org-A';
    await tenantDb.team.count({ where: { name: 'Ops' } });
    const c = lastCallFor('count');
    expect(c.model).toBe('team');
    expect(c.args.where).toEqual({ name: 'Ops', organizationId: 'org-A' });
  });

  it.each(['aggregate', 'groupBy'] as const)('%s injects organizationId', async (op) => {
    mockState.userId = 'u1';
    mockState.orgId = 'org-A';
    await (tenantDb.team[op] as (a?: Record<string, unknown>) => Promise<unknown>)({ where: {} } as never);
    const c = lastCallFor(op);
    expect(c.args.where).toEqual({ organizationId: 'org-A' });
  });

  it('count uses the orgId column for Member', async () => {
    mockState.userId = 'u1';
    mockState.orgId = 'org-A';
    await tenantDb.member.count();
    expect(lastCallFor('count').args.where).toEqual({ orgId: 'org-A' });
  });

  it('count/aggregate/groupBy fail closed with no context', async () => {
    await expect(tenantDb.team.count()).rejects.toThrow(/Tenant context missing/);
    await expect((tenantDb.team.aggregate as (a?: Record<string, unknown>) => Promise<unknown>)({ _sum: {} } as never)).rejects.toThrow(/Tenant context missing/);
    await expect((tenantDb.team.groupBy as (a?: Record<string, unknown>) => Promise<unknown>)({ by: [] } as never)).rejects.toThrow(/Tenant context missing/);
  });

  it('count passes through for platform-admin context (RLS authoritative)', async () => {
    mockState.userId = 'u1';
    mockState.orgId = 'org-B';
    mockState.flag = '1';
    await tenantDb.team.count({ where: {} });
    expect(lastCallFor('count').args.where).toEqual({}); // untouched — RLS decides
  });

  it('existing findMany scoping is unchanged', async () => {
    mockState.userId = 'u1';
    mockState.orgId = 'org-A';
    await tenantDb.team.findMany();
    expect(lastCallFor('findMany').args.where).toEqual({ organizationId: 'org-A' });
  });
});
