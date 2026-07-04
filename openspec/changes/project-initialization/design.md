# Design: Full-Stack Project Initialization

## Technical Approach
The project uses a **unified Next.js 15 application** serving both UI and API from a single origin.
- **Frontend & Backend:** Next.js (App Router) with Route Handlers for API endpoints.
- **Authentication:** BetterAuth via `toNextJsHandler` in `app/api/auth/[...all]/route.ts`.
- **Database:** Prisma ORM with PostgreSQL for both development and production.
- **Multi-Tenancy:** BetterAuth Organization Plugin with defense-in-depth tenant isolation (Prisma Extension + PostgreSQL RLS).
- **Security:** Application-layer AES-256-GCM encryption boilerplate for PII in `lib/crypto.ts`.
- **DevOps:** GitHub for SCM, GitHub Actions for CI/CD, Husky for pre-commit hooks.
- **Testing:** Vitest with BetterAuth test-utils for comprehensive authentication testing.
- **Runtime:** Node.js 22 LTS, Next.js 15, React 19.

## Architecture Decisions

### Decision: Unified Next.js Architecture (Single Origin)
The application will use a single Next.js server to serve both the UI and API from the same origin.
*Why:* For a B2B property management portal with a single development team, the complexity of a decoupled architecture (CORS, cross-origin cookies, two server processes, separate TLS management) is unjustified. A unified architecture:
- Eliminates CORS configuration entirely
- Eliminates cross-origin cookie complexity (same-site cookies work automatically)
- Eliminates the need for `trustedOrigins` configuration
- Eliminates the need for a separate API client boilerplate
- Reduces deployment complexity to a single target
- Simplifies local development to a single `next dev` command
- Provides better caching and performance (same-origin requests)

### Decision: BetterAuth via Next.js Route Handlers
BetterAuth will be integrated using `toNextJsHandler` in `app/api/auth/[...all]/route.ts`.
*Why:* BetterAuth has first-class Next.js support. This approach:
- Removes the need for a separate Express server
- Automatically handles cookies with correct same-site attributes
- Integrates naturally with Next.js middleware for route protection
- Simplifies the deployment model

### Decision: Node.js 22 LTS Runtime
The project will pin to Node.js 22 LTS (Long Term Support) via `.nvmrc` and `package.json` engines field.
*Why:* Node.js 22 LTS is the current stable release supported until April 2027. It provides:
- **Compatibility** — All project dependencies (Next.js 15+, Vitest 4.x, Prisma 6.x, BetterAuth 1.6.x) are tested against Node 22
- **Stability** — LTS releases receive security updates and bug fixes for 30 months
- **Ecosystem Support** — Most npm packages explicitly support Node 22 in their peer dependencies
- **Avoids Odd-Version Issues** — Node 23, 25, etc. are short-term releases often unsupported by packages (e.g., Vitest 4.x requires `^20.0.0 || ^22.0.0 || >=24.0.0`, explicitly excluding Node 23)

### Decision: Next.js 15 with React 19
The project will pin to Next.js 15.x with React 19.x.
*Why:* Next.js 15 provides the stable APIs we depend on:
- **App Router** — Production-ready since Next.js 13, fully stable in 15
- **Route Handlers** — The API we use for BetterAuth integration (`toNextJsHandler`)
- **`middleware.ts`** — Stable API for route protection and organization context
- **`--experimental-https`** — Required for local-prod HTTPS without external proxies
- **Server Components** — Default rendering model in Next.js 15

Next.js 15 requires React 19, so both must be pinned together. Minor/patch updates are allowed via caret ranges (`^15.x.x`, `^19.x.x`) to receive security patches without breaking changes.

Major version upgrades (e.g., Next.js 16) will be treated as separate OpenSpec proposals due to the potential for breaking changes.

### Decision: Vitest 4.x Version Pinning
The project will pin to Vitest 4.x to ensure compatibility with BetterAuth test-utils and Node.js 22 LTS.
*Why:* Vitest 4.x is required by `@better-auth/test-utils@1.6.23`, which we use for comprehensive authentication testing. The version pinning ensures:
- **Compatibility** — Vitest 4.x works with Node.js 22 LTS (requires `^20.0.0 || ^22.0.0 || >=24.0.0`)
- **No Peer Dependency Conflicts** — Explicit version prevents npm from installing incompatible versions
- **Stable Testing APIs** — Vitest 4.x provides stable APIs compatible with Next.js 15
- **Predictable Upgrades** — Minor/patch updates allowed via caret range; major version upgrades require a new OpenSpec proposal

This follows the same versioning discipline as Node.js 22 LTS and Next.js 15, ensuring consistency across the technology stack.

### Decision: Local PostgreSQL Installation for Development
The project will require developers to have PostgreSQL installed locally, rather than using Docker containers for the database.
*Why:* This decision was made to:
- Simplify the development setup by removing the Docker dependency
- Allow developers to use their preferred PostgreSQL management tools (pgAdmin, TablePlus, etc.)
- Reduce resource overhead from running Docker containers
- Align with production environments where PostgreSQL runs as a native service

Developers must install PostgreSQL 16+ locally and configure the `DATABASE_URL` environment variable to connect to their local instance. This approach trades the reproducibility of Docker for simplicity and lower resource usage.

### Decision: Secrets Management & Git Protection Strategy
The project will implement a comprehensive strategy to prevent secrets from being committed to GitHub, using multiple layers of protection.
*Why:* Secrets (database passwords, API keys, encryption keys, TLS certificates) must never be committed to version control. A single leaked secret can compromise the entire application. We implement defense-in-depth for secrets protection:

**Layer 1: .gitignore Configuration**
- Comprehensive `.gitignore` excludes all files that may contain secrets:
  - `.env`, `.env.local`, `.env.local-prod` (environment variables with real values)
  - `certs/` directory (TLS certificates and private keys)
  - `*.pem`, `*.key` (certificate and key files anywhere in the project)
  - Database files (`*.db`, `*.db-journal`)
  - Build outputs (`.next/`, `dist/`, `node_modules/`)
  - OS files (`.DS_Store`, `Thumbs.db`)
- Only example files (`.env.example`, `.env.local-prod.example`) with placeholder values are committed

**Layer 2: Pre-Commit Secret Detection**
- A pre-commit hook scans staged files for patterns that look like secrets:
  - High-entropy strings (potential API keys)
  - Private key headers (`-----BEGIN PRIVATE KEY-----`)
  - Common secret patterns (AWS keys, database connection strings with passwords)
- If a potential secret is detected, the commit is blocked with a clear error message

**Layer 3: Example Files for Reference**
- `.env.example` contains all required environment variables with placeholder values
- `.env.local-prod.example` contains production-like configuration with placeholders
- Developers copy these files to create their local `.env` files
- Example files are safe to commit because they contain no real secrets

**Layer 4: Documentation**
- README clearly documents which files contain secrets and must not be committed
- Setup instructions guide developers through creating their local `.env` files
- Secrets management strategy is explained for new team members

This multi-layered approach ensures that even if one layer fails (e.g., a developer accidentally adds a secret file), the other layers catch it before it reaches GitHub.

### Decision: Prisma ORM (Despite RLS Awkwardness)
The project will use Prisma ORM for database access, despite Drizzle ORM offering cleaner RLS integration.
*Why:* We evaluated three TypeScript ORMs with official BetterAuth adapters: Prisma, Drizzle, and Kysely. The evaluation found:

- **Drizzle** has the cleanest RLS integration (SQL-like API, natural session variable handling)
- **Prisma** has the largest ecosystem, best documentation, and most mature tooling
- **Kysely** is a query builder (not a full ORM), requiring more manual work

We chose Prisma because:
1. A comprehensive spec already exists using Prisma
2. The RLS awkwardness is contained to `lib/tenant-db.ts` (~100 lines, write once)
3. Prisma's superior docs and ecosystem reduce long-term maintenance burden
4. The cost of switching (rewriting spec + learning curve) outweighs the benefit

The tenant-scoped Prisma extension we designed handles RLS complexity cleanly. If RLS integration becomes a significant pain point during implementation, a future proposal could evaluate migrating to Drizzle, but this would be a substantial architectural change.

### Decision: organizationId as Tenant Isolation Foundation
Every organization-scoped database model MUST include a non-optional `organizationId` field with a foreign key to the `Organization` table and an index for performance.
*Why:* The `organizationId` field is the single column upon which the entire tenant isolation strategy depends:

- **Prisma Extension (Layer 1)** injects `where: { organizationId: <currentOrgId> }` into every query. Without the field, the query fails at runtime.
- **PostgreSQL RLS (Layer 2)** filters rows using `WHERE "organizationId" = current_setting('app.current_org_id')`. Without the column, the policy cannot be created.

This means a missing `organizationId` on any organization-scoped model breaks BOTH layers of defense-in-depth simultaneously, creating a critical data leak vulnerability.

To prevent this:
1. Every organization-scoped model MUST have `organizationId String` (non-optional)
2. Every organization-scoped model MUST have a foreign key relation to `Organization` with `onDelete: Cascade`
3. Every organization-scoped model MUST have `@@index([organizationId])` for query performance
4. PR reviews MUST verify these requirements for every new or modified model
5. The Prisma schema MUST be treated as a security artifact, not just a data model

Models that are explicitly exempt (User, Session, Account, Organization, Member, Invitation) are global by design and documented in the spec.

### Decision: Property NI Design System Configuration
The UI configuration will strictly adhere to the provided Property NI Design Specification (Navy & Amber). 
*Why:* To ensure brand consistency, accessibility (WCAG AA), and a modern, professional look. We will map the design tokens to CSS Custom Properties in `globals.css` and extend the Tailwind configuration to use these semantic tokens.

### Decision: BetterAuth for Unified Authentication
BetterAuth will manage both traditional local credentials and OIDC social logins. 
*Why:* It provides built-in, secure plugins for email/password authentication (Argon2id hashing) and OIDC flows, integrating seamlessly with our Prisma adapter. BetterAuth is self-hosted and runs entirely within our Next.js server process — no external auth service dependencies.

### Decision: Native Next.js HTTPS for Local Production
For local production, we will use Next.js's `--experimental-https` flag or a custom HTTPS server wrapper.
*Why:* This satisfies the requirement for HTTPS in production-like environments without introducing external infrastructure dependencies like Nginx. For cloud deployment, TLS is typically terminated at the edge (by the cloud provider or CDN).

### Decision: Next.js Middleware for Route Protection
Next.js middleware (`middleware.ts`) will be used for route protection and organization context.
*Why:* Next.js middleware runs at the edge (or Node.js runtime) and can:
- Protect routes before they're rendered
- Redirect unauthenticated users to login
- Set organization context in cookies/headers
- Enforce role-based access at the routing level

This integrates naturally with the unified architecture.

### Decision: Zod for Input Validation & Environment Validation
Zod will be used for both runtime input validation and environment variable validation.
*Why:* Zod provides type-safe runtime validation that integrates seamlessly with TypeScript. Using it for both API inputs and environment variables ensures consistency and catches misconfigurations at startup (fail-fast).

### Decision: Pino for Structured Logging
Pino will be used as the structured logging library.
*Why:* Pino is fast, low-overhead, and outputs JSON by default, which integrates well with modern log aggregation systems (Datadog, CloudWatch, ELK). It supports log levels per environment and prevents PII leakage via redaction rules.

### Decision: Pre-Commit Hooks via Husky
Husky + lint-staged will enforce code quality before commits.
*Why:* Shifting quality checks left (to commit time rather than CI time) provides faster feedback to developers and prevents broken code from entering the repository.

### Decision: Multi-Tenancy via BetterAuth Organization Plugin
Instead of building custom multi-tenancy logic, we will use BetterAuth's Organization plugin.
*Why:* The Organization plugin provides production-ready multi-tenancy with:
- Organization (tenant) CRUD operations
- Member management with organization-scoped roles
- Invitation system for adding users to organizations
- Multi-organization support for users (users can belong to multiple organizations)
- Built-in authorization checks for organization-scoped resources
- Organization switching in the UI

This eliminates months of custom development and provides a proven, tested solution that integrates seamlessly with BetterAuth's authentication system.

### Decision: Organization-Scoped Roles and Permissions
Roles and permissions will be scoped to organizations using the Organization plugin's role system.
*Why:* Different organizations (property management companies, landlords, housing associations) may have different organizational structures. The Organization plugin allows us to:
- Define role templates (property owner, property manager, letting agent, contractor, tenant, accountant)
- Allow organizations to customize roles and permissions
- Support role hierarchies with permission inheritance
- Scope all data access to the user's current organization

### Decision: Tenant Data Isolation via Defense-in-Depth
The application will enforce tenant isolation at two independent layers: the application layer (Prisma Extension) and the database layer (PostgreSQL RLS).
*Why:* Tenant isolation is the single most important security property of a multi-tenant system. A single bug that leaks tenant A's data to tenant B is a catastrophic failure — legally, reputationally, and potentially under GDPR/CCPA given the handling of sensitive PII like passport numbers.

A single layer of defense is insufficient because:
- **Application-layer only** relies on correct implementation — a missed middleware registration or a raw SQL query bypasses it entirely
- **Database-layer only** (RLS) is awkward with Prisma's connection pooling and session variable management

By combining both layers:
- The **Prisma Extension** provides developer ergonomics — automatic query scoping, type safety, easy testing
- **PostgreSQL RLS** provides an un-bypassable safety net — protects against raw SQL leaks, middleware bugs, and direct database access
- A failure in one layer does not result in data leakage because the other layer still enforces isolation

This defense-in-depth approach is industry best practice for multi-tenant SaaS applications handling sensitive data.

### Decision: AsyncLocalStorage for Tenant Context
The application will use Node.js `AsyncLocalStorage` to propagate the current organization ID through the request lifecycle.
*Why:* AsyncLocalStorage provides a clean way to associate request-scoped data (the current organization ID) with all downstream operations without passing it explicitly through every function call. This:
- Eliminates the risk of developers forgetting to pass the org ID
- Works naturally with Next.js Server Components and Route Handlers
- Integrates cleanly with the Prisma Extension (which reads the org ID from AsyncLocalStorage)
- Is the idiomatic Node.js pattern for request-scoped context

### Decision: ESLint Rule to Prevent Direct Prisma Usage
An ESLint rule will prevent direct imports of the unscoped `prisma` client from `lib/db.ts` in business logic files.
*Why:* The tenant-scoped Prisma client (`lib/tenant-db.ts`) is the only safe way to query organization-scoped data. Direct usage of the unscoped client bypasses all application-layer tenant isolation. An ESLint rule enforces this discipline at commit time, preventing accidental data leaks before they reach production.

### Decision: RLS as Safety Net, Not Primary Defense
PostgreSQL RLS will be used as a safety net, with the Prisma Extension as the primary defense.
*Why:* While RLS provides the strongest guarantee (it cannot be bypassed by application bugs), it has practical drawbacks with Prisma:
- Connection pooling complicates session variable management
- Requires raw SQL for session setup on every request
- Harder to debug and test
- Migration complexity

By using RLS as a safety net rather than the primary mechanism:
- Developers get a clean, type-safe API via the Prisma Extension
- The database still provides an un-bypassable backstop
- The complexity of RLS is contained to migration files and the tenant-scoped client wrapper

### Decision: Admin Dashboard Scaffolding via BetterAuth Admin Plugin
The project will scaffold an admin dashboard directory structure (`app/admin/`) that leverages BetterAuth's admin plugin APIs for user management, session management, and role assignment.
*Why:* BetterAuth provides a powerful admin plugin with APIs for listing users, banning/unbanning, managing sessions, and impersonating users. By scaffolding the directory structure now, we create a clear boundary between the admin interface and the public-facing portal, making it straightforward to implement the actual admin UI in a future phase.

### Decision: Organization Management Scaffolding
The project will scaffold an organization management directory structure (`app/organizations/`) for managing organizations, members, and invitations.
*Why:* The Organization plugin provides the backend APIs, but we need a UI for:
- Creating and managing organizations
- Inviting users to organizations
- Managing organization members and their roles
- Switching between organizations

By scaffolding this directory structure now, we prepare for future UI implementation while keeping the initialization phase focused on configuration and scaffolding.

### Decision: Role-Specific User Dashboards
The project will scaffold separate user dashboard directory structures (`app/dashboard/`) for each major role in the property management industry (property owner, property manager, letting agent, maintenance staff, tenant, accountant, contractor).
*Why:* Different organizational roles in property management have vastly different needs:
- **Property Owners** need financial overviews and property portfolios
- **Property Managers** need day-to-day operations, maintenance, and tenant management
- **Letting Agents** need viewings, applications, and contracts
- **Maintenance Staff** need work orders and property access
- **Tenants** need maintenance requests, payments, and documents
- **Accountants** need financial reports and invoice management
- **Contractors** need quoting, job scheduling, work orders, site access, and invoicing

By scaffolding role-specific dashboard directories now, we establish a clear organizational structure that can be populated with role-appropriate UI components in future phases. Each dashboard will share the Property NI design system but present different functionality based on the user's assigned role.

### Decision: Custom Roles for Organizational Structures
The project will scaffold a custom roles configuration system (`lib/roles/`) that allows different organizations (tenants) to define their own role hierarchies and permission sets.
*Why:* The property management industry has diverse organizational structures:
- A small landlord may only need: Owner → Property Manager → Tenant
- A large agency may need: Director → Regional Manager → Property Manager → Letting Agent → Maintenance Staff → Tenant → Contractor
- A housing association may need: Board Member → Operations Manager → Estate Manager → Maintenance Team → Tenant

By scaffolding the role configuration system now, we enable future implementations to:
1. Define industry-standard role templates (property management, letting, maintenance, contracting)
2. Allow organizations to customize roles and permissions
3. Support role hierarchies with permission inheritance
4. Scope roles to specific tenants (multi-tenancy support)

### Decision: BetterAuth Plugins for Dashboard Management
The project will configure BetterAuth with multiple plugins to support dashboard functionality:
- **Admin Plugin:** For user management, session management, and role assignment
- **Organization Plugin:** For multi-tenant organization management (NOW IN SCOPE)
- **test-utils Plugin:** For comprehensive authentication testing
- **Two-Factor Plugin (future):** For enhanced security on admin dashboards
*Why:* BetterAuth's plugin architecture allows us to progressively add functionality as needed. Starting with the admin and organization plugins provides immediate value for user and organization management, while the plugin architecture ensures we can add 2FA without architectural changes.

### Decision: "UI/UX & Security First" Phased Approach
The initialization phase will focus exclusively on establishing the Property NI design system and security foundations before any property management business features are implemented.
*Why:* By pinning down the look and feel (Navy & Amber design system, split-screen layouts, pill-shaped components) and security (authentication, authorization, encryption, tenant isolation, operational resilience) from day 1, we ensure that:
1. **Consistency** — All future property management features will inherit the established design system, preventing UI/UX drift.
2. **Security by Default** — Every feature built on top of this foundation will automatically benefit from the established security patterns (encryption, rate limiting, CSP, tenant isolation, etc.).
3. **Reduced Rework** — Avoids the common pitfall of bolting security onto features later, which often leads to gaps and refactoring.
4. **Clear Boundaries** — Developers know exactly what the "platform" provides vs. what they need to build for specific features.

This approach treats the initialization phase as building a **secure, branded platform** that property management features will be built upon in subsequent phases.

### Decision: Minimal Authentication Surface for Initialization
The initialization phase will implement only the essential authentication features:
- ✅ Email/password local authentication
- ✅ Google OIDC social login (single provider)
- ✅ Organization-based multi-tenancy
- ✅ Admin plugin for user management
- ✅ test-utils for testing

Deferred to future phases:
- ❌ 2FA, Magic Link, Email OTP, Bearer tokens, Multi-Session, SSO, JWT, Stripe, SAML SSO
- ❌ Additional social providers (GitHub, Microsoft, Apple, etc.)
- ❌ Email verification
- ❌ Password reset flow

*Why:* This keeps the initialization phase focused and achievable while establishing a solid foundation. The BetterAuth plugin architecture allows us to progressively add authentication features without architectural changes. Each deferred feature will be implemented in its own OpenSpec proposal when the business requirements demand it.

## Configuration & Scaffolding Deliverables
*Note: Per the Execution Boundary, no application logic or UI components will be written. Deliverables are strictly configuration, boilerplate, and empty scaffolding.*
- `package.json`, `tsconfig.json`, `tailwind.config.ts`, `app/globals.css`, `next.config.ts` (Configuration)
- `app/`, `components/`, `lib/`, `prisma/` (Empty Directory Scaffolding)
- `app/api/auth/[...all]/route.ts` (BetterAuth Route Handler boilerplate)
- `middleware.ts` (Next.js middleware for route protection and tenant context)
- `lib/db.ts`, `lib/auth.ts`, `lib/crypto.ts`, `lib/logger.ts`, `lib/env.ts`, `lib/organization.ts`, `lib/tenant-db.ts`, `lib/tenant-context.ts`, `lib/audit.ts`, `lib/validate-schema.ts` (Library initialization boilerplate)
- `lib/schemas/` (Shared Zod validation schema directory)
- `lib/roles/` (Custom role configuration scaffolding)
- `lib/permissions/` (Permission definition scaffolding)
- `app/admin/` (Admin dashboard scaffolding)
- `app/organizations/` (Organization management scaffolding)
- `app/dashboard/` (Role-specific user dashboard scaffolding, including contractor)
- `tests/` (Test directory with utils, fixtures, and setup)
- `tests/isolation/` (Tenant isolation test scaffolding)
- `prisma/migrations/0000_enable_rls/` (RLS template migration)
- `app/error.tsx`, `app/global-error.tsx` (Next.js error boundary scaffolding)
- `prisma/schema.prisma`, `.env.example`, `.env.local-prod.example` (Database & Environment Configuration)
- `.gitignore` (Comprehensive exclusion rules for secrets)
- `.nvmrc`, `.husky/`, `.lintstagedrc` (Tooling configuration)
- `certs/`, `scripts/`, `.github/workflows/` (DevOps & Security Scaffolding)