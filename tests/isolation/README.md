# Tenant Isolation Testing Strategy

## Overview

Tenant isolation tests verify that no tenant can access another tenant's data, at every layer of the application. These tests are critical because a tenant isolation failure is a catastrophic security vulnerability.

## Test Layers

### Application-Layer Tests (`tests/isolation/application/`)

Test the Prisma Extension (`lib/tenant-db.ts`) that automatically scopes queries to the current organization.

**Pattern:**
1. Create test data for two organizations (Org A and Org B)
2. Set tenant context to Org A using `runWithTenant(orgA.id, ...)`
3. Query the model — expect only Org A data
4. Set tenant context to Org B
5. Query the same model — expect only Org B data

### Database-Layer Tests (`tests/isolation/database/`)

Test PostgreSQL Row Level Security (RLS) by executing raw SQL queries that bypass application-layer scoping.

**Pattern:**
1. Enable RLS on the table via migration
2. Set session variable: `SELECT set_config('app.current_org_id', '<orgA>', true)`
3. Execute raw SQL query — expect only Org A rows
4. Set session variable to Org B's ID
5. Execute same query — expect only Org B rows

## Running Tests

```bash
# Run all isolation tests
npm test -- tests/isolation/

# Run application-layer tests only
npm test -- tests/isolation/application/

# Run database-layer tests only
npm test -- tests/isolation/database/
```

## Adding New Tests

When adding a new feature that touches organization-scoped data:

1. Add application-layer isolation tests in `tests/isolation/application/`
2. Add database-layer RLS tests in `tests/isolation/database/` (when RLS policies are added)
3. A failure in tenant isolation tests MUST block the PR from merging

## Template Files

- `tests/isolation/application/template.test.ts` — Application-layer test template
- `tests/isolation/database/template.test.ts` — Database-layer RLS test template
