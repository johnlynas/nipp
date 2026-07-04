# Delta for Architecture

## ADDED Requirements

### Requirement: Execution Boundary (No Application Code)
The project initialization phase MUST NOT generate any application code files containing business logic, page implementations, UI components, or route handlers.

#### Scenario: Initialization Scope Enforcement
- GIVEN the OpenSpec proposal is being executed
- WHEN files are being created
- THEN the execution MUST be strictly limited to configuration files, library initialization boilerplate, dependency installation, build commands, and directory scaffolding.
- THEN no actual application logic, UI components, or backend route handlers MUST be written.

### Requirement: Unified Next.js Architecture
The application MUST use a unified Next.js architecture serving both UI and API from a single origin.

#### Scenario: Single Server Process
- GIVEN the application is running
- WHEN the development server starts
- THEN it MUST run as a single Next.js process (not separate UI and API servers).
- THEN all API endpoints MUST be served via Next.js Route Handlers in `app/api/`.
- THEN no separate Express server MUST be used.

#### Scenario: Same-Origin Requests
- GIVEN the frontend needs to call backend APIs
- WHEN fetch requests are made
- THEN they MUST use relative paths (e.g., `/api/properties`) instead of absolute URLs.
- THEN no CORS configuration MUST be required.

### Requirement: Next.js Frontend Structure
The frontend SHALL be structured according to the official Next.js App Router standard.

#### Scenario: Frontend Directory Layout
- GIVEN the project is initialized
- WHEN the frontend is scaffolded
- THEN it MUST contain the standard Next.js directories: `app/`, `components/`, `public/`, `styles/` (or `app/globals.css`).

### Requirement: BetterAuth API Routes
BetterAuth MUST be integrated via Next.js Route Handlers using `toNextJsHandler`.

#### Scenario: Auth Route Handler
- GIVEN the application requires authentication
- WHEN the `app/api/auth/[...all]/route.ts` file is created
- THEN it MUST export GET and POST handlers via `toNextJsHandler(auth)`.
- THEN all BetterAuth endpoints MUST be accessible under `/api/auth/*`.

### Requirement: Next.js Middleware for Route Protection
The application MUST use Next.js middleware for route protection and organization context.

#### Scenario: Middleware Configuration
- GIVEN the application is initialized
- WHEN `middleware.ts` is created at the project root
- THEN it MUST define protected route patterns (e.g., `/dashboard/*`, `/admin/*`).
- THEN it MUST define public route patterns (e.g., `/`, `/login`, `/api/auth/*`).
- THEN unauthenticated users accessing protected routes MUST be redirected to login.

### Requirement: Global Error Handling
The application MUST have global error handling boilerplate.

#### Scenario: Next.js Error Boundaries
- GIVEN a rendering error occurs in the Next.js frontend
- WHEN the error is caught by React
- THEN the `app/error.tsx` and `app/global-error.tsx` scaffolding MUST be in place to display user-friendly error UI.

#### Scenario: API Error Helper
- GIVEN an API route handler encounters an error
- WHEN the error is processed
- THEN it MUST use a standardized error helper (`lib/api-error.ts`) to return consistent JSON error responses.

### Requirement: Structured Logging
The application MUST use structured logging via Pino.

#### Scenario: Logger Utility
- GIVEN the application needs to log events
- WHEN `lib/logger.ts` is used
- THEN it MUST output JSON-formatted logs.
- THEN it MUST support environment-aware log levels (DEBUG for dev, INFO for prod).
- THEN it MUST include PII redaction rules to prevent sensitive data from being logged.

### Requirement: Multi-Tenancy Directory Structure
The project MUST establish a clear directory structure for multi-tenancy features.

#### Scenario: Organization Directory Separation
- GIVEN the frontend is scaffolded
- WHEN the directory structure is created
- THEN it MUST maintain clear separation between:
  - Public pages (`app/` root level)
  - Admin dashboard (`app/admin/`)
  - Organization management (`app/organizations/`)
  - User dashboards (`app/dashboard/`)
  - Authentication pages (`app/login/`, `app/register/`)
  - API routes (`app/api/`)
- THEN each section MUST have its own layout and routing structure.

#### Scenario: Scalability for Future Features
- GIVEN the directory structure is established
- WHEN future implementation phases begin
- THEN the structure MUST support:
  - Adding new admin sections without restructuring
  - Adding new organization management features
  - Adding new role-specific dashboards (including Contractor)
  - Adding new permission domains
  - Integrating additional multi-tenancy features

### Requirement: Tenant Isolation Directory Structure
The project MUST establish a clear directory structure for tenant isolation infrastructure.

#### Scenario: Isolation Infrastructure Layout
- GIVEN the project is initialized
- WHEN the directory structure is created
- THEN it MUST contain:
  - `lib/tenant-context.ts` (AsyncLocalStorage-based tenant context)
  - `lib/tenant-db.ts` (Tenant-scoped Prisma client)
  - `lib/audit.ts` (Audit logging boilerplate)
  - `lib/validate-schema.ts` (Startup schema validation)
  - `tests/isolation/` (Tenant isolation test directory)
  - `prisma/migrations/0000_enable_rls/` (RLS template migration)
- THEN each file MUST contain boilerplate or template code demonstrating the tenant isolation pattern