# Proposal: Migrate Prisma 6 → 7

**Status: Proposed** (tracked security follow-up — see `SECURITY.md` §10 accepted-risk table)

## Intent

Clear the sole remaining **high**-severity dependency finding that cannot be remediated within the current major line. The chain is:

```
prisma@6.19.3 → @prisma/config → deepmerge-ts <8.0.0 (GHSA-ggr8-5vv4-36mx, high)
```

`deepmerge-ts`'s stack-exhaustion fix landed only in `@prisma/config` ≥ 7.10.1 — i.e. the **Prisma 7** line. Prisma 7 is a breaking major (generator/output changes, ESM client, schema/CLI changes) and was deliberately excluded from the phased npm-audit security sweep, to be done as its own tracked effort so it is never interleaved with the Next 16 foundation upgrade. Lifting Prisma to 7.x removes the `deepmerge-ts` finding and the accepted-risk row can be deleted from `SECURITY.md` §10.

**Out of scope here:** the Next.js 15.5 → 16.4 foundation upgrade (its own spike + phase; it carries the `postcss` advisory cluster). Do NOT bundle Prisma 7 and Next 16 together.

## References & Foundational Rules

- **Tenant isolation is non-negotiable.** Every org-scoped model keeps its `organizationId` column and `@@index`; the two-layer strategy (Prisma extension + PostgreSQL RLS) must survive the major bump byte-for-byte at the behavioral level. See `prisma/schema.prisma` header and `SECURITY.md` §1.
- **Version pinning:** Node.js 22 LTS, Next.js 15, React 19 (existing). Prisma 7 must declare a compatible Node engine — verify against CI's Node 22 images before merge.
- **Secrets management:** no real secrets; `DATABASE_URL` via env only.
- **Test-driven completeness:** the migration is "done" only when `npm run type-check && npm run lint && npm run build && npm run test:integration && npm run test:isolation` all pass on Prisma 7.

## Non-Regression Requirements

MUST NOT break any of:
- RLS enforcement (18 org-relevant tables; ownership spec + `policy-catalog.golden` hash check must stay green).
- `lib/tenant-db.ts` extension injection across the 11 tenant-scoped models.
- `lib/rls-transaction.ts` single-connection GUC pinning.
- Auth flows (BetterAuth Prisma adapter) — password reset, OIDC, ban enforcement.

## Migration Surface (verified against current tree)

| Area | Current state | Migration action |
|------|---------------|------------------|
| Generator | `prisma-client-js`, **no** `output` set (`prisma/schema.prisma`) | Prisma 7 moves the generated client to an ESM output path; add explicit `output` and update every import to match (see below) |
| Client format | CJS `@prisma/client` default export | Prisma 7 generates an ESM client — imports may become `import { PrismaClient, Prisma } from '<output-path>'`; verify `lib/db.ts` single instance still holds |
| `prisma/seed.ts` | CJS-style seed using `@prisma/client` | Update imports + ensure the package.json `prisma.seed` command runs under the new client format (tsx-compatible) |
| Tenant RLS schema scripts | 9 RLS migrations under `prisma/migrations/*_rls*` + `0000_enable_rls`; raw-SQL, applied via `prisma migrate` | Re-run/verify migration history and forward-diff on Prisma 7 (generator change can alter the diff engine); confirm no destructive rewrite of existing history |
| `@prisma/client` import sites | **48 source files** across `lib/`, `services/`, `app/api/`, `tests/`, `prisma/` (counted 2026-10-31) | Update to the generated-output import path; single choke point is `lib/db.ts`, so prefer re-exporting from there where possible |

## Files To Create Or Modify

| Type | File Path | Purpose |
|------|-----------|---------|
| Modified | `prisma/schema.prisma` | Set generator `output`; schema-level changes required by Prisma 7 (validate with `prisma validate`) |
| Modified | `lib/db.ts` | New ESM client import / output path — single-instance global stays intact |
| Modified | `prisma/seed.ts` | Import + runtime format for the new client |
| Modified | up to ~48 import sites (see surface table) | Repoint `@prisma/client` → generated output path |
| Modified | `package.json` | Bump `prisma` (+ regenerate); confirm Node engine; no lockfile churn beyond Prisma's tree |
| Modified | `SECURITY.md` §10 | **Delete** the `deepmerge-ts` accepted-risk row once the audit is clean on Prisma 7 |

## Testing Plan

1. `npx prisma generate` → `npm run type-check` (catches ESM/import drift first).
2. `npm run lint && npm run build` — confirms the generated client loads in the Next.js runtime context (edge vs node module-duplication pitfall applies here).
3. `npm run test` + `npm run test:integration` — auth reset flows, tenant routing, RBAC.
4. **`npm run test:isolation`** — the full e2e suite incl. `tests/isolation/database/policy-catalog.golden` hash check; RLS must be bit-identical or explainable in the PR description.
5. Re-run `npm audit --audit-level=high` → expect **zero** deepmerge-ts / `@prisma/config` / prisma entries.

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| ESM client breaks Next.js server runtime (module duplication) | Critical | Gate on `npm run build` + a smoke of one RLS-scoped route; keep `lib/db.ts` the sole instance |
| Migration history diff changes on Prisma 7 | High | Run `prisma migrate dev` in a scratch env first; compare generated migration SQL; no destructive rewrites committed |
| Seed script format change breaks CI | Medium | Keep seed on tsx; verify locally before merge |
| RLS golden-file hash drift | Critical | If genuine, investigate (not auto-fix); the hash check exists to catch exactly this — a silent re-baseline would mask an isolation regression |

## Acceptance Criteria

- [ ] `npm audit --audit-level=high` reports **no** deepmerge-ts / `@prisma/config` / prisma findings.
- [ ] `npx prisma validate && npx prisma generate` clean on Prisma 7.
- [ ] `npm run type-check && npm run lint && npm run build` green.
- [ ] `npm run test:integration` green — auth reset + OIDC + ban flows intact.
- [ ] `npm run test:isolation` green — RLS ownership spec + `policy-catalog.golden` hash unchanged (or a change is explicitly justified in the PR).
- [ ] `SECURITY.md` §10 accepted-risk deepmerge-ts row removed, document date bumped.
