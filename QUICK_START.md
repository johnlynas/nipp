# Quick Start Guide — Property NI Portal

This guide provides the essential steps to get the Property NI Multi-Tenant Portal running locally. For detailed configuration and architecture information, see [README.md](./README.md).

## Prerequisites

Ensure you have the following installed:
- **Node.js 22 LTS** (pinned via `.nvmrc`)
- **PostgreSQL 16+**
- **Git**

## Setup Steps

### 1. Clone and Install Dependencies

```bash
git clone <your-repo-url> && cd nipp
nvm use                          # Switch to Node.js 22
npm install                      # Install dependencies
```

### 2. Set Up Database

Create the development database (`nipp_dev`):

```bash
bash scripts/setup-db.s

### 3. Configure Environment Variables

Copy the template and fill in your local values:

```bash
cp .env.example .env
```

**Required Variables:**
- `DATABASE_URL`: Your PostgreSQL connection string (e.g., `postgresql://postgres@localhost:5432/nipp_dev`)
- `BETTER_AUTH_SECRET`: Session encryption key (generate with `openssl rand -base64 32`)
- `ADMIN_EMAIL`: Email for the initial super admin account (e.g., `admin@example.com`)
- `ADMIN_PASSWORD`: Password for the initial super admin account (must be strong)
- `PGBOUNCER_PASSWORD` : You pgbouncer password

> **Note:** `ADMIN_EMAIL` and `ADMIN_PASSWORD` are required for seeding. The seed script will fail if these are not set.

### 4. Initialize Database & Seed

Generate the Prisma client and push schema to your database:

```bash
npx prisma generate
npx prisma db push
```

Seed the database with default data (Platform Organization, permissions, and admin user):

```bash
npm run db:seed
```

### 5. Start Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Next Steps

- **Login:** Use the `ADMIN_EMAIL` and `ADMIN_PASSWORD` you configured to log in.
- **Full Documentation:** Refer to [README.md](./README.md) for advanced configuration, testing, and deployment instructions.

## Test Environment Setup

The project supports isolation testing with a dedicated test database (`nipp_test`), separate from the development database.

### Prerequisites
- **Docker + Docker Compose** — For running PostgreSQL and pgbouncer containers
- **Playwright browsers** — `npx playwright install`

### 1. Configure Test Environment Variables

Copy the test environment template and fill in your local values:

```bash
cp .env.test.example .env.test
```

**Required Variables:**
- `TEST_ADMIN_EMAIL` / `TEST_ADMIN_PASSWORD` — Super admin credentials for testing
- `TEST_TENANT_A_EMAIL` / `TEST_TENANT_A_PASSWORD` — OrgA tenant user credentials
- `TEST_TENANT_B_EMAIL` / `TEST_TENANT_B_PASSWORD` — OrgB tenant user credentials
- `DB_USER` / `DB_PASS` — PostgreSQL connection credentials for setup scripts

> **Note:** `.env.test` is in `.gitignore`. Only `.env.test.example` (with placeholder values) is committed.

### 2. Start Test Infrastructure

```bash
docker compose -f docker-compose.test.yml up -d
```

This starts PostgreSQL and pgbouncer containers for the test environment.

### 3. Create and Seed Test Database

```bash
# Full setup (creates DB, runs Prisma generate/push/seed)
npm run test:isolation:setup
```

This creates the `nipp_test` database, generates the Prisma client, pushes the schema, and seeds it with:
- Platform Organization (Super Admin)
- OrgA — Acme Properties Ltd
- OrgB — Belfast Rentals
- Test users for each organization

### 4. Run Tests

```bash
# One-command full run (setup → tests → teardown)
npm run test:isolation

# Or granular control:
npm test -- tests/isolation/application/    # Vitest app-layer tests only
npx playwright test                          # Playwright E2E tests only
```

### 5. Clean Up

```bash
npm run test:isolation:teardown
docker compose -f docker-compose.test.yml down
```

For detailed strategy, patterns, and troubleshooting, see [ISOLATION_TEST_STRATEGY.md](./ISOLATION_TEST_STRATEGY.md).

## Pre-Commit & Pre-Push Checklist

Before committing and pushing changes to the `nipp` GitHub repository, **all four checks below must pass**. Do not push until every item is green.

### 1. Unit Tests
```bash
npm test
```
All unit tests must pass with zero failures.

### 2. Integration Tests
```bash
npm run test:integration
```
All integration and isolation tests must pass. Requires PostgreSQL and Redis running.

### 3. Linter
```bash
npx eslint . --max-warnings=0
```
Resolve all lint errors and warnings. Zero warnings are allowed.

### 4. Type Check
```bash
npx tsc --noEmit
```
Resolve all TypeScript errors. The project is configured with `strict: true`.

> **Rule:** Only after all four checks pass should you commit and push. Failing any check means your change is not ready for the shared branch.

## Troubleshooting: Next.js 15 Worker Thread Issue

During development, you may encounter repeated errors in the terminal:
```
[Error: Cannot find module '/Users/johnlynas/dev/nipp-0713/.next/server/vendor-chunks/lib/worker.js']
⨯ uncaughtException: [Error: the worker thread exited]
```

These are a known Next.js 15 issue with worker threads and module resolution during development, specifically related to the `lib/worker.js` chunk.

### 🔍 Root Cause
The error occurs when:
- The `.next` cache is stale after code changes (especially library imports)
- Worker threads are used by a dependency (likely `pino` or a similar logging/worker-based package)
- The module resolver can't find the rebuilt chunk

### ✅ Quick Fix — Clear Cache & Restart
Run these commands to clear the stale cache and restart:
```bash
# 1. Stop the dev server (Ctrl+C)

# 2. Clear Next.js cache
rm -rf .next

# 3. Restart dev server
npm run dev
```

### 🛡️ If the Issue Persists
If clearing `.next` doesn't fully resolve it, you can also try:
```bash
# Clear npm cache as well
npm cache clean --force

# Reinstall dependencies (if needed)
rm -rf node_modules package-lock.json
npm install

# Clear Next.js cache again
rm -rf .next

# Restart
npm run dev
```

### 📝 Why This Happens
- Next.js 15 uses a new bundler that creates `vendor-chunks` for shared modules
- When you modify files in `lib/`, the bundler may not immediately rebuild all dependent worker chunks
- The dev server's HMR (Hot Module Replacement) sometimes fails to invalidate these stale references
- **This is a development-only issue** — it does not affect production builds
