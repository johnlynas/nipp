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

| Requirement | Version | How to Install |
|---|---|---|
| **Node.js** | 22 LTS (pinned) | [nvm](https://github.com/nvm-sh/nvm) — `nvm install 22 && nvm use` |
| **PostgreSQL** | 16+ | [postgresapp.com](https://postgresapp.com) (macOS), `brew install postgresql`, or your distro's package manager |
| **Redis** *(optional)* | 7+ | `brew install redis` (macOS) — used for permission caching; app degrades gracefully without it |
| **Git** | Latest | [git-scm.com](https://git-scm.com) |

```bash
# Verify prerequisites
node -v   # v22.x.x
npm -v    # 10.x+
psql --version  # 16+
redis-cli --version  # optional — 7+
```

## Getting Started (Step by Step)

### 1. Clone and install dependencies

```bash
git clone <repo-url> && cd nipp
nvm use                          # switch to Node.js 22 (from .nvmrc)
npm install                      # install all dependencies
```

### 2. Set up PostgreSQL

Create the development and production databases:

```bash
# Option A — one-liner (creates both nipp_dev and nipp_prod)
bash scripts/setup-db.sh

# Option B — run the SQL file directly
psql -U postgres -f scripts/setup-db.sql
```

Then update `DATABASE_URL` in `.env` to match your connection string (see step 3).

### 3. Configure environment variables

```bash
# Copy the template and fill in real values
cp .env.example .env
```

Edit `.env` and set:

| Variable | What it is | How to generate / what to put |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | e.g. `postgresql://postgres@localhost:5432/nipp_dev` |
| `BETTER_AUTH_SECRET` | Session encryption key | `openssl rand -base64 32` |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | From [Google Cloud Console](https://console.cloud.google.com) (optional — skip if not using Google login) |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | From [Google Cloud Console](https://console.cloud.google.com) (optional — skip if not using Google login) |
| `PII_ENCRYPTION_KEY` | AES-256-GCM key for PII encryption | `openssl rand -hex 32` (64 hex chars) |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` (optional — app works without it) |
| `LOG_LEVEL` | Logging verbosity | `debug`, `info`, `warn`, or `error` (default: `debug`) |
| `FRONTEND_URL` / `NEXT_PUBLIC_API_URL` | App URLs | `http://localhost:3000` (default) |

> **Never commit `.env`** — it is in `.gitignore`. Only `.env.example` (with placeholder values) is committed.

### 4. Initialize the database

```bash
# Generate the Prisma client (required before any prisma command)
npx prisma generate

# Push the schema to your database (creates all tables)
npx prisma db push

# Seed the database with:
#   - Platform Organization (for Super Admins)
#   - Master permission catalog (~50 resource:action permissions)
#   - Default admin user (admin@nipp.gov.uk / Admin@1234)
npm run db:seed
```

After seeding, check your `.env` file — the `PLATFORM_ORGANIZATION_ID` will be written automatically.

### 5. Start the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### 6. (Optional) Run tests

```bash
npm test                 # Fast unit tests (no running system needed)
npm run test:watch       # watch mode — re-runs on file changes
npm run test:integration # Integration tests (needs PostgreSQL + Redis running)
npm run test:all         # Run all unit and integration
npm run test:coverage    # Run unit tests with code coverage report
```

---

## Available Scripts

| Script | Command | Description |
|--------|---------|-------------|
| **Development** | | |
| `npm run dev` | `next dev` | Start dev server (HTTP, hot-reload) |
| `npm run dev:https` | `next dev --experimental-https` | Start dev server with local HTTPS |
| **Database** | | |
| `npm run db:push` | `prisma db push` | Push schema changes to the database (no migration files) |
| `npm run db:migrate` | `prisma migrate dev` | Create and apply a migration file |
| `npm run db:seed` | `tsx prisma/seed.ts` | Run the seed script (create admin user, permissions catalog) |
| `npm run db:studio` | `prisma studio` | Open the Prisma Studio GUI |
| `npm run db:reset` | `prisma migrate reset --skip-seed` | Reset the database (drops all data) |
| **Setup** | | |
| `bash scripts/setup-db.sh` | — | Create databases and guide through remaining setup steps |
| **Build & Deploy** | | |
| `npm run build` | `next build` | Production build |
| `npm start` | `next start` | Start production server |
| `npm run lint` | `next lint` | Run ESLint |
| `npm run type-check` | `tsc --noEmit` | TypeScript type checking (no output) |
| **Testing** | | |
| `npm test` | `vitest run` | Run all unit tests |
| `npm run test:watch` | `vitest` | Watch mode |
| `npm run test:coverage` | `vitest run --coverage` | Run tests with coverage report |
| **Cloud** *(placeholders)* | | |
| `npm run build:cloud` | — | Placeholder for cloud build pipeline |
| `npm run deploy:cloud` | — | Placeholder for cloud deployment |

---

## Troubleshooting

| Problem | Solution |
|---|---|
| `@prisma/client did not initialize` | Run `npx prisma generate` |
| `DATABASE_URL not found` | Ensure `.env` exists and contains a valid `DATABASE_URL` |
| `Invalid admin roles: super_admin` | The BetterAuth admin plugin requires all `adminRoles` to be defined in its `roles` config. This is handled automatically — if you see this, check that `lib/auth.ts` has the correct admin config |
| Redis connection errors | Redis is optional. The app degrades gracefully — permissions are fetched from the database directly if Redis is unavailable |
| Port 3000 already in use | Kill the process: `lsof -ti:3000 \| xargs kill` or start on a different port with `PORT=3001 npm run dev` |
| TypeScript errors after adding models | Run `npx prisma generate` to regenerate the Prisma client types |

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
