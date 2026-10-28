# Property NI Multi-Tenant Portal (nipp)

Property NI is a property management portal. It is a secure, central digital platform that connects property managers, landlords, and tenants to automate and streamline real estate operations. It serves as a 24/7 self-service hub where users can handle day-to-day tasks without needing direct phone or email interaction.

Core Functions of a Property Management Portal:

* Financial Management: Online automated invoicing, and tracking of historical financial ledgers.
* Maintenance & Work Orders: Direct submission of maintenance requests, photo uploads, and real-time status tracking.
* Document Hub: Centralised, secure storage for lease agreements, building compliance documents, and digital receipts.
* Communications: Direct messaging channels, community announcements, and automated push notifications.

In software architecture, tenant isolation ensures that a shared software application keeps each customers data and resources completely walled off from everyone elses. 

In a property management system, a "tenant" can refer to an independent property management company or a management agent with a number of different housing complexes under management

Because portals handle highly sensitive personal information, banking details, and legal contracts, enforcing strict tenant isolation layers is vital: 

1. Logical Segregation (Roles and Permissions)

The portal application must enforce absolute Role-Based Access Control (RBAC). A renter logging in must only see their own lease, balance, and history. Under no circumstances should cross-tenant data leak via URL manipulation (e.g., changing an ID parameter from .../invoice/101 to .../invoice/102). The application must securely intercept and validate that the logged-in user explicitly owns that requested resource.

2. Data-Level Isolation

Depending on the portal's scale and security needs, portals use one or more of the following strategies:

• Shared Database : Data lives on the same physical server, but each customer has a completely distinct database view. This strikes an ideal balance between scalability and logical data security. 

• Database-Level Isolation using Row Level Security : This is a security policy that ensures that tenants can only access data from their own organization.

• Personally Indentifiable Information (PII) encryption: Tenant data is saved in a shared database but it is encrypted using cryptographic keys so that a users personal data is unreadable by anyone outside of their organization. 


3. Resource & Performance Isolation

A proper isolation strategy prevents a "noisy neighbour" effect. If one large property management client initiates a massive data extraction or runs a complex portfolio-wide tax report, it should not slow down rent processing or maintenance logging for other independent users on the system.


The portal is built with Next.js 15 (App Router), React 19, BetterAuth, Prisma 6, and PostgreSQL 16, with optional Redis for caching.


## Who uses it

There are two kinds of users:

- **Super Admins** — the platform's operators. They manage every organization from a dedicated admin console: accounts, roles, permissions, calendars, audit logs, system health, and scheduled jobs.
- **Tenant Users** — staff working inside one organization. Their dashboard views their own organization only: an interactive calendar, an organization chart of teams and members, and organization settings. (Modifying data requires the tenant-administrator role.)

There is no public sign-up. Accounts are created by a Super Admin.

## At a glance

| Area | What it does |
|------|--------------|
| Multi-tenant isolation | No tenant ever sees another tenant's data — enforced twice |
| Sign-in | Email/password + invite-only Google; short sessions, idle auto-logout |
| Access control | ~50 fine-grained permissions, roles, teams, per-feature toggles |
| Super Admin console | Run the whole platform from one dashboard |
| Tenant workspace | Daily tools for your organization, view-by-default |
| Calendar | Interactive, recurring events, live "starting soon" alerts |
| Organization chart | Zoomable tree of org → teams → members |
| Notifications | Live in-app feed + email for today's events |
| Caching | In-memory + Redis; works with Redis off |
| Job scheduler | Approved, timed, logged platform automation |
| Security hardening | Encrypted personal data, browser policy, secret scanning |

New here? Skip to [Getting Started](#getting-started). Want the full picture of how it works? See [`ARCHITECTURE.md`](./ARCHITECTURE.md) and [`SECURITY.md`](./SECURITY.md) — the "Details in" links throughout the sections below point you there too.

## What the platform does

This section describes what each part of the portal does. For *how* it works — architecture, security model, data flow — follow the "Details in" links to `ARCHITECTURE.md` and `SECURITY.md`. Every management action (creating, editing, or deleting users, organizations, roles; approving jobs) is recorded in a searchable audit log.

### Authentication & sessions

Sign in with email and password, or with Google — but Google is **invite-only**: an admin creates the account first, and the person verifies their address with a one-time emailed link before they can sign in. Every session lasts at most one hour, and users are signed out automatically after sitting idle (default 15 minutes) so an unattended browser never stays open. Scripts and servers on other machines can authenticate with a bearer token instead of browser cookies.

*Details in: [SECURITY.md §2](./SECURITY.md#2-authentication--session-security), [ARCHITECTURE.md §3](./ARCHITECTURE.md#3-authentication--session-management).*

### Multi-tenant isolation

Each organization's data — properties, members, roles, calendars, and its audit trail — is invisible to everyone else. This is enforced at **two independent layers** so a failure in one can't leak data: the application scopes every query to the current user's organization, and the database adds its own row-level filter as a safety net. Super Admins are the exception — they act across all organizations, and only where explicitly authorized.

*Details in: [SECURITY.md §1](./SECURITY.md#1-multi-tenant-isolation), [ARCHITECTURE.md §5](./ARCHITECTURE.md#5-multi-tenant-architecture).*

### Super Admin Console

Super Admins run the whole platform from one console (`/dashboard/admin`): user accounts, organizations, units, contractors, roles, permissions, teams, the notification log, calendars, org charts, and system health. The sidebar groups these into three collapsible sections — **People**, **Platform**, and **Ops**.

*Page-by-page and route reference: the `/api-docs` Swagger UI.*

### Tenant Workspace

Every organization's staff sign in to the same portal, but each sees only their own organization — tenant users are isolated from every other organization's data. Their workspace includes the calendar, an organization chart of their people and teams, member and role listings, and a map page; tenant administrators can manage those, everyone else views. **Super Admins** belong to the Platform organization, which grants root access: they can view and update any tenant, anywhere. (An external-contractor workspace is planned — its data model already exists.)

*Pages and routes: documented per feature; super admins can also browse the full `/api-docs` API reference.*

### Roles, permissions & teams

Access is permission-based: a catalog of about 50 fine-grained `resource:action` permissions, grouped into organization-level roles that admins assign to people. People can also be grouped into **teams** — joining a team automatically grants its roles at the right level. Which features a role can touch is controlled by *Resources*, so an organization can switch whole areas of the portal on or off per role.

*Details in: [SECURITY.md §3](./SECURITY.md#3-authorization--access-control), [ARCHITECTURE.md §4](./ARCHITECTURE.md#4-authorization-rbac).*

### Calendar

A full interactive calendar for each organization — month, week, day, and year views with drag-and-drop rescheduling. Recurring events (daily through yearly) work natively; dragging one occurrence out of a recurring series moves just that one without touching the rest. Every organization is alerted in-app when an event starts within the next 15 minutes.

*Details in: [ARCHITECTURE.md §9](./ARCHITECTURE.md#9-calendar-system).*

### Organization chart

A live, interactive tree of an organization's people — organization → teams → members — with zoom and pan, a member detail popup showing each person's roles and permissions, and an unassigned bucket for anyone without a team. It reads the data that already exists; it doesn't create any new records.

*Details in: [ARCHITECTURE.md §10](./ARCHITECTURE.md#10-organization-chart).*

### Notifications (live + email)

Two channels. **Live:** every connected dashboard shows a running feed at the bottom of the page — health problems, admin changes, calendar events about to start, job runs — and important alerts stay on screen until someone dismisses them; the full history is browsable from the admin console. **Email:** users can be emailed about their organization's events happening today, with delivery logged.

*Details in: [ARCHITECTURE.md §8](./ARCHITECTURE.md#8-real-time-notification-system-sse) (live) and §9 (email).*

### Caching

Frequent lookups — permission checks, search results — are served from an in-memory cache backed by Redis, so the database isn't hit on every request. The portal runs fine if Redis is off: it just falls back to the database. Live hit-rate figures appear in the admin console.

*Details in: [ARCHITECTURE.md §12](./ARCHITECTURE.md#12-cache-architecture), [CACHING_ARCHITECTURE.md](./CACHING_ARCHITECTURE.md).*

### Background job scheduler

Platform automation runs on a built-in scheduler: recurring or one-off jobs written as cron expressions, managed from the admin console (create, trigger, inspect history). Because it can also run operator-authored JavaScript, every new job must be **approved by a platform admin before it is allowed to run at all**, and can first be tested risk-free in *dry-run* mode, which runs the job without changing anything. Each run is timed, logged, and pushed to the live feed when it finishes or fails.

*Details in: [ARCHITECTURE.md §11](./ARCHITECTURE.md#11-job-scheduler).*

### Security hardening

Beyond tenant isolation and session security, the portal adds a browser-hardening policy (Content-Security-Policy), encrypts personal data stored in the database, optionally encrypts sensitive payloads as they travel between browser and server, and refuses to let secrets be committed to the repository.

*Full model: [SECURITY.md](./SECURITY.md).*

## Getting Started

Full setup guide (including the test environment): [`QUICK_START.md`](./QUICK_START.md). The short version:

### Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| **Node.js** | 22 LTS (pinned in `.nvmrc`) | `nvm install 22 && nvm use` |
| **PostgreSQL** | 16+ | Postgres.app (macOS), Homebrew, or your distro's manager. PgBouncer pools connections (port 6432 in the default `.env.example`). |
| **Redis** *(optional)* | 7+ | Caching layer; the app runs fine without it |

### Step by step

1. **Clone and install**

   ```bash
   git clone <repo-url> && cd nipp
   nvm use            # switches to Node 22 via .nvmrc
   npm install
   ```

2. **Create the databases**

   ```bash
   bash scripts/setup-db.sh   # creates nipp_dev and nipp_prod
   ```

3. **Configure environment variables** — copy the template and fill in your values; the required ones are `DATABASE_URL`, `BETTER_AUTH_SECRET`, `PII_ENCRYPTION_KEY`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD`. The complete reference lives with the setup guide: [`QUICK_START.md`](./QUICK_START.md#environment-variables).

   ```bash
   cp .env.example .env
   openssl rand -base64 32   # a value for BETTER_AUTH_SECRET
   openssl rand -hex 32      # a value for PII_ENCRYPTION_KEY
   ```

   > **Never commit `.env`** — only the committed example templates go in version control.

4. **Initialize and seed the database**

   ```bash
   npx prisma generate   # required before any prisma command
   npx prisma db push    # create all tables (dev)
   npm run db:seed       # platform org + permission catalog + admin + dev tenants
   ```

   The seed can be re-run safely. It prints a `PLATFORM_ORG_ID` value afterwards — add it to `.env`.

5. **Run it**

   ```bash
   npm run dev          # http://localhost:3000
   ```

   Log in as the super admin (credentials from your `.env`) for the admin console, or as a seeded tenant user for the tenant dashboard and calendar.

6. **Verify**

   ```bash
   npm test             # unit tests (no running services needed)
   npm run type-check   # strict TypeScript
   npm run lint         # ESLint — zero warnings expected
   ```

## Day-to-day development

### Scripts

| Task | Command |
|------|---------|
| Dev server (hot reload) · with HTTPS | `npm run dev` · `npm run dev:https` |
| Production build / serve | `npm run build` · `npm start` |
| Lint (zero warnings is the bar) · type check | `npm run lint` · `npm run type-check` |
| Unit tests (fast, no services needed) | `npm test` |
| Integration + isolation app-layer tests (needs PostgreSQL + Redis) | `npm run test:integration` |
| Full tenant-isolation pipeline (Docker infra → app tests → browser E2E) | `npm run test:isolation` |
| Create a migration · push schema without one (dev) | `npm run db:migrate` · `npm run db:push` |
| Seed / browse the database | `npm run db:seed` · `npm run db:studio` |
| Drop and recreate the database | `npm run db:reset` |
| Regenerate the API reference from route docs | `npm run docs:generate` |
| Measure caching benefit (8 scenarios) | `npx tsx scripts/cache-benchmark.ts` |

### Quality gates

All four checks must pass before committing and pushing — Husky also runs a secret scan and formatting automatically on every commit:

```bash
npm test                  # unit tests green
npm run test:integration  # integration + isolation app-layer tests
npx eslint . --max-warnings=0
npx tsc --noEmit
```

### Testing tenant isolation

`npm run test:isolation` runs the whole check in one command — a dedicated `nipp_test` database, Docker for PostgreSQL and PgBouncer, then app-layer tests proving no tenant can read another's data, then real-browser tests of the same rule. Setup, fixtures, and troubleshooting: [`ISOLATION_TEST_STRATEGY.md`](./ISOLATION_TEST_STRATEGY.md) and its [quick-start](./ISOLATION_TEST_QUICK_START.md).

### Troubleshooting

| Problem | Fix |
|---------|-----|
| `@prisma/client did not initialize` | Run `npx prisma generate` |
| `DATABASE_URL not found` | Make sure `.env` exists with a valid connection string |
| `PLATFORM_ORG_ID ... does not exist` | Run the seed script first, or set `PLATFORM_ORG_ID` in `.env` |
| Redis connection errors | Optional — the app runs without it; fix `REDIS_URL` if you want caching |
| Port 3000 busy | `lsof -ti:3000 \| xargs kill`, or `PORT=3001 npm run dev` |
| TypeScript errors after schema changes | `npx prisma generate` |
| Seed fails on credentials | `ADMIN_EMAIL` (valid email) and `ADMIN_PASSWORD` (8+ characters) must be set |

## Where to look next

| Document | What it covers |
|----------|----------------|
| [`QUICK_START.md`](./QUICK_START.md) | Complete local setup — environment variables, seeding, the test environment |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | How every part of the system works — components, data flow, calendar, org chart, job scheduler, notifications, caching |
| [`SECURITY.md`](./SECURITY.md) | The security model — tenant isolation, sign-in and sessions, authorization, encryption, browser policy |
| [`CACHING_ARCHITECTURE.md`](./CACHING_ARCHITECTURE.md) | Cache layers in depth, tuning, cross-instance behaviour |
| [`ISOLATION_TEST_STRATEGY.md`](./ISOLATION_TEST_STRATEGY.md) + [quick-start](./ISOLATION_TEST_QUICK_START.md) | How the "no tenant sees another's data" guarantee is tested |
| [`SPECIFICATION_DESIGN_PROCESS.md`](./SPECIFICATION_DESIGN_PROCESS.md) | How features are proposed, reviewed, and shipped (OpenSpec) |
| **`/api-docs`** (when the app is running) | Browsable OpenAPI reference for every API route (super-admin only) — `http://localhost:3000/api-docs` |
| [`scripts/README.md`](./scripts/README.md) | Utilities: cache benchmark, database setup, secret scanning |
| `openspec/changes/` | One design proposal per feature |
| `documents/` | Feature planning, business research, operations notes |

**Known open threads:** live notifications are relayed in-process, so a future multi-server deployment needs a shared relay; the external-contractor workspace has its data model and admin pages shipped but no tenant dashboard yet; property-management business flows and the cloud build/deploy pipeline are placeholders. Full list: [the deferred-items registry](./openspec/changes/project-initialization/proposal.md).

## License

Proprietary — Property NI
