# npm Audit Phased Remediation — nipp-0807

**Execution model: single agent, sequential, no subagents.** Execute one phase at a time in order. **STOP between phases:** run the gate commands listed at the end of each phase, report the results, and wait for assessment before starting the next. Do not proceed to the next phase until the current phase's gate has been shown green (or an explicit decision is made otherwise).

**Goal:** Drive `npm audit --audit-level=high` from 57 findings (7 critical, 21 high) to zero high+critical, phased by severity/risk.

**Current state verified on this branch (`security-scan-fix`, npm CLI v12.0.2):**
- The CI workflow `.github/workflows/ci.yml` already contains a `Security audit` job running `npm audit --audit-level=high` (lines 46-63) — **no CI changes are needed.** Local runs of `npm audit` are just for faster iteration.
- Installed: better-auth@1.6.23, nodemailer@9.1.1, prisma@6.19.3, next@15.5.28, tailwindcss@4.3.3, eslint@9.39.5, typescript-eslint@8.72.1, @tailwindcss/typography@0.5.20.

**Root cause of the scary part (verified via `npm why` / `npm ls`):**
~44 of the 57 findings live in `node_modules/npm/node_modules/*` — a copy of **npm@2.15.12 (circa 2015)** shipped as a dependency of the direct dep **`latest@^0.2.0`**. It is bundled *inside* npm's own tarball (that's why most entries read "No fix available" — nothing can patch an upstream that no longer exists), and it is never loaded at runtime: it's a copy of the old npm CLI tool, not our Node/npm. Our local npm 12.0.2 is untouched by this tree.

| Cluster | Severity span | Root cause | Fix |
|---|---|---|---|
| `node_modules/npm/**` (bl, chownr, fstream, hawk, hoek, boom, cryptiles, sntp, hosted-git-info, ini, is-my-json-valid, json-schema, jsprim, jsonpointer, minimist/mkdirp, npm-registry-client, npm-user-validate, request, semver 2/5.x, sshpk, stringstream, tar, tough-cookie, tunnel-agent) | 7 critical / most high | `latest@^0.2.0` → `npm@^2.5.1` → ancient tree | Phase 1: delete `latest` + `node-mailer` (both have zero imports in the repo — verified by repo-wide search) |
| @better-auth/drizzle-adapter / kysely-adapter | high | bundled adapters of better-auth@1.6.23 (we use the Prisma adapter, exposure is low) | Phase 2: better-auth → 1.7.14 |
| nodemailer (12 advisories) | high | direct dep nodemailer@9.1.1 | Phase 3: nodemailer → 10.3.1 (major; breakage surface assessed below) |
| minimatch cluster (eslint, @typescript-eslint/*, eslint-config-next tree) | high | transitive minimatch under ESLint toolchain | Phase 4: `npm audit fix` + targeted dev-dep bumps |
| postcss-selector-parser <6.1.5 (via @tailwindcss/typography) | moderate | nested dep of typography/tailwind 4.3.3 | Phase 4: `overrides` pin, verify CSS build |
| deepmerge-ts <8 via @prisma/config → prisma | high | Prisma 6.x CLI-time config merge | Phase 5: **accepted risk**, Prisma 7 deferred |
| postcss <=8.5.22 (4 advisories) bundled in next@15.5 | high | last high after Phases 1-4 | Phase 6: Next.js 16 upgrade |

**Breakage risk per change:**
- `latest` / `node-mailer`: **none** — zero import sites repo-wide.
- better-auth 1.6.23 → 1.7.x: minor bump; BetterAuth minors have changed hook/callback shapes before. We use a wide surface in `lib/auth.ts` (OIDC gate, bearer, org/teams hooks, rate limiting, password reset, ban enforcement). Risk **medium**, covered by `tests/integration/forgot-password.test.ts`, `admin-reset-password.test.ts`, `tests/unit/auth-config.test.ts`, e2e isolation suite.
- nodemailer 9 → 10: only surface is `lib/notifications/email.ts` (`createTransport`, `sendMail`, `Transporter` type) — nothing exotic. Risk **low**; move `@types/nodemailer` along with it.
- minimatch / ESLint toolchain: dev-only. Risk **low** — gate on lint passing.
- postcss-selector-parser override: build-time only. Risk **low** — gate on `npm run build`.
- Prisma 6 → 7: **high risk, deferred to a separate future effort** (generator/output changes, ESM client, seed + RLS schema scripts). Not bundled into this sweep.
- Next.js 15.5 → 16.4: major foundation upgrade — Phase 6, with its own spike gate first. Kept last so the App Router work happens once on a tree already free of other churn.

---

## Phase 1 — Critical + high "No fix available": remove the dead dependency chain

Removes ~44 findings including **all** criticals (tar, minimist, fstream) and every bundled-npm "No fix available" entry. Handling of "no fix available" in general: the package was abandoned with no upstream patch — the correct remediation is to remove whatever drags it in, which here is a single unused direct dep.

**Step 1.1:** `npm uninstall latest`
Verify: `npm ls latest` → empty; `npm why tar | head -5` no longer shows the npm-bundled path.

**Step 1.2:** `npm uninstall node-mailer` (deprecated stub that just re-exports nodemailer; `lib/notifications/email.ts` imports nodemailer directly).

**Step 1.3:** `git add package.json package-lock.json && git commit -m "fix(security): remove dead latest/node-mailer deps (eliminate bundled npm@2.15 CVE cluster)"`

**Phase 1 gate — run and STOP here for assessment:**
```bash
npm audit --audit-level=high | tail -3     # expect: ~9-13 vulnerabilities, 0 critical
npm ls minimatch nodemailer next postcss-selector-parser   # confirm the Phase 2-4 set
npm run type-check && npm run lint && npm run test         # all green
```
Report residual findings list + gate results and wait for go-ahead.

---

## Phase 2 — High: better-auth 1.6.23 → 1.7.x

Removes GHSA-44jh-23m7-hpcf (concurrent requests can exceed rate limits on PostgreSQL via the drizzle/kysely adapters) and both adapter advisory entries; also picks up other 1.6→1.7 security fixes. We use `prismaAdapter` so direct exposure was low — this is completeness + defence-in-depth.

**Step 2.1:** Check published versions: `npm view @better-auth/core version`, `npm view better-auth version`.
**Step 2.2:** `npm install better-auth@<latest-1.7.x> @better-auth/core@<same> @better-auth/test-utils@<same>` (keep the three locked together as today).
**Step 2.3:** `npm run type-check` — fix any signature drift in `lib/auth.ts` (team hook stubs, `databaseHooks.session.create.before`, `baseURL` shape) against 1.7 types **without changing runtime behaviour**. If nothing breaks type-wise, no code edits are needed.
**Step 2.4:** Commit: `fix(security): upgrade better-auth to 1.7.x (GHSA-44jh adapter rate-limit fix)`

**Phase 2 gate — run and STOP here for assessment:**
```bash
npm audit | grep -c 'better-auth'          # expect 0
npm run test                               # unit incl. auth-config.test.ts
npm run test:integration                   # forgot-password + admin-reset flows
# optional if time permits: npm run test:isolation:e2e
```

---

## Phase 3 — High (major): nodemailer 9.1.1 → 10.x

Removes all 12 nodemailer advisories (addressparser DoS family, DNS-cache servername cross-tenant disclosure, DKIM quadratic unfolding, SMTP reply-parsing DoS).

**Step 3.1:** Check latest: `npm view nodemailer version` and `npm view @types/nodemailer versions --json | tail -5`.
**Step 3.2:** `npm install nodemailer@<latest> @types/nodemailer@<matching major>`
**Step 3.3:** `npm run type-check`; if the major moved `Transporter` generics, adjust only the type annotation in `lib/notifications/email.ts:7,103`. Runtime code should stay byte-identical.
**Step 3.4:** Commit: `fix(security): upgrade nodemailer to 10.x (clears 12 advisories)`

**Phase 3 gate — run and STOP here for assessment:**
```bash
npm audit | grep -c 'nodemailer'           # expect 0
npm run test && npm run test:integration   # email flows mocked in unit; reset flows in integration
```
Optional manual smoke: point SMTP_HOST/SMTP_PORT at a dev relay, trigger "Forgot password?", confirm the branded template arrives.

---

## Phase 4 — High (dev toolchain): minimatch cluster + postcss-selector-parser

Dev-time only; nothing runtime touches these.

**Step 4.1:** `npm audit fix` — should raise nested minimatch copies inside @typescript-eslint / eslint plugins within existing ranges. Verify: `npm audit | grep -E 'minimatch|postcss'` → empty or only postcss-selector-parser remaining. If a range pin blocks it, bump the owning top-level dev dep (`typescript-eslint` or `eslint-config-next`) to its latest minor and re-run.
**Step 4.2:** Add to `package.json`:
```json
"overrides": { "postcss-selector-parser": "^6.1.5" }
```
Then a clean reinstall so the override lands in the lockfile: `rm -rf node_modules package-lock.json && npm install` (we control no other state, so this is safe).
**Step 4.3:** `npm run lint && npm run build && npm run test` — build confirms the Tailwind/PostCSS chain is unaffected by the override.
**Step 4.4:** Commit: `fix(security): bump ES toolchain minimatch + override postcss-selector-parser >=6.1.5`

**Phase 4 gate — run and STOP here for assessment:**
```bash
npm ls postcss-selector-parser             # only >=6.1.5 entries
npm audit --audit-level=high | tail -3
```
At this point the **only** expected `--audit-level=high` failure is deepmerge-ts (Phase 5) — note this makes the CI audit job red for one finding until Phase 5's documentation lands; call that out in the assessment report.

---

## Phase 5 — Accepted risk: Prisma 6 / deepmerge-ts (high)

deepmerge-ts <8 (via @prisma/config, build/CLI-time config merge) is only fixed in Prisma ≥7.10.1, a breaking major we do not bundle into a security sweep. **Decision path here:** at the Phase 4 assessment checkpoint, choose (a) accept risk + document (default), or (b) start the Prisma 7 migration as its own tracked effort — user decides after seeing that it's the sole remaining high.

**Step 5.1:** Append an accepted-risk row to `SECURITY.md`:
```markdown
| deepmerge-ts <8 via prisma@6.x | GHSA-ggr8-5vv4-36mx (high) | Build/CLI-time config merge only; not reachable from app input. Migration to Prisma 7 tracked as separate issue; re-audit on every upgrade. |
```
**Step 5.2:** Create a follow-up issue `Migrate Prisma 6 → 7` listing: generator `output` changes, ESM client imports, `prisma/seed.ts`, tenant RLS schema scripts, all `@prisma/client` import sites.
**Step 5.3:** Commit: `docs(security): record deepmerge-ts accepted risk pending Prisma 7 migration`

**Phase 5 gate — run and STOP here for assessment:**
```bash
npm audit --audit-level=high | grep -E 'Found|vulnerabilities'
```
Expectation: only the deepmerge-ts high remains, now documented. Decision point: is the documented residual acceptable (CI stays red on one documented high), or do we sequence Prisma 7 next?

---

## Phase 6 — Foundation: Next.js 15.5 → 16.4 (clears the last high, bigger lift)

Clears the postcss cluster (XSS via unescaped `</style>`, sourceMappingURL file-disclosure ×3, all bundled inside next@15.5) and modernises the app shell. **Own branch, own spike gate.** Start only after Phases 1-5 are assessed and settled.

**Step 6.1 — Spike first (no code changes to keep):** scratch branch; `npm install next@<latest-16> eslint-config-next@<matching>`; run `npm run type-check && npm run lint && npm run build && npm run test:integration`. Record every breakage in the assessment report; the spike output becomes the real task list.

**Spike results (2026-11-01, branch `spike/next-16-spike`, commits a614a03 + bc3dd5e):** all gates green after exactly 3 classes of breakage:
1. `revalidateTag` now requires a second stale-window profile arg (`string | {expire?}`); old single-arg call deprecated-equivalent to `{expire:0}`. 12 sites across 8 route files in org/roles admin + tenant routes → pass `{ expire: 0 }`. One structural unit test asserted the literal string — loosened to stable prefix `revalidateTag('org'`.
2. `next lint` command removed in v16 (flat ESLint only). `lint` script: `next lint` → `eslint .` (repo already has `eslint.config.mjs` with `@next/eslint-plugin-next`; plugin bumps to 16.4.3 automatically via eslint-config-next).
3. Build needs `--webpack` while the custom `webpack()` externals block in next.config.ts is migrated — Next 16 defaults to Turbopack and hard-fails on webpack-only configs. Spike ran with `npx next build --webpack`.

**Phase 6.2 real task list (from spike) — all done 2026-11-01 on `feat/next-16-upgrade` (commits a31ca5f, db45136):**
- [x] Migrate next.config.ts `webpack()` externals to the Turbopack shape: deleted the block; `serverExternalPackages` is the externalization list (verified ioredis absent from edge chunks). Bonus fix: instrumentation.ts top-level side effects pulled crypto into edge chunks under Turbopack → moved bootstrap into async `register()` behind `NEXT_RUNTIME === 'nodejs'` with dynamic imports (clears both Turbopack edge warnings; prod health check confirms warm ran)
- [x] 12-site `{ expire: 0 }` revalidateTag + structural test loosening (already in from spike)
- [x] middleware.ts → proxy.ts via `npx @next/codemod@canary middleware-to-proxy .` (function renamed to `proxy`, matcher untouched); no more deprecation in builds; prod smoke verified CSP header, session-cookie gate 307→/login?callbackUrl, /api/health all-green
- [x] Cache-default check: no implicit cache changes hit RLS flows — org-details `unstable_cache({revalidate:30})` + `{expire:0}` invalidation preserved; integration suite (incl. reset/org-lifecycle) green
- [x] Node engines: next@16 `>=20.9.0`, CI Node 22 ✓
Residual smoke-test observation (benign): running the full unit suite right after a long build produces transient vitest worker unhandled rejections in rate-limiter.test.ts (`Closing rpc while onUserConsoleLog pending`); clean when run standalone — pre-existing flake class, not Next-16 related.
**Step 6.2:** Apply fixes per spike findings, checking against Next 16 release notes for: middleware/matcher naming, caching-default changes (confirm no implicit cache changes hit tenant RLS flows), React 19 peer ranges (we're on ^19 ✓), Node engines (CI uses Node 22 images — confirm 16 supports it).
**Step 6.3:** Verify auth surfaces under the new request lifecycle: session cookies, bearer token translation (`lastRequest` capture in `lib/auth.ts`), rate limiting.
**Step 6.4:** Commit(s), then full gate below.

**Phase 6 gate — run and STOP here for final assessment:**
```bash
npm audit --audit-level=high   # expect exit 0 with only documented residual (deepmerge-ts) or fully clean if Prisma 7 lands first
npm run type-check && npm run lint && npm run build
npm run test:integration
npm run test:isolation          # full e2e isolation suite for the foundation upgrade
```

---

## Acceptance criteria (end state after all phases)

1. `npm audit --audit-level=high` clean, except any findings explicitly in the SECURITY.md accepted-risk table with a tracked follow-up issue.
2. At every gate: `npm run type-check && npm run lint && npm run build && npm run test:integration` green.
3. CI `Security audit` job (already present in ci.yml) goes from red to green as phases land; each phase merged individually via its own PR so bisecting stays easy.
4. Residual moderate/low findings enumerated once with a decision each, noted in SECURITY.md.

## Risks & tradeoffs

- **better-auth minors have changed behaviour before** — if 1.7 breaks `onAPIError` redirect semantics or hook shapes in a way that can't be fixed without behaviour change, fall back to staying on 1.6 with a documented accepted risk row rather than shipping an auth regression.
- **CI gate is red between Phase 4 completion and Phase 5/6 landing** for the deepmerge-ts entry — expected, tracked, and called out at each assessment checkpoint. Consider merging Phases 4+5 in one PR if that window matters to you.
- **Prisma 7 + Next 16 are two majors** — deliberately separate efforts, never interleaved.
- **`overrides` for postcss-selector-parser** is a band-aid; re-check at Phase 6 and drop it once the transitive range fixes itself.
