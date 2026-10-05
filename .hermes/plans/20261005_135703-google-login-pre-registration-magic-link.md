# Google OIDC Pre-Registration + Magic Link Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Close registration — Google sign-in only succeeds for users an admin pre-registered (invited) with a magic link; on first Google sign-in the identity is linked to that invited account, inbox ownership is proven via the emailed link, and the user lands inside their assigned org + team.

**Architecture:** Builds directly on the shipped google-oidc work (branch `google-oidc`, Phase 1–3 complete: BetterAuth 1.6.23 `socialProviders.google` wired in `lib/auth.ts`, Prisma `Verification` table, ban enforcement at `databaseHooks.session.create.before`, live E2E verified). Three layers are added: (1) a magic-link gate on Google-only identities (`oidcVerified` column + custom verify route — the design doc's §4.3 mechanism, which was designed but never implemented), (2) an org/team assignment requirement enforced at the same session gate, and (3) admin invites: create-user modal gains mandatory org + optional team selection, plus "send / resend invite link" actions.

**Tech Stack:** Next.js App Router, BetterAuth 1.6.23 (`better-auth/minimal`), Prisma/PostgreSQL, nodemailer (`lib/notifications/email.ts`), Vitest (unit + integration suites with mocked OAuth).

**Design doc:** `documents/feature-planning-and-development/google-oidc-design.md` — read §4.3 (magic-link verification) and §5 first. This plan implements §4.3 verbatim where it overlaps and records deviations in a notes section as implementation proceeds.

---

## Current state (verified against the repo, 2026-10-05)

| Item | State |
|---|---|
| Google provider | `lib/auth.ts:98` — plain options object `{ clientId, clientSecret }` (NOT the `google()` factory — see prev plan Phase 1 note #1). Full flow + ban enforcement working; live E2E done 2026-10-04. |
| Session gate | `databaseHooks.session.create.before` in `lib/auth.ts` calls exported `enforceBanStatus(email)` (from earlier phases). This is our single enforcement point for the new gates too. |
| Prisma schema | `User` has `passwordHash?`, `emailVerified`, **no `oidcVerified`**. `Verification` model exists (`prisma/schema.prisma:178`) — reuse it for magic-link tokens. `Account` uses BetterAuth canonical fields (`accountId` = provider sub; do NOT rename). |
| Magic link | **Design doc §4.3 only — NOT implemented.** No `lib/oidc-magic-link.ts`, no verify route, no `oidcVerified`. This plan builds it. |
| Admin create user | `app/api/admin/users/route.ts` POST → `UserService.create(body, ctx)`. `CreateUserInput` has optional `organizationId`; platform admin path already creates a `Member` row + enrolls in the org's default "Members" team when an org is given (`services/user-service.ts:120-127`). Password is optional. |
| Admin modal | `app/dashboard/admin/users/page.tsx` — form at line 71 `{ name, email, password }`, org selection via `createOrgId` (orgs fetched from `/api/dashboard/admin/organizations`, teams already fetched for the *filter* dropdown). Submit builds body at ~line 263. |
| Teams | `TeamService.addTeamMember(teamId, { userId }, ctx)` exists (`services/team-service.ts:482`); tenant-admin-scoped (`runWithTenant`). Route `/api/dashboard/admin/teams` filters by org. |
| Email | nodemailer in `lib/notifications/email.ts`; SMTP env already in `lib/env-schema.ts:30-34`. External forwarder requirement (design §6 step 5) unchanged. |
| Rate limits | Auth POSTs go through `checkAuthRateLimit(ip)`; admin writes through `checkAdminRateLimit(userId)` — both reused, no changes. |

### Product decisions fixed by this plan (do not re-litigate)

1. **Invite-only Google login.** A brand-new Google identity must match an admin-pre-registered account (by email) AND have been assigned to at least one org before any session is issued. Self-signup of a fresh `User`+`Account` via first Google click → rejected with "contact your administrator" (no rows created).
   - **Deviation from design doc §4 / risk #1:** the doc's default v1 *case B* ("fresh Google identity matching an existing password-only local user → link + sign in") is now **blocked** in both directions by decision 3 below; only invited accounts are reachable. Recorded as a deviation for the next docs pass.
2. **Magic link proves inbox, it does not log in.** Exactly design §4.3: custom route consumes the token, sets `oidcVerified`, redirects to `/login?oidc=link-verified`; the user then clicks Sign in with Google again. The verify route **never mints a session**.
3. **Admin-created users (password or not) cannot sign in with Google until invited.** They have no `oidcVerified=true` and are not "invited" — case-B linking via email match is suppressed for them (gate condition: Google-only identity = has `Account(providerId:'google')`, no credential/`passwordHash` account, AND the linked user does not already exist pre-invitation… implemented as gate #3 below). Net effect keeps one simple rule.
4. **Team assignment at invite is optional** (default team enrollment via existing `enrollInDefaultMembersTeam` always happens — a specific team *replaces* that default path); **org is mandatory** for passwordless invites. Org-less users can exist with passwords (admin judgment) but their Google sign-in stays blocked by gate #3 until an org membership exists.
5. **Resend:** admins can resend the magic link from the user row at any time while `oidcVerified === false`. No auto-resending, no countdowns — YAGNI.

**Local-user guarantee (invariant):** email/password sign-in code path is untouched apart from the ban helper it already uses; `enforceBanStatus` keeps its signature and behavior.

---

## Phase 1 implementation notes — deviations from this plan (recorded 2026-10-05)

1. **Owner DSN required for schema push.** `prisma db push` with the app role fails (`must be owner of table User`) — RLS split roles. Used `SEED_RLS_DSN` from `.env` verbatim (the same pattern seed.ts documents); the user-provided `postgres:postgres` string did not authenticate on this DB.
2. **Gate placement as planned** — `enforceOidcProvisioning(userId)` in `lib/auth.ts`, called inside existing `databaseHooks.session.create.before` right after `enforceBanStatus`. No-op for users without a google Account row (local login invariant pinned by the new email-sign-in regression spec, not just asserted).
3. **No user-input changes; ban order preserved** — ban check runs first (existing 401 UX unchanged), provisioning gate second. A banned + unverified user sees the ban message, not an invitation email (no pointless mail for a banned identity).
4. **Test harness: ESM live-binding issue** — `vi.spyOn` on `sendEmail` cannot intercept `lib/oidc-magic-link`'s import (ESM named binding), so the integration file uses a hoisted `vi.mock('@/lib/notifications/email')` recorder (`sentInvites` array) instead of the plan's "spy on it" seam.
5. **Local regression spec seeds a credential Account** (`providerId:'credential'`, accountId=userId) via `hashPassword` — matches `tests/utils/factories.ts`; BetterAuth's password path reads this, not `User.passwordHash`.
6. **Stranger identity: User+Account rows are committed by BetterAuth before the session hook fires** (verified in spec 1: rejection returns 401, no Session row, orphan User+Account remain). Harmless per risk #1 — every gate re-check keeps them locked out permanently; cleanup job deferred.

---

## Phase overview (Phase 1 ✅ complete — tasks T1-T3 done & committed; exit gate green)

- **Phase 1 — Magic-link gate** (Tasks 1–3): schema column, issue/consume helpers, session-gate rejection with email send. Exit: new Google identity → no session, token in `Verification`, email sent via mock; verify route consumes + sets flag.
- **Phase 2 — Admin invite flow** (Tasks 4–6): create-user API accepts `teamId` + sends link on passwordless create; resend action endpoint; modal UI (mandatory org, team select, "link emailed" feedback). Exit: end-to-end admin → user gets invited user in org+team with pending magic link. ✅ complete — implementation notes below (2026-10-05)
- **Phase 3 — Login UI + not-provisioned path** (Tasks 7–8): login page banners (`oidc=…`), same-origin `callbackUrl` guard, distinct "not provisioned" message. Exit: build/lint/tests green; all three banner states render.
- **Phase 4 — Hardening & live E2E** (Task 9): rate-limit spec for verify route, full mocked-flow integration test matrix, live manual checklist against real Google. Exit: full gate green (`npm run lint && npm run test && npm run build`) + manual checklist passes.

## File map

- Modify: `prisma/schema.prisma` (User column)
- Create: `lib/oidc-magic-link.ts` (issue/consume token helpers — pure functions taking a prisma client, SMTP seam swappable for tests)
- Create: `app/api/dashboard/admin/users/[id]/invite/route.ts` (resend/super-admin)
- Modify: `lib/auth.ts` (session gate: unverified + not-provisioned checks; success log untouched)
- Modify: `services/user-service.ts` (`CreateUserInput.teamId`, team enrollment branch, return extended shape? NO — keep `user` + add magicLinkSent flag in the *route* layer only)
- Modify: `app/api/admin/users/route.ts` (passwordless → issue link; validation for team belongs to org; 202 response)
- Create: `app/auth/magic-link/verify/route.ts` (GET, public)
- Modify: `middleware.ts` (add `/auth/magic-link/verify` to PUBLIC_PATTERNS)
- Modify: `app/dashboard/admin/users/page.tsx` (modal + row actions)
- Modify: `app/login/page.tsx` (banners + callbackUrl guard)
- Create: `tests/unit/oidc-magic-link.test.ts`, extend `tests/integration/google-oidc-full-flow.test.ts`, new `tests/integration/user-invite-flow.test.ts`
- Docs: `.hermes/plans/20261005_135703-google-login-pre-registration-magic-link.md` (this file — append deviation notes), then a pass over the design doc's §4 status

---

## Phase 1 — Magic-link gate

### Task 1: `oidcVerified` column + migration

**Objective:** Persist "magic link clicked" per user.

**Files:**
- Modify: `prisma/schema.prisma:114-133` (User model)
- Test: `tests/unit/` — no direct test; schema compiles.

**Step 1: Add column** after `activeOrganizationId` in the `User` model:

```prisma
  // Design §4.3: true only when the user completes magic-link verification.
  @default(false); emailVerified is asserted by Google on sign-up and CANNOT be used for this.
  oidcVerified        Boolean   @default(false)
```

**Step 2: Apply** per repo convention (no migration history tracked — README):

```bash
npx prisma db push && npx prisma generate
```

**Step 3: Verify**: `npm run build` (tsc regenerates types; no new type errors anywhere). Expect: clean.

**Step 4: Commit** `git add prisma/schema.prisma && git commit -m "feat(auth): add User.oidcVerified magic-link marker column"`.

### Task 2: Magic-link issue/consume helper

**Objective:** One module owns token lifecycle — insert into `Verification`, send email, atomic consume. Pure over an injected `prisma` + email seam so tests swap a stub sender (same seam pattern the design doc §9 calls for).

**Files:**
- Create: `lib/oidc-magic-link.ts`
- Test: `tests/unit/oidc-magic-link.test.ts`

**Step 1: Write failing test** — covers: issue → row with `identifier=token`, `value` JSON contains `email` + `kind:'oidc-invite'`, `expiresAt ≈ now+5min`; email seam called once with url `${FRONTEND_URL}/auth/magic-link/verify?token=<token>` and the user's name/email; consume(valid token) → row deleted, returns `{ ok: true, email }`; consume(wrong token / expired / already-consumed) → `{ ok: false, reason: 'invalid' | 'expired' }`, no partial state; tokens are 32+ char random strings (assert length ≥32 and two issues differ).

**Step 2: Run** `npx vitest run tests/unit/oidc-magic-link.test.ts` — expect FAIL (module missing).

**Step 3: Implement** (shape — adapt imports to the real Prisma client from `lib/env.ts`-adjacent module used elsewhere, e.g. how `lib/auth.ts` imports prisma):

```ts
// lib/oidc-magic-link.ts
import { generateRandomString } from 'better-auth/crypto'; // confirmed available in 1.6.23 (used by magicLink plugin)
import { env } from '@/lib/env';
import prisma from '<existing canonical Prisma client import used by services>';

export interface InviteIssueResult { ok: true; token: string; url: string } | { ok: false; error: string };

const TOKEN_TTL_MS = 5 * 60 * 1000; // design §4.3 default

/** Email seam — real implementation wraps lib/notifications/email.ts;
 *  tests replace this with vi.spyOn. */
export async function sendInviteEmail(params: { email: string; name?: string; url: string }): Promise<void> { /* nodemailer, CTA button "Activate account" */ }

export async function issueInviteLink(user: { id: string; email: string; name: string }): Promise<InviteIssueResult> {
  const token = generateRandomString(32);
  const url = `${env.FRONTEND_URL}/auth/magic-link/verify?token=${token}`;
  try {
    await prisma.verification.create({ data: { identifier: token, value: JSON.stringify({ email: user.email, kind: 'oidc-invite' }), expiresAt: new Date(Date.now() + TOKEN_TTL_MS) } });
    await sendInviteEmail({ email: user.email, name: user.name, url }).catch(err => logger.error(...)); // log+swallow: link issued even if SMTP blips; admin can resend
    return { ok: true, token, url };
  } catch (err) { ... return { ok: false, error: '...' } }
}

export async function consumeInviteToken(token: string): Promise<{ ok: boolean; email?: string; reason?: 'invalid' | 'expired' }> {
  const now = new Date();
  // Atomic claim: fetch + delete where identifier=token AND expiresAt>now. Delete returns undefined on miss → invalid.
  const row = await prisma.verification.deleteMany({ where: { identifier: token, expiresAt: { gt: now } } });
  if (row.count === 0) return { ok: false, reason: 'invalid' }; // covers unknown + spent + expired-for-us-distinguishing-expired-optional
  const email = JSON.parse(row… no — parse from fetched row; fetch first then delete in a transaction for the value. Use $transaction([findUnique, deleteMany]) and branch expired vs invalid.
}
```

(Implementer: use `prisma.$transaction` with `findUnique` + conditional `delete` so "expired" is reportable distinctly from "never existed"; keep it two-statement — enumeration isn't a realistic threat per design §5.2.)

**Step 4: Run test** — expect PASS. **Step 5: Commit.**

### Task 3: Enforce the gate at session creation

**Objective:** No Google-only identity gets a session until invited + verified + org-assigned. One function, three ordered checks, called from the existing `session.create.before` hook.

**Files:**
- Modify: `lib/auth.ts` (new exported helper next to `enforceBanStatus`; hook call-site after ban check)
- Test: extend `tests/integration/google-oidc-full-flow.test.ts` (uses the real handler + mocked fetch pattern established in Phase 3 — copy that harness; `vi.spyOn(globalThis, 'fetch')` on token exchange, `alg:none` id_token, state read from `Verification`)

**Step 1: Write failing tests** (4 new specs):
1. **Unverified invited user** — pre-seed `User` (oidcVerified=false) + `Account(google, sub)`; simulate callback → expect 401 `Access denied.` with magic-link hint in message, **no Session row**, email seam called once.
2. **Verified but no org membership** — same seed + `oidcVerified=true`, no `Member` row → 401 "not provisioned" variant message (gate #3).
3. **Fully invited user** — Member row exists → session created, cookie set (the happy path that replaces today's open implicit sign-up).
4. **Brand-new stranger identity** (no User pre-seeded) → BetterAuth would create rows; after our gate: assert **no Session**, and either no new User row OR the created row immediately has no usable access — simplest to assert: 401 + response message contains "not provisioned"/"invitation", AND zero `Session` rows. (If BetterAuth commits the User+Account rows before hook rejection in 1.6.23, pin that too and note it: orphan rows for strangers are harmless because every future gate keeps them out; record as implementation note #?.)

**Step 2: Run** — expect FAIL.

**Step 3: Implement** in `lib/auth.ts`:

```ts
export async function enforceOidcProvisioning(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { accounts: { select: { providerId, password: true, idToken: true } }, members: { select: { orgId } } } });
  if (!user) return; // ban hook already guards null; defensive
  const googleAcc = user.accounts.find(a => a.providerId === 'google');
  const localAcc = user.passwordHash || user.accounts.some(a => (a.providerId !== 'google') && (a.password || a.idToken || a.accountId === user.id));
  if (!googleAcc || localAcc) return; // email/password sign-ins pass untouched — invariant
  if (!user.oidcVerified) { await issueInviteLink(user); throw new APIError('UNAUTHORIZED', { message: 'Access denied. We need to confirm your email first — check your inbox for a verification link, then try signing in with Google again.' }); }
  if (user.members.length === 0) throw new APIError('UNAUTHORIZED', { message: 'Access denied. This account has not been provisioned by an administrator yet. Contact your portal administrator.' });
}
```

Call site — inside the existing `databaseHooks.session.create.before`, after `await enforceBanStatus(user.email);`:
`await prisma… (pass id) → await enforceOidcProvisioning(session.userId);`

Note: `issueInviteLink` send must never throw into the auth pipeline beyond the APIError above — helper logs and swallows SMTP failures (Task 2 contract).

**Step 4: Run full integration file** `npx vitest run tests/integration/google-oidc-full-flow.test.ts` — expect existing specs may need seed updates: the old "new identity → session" spec now expects rejection. **Update those legacy specs to the invited-user shape and keep one new-stranger spec as negative.** This update IS part of Task 3 (the behavior change is the whole point — pin it).

**Step 5: Run unit suite** `npx vitest run tests/unit` (auth-config mock Prisma needs `user.findUnique` with include + `member`, `verification` models mocked — extend as in Phase 1 note #4 of the old plan). **Step 6: Commit.**

---

## Phase 2 — Admin invite flow

### Task 4: API — create user with org (required for no-password) + team + auto magic link

**Objective:** `POST /api/admin/users` enforces the product rule and issues the link server-side.

**Files:**
- Modify: `services/user-service.ts:28` (`CreateUserInput`), `:49-130` (create body)
- Modify: `app/api/admin/users/route.ts:70-143` (POST)
- Test: `tests/integration/user-invite-flow.test.ts` (new; pattern: real route handler POST with a super-admin session cookie — reuse the harness from `tests/integration/auth.test.ts`/admin routes tests that already do requireSuperAdmin setup)

**Step 1: Failing specs:**
- passwordless + no org → 400 (`organizationId required for users without a password`).
- passwordless + valid org (+ optional teamId in that org) → 202, `user` created, `Member(row)` exists, team enrollment as requested (default team when absent), **email seam called** with verify url, response body `{ user, magicLinkSent: true }`.
- teamId from a *different* org → 400.
- with password (org optional) → identical to today: 201, no email sent, `magicLinkSent: false` (or absent).

**Step 2: Implement.**
- `services/user-service.ts`: extend `CreateUserInput { teamId?: string }`. In the org-membership branch (`:120`, and mirror TENANT_ADMIN branch at `:107`), replace unconditional `enrollInDefaultMembersTeam` with: if `teamId` → `TeamService.addTeamMember(teamId, { userId }, tenantCtx)` **after** ensuring a `Member` row (addTeamMember may not create the Member itself — verify against `services/team-service.ts:482`; if it requires Membership, order accordingly); else keep `enrollInDefaultMembersTeam`.
- route layer (`app/api/admin/users/route.ts`): after `UserService.create`, if `!body.password`: validate org presence (400 earlier, before create), call `issueInviteLink(user)`, respond `{ user, magicLinkSent: issueResult.ok }` with 202. Keep audit log (`user.created`) and add a second `recordAuditLog({ action: 'user.invite-issued' })`. SMTP failure ⇒ still 201 + `magicLinkSent: false` (admin resends).

**Step 3: Run specs, pass, commit** `feat(admin): invited users — org/team at creation + magic link on passwordless create`.

### Task 5: Resend invite endpoint

**Objective:** `POST /api/dashboard/admin/users/[id]/invite` re-issues the link while pending.

**Files:**
- Create: `app/api/dashboard/admin/users/[id]/invite/route.ts`
- Test: extend `tests/integration/user-invite-flow.test.ts`

**Step 1: Specs** — super-admin session; existing user → 200 + seam called; unknown id → 404; already `oidcVerified=true` → 200 `alreadyVerified: true` (no email, idempotent); non-super-admin → 403/401 via `requireSuperAdmin`.

**Step 2: Implement** — mirror the create-route's auth scaffolding verbatim (`requireSuperAdmin`, `checkAdminRateLimit(session.user.id)`, `withPlatformContext`), then `prisma.user.findUnique` + `issueInviteLink(user)`; audit `user.invite-resent`. Response `{ resent: boolean | 'already-verified' }`.

**Step 3: Run, commit.**

### Task 6: Admin modal UI

**Objective:** Create-user modal enforces/flows the new rules; user row gets invite visibility + resend action.

**Files:**
- Modify: `app/dashboard/admin/users/page.tsx` (form state line ~71, submit ~263, form markup ~590-620)

**Steps (implementer verifies line numbers against current file):**
1. Org select becomes **required when password field is empty** — client-side guard on submit + inline validation text; disable team select until an org is chosen (reuse the already-fetched `teams` list filtered by `createOrgId`).
2. New optional **team dropdown** in the modal (data source: existing `fetchTeams` scoped to `createOrgId`; reset when org changes).
3. On 202 response with `magicLinkSent` → success notice *"A sign-in email has been sent to {email} — they can now activate Google sign-in."* When password given, keep today's wording.
4. User row (detail modal or table cell, whichever hosts ban/delete actions): if `!user.oidcVerified && !user.passwordHash` show "Invite pending" chip + **Resend invite link** button → POST the Task 5 endpoint; on success toast; on `already-verified` clear the chip.
5. Extend the page's local `User` interface (line ~10) with `oidcVerified?: boolean; passwordHashPresent?` — GET listing: confirm `UserService.list` projection includes/omits what we need (it must NOT leak `passwordHash`; a derived boolean is fine if the service already returns one, else add it — grep the list select block).

**Verification:** `npm run build && npm run lint`; manual dev-server click-through (dev DB): create user without password + org → notice shown; with team → membership row visible in the teams filter; resend button works. **Commit** `feat(admin-ui): invite-aware create-user modal + resend action`.

---

## Phase 3 — Login UI completion

### Task 7: Login page banners + callback guard

**Objective:** User-facing states for the new gates.

**Files:**
- Modify: `app/login/page.tsx`

**Steps:**
1. Consume `?oidc=…` param on mount (one-shot, strip via `router.replace`, same aria-live region style as existing banners):
   - `oidc=link-verified` → success banner "Email verified — click Sign in with Google to finish activating your account."
   - `oidc=link-expired`/`unknown` → info banner "That invite link has expired or is invalid — ask your administrator to send a new one." (from the verify route's miss path, Task 9 wiring sets this param).
2. The gate's 401 messages flow back through the callback round-trip and surface via the existing alert region — ensure the banned-banner detector (`isBanned`) doesn't swallow the two *new* messages into a "banned" state: check by message content (the magic-link one contains "check your inbox"; provisioned one contains "provisioned") → render them verbatim as warnings. Pin with a unit spec if `app/login/page.tsx` logic is testable as pure functions; otherwise extend the integration flow test that asserts the 401 body text.
3. Same-origin `callbackUrl` guard: validate `new URL(callbackUrl, window.location.origin).origin === window.location.origin` **and** starts with `/` (relative form) — reject → fallback `/`. Applied before passing to `authClient.signIn.social`.

**Verification:** build + lint; manual: hit each banner state in dev. **Commit.**

### Task 8: Verify route + public middleware entry

**Objective:** The link destination.

**Files:**
- Create: `app/auth/magic-link/verify/route.ts` (GET)
- Modify: `middleware.ts` (`PUBLIC_PATTERNS`)
- Test: extend `tests/integration/user-invite-flow.test.ts`

**Steps:**
1. **Specs:** token → 307/302 Location `/login?oidc=link-verified`; replay same token → `link-expired` param; expired row (seeded) → `link-expired`; IP-rate-limited (exhaust `checkAuthRateLimit`) → 429, token preserved.
2. **Route:** `checkAuthRateLimit(ip)` first; `consumeInviteToken(token)`; on ok → `prisma.user.update({ where: { email }, data: { oidcVerified: true } })` inside the same transaction as consume if convenient (helper exposes it) — else sequential with a defensive check; redirect to `/login?oidc=link-verified`. **No session, no cookie.**
3. `middleware.ts`: add `/auth/magic-link/verify` to `PUBLIC_PATTERNS` (the existing pattern list uses prefixes — read the block at line ~7 and match its exact style).
4. Run + commit.

---

## Phase 4 — Hardening & live E2E

### Task 9: Full matrix test + live checklist

**Steps:**
1. **Rate-limit spec:** in `tests/integration/rate-limiting.test.ts` add the verify-route GET case mirroring the social sign-in ones added in old-plan Task 7 (N+1th → 429).
2. **Flow matrix** — ensure `google-oidc-full-flow.test.ts` covers, asserting Session/Account/User/Verification/Member rows after each: stranger rejected (Task 3 spec); invited + unverified → link; after consume → sign-in succeeds; banned invited user rejected *before* email send (order: ban first); returning verified user → session, no re-email.
3. **Full gate:** `npm run lint && npx tsc --noEmit && npm run test && npm run build` — all green.
4. **Live manual checklist** (real Google credentials; dev DB): admin creates `x@y.z` with no password → email arrives (external forwarder! first diagnostic if it doesn't); user clicks "Sign in with Google" from the portal login page with that account → 401 message + fresh link; click emailed link → `link-verified` banner; sign in again → lands in `/dashboard` inside the assigned org, team membership visible; resend works pre-click; stranger Google account → "contact your administrator".
5. **Docs:** append Implementation Notes to this plan file (deviations: e.g. Task 3 step 1 spec #4 orphan-row finding; any route-status differences); then update `documents/feature-planning-and-development/google-oidc-design.md`: §4.1 case B row → "blocked for v1 pre-registration (superseded by this plan)", §8 status, add a short §11 pointing at this plan.
6. **Commit** `test(auth): full pre-registration matrix + live E2E notes` (+ docs commit).

---

## Phase 2 implementation notes — deviations from this plan (recorded 2026-10-05)

7. **Two create routes exist — both wired.** The plan targeted `app/api/admin/users/route.ts`, but the admin dashboard UI actually POSTs to `/api/dashboard/admin/users` (a second, older create route). The shared enforcement now lives in `UserService.create` (org required for passwordless + teamId cross-org check BEFORE any rows are written), and BOTH routes apply it. Behavior is identical at every layer; the integration file pins both entry points (including a 400 via the admin route).
8. **Dashboard create route: de-duplicated team enrollment.** The old dashboard route re-ran its own "find `members` slug team + addTeamMember, swallow errors" block AFTER `UserService.create` had already enrolled in the default team — a double path that conflicted with the new teamId branch (a requested-team invite would get force-added to Members too). Removed: `UserService.create` now owns the single membership/enrollment path. The dashboard route's old `notifyUserOperation` SSE push was preserved and re-pinned with a spec.
9. **`magicLinkSent` is delivery-aware.** `issueInviteLink` now returns `{ ok, token, url, emailSent }`; routes set `magicLinkSent = issueResult.ok && issueResult.emailSent`. Status semantics: 202 = invite + email delivered; 201 with `magicLinkSent:false` = user created but delivery failed (token still in DB — resend works). This refines the plan's "SMTP failure ⇒ 201" note into an explicit field. The unit seam from Phase 1 note #4 is reused: hoisted module mock, recorder array.
10. **Resend response is `resent`-aware too.** `POST /api/dashboard/admin/users/[id]/invite` returns `{ resent: <bool> }` (false when the token was persisted but email delivery failed) or `{ alreadyVerified: true }`. The UI toast branches on both; `alreadyVerified` clears the chip via list refetch.
11. **Team lookup is exact-id (`team.findUnique`) with an org cross-check** inside a `runWithTenant(targetOrg)` — matches plan risk #2 (service-layer, not route-layer only). The service passes a ctx with the verified team's org to `TeamService.addTeamMember` so its `contextOrgId` fallback never depends on an unset platform-org env (this is what broke in mock envs when ctx carried no organizationId; it also hardens the real path where `/api/admin/users` builds ctx.organizationId from the body).
12. **GET list leak fix (plan Task 6 step 5).** `UserService.list` returned full User rows → `passwordHash` was being shipped to the browser. The dashboard GET route now strips it and emits `passwordHashPresent: boolean`; the page uses that (+ `oidcVerified`) for the "Invite pending" chip = `!passwordHashPresent && oidcVerified === false`.
13. **UI placement.** Chip + Resend live in the table (Status cell / row actions), matching the plan's "whichever hosts ban/delete actions" — those actions are on row cells here, not the detail modal. Team dropdown reuses the page-level `teams` fetch (org-scoped filter, reset when org changes); required-star and hint text appear only when password is empty per product decision #4. Success banner reuses the error-banner auto-dismiss pattern (`role=status`, aria-live polite).

**Exit gate (2026-10-05):** `npm run lint` ✔ · `npx tsc --noEmit` ✔ · `npm test` — 1926/1926 across 90 files ✔ (incl. new `tests/integration/user-invite-flow.test.ts`, 11 specs) · `npm run build` ✔. Commits: `2f91f7e` (Task 4), `a4efcf6` (Tasks 5 + delivery-aware), `c9ad86a` (Task 6 UI). Manual dev-server click-through deferred to Phase 4's live checklist (step 4) per the plan.

---

## Risks & open questions

| # | Risk / note | Severity | Mitigation |
|---|---|---|---|
| 1 | BetterAuth may persist User+Account rows for strangers *before* the session hook fires (hook can't un-create). Harmless: every gate keeps them locked out forever; they're indistinguishable from invited-pending users to the API. Pin actual behavior in Task 3 and document. | Low | Test pins it; optional cleanup job later (out of scope) |
| 2 | `teamId` cross-org attack surface (admin passes team from org A, user for org B) | Med | Task 4 spec: 400 on mismatch; service-layer check, not just route-layer |
| 3 | External mail forwarder still required per user (design §6.5) — invited users can't receive the link until forwarding exists | High (operational) | Runbook unchanged; modal notice tells admin "if no email within a few minutes, check forwarding" |
| 4 | Case-B behavior change breaks anyone relying on linking an existing password user to Google in dev (old live E2E created such accounts?) | Low | Old E2E accounts are stranger-linked — they now hit the provisioned gate; unban/reinvite via admin UI if needed. Note recorded in docs task |
| 5 | `issueInviteLink` from inside a BetterAuth DB hook: SMTP latency adds to callback wall-time | Low | Helper swallows + logs send failures (Task 2 contract); consider fire-and-forget with bounded await — keep awaited in v1 for deterministic tests, note as follow-up if slow |

**Explicit non-goals:** password-reset changes; domain allowlists; account-merge UI; auto-resend scheduling; Apple sign-in.
