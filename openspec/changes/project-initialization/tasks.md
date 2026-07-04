# Tasks

## 1. Project Initialization & Structure
- [ ] 1.1 Initialize a new Next.js 15 application with TypeScript, App Router, and Tailwind CSS using `npm`.
      - Install `next@^15`, `react@^19`, `react-dom@^19` explicitly
      - Install matching types: `@types/react@^19`, `@types/react-dom@^19`
      - Install `vitest@^4.1.5` explicitly (required by @better-auth/test-utils)
- [ ] 1.2 Scaffold the standard frontend directories: `app/`, `components/`, `public/`, `styles/` (or `app/globals.css`).
- [ ] 1.3 Scaffold shared library directory: `lib/`, `lib/schemas/`, `lib/roles/`, `lib/permissions/`.
- [ ] 1.4 Scaffold API routes directory: `app/api/`.
- [ ] 1.5 Configure root TypeScript settings (`tsconfig.json`) with strict mode.
- [ ] 1.6 Initialize Git and push to a new GitHub remote.
- [ ] 1.7 Create `.nvmrc` file with content `22` to pin to Node.js 22 LTS.
- [ ] 1.8 Add `engines` field to `package.json`: `"engines": { "node": ">=22.0.0 <23.0.0" }` to enforce Node 22 LTS and reject Node 23 or other versions.
- [ ] 1.9 Verify Next.js, React, and Vitest versions in `package.json`:
      - `"next": "^15.x.x"`
      - `"react": "^19.x.x"`
      - `"react-dom": "^19.x.x"`
      - `"vitest": "^4.1.5"`

## 2. Next.js Configuration & HTTPS Setup
- [ ] 2.1 Configure `next.config.ts` with:
      - Content Security Policy (CSP) headers
      - Environment-specific settings
      - Image domains and optimization settings
- [ ] 2.2 Install `pino` and `pino-pretty` for structured logging.
- [ ] 2.3 Install `helmet`-equivalent security headers via Next.js config (or use Next.js middleware for CSP).
- [ ] 2.4 Configure local-prod HTTPS via `next dev --experimental-https` or custom HTTPS server wrapper.
- [ ] 2.5 Generate self-signed TLS certificates for the `certs/` directory to support Local Prod HTTPS.

## 2A. Secrets Management & Git Protection
- [ ] 2A.1 Create comprehensive `.gitignore` file with the following entries:
      - Environment files: `.env`, `.env.local`, `.env.local-prod`, `.env.*.local`
      - Certificate files: `certs/`, `*.pem`, `*.key`, `*.crt`, `*.p12`
      - Database files: `*.db`, `*.db-journal`, `prisma/dev.db*`
      - Build outputs: `.next/`, `dist/`, `out/`, `build/`
      - Dependencies: `node_modules/`
      - Test coverage: `coverage/`
      - Logs: `*.log`, `npm-debug.log*`, `yarn-debug.log*`, `yarn-error.log*`
      - OS files: `.DS_Store`, `Thumbs.db`, `.idea/`, `.vscode/` (except recommended settings)
      - IDE files: `*.swp`, `*.swo`, `*~`
      - Misc: `.turbo/`, `.vercel/`, `.env.test`
- [ ] 2A.2 Create `.env.example` with all required environment variables using placeholder values:
      - `DATABASE_URL="postgresql://user:password@localhost:5432/nipp_dev"`
      - `BETTER_AUTH_SECRET="your-super-secret-key-change-in-production"`
      - `GOOGLE_CLIENT_ID="your-google-client-id"`
      - `GOOGLE_CLIENT_SECRET="your-google-client-secret"`
      - `PII_ENCRYPTION_KEY="your-32-character-aes-256-key-here"`
      - `LOG_LEVEL="debug"`
      - `FRONTEND_URL="http://localhost:3000"`
      - `NEXT_PUBLIC_API_URL="http://localhost:8000"`
- [ ] 2A.3 Create `.env.local-prod.example` with production-like configuration using placeholder values.
- [ ] 2A.4 Create `scripts/check-secrets.sh` pre-commit hook script that:
      - Scans staged files for potential secrets using pattern matching
      - Detects private key headers (`-----BEGIN PRIVATE KEY-----`, `-----BEGIN RSA PRIVATE KEY-----`)
      - Detects high-entropy strings (potential API keys)
      - Detects common secret patterns (AWS access keys, database URLs with passwords)
      - Blocks the commit if potential secrets are found
      - Provides clear error messages explaining what was detected
- [ ] 2A.5 Configure Husky pre-commit hook to run `scripts/check-secrets.sh` before allowing commits.
- [ ] 2A.6 Add `scripts/check-secrets.sh` to `.gitignore` exceptions (it should be committed).
- [ ] 2A.7 Verify `.gitignore` is working by attempting to commit a test `.env` file (should be blocked).
- [ ] 2A.8 Document secrets management strategy in README.md:
      - List of files that must never be committed
      - How to create local `.env` files from examples
      - How the pre-commit hook works
      - What to do if a secret is accidentally committed

## 3. Build Targets & NPM Scripts Configuration
- [ ] 3.1 Update `package.json` scripts:
      - `dev`: Start Next.js development server (HTTP)
      - `dev:https`: Start Next.js development server with HTTPS (`next dev --experimental-https`)
      - `build`: Build Next.js application
      - `start`: Start production Next.js server
      - `db:migrate`: Run Prisma migrations
      - `db:push`: Push schema changes to database
      - `db:studio`: Open Prisma Studio
      - `db:reset`: Reset database (drop + recreate + migrate)
      - `db:seed`: Seed database with test data (placeholder for future implementation)
      - `build:cloud`: Build production artifacts (placeholder)
      - `deploy:cloud`: Deploy to cloud platform (placeholder)

## 4. Property NI Design System Configuration
- [ ] 4.1 Configure the **Property NI Navy & Amber** design tokens in `app/globals.css` (CSS Custom Properties) and `tailwind.config.ts`.
- [ ] 4.2 Import and configure the `'Inter'` font family globally in configuration files.
- [ ] 4.3 Define custom Tailwind utilities for specific design requirements (e.g., `rounded-pill` for 26px radius, custom shadow utilities for buttons) in `tailwind.config.ts`.
- [ ] 4.4 Scaffold the empty directory structure for the **Split-Screen Layout** authentication pages.
- [ ] 4.5 Scaffold the empty directory structure for the Authentication UI components (Inputs, Buttons).

## 5. Database & ORM Configuration
- [ ] 5.1 Initialize Prisma (`npx prisma init`).
- [ ] 5.2 Configure `prisma/schema.prisma` with PostgreSQL provider (single schema, no SQLite).
- [ ] 5.3 Define User, Session, Account, Organization, Member, Invitation models in the Prisma schema.
- [ ] 5.4 **Document the `organizationId` requirement:**
      - Add comments to `prisma/schema.prisma` explaining that ALL organization-scoped models MUST include `organizationId`
      - Include the standard pattern as a comment block at the top of the schema file:
        ```prisma
        // ============================================================
        // TENANT ISOLATION REQUIREMENT
        // ============================================================
        // Every organization-scoped model MUST include:
        //
        //   organizationId String
        //   organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
        //   @@index([organizationId])
        //
        // This is required for both:
        //   1. Prisma Extension (lib/tenant-db.ts) - Application layer
        //   2. PostgreSQL RLS - Database layer
        //
        // Without organizationId, tenant isolation is BROKEN for that model.
        //
        // Exempt models (global, not org-scoped):
        //   User, Session, Account, Organization, Member, Invitation
        // ============================================================
        ```
- [ ] 5.5 Create the Prisma Client singleton boilerplate in `lib/db.ts`.
- [ ] 5.6 Execute `prisma generate` to build the Prisma Client.

## 6. Security & Encryption Boilerplate
- [ ] 6.1 Create the application-layer encryption utility boilerplate in `lib/crypto.ts` (AES-256-GCM) for PII.

## 7. Authentication, Authorization & OIDC Configuration
- [ ] 7.1 Install and configure BetterAuth dependencies in `lib/auth.ts` (configuration boilerplate only).
- [ ] 7.2 Configure the BetterAuth Prisma adapter and Email/Password plugin.
- [ ] 7.3 Configure the BetterAuth OIDC plugin, restricting the provider list to **Google only**.
- [ ] 7.4 Create `app/api/auth/[...all]/route.ts` with `toNextJsHandler(auth)` boilerplate.
- [ ] 7.5 Scaffold the empty directory structure for additional API routes in `app/api/`.
- [ ] 7.6 Document the required Google Cloud Console callback URL registration (`/api/auth/callback/google`) in README or setup guide.

## 8. Multi-Tenancy with BetterAuth Organization Plugin
- [ ] 8.1 Install BetterAuth organization plugin dependencies.
- [ ] 8.2 Configure the Organization plugin in `lib/auth.ts` with:
      - Organization schema extensions (company name, settings, metadata)
      - Organization-scoped role definitions for property management industry
      - Permission sets for each role (property owner, property manager, letting agent, contractor, tenant, accountant)
      - Allow users to belong to multiple organizations
- [ ] 8.3 Create `lib/organization.ts` with organization plugin configuration boilerplate and helper functions.
- [ ] 8.4 Update Prisma schema to include Organization, Member, and Invitation models (auto-generated by plugin).
- [ ] 8.5 Scaffold organization management directory structure:
      - `app/organizations/` (Main organization layout)
      - `app/organizations/create/` (Create organization page)
      - `app/organizations/[orgId]/` (Organization detail page)
      - `app/organizations/[orgId]/members/` (Member management)
      - `app/organizations/[orgId]/settings/` (Organization settings)
      - `app/organizations/[orgId]/invitations/` (Invitation management)
- [ ] 8.6 Create organization switching UI component boilerplate in `components/organization-switcher.tsx`.
- [ ] 8.7 Create organization context provider boilerplate in `lib/organization-context.tsx`.

## 9. Next.js Middleware for Route Protection
- [ ] 9.1 Create `middleware.ts` at project root with:
      - Route protection logic (redirect unauthenticated users to login)
      - Organization context extraction
      - Role-based route guards (scaffolding only)
      - Tenant context establishment via AsyncLocalStorage
- [ ] 9.2 Define protected route patterns (e.g., `/dashboard/*`, `/admin/*`, `/organizations/*`).
- [ ] 9.3 Define public route patterns (e.g., `/`, `/login`, `/register`, `/api/auth/*`).

## 10. Tenant Data Isolation (Defense-in-Depth)
- [ ] 10.1 Create `lib/tenant-context.ts` with AsyncLocalStorage-based tenant context:
      - AsyncLocalStorage instance for current organization ID
      - `runWithTenant(orgId, fn)` helper to execute code within a tenant context
      - `getCurrentOrgId()` helper to retrieve the current organization ID
      - Error handling for missing tenant context
- [ ] 10.2 Create `lib/tenant-db.ts` with Prisma Extension for automatic query scoping:
      - Extend the base Prisma client from `lib/db.ts`
      - Override `findMany`, `findFirst`, `findUnique`, `update`, `updateMany`, `delete`, `deleteMany`, `count`, `aggregate`, `groupBy` to inject `organizationId` filter
      - Read current organization ID from `lib/tenant-context.ts`
      - Define list of exempt models (User, Session, Account, Organization, Member, Invitation)
      - **Add runtime validation: if a non-exempt model does not have `organizationId` in its schema, throw a descriptive error at startup**
      - Reject queries when no tenant context is available
- [ ] 10.3 Create `lib/audit.ts` with audit logging boilerplate:
      - Audit event types (CROSS_TENANT_ACCESS_ATTEMPT, etc.)
      - `logAuditEvent(event)` function integrating with `lib/logger.ts`
      - Structured log format for audit events (user ID, attempted org, actual org, resource, timestamp, IP)
- [ ] 10.4 Create RLS template migration at `prisma/migrations/0000_enable_rls/migration.sql`:
      - Template demonstrating how to enable RLS on a table
      - Template demonstrating how to create a tenant isolation policy
      - Comments explaining the pattern for applying RLS to new tables
      - Note: Actual RLS policies for business tables will be added in future feature proposals
- [ ] 10.5 Create ESLint rule configuration to prevent direct `prisma` imports:
      - Configure `no-restricted-imports` rule in `.eslintrc.js` or `eslint.config.js`
      - Block imports of `prisma` from `lib/db.ts` in files under `app/`, `lib/` (excluding `lib/tenant-db.ts` and `lib/db.ts` themselves)
      - Allow imports from `lib/tenant-db.ts`
      - Document the rule and rationale in a comment
- [ ] 10.6 Scaffold tenant isolation test directory:
      - `tests/isolation/` (Main isolation test directory)
      - `tests/isolation/application/` (Application-layer isolation tests)
      - `tests/isolation/database/` (Database-layer RLS tests)
      - `tests/isolation/README.md` (Documentation of isolation testing strategy)
- [ ] 10.7 Create template isolation test files:
      - `tests/isolation/application/template.test.ts` — Demonstrates pattern for testing application-layer isolation
      - `tests/isolation/database/template.test.ts` — Demonstrates pattern for testing RLS isolation with raw SQL
      - Templates must include comments explaining how to extend for new models
- [ ] 10.8 Create `lib/validate-schema.ts` — Startup validation that checks all non-exempt Prisma models have an `organizationId` field:
      - Parse the Prisma schema or use Prisma's internal schema representation
      - For each model NOT in the exempt list, verify `organizationId` field exists
      - If any model is missing `organizationId`, log a CRITICAL error and exit the application
      - This acts as a safety net against developers forgetting to add `organizationId` to new models

## 11. Admin Dashboard & User Dashboard Scaffolding
- [ ] 11.1 Scaffold the admin dashboard directory structure:
      - `app/admin/` (Main admin layout)
      - `app/admin/users/` (User management pages)
      - `app/admin/roles/` (Role management pages)
      - `app/admin/permissions/` (Permission management pages)
      - `app/admin/organizations/` (Organization management pages)
      - `app/admin/audit/` (Audit log pages)
      - `app/admin/settings/` (System settings pages)
- [ ] 11.2 Scaffold role-specific user dashboard directory structures:
      - `app/dashboard/` (Main dashboard layout with role-based routing)
      - `app/dashboard/owner/` (Property owner dashboard)
      - `app/dashboard/manager/` (Property manager dashboard)
      - `app/dashboard/agent/` (Letting agent dashboard)
      - `app/dashboard/maintenance/` (Maintenance staff dashboard)
      - `app/dashboard/tenant/` (Tenant dashboard)
      - `app/dashboard/accountant/` (Accountant dashboard)
      - `app/dashboard/contractor/` (Contractor dashboard — scaffolding only; full implementation deferred to future OpenSpec proposal)
- [ ] 11.3 Scaffold custom roles configuration directory:
      - `lib/roles/` (Role definitions and configuration)
      - `lib/roles/property-management.ts` (Property management role templates)
      - `lib/roles/letting.ts` (Letting agent role templates)
      - `lib/roles/maintenance.ts` (Maintenance role templates)
      - `lib/roles/contractor.ts` (Contractor role template — scaffolding only; full implementation deferred to future OpenSpec proposal)
      - `lib/permissions/` (Permission definitions)
      - `lib/permissions/property.ts` (Property-related permissions)
      - `lib/permissions/tenant.ts` (Tenant-related permissions)
      - `lib/permissions/financial.ts` (Financial-related permissions)
      - `lib/permissions/maintenance.ts` (Maintenance-related permissions)
      - `lib/permissions/contractor.ts` (Contractor-related permissions — scaffolding only; full implementation deferred to future OpenSpec proposal)
- [ ] 11.4 Configure BetterAuth Admin Plugin in `lib/auth.ts`:
      - Enable admin plugin with default and admin role configuration
      - Configure admin role to include "super_admin"
      - Set up role-based access control scaffolding
- [ ] 11.5 Create role-based dashboard routing boilerplate in `lib/dashboard-router.ts`:
      - Utility to determine which dashboard to show based on user role
      - Placeholder logic for role-to-dashboard mapping
      - Include contractor role mapping placeholder

## 12. Operational Resilience Boilerplate
- [ ] 12.1 Create `lib/logger.ts` with Pino-based structured logging, environment-aware log levels, and PII redaction rules.
- [ ] 12.2 Create `lib/env.ts` with Zod-based environment variable validation (fail-fast at startup).
- [ ] 12.3 Create shared Zod validation schema boilerplate in `lib/schemas/` (e.g., `user.schema.ts`, `auth.schema.ts`, `organization.schema.ts`).
- [ ] 12.4 Create API error helper in `lib/api-error.ts` for standardized error responses in Route Handlers.
- [ ] 12.5 Scaffold Next.js error boundaries: `app/error.tsx` and `app/global-error.tsx`.

## 13. Testing Configuration
- [ ] 13.1 Install and configure Vitest at version `^4.1.5` (required by @better-auth/test-utils).
- [ ] 13.2 Configure `node` environment for `lib/` and `app/api/` tests, and `jsdom` for `components/` tests.
- [ ] 13.3 Install BetterAuth test-utils plugin at version `^1.6.23` (`@better-auth/test-utils`).
- [ ] 13.4 Verify that Vitest 4.x and @better-auth/test-utils are compatible (no peer dependency conflicts).
- [ ] 13.5 Create test setup file (`tests/setup.ts`) with BetterAuth test client configuration.
- [ ] 13.6 Create test utilities directory (`tests/utils/`) with helper functions:
      - `tests/utils/auth.ts` (Authentication test helpers)
      - `tests/utils/organization.ts` (Organization test helpers)
      - `tests/utils/user.ts` (User creation and management helpers)
- [ ] 13.7 Create test fixtures directory (`tests/fixtures/`) with sample data:
      - `tests/fixtures/users.ts` (Sample user data for different roles)
      - `tests/fixtures/organizations.ts` (Sample organization data)
- [ ] 13.8 Scaffold test directory structure:
      - `tests/unit/` (Unit tests for utilities and helpers)
      - `tests/integration/` (Integration tests for API routes)
      - `tests/e2e/` (End-to-end test scaffolding for future implementation)
- [ ] 13.9 Create sample test files demonstrating test-utils usage:
      - `tests/unit/auth.test.ts` (Sample authentication tests)
      - `tests/unit/organization.test.ts` (Sample organization tests)
- [ ] 13.10 Configure Vitest to use test setup file and test utilities.
- [ ] 13.11 Add test scripts to `package.json`:
      - `test` (Run all tests)
      - `test:watch` (Run tests in watch mode)
      - `test:coverage` (Run tests with coverage)
      - `test:auth` (Run authentication tests only)
      - `test:organization` (Run organization tests only)

## 14. Developer Tooling & Pre-Commit Hooks
- [ ] 14.1 Install and configure ESLint and Prettier.
- [ ] 14.2 Install Husky and initialize git hooks.
- [ ] 14.3 Install and configure lint-staged with `.lintstagedrc` for pre-commit linting/formatting.
- [ ] 14.4 Create pre-commit hook script that runs lint-staged.

## 15. GitHub Configuration & CI/CD
- [ ] 15.1 Configure GitHub Branch Protection Rules for the `main` branch.
- [ ] 15.2 Create `.github/workflows/ci.yml` including:
      - Node.js 22 setup via `actions/setup-node@v4`
      - Linting, type-checking, and Vitest
      - `npm audit` for dependency security scanning
      - Build verification
- [ ] 15.3 Create `.github/workflows/deploy.yml` for production database migrations and deployment.

## 16. Environment Variables Configuration
- [ ] 16.1 Create `.env.example` with all required environment variables for local development.
- [ ] 16.2 Create `.env.local-prod.example` with all required environment variables for local production.
- [ ] 16.3 Document required environment variables:
      - `DATABASE_URL` (PostgreSQL connection string)
      - `BETTER_AUTH_SECRET` (Session encryption secret)
      - `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (Google OIDC)
      - `PII_ENCRYPTION_KEY` (AES-256-GCM encryption key)
      - `LOG_LEVEL` (debug/info/warn/error)

## 17. Documentation
- [ ] 17.1 Update `README.md` with dedicated sections for:
      - Tenant isolation strategy (defense-in-depth)
      - Node.js version requirements
      - Next.js/React version requirements
      - Vitest version requirements
      - How to use `lib/tenant-db.ts`
      - How to add RLS policies for new tables
      - ESLint rule documentation
      - ORM evaluation rationale (Prisma vs Drizzle vs Kysely)
      - Secrets management strategy
      - Local PostgreSQL setup instructions
- [ ] 17.2 Create `tests/isolation/README.md` documenting the isolation testing strategy.

## 18. Future OpenSpec Proposals (Deferred Work — Actively Tracked)

The following tasks are explicitly deferred to future OpenSpec proposals and are NOT part of this initialization phase. They are documented here for planning and tracking purposes.

**Status Legend:** 📋 Planned | 🔍 Researching | 📝 Proposal Drafted | ✅ Promoted to Active

### 18.1 Contractor Role & Dashboard Development (🔴 High Priority)
- [ ] 18.1.0 Create OpenSpec proposal for Contractor role implementation 📋 Planned
- [ ] 18.1.1 Define Contractor data models in Prisma schema (Contractor profile, skills, certifications, insurance details) 📋 Planned
- [ ] 18.1.2 Implement Contractor dashboard UI (`app/dashboard/contractor/`) with Property NI design system 📋 Planned
- [ ] 18.1.3 Build quoting functionality (Contractors can view available jobs and submit quotes) 📋 Planned
- [ ] 18.1.4 Build job scheduling functionality (Contractors can schedule date/time to start work) 📋 Planned
- [ ] 18.1.5 Build work order management (Contractors can view assigned jobs, update status, add notes) 📋 Planned
- [ ] 18.1.6 Build site access management (Contractors can view property access details, key collection info) 📋 Planned
- [ ] 18.1.7 Build invoicing functionality (Contractors can submit invoices for completed work) 📋 Planned
- [ ] 18.1.8 Build communication features (Contractors can communicate with management/property managers) 📋 Planned
- [ ] 18.1.9 Implement Contractor-specific permissions in `lib/permissions/contractor.ts` 📋 Planned
- [ ] 18.1.10 Implement Contractor role template in `lib/roles/contractor.ts` 📋 Planned
- [ ] 18.1.11 Build management interface for assigning jobs to Contractors 📋 Planned
- [ ] 18.1.12 Build management interface for reviewing/approving Contractor quotes 📋 Planned
- [ ] 18.1.13 Implement Contractor onboarding flow (registration, document upload, verification) 📋 Planned
- [ ] 18.1.14 Implement Contractor performance tracking and ratings 📋 Planned

### 18.2 Property Management Business Logic (🔴 High Priority)
- [ ] 18.2.0 Create OpenSpec proposal for property management business logic 📋 Planned
- [ ] 18.2.1 Property data models and CRUD operations 📋 Planned
- [ ] 18.2.2 Tenant (renter) management 📋 Planned
- [ ] 18.2.3 Lease/contract management 📋 Planned
- [ ] 18.2.4 Maintenance request workflow 📋 Planned
- [ ] 18.2.5 Financial features (rent collection, ledger, reporting) 📋 Planned

### 18.3 Deferred BetterAuth Plugins (Prioritized)

**🔴 High Priority (within 3 months):**
- [ ] 18.3.1 Two-Factor Authentication (2FA) OpenSpec proposal 📋 Planned
- [ ] 18.3.2 Email Verification OpenSpec proposal 📋 Planned
- [ ] 18.3.3 Password Reset Flow OpenSpec proposal 📋 Planned

**🟡 Medium Priority (within 6 months):**
- [ ] 18.3.4 API Key Plugin OpenSpec proposal 📋 Planned
- [ ] 18.3.5 Bearer Token OpenSpec proposal 📋 Planned
- [ ] 18.3.6 SSO Plugin OpenSpec proposal 📋 Planned
- [ ] 18.3.7 JWT Plugin OpenSpec proposal 📋 Planned
- [ ] 18.3.8 Stripe Plugin OpenSpec proposal 📋 Planned
- [ ] 18.3.9 SAML SSO with Okta OpenSpec proposal 📋 Planned

**🟢 Low Priority (backlog):**
- [ ] 18.3.10 Magic Link Plugin OpenSpec proposal 📋 Planned
- [ ] 18.3.11 Email OTP Plugin OpenSpec proposal 📋 Planned
- [ ] 18.3.12 Multi-Session Plugin OpenSpec proposal 📋 Planned
- [ ] 18.3.13 Additional Social Providers OpenSpec proposal 📋 Planned

### 18.4 Other Deferred Features (Prioritized)

**🟡 Medium Priority:**
- [ ] 18.4.1 File Upload & Storage OpenSpec proposal 📋 Planned
- [ ] 18.4.2 Performance Monitoring & Error Tracking OpenSpec proposal 📋 Planned

**🟢 Low Priority:**
- [ ] 18.4.3 API Versioning Strategy OpenSpec proposal 📋 Planned
- [ ] 18.4.4 API Documentation OpenSpec proposal 📋 Planned
- [ ] 18.4.5 Database Seeding Strategy OpenSpec proposal 📋 Planned
- [ ] 18.4.6 Docker / Containerization OpenSpec proposal 📋 Planned

---

## 19. Recurring Maintenance Tasks

These tasks are performed on a regular cadence to maintain project health and ensure deferred items don't become forgotten.

### 19.1 Deferred Items Review (Sprint Cadence)
- [ ] 19.1.1 Review all deferred items at the start of each sprint
- [ ] 19.1.2 Update priority levels based on current business needs
- [ ] 19.1.3 Promote any items that have become prerequisites for active work
- [ ] 19.1.4 Create OpenSpec proposals for any items being promoted to active development
- [ ] 19.1.5 Archive items that are no longer relevant
- [ ] 19.1.6 Update the Deferred Items Registry in `proposal.md` with any changes

### 19.2 Dependency Audit (Monthly)
- [ ] 19.2.1 Run `npm audit` and address any high/critical vulnerabilities
- [ ] 19.2.2 Review outdated dependencies and assess upgrade risk
- [ ] 19.2.3 Update `package-lock.json` with secure versions

### 19.3 Security Review (Quarterly)
- [ ] 19.3.1 Review tenant isolation implementation for gaps
- [ ] 19.3.2 Audit secrets management practices
- [ ] 19.3.3 Review RLS policies for correctness
- [ ] 19.3.4 Update encryption keys if rotation is due
- [ ] 19.3.5 Review CSP headers and rate limiting configuration