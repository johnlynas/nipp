# Design: Environment Validation (Zod)

## Architecture Overview
This design introduces a centralized, type-safe environment configuration layer using Zod. By validating `process.env` at the very beginning of the application lifecycle, we guarantee that any code importing the `env` object receives fully validated, correctly typed values.

## Data Flow
1. **Startup:** Next.js initializes and runs `instrumentation.ts`.
2. **Validation:** `instrumentation.ts` imports `lib/env.ts`, which immediately parses `process.env` against the Zod schema.
3. **Fail Fast:** If validation fails, Zod throws a `ZodError`. We catch this, format it into a readable string, log it to the console, and call `process.exit(1)`.
4. **Consumption:** Application code (API routes, Server Components) imports `env` from `lib/env.ts` instead of using `process.env` directly.

## Technical Decisions

### 1. Schema Structure
We will use `z.object()` to define the schema. We will use `.min(1)` for strings to ensure they aren't just empty strings.

```typescript
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  REDIS_URL: z.string().url(),
  // ... other variables
});
```

### 2. Handling NEXT_PUBLIC_ Variables
Next.js exposes variables prefixed with `NEXT_PUBLIC_` to the browser. We must ensure these are explicitly defined in the schema so developers know they are public.

### 3. Error Formatting
Raw Zod errors can be verbose. We will format the errors to show exactly which variable failed and why.

### 4. Instrumentation Hook
Next.js 15 provides `instrumentation.ts` specifically for startup tasks. This is the perfect place to trigger validation before the server accepts traffic.

## Security Considerations
- **Secret Leakage:** By strictly typing the environment, we prevent accidental usage of server-side secrets in client components. If a developer tries to use `env.DATABASE_URL` in a `'use client'` component, the build process or runtime will flag it (as it's not prefixed with `NEXT_PUBLIC_`).
- **Default Values:** We will avoid using `.default()` for sensitive variables to ensure they are explicitly set in the environment, preventing accidental fallback to insecure defaults in production.
