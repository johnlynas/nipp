# Tasks: Environment Validation (Zod)

## Phase 1: Setup & Schema Definition
- [ ] **Task 1.1:** Install Zod (`npm install zod`).
- [ ] **Task 1.2:** Create `lib/env.ts`.
- [ ] **Task 1.3:** Define the Zod schema in `lib/env.ts` covering all current variables found in `.env` (e.g., `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `REDIS_URL`, `NEXT_PUBLIC_APP_URL`).
- [ ] **Task 1.4:** Implement the parsing logic with `try/catch` and formatted error logging.
- [ ] **Task 1.5:** Export the parsed `env` object as a typed constant.

## Phase 2: Integration
- [ ] **Task 2.1:** Create `instrumentation.ts` in the root directory (if it doesn't exist).
- [ ] **Task 2.2:** Import `./lib/env` at the very top of `instrumentation.ts` to trigger validation on startup.
- [ ] **Task 2.3:** Restart the dev server and verify it boots successfully with the current `.env` file.

## Phase 3: Refactoring & Type Safety
- [ ] **Task 3.1:** Search the codebase for direct usages of `process.env`.
- [ ] **Task 3.2:** Replace critical `process.env` usages (e.g., in `lib/db.ts`, `lib/redis.ts`, `lib/auth.ts`) with imports from `lib/env.ts`.
- [ ] **Task 3.3:** Ensure client-side components only access `NEXT_PUBLIC_` variables.

## Phase 4: Testing & Documentation
- [ ] **Task 4.1:** Intentionally remove `DATABASE_URL` from `.env` and verify the server fails to start with a clear, formatted error message.
- [ ] **Task 4.2:** Intentionally provide an invalid URL for `DATABASE_URL` and verify the format error is caught.
- [ ] **Task 4.3:** Update `.env.example` to include all validated variables with placeholder values and comments explaining their purpose.
- [ ] **Task 4.4:** Add `.env.example` to the repository (ensure `.env` is in `.gitignore`).
