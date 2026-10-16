# Quick Start Guide — Property NI Portal

Everything you need to get the portal running locally and pass the pre-commit checks. For *how* the system works, see [`ARCHITECTURE.md`](./ARCHITECTURE.md) and [`SECURITY.md`](./SECURITY.md).

## Prerequisites

| What | Version | Notes |
|------|---------|-------|
| Node.js | 22 LTS (pinned in `.nvmrc`) | `nvm install 22 && nvm use` |
| PostgreSQL | 16+ | Postgres.app (macOS), Homebrew, or your distro's manager |
| Git | any recent | — |
| Docker *(only for isolation tests)* | any recent | Runs PostgreSQL + PgBouncer for the test environment |

Check with:

```bash
node -v             # v22.x.x
psql --version      # 16+
```

## Setup, step by step

### 1. Clone and install

```bash
git clone <your-repo-url> && cd nipp
nvm use                          # switch to Node.js 22
npm install                      # install dependencies
```

### 2. Create the databases

Creates `nipp_dev` and `nipp_prod`:

```bash
bash scripts/setup-db.sh
```

### 3. Configure environment variables

Copy the template, then fill in your local values:

```bash
cp .env.example .env
```

The required ones are listed in [Environment variables](#environment-variables) below. Quick way to generate the two secrets:

```bash
openssl rand -base64 32   # BETTER_AUTH_SECRET
openssl rand -hex 32      # PII_ENCRYPTION_KEY (64 hex characters)
```

> **Never commit `.env`.** Only the committed example templates (`.env.example`, `.env.local-prod.example`, `.env.test.example`) go in version control.

### 4. Initialize and seed the database

```bash
npx prisma generate   # required before any prisma command
npx prisma db push    # create all tables (dev only; use db:migrate for migration files)
npm run db:seed       # platform org + permission catalog + admin + dev tenants
```

The seed can be re-run safely — it updates existing records to match the script. The two seeding modes and every variable it reads are in [Seeding](#seeding). It prints a `PLATFORM_ORG_ID` value afterwards — add that to `.env`.

### 5. Start the dev server

```bash
npm run dev
```

Open <http://localhost:3000> in your browser.

### 6. Verify

```bash
npm test             # unit tests (no running services needed)
npm run type-check   # strict TypeScript
npm run lint         # ESLint — zero warnings expected
```

Log in with the `ADMIN_EMAIL` / `ADMIN_PASSWORD` you set — that's the super admin, and it lands you in the admin console. The seeded tenant users (see [Seeding](#seeding)) show the tenant dashboard.

## Environment variables

All variables are validated at startup (Zod schema in `lib/env.ts`). This is the operational reference; security-specific variables live in [`SECURITY.md` §9](./SECURITY.md#9-security-configuration-reference).

### Required to run

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string (PgBouncer-aware by default: port 6432 with pool options) |
| `BETTER_AUTH_SECRET` | Session encryption key (min 32 chars) — generate: `openssl rand -base64 32` |
| `PII_ENCRYPTION_KEY` | AES-256-GCM key for personal data at rest — generate: `openssl rand -hex 32` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Credentials seeded as the super admin (valid email; password over 8 chars) |

### Database & core (optional)

| Variable | Default | Purpose |
|----------|---------|---------|
| `PGBOUNCER_PASSWORD` | — | Pooler password when using PgBouncer |
| `REDIS_URL` | `redis://localhost:6379` | Redis for caching; the app runs without it |
| `L1_CACHE_MAX_ENTRIES`, `L1_CACHE_TTL_MS` | built-in | In-memory cache tuning |
| `LOG_LEVEL` | `debug` | `debug` \| `info` \| `warn` \| `error` |
| `FRONTEND_URL`, `NEXT_PUBLIC_API_URL` | `http://localhost:3000` | App URLs |
| `PLATFORM_ORG_ID` | auto-found | Platform organization ID; pin it after seeding |

### Email (needs SMTP credentials for notification email)

| Variable | Default | Purpose |
|----------|---------|---------|
| `SMTP_HOST`, `SMTP_PORT` | `localhost` / `587` | SMTP server |
| `SMTP_USER`, `SMTP_PASS` | — | SMTP login |
| `SMTP_FROM` | `noreply@nipp.gov.uk` | Sender address |

### Calendar live alerts (optional)

| Variable | Default | Purpose |
|----------|---------|---------|
| `CALENDAR_EVENT_SCAN_INTERVAL_MS` | `30000` | How often the "due to start" scan runs |
| `CALENDAR_LEAD_TIME_MINUTES` | `15` | Alert when an event starts within this window |
| `CALENDAR_MAX_EVENTS_PER_SCAN` | `20` | Per-scan burst cap |

### Job scheduler (optional)

| Variable | Default | Purpose |
|----------|---------|---------|
| `JOB_SCHEDULER_ENABLED` | `true` | Master on/off |
| `JOB_SCHEDULER_TIMEZONE` | `Europe/London` | Default timezone for schedules |
| `JOB_SCHEDULER_BREE_MODE` | `worker` | `worker` (isolated fork per run) or `inline` (main thread, fallback) |
| `JOB_SCHEDULER_MAX_CONCURRENT` | `5` | Cap on simultaneous job runs |
| `JOB_SCHEDULER_DEFAULT_TIMEOUT_MS` | `300000` | Per-job wall-clock cap (5 min) |

## Seeding

The seed script (`prisma/seed.ts`) creates organizations, the permission catalog (~50 permissions), users, and teams. It picks a mode based on one variable: **test mode activates when `TEST_ADMIN_EMAIL` is set**, otherwise dev mode runs.

### Dev profile (default)

Creates the **Platform Organization** ("Platform Ops" team), **"Dev Tenant Ltd"** ("Members" + "Operations" teams), the super admin with all platform permissions, and two dev tenant users in Operations.

| Variable | Default |
|----------|---------|
| `DEV_TENANT_A_EMAIL` / `_PASSWORD` | `dev-tenant-a@example.com` / `DevTenantA123!` |
| `DEV_TENANT_B_EMAIL` / `_PASSWORD` | `dev-tenant-b@example.com` / `DevTenantB123!` |

### Test profile (when `TEST_ADMIN_EMAIL` is set)

Creates the Platform Organization ("Members" team), **"Test Tenant Ltd"** ("Members" + "QA Operations" teams), the test super admin, and two test tenant users in QA Operations.

| Variable | Default |
|----------|---------|
| `TEST_ADMIN_EMAIL` / `_PASSWORD` | *(required, no default)* |
| `TEST_TENANT_A_EMAIL` / `_PASSWORD` | `test-tenant-a@example.com` / `TestTenantA123!` |
| `TEST_TENANT_B_EMAIL` / `_PASSWORD` | `test-tenant-b@example.com` / `TestTenantB123!` |

```bash
npm run db:seed          # dev profile
# test profile:
cp .env.test.example .env.test   # fill in credentials, then
TEST_ADMIN_EMAIL=platform-test@nipp.gov.uk npx tsx prisma/seed.ts
```

After seeding: add the printed `PLATFORM_ORG_ID` to `.env`, restart the dev server, and log in fresh.

## Setting up the test environment

Isolation tests run against a dedicated `nipp_test` database (separate from your dev data), with PostgreSQL + PgBouncer in Docker.

```bash
cp .env.test.example .env.test   # fill in the TEST_* credentials
docker compose -f docker-compose.test.yml up -d    # start test infrastructure
npm run test:isolation:setup     # create DB, push schema, seed it (test profile)
```

Then run the tests granularly if you like:

```bash
npm run test:isolation                    # one command: setup → app tests → Playwright E2E → teardown
npm test -- tests/isolation/application/  # app-layer tenant separation only
npx playwright test                       # browser E2E only (run `npx playwright install` first)
```

Clean up when done:

```bash
npm run test:isolation:teardown
docker compose -f docker-compose.test.yml down
```

> **Note:** `.env.test` is gitignored; only the example template is committed. For strategy, patterns, and troubleshooting see [`ISOLATION_TEST_STRATEGY.md`](./ISOLATION_TEST_STRATEGY.md).

## Pre-commit & pre-push checklist

All four checks must pass before you commit and push — do not push until every one is green:

```bash
npm test                            # 1. unit tests
npm run test:integration            # 2. integration + isolation app-layer (needs PostgreSQL + Redis)
npx eslint . --max-warnings=0       # 3. zero lint warnings
npx tsc --noEmit                    # 4. strict type check, no errors
```

Husky also runs a secret scan and formatting automatically on every commit. A failing check means your change is not ready for the shared branch.

## Troubleshooting

### Worker thread error during development

Repeated `Cannot find module .../vendor-chunks/lib/worker.js` + `uncaughtException: the worker thread exited` errors are a known Next.js 15 dev-mode issue with stale caches. They are development-only and do not affect production builds.

**Quick fix — clear cache & restart:**

```bash
# 1. stop the dev server (Ctrl+C)
rm -rf .next
npm run dev
```

**If it persists:**

```bash
npm cache clean --force
rm -rf node_modules package-lock.json
npm install
rm -rf .next
npm run dev
```

Why it happens: Next.js 15's bundler builds shared `vendor-chunks`; after `lib/` changes, Hot Module Replacement sometimes fails to invalidate stale worker references. Clearing `.next` forces a clean rebuild.
