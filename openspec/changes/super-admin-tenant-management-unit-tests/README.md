# Super Admin Tenant Management — Unit Tests

## Overview

This proposal defines unit tests for the super admin tenant management feature implemented in the `super-admin-tenant-management` proposal. Tests cover API route handlers (structural + mocked) and UI form components, enabling fast feedback without requiring a running database or server.

## Files

| File | Purpose |
|------|---------|
| [proposal.md](./proposal.md) | Intent, scope, acceptance criteria, risks |
| [design.md](./design.md) | Technical design — mocking strategy, test patterns, coverage matrix |
| [tasks.md](./tasks.md) | Task checklist — phased implementation plan |

## Test Categories

1. **Structural Tests** — Verify API route exports, guards, and validation patterns by reading source files
2. **Mocked Handler Tests** — Test handler logic with mocked Prisma, auth guard, and audit log
3. **UI Component Tests** — Test form components with Testing Library in jsdom
4. **State Machine Tests** — Verify organization status transition validation

## Running Tests

```bash
# All unit tests (including new tenant management tests)
npm test

# Only tenant management API tests
npx vitest run tests/unit/tenant-mgmt-*.test.ts

# Only UI component tests
npx vitest run tests/unit/TenantMemberForm.test.tsx tests/unit/TenantRoleForm.test.tsx

# With coverage
npx vitest run --coverage tests/unit/tenant-mgmt-*.test.ts
```

## Dependencies

This proposal depends on:
- `super-admin-tenant-management` — The feature being tested (API routes, UI components)
- `project-initialization` — Testing infrastructure (Vitest 4.x)
