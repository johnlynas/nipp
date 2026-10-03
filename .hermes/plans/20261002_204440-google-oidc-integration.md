# Google OIDC Integration Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Wire functional Google OIDC sign-in into the Property NI portal so users can authenticate via the existing placeholder "Sign in with Google" button, alongside email/password.

**Architecture:** Reuse BetterAuth (v1.6.23) social-provider support on top of the existing `betterAuth()` instance in `lib/auth.ts`, the existing Prisma `User`/`Account` models, and the existing `/api/auth/[...all]` Next.js route. The client calls `authClient.signIn.social({ provider: 'google' })` which redirects to Google and back through BetterAuth's `/api/auth/callback/google`. Session creation flows through the existing `session.create.after` database hook (active-org auto-assign), so Google sign-ins get the same org context as email sign-ins.

**Tech Stack:** Next.js App Router, BetterAuth 1.6.23 (`better-auth/social-providers`, minimal + prismaAdapter), Prisma/PostgreSQL, Vitest (`@better-auth/test-utils` already in devDependencies).

**Design doc:** `documents/feature-planning-and-development/google-oidc-design.md` (read first — contains flow diagrams and account-linking decisions).

---

## Current state (verified against the repo)

| Item | State |
|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Already required in `lib/env-schema.ts:11-12`, in `.env.example:24-25`, and in `tests/unit/env.test.ts` fixtures. No env work needed. |
| Prisma models | `User` (unique email, nullable `passwordHash`) + `Account` (`providerId`, `providerAccountId`) at `prisma/schema.prisma:114,149` — satisfies BetterAuth's social account schema. No migration needed. |
| Auth surface | `app/api/auth/[...all]/route.ts` forwards everything to `auth.handler(req)`; POSTs are IP-rate-limited via `checkAuthRateLimit`. `/api/auth` prefix is public in `middleware.ts:7`. Provider endpoints (`/api/auth/sign-in/social`, `/api/auth/callback/google`) are covered — **no middleware change needed**. |
| Ban enforcement | Today only for email sign-in, in the `hooks.before` middleware matching `ctx.path === '/sign-in/email'` (`lib/auth.ts:196-225`). Must be extended to social sign-in (Task 3). |
| Active-org on session | Existing `databaseHooks.session.create.after` (`lib/auth.ts:143-194`) looks up the user's `Member` record and sets `activeOrganizationId`. Works automatically for any sign-in method. |
| Login UI | `app/login/page.tsx:463` — Google button is presentation-only, shows `SSO_NOTES.google` notice. Own inline SVG icon (no external image → CSP `img-src 'self'` is safe). |
| Client | `lib/auth-client.ts` — `createAuthClient` already exists; `signInSocial` available on the returned client (better-auth auto-generates it once `socialProviders` is configured server-side). |
| Reference implementation | `/Users/johnlynas/dev/social-login/src/lib/google-auth.ts` shows the Google OIDC mechanics (auth URL, code exchange, ID-token verify) — used here only for reference; BetterAuth performs all of this internally. Do **not** copy its hand-rolled flow into this repo. |

### Account-linking decision (fixed by this plan, do not re-litigate)

BetterAuth's default behavior:

- Google account whose email matches an existing `User` → linked via a new `Account` row (`providerId: 'google'`, `providerAccountId: <google sub>`). The user signs in with their existing account. **Password-only and Google users can share one account.**
- No matching email → BetterAuth signs up a brand-new `User` (sign-up is permitted per-provider even though `emailAndPassword.disableSignUp: true`, which only blocks the *password* sign-up endpoint).
- Re-login with Google when an Account row already exists → normal login, no new user.

This matches the reference project and requires zero custom upsert logic. YAGNI: no account-merge admin UI, no email-domain allowlist, no `hostedDomain` restriction in v1 (see Risks).

### Ban/enforcement decision

Social sign-in must honor the same ban rules as email sign-in. BetterAuth exposes `socialSignIn` hooks; the enforcement hook runs inside the `hooks.before` middleware already present in `lib/auth.ts`, extended to intercept `/sign-in/social`. (If verification shows the ban check should instead live in `socialProviders.google.onSuccess` so it applies *after* user resolution, move it there — same code, one-line location change; Task 3 covers both with a test that pins the behavior.)

## Phases

- **Phase 1 — Server provider wiring** (Tasks 1–3)
- **Phase 2 — Login UI + client flow** (Tasks 4–5)
- **Phase 3 — Integration tests & hardening** (Tasks 6–8)

---

### Task 1: Enable the Google social provider in `lib/auth.ts`

**Objective:** Make BetterAuth serve `/api/auth/sign-in/social?provider=google` → redirect to Google's consent screen.

**Files:**
- Modify: `lib/auth.ts:20` (add `socialProviders` option)
- Test: `tests/integration/google-oidc.test.ts` (new file)

**Step 1: Write failing test**

Create `tests/integration/google-oidc.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { auth } from '@/lib/auth';
import { testClient } from '../utils/test-client';

describe('Google OIDC — sign-in redirect', () => {
  it('302s to accounts.google.com when provider=google', async () => {
    const request = new Request(
      'http://localhost:3000/api/auth/sign-in/social?provider=google&callbackURL=http://localhost:3000/',
      { method: 'POST', headers: { Origin: 'http://localhost:3000' } },
    );
    const response = await auth.handler(request);
    expect(response.status).toBe(302);
    expect(response.headers.get('location') ?? '').toContain('accounts.google.com');
  });

  it('rejects an unknown provider', async () => {
    const request = new Request(
      'http://localhost:3000/api/auth/sign-in/social?provider=facebook',
      { method: 'POST', headers: { Origin: 'http://localhost:3000' } },
    );
    const response = await auth.handler(request);
    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});
```

**Step 2: Run test to verify failure**

Run: `npx vitest run tests/integration/google-oidc.test.ts`
Expected: FAIL — 405/404 or "unknown client id" (provider not registered; no redirect emitted).

**Step 3: Write minimal implementation**

In `lib/auth.ts`, add the import at top and the option inside `betterAuth({...})`:

```ts
import { google } from 'better-auth/social-providers';
```

```ts
export const auth = betterAuth({
  // ...existing options...
  socialProviders: {
    google: google({
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      // Default scopes (openid email profile) are fine; do not request offline access.
    }),
  },
});
```

**Step 4: Run test to verify pass**

Run: `npx vitest run tests/integration/google-oidc.test.ts`
Expected: 2 passed.

**Step 5: Commit**

```bash
git add lib/auth.ts tests/integration/google-oidc.test.ts
git commit -m "feat(auth): register google social provider in BetterAuth"
```

---

### Task 2: Verify the callback route is reachable (no code change expected)

**Objective:** Prove `/api/auth/callback/google` passes through `middleware.ts` without an auth redirect. This task is verification-only — if it fails, fix by confirming `PUBLIC_PATTERNS` in `middleware.ts` covers the path (it should, via `/api/auth`; do NOT add `callback` routes individually).

**Files:**
- Verify only: `middleware.ts`, route behavior via test below
- Test: `tests/integration/google-oidc.test.ts` (append)

**Step 1: Write test**

```ts
it('serves the google callback without an auth redirect', async () => {
  const request = new Request(
    'http://localhost:3000/api/auth/callback/google?code=fake-code&state=dummy-state',
    { headers: { Origin: 'http://localhost:3000' } },
  );
  const response = await auth.handler(request);
  // Fake code never reaches Google — we only assert the route is wired (4xx from
  // token exchange attempt, never a 302 to /login).
  expect(response.status).not.toBe(302);
});
```

**Step 2: Run test**

Run: `npx vitest run tests/integration/google-oidc.test.ts`
Expected: PASS (307/4xx is fine; a 302 to `/login` means middleware swallowed it — debug before proceeding).

**Step 3: Commit**

```bash
git add tests/integration/google-oidc.test.ts
git commit -m "test(auth): assert google callback route is public"
```

---

### Task 3: Enforce ban status for social sign-in

**Objective:** Banned users are rejected on Google sign-in with the same message/behavior as email sign-in; banned users whose ban has expired get the flag cleared.

**Files:**
- Modify: `lib/auth.ts:196-225` (extend the `hooks.before` middleware)
- Test: `tests/integration/google-oidc.test.ts` (append), `tests/utils/factories.ts` if it has no ban helper (check first — reuse `createAuthenticatedUser`)

**Step 1: Write failing test**

```ts
it('rejects a banned user on google sign-in', async () => {
  const { prisma } = await import('@/lib/db');
  const id = 'clx_banned_google_1';
  await prisma.user.upsert({ where: { id }, create: { id, name: 'B', email: 'banned.google@example.com' }, update: {} });
  await prisma.account.create({ data: { id: `${id}-acc`, accountId: `${id}-acc`, providerId: 'google', providerAccountId: 'g-sub-banned' } });
  await prisma.user.update({ where: { id }, data: { banned: true, banReason: 'Fraud', banExpires: new Date(Date.now() + 86400_000) } });

  // Simulate BetterAuth's socialSignIn after user resolution. The ban hook must
  // reject before a session is issued — we assert via the sign-in/social entry by
  // calling the same check function exported from lib/auth (see Step 3).
  const { enforceSocialBan } = await import('@/lib/auth');
  await expect(enforceSocialBan('banned.google@example.com')).rejects.toThrow(/Access denied/);

  // cleanup in finally/afterAll: delete account + user rows by id
});
```

**Step 2: Run test to verify failure**

Run: `npx vitest run tests/integration/google-oidc.test.ts -t banned`
Expected: FAIL — `enforceSocialBan is not a function`.

**Step 3: Write minimal implementation**

In `lib/auth.ts`, extract the existing ban logic into an exported helper (DRY — email path and social path share it), then call it from the `hooks.before` middleware on social paths:

```ts
export async function enforceBanStatus(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (user?.banned) {
    const now = new Date();
    if (user.banExpires && user.banExpires < now) {
      await prisma.user.update({
        where: { id: user.id },
        data: { banned: false, banReason: null, banExpires: null },
      });
    } else {
      const reason = user.banReason || 'Your account has been banned.';
      logger.warn({ userId: user.id, email }, `Banned user login attempt: ${reason}`);
      throw new APIError('UNAUTHORIZED', { message: `Access denied. ${reason}` });
    }
  }
}
```

Replace the inline logic in `hooks.before` with `await enforceBanStatus(ctx.body.email)` for the email path, and add:

```ts
if (ctx.path === '/sign-in/social') {
  // Google resolves user by provider sub; pre-check via linked Account rows
  const googleSub = ctx.query?.providerId ?? ctx.body?.providerId;
  if (googleSub) {
    const account = await prisma.account.findFirst({
      where: { providerId: 'google', providerAccountId: String(googleSub) },
      include: { user: true },
    });
    if (account?.user.email) await enforceBanStatus(account.user.email);
  }
}
```

> **Verification note:** Before finalizing, run `npx vitest run tests/integration` and confirm the exact location of the sub claim (`ctx.query` vs `ctx.body`) by inspecting what BetterAuth posts to `/sign-in/social` — adjust selector accordingly. If the hook fires before user resolution for *new* Google users (no Account row yet), that's acceptable: new sign-ups can't be banned pre-existing; extend the same check in a `socialProviders.google.onSuccess` hook for belt-and-braces only if the test shows a bypass.

**Step 4: Run tests to verify pass**

Run: `npx vitest run tests/integration/google-oidc.test.ts tests/integration/auth.test.ts`
Expected: all pass — email ban behavior unchanged, google ban rejected.

**Step 5: Commit**

```bash
git add lib/auth.ts tests/integration/google-oidc.test.ts
git commit -m "fix(auth): enforce ban status on google sign-in"
```

---

### Task 4: Wire the login page Google button to `signInSocial`

**Objective:** Clicking "Sign in with Google" initiates the OIDC redirect flow instead of showing the not-yet-connected notice.

**Files:**
- Modify: `app/login/page.tsx:232-236, 461-480` (drop `google` from `SSO_NOTES`, convert button)

**Step 1: Write minimal implementation**

In `app/login/page.tsx`:

```tsx
import { signInEmail, authClient } from '@/lib/auth-client'; // extend existing import

async function handleGoogleSignIn() {
  setError(null);
  setLoading(true);
  const callbackUrl = searchParams.get('callbackUrl') || '/';
  try {
    await authClient.signIn.social({ provider: 'google', callbackURL: `${window.location.origin}/login` });
    // BetterAuth redirects the browser to Google; on success it POSTs back to
    // /api/auth/callback/google then sends us to `redirect` param (see Step in
    // Task 4b below if a post-callback bounce is needed).
  } catch {
    setError('Google sign-in failed. Try again or use your password.');
  } finally {
    setLoading(false);
  }
}
```

Replace the Google button (line ~463):

```tsx
<button type="button" disabled={loading} onClick={handleGoogleSignIn} className={socialButtonCls}>
  <GoogleIcon className="h-[18px] w-[18px] text-slate-900" />
  Sign in with Google
</button>
```

Remove `google: '...'` from `SSO_NOTES` (keep `apple` and `reset`). No CSP change needed — the button uses the inline SVG.

**Step 2: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: clean pass.

**Step 3: Commit**

```bash
git add app/login/page.tsx
git commit -m "feat(login): wire google sign-in to BetterAuth social flow"
```

---

### Task 5: Preserve `callbackUrl` across the OAuth round-trip

**Objective:** A user signed in from `/login?callbackUrl=/dashboard/calendar` lands back on `/dashboard/calendar`, not `/`.

**Files:**
- Modify: `app/login/page.tsx` (post-callback handling inside `LoginForm`)

**Step 1: Write failing test (behavior spec)**

App Router pages are hard to unit-test in this repo's suite; pin behavior with an integration assertion on the redirect chain instead — create a tiny helper test in `tests/integration/google-oidc.test.ts`:

```ts
it('sign-in/social accepts callbackURL param and echoes it after auth', async () => {
  const request = new Request(
    'http://localhost:3000/api/auth/sign-in/social?provider=google&callbackURL=http%3A%2F%2Flocalhost%3A3000%2Fdashboard%2Fcalendar',
    { method: 'POST', headers: { Origin: 'http://localhost:3000' } },
  );
  const response = await auth.handler(request);
  // The state/token BetterAuth issues carries the callback; we assert it redirects
  // (not an error) when callbackURL is present.
  expect(response.status).toBe(302);
});
```

**Step 2: Run test**

Run: `npx vitest run tests/integration/google-oidc.test.ts`
Expected: PASS (BetterAuth bounces back to the app's sign-in/social caller; the client then navigates home). If BetterAuth lands on `/login` after the callback without the original param, implement task continuation below.

**Step 3: Implementation (only if Step 2 shows a bounce)**

Before starting the social flow in `handleGoogleSignIn`, stash the target:

```ts
sessionStorage.setItem('postAuthRedirect', callbackUrl);
```

In `LoginForm`'s existing `useEffect`s, add:

```ts
useEffect(() => {
  const target = sessionStorage.getItem('postAuthRedirect');
  if (target) {
    sessionStorage.removeItem('postAuthRedirect');
    router.replace(target);
  }
}, []);
```

(Skip if the param round-trips natively — YAGNI.)

**Step 4: Verify**

Run: `npx vitest run tests/integration/google-oidc.test.ts && npm run build`
Expected: pass.

**Step 5: Commit**

```bash
git add app/login/page.tsx tests/integration/google-oidc.test.ts
git commit -m "feat(login): preserve callbackUrl through google oauth round-trip"
```

---

### Task 6: Full-flow integration test with mocked OAuth exchange

**Objective:** Prove the complete loop — sign-in/social → (mocked Google token response) → callback → session cookie set + `Account` row created — without live Google credentials.

**Files:**
- Test: `tests/integration/google-oidc.test.ts` (append), use `@better-fetch/mock` (`createMockRequest`) which BetterAuth's test-utils are built around, plus `mockSocial` from `@better-auth/test-utils` if available in the installed version — check `node_modules/better-auth/dist/test-utils/` exports first and import whatever exists.

**Step 1: Write failing test**

```ts
import { createMockRequest } from '@better-fetch/mock';
import { mockSocialClient, socialProviders } from 'better-auth/test-utils'; // verify exact export names in node_modules/better-auth/dist/test-utils before writing — adjust import accordingly

describe('Google OIDC — full mocked flow', () => {
  it('creates a user + account row and returns a session for a new google identity', async () => {
    const { mock } = createMockRequest();
    const requestClient = (await auth.$test!.mock).createTestClient(mock); // see @better-auth/test-utils docs; fall back to posting to /api/auth/callback/google via auth.handler with mocked fetch if the helper API differs

    await requestClient.signIn.social({ provider: 'google' });

    const { data } = await requestClient.getSession();
    expect(data?.user.email).toContain('@google.example'); // mock identity from socialProviders.google mock in test-utils
    const acc = await prisma.account.findFirst({ where: { providerId: 'google' } });
    expect(acc).not.toBeNull();
  });
});
```

> **Implementation note:** The exact mock API varies between BetterAuth patch versions. Read `node_modules/better-auth/dist/test-utils/` (index exports) before writing, and use whatever the installed 1.6.23 exposes. If mocking the callback is not supported in this version, narrow scope: assert (a) redirect emitted, (b) a helper unit test around `enforceBanStatus`, and record the full-flow test as manual QA in Task 8 — do **not** fork BetterAuth to make mocks work.

**Step 2–4: Implement minimally / run until green**

Run: `npx vitest run tests/integration/google-oidc.test.ts`
Expected: all pass.

**Step 5: Commit**

```bash
git add tests/integration/google-oidc.test.ts
git commit -m "test(auth): full mocked google oidc sign-in flow"
```

---

### Task 7: Rate-limit and observability check

**Objective:** Confirm Google sign-ins are bounded like password logins, and that a structured log line marks each social success.

**Files:**
- Verify only: `app/api/auth/[...all]/route.ts` (POST rate limiting already applies to all POSTs incl. `sign-in/social`), `lib/auth.ts` (BetterAuth logs sign-ins via its own logger; add one explicit line in `onSuccess`)

**Step 1: Add success log hook**

Inside the google provider config in `lib/auth.ts`:

```ts
google: google({
  clientId: env.GOOGLE_CLIENT_ID,
  clientSecret: env.GOOGLE_CLIENT_SECRET,
  onSuccess: ({ user, account }) => {
    logger.info({ userId: user.id, email: user.email, isNewUser: !account?.id }, '[Auth] Google sign-in succeeded');
  },
}),
```

Adjust the `onSuccess` signature to what installed types require (check `node_modules/better-auth/dist/types/plugins/...social*.d.*`).

**Step 2: Verify rate limit applies**

Run: `npx vitest run tests/integration/rate-limiting.test.ts`
Expected: existing suite green; add one spec asserting `checkAuthRateLimit` is invoked for a POST to `/api/auth/sign-in/social` if the file's pattern makes that natural, otherwise document in the design doc only.

**Step 3: Commit**

```bash
git add lib/auth.ts tests/integration/rate-limiting.test.ts
git commit -m "chore(auth): log google sign-in success + confirm rate coverage"
```

---

### Task 8: Manual end-to-end verification (local dev, real Google credentials)

**Objective:** Prove the live flow works in a browser.

**Files:** none (verification only). Prerequisite: user supplies real `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` in `.env` with redirect URI `http://localhost:3000/api/auth/callback/google` registered in Google Cloud Console OAuth consent screen — **do not invent credentials; ask the user**.

**Step 1:** Run the dev server per repo conventions (check `package.json` scripts / docker entrypoint) and open `/login?callbackUrl=/dashboard`.
**Step 2:** Click "Sign in with Google" → complete Google consent → land on `/dashboard` with a session.
**Step 3:** Repeat with an existing user's email at Google → confirm the same `User` id is reused (check via Prisma `user` table, or admin user page), and a new `Account` row appears for a first login.
**Step 4:** Confirm logout (`components/auth/LogoutButton.tsx`) clears the session.

**Step 5: Commit**

```bash
git add .
git commit -m "chore(auth): e2e google oidc verified locally"
```

(Only if files changed during verification.)

---

## Full validation gate (after every phase)

```bash
npm run lint          # ESLint clean
npm run test          # full Vitest suite green
npm run build         # Next.js production build succeeds
npx tsc --noEmit      # typecheck (if not already covered by build)
```

## Files likely to change

| File | Change | Task |
|---|---|---|
| `lib/auth.ts` | +`socialProviders.google`, ban hook extension, `enforceBanStatus` extraction, success log | 1,3,7 |
| `app/login/page.tsx` | real Google button, drop google SSO notice, callbackUrl preservation | 4,5 |
| `tests/integration/google-oidc.test.ts` | new — redirect, callback reachability, ban, mocked flow | 1–6 |
| `.env.example` | comment tweak only (values already present) | optional |

## Tests / validation targets

- New: `tests/integration/google-oidc.test.ts`
- Regression-watch: `tests/integration/auth.test.ts`, `tests/unit/env.test.ts`, `tests/integration/rate-limiting.test.ts`

## Risks, tradeoffs, and open questions

1. **Account takeover via Google email match.** A malicious user controlling a mailbox matching an existing password-only account could claim that portal account by logging in with Google. Mitigation for v1: none beyond the reference project's precedent — flag to stakeholders; consider requiring `emailVerified` true + an admin approval step for first Google login on *existing* accounts (open question, deliberately out of scope).
2. **No hosted-domain restriction.** Google allows any Google account. If only `.gov.uk` addresses should be allowed, set `socialProviders.google.hostedDomain` — open question requiring a product decision.
3. **New users have no org.** A brand-new Google user has no `Member` row, so `activeOrganizationId` stays null (same as today's orphan email users). Acceptable in v1; provisioning flow is a separate feature.
4. **Mock API surface uncertainty** (`@better-auth/test-utils` exact exports in 1.6.23) — Task 6 has a documented fallback to avoid scope creep.
5. **Do not replicate the social-login reference's hand-rolled JWT/session code** — it solves problems BetterAuth already owns (cookie management, token rotation). Reference is for flow understanding only.
