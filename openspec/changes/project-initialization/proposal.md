# Proposal: Full-Stack Project Initialization

## Intent
Initialize a new full-stack web application for the **Property NI Multi-Tenant Portal** with a **"UI/UX & Security First"** approach. The primary goal of this initialization phase is to establish:
1. **The Property NI Navy & Amber design system** — Pinning down the web UI look and feel from day 1
2. **Robust security foundations** — Authentication, authorization, encryption, tenant isolation, and operational resilience
3. **Multi-tenancy architecture** — Via BetterAuth Organization Plugin with defense-in-depth tenant isolation
4. **Development infrastructure** — Build targets, testing, CI/CD, and tooling
5. **Stable runtime environment** — Node.js 22 LTS, Next.js 15, React 19 for compatibility and long-term support

Property management business features will be built on top of this solid foundation in subsequent phases.

---

## ⏳ Deferred Items Registry (Future OpenSpec Proposals)

The following items are explicitly deferred from this initialization phase but are **actively tracked** for future implementation. Each item will be addressed in its own OpenSpec proposal when business requirements demand it.

### Deferred BetterAuth Plugins & Authentication Features (13 items)

| # | Feature | Documentation | Use Case | Priority |
| :--- | :--- | :--- | :--- | :--- |
| 1 | **Two-Factor Authentication (2FA)** | [better-auth.com/docs/plugins/2fa](https://better-auth.com/docs/plugins/2fa) | Enhanced security for admin/owner accounts | 🔴 High |
| 2 | **Email Verification** | N/A | Verify email addresses during registration | 🔴 High |
| 3 | **Password Reset Flow** | N/A | Forgot password functionality with secure tokens | 🔴 High |
| 4 | **API Key Plugin** | [better-auth.com/docs/plugins/api-key](https://better-auth.com/docs/plugins/api-key) | Programmatic API access for integrations | 🟡 Medium |
| 5 | **Bearer Token** | [better-auth.com/docs/plugins/bearer](https://better-auth.com/docs/plugins/bearer) | Bearer token auth for API clients | 🟡 Medium |
| 6 | **SSO (Single Sign-On)** | [better-auth.com/docs/plugins/sso](https://better-auth.com/docs/plugins/sso) | Enterprise SSO integration | 🟡 Medium |
| 7 | **JWT** | [better-auth.com/docs/plugins/jwt](https://better-auth.com/docs/plugins/jwt) | JWT token support for stateless auth | 🟡 Medium |
| 8 | **Stripe** | [better-auth.com/docs/plugins/stripe](https://better-auth.com/docs/plugins/stripe) | Subscription-based billing integration | 🟡 Medium |
| 9 | **SAML SSO with Okta** | [better-auth.com/docs/guides/saml-sso-with-okta](https://better-auth.com/docs/guides/saml-sso-with-okta) | Enterprise SAML SSO via Okta | 🟡 Medium |
| 10 | **Magic Link** | [better-auth.com/docs/plugins/magic-link](https://better-auth.com/docs/plugins/magic-link) | Passwordless email-based login | 🟢 Low |
| 11 | **Email OTP** | [better-auth.com/docs/plugins/email-otp](https://better-auth.com/docs/plugins/email-otp) | One-time password via email | 🟢 Low |
| 12 | **Multi-Session** | [better-auth.com/docs/plugins/multi-session](https://better-auth.com/docs/plugins/multi-session) | Multiple concurrent sessions per user | 🟢 Low |
| 13 | **Additional Social Providers** | N/A | GitHub, Microsoft, Apple, etc. (beyond Google) | 🟢 Low |

### Deferred Property Management Features (8 items)

| # | Feature | Description | Priority |
| :--- | :--- | :--- | :--- |
| 1 | **Contractor Role & Dashboard** | Quoting, scheduling, work orders, site access, invoicing | 🔴 High |
| 2 | **Property Management Business Logic** | Core property, tenant, maintenance, financial features | 🔴 High |
| 3 | **File Upload & Storage** | Property images, passport scans, documents, contractor quotes | 🟡 Medium |
| 4 | **Performance Monitoring & Error Tracking** | APM and error tracking | 🟡 Medium |
| 5 | **API Versioning** | URL-based or header-based versioning | 🟢 Low |
| 6 | **API Documentation** | OpenAPI/Swagger specification | 🟢 Low |
| 7 | **Database Seeding** | Test data for local development | 🟢 Low |
| 8 | **Docker / Containerization** | Dockerfiles and docker-compose | 🟢 Low |

### Tracking Rules

- **Priority levels:** 🔴 High (needed within 3 months) | 🟡 Medium (needed within 6 months) | 🟢 Low (backlog)
- **Promotion to active:** When a deferred item is promoted to active development, a new OpenSpec proposal MUST be created
- **Review cadence:** Deferred items MUST be reviewed at the start of each sprint to assess priority changes
- **Dependency tracking:** If a deferred item becomes a prerequisite for an active feature, it MUST be promoted immediately
- **Status tracking:** See `tasks.md` section 18 for per-item status indicators (📋 Planned | 🔍 Researching | 📝 Proposal Drafted | ✅ Promoted to Active)

---

## Scope
**In scope:**
- **Unified Next.js 15 application** (App Router) serving both UI and API from a single origin. Version pinned to Next.js 15.x with React 19.x for API stability and BetterAuth compatibility.
- **BetterAuth API Routes** via `toNextJsHandler` in `app/api/auth/[...all]/route.ts` — no separate Express server.
- Transport Security: Native Next.js development server for local development, and `next dev --experimental-https` (or custom HTTPS server) for production/local-prod environments.
- **Property NI Design System:** Configuration of the Navy & Amber design tokens, Inter typography, pill-shaped components, and the 50/50 split-screen login layout structure.
- Prisma ORM configuration with PostgreSQL for both development and production.
- **Node.js 22 LTS** — Pinned via `.nvmrc` and `package.json` engines field for compatibility and stability.
- **Local PostgreSQL Installation** — Developers must have PostgreSQL installed locally for development. No Docker containerization for the database.
- **Secrets Management & Git Protection:**
  - Comprehensive `.gitignore` configuration to exclude all files containing secrets
  - Example environment files (`.env.example`, `.env.local-prod.example`) with placeholder values for reference
  - Pre-commit hook to detect and prevent accidental commits of secrets
  - Documentation of secrets management strategy in README
- **Tenant Data Isolation (Defense-in-Depth):**
  - **Prisma Extension** (`lib/tenant-db.ts`) that automatically scopes all queries to the current organization
  - **AsyncLocalStorage-based tenant context** (`lib/tenant-context.ts`) for propagating org ID through the request lifecycle
  - **PostgreSQL Row Level Security (RLS)** template migration as a safety net against application-layer failures
  - **Tenant context middleware** in Next.js `middleware.ts` to establish org context per request
  - **ESLint rule** preventing direct imports of the unscoped `prisma` client in business logic
  - **Tenant isolation test scaffolding** (`tests/isolation/`) with templates for application-layer and database-layer isolation tests
  - **Audit logging boilerplate** (`lib/audit.ts`) for cross-tenant access attempts
- Authentication & Authorization:
  - OpenID Connect (OIDC) restricted to **Google social login only** (no other social providers in this phase).
  - Local user registration and login (email/password) utilizing the backend database.
  - **No email verification in this phase** (deferred to future proposal).
  - Secure storage of local credentials (cryptographic hashing for passwords, encryption for sensitive PII).
  - **Same-origin cookies** — no cross-origin cookie complexity.
  - **BetterAuth Organization Plugin for multi-tenancy with organization-scoped roles and permissions.**
  - **BetterAuth Admin Plugin configuration scaffolding for user and session management.**
  - **BetterAuth test-utils plugin for comprehensive authentication testing.**
  - **Custom roles scaffolding to support property management industry organizational structures, including the Contractor role.**
  - **Admin dashboard directory structure scaffolding for future UI implementation.**
  - **Role-specific user dashboard directory structure scaffolding, including Contractor dashboard.**
  - **Organization management directory structure scaffolding.**
- **Next.js Middleware** (`middleware.ts`) for route protection and organization context.
- BetterAuth integration for managing sessions, OIDC flows, local credentials, organization membership, and authorization.
- Vitest configuration for unit testing.
- GitHub for source code management (SCM) and GitHub Actions for CI/CD pipelines.
- npm as the exclusive package management tool.
- Three distinct build/execution targets: Local Developer, Local Production, and Cloud Deployment.
- **Operational Resilience:**
  - Input validation strategy using Zod (shared schemas).
  - Global error handling (Next.js error boundaries and API error helpers).
  - Environment variable validation at application startup.
  - Structured logging via Pino.
  - Rate limiting on authentication endpoints (via Next.js middleware or BetterAuth config).
  - Pre-commit hooks via Husky and lint-staged.
  - Dependency security auditing in CI.
  - Content Security Policy (CSP) headers via Next.js config.

**Out of scope:**
- Implementation of specific business logic, page implementations, or route handlers.
- Creation of actual UI components or visual assets (including admin/user dashboard UIs).
- Cloud provider infrastructure provisioning.
- **Committing any files containing real secrets, passwords, API keys, or certificates to GitHub.**
- **Implementation of admin dashboard UI (scaffolding only in this phase).**
- **Implementation of user dashboard UIs (scaffolding only in this phase).**
- **Implementation of organization management UI (scaffolding only in this phase).**
- **Implementation of custom role management UI (configuration scaffolding only).**
- **Implementation of Contractor role functionality (scaffolding only in this phase; full development deferred to future OpenSpec proposal).**
- **Implementation of property management business features (deferred to future phases).**
- **Implementation of RLS policies for business tables (scaffolding only; actual policies added when tables are created in future proposals).**

### ORM Evaluation (Out of Scope for This Phase)

During the design phase, we evaluated alternative TypeScript ORMs to determine if any would provide a simpler integration with PostgreSQL Row Level Security (RLS) for tenant isolation. The evaluation focused on ORMs with official BetterAuth adapters:

**Evaluated ORMs:**

| ORM | RLS Integration | BetterAuth Adapter | Ecosystem | Decision |
| :--- | :--- | :--- | :--- | :--- |
| **Prisma** (selected) | ⚠️ Awkward (requires transaction + raw SQL for session variables) | ✅ Official, mature | ✅ Largest community, best docs | **Selected** |
| **Drizzle** | ✅ Natural (SQL-like API, RLS feels native) | ✅ Official, mature | ⚠️ Growing but smaller | Rejected |
| **Kysely** | ✅ Trivial (query builder, not full ORM) | ✅ Official | ⚠️ Smaller, more manual | Rejected |

**Key Findings:**

1. **Drizzle would be simpler for RLS integration** — The tenant-scoped wrapper would be ~30 lines vs ~100 lines in Prisma, and RLS session variables integrate naturally rather than requiring workarounds.

2. **Prisma has superior ecosystem** — Best-in-class documentation, `prisma studio` for visual DB browsing, massive community, every question answered on StackOverflow.

3. **BetterAuth adapters are equally good** — Both Prisma and Drizzle have first-class BetterAuth support with no meaningful difference in integration quality.

4. **Type safety is equivalent** — Both provide excellent TypeScript type safety, just with different APIs (Prisma's generated types vs Drizzle's inferred types).

**Decision Rationale:**

We chose to **stay with Prisma** despite the RLS awkwardness because:

- ✅ A comprehensive, well-designed spec already exists using Prisma
- ✅ The RLS awkwardness is contained to ~100 lines in `lib/tenant-db.ts` (write once, never touch again)
- ✅ Prisma's superior docs and ecosystem reduce long-term maintenance burden
- ✅ The cost of switching (rewriting spec + learning curve + smaller ecosystem) outweighs the benefit (cleaner RLS integration)
- ✅ The tenant-scoped Prisma extension we designed handles the RLS complexity cleanly

**Future Reconsideration:**

If RLS integration becomes a significant pain point during implementation (e.g., performance issues, debugging complexity), a future OpenSpec proposal could evaluate migrating to Drizzle. However, this would be a substantial architectural change requiring:

- Rewriting all database access patterns
- Migrating from Prisma Migrate to drizzle-kit
- Re-verifying BetterAuth Drizzle adapter integration
- Retraining the team on Drizzle's API

For now, Prisma is the right choice given the comprehensive spec and the contained nature of the RLS complexity.

## Execution Boundary & Deliverables
**CRITICAL CONSTRAINT:** This OpenSpec proposal will **NOT** generate or create any application code files containing business logic, page implementations, UI components, or route handlers. 

The scope of execution is strictly limited to project initialization, configuration, and scaffolding:
1. **Configuration Files:** Creating and updating configuration files (e.g., `package.json`, `tsconfig.json`, `tailwind.config.ts`, `globals.css`, `prisma/schema.prisma`, `next.config.ts`, `.env.example`).
2. **Library Initialization Files:** Creating the foundational setup files required to initialize core libraries (e.g., `lib/db.ts`, `lib/auth.ts`, `lib/crypto.ts`, `lib/logger.ts`, `lib/env.ts`, `lib/organization.ts`, `lib/tenant-db.ts`, `lib/tenant-context.ts`, `lib/audit.ts`). *These files will contain only the minimal boilerplate required to connect to the database and initialize BetterAuth.*
3. **Dependency Installation:** Installing all required project libraries and developer tools via `npm install`.
4. **Build & Generation Commands:** Executing developer tools to generate necessary files (e.g., `prisma generate`, `npx shadcn-ui@latest init`).
5. **Directory Scaffolding:** Creating the empty project directory structure and scaffolding as defined in the proposal (e.g., `app/`, `app/api/`, `lib/`, `components/`, `app/admin/`, `app/dashboard/`, `app/organizations/`, `tests/`, `tests/isolation/`).

## Approach
Initialize a standard Next.js 15 application managed via npm, using the App Router to serve both UI and API from a single origin. Configure BetterAuth to handle both the Google OIDC flow and local email/password authentication using Next.js Route Handlers via `toNextJsHandler`. The frontend will be configured using Tailwind CSS with the Property NI Navy & Amber design tokens. All code will be hosted on GitHub. Operational resilience patterns (logging, error handling, rate limiting) will be established via boilerplate configuration. Admin, organization management, and role-specific user dashboard directory structures will be scaffolded for future implementation. Tenant data isolation will be enforced via defense-in-depth (Prisma Extension + PostgreSQL RLS).