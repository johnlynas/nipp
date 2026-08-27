# Property NI Multi-Tenant Portal (nipp)

Property NI is a full-stack property management portal built for the Northern
Ireland public sector. It is a multi-tenant platform: a single deployment hosts
many organizations (tenants), and every tenant operates in complete isolation —
their properties, members, roles, permissions, calendars, and audit trails are
scoped to them and never visible to anyone else.

The application is built with Next.js 15 (App Router), React 19, BetterAuth,
Prisma 6, and PostgreSQL 16, with optional Redis for caching.

## Who uses it

There are two kinds of users:

- **Super Admins** — members of the internal "Platform Organization". They
  manage tenant organizations, global roles and permissions, user accounts,
  cache metrics, audit logs, and system health from a dedicated admin console.
- **Tenant Users** — staff of a tenant organization. They work inside their
  own organization's dashboard: an interactive calendar, teams, roles,
  resources, and notifications.

Self-service registration is not available (`/register` redirects to
`/login`); accounts are created by Super Admins or via the seed scripts.

## Contents

- [Who uses it](#who-uses-it)
- [At a glance](#at-a-glance)
- [Project layout](#project-layout)
- [Functional Areas](#functional-areas)
  - [Authentication & Sessions](#1-authentication-sessions)
    - [Auto-logout on inactivity](#auto-logout-on-inactivity)
  - [Multi-Tenant Isolation](#2-multi-tenant-isolation)
  - [Super Admin Console](#3-super-admin-console)
  - [Integrated Tenant Dashboard](#4-integrated-tenant-dashboard)
    - [Resources & feature-level access control](#resources-feature-level-access-control)
  - [Roles, Permissions & Teams (RBAC)](#5-roles-permissions-teams-rbac)
  - [Interactive Calendar](#6-interactive-calendar)
  - [Calendar Notifications](#7-calendar-notifications)
  - [Real-Time Notifications](#8-real-time-notifications)
  - [Caching](#9-caching)
  - [Data Protection & Security Hardening](#10-data-protection-security-hardening)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Setup (step by step)](#setup-step-by-step)
    - [1. Clone and install](#1-clone-and-install)
    - [2. Create the databases](#2-create-the-databases)
    - [3. Configure environment variables](#3-configure-environment-variables)
    - [4. Initialize and seed the database](#4-initialize-and-seed-the-database)
    - [5. Run it](#5-run-it)
    - [6. Verify](#6-verify)
- [Day-to-Day Development](#day-to-day-development)
  - [Scripts](#scripts)
  - [Quality gates (pre-commit & pre-push)](#quality-gates-pre-commit-pre-push)
  - [Testing the tenant isolation suite](#testing-the-tenant-isolation-suite)
  - [Troubleshooting](#troubleshooting)
- [Appendices](#appendices)
  - [Environment Variables](#appendix-a-environment-variables)
  - [Database Seeding Guide](#appendix-b-database-seeding-guide)
  - [Health Endpoint](#appendix-c-health-endpoint)
  - [Data Model](#appendix-d-data-model)
  - [Technology Stack & Version Pins](#appendix-e-technology-stack-version-pins)
  - [Project Documentation Map](#appendix-f-project-documentation-map)

## At a glance

| Area | What it does |
|------|--------------|
| **Multi-tenant isolation** | Two independent layers: Prisma query interception + PostgreSQL Row Level Security |
| **Authentication** | BetterAuth with email/password and Google OIDC, 1-hour session cap, inactivity auto-logout |
| **RBAC** | Organization-scoped roles, a catalog of ~50 atomic permissions, feature-level access via Resources |
| **Teams** | Sub-organizational groupings with role inheritance |
| **Super Admin console** | Manage organizations, users, roles, permissions, audit logs, cache metrics, system health/logs |
| **Tenant dashboard** | Integrated dashboard for users, organizations, roles, permissions, resources, teams, and the calendar |
| **Interactive Calendar** | Month/week/day/year views, drag-and-drop rescheduling, RFC 5545 (rrule) recurrence, event modals, quick-add |
| **Calendar Notifications** | Rate-limited email alerts for today's events, delivery logged to `NotificationLog` |
| **Hybrid caching** | L1 in-memory + L2 Redis cache with stampede protection, warming, and live metrics |
| **Real-time notifications** | Server-Sent Events bridge (dev) with browser-aware polling that sleeps when tabs are backgrounded |
| **Security hardening** | CSP in Report-Only mode, AES-256-GCM PII encryption at rest, optional payload encryption in transit, pre-commit secret scanning |

## Project layout

```
app/                  Next.js App Router: pages and API route handlers
  admin/              Super Admin console (pages + /api/admin/* handlers)
  dashboard/          Integrated role-based dashboards (+ /api/dashboard/admin/*)
  organizations/      Organization-scoped tenant pages
  api/                Other route handlers (auth, calendar, teams, health, …)
components/           React UI (admin, calendar, dashboard, auth, providers)
features/             Client-side feature modules (notifications, org, permissions, user)
hooks/                Shared client hooks (useInactivityTimeout, usePermission)
lib/                  Core infrastructure: auth, tenant-db, cache, crypto, notifications
services/             Server-side domain services (calendar, teams, roles, resources, …)
prisma/               Schema, migrations, RLS scripts, and seed
tests/                unit/, integration/, isolation/ (app-layer + Playwright E2E)
scripts/              DB setup, test env setup/teardown, cache benchmark, secret check
openspec/             OpenSpec change proposals (the project's design process)
documents/            Business research, feature planning, operations runbooks
```

---

# Functional Areas

## 1. Authentication & Sessions

Authentication is handled by [BetterAuth](https://www.better-auth.com/)
(configured in `lib/auth.ts`):

- **Providers:** email/password and Google OIDC (optional — configure via
  `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`).
- **Sessions:** secure, HTTP-only cookies; `expiresIn` of **1 hour** is the
  absolute maximum lifetime, with renewal on any server request once remaining
  time drops below 15 minutes (`updateAge`). Active users who make at least one
  request per 45 minutes never hit the hard expiry.
- **Middleware:** `middleware.ts` performs a fast, Edge-runtime-safe session
  cookie check so unauthenticated visitors are redirected to `/login` before
  any page renders; public routes (`/api/health`, auth callbacks, CSP reports,
  …) live in its `PUBLIC_PATTERNS`.
- **Logout:** deletes the session from the database (not just local cookies),
  clears all BetterAuth cookies, and hard-redirects to `/login` so no stale
  client state survives.

### Auto-logout on inactivity

The app logs users out after a configurable idle period to protect unattended
devices (`INACTIVITY_TIMEOUT_MINS`, default **15**):

1. `hooks/useInactivityTimeout.ts` tracks `mousemove`, `click`, `keydown`,
   `scroll`, and `touchstart`.
2. 30 seconds before expiry, a warning toast appears (via sonner).
3. If no activity follows, the session is deleted server-side and the browser
   is redirected to `/login`. Any activity during the warning dismisses the
   toast and restarts the countdown.

The timer only runs for authenticated sessions and applies equally to Super
Admins and tenant users; each tab tracks inactivity independently. The
server-side 1-hour expiry is the backstop if client-side detection is bypassed
(JScript disabled, browser crash). Configuration flows to the client through a
React context (`components/providers/InactivityTimeoutConfig.tsx`) — no
`NEXT_PUBLIC_` duplication.

## 2. Multi-Tenant Isolation

Tenant isolation is enforced at **two independent layers** so a failure in one
does not leak data (full details in [SECURITY.md](./SECURITY.md)):

1. **Application layer** — the tenant-scoped Prisma client
   (`lib/tenant-db.ts`) uses a Prisma extension to inject the current
   `organizationId` into every query on org-scoped models. The org ID comes
   from the session into `AsyncLocalStorage` (`lib/tenant-context.ts`) via
   middleware, and queries without an active tenant context **throw** rather
   than silently going unscoped.
2. **Database layer** — PostgreSQL Row Level Security policies filter rows by
   `current_setting('app.current_org_id')` as a safety net.

Super Admins use a separate, explicitly unscoped client (`lib/global-db.ts`)
for cross-tenant work; a custom ESLint rule blocks direct imports of the raw
Prisma client in business code, and `lib/global-db-guard.ts` constrains who may
use the global client. To add RLS for a new table, see
`prisma/migrations/0000_enable_rls/migration.sql`.

Organizations follow a strict lifecycle state machine:
`PENDING → ACTIVE ↔ SUSPENDED → ARCHIVED` (terminal).

## 3. Super Admin Console

Super Admins (`app/admin/*`, guarded server-side by `requireSuperAdmin()` and
client-side by `<RequireSuperAdmin>`) get a console for platform operations:

| Route | Purpose |
|-------|---------|
| `/admin/organizations` | List orgs with search, filter, pagination; create/edit/delete, member management, per-org roles & permissions, status changes, settings |
| `/admin/users` | Platform user accounts (create/view/edit/delete) |
| `/admin/roles` | Global role management |
| `/admin/permissions` | Global permission catalog (resources, search, CRUD) |
| `/admin/audit-logs` | Cross-tenant security audit log viewer with filters |
| `/admin/cache-metrics` | Live L1/L2 cache hit-rate metrics |
| `/admin/system-health` | Dependency health card (database, cache) |
| `/admin/system-logs` | Application/system log browser |

Backed by REST endpoints under `/api/admin/*` (organizations, members, roles,
permissions, users, audit logs, cache & payload-encryption metrics, system
logs). The **organization lifecycle** (activate/suspend/archive) is driven
through `/api/admin/organizations/[orgId]/status`.

A public health check for load balancers and uptime monitors lives at
`/api/health` — it checks the database (`SELECT 1`) and optionally Redis,
returning per-check latency. See [Appendix C](#appendix-c-health-endpoint).

## 4. Integrated Tenant Dashboard

The tenant-facing dashboard lives under `/dashboard/admin/*` and is assembled
from reusable components (`components/dashboard/`):

| Route | Purpose |
|-------|---------|
| `/dashboard/admin/users` | Users of the active organization |
| `/dashboard/admin/organizations` | Organization view/settings |
| `/dashboard/admin/roles` | Roles scoped to the organization |
| `/dashboard/admin/permissions` | Permission catalog as visible in org context |
| `/dashboard/admin/resources` | Feature resources and role-to-resource bindings |
| `/dashboard/admin/teams` | Teams, members, and team-level roles |
| `/dashboard/admin/calendar` | The interactive calendar (see below) |

These pages talk to REST endpoints under `/api/dashboard/admin/*`. Role-based
routing (`lib/dashboard-router.ts`) maps a user's role to their dashboard; the
`contractor` route is currently scaffolding only, deferred to a future
OpenSpec proposal.

### Resources & feature-level access control

The **Resource** model (with `ResourceRole` bindings) links named features to
roles: a user can only reach a feature if one of their roles is bound to its
resource. This enables per-feature access control beyond plain read/write
permissions, managed from the dashboard's Resources page and
`/api/dashboard/admin/resources/*`.

## 5. Roles, Permissions & Teams (RBAC)

- **Permissions** are atomic `resource:action` keys (a catalog of ~50 seeded
  permissions: property, financial, maintenance, contractor, tenant domains in
  `lib/permissions/`). Resolution is cached through the hybrid L1/L2 cache.
  Organization-scoped calendar permissions (`calendar:read|create|update|delete`)
  are enforced on all `/api/organizations/[orgId]/calendar*` routes.
- **Platform permissions** (Super Admin only):
  `platform:manage_organizations`, `platform:manage_roles`,
  `platform:manage_permissions`, `platform:view_audit_logs`.
- **Roles** are organization-scoped; members hold roles through `MemberRole`,
  and roles carry permissions through `RolePermission`. Role deletion is
  protected by safety checks (see `tests/unit/role-deletion-safety.test.ts`).
- **Teams** let organizations group people. Teams are sub-organizational:
  members added to a team inherit its roles automatically. They are managed
  via the tenant REST API:

| Route | Methods | Purpose |
|-------|---------|---------|
| `/api/organizations/[orgId]/teams` | GET, POST | List / create teams |
| `/api/organizations/[orgId]/teams/[teamId]` | GET, PATCH, DELETE | Get / update / delete team |
| `/api/organizations/[orgId]/teams/[teamId]/members` | GET, POST, DELETE | List / add / remove members |
| `/api/organizations/[orgId]/teams/[teamId]/roles` | GET, POST, DELETE | List / assign / remove team roles |

Client-side guards: `<RequirePermission>`, `features/permissions/RoleGuard`,
and the `usePermission` hook for conditional UI.

## 6. Interactive Calendar

The calendar is a standalone component tree in `components/calendar/` embedded
at `/dashboard/admin/calendar`. Each organization bootstraps with one default
calendar (more can be added per org).

**UI features:**

- Month, Week, Day, and Year views; week/day views autoscroll while dragging.
- **Drag-and-drop rescheduling**: single events move across dates and times;
  dragging a *recurring* event's occurrence excludes the original date from
  the series (`exdates`) and creates a one-off event at the new location — the
  rest of the series is untouched.
- **Event detail modal** for viewing/editing; drag-and-drop changes persist to
  the database (including preserved start/end times across month-view drags).
- **Quick-add** via right-click context menu on any day, plus a **+ Create
  Event** button in the toolbar that opens the add-event modal pre-populated
  for the visible date range. Clicking an upcoming-event row navigates the
  calendar to it.
- **Sidebar** with the next upcoming events (scoped to the dates you're
  viewing) and a live search box filtering by title, plus a
  typeable organization combobox — Super Admins can switch between Platform and
  any tenant org from the sidebar (or via `?org=` in the URL) to view/edit any
  tenant's calendar.
- **Color-coded event types**: viewings, inspections, maintenance, lease
  events, key exchange, other — with per-event color overrides.

**Recurrence:** rules are stored as RFC 5545 `rrule` JSON on the event
(`rrule` column) with `exdates` for excluded dates; expansion happens in
`lib/recurrence-rrule.ts` (the `rrule` library, with QUARTERLY and
SEMI_ANNUALLY mapped onto monthly intervals). Supported frequencies:
`DAILY`, `WEEKLY`, `MONTHLY`, `QUARTERLY`, `SEMI_ANNUALLY`, `ANNUALLY`,
each with an interval plus optional end-date or occurrence-count limit.

**API:**

| Route | Methods | Purpose |
|-------|---------|---------|
| `/api/organizations/[orgId]/calendar` | GET, POST | List calendars / create a calendar |
| `/api/organizations/[orgId]/calendar/[id]` | GET, PATCH, DELETE | Get / update / delete calendar |
| `/api/organizations/[orgId]/calendar-events` | GET, POST | List events in date range / create event |
| `/api/organizations/[orgId]/calendar-events/[id]` | GET, PATCH, DELETE | Get / update / delete event |
| `/api/organizations/[orgId]/calendar-events/upcoming` | GET | Upcoming events for the sidebar |

Event listing takes `start`, `end`, and optional `calendarId` query params:

```
GET /api/organizations/[orgId]/calendar-events?start=2026-08-01&end=2026-08-31&calendarId=xxx
```

Event types: `VIEWING`, `INSPECTION`, `MAINTENANCE`, `LEASE_SIGNING`,
`LEASE_RENEWAL`, `KEY_EXCHANGE`, `OTHER`. Events carry an optional
`propertyId` for future property-scheduling work.

## 7. Calendar Notifications

The notification service emails users — or entire organizations — about events
happening **today**, reusing the shared email infrastructure
(`lib/notifications/`) and logging every delivery to `NotificationLog`.

| Route | Methods | Purpose |
|-------|---------|---------|
| `/api/organizations/[orgId]/calendar-notifications/today` | GET | Today's events for the current user/org |
| `/api/organizations/[orgId]/calendar-notifications/send-today` | POST | Trigger today-event notifications |
| `/api/organizations/[orgId]/calendar-notifications/history` | GET | Delivery history |

Flow: scan for events whose `startDate` is today → resolve recipients
(specific user or all org members) → build a branded email (Property NI colors,
via nodemailer — configure `SMTP_*` variables) → dispatch through the shared
rate-limited dispatcher (max 5 per event type per 24h; fails open without
Redis) → log each delivery.

## 8. Real-Time Notifications

The notification bell (`features/notifications/`) combines:

- **SSE bridge** — `EventSource` to `/api/notifications/stream`; incoming
  events are injected directly into the React Query cache so the UI updates
  without a refresh. The connection only opens while the tab is focused.
  **Note:** this endpoint currently sends a simulated stream in development;
  in production it returns `501` until it is backed by Redis Pub/Sub or a
  message queue (tracked as future work).
- **Browser-aware polling** — React Query refetches while the window is
  focused and sleeps when it is backgrounded, conserving battery and server
  load.

## 9. Caching

Permission resolution and search use a **hybrid cache**: an L1 in-memory LRU
(`lib/cache/lru.ts`, with stampede protection and background warming) in front
of L2 Redis (`lib/redis.ts`), orchestrated by `lib/cache/hybrid.ts`. The app
degrades gracefully when Redis is absent (reads fall back to the database).
Live hit-rate metrics are shown at `/admin/cache-metrics`, and a benchmark
script measures the real-world benefit of each layer:

```bash
npx tsx scripts/cache-benchmark.ts   # 8 scenarios: direct DB, L2 hit, L1 hit, etc.
```

See [CACHING_ARCHITECTURE.md](./CACHING_ARCHITECTURE.md) and
[scripts/README.md](./scripts/README.md).

## 10. Data Protection & Security Hardening

- **PII at rest:** AES-256-GCM encryption for sensitive columns, keyed by
  `PII_ENCRYPTION_KEY` (`lib/pii-crypto.ts`, `lib/pii-routes.ts`).
- **Payloads in transit:** optional application-layer AES-256-GCM encryption of
  PII request/response bodies with session-bound payload keys, replay
  protection (nonce cache), and a `disabled | permissive | enforce` mode
  (`PAYLOAD_ENCRYPTION_MODE`, default `disabled`). Metrics at
  `/api/admin/payload-encryption/metrics`.
- **Content Security Policy:** strict nonce-based CSP applied via edge
  middleware in **Report-Only** mode (violations reported to
  `/api/csp-report`); `'unsafe-eval'` is permitted only in development for
  Fast Refresh. Directive details in [SECURITY.md](./SECURITY.md).
- **Secrets:** a pre-commit hook (`scripts/check-secrets.sh`, run by husky)
  blocks commits containing private-key headers, cloud access keys, or
  password-bearing connection strings; `lint-staged` runs ESLint + Prettier on
  staged files. `.env*` (except committed examples) and certificates are never
  committed.

---

# Getting Started

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| **Node.js** | 22 LTS (pinned in `.nvmrc`) | `nvm install 22 && nvm use` |
| **PostgreSQL** | 16+ | Postgres.app (macOS), `brew install postgresql`, or your distro's manager. PgBouncer is used for connection pooling (port 6432 in the default `.env.example`) — set `PGBOUNCER_PASSWORD` accordingly, or use a plain connection string. |
| **Redis** *(optional)* | 7+ | Permission/cache layer; app works without it |
| **Docker** *(for isolation tests)* | Any recent | Used by the test infrastructure compose file |

```bash
node -v            # v22.x.x
psql --version     # 16+
redis-cli --version  # optional, 7+
```

## Setup (step by step)

### 1. Clone and install

```bash
git clone <repo-url> && cd nipp
nvm use            # switches to Node 22 via .nvmrc
npm install
```

### 2. Create the databases

```bash
bash scripts/setup-db.sh   # creates nipp_dev and nipp_prod
```

### 3. Configure environment variables

```bash
cp .env.example .env
```

Fill in the values — the required ones are `DATABASE_URL`,
`BETTER_AUTH_SECRET`, `PII_ENCRYPTION_KEY`, and the seed credentials
(`ADMIN_EMAIL`, `ADMIN_PASSWORD`). The complete reference is
[Appendix A](#appendix-a-environment-variables). Quick secret generation:

```bash
openssl rand -base64 32   # BETTER_AUTH_SECRET
openssl rand -hex 32      # PII_ENCRYPTION_KEY (64 hex chars)
```

> **Never commit `.env`** — only the committed examples (`.env.example`,
> `.env.local-prod.example`, `.env.test.example`) go in version control.

### 4. Initialize and seed the database

```bash
npx prisma generate   # required before any prisma command
npx prisma db push    # create all tables (dev; use db:migrate for migration files)
npm run db:seed       # platform org + permission catalog + admin + dev tenants
```

The seed is idempotent and runs in two profiles (dev by default, test mode when
`TEST_ADMIN_EMAIL` is set). Details are in
[Appendix B](#appendix-b-database-seeding-guide). The script prints the
`PLATFORM_ORG_ID` afterwards — add it to `.env` for stability.

### 5. Run it

```bash
npm run dev          # http://localhost:3000
```

Log in as the super admin (from your `.env`) to see the Super Admin console,
or as a dev tenant user to see the tenant dashboard and calendar.

### 6. Verify

```bash
npm test             # unit tests (no running services needed)
npm run type-check   # strict TypeScript
npm run lint         # ESLint — zero warnings expected
```

# Day-to-Day Development

## Scripts

| Script | Command | Purpose |
|--------|---------|---------|
| `npm run dev` | `next dev` | Dev server (HTTP, hot reload) |
| `npm run dev:https` | `next dev --experimental-https` | Dev server with local HTTPS |
| `npm run build` / `npm start` | `next build` / `next start` | Production build / serve |
| `npm run lint` | `next lint` | ESLint (zero warnings is the bar) |
| `npm run type-check` | `tsc --noEmit` | Strict TypeScript check |
| `npm run db:migrate` | `prisma migrate dev` | Create + apply a migration file |
| `npm run db:push` | `prisma db push` | Push schema without migration files (dev) |
| `npm run db:seed` | `tsx prisma/seed.ts` | Seed platforms, permissions, users, teams |
| `npm run db:studio` | `prisma studio` | GUI database browser |
| `npm run db:reset` | `prisma migrate reset --skip-seed` | Drop and recreate the database |
| `bash scripts/setup-db.sh` | — | Create dev/prod databases and guide setup |
| `npm test` | `vitest run tests/unit` | Unit tests only |
| `npm run test:watch` | `vitest tests/unit` | Watch mode (unit) |
| `npm run test:coverage` | `vitest run tests/unit --coverage` | Unit tests + coverage report |
| `npm run test:integration` | `vitest run tests/integration tests/isolation` | Integration + isolation app-layer tests (needs PostgreSQL + Redis) |
| `npm run test:all` | `vitest run` | Everything under `tests/` |
| `npm run test:isolation` | — | Full isolation pipeline: setup → app tests → Playwright E2E → teardown |
| `npm run test:isolation:setup` / `:teardown` | bash scripts | Create/drop the dedicated `nipp_test` database (+ Docker infra) |
| `npm run test:isolation:app` | `vitest run tests/isolation/application/` | App-layer tenant-separation tests |
| `npm run test:isolation:e2e` | Playwright | Browser E2E (cross-tenant UI isolation, calendar, payload encryption) |
| `npm run build:cloud` / `deploy:cloud` | — | Placeholders for the cloud pipeline |

## Quality gates (pre-commit & pre-push)

All four checks must pass before committing and pushing:

```bash
npm test              # 1. unit tests green
npm run test:integration   # 2. integration + isolation app-layer tests
npx eslint . --max-warnings=0   # 3. zero lint warnings
npx tsc --noEmit      # 4. strict type check clean
```

Husky runs `scripts/check-secrets.sh` and `lint-staged` (ESLint --fix +
Prettier) automatically on each commit.

## Testing the tenant isolation suite

Isolation tests use a dedicated `nipp_test` database and Docker infrastructure
(`docker-compose.test.yml` — PostgreSQL + PgBouncer):

```bash
npm run test:isolation   # full pipeline, one command
```

For the manual granular flow, fixtures, and troubleshooting see
[ISOLATION_TEST_STRATEGY.md](./ISOLATION_TEST_STRATEGY.md) and the
[quick-start](./ISOLATION_TEST_QUICK_START.md). The app-layer suite verifies
Prisma-extension scoping, tenant context propagation, and global-db guards;
the E2E suite exercises cross-tenant isolation, super-admin exclusivity,
calendar interactions, and payload encryption from a real browser.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `@prisma/client did not initialize` | Run `npx prisma generate` |
| `DATABASE_URL not found` | Ensure `.env` exists with a valid connection string |
| `PLATFORM_ORG_ID ... does not exist` (from `lib/rls.ts`) | Run the seed script first, or set `PLATFORM_ORG_ID` in `.env` |
| Redis connection errors | Optional — the app degrades to direct DB reads; fix your `REDIS_URL` if you want caching |
| Port 3000 busy | `lsof -ti:3000 \| xargs kill`, or `PORT=3001 npm run dev` |
| TypeScript errors after schema changes | `npx prisma generate` |
| Seed fails on credentials | `ADMIN_EMAIL` (valid email) and `ADMIN_PASSWORD` (> 8 chars) must be set |

---

# Appendices

## Appendix A — Environment Variables

All variables are validated at startup by the Zod schema in `lib/env.ts`.
Start from `.env.example` (committed, placeholders only).

**Database & core**

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `DATABASE_URL` | yes | — | PostgreSQL connection string (PgBouncer-aware by default: port 6432 with pool options) |
| `PGBOUNCER_PASSWORD` | when using PgBouncer | — | Pooler password |
| `REDIS_URL` | no | `redis://localhost:6379` | Redis for L2 caching & replay cache |
| `L1_CACHE_MAX_ENTRIES`, `L1_CACHE_TTL_MS` | no | built-in | L1 in-memory cache tuning |
| `LOG_LEVEL` | no | `debug` | `debug` \| `info` \| `warn` \| `error` |
| `FRONTEND_URL`, `NEXT_PUBLIC_API_URL` | no | `http://localhost:3000` | App URLs |
| `PLATFORM_ORG_ID` | no (auto-found) | — | Platform organization ID; written by the seed, worth pinning |
| `TRUSTED_PROXY_CIDRS` | no | — | Proxy CIDRs for client-IP extraction |

**Authentication**

| Variable | Required | Purpose |
|----------|----------|---------|
| `BETTER_AUTH_SECRET` | yes (≥ 32 chars) | Session encryption key |
| `BETTER_AUTH_URL` | no | BetterAuth base URL |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | no (for Google login) | Google OIDC credentials |
| `INACTIVITY_TIMEOUT_MINS` | no (default `15`) | Auto-logout after this idle time; digits only |
| `SUPER_ADMIN_EMAIL` | no | Optional super-admin email hint |

**Email (nodemailer)**

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `SMTP_HOST`, `SMTP_PORT` | for notifications | `localhost` / `587` | SMTP server |
| `SMTP_USER`, `SMTP_PASS` | no | — | SMTP auth |
| `SMTP_FROM` | no | `noreply@nipp.gov.uk` | Sender address |

**Data protection**

| Variable | Required | Purpose |
|----------|----------|---------|
| `PII_ENCRYPTION_KEY` | yes (64 hex chars) | AES-256-GCM key for PII at rest |
| `PAYLOAD_ENCRYPTION_MODE` | no (`disabled`) | `disabled` \| `permissive` \| `enforce` — payload encryption in transit |
| `PAYLOAD_ENCRYPTION_MAX_BYTES` | no (65536) | Max encrypted request body size |
| `PAYLOAD_ENCRYPTION_KEY_TTL_SECONDS` | no (300) | Payload key lifetime |
| `PAYLOAD_ENCRYPTION_REPLAY_WINDOW_SECONDS` | no (30) | Replay-protection window |
| `PAYLOAD_ENCRYPTION_NONCE_TTL_SECONDS` | no (60) | Nonce cache TTL |
| `PAYLOAD_ENCRYPTION_REPLAY_CACHE` | no (`redis`) | `memory` \| `redis` replay-dedup backend |
| `PAYLOAD_ENCRYPTION_REQUIRE_REPLAY_CACHE` | no (`false`) | Fail closed in enforce mode if the replay cache is unavailable |

**Seed credentials** — never shared in committed files; see Appendix B.

## Appendix B — Database Seeding Guide

The seed script (`prisma/seed.ts`) bootstraps organizations, the permission
catalog (~50 `resource:action` permissions), the super admin, and teams. It is
**idempotent** — re-running upserts existing records to match the latest
script values.

**Both modes require:**

| Variable | Notes |
|----------|-------|
| `ADMIN_EMAIL` | Valid email for the super admin |
| `ADMIN_PASSWORD` | > 8 characters |

**Dev profile** (default — when `TEST_ADMIN_EMAIL` is *not* set):

Creates the Platform Organization ("Platform Ops" team), "Dev Tenant Ltd"
("Members" + "Operations" teams), the super admin with all platform
permissions, and two dev tenant users joined to Operations.

| Variable | Default |
|----------|---------|
| `DEV_TENANT_A_EMAIL` / `_PASSWORD` | `dev-tenant-a@example.com` / `DevTenantA123!` |
| `DEV_TENANT_B_EMAIL` / `_PASSWORD` | `dev-tenant-b@example.com` / `DevTenantB123!` |

**Test profile** (activated by setting a non-empty `TEST_ADMIN_EMAIL`):

Creates the Platform Organization (Members team only), "Test Tenant Ltd"
("Members" + "QA Operations" teams), the test super admin, and two test tenant
users in QA Operations.

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

After seeding: add the printed `PLATFORM_ORG_ID` to `.env`, restart the dev
server, and log in fresh.

## Appendix C — Health Endpoint

`GET /api/health` (public, excluded from session validation) is for load
balancers, orchestrators, and uptime monitors:

```json
{
  "status": "healthy",
  "timestamp": "2026-07-14T12:00:00.000Z",
  "version": "0.1.0",
  "uptime": 3600,
  "checks": {
    "database": { "status": "healthy", "latency_ms": 12 },
    "cache":    { "status": "healthy", "latency_ms": 3 }
  }
}
```

- **200** — healthy (or degraded: a non-critical check like Redis failed)
- **503** — critical check failed (database unreachable)
- No sensitive information is exposed.

## Appendix D — Data Model

Prisma models (`prisma/schema.prisma`), grouped by domain:

| Group | Models |
|-------|--------|
| Identity & auth | `User`, `Session`, `Account` |
| Organizations & membership | `Organization`, `Member`, `Invitation`, `SentInvitation` |
| Teams | `Team`, `TeamMember`, `TeamRole` |
| RBAC | `Permission`, `Role`, `RolePermission`, `MemberRole`, `Resource`, `ResourceRole` |
| Calendar | `Calendar`, `CalendarEvent` (rrule JSON + exdates, optional `propertyId`) |
| Audit & notifications | `AuditLog`, `NotificationLog` |

All organization-scoped models carry an `organizationId` and are covered by
the two-layer isolation strategy (Prisma extension + RLS).

## Appendix E — Technology Stack & Version Pins

| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | Node.js | 22 LTS (pinned — `.nvmrc`, `engines`) |
| Framework | Next.js (App Router) | ^15.x |
| UI | React / Tailwind CSS | ^19.x / v4.x |
| Auth | BetterAuth | ^1.6.x |
| ORM / DB | Prisma / PostgreSQL | ^6.x / 16+ |
| Pooler | PgBouncer | — |
| Cache | Redis (ioredis) + in-memory LRU | optional |
| Recurrence | rrule | ^2.x |
| Email | nodemailer | ^9.x |
| State/queries | @tanstack/react-query | ^5.x |
| Validation / logging | Zod v4 / Pino | — |
| Testing | Vitest / Playwright / Testing Library | ^4.1.x / ^1.x |

Why Node 22: it is LTS (supported to April 2027); Vitest 4 requires
`^20 || ^22 || >=24`, and every other major dependency (Next 15, Prisma 6,
BetterAuth 1.6) is tested against it. Major framework upgrades require their
own OpenSpec proposal (see SPECIFICATION_DESIGN_PROCESS.md).

## Appendix F — Project Documentation Map

| Document | What it covers |
|----------|----------------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System architecture, component diagram, teams API reference |
| [SECURITY.md](./SECURITY.md) | Multi-tenancy layers, auth/session model, auto-logout, CSP directives |
| [CACHING_ARCHITECTURE.md](./CACHING_ARCHITECTURE.md) | L1/L2/ISR caching design, stampede protection, tuning |
| [QUICK_START.md](./QUICK_START.md) | Minimal setup path |
| [ISOLATION_TEST_STRATEGY.md](./ISOLATION_TEST_STRATEGY.md) | Tenant-isolation test design and troubleshooting |
| [SPECIFICATION_DESIGN_PROCESS.md](./SPECIFICATION_DESIGN_PROCESS.md) | OpenSpec-driven feature lifecycle used across the project |
| [scripts/README.md](./scripts/README.md) | Cache benchmark and script utilities |
| `openspec/changes/` | One proposal per feature (calendar, isolation infra, payload encryption, CSP, …) |
| `documents/` | Business research, feature planning, operations runbook |

**Deferred work** is tracked in the deferred items registry at
[openspec/changes/project-initialization/proposal.md](./openspec/changes/project-initialization/proposal.md).
Notable open threads: production-grade real-time fan-out (the SSE stream is a
dev simulation), contractor-role feature, property management business flows,
and the cloud build/deploy pipeline (scripts are placeholders).

## License

Proprietary — Property NI
