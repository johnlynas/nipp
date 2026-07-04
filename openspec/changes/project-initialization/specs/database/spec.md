# Delta for Database

## ADDED Requirements

### Requirement: ORM Configuration
Prisma SHALL be used as the primary ORM for database interactions, centralized in the `prisma/` directory.

#### Scenario: Shared Prisma Client Boilerplate
- GIVEN the database package is configured
- WHEN the Prisma Client is generated
- THEN it MUST be exported as a shared module (e.g., `lib/db.ts`) to ensure type safety across the application.

### Requirement: Local PostgreSQL Installation
Developers MUST have PostgreSQL 16+ installed locally for development.

#### Scenario: PostgreSQL Prerequisites
- GIVEN a developer is setting up the development environment
- WHEN they prepare to run the application
- THEN they MUST have PostgreSQL 16 or higher installed locally
- THEN they MUST configure the `DATABASE_URL` environment variable to connect to their local PostgreSQL instance
- THEN the connection string MUST follow the format: `postgresql://USER:PASSWORD@localhost:5432/DATABASE_NAME`

#### Scenario: Database Connection
- GIVEN the application is running in development mode
- WHEN it connects to the database
- THEN it MUST use the PostgreSQL provider in Prisma
- THEN it MUST connect to the local PostgreSQL instance via the `DATABASE_URL` environment variable

### Requirement: Single Prisma Schema
The project MUST use a single Prisma schema file configured for PostgreSQL.

#### Scenario: Schema Configuration
- GIVEN the Prisma schema is initialized
- WHEN the schema file is created
- THEN it MUST use `provider = "postgresql"` in the datasource block
- THEN it MUST NOT include any SQLite configuration
- THEN all migrations MUST be generated for PostgreSQL

### Requirement: Authentication Data Models
The database schema MUST support the data structures required for both local credentials and OIDC social logins.

#### Scenario: User, Session, and Account Tables
- GIVEN BetterAuth is configured
- WHEN the Prisma schema is defined
- THEN it MUST include `User` (with a `passwordHash` field), `Session`, and `Account` models.

### Requirement: Organization ID Field on All Organization-Scoped Models
Every database model that contains tenant-specific data MUST include an `organizationId` field. This is the foundational requirement upon which the entire tenant isolation strategy depends.

#### Scenario: Mandatory organizationId Field
- GIVEN a new database model is created that stores organization-specific data
- WHEN the Prisma schema is defined
- THEN the model MUST include an `organizationId` field of type `String`
- THEN the model MUST include a foreign key relation to the `Organization` model
- THEN the `organizationId` field MUST NOT be optional (no `?` modifier)
- THEN the model MUST include an index on `organizationId` for query performance

#### Scenario: Prisma Schema Pattern
- GIVEN an organization-scoped model is defined
- WHEN the Prisma schema is written
- THEN it MUST follow this pattern:
  ```prisma
  model ExampleModel {
    id             String       @id @default(cuid())
    organizationId String
    // ... other fields

    organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

    @@index([organizationId])
  }