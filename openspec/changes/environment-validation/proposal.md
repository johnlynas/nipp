# Environment Validation (Zod)

**Status:** Proposed  
**Author:** Property NI Development Team  
**Created:** 2026-07-15  
**Last Updated:** 2026-07-15  
**Related Issues:** Final "Quick Win" from Architecture Review

---

## Summary

This proposal outlines the implementation of strict environment variable validation at application startup using the Zod library. By defining a schema for all required environment variables, the application will "fail fast" with clear, actionable error messages if a critical variable is missing or malformed, rather than crashing cryptically during runtime.

## Motivation

### Current State
Currently, environment variables are accessed directly via `process.env.VARIABLE_NAME`. If a required variable (like `DATABASE_URL` or `BETTER_AUTH_SECRET`) is missing or misspelled in the `.env` file, the application will start successfully but crash unpredictably later when a specific feature is triggered.

### Problems This Solves
1. **Cryptic Runtime Errors:** Prevents deep stack traces from Prisma or BetterAuth caused by simple `.env` typos.
2. **Developer Experience:** Provides immediate, human-readable feedback in the terminal when the dev server starts if the environment is misconfigured.
3. **Type Safety:** Replaces `string | undefined` with strictly typed, validated variables throughout the codebase.
4. **Security:** Ensures sensitive variables are not accidentally exposed to the client-side bundle.

## Detailed Design

### Zod Schema Definition
We will create a central `lib/env.ts` file that uses Zod to define the shape of our environment.

### Early Execution via Instrumentation
In Next.js 15 App Router, the `instrumentation.ts` file is the ideal entry point to run validation *before* the server starts handling requests.

### Client vs. Server Variables
The schema will strictly separate server-only secrets (e.g., `DATABASE_URL`) from client-safe variables (prefixed with `NEXT_PUBLIC_`).

See [design.md](./design.md) for complete technical details.

## Files to Create or Modify

### New Files
- `lib/env.ts` — Central Zod schema and validation logic.
- `instrumentation.ts` — Next.js instrumentation hook to trigger validation on startup.

### Modified Files
- `.env.example` — Updated to reflect all validated variables and their formats.

## Testing Plan

1. **Happy Path:** Start the dev server with a complete `.env` file and verify it boots without errors.
2. **Missing Variable:** Temporarily remove `DATABASE_URL` from `.env` and verify the server refuses to start, printing a clear Zod error.
3. **Invalid Format:** Provide an invalid URL format for `DATABASE_URL` and verify the specific format error is caught.
4. **Client Exposure Check:** Verify that server-only secrets cannot be accessed via `process.env` in a `'use client'` component.

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking local dev setups | Medium | Provide a fully populated `.env.example` and clear migration instructions. |
| Performance overhead | Low | Zod validation runs once on startup; zero impact on request latency. |

## Implementation Timeline

1. **Phase 1:** Install Zod and define the core schema in `lib/env.ts`.
2. **Phase 2:** Integrate validation into `instrumentation.ts`.
3. **Phase 3:** Refactor existing code to use the typed `env` object instead of `process.env`.
4. **Phase 4:** Update `.env.example` and test failure scenarios.

See [tasks.md](./tasks.md) for detailed implementation checklist.

## Acceptance Criteria

- [ ] Zod is installed and configured.
- [ ] All critical environment variables are defined in the schema.
- [ ] The application fails to start with a clear error if a required variable is missing.
- [ ] Environment variables are strictly typed throughout the codebase.
- [ ] `.env.example` is fully updated and documented.

## References

- [Zod Documentation](https://zod.dev/)
- [Next.js Instrumentation Documentation](https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation)
