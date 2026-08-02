# Property NI Multi-Tenant Portal

A full-stack property management portal for Northern Ireland, built with Next.js 15, BetterAuth, Prisma, and PostgreSQL.

Property NI provides a secure, multi-tenant platform for managing property portfolios across multiple organizations. Each tenant operates in complete isolation — their properties, members, roles, and permissions are scoped and never visible to other organizations.

**Key features:**
- **Multi-tenant architecture** with defense-in-depth isolation (Prisma extension + PostgreSQL Row Level Security)
- **Super Admin dashboard** for managing organizations, roles, permissions, and cross-tenant audit logs
- **Granular RBAC** with organization-scoped roles, member-role assignments, and a catalog of ~50 atomic permissions
- **Secure authentication** via BetterAuth with Google OIDC and email/password, tight session expiry (1-hour absolute max), and auto-logout on inactivity
- **Hybrid caching** (L1 in-memory + L2 Redis) for permission resolution and search, with automatic cache warming
- **Real-time notifications** via Server-Sent Events (SSE) with browser-aware polling that sleeps when tabs are backgrounded
- **Strict Content Security Policy** with nonce-based script execution in Report-Only mode
- **Comprehensive audit logging** tracking all tenant and platform actions
- **PII encryption** using AES-256-GCM for sensitive data at rest
- **Full test coverage** with unit, integration, and isolation tests verifying tenant data separation

## Super Admin Dashboard

The application includes a Super Admin dashboard for managing tenant organizations, roles, permissions, and audit logs.

### API Endpoints

| Route | Description | Access |
|-------|-------------|--------|
| `/api/health` | Health check endpoint for load balancers and monitoring services | Public (no auth required) |

### Admin Routes

| Route | Description | Access |
|-------|-------------|--------|
| `/admin/organizations` | List all organizations with search, filter, pagination | Super Admin only |
| `/admin/organizations/create` | Create a new organization | Super Admin only |
| `/admin/organizations/[id]` | Organization detail (Overview, Members, Roles, Audit tabs) | Super Admin only |
| `/admin/permissions` | Global permission catalog CRUD | Super Admin only |
| `/admin/audit-logs` | Audit log viewer with filters | Super Admin only |

### Platform Permissions

The following platform-level permissions are available (Super Admin only):

| Permission Key | Description |
|---------------|-------------|
| `platform:manage_organizations` | Manage tenant organizations |
| `platform:manage_roles` | Manage global roles |
| `platform:manage_permissions` | Manage global permission catalog |
| `platform:view_audit_logs` | View audit logs across all organizations |

### Organization Lifecycle States

Organizations follow a strict state machine: `PENDING` → `ACTIVE` ↔ `SUSPENDED` → `ARCHIVED` (terminal).

### Tenant Isolation & Super Admin Access

- Regular tenant users are scoped to their organization via Prisma Extension + PostgreSQL RLS.
- Super Admins (Platform Organization members) use `lib/global-db.ts` — an explicitly unscoped Prisma client — to query across all organizations.
- All `/admin/*` routes are wrapped with `<RequireSuperAdmin>` and guarded by `requireSuperAdmin()` API middleware.

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
# one-liner (creates both nipp_dev and nipp_prod)
bash scripts/setup-db.sh

Then update `DATABASE_URL` in `.env` to match your database connection string

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
| `INACTIVITY_TIMEOUT_MINS` | Auto-logout timeout in minutes | Positive integer (default: `15`) — see [Auto-Logout on Inactivity](#auto-logout-on-inactivity) |
| `ADMIN_EMAIL` | Admin user email for seeding | e.g. `admin@example.com` (Required for `npm run db:seed`) |
| `ADMIN_PASSWORD` | Admin user password for seeding | Strong password (Required for `npm run db:seed`) |

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
#   - Default admin user (requires ADMIN_EMAIL and ADMIN_PASSWORD env vars)
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

### 7. Auto-Logout on Inactivity

The application automatically logs out users after a configurable period of inactivity to protect unattended devices.

**How it works:**
1. A client-side timer tracks user activity (`mousemove`, `click`, `keydown`, `scroll`, `touchstart`).
2. After the configured timeout (default: 15 minutes), a **warning toast** appears in the top-right corner with 30 seconds remaining.
3. If no activity occurs within those 30 seconds, the user is logged out — the session is invalidated server-side (deleted from the database) and cookies are cleared.
4. A hard redirect to `/login` follows immediately, bypassing the Next.js client-side router.

**Configuration:**
| Variable | Default | Description |
|---|---|---|
| `INACTIVITY_TIMEOUT_MINS` | `15` | Minutes of inactivity before auto-logout. Must be a positive integer (digits only). |

**Server-side session backstop:**
- `session.expiresIn`: **1 hour** — absolute maximum session lifetime.
- `session.updateAge`: **15 minutes** — sessions are renewed on any server request when remaining time drops below this threshold.
- Active users making at least one request per 45 minutes never hit the absolute expiry.
- If client-side detection is bypassed (JS disabled, browser crash), the server rejects stale sessions after 1 hour.

**Behavior:**
- Applies uniformly to all authenticated users (Super Admins and tenant users).
- Each browser tab tracks inactivity independently.
- The timer resets on any tracked activity, including during the warning period (any interaction dismisses the toast and restarts the countdown).
- The inactivity timer only runs when a user has an active session — it does not fire on the `/login` page or other unauthenticated routes.

**Files:**
- `hooks/useInactivityTimeout.ts` — Client-side hook with ref-stabilized event listeners.
- `components/providers/InactivityTimeoutConfig.tsx` — React Context provider bridging server env config to the client.
- `app/providers.tsx` — Unconditional `<Toaster />` and hook invocation.

### 8. (Optional) Isolation Testing

The project includes isolation tests to verify tenant data separation and super admin access controls. These require a dedicated test database (`nipp_test`) and Docker infrastructure.

```bash
# Full pipeline: setup → tests → teardown
npm run test:isolation

# Granular control:
docker compose -f docker-compose.test.yml up -d          # Start PostgreSQL + pgbouncer
npm run test:isolation:setup                              # Create DB + seed with OrgA/OrgB
npm test -- tests/isolation/application/                  # Vitest app-layer tests
npx playwright test                                       # Playwright E2E tests
npm run test:isolation:teardown                           # Drop test database
docker compose -f docker-compose.test.yml down            # Stop infra
```

For detailed setup, test data model, and troubleshooting, see [ISOLATION_TEST_STRATEGY.md](./ISOLATION_TEST_STRATEGY.md).

---

## Auto-Logout on Inactivity (Architecture)

The auto-logout feature uses a **defense-in-depth** approach combining client-side detection with server-side session expiry.

### Client-Side Detection (`hooks/useInactivityTimeout.ts`)
- Listens for `mousemove`, `click`, `keydown`, `scroll`, and `touchstart` events on `window`.
- Uses `useRef` to stabilize function identities, preventing event listener thrashing on every React render.
- At `timeout - 30s`: displays a warning toast via [sonner](https://github.com/emilkowalski/sonner).
- At `timeout`: calls `signOutUser()` (server-side session deletion) then `window.location.href = '/login'` (hard redirect).
- Any tracked activity during the warning period dismisses the toast and resets the timer.
- Only runs when a user has an active session — returns early on unauthenticated pages.

### Server-Side Backstop (`lib/auth.ts`)
- `session.expiresIn = 3600s` (1 hour absolute maximum).
- `session.updateAge = 900s` (15 minutes — sessions renew on any request when remaining time drops below this).
- `signOutUser()` deletes the session from the database, not just local cookies.

### Data Flow
```
User loads page → layout.tsx reads env.INACTIVITY_TIMEOUT_MINS (number)
  → InactivityTimeoutProvider passes value via React Context
    → useInactivityTimeout() attaches event listeners, starts timer
      → Activity detected → timer resets (toast dismissed)
      → No activity for T-30s → warning toast appears
        → Still no activity for 30s → signOutUser() + hard redirect to /login
          → Middleware allows /login for unauthenticated users
```

### Testing
- **Unit tests:** `tests/unit/useInactivityTimeout.test.tsx` (8 tests) — timer behavior, toast timing, cleanup.
- **Env schema tests:** `tests/unit/env-inactivity-timeout.test.ts` (15 tests) — validation, defaults, type transformation.

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
| `npm run test:integration` | `vitest run tests/integration tests/isolation` | Run integration + isolation app-layer tests |
| `npm run test:all` | `vitest run` | Run all unit and integration tests |
| **Isolation Tests** | | |
| `npm run test:isolation` | — | Full pipeline (setup → app-layer tests → E2E tests → teardown) |
| `npm run test:isolation:setup` | — | Create nipp_test DB, generate Prisma client, push schema, seed |
| `npm run test:isolation:teardown` | — | Drop nipp_test DB and clean up |
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

## Content Security Policy (CSP)

The application enforces a strict Content Security Policy via Edge Runtime middleware (`middleware.ts`) to mitigate Cross-Site Scripting (XSS) and data injection attacks. CSP is deployed in **Report-Only** mode initially, allowing us to monitor violations without blocking legitimate functionality.

### How It Works
1. **Nonce Generation:** On every request, a cryptographically secure random nonce is generated using `@/lib/csp-nonce`.
2. **Header Propagation:** The nonce is passed to the client via a custom `x-csp-nonce` header, allowing React components and scripts to dynamically inject the nonce into `<script>` tags.
3. **Directive Enforcement:** The middleware constructs a strict CSP string applied to the `Content-Security-Policy-Report-Only` header.

### Policy Directives
| Directive | Value | Rationale |
|-----------|-------|-----------|
| `default-src` | `'self'` | Blocks all resources not explicitly allowed. |
| `script-src` | `'self' 'nonce-${nonce}'` (+ `'unsafe-eval'` in dev) | Strict nonce-based execution. `unsafe-eval` is only allowed in development for Next.js Fast Refresh (HMR). |
| `style-src` | `'self' 'unsafe-inline'` | Next.js internal runtime injects inline styles. Browsers ignore `'unsafe-inline'` if a nonce is present in the same directive, so we omit the nonce here. |
| `img-src` | `'self' data: blob:` | Allows standard images, inline base64 data URIs, and blob URLs. |
| `font-src` | `'self' data:` | Allows standard fonts and base64-encoded font files. |
| `connect-src` | `'self'` | Restricts AJAX/Fetch/WebSocket connections to the same origin. |
| `frame-ancestors` | `'none'` | Prevents clickjacking by disallowing the app from being embedded in iframes. |
| `base-uri` / `form-action` | `'self'` | Prevents base tag hijacking and restricts form submissions to the same origin. |

### Development vs Production
- **Development:** `script-src` includes `'unsafe-eval'` to support Next.js Hot Module Replacement (Fast Refresh). All other directives remain strict.
- **Production:** `script-src` strictly uses the nonce only. No `'unsafe-inline'` or `'unsafe-eval'` is permitted for scripts, ensuring maximum XSS protection.

### Component Integration
React components consume the nonce via the `x-csp-nonce` header:
```tsx
import { headers } from 'next/headers';

export default function MyComponent() {
  const nonce = headers().get('x-csp-nonce') ?? '';
  return (
    <script nonce={nonce} dangerouslySetInnerHTML={{ __html: '/* inline script */' }} />
  );
}
```

### Safe Rollout Strategy
CSP is currently set via `Content-Security-Policy-Report-Only`. This logs violations to the browser console without blocking resources. Once validated, it can be switched to `Content-Security-Policy` for strict enforcement.

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

## ⚡ Real-Time Engine (SSE + React Query)
Unlike traditional apps that poll the server every few seconds, Property NI uses a **Hybrid Real-Time Engine**:
- **Zero-Latency Notifications:** Using Server-Sent Events (SSE), notifications are "pushed" from the server and injected directly into your local cache. This means new alerts appear in your UI instantly without a page refresh.
- **Resource-Aware Polling:** Our system is "browser-aware"—it polls for updates when you are active and automatically goes to sleep when your tab is in the background, saving device battery and server CPU.




## Health Check Endpoint

The application includes a `/api/health` endpoint for use by load balancers, container orchestrators (Docker/Kubernetes), and uptime monitoring services.

### Usage
```bash
curl http://localhost:3000/api/health
```

### Response Format
```json
{
  "status": "healthy",
  "timestamp": "2026-07-14T12:00:00.000Z",
  "version": "0.1.0",
  "uptime": 3600,
  "checks": {
    "database": { "status": "healthy", "latency_ms": 12 },
    "cache": { "status": "healthy", "latency_ms": 3 }
  }
}
```

### Status Codes
- **200 OK**: Application is healthy (all checks pass)
- **200 OK with degraded status**: Non-critical check failed (e.g., Redis unavailable but database is up)
- **503 Service Unavailable**: Critical check failed (e.g., database unreachable)

### Configuration
- The endpoint is excluded from session validation in `middleware.ts` (added to `PUBLIC_PATTERNS`)
- Database check uses `SELECT 1` with timeout handling
- Cache (Redis) check is non-critical and gracefully degrades if Redis is not configured
- No sensitive information is exposed in the response (security best practice)

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

## Cache Performance Profiling

The project includes a comprehensive cache profiling script to measure the real-world performance impact of L1 (in-memory) and L2 (Redis) caching.

### Running the Profiler

```bash
# Requires DATABASE_URL in .env (Redis is optional)
npx tsx scripts/cache-benchmark.ts
```

### What It Measures

The script benchmarks **8 scenarios** using real data from your database:

| Scenario | Path Tested | Expected (Local) |
|----------|-------------|------------------|
| **A** | Direct DB Query (Baseline) | 15–40ms |
| **B** | Redis L2 Cache (Warm Hit) | 1–5ms |
| **C** | L1 In-Memory Hit | 0.01–0.1ms |
| **D** | L1 Miss → L2 Hit | 5–8ms |
| **E** | Search Endpoint (Cache Miss) | 10–30ms |
| **F** | Search Endpoint (L1 Hit) | 0.01–0.1ms |
| **G** | Permission Resolution (via cacheGet) | Varies |
| **H** | Full Hybrid Flow (L1 Miss → L2 Hit) | Varies |

### Interpreting Results

- **If Scenario A (DB) > 20ms**: L1+L2 caching will reduce average latency by **50–70%**
- **If L1 Hit Rate < 50%**: Consider increasing `L1_CACHE_MAX_ENTRIES` or adjusting TTLs
- **If Scenario B (Redis) > 10ms**: Fix Redis connection/network before adding L1 complexity
- **If Scenario A < 5ms**: Database is already fast; L1 may be over-engineering

### How It Works

The script uses **real database data** (not random UUIDs) and tests against the actual cache implementation:
- `lib/cache/lru.ts` — L1 in-memory cache singleton
- `lib/redis.ts` — Redis client wrapper (L2)
- `lib/cache/hybrid.ts` — L1+L2 orchestration layer
- `lib/cache/health.ts` — Hit/miss tracking and metrics

It runs a warmup phase (10 iterations) before each benchmark to stabilize measurements, then executes the configured number of iterations (default: 100). Results include average latency, total time, and throughput in ops/sec.

### When to Run It

- **Before enabling L1**: Establish a baseline (Scenario A only) to quantify expected improvement
- **After cache warming is active**: Compare L1 hit rates against the metrics dashboard at `/admin/cache-metrics`
- **After infrastructure changes**: Re-run to verify Redis latency hasn't degraded
- **Periodically**: Track cache performance trends over time

### Full Documentation

See [scripts/README.md](scripts/README.md) for detailed usage, configuration options, and troubleshooting.

## Deferred Items

See the [Deferred Items Registry](openspec/changes/project-initialization/proposal.md) for actively tracked future features.

## License

Proprietary — Property NI
