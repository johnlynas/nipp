# Delta for Security

## ADDED Requirements

### Requirement: Data in Motion (Transport Layer)
In Developer/Local mode, the application MUST operate over HTTP. In Production/Cloud mode, all data in motion MUST be encrypted via HTTPS.

#### Scenario: Development Traffic
- GIVEN the application is running in development mode
- WHEN a user accesses the application
- THEN the traffic MUST be served over HTTP via `next dev`.

#### Scenario: Local Production Traffic
- GIVEN the application is running in local-prod mode
- WHEN a user accesses the application
- THEN the traffic MUST be encrypted via HTTPS using `next dev --experimental-https` or a custom HTTPS server wrapper.

#### Scenario: Cloud Traffic
- GIVEN the application is deployed to production
- WHEN a user accesses the application
- THEN all traffic MUST be encrypted via HTTPS (typically terminated at the edge by the cloud provider).

### Requirement: Data at Rest: Local Credentials (Passwords)
Local user passwords MUST NOT be stored in plain text or reversibly encrypted.

#### Scenario: Password Hashing Configuration
- GIVEN BetterAuth is configured
- WHEN the Email/Password plugin is initialized
- THEN it MUST be configured to use a strong, slow hashing algorithm (e.g., Argon2id) to ensure passwords are irreversible.

### Requirement: Data at Rest: Sensitive PII
Highly sensitive Personally Identifiable Information (PII), specifically passport numbers, MUST be encrypted at rest in the database.

#### Scenario: Application-Layer Encryption Boilerplate
- GIVEN the initialization phase is executing
- WHEN `lib/crypto.ts` is created
- THEN it MUST contain the boilerplate for AES-256-GCM encryption/decryption utilities, loading keys from environment variables.

### Requirement: Input Validation
All user inputs MUST be validated using Zod schemas before processing.

#### Scenario: Shared Validation Schemas
- GIVEN the application receives user input
- WHEN the input is processed
- THEN it MUST be validated against Zod schemas defined in `lib/schemas/`.
- THEN invalid input MUST be rejected with a standardized error response.

#### Scenario: Frontend Form Validation
- GIVEN a user submits a form on the frontend
- WHEN the form data is processed
- THEN it MUST be validated using the same Zod schemas before being sent to the backend.

### Requirement: Environment Variable Validation
All required environment variables MUST be validated at application startup.

#### Scenario: Fail-Fast Validation
- GIVEN the application starts
- WHEN `lib/env.ts` is executed
- THEN it MUST validate all required environment variables using Zod.
- THEN if any variable is missing or malformed, the application MUST exit immediately with a clear error message.

### Requirement: Rate Limiting
Authentication endpoints MUST be protected against brute-force attacks via rate limiting.

#### Scenario: Auth Endpoint Rate Limiting
- GIVEN the application is configured
- WHEN authentication endpoints (`/api/auth/*`) are accessed
- THEN rate limiting MUST be enforced via BetterAuth configuration or Next.js middleware.
- THEN rate-limited requests MUST receive a `429 Too Many Requests` response.

### Requirement: Content Security Policy (CSP)
The application MUST enforce a Content Security Policy to mitigate XSS attacks.

#### Scenario: CSP Headers via Next.js Config
- GIVEN the application is configured
- WHEN responses are sent
- THEN CSP headers MUST be configured via `next.config.ts` or Next.js middleware.
- THEN the CSP MUST allow only trusted sources for scripts, styles, and other resources.

### Requirement: Tenant Data Isolation
The application MUST enforce strict tenant data isolation as a fundamental security property. No tenant may ever access another tenant's data.

#### Scenario: Defense-in-Depth Enforcement
- GIVEN the application is deployed
- WHEN any user attempts to access data
- THEN tenant isolation MUST be enforced at two independent layers:
  - Application layer (Prisma Extension)
  - Database layer (PostgreSQL RLS)
- THEN a failure in one layer MUST NOT result in data leakage

#### Scenario: Audit Logging for Cross-Tenant Access
- GIVEN a user attempts to access data from another organization
- WHEN the attempt is blocked
- THEN the attempt MUST be logged with user ID, attempted organization ID, actual organization ID, resource type, timestamp, and IP address
- THEN these logs MUST be structured (JSON) and tagged for security monitoring

### Requirement: Secrets Management & Leak Prevention
The application MUST implement comprehensive measures to prevent secrets from being exposed in version control.

#### Scenario: Git Protection
- GIVEN the project is hosted on GitHub
- WHEN code is committed
- THEN no files containing real secrets (passwords, API keys, encryption keys, certificates) MUST be committed
- THEN the `.gitignore` file MUST exclude all files that may contain secrets
- THEN a pre-commit hook MUST detect and block accidental secret commits

#### Scenario: Environment Variable Security
- GIVEN environment variables contain sensitive configuration
- WHEN the application runs
- THEN secrets MUST be loaded from environment variables, not hardcoded
- THEN environment variables MUST be validated at startup (via `lib/env.ts`)
- THEN missing or malformed secrets MUST cause the application to fail fast

#### Scenario: Secret Rotation Support
- GIVEN secrets may need to be rotated periodically
- WHEN a secret is rotated
- THEN the application MUST support updating the secret via environment variables
- THEN no code changes MUST be required to rotate a secret
- THEN the application MUST restart to pick up the new secret

#### Scenario: Audit Trail for Secret Access
- GIVEN secrets are used to access sensitive resources
- WHEN a secret is used
- THEN the usage SHOULD be logged (without logging the secret itself)
- THEN audit logs MUST help detect unauthorized access or secret misuse