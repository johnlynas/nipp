# Property NI Portal - System Architecture

## 📋 Overview
The Property NI (nipp) portal is a full-stack, multi-tenant property management system designed for Northern Ireland's public sector housing authority. It provides a secure, role-based platform for managing organizations (tenants), users, properties, leases, and maintenance requests. The system enforces strict data isolation between organizations using a defense-in-depth architecture combining application-layer query interception and database-level Row Level Security (RLS).

## 🏗️ Technology Stack

### Frontend
- **Framework:** Next.js 15 (App Router)
- **UI Library:** React 19
- **Styling:** Tailwind CSS v4 (with `@tailwindcss/postcss` and `@tailwindcss/typography`)
- **State Management:** React Server Components / Client Components with `useSyncExternalStore` for session state, SWR/React Query patterns implied by caching architecture
- **Testing UI:** Testing Library (`@testing-library/react`, `@testing-library/jest-dom`)

### Backend
- **Runtime:** Node.js 22 LTS (pinned)
- **API Routes:** Next.js API Routes (App Router) with explicit `nodejs` runtime for Prisma compatibility
- **Authentication:** BetterAuth v1.6 (with Organization plugin)
- **Database ORM:** Prisma 6 (`@prisma/client`)
- **Database:** PostgreSQL 16+
- **Caching:** Redis (via `ioredis`) for permission caching and session cache

### Testing & Quality
- **Unit/Integration Tests:** Vitest v4.1 (with `@vitest/coverage-v8`)
- **Type Checking:** TypeScript 5.7 (strict mode)
- **Linting:** ESLint 9 (flat config via `eslint-config-next`)
- **Formatting:** Prettier v3.4

## 🗂️ Project Structure

```
nipp/
├── app/                          # Next.js App Router (pages & API routes)
│   ├── (auth)/                   # Authentication pages (login, register)
│   ├── admin/                    # Super admin dashboard & layouts
│   ├── api/                      # API endpoints (RESTful routes)
│   │   ├── auth/[...all]/        # BetterAuth catch-all handler
│   │   ├── health/               # Health check endpoint for monitoring
│   │   └── ...                   # Domain-specific API routes
│   ├── layout.tsx                # Root layout
│   └── ...                       # Page components & layouts
├── components/                   # Reusable React components
│   ├── auth/                     # Auth-related components (RequirePermission, RequireSuperAdmin)
│   └── ui/                       # UI primitives & domain components
├── lib/                          # Core business logic & utilities
│   ├── auth.ts                   # BetterAuth configuration & session callbacks
│   ├── auth-client.ts            # Client-side auth utilities & hooks
│   ├── authz.ts                  # Authorization logic (hasPermission, isSuperAdmin)
│   ├── tenant-db.ts              # Multi-tenant Prisma extension ($extends)
│   ├── db.ts                     # Global Prisma client instance
│   ├── tenant-context.ts         # AsyncLocalStorage for tenant context propagation
│   └── permissions/              # Permission resolution & caching logic
├── hooks/                        # Custom React hooks (useSession, usePermission)
├── prisma/                       # Database schema & migrations
│   ├── schema.prisma             # Prisma schema definition (enums, models, relations)
│   └── migrations/               # Database migration files & RLS policies
├── tests/                        # Test suites
│   ├── unit/                     # Unit tests (isolated function testing)
│   ├── integration/              # Integration tests (PostgreSQL + Redis)
│   └── isolation/                # Tenant isolation guarantee tests
├── scripts/                      # Utility scripts (secret checking, DB setup)
│   └── check-secrets.sh          # Pre-commit secret scanning hook
├── middleware.ts                 # Route protection & Edge-runtime cookie validation
└── next.config.ts                # Next.js configuration (CSP, webpack externals)
```

## 🔐 Multi-Tenant Architecture

### Tenant Isolation Strategy
The system enforces strict tenant isolation using a **defense-in-depth** approach. If one layer fails, the other acts as a safety net to prevent cross-tenant data leakage.

**Layer 1: Application-Level Isolation (Prisma `$extends`)**
- Located in `lib/tenant-db.ts`, this extension intercepts Prisma queries at the application layer.
- **Context Propagation:** The current `organizationId` is stored in Node.js `AsyncLocalStorage` via middleware and `lib/tenant-context.ts`.
- **Query Interception:** The extension automatically injects `organizationId` into the `where`, `data`, `create`, and `update` clauses for tenant-scoped models.
- **Fail-Safe:** If a query executes against a scoped model without an active tenant context, the extension throws an explicit error (`Tenant context missing for scoped query.`), preventing accidental global queries.

**Layer 2: Database-Level Isolation (PostgreSQL RLS)**
- PostgreSQL Row Level Security policies are applied to tenant-scoped tables as a secondary safety net.
- Even if the application layer is bypassed or misconfigured, the database engine rejects any query attempting to access rows belonging to a different `organizationId`.
- RLS policies use `current_setting('app.current_org_id', true)` to enforce isolation at the database engine level.

### Data Flow
1. **Request arrives** → Middleware checks session cookie presence (Edge-safe, no Prisma)
2. **Tenant context established** → `AsyncLocalStorage` stores the user's `organizationId`
3. **Database query executed** → Prisma extension automatically injects tenant filter into `where` clauses
4. **Response returned** → User only sees data scoped to their organization

### Tenant-Scoped Models
The following models are strictly scoped to organizations and protected by the Prisma extension:
- `Role` (organization-scoped role definitions)
- `RolePermission` (junction table mapping roles to permissions, org-scoped for isolation)
- `MemberRole` (junction table linking members to roles, org-scoped for isolation)

Global models (`User`, `Organization`, `Member`, `Permission`, `AuditLog`) are not scoped and require explicit authorization checks.

## 🔑 Authentication & Authorization

### Authentication Flow
- **Provider:** BetterAuth v1.6 with email/password and OAuth (Google) support.
- **Session Management:** Secure, HTTP-only cookies (`better-auth.session_token`, `__Secure-better-auth.session_token`).
- **Cookie Cache:** Enabled in `lib/auth.ts` (`maxAge: 5 minutes`) for fast, Edge-runtime-safe session validation without hitting Prisma.
- **Session Callbacks:** In Node.js runtime, the `session` callback resolves user permissions and Super Admin status before returning the session object. In Edge runtime (middleware), it returns a lightweight session without permissions to avoid Prisma initialization errors.

### Authorization Flow
- **RBAC System:** Granular Role-Based Access Control using a global permission catalog (`Permission` model) with `resource:action` syntax (e.g., `properties:view`, `leases:create`).
- **Permission Resolution:** The `resolvePermissions` function in `lib/permissions/resolver.ts` fetches permissions for a user's roles, caches them in Redis (TTL: 300s), and returns the flat list.
- **Super Admin Detection:** Users are identified as Super Admins if their active organization matches the `PLATFORM_ORG_ID` (stored in `.env` or resolved from the database). Super Admins have access to platform-level permissions (`platform:manage_organizations`, etc.).
- **UI & Route Protection:** Components like `<RequirePermission>` and `<RequireSuperAdmin>` wrap UI elements. API routes use `hasPermission()` and `isSuperAdmin()` checks from `lib/authz.ts`.

### Middleware Protection
- **Edge-Safe Validation:** `middleware.ts` performs a fast check for session cookie presence. This avoids Prisma Edge Runtime crashes while ensuring unauthenticated users are redirected to `/login`.
- **Cache Control:** Protected routes return `Cache-Control: no-store, max-age=0` headers to prevent caching of sensitive data and ensure logout is respected across tabs.
- **Public Routes:** `/login`, `/register`, `/api/auth`, and `/api/health` are explicitly whitelisted.

## 🗄️ Database Design

### Core Entities
- **User:** Authentication principal with email, password hash, role, and ban status.
- **Organization:** Tenant entity with lifecycle states (`PENDING`, `ACTIVE`, `SUSPENDED`, `ARCHIVED`).
- **Member:** Junction table linking Users to Organizations (many-to-many).
- **Role:** Organization-scoped role definitions (default bootstrapped roles vs. custom admin-created roles).
- **Permission:** Global master catalog of atomic actions (`resource:action`).
- **RolePermission:** Junction table mapping Roles to Permissions.
- **MemberRole:** Junction table linking Members to Roles (supports multiple roles per member).
- **AuditLog:** Global security audit trail recording admin actions across all organizations.

### Relationships
- `User` ↔ `Organization`: Via `Member` (many-to-many)
- `Role` → `Permission`: Via `RolePermission` (one-to-many from Role, many-to-one to Permission)
- `Member` → `Role`: Via `MemberRole` (one-to-many from Member, many-to-one to Role)
- `Organization` → `Role`, `MemberRole`, `AuditLog`: One-to-many cascading deletes

### Indexing Strategy
- Foreign keys are automatically indexed by Prisma.
- Explicit composite indexes on `organizationId` for tenant-scoped models (`Role`, `RolePermission`, `MemberRole`).
- Additional indexes on `AuditLog` for `userId`, `organizationId`, `timestamp`, and `resourceType` to support Super Admin cross-tenant queries.
- Unique constraints on `[userId, orgId]` (Member), `[roleId, permissionId]` (RolePermission), and `[memberId, roleId]` (MemberRole) to prevent duplicates.

## 🧪 Testing Strategy

### Test Categories
- **Unit Tests:** Isolated function testing using Vitest. Mocks Prisma and Redis clients to test business logic without database dependencies.
- **Integration Tests:** Full stack testing with real PostgreSQL and Redis instances. Validates end-to-end workflows like organization bootstrapping, role assignment, and permission resolution.
- **Isolation Tests:** Specifically verify tenant isolation guarantees by attempting cross-tenant queries and confirming they are blocked at the application or database layer.

### Test Infrastructure
- **Vitest Configuration:** Uses `jsdom` environment for React component tests, Node.js environment for backend logic.
- **Mocking Strategies:** `vi.mock()` is used extensively to mock `@/lib/db`, `@/lib/redis`, and custom hooks. Mocks return structured objects matching Prisma schema shapes to catch type mismatches early.
- **Test Fixtures:** Seed data and test organizations are created programmatically within tests or via `prisma/seed.ts`.

## 🚀 Deployment & DevOps

### Build Process
- `npm run build` triggers Next.js production build, TypeScript compilation (`tsc --noEmit`), and Prisma client generation.
- `serverExternalPackages: ['ioredis']` in `next.config.ts` ensures Redis client is bundled correctly for Edge runtime compatibility.
- Webpack externals configuration prevents `ioredis` from being bundled in Edge middleware bundles.

### Environment Variables
| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string |
| `BETTER_AUTH_SECRET` | Session encryption key (generated via `openssl rand -base64 32`) |
| `PLATFORM_ORG_ID` | ID of the Platform Organization for Super Admin detection (auto-written by seed) |
| `REDIS_URL` | Redis connection string for permission caching (optional, app degrades gracefully) |
| `PII_ENCRYPTION_KEY` | AES-256-GCM key for PII encryption (optional) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuth credentials (optional) |

### Security Measures
- **Pre-Commit Hooks:** `scripts/check-secrets.sh` scans staged files for AWS keys, private key headers, and database passwords. Commits are blocked if secrets are detected.
- **CSP Headers:** Configured in `next.config.ts` to mitigate XSS and data injection attacks (`default-src 'self'`, `frame-ancestors 'none'`, etc.).
- **Secrets Management:** `.env` files are strictly gitignored. Only `.env.example` (with placeholders) is committed.

## 📊 Performance Considerations

### Caching Strategy
- **Permission Cache:** Redis stores permission lists per user (`perm:${userId}:${orgId}`) with a 5-minute TTL. Cache is invalidated on role/permission changes via `invalidateUserCache()`.
- **Session Cache:** BetterAuth's `cookieCache` enables encrypted, signed session cookies that can be validated in Edge runtime without database lookups (maxAge: 5 minutes).
- **Cache Invalidation:** Triggered explicitly when roles, permissions, or memberships change. Middleware prevents caching of protected pages via `Cache-Control: no-store`.

### Database Optimization
- **Connection Pooling:** Managed by Prisma's built-in connection pooler.
- **Query Optimization:** Tenant-scoped queries benefit from indexes on `organizationId`. Super Admin audit log queries use composite indexes for efficient cross-tenant filtering.
- **Prisma Accelerate:** Not currently enabled, but architecture supports future migration to Prisma's global connection pool for multi-region deployments.

## 🔄 Data Flow Diagrams

### User Login Flow
1. User submits credentials → `/api/auth/sign-in/email`
2. BetterAuth validates password hash, creates `Session` record
3. Sets HTTP-only session cookie (`better-auth.session_token`)
4. Session callback resolves permissions (Node.js runtime) or returns lightweight session (Edge runtime)
5. User redirected to dashboard, `AsyncLocalStorage` populated with `organizationId`

### Tenant-Scoped Query Flow
1. Request arrives at API route or Server Component
2. Middleware validates session cookie, sets `Cache-Control` headers
3. Tenant context middleware extracts `organizationId` from session/headers, stores in `AsyncLocalStorage`
4. Prisma extension intercepts query, injects `organizationId` into `where` clause
5. Database executes query with RLS policy as secondary filter
6. Response returned containing only tenant-scoped data

### Permission Resolution Flow
1. User accesses protected resource → `<RequirePermission>` or API route guard
2. `resolvePermissions(userId, orgId)` called
3. Check Redis cache for `perm:${userId}:${orgId}`
4. If miss: Query `Member` → `MemberRole` → `RolePermission` → `Permission` tables
5. Flatten permission keys, store in Redis (TTL: 300s)
6. Return permission list for authorization check

### Health Check Flow
1. Load balancer/monitoring service sends `GET /api/health`
2. Middleware bypasses session validation (public route)
3. Endpoint executes database check (`SELECT 1`) with timeout
4. If Redis configured, endpoint executes cache check (`PING`)
5. Returns JSON response with status, uptime, and individual check results
6. HTTP 200 for healthy/degraded, HTTP 503 for unhealthy

## 🛠️ Development Workflow

### Local Setup
```bash
git clone <repo-url> && cd nipp
nvm use                          # Switch to Node.js 22
npm install                      # Install dependencies
bash scripts/setup-db.sh         # Create PostgreSQL databases
cp .env.example .env             # Configure environment variables
npx prisma generate              # Generate Prisma client
npx prisma db push               # Push schema to database
npm run db:seed                  # Seed admin user & permission catalog
npm run dev                      # Start development server
```

### Running Tests
- `npm test` → Run all unit tests (fast, no running system required)
- `npm run test:watch` → Watch mode for unit tests
- `npm run test:integration` → Run integration & isolation tests (requires PostgreSQL + Redis)
- `npm run test:all` → Execute full test suite
- `npm run test:coverage` → Generate code coverage report

### Database Migrations
- `npm run db:migrate` → Create and apply migration files (recommended for production)
- `npm run db:push` → Push schema changes directly to database (dev only, skips migration files)
- `npm run db:studio` → Open Prisma Studio GUI for visual data inspection

## 📚 Key Design Decisions

### Why Prisma `$extends` over Proxy?
The team evaluated proxy-based query interception but chose Prisma's native `$extends` API for:
- **Type Safety:** Native extension hooks preserve TypeScript types and autocomplete.
- **Maintainability:** Official API with clear lifecycle management, no runtime proxy overhead.
- **Reliability:** Direct integration with Prisma's query engine ensures compatibility across version upgrades.

### Why BetterAuth?
BetterAuth was selected over NextAuth or custom authentication due to:
- **Official Prisma Adapter:** Seamless integration with Prisma 6 without custom adapter maintenance.
- **Organization Plugin:** Built-in multi-tenancy support with `Member`, `Invitation`, and `SentInvitation` models.
- **Edge Runtime Support:** Native support for Edge-compatible session validation via cookie caching.
- **Active Development:** Rapid iteration, strong TypeScript support, and growing ecosystem.

### Why AsyncLocalStorage for Tenant Context?
`AsyncLocalStorage` was chosen over prop drilling or global state because:
- **Automatic Propagation:** Context flows automatically through async call chains without manual passing.
- **Thread Safety:** Each request maintains isolated context, preventing cross-request data leakage.
- **Middleware Integration:** Seamlessly integrates with Next.js middleware and API routes without architectural changes.

## 🏥 Health Check Architecture

The `/api/health` endpoint provides standardized health monitoring for production deployments.

### Design Principles
- **No Authentication Required:** Publicly accessible for load balancers and monitoring services
- **Generic Terminology:** Uses `cache` instead of `redis` to avoid leaking technology stack details
- **Graceful Degradation:** Non-critical checks (Redis) don't cause unhealthy status if unavailable
- **No Sensitive Data:** Response only includes status, latency, and uptime—no connection strings or internal details
- **Edge-Safe:** Excluded from middleware session validation to prevent Prisma Edge Runtime crashes

### Implementation Details
- **Location:** `app/api/health/route.ts`
- **Database Check:** Uses `prisma.$queryRaw`SELECT 1`` with timeout handling
- **Cache Check:** Uses `redis.ping()` with 3-second timeout (gracefully skips if Redis not configured)
- **Status Logic:**
  - `healthy`: All checks pass
  - `degraded`: Non-critical check failed (Redis down, database up)
  - `unhealthy`: Critical check failed (database unreachable) → HTTP 503
- **Response Fields:** `status`, `timestamp`, `version`, `uptime` (from `process.uptime()`), `checks`

### Monitoring Integration
- **Load Balancers:** Configure health check to call `/api/health` every 10-30 seconds
- **Container Orchestrators:** Use as liveness probe (HTTP 200 = running, HTTP 503 = restart)
- **Uptime Monitoring:** External services can verify application availability and dependency health
- **Alerting:** Set up alerts for HTTP 503 responses or degraded status

## 🔮 Future Considerations

### Scalability
- **Horizontal Scaling:** Stateless architecture supports horizontal scaling via load balancers. Session cookies are self-contained (signed/encrypted), eliminating sticky session requirements.
- **Database Sharding:** Architecture supports future sharding by `organizationId` if single-tenant PostgreSQL becomes a bottleneck.
- **CDN Integration:** Static assets and API responses can be cached via CDN with proper `Cache-Control` headers.

### Feature Roadmap
- **Email Notifications:** Nodemailer integration for password reset, invitation emails, and maintenance alerts.
- **Audit Log Enhancements:** Real-time audit log streaming via WebSockets for Super Admin dashboard.
- **Multi-Region Support:** Prisma Accelerate integration for global read replicas and reduced latency.
- **Advanced RBAC:** Dynamic permission evaluation (e.g., `properties:view:own` vs `properties:view:all`) with context-aware middleware.

---

*Last Updated: 13/0-7/26 
*Maintained by: Property NI Development Team*
