# Public-Internet Bearer Access via Better Auth Domain/Origin Filtering — Multi-Phase Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Make the portal publicly reachable (LAN IP today, internet domain tomorrow) with remote clients authenticating as Google-OIDC users or script clients using `Authorization: Bearer <token>`, by fixing exactly how better-auth@1.6.23 filters on domains/origins — without disabling CSRF for all traffic.

**Context / why we are here:** Task 7 of the bearer-token plan failed the manual smoke: a remote computer cannot reach the server and gets an "invalid URL" class of error. The `bearer()` plugin is already registered (`lib/auth.ts`) and works in-process (tests 6/6 green). The blocker is host/origin filtering, plus possibly network/Google-redirect issues — to be pinned down in Phase A.

**Tech Stack:** Next.js App Router, better-auth@1.6.23 (verified against installed `node_modules` dist), Prisma/PostgreSQL, Vitest integration tests, existing `middleware.ts` (CSP + session-cookie gate).

---

## How better-auth@1.6.23 filters on domains (ground truth from installed source)

Three independent gates exist; the "invalid URL" symptom comes from one of them:

| Gate | Where in dist | Triggers when… | Error |
|---|---|---|---|
| 1. Base-URL resolution | `dist/auth/base.mjs` + `dist/utils/url.mjs` (`resolveDynamicBaseURL`) | `baseURL: { allowedHosts: [...] }` is set AND the incoming Host (or `x-forwarded-host` if trusted) matches no pattern and no `fallback` is set | 500 `BetterAuthError: Host "…" is not in the allowed hosts list.` — **this is the most likely source of the user's "invalid URL"** if an allowlist was tried |
| 2. Origin/CSRF check | `dist/api/middlewares/origin-check.mjs` (`validateOrigin`) | Any non-GET request that carries a **cookie** or browser **Sec-Fetch-\*/Origin/Referer** headers, and the Origin header is not in `trustedOrigins` (default = base origin per-request) | 403 `INVALID_ORIGIN` "Invalid origin" / `MISSING_OR_NULL_ORIGIN` |
| 3. Callback/redirect allowlist | same file (`validateURL`) | Body/query carries `callbackURL`/`redirectTo` not matching trusted origins | 403 `INVALID_CALLBACK_URL` etc. |

Key facts verified (not guessed):
- **No `baseURL` set (our current state):** base origin is derived from the incoming request URL per-request (`getBaseURL(...)`, `base.mjs:19-27`). No host block exists today — a curl to any reachable IP already reaches better-auth (observed: `http://<lan-ip>:3000/api/auth/get-session` answered `null`, sign-in returned credential JSON, not a host/origin block).
- **`allowedHosts: ["*"]` is accepted and matches everything** — verified by running the installed `wildcardMatch("*")` against `192.168.2.8`, `example.com:3000`, `localhost:3000`, `foo.bar.com`. (The "Better Auth blocks a bare `*`" claim in earlier research is not true for 1.6.23.)
- **Dynamic trusted origins:** `options.trustedOrigins` accepts an async `(request) => string[]` and is called with the real incoming request on both static and dynamic base-URL paths (`dist/context/helpers.mjs:60-86`, `base.mjs:29`).
- **Native env var:** better-auth itself reads `BETTER_AUTH_TRUSTED_ORIGINS` (comma-separated) — no app code needed for an allowlist (`helpers.mjs:83-84`).
- **Cookieless browser-less clients bypass gate 2 entirely:** if there is no cookie and no Sec-Fetch/Origin header, `validateOrigin` returns immediately (`origin-check.mjs:106`). Bearer over curl/server-to-server needs no origin allowlisting at all.
- **`advanced.trustedProxyHeaders`:** with dynamic base-URL config it defaults to `true` (`helpers.mjs:106-108`); `x-forwarded-host`/`x-forwarded-proto` are trusted then. Static path also honors them when set.
- **CORS:** better-auth emits no CORS headers at all (only the unregistered mcp plugin does) — pinned by our Task 6 test. Browser cross-origin reads require our own `middleware.ts` work; server-to-server needs none.
- **`jwt()` plugin exists** in dist, but adds a second, non-revocable token system on top of our already short-lived (1h max / 15-min renewal) revocable session tokens — not justified for v1 (design doc §5.2: no JWT subsystem).

**Deliberate anti-pattern we will NOT ship** (from the pasted research): a global `trustedOrigins: async (req) => [req.headers.get("origin")]` echo + blanket CORS origin echo. That makes *any* website able to submit cookie-bearing auth requests against our server from a victim's browser (cross-site sign-out, cookie session fixation at login) — i.e., it turns gate 2 into a no-op for the exact traffic CSRF protection covers, and would break the Task 5/6 pins (no-CORS assertion, ban-gate invariants). We keep the cookie door same-origin/allowlisted; cross-domain access goes through **bearer headers**, which are CSRF-immune by construction.

---

## Phase A — Diagnosis ✅ RESOLVED (2026-10-08, class (a))

**Observed (remote computer):** site loads over `http://<mac-lan-ip>:3000`, login page renders (static pages skip the gate), but sign-in POST with valid credentials returns **403 INVALID_ORIGIN**.

**Root cause (verified in `.env` + installed source):** line 45 of `.env` sets
```
BETTER_AUTH_URL="http://localhost:3000"
```
With a static base, `createAuthContext` freezes `ctx.options.baseURL = "http://localhost:3000"` (dist `context/create-context.mjs:85`) and the handler never re-derives it per request (`dist/auth/base.mjs:19` — the resolve-from-request branch only runs when `baseURL` is unset). Trusted origins therefore contain **localhost only** (`helpers.mjs:73-74`). A remote browser sends `Origin: http://<mac-lan-ip>:3000` → not trusted → `INVALID_ORIGIN`. Bearer/curl traffic was unaffected (no Origin header → gate returns early); only the browser door over a non-localhost origin breaks. Never visible in vitest because `isTest()` skips origin checks (`create-context.mjs:210`).

**Fix:** Phase B Task B2's dynamic `baseURL` (`allowedHosts: ['*']` + fallback) — the dynamic path ignores `BETTER_AUTH_URL` entirely (verified: `resolveBaseURL` only reads that env on the static path, `url.mjs:68-73`), and the base + trusted origins resolve from each incoming request, so localhost and LAN IP both work simultaneously. **Task B2 gains a prerequisite step:** comment out `.env:45` (leave it as a reference note). Tasks A1/A2 below remain as the post-fix remote verification battery.

---

## Phase A-cont. — Remote verification battery (post-fix)

**Objective:** Re-run from the non-localhost client to confirm resolution. No source changes.

### Task A1: Remote-interface probe battery
Run from this Mac (server assumed running on `http://<lan-ip>:3000`):
```bash
IP=$(ipconfig getifaddr en0)
# 1) health over LAN interface
curl -s -o /dev/null -w '%{http_code}\n' "http://$IP:3000/api/health"
# 2) cookieless bearer-style call
curl -s -w '\n%{http_code}\n' "http://$IP:3000/api/auth/get-session" -H "Authorization: Bearer ***"
# 3) sign-in over LAN IP (expected: credential JSON, NOT a host/origin error)
curl -s -w '\n%{http_code}\n' "http://$IP:3000/api/auth/sign-in/email" -H 'content-type: application/json' -d '{"email":"x","password":"***"}'
# 4) from the actual remote computer (user runs): same battery against this machine's LAN IP; if it fails at TCP level -> network/port issue, not better-auth
nc -vz <mac-lan-ip> 3000
```
Expected: (1) 200, (2) 200 `null`, (3) 401 JSON. If any step returns a host/origin error, record its **exact body** — that is the spec for Phase B config.

### Task A2: Classify and record
Record in this plan's Task 7 area (append to `.hermes/plans/20261008_105030-bearer-token-remote-access.md` §Task 7 result block): which of the three failure classes applies — (a) better-auth host/origin gate, (b) TCP unreachable from remote network (NAT/firewall), (c) Google redirect mismatch ("Invalid URI" from Google, i.e. the OIDC door). Fix scope:
- (a) → Phase B
- (b) → Phase C (exposure + proxy headers); note macOS firewall / LAN segmentation check with user
- (c) → Phase C step 3 (Google console URIs)

**Commit:** none (diagnosis only).

---

## Phase B — Domain/origin filtering configuration (TDD) ✅ DONE (2026-10-08, commit 10583b5)

**Objective:** Make base-URL and origin policy explicit, per-host-dynamic, and env-tunable for the future public domain — with tests pinning that a request arriving on an *external* host behaves identically to loopback.

Config changes are **small and additive**; they do not alter cookie semantics (sameSite=lax stays) and do not open CORS.

### Task B1: Failing test — external-host requests behave like loopback
**Files:** Modify `tests/integration/bearer-tokens.test.ts` (append).

Add a describe block using the shared sign-in helper, targeting an external-style host:
```ts
describe('bearer over a non-localhost host (public-access pin)', () => {
  it('sign-in + get-session work on an arbitrary reachable host, cross-host session replay included', async () => {
    const res = await auth.handler(
      new Request('http://remote-client.example.com/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
      }),
    );
    expect(res.status).toBeLessThan(300);
    const token = res.headers.get('set-auth-token');
    expect(token).toBeTruthy();

    // replay the SAME token from a DIFFERENT host — public clients move between IPs/domains
    const me = await auth.handler(
      new Request('http://192.168.99.5:3000/api/auth/get-session', {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    expect(me.status).toBe(200);
    const body = await me.json();
    expect(body.user.email).toBe(EMAIL);
  });
});
```
**Step 1:** write test. **Step 2:** `npx vitest run tests/integration/bearer-tokens.test.ts -t 'public-access pin'` — record red/green as-is (green is acceptable: it pins existing per-request behavior and will catch a future regression to static-base).
**Step 3:** commit after Phase B config so the pin covers the new config path.

### Task B2: Env-driven dynamic `baseURL` in `lib/auth.ts` (no hardcoded hosts)
Design rule (**per user direction, applies to all config added by this plan**): `lib/auth.ts` hardcodes **zero** host values. Every deploy-tunable value flows from env through the existing `lib/env-schema.ts` zod schema (codebase convention), and local dev values live in `.env` (already git-ignored). Cloud platforms set the same vars in their deployment env — zero code changes on redeploy to a new domain.

**Step 0: neutralize the static env base that caused Task 7:**
```bash
# .env line 45 — comment out, leave as reference note:
# BETTER_AUTH_URL="http://localhost:3000"   # ← IGNORED under dynamic baseURL; do not re-enable (freezes trusted origins to localhost)
```

**Step 1: add schema entries in `lib/env-schema.ts`** (next to the existing `FRONTEND_URL` line 18):
```ts
  /** Comma-separated host patterns better-auth accepts when resolving per-request base URL + trusted origins. Cloud deploys set their real domain(s); local dev uses "*". */
  BETTER_AUTH_ALLOWED_HOSTS: z.string().min(1, 'BETTER_AUTH_ALLOWED_HOSTS is required').default('*'),

  /** Protocol for dynamic baseURL construction. "auto" (default) emits both http://* and https://* trusted-origin patterns and follows x-forwarded-proto behind a proxy — required so local LAN HTTP + future public HTTPS both work. */
  BETTER_AUTH_BASE_PROTOCOL: z.enum(['auto', 'http', 'https']).default('auto'),

  /** Read x-forwarded-host / x-forwarded-proto for dynamic base resolution (officially required for dynamic baseURL; keep true behind any proxy). */
  TRUSTED_PROXY_HEADERS: z.enum(['true', 'false']).default('true'),

  /** Comma-separated extra trusted origins for cross-origin browser frontends (partner BFFs). Cookieless bearer clients never need this. */
  BETTER_AUTH_TRUSTED_ORIGINS: z.string().optional(),
```

**Step 2: `.env` (local dev) + `.env.example`:**
```bash
# .env (local):
BETTER_AUTH_ALLOWED_HOSTS=*          # local: any reachable host (localhost, LAN IP, tunnel hostname)
# BETTER_AUTH_BASE_PROTOCOL=auto     # default — explicit if you want it pinned
# TRUSTED_PROXY_HEADERS=true         # default
```
`.env.example` additions (with the exact comments from the schema above).

**Step 3: wire in `lib/auth.ts`** (inside `betterAuth({...})`, before `advanced:`):
```ts
  // PUBLIC ACCESS (Task 7 fix): per-request base URL, fully env-driven. Host is
  // taken from the request (Host header; x-forwarded-host when TRUSTED_PROXY_HEADERS),
  // validated against BETTER_AUTH_ALLOWED_HOSTS, and used as base + trusted origin so
  // localhost, LAN IP, and the production domain all work without code changes.
  // (Static BETTER_AUTH_URL used to pin trusted origins to one host — see Phase A.)
  baseURL: {
    allowedHosts: env.BETTER_AUTH_ALLOWED_HOSTS.split(',').map((s) => s.trim()).filter(Boolean),
    protocol: env.BETTER_AUTH_BASE_PROTOCOL,
    fallback: env.FRONTEND_URL,
  },
```
And inside the existing `advanced:` object (line ~131):
```ts
    trustedProxyHeaders: env.TRUSTED_PROXY_HEADERS === 'true',
```

Source-verified facts this rests on (installed 1.6.23 dist):
- `wildcardMatch("*")` matches every host form (`192.168.2.8`, `example.com:3000`, …) — the dev value `*` is a real accepted pattern, not a special case.
- `protocol: 'auto'` makes better-auth inject **both** `http://*` and `https://*` into trusted origins (verified: `matchesOriginPattern('http://192.168.2.8:3000','http://*')=true`, same for https) — the docs' canonical `protocol: "https"` example would NOT have matched our http LAN origin.
- Dynamic config path reads forwarded headers only when trusted-proxy-header trust is on; official options doc requires it set explicitly for dynamic baseURL, so we read it from env (default true) rather than relying on 1.6.23's default.

**Step 4:** run B1 test + full bearer file: `npx vitest run tests/integration/bearer-tokens.test.ts` — all pass (now exercises the dynamic-config path). Local sanity after dev-server restart: `curl -s http://localhost:3000/api/auth/get-session` → `null`/200.
**Step 5:** `npm run lint && npm run build`.
**Step 6:** commit `feat(auth): env-driven per-request base URL + trusted origins (fixes remote INVALID_ORIGIN)`.

Rationale vs alternatives: hardcoded host = painful redeploy on every cloud platform (user's exact pain); static string/`BETTER_AUTH_URL` allowlist = same pain plus multi-host breakage (what just failed us); env-driven list = prod deploys set `BETTER_AUTH_ALLOWED_HOSTS=portal.example.com,www.portal.example.com` for least privilege while local dev keeps `*`. Security perimeter moves from "host" to "the bearer/cookie session + existing ban/rate gates", which already run identically regardless of host.

### Task B3: (folded into B2 Step 1) — env-tunable trusted origins
`BETTER_AUTH_TRUSTED_ORIGINS` is read natively by better-auth from the process env (`helpers.mjs:83-84`) — schema declaration in B2 + `.env.example` documentation is all that's needed; no `lib/auth.ts` code. Partner browser frontends get listed there per deployment; bearer/server-to-server clients never need it (no Origin header → origin gate returns early).

### Task B4: Wire existing `TRUSTED_PROXY_CIDRS` into `advanced.ipAddress.trustedProxies`
**Files:** Modify `lib/auth.ts` — replace the commented-out block inside `advanced.ipAddress` (lines ~131-138) with:

```ts
  advanced: {
    ipAddress: {
      // Populate from TRUSTED_PROXY_CIDRS once we sit behind a real reverse proxy
      // (Cloudflare/NGINX) in Phase C. Untrusted x-forwarded-for values beyond a
      // trusted CIDR are ignored — prevents client-IP spoofing for rate limiting.
      ...(env.TRUSTED_PROXY_CIDRS
        ? { trustedProxies: env.TRUSTED_PROXY_CIDRS.split(',').map((s) => s.trim()).filter(Boolean) }
        : {}),
    },
```
(`TRUSTED_PROXY_CIDRS` already exists in `lib/env-schema.ts` line 38.) **Step:** lint + build; commit `feat(auth): wire TRUSTED_PROXY_CIDRS into trustedProxies`.

### Task B5: Phase B regression gate ✅
`npm run test && npm run lint && npm run build` — **ALL GREEN** (2026-10-08): 91 test files / 1939 tests passed, ESLint clean, production build OK. Includes the existing no-CORS pin and cookie-flow suite unchanged. Local sanity post-restart: `curl http://localhost:3000/api/auth/get-session` → `null` / 200.

**Phase B result block (what actually shipped):**
- Single commit `10583b5 feat(auth): env-driven per-request base URL + trusted origins (fixes remote INVALID_ORIGIN)` — B2+B4 combined: the `advanced.ipAddress.trustedProxies` wiring interleaves with the same `advanced:` block and is pinned by the same test file, so a separate B4 commit would have required mid-edit surgery on `lib/auth.ts`.
- **Deviation from plan (necessary):** `tests/unit/auth-config.test.ts` was not in the plan's file list. Its `@/lib/env` mock was a 1-key stub (`{ NODE_ENV: 'test' }`) — once `lib/auth.ts` read the new env vars, module import crashed (`Cannot read properties of undefined (reading 'split')`). Fixed by mirroring the schema defaults in the mock. This surfaced a PRE-EXISTING stale pin: "registers exactly one plugin" predates the bearer() registration (old-plan Task 2); it only failed once the suite could import again — corrected to two plugins `['bearer', 'organization']`.
- **Extra pins beyond plan:** unit-level config pin for the dynamic-baseURL options surface (allowedHosts array / protocol / fallback / trustedProxyHeaders / empty ipAddress when no CIDRs) inside auth-config.test.ts.
- B1 external-host integration pin: sign-in on `http://remote-client.example.com`, token replay from `http://192.168.99.5:3000` — green (now exercises the dynamic path).
- `.env` local: BETTER_AUTH_URL line 45 commented out + the four new vars added (BETTER_AUTH_ALLOWED_HOSTS="*" active, rest at their schema defaults, commented).
- Note for Phase A-cont. battery: re-run Task A1's curls from the remote computer against the LAN IP — sign-in should now return credential JSON (401) instead of 403 INVALID_ORIGIN. Not executed here (needs the user's remote machine).

---

## Phase G — Token expiry & refresh for bearer clients (TDD + docs) ✅ DONE (2026-10-08, commit 4cd0ae8)

Lifecycle facts (source-verified in installed better-auth@1.6.23, config today: `lib/auth.ts` session block):
- Hard max: any session dies at `expiresIn = 60*60s` (1h absolute) — no bearer client outlives it; DB row deleted by better-auth's cleanup.
- Sliding renewal: on each authenticated request, if `now >= expiresAt - expiresIn + updateAge`, the token is refreshed in-place (new 1h window, same token string) — with `updateAge = 60*15s` (15 min), i.e. **a client polling at least every 45 minutes keeps its token alive; idle > ~45min → dead** (`session.mjs:200-235`).
- Revocation is immediate on sign-out/ban/permission-loss — the bearer plugin re-verifies the DB-backed session every request, so no grace period.
- No refresh-token subsystem exists in v1: **refresh = re-authenticate** (new sign-in → new token; old sessions remain valid independently until they expire — pin this if we ever want single-session semantics).
- The bearer plugin emits `set-auth-token` on EVERY session-setting response (verified: after-hook matches all responses that set the session cookie), so an active client's periodic authenticated calls return a freshly renewable token header each time.

### Task G1: Test — sliding renewal window honored for bearer tokens
**Files:** Modify `tests/integration/bearer-tokens.test.ts` (append).
Renewal condition (verified, `session.mjs:205`): fires only when `expiresAt - 3600 + 900 <= now`, i.e. in the last 15 min of the window. A fresh session is therefore NOT renewed on the next call — the test must age the row first (direct DB update, same shared-dev-DB technique the existing ban tests use):
```ts
it('bearer token slides to a fresh 1h window once activity lands inside the updateAge window', async () => {
  const signin = await signInWithPassword(EMAIL, PASSWORD);
  const t = signin.headers.get('set-auth-token')!;

  // Age the session into the renewal window (4 min of its 1h remaining) — mirrors a real long-lived client
  await prisma.session.update({ where: { token: t }, data: { expiresAt: new Date(Date.now() + 4 * 60_000) } });

  // Activity NOW must extend expiry back to ~now+1h (same token string, in-place update)
  const me = await getMeWithBearer(t);
  expect(me.status).toBe(200);
  const after = await prisma.session.findFirst({ where: { token: t } });
  const remainingMs = after!.expiresAt.getTime() - Date.now();
  expect(remainingMs).toBeGreaterThan(50 * 60_000 &&  (3600_000 - 60_000)); // renewed ≈ 1h window, minus skew
});
```
**Step 1:** write test. **Step 2:** `npx vitest run ... -t 'sliding renewal'` — expected GREEN (stock behavior); RED here = real library regression to report, do not weaken. **Step 3:** commit with the Phase B5 sweep.

### Task G2: Docs — expiry/refresh section in `documents/api/bearer-tokens.md`
Append a "Token lifetime & refresh" section (condensed from the Phase G facts): acquisition doors; 1h hard max; activity keeps it alive (~45 min idle = dead); on 401 → re-authenticate, never try to "refresh" an old token; stolen-token damage bounded by revocation + window. Keep design doc §4.3 state diagram as source of truth (import verbatim per old plan Task 8 rules). No code. **Commit** with Phase F docs commit (`docs/auth`).

### Task G3: Negative pin — expired/banned token is dead (no grace)
```ts
it('bearer token is immediately unusable after revocation (no grace period)', async () => {
  const signin = await signInWithPassword(EMAIL, PASSWORD);
  const t = signin.headers.get('set-auth-token')!;
  await auth.handler(new Request('http://localhost/api/auth/sign-out', { method: 'POST', headers: { Authorization: `Bearer ${t}` } }));
  const after = await getMeWithBearer(t);
  expect(after.status).toBeLessThan(500); // pinned contract: no resolved session, never 5xx (Task 4 helper semantics)
});
```
Same TDD steps as G1. (Overlaps old-plan Task 4 pin — keep only if the helper signature makes it non-duplicative; otherwise record "covered by existing pin" and skip.)

**Result: SKIPPED (2026-10-08)** — covered by the existing `sign-out revokes the bearer token immediately` test in the same file: identical contract (immediate, no grace) plus an extra proof that bearer-driven sign-out itself works. Plan's own skip condition applies; recording here per plan.

**Phase G result block:**
- G1 shipped with one deviation from the sketch: aged by `userId` + newest-row lookup instead of `where: { token: t }`. Reason (verified empirically before asserting): `set-auth-token` is NOT the raw `Session.token` value — transport values are a signed/wrapped form (77 chars w/ dot vs 32-char raw column, sharing the same head), so direct DB lookup by header token misses. Aging by userId needs no inversion; renewal is then proven from the **response's** `session.expiresAt` (fresh ~1h) rather than a second DB read — equivalent assertion, zero secret handling in test code.
- G2: created `documents/api/bearer-tokens.md` (new file). The plan assumed this doc existed with §4.3 import rules (old plan Task 8), but that task was never run and no `documents/api/` tree existed — so the file now contains acquisition doors + the "Token lifetime & refresh" section + the §4.3 diagram verbatim, with the design doc named as source of truth for all full diagrams. Old-plan Task 8's remaining scope (SECURITY.md ops runbook) stays pending under Phase F or a later docs pass.
- Gate: project gate green — npm run test 91 files passed, lint clean, build OK (bearer file standalone: 8/8).

---

## Phase C — Public exposure (infrastructure + proxy wiring)

**Objective:** The server is reachable over the internet at a stable domain behind a TLS-terminating proxy, with correct client IP + forwarded host/proto; the OIDC door has its redirect URIs registered. These are mostly operator actions with two small code/env follow-ups.

### Task C1: Choose exposure path (user decision — record choice)
Options, in recommended order:
1. **Cloudflare Tunnel / ngrok-style tunnel** from this Mac → stable HTTPS domain `portal.example.com`; no firewall holes, TLS at the edge. Best for "reachable from any computer right now".
2. Direct LAN IP only (what we have) — sufficient if "remote" means same network; document as dev-only.
Record the chosen path + final public URL in this plan's footer (single source for later tasks).

### Task C2: Proxy header contract (code already handles it — verify, don't change)
With dynamic `baseURL` (Phase B), 1.6.23 trusts `x-forwarded-host`/`x-forwarded-proto` **by default** (`helpers.mjs:106-108`). Confirm the chosen proxy sends both; if it is a single trusted edge, optionally set `advanced.trustedProxyHeaders: true` explicitly in `lib/auth.ts` with a comment. Verify with:
```bash
curl -s -H 'x-forwarded-host: portal.example.com' -H 'x-forwarded-proto: https' \
  http://localhost:3000/api/auth/get-session -w '\n%{http_code}\n'
# expect: null / 200 — base resolved from forwarded headers, no host error
```

### Task C3: Google OIDC redirect URI registration (door fix for class (c))
Operator action in Google Cloud Console → OAuth consent screen → authorized redirects: add the public callback, e.g. `https://portal.example.com/api/auth/callback/google`. Note: `http://` URLs and raw IPs/ports are typically **not** acceptable to Google for production — this is why an OIDC login from `http://LAN-IP:3000` fails with Google's "Invalid URI" even when better-auth is fine. Until registered, the **email/password door remains fully scriptable** over HTTP (Task D2 proves it), so public access is not blocked on this step.

### Task C4: Cookie/transport reality check for the public domain
Verified constraints to document, not code around: `useSecureCookies: env.NODE_ENV !== 'development'` + `sameSite: 'lax'` means **browser cookie sessions do not function cross-domain on HTTPS** — by design. Public access is bearer-token-first (this plan); local browser portal stays cookie-based on the same origin. Do NOT set `crossSubDomainCookies` (it only scopes cookies to a shared parent domain; it does not make SameSite=lax work across unrelated domains, and remote browsers aren't ours).

**Commits:** C1–C4 produce no code beyond optional one-line comment in `lib/auth.ts`; commit that line if changed: `chore(auth): document trusted-proxy header contract`.

---

## Phase D — End-to-end validation of both public doors (manual smoke + scripted)

### Task D1: Bearer door over the real remote path
From the actual remote computer (script, no cookies by construction):
```bash
# 1. sign in via email door over HTTP(S), read set-auth-token from headers
TOKEN=$(curl -is "https://portal.example.com/api/auth/sign-in/email" \
  -H 'content-type: application/json' \
  -d '{"email":"<admin>","password":"***"}' | awk tolower {sub(/^[a-z-]+:/,"",$1)} $1=="set-auth-token"{print $2})
# 2. call a protected endpoint with it — expect 200 JSON
curl -s "https://portal.example.com/api/organizations/<orgId>/teams" -H "Authorization: Bearer ***" | head -c 200
# 3. negative control — no header → 401 (or empty 2xx, per pinned get-session contract)
```
Expected: (1) token present; (2) org team JSON; (3) unauthenticated. This is the old plan's Task 7 acceptance criterion, now over the public URL.

### Task D2: OIDC door from a remote browser → bearer token handoff
Remote computer browser (any domain/IP — it navigates top-level, so no CORS involved):
1. `https://portal.example.com/login` → "Login with Google" (requires C3 done; else use email door).
2. After Google approval the server sets the session cookie **and** (bearer plugin) emits `-auth-token`.
3. Scriptable handoff: a remote *script* replicating step 1-2 via the provider's token exchange is out of v1 scope (device-code style flow); for now, document that browser login on the public domain yields a working cookie session on that machine, and scripts use D1. Record in `documents/api/bearer-tokens.md` (§token acquisition) as the known limit, matching design doc §5.2.

Record D1/D2 results (raw outputs) appended to old plan Task 7. **No commit** if nothing changed; commit any test pins that surfaced.

---

## Phase E — Security pin hardening (TDD) ✅ DONE (2026-10-08, commit 1cdd0c9)

### Task E1: Pin that the CSRF gate is NOT disabled
Append to `tests/integration/bearer-tokens.test.ts` — note in-process tests run with `isTest()` which skips origin checks, so this pins **config intent** by asserting the auth config object directly:
```ts
it('origin gate stays enabled (no disableCSRFCheck / no global origin echo)', async () => {
  const advanced = (auth.$context as unknown as { options?: { advanced?: Record<string, unknown> } })?.options?.advanced ?? {};
  expect(advanced.disableCSRFCheck).not.toBe(true);
});
```
Run file green; commit `test(auth): pin CSRF gate enabled for public-access config`.

### Task E2: Rate-limit + ban gates host-independent (already covered) ✅
Confirm existing pins (`auth.test.ts`, bearer file ban test) pass unchanged in Phase B5's sweep — they are bound to session creation, not host. No new code; record result.

**Result:** confirmed — passed unchanged in the Phase B5 sweep and again in the final E/F gate (1939 tests green); ban-gate pin included.

**Phase E result block (2026-10-08):**
- E1 shipped with a corrected assertion: in installed 1.6.23 the disable switches are `advanced.disableOriginCheck` + `advanced.disableCSRFCheck` (verified in dist/api/middlewares/origin-check.mjs), plus top-level `trustedOrigins` as the cross-origin trust surface — all three asserted absent on `auth.options`. In-test comment documents why options-object assertion is the meaningful pin under `isTest()` (request-time origin checks skip in test mode).

---

## Phase F — Developer docs + security runbook update ✅ DONE (2026-10-08, commit 1cdd0c9)

**Files:** Modify `documents/api/bearer-tokens.md` (add "Public access" section); modify `SECURITY.md` (one paragraph: origin policy = same-origin browser cookies + allowlisted partner origins via `BETTER_AUTH_TRUSTED_ORIGINS`; bearer door CSRF-immune; no wildcard CORS by design + why).
- Document the proxy header contract (`x-forwarded-host`, `x-forwarded-proto`, trusted CIDRs) for ops.
- Document that `allowedHosts: ['*']` is intentional for a bearer-first public API and what would change it (a per-customer subdomain scheme → switch to `*.customer-domain.com`).
Commit `docs(auth): public-access origin policy and proxy header runbook`.

**Result:** SECURITY.md gained the full §2 subsection (origin policy + 5-step ops runbook + proxy header contract), env table (+5 vars incl. BETTER_AUTH_SECRET), Appendix C cross-refs, ToC line — all in 1cdd0c9 with E1. `documents/api/bearer-tokens.md` "Public access (reachability)" section + SECURITY.md anchor link landed as a follow-up addendum (same scope, docs-only; committed with the plan status update).

---

## Files likely to change (whole plan)
- `lib/auth.ts` — env-driven baseURL block; `trustedProxyHeaders` from env; trustedProxies wiring. **No** hardcoded hosts, **no** CORS, **no** disableCSRFCheck, **no** jwt plugin, **no** crossSubDomainCookies.
- `lib/env-schema.ts` — +`BETTER_AUTH_ALLOWED_HOSTS`, `BETTER_AUTH_BASE_PROTOCOL`, `TRUSTED_PROXY_HEADERS`, `BETTER_AUTH_TRUSTED_ORIGINS`.
- `.env` (local dev) — new vars; comment out `BETTER_AUTH_URL` (line 45).
- `.env.example` + `.env.test.example` — **DONE** (committed-ready): both updated with the four new vars + BETTER_AUTH_URL deprecation note.
- `tests/integration/bearer-tokens.test.ts` — external-host pin, CSRF-gate-active pin, sliding-renewal pin, no-grace revocation pin.
- Docs as above. No migrations, no middleware.ts changes (CORS stays closed — Task 6 of old plan test must keep passing), no client-config changes (bearer clients are not our Next.js frontend).

## Risks / tradeoffs / open questions
1. **`BETTER_AUTH_ALLOWED_HOSTS=*` is a product-level decision** (local-dev default): any host that can reach the port gets base-URL resolution. Prod deploys should set real domain(s) for least privilege — env-driven, no code change. Mitigations already in place: bearer tokens, 5-attempts/15min sign-in rate limit by (now correctly forwarded) client IP, ban gate at session creation, no CORS.
2. **Global origin echo rejected deliberately** — see anti-pattern section; revisit only with a named partner integration, then via allowlist (Task B3), not echo.
3. **Port 3000 on LAN IP is dev-only exposure**; the real public surface must be Phase C's edge domain. Keep the Mac firewall rule / port-forwarding for LAN as a deliberate dev affordance and document it in SECURITY.md.
4. ~~Open: does the remote computer hit TCP level?~~ RESOLVED — site loads remotely over LAN IP; only the origin gate blocked it (Phase A). Remaining open item: permanent exposure path (C1, tunnel vs direct) gates when D1/D2 run over TLS domain.
5. Google door over `http://` LAN IPs is expected to keep failing (Google's own URI rules); not a better-auth bug.

## Verification summary (definition of done)
- Phase A: exact observed error recorded + class (a/b/c).
- Phases B/E: `npm run test && npm run lint && npm run build` green on branch; bearer file passes all prior pins + external-host pin + CSRF-active pin.
- Phase D1 from a genuine non-localhost client over the public URL: token acquired, protected endpoint 200, no-header control unauthenticated.
- Old plan Task 7 marked done with raw outputs.
