# Property NI Multi-Tenant Portal

A full-stack property management portal for Northern Ireland, built with Next.js 15, BetterAuth, Prisma, and PostgreSQL.

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | Node.js | 22 LTS (pinned) |
| Framework | Next.js | ^15.x (App Router) |
| UI Library | React | ^19.x |
| Authentication | BetterAuth | ^1.6.x |
| ORM | Prisma | ^6.x |
| Database | PostgreSQL | 16+ |
| Styling | Tailwind CSS | v4.x |
| Testing | Vitest | ^4.1.x |
| Validation | Zod | ^4.x |
| Logging | Pino | ^9.x |

## Prerequisites

- **Node.js 22 LTS** — Pinned via `.nvmrc` and `package.json` engines field
- **PostgreSQL 16+** — Installed locally (no Docker for development)

```bash
# Switch to Node.js 22
nvm use

# Verify versions
node -v  # Should be v22.x.x
npm -v   # Should be 10.x+
psql --version  # Should be 16+
```

## Getting Started

```bash
# Install dependencies
npm install

# Copy environment files and fill in values
cp .env.example .env
cp .env.local-prod.example .env.local-prod

# Push schema to database (no migrations in init phase)
npx prisma db push

# Start development server
npm run dev

# Start local production (HTTPS)
npm run dev:https
```

## Build Targets

| Target | Command | Description |
|--------|---------|-------------|
| Local Dev | `npm run dev` | HTTP, hot-reload, debug logging |
| Local Prod | `npm run dev:https` | HTTPS (experimental), production-like config |
| Cloud Build | `npm run build:cloud` | Placeholder — configure for your cloud platform |
| Cloud Deploy | `npm run deploy:cloud` | Placeholder — configure for your cloud platform |

## Tenant Isolation Strategy (Defense-in-Depth)

This application enforces strict tenant isolation at **two independent layers**. A failure in one layer does not result in data leakage because the other layer still enforces isolation.

### Layer 1: Application Layer (Prisma Extension)

The tenant-scoped Prisma client (`lib/tenant-db.ts`) automatically injects `organizationId` into the `where` clause of all queries on organization-scoped models.

**How it works:**
1. Next.js middleware (`middleware.ts`) extracts the user's active organization ID from the session
2. The org ID is stored in `AsyncLocalStorage` via `lib/tenant-context.ts`
3. The Prisma Extension (`lib/tenant-db.ts`) reads the org ID and injects it into every query

**Using the tenant-scoped client:**
```typescript
import tenantDb from '@/lib/tenant-db';

// All queries are automatically scoped to the current organization
const properties = await tenantDb.property.findMany({}); // WHERE organizationId = <currentOrg>
```

### Layer 2: Database Layer (PostgreSQL RLS)

PostgreSQL Row Level Security policies filter rows by organization as a safety net against application-layer failures.

**How to add RLS for a new table:**
1. Ensure the table has an `organizationId` column (text/varchar)
2. Create a migration with:
   ```sql
   ALTER TABLE "<table>" ENABLE ROW LEVEL SECURITY;
   CREATE POLICY tenant_isolation ON "<table>"
     USING ("organizationId"::text = current_setting('app.current_org_id', true));
   ```
3. See `prisma/migrations/0000_enable_rls/migration.sql` for the full template

### ESLint Rule: Prevent Direct Prisma Imports

The ESLint configuration blocks direct imports of the unscoped `prisma` client from `lib/db.ts` in business logic files. Always use `lib/tenant-db.ts` instead:

```typescript
// ❌ BAD — bypasses tenant isolation
import { prisma } from '@/lib/db';

// ✅ GOOD — respects tenant isolation
import tenantDb from '@/lib/tenant-db';
```

### ORM Evaluation: Why Prisma?

We evaluated three TypeScript ORMs with official BetterAuth adapters:

| ORM | RLS Integration | BetterAuth Adapter | Ecosystem | Decision |
|-----|----------------|--------------------|-----------|----------|
| **Prisma** (selected) | Awkward (requires raw SQL for session variables) | Official, mature | Largest community, best docs | **Selected** |
| Drizzle | Natural (SQL-like API) | Official, mature | Growing but smaller | Rejected |
| Kysely | Trivial (query builder) | Official | Smaller, more manual | Rejected |

**Rationale:** Prisma's superior docs and ecosystem reduce long-term maintenance burden. The RLS awkwardness is contained to ~100 lines in `lib/tenant-db.ts` (write once, never touch again).

## Secrets Management

### Files That Must NEVER Be Committed

| File | Contains |
|------|----------|
| `.env` | Real database credentials, API keys, secrets |
| `.env.local` | Next.js local overrides with real values |
| `.env.local-prod` | Production-like config with real secrets |
| `certs/` | TLS certificates and private keys |
| `*.pem`, `*.key` | Certificate and key files anywhere in the project |

### Setting Up Environment Variables

1. Copy `.env.example` to `.env` and fill in real values
2. Copy `.env.local-prod.example` to `.env.local-prod` for production-like development
3. Generate secrets:
   ```bash
   # BetterAuth secret (session encryption)
   openssl rand -base64 32

   # PII encryption key (AES-256, 32 bytes hex-encoded)
   openssl rand -hex 32

   # TLS certificates for local-prod HTTPS
   openssl req -x509 -newkey rsa:4096 -keyout certs/key.pem \
     -out certs/cert.pem -days 365 -nodes \
     -subj "/CN=localhost"
   ```

### Pre-Commit Secret Detection

A pre-commit hook (`scripts/check-secrets.sh`) scans staged files for patterns that look like secrets:
- Private key headers (`-----BEGIN PRIVATE KEY-----`)
- AWS access keys (`AKIA...`)
- Database URLs with embedded passwords
- Common secret variable names with values

If a potential secret is detected, the commit is blocked. Bypass (not recommended): `git commit --no-verify`.

## Node.js Version Requirements

The project is pinned to **Node.js 22 LTS** for the following reasons:

- Node 22 is LTS (supported until April 2027)
- Vitest 4.x requires `^20.0.0 || ^22.0.0 || >=24.0.0` (Node 23 is explicitly excluded)
- Node 23 is odd-numbered, non-LTS, and unsupported by many packages
- All project dependencies (Next.js 15+, Prisma 6.x, BetterAuth 1.6.x) are tested against Node 22

## Next.js / React Version Requirements

- **Next.js ^15.x** — Stable App Router, Route Handlers, middleware APIs
- **React ^19.x** — Required by Next.js 15

Major version upgrades (e.g., Next.js 16) require a separate OpenSpec proposal.

## Vitest Version Requirements

- **Vitest ^4.1.x** — Required by `@better-auth/test-utils`
- **Node.js 22 LTS** — Vitest 4.x requires `^20.0.0 || ^22.0.0 || >=24.0.0`

## Adding RLS Policies for New Tables

When creating a new organization-scoped table:

1. Add the model to `prisma/schema.prisma` with `organizationId` field
2. Create a new migration file in `prisma/migrations/`
3. Add RLS enablement and policy:
   ```sql
   ALTER TABLE "<table>" ENABLE ROW LEVEL SECURITY;
   CREATE POLICY tenant_isolation ON "<table>"
     USING ("organizationId"::text = current_setting('app.current_org_id', true));
   ```

## Deferred Items

See the [Deferred Items Registry](openspec/changes/project-initialization/proposal.md) for actively tracked future features.

## License

Proprietary — Property NI
