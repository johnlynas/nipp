# Delta for Testing

## ADDED Requirements

### Requirement: Testing Framework Configuration
Vitest SHALL be configured as the primary unit and integration testing framework.

#### Scenario: Unified Test Runner Setup
- GIVEN the project is initialized
- WHEN the testing configuration is created
- THEN Vitest MUST be configured at the root to orchestrate test execution across all directories.

### Requirement: Test Environments
Tests MUST execute in appropriate environments based on the directory type.

#### Scenario: Environment Isolation Configuration
- GIVEN the Vitest configuration is written
- WHEN the environments are defined
- THEN backend (`lib/`, `app/api/`) tests MUST be configured to run in a `node` environment.
- THEN frontend (`components/` or `app/`) tests MUST be configured to run in a DOM-like environment (e.g., `jsdom`).

### Requirement: BetterAuth test-utils Integration
The project MUST integrate BetterAuth's test-utils plugin for comprehensive authentication testing.

#### Scenario: test-utils Installation and Configuration
- GIVEN the project requires authentication testing
- WHEN the testing setup is configured
- THEN the BetterAuth test-utils plugin MUST be installed at version `^1.6.23`
- THEN Vitest MUST be installed at version `^4.1.5` (required by test-utils)
- THEN a test setup file MUST be created with the test client configuration
- THEN the test client MUST be configured to work with the BetterAuth instance
- THEN the installation MUST NOT fail with peer dependency conflicts

#### Scenario: Authentication Test Utilities
- GIVEN the test-utils plugin is configured
- WHEN authentication tests are written
- THEN test utilities MUST be available for:
  - Creating test users with different roles
  - Creating test sessions
  - Making authenticated requests
  - Testing login/logout flows
- THEN these utilities MUST be organized in `tests/utils/auth.ts`.

#### Scenario: Organization Test Utilities
- GIVEN the Organization plugin is configured
- WHEN organization tests are written
- THEN test utilities MUST be available for:
  - Creating test organizations
  - Adding members to organizations
  - Testing organization-scoped permissions
  - Testing organization switching
  - Testing invitation flows
- THEN these utilities MUST be organized in `tests/utils/organization.ts`.

#### Scenario: Test Fixtures
- GIVEN the project requires consistent test data
- WHEN tests are executed
- THEN test fixtures MUST be available for:
  - Sample users with different roles (owner, manager, agent, tenant, contractor, accountant)
  - Sample organizations with different configurations
  - Sample sessions and authentication states
- THEN these fixtures MUST be organized in `tests/fixtures/`.

#### Scenario: Test Directory Structure
- GIVEN the project is initialized
- WHEN the test directory structure is created
- THEN it MUST contain:
  - `tests/unit/` (Unit tests for utilities and helpers)
  - `tests/integration/` (Integration tests for API routes)
  - `tests/e2e/` (End-to-end test scaffolding)
  - `tests/utils/` (Test utility functions)
  - `tests/fixtures/` (Test data fixtures)
  - `tests/setup.ts` (Test setup configuration)

#### Scenario: Sample Test Files
- GIVEN the test-utils plugin is configured
- WHEN sample test files are created
- THEN they MUST demonstrate:
  - How to use the test client for authenticated requests
  - How to create test users and organizations
  - How to test role-based access control
  - How to test organization-scoped operations
- THEN these samples MUST serve as templates for future test development.

#### Scenario: Test Scripts Configuration
- GIVEN the testing setup is complete
- WHEN test scripts are added to `package.json`
- THEN the following scripts MUST be available:
  - `test` (Run all tests)
  - `test:watch` (Run tests in watch mode)
  - `test:coverage` (Run tests with coverage)
  - `test:auth` (Run authentication tests only)
  - `test:organization` (Run organization tests only)

### Requirement: Test Coverage Requirements
The project MUST enforce minimum test coverage thresholds.

#### Scenario: Coverage Configuration
- GIVEN the testing setup is configured
- WHEN coverage reports are generated
- THEN coverage MUST be measured for:
  - Authentication utilities (`lib/auth.ts`)
  - Organization utilities (`lib/organization.ts`)
  - Encryption utilities (`lib/crypto.ts`)
  - Validation schemas (`lib/schemas/`)
  - Tenant isolation utilities (`lib/tenant-db.ts`, `lib/tenant-context.ts`)
  - API route handlers (when implemented)
- THEN a minimum coverage threshold of 80% MUST be enforced for critical paths.

### Requirement: Test Isolation and Cleanup
Tests MUST be isolated and properly cleaned up.

#### Scenario: Database Cleanup
- GIVEN tests are using the database
- WHEN tests complete
- THEN test data MUST be cleaned up to prevent test interference.
- THEN each test suite MUST use isolated test data.

#### Scenario: Session Cleanup
- GIVEN tests create sessions
- WHEN tests complete
- THEN test sessions MUST be invalidated or cleaned up.
- THEN session state MUST not leak between tests.