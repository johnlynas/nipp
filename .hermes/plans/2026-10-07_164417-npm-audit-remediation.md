# npm Audit Remediation Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Bring `npm audit --audit-level=high` (the CI gate in `.github/workflows/ci.yml:63`) from 49 vulnerabilities (1 low, 12 moderate, 28 high, 8 critical) to 0 blocking findings, with any unavoidable residual documented as accepted risk.

**Architecture:** The vast majority of findings (~30 packages, including all the "No fix available" items: `tar`, `json-schema`, `minimist`, `bl`, `hawk`, `tough-cookie`, …) live **entirely inside `node_modules/npm/`**, which is pulled in by a single accidental dependency — `"latest": "^0.2.0"` added to `package.json` at commit `c177938` (a typo artifact; `latest@0.2.0` depends on `npm@^2.5.1`, installing 201 packages of npm 2.x toolchain). Nothing in the codebase imports `latest`. The same session-era mistake added deprecated, also-unimported `"node-mailer": "^0.1.1"` (commit `4bc176a`); the real email path is `lib/notifications/email.ts`, which imports `nodemailer` directly — including for the Google OIDC magic-link flow (`lib/oidc-magic-link.ts:19` → `sendEmail`). Remove those two, and roughly 80% of the report vanishes with zero code changes. The remainder splits into: safe minor upgrades (lint-staged, source-map-js), one removable dev dep (concurrently, unused by any npm script), one major bump (nodemailer 9→10), one framework upgrade (Next 15→16 for the nested postcss), and two vendor-blocked items resolved via `overrides` or documented acceptance.

**Tech Stack:** Node 22 (`engines` in package.json), npm ci lockfile, Next.js 15.5.26, Prisma 6.19.3, vitest, eslint 9 flat config, lint-staged + husky pre-commit.

---

## Current state (verified facts)

Verified against the repo on branch `security-scan` (HEAD `31ba744`), lockfile v3, and npm registry:

| Audit item | Severity | Where | Root cause / fix path |
|---|---|---|---|
| `bl`, `brace-expansion` (2055 subpath), `chownr`, `extend`, `fstream`, `hawk`, `hoek`, `hosted-git-info`, `ini`, `is-my-json-valid`, `json-schema` (crit), `jsonpointer`, `minimatch` (3.1.x), `minimist` (crit), `npm-user-validate`, `qs`, `semver` (@2/5), `sshpk`, `stringstream`, `tar` (crit) | mixed, many "no fix" | all under `node_modules/npm/…` | **All disappear if `latest` is uninstalled.** |
| `braces` 3.0.3 (high) | high | top-level; consumers: `lint-staged@15.5.2 → micromatch` AND `eslint-config-next → @next/eslint-plugin-next@15.x → fast-glob@3.3.1 → micromatch` | lint-staged 17.6.0 drops micromatch entirely (deps: tinyexec/picomatch/string-argv). eslint path removed only if `@next/eslint-plugin-next` in the Next 16 line sheds fast-glob — **verify at implementation time** (`npm view @next/eslint-plugin-next@<16.x> dependencies.fast-glob`). Fallback: document acceptance (DoS requires attacker-controlled glob input; eslint globs are repo-local). |
| `deepmerge-ts` 7.1.5 (high, <8.0.0) | high | `prisma@6.19.3 → @prisma/config@6.19.3` | **Vendor-blocked:** prisma stable line (incl. 7.10.0 and RC 8.0.x) still ships deepmerge-ts 7.1.5. Fix only exists by forcing `deepmerge-ts@^8` via npm `overrides`, or accepting risk until Prisma updates. `@prisma/client` does NOT depend on it (verified). |
| `nodemailer` ≤10.0.8 (high) | high | direct dep `^9.1.1` → 9.1.1 | Upstream fix is major: `nodemailer@10.0.16`. `@types/nodemailer` tops out at 8.0.2 — check for v10 types at impl time, else narrow local shim. |
| `postcss` ≤8.5.22 (high) | high | ONLY the nested copy `node_modules/next/node_modules/postcss` = **8.4.31** (next pins it). Top-level postcss is 8.5.28 and already clean. | Disappears when `next` moves to a line requiring ≥8.5.23 → Next 16.x (audit itself points at next@16.4.0). |
| `postcss-selector-parser` 6.0.10 (moderate) | moderate | top-level via `@tailwindcss/typography@0.5.20`, which **hard-pins psp 6.0.10**; no published typography fixes it | `overrides: postcss-selector-parser@^7.1.6` + build/CSS diff verification, or documented acceptance (parser only sees checked-in CSS). |
| `shell-quote` 1.8.4–1.10.0 (**critical**) | critical | `concurrently@10.0.5` pins exactly `1.9.0`; no concurrently version fixes it | **Remove `concurrently`** — it appears in NO script of package.json, no CI workflow, and no repo file imports it. Cleanest removal of the only standalone-critical item. |
| `source-map-js` ≤1.2.1 (high) → 1.2.2 exists | high | top-level via magicast/tsx, @tailwindcss/node, postcss — all accept `^1.2.1` | Plain bump: it will resolve to 1.2.2 naturally; use `overrides` if npm keeps the old resolution. Patch-level, low risk. |

CI context: `.github/workflows/ci.yml` already runs a separate `audit` job with `npm audit --audit-level=high` on Node 22 — this plan's exit criterion is that job going green.

Out of scope (do not touch): anything in `.env`, Prisma schema/data model, app features. Each phase = its own commit(s) and ideally its own PR so a regression isolates to a known diff.

---

## Phase 0 — Baseline snapshot

**Objective:** Freeze the "before" evidence so later phases prove delta.

**Files:** docs only (new).

**Step 1: Capture baseline artefacts**

```bash
cd /Users/johnlynas/dev/nipp-0807
git checkout -b fix/npm-audit-remediation   # from security-scan HEAD 31ba744
npm audit --audit-level=high > /tmp/audit-before.txt
npm ls latest node-mailer concurrently shell-quote nodemailer postcss braces deepmerge-ts source-map-js 2>&1 | tee /tmp/tree-before.txt
wc -l < /tmp/audit-before.txt   # expect: "49 vulnerabilities (1 low, 12 moderate, 28 high, 8 critical)"
```

**Step 2: Record in plan tracking (commit message of Phase 1 references these files); no file changes required.**

Expected: command output as above. Do not commit /tmp artefacts; cite them in PR description.

---

## Phase 1 — Remove the accidental dependency trees ✅ COMPLETE (2026-10-07)

**Status / outcome:**
- Task 1.1 committed as `3027936` — lockfile −2,007 lines; `node_modules/npm` subtree gone; zero imports of `latest` (verified).
- Task 1.2 committed as `20d7520` — node-mailer gone; no references in code/config; ESM seam check: `import('nodemailer')` + `createTransport` OK from the post-uninstall tree; audit count unchanged by this task (node-mailer was a dedup pass-through to the same nodemailer instance — predicted, not an anomaly).
- Actual delta: **49 → 17 vulnerabilities** (3 moderate, 12 high, 2 critical) over **8 packages**: braces, deepmerge-ts, nodemailer, postcss (nested under next), postcss-selector-parser, shell-quote, source-map-js — exactly the Phase 2/3 mapping table in this plan; no surprises. (The original "~7" estimate counted distinct package names only; audit counts advisories per package.)
- Per-task verification: lint ✔ (eslint max-warnings=0 + lint-guardrails), tsc ✔, `npm test` 1938/1938 ✔, `npm run build` ✔.
- Exit gate re-run on a **clean `rm -rf node_modules && npm ci`** tree (CI-equivalent; Node 26/npm 12 local): audit exit=1 at exactly 17 findings — reproducible from the committed lockfile. Prisma engines were already cached, so no install-scripts approval was needed this phase; if a future clean install hits missing engines, `npx prisma generate` (or npm install-scripts approve) restores them.

### Task 1.1: Uninstall `latest`

**Objective:** Delete the `npm@2.x` toolchain subtree (~30 advisory packages).

**Files:**
- Modify: `package.json` (line 46 — `"latest": "^0.2.0",`)
- Modify: `package-lock.json` (via npm)

**Step 1: Remove the dependency**

```bash
npm uninstall latest
# verify package.json no longer contains "latest" (it was never imported: grep
#   -rn "'latest'" app lib scripts tests  → currently 0 hits)
grep -c '"latest"' package.json || echo "gone from manifest"
test ! -e node_modules/npm && echo "npm subtree gone"
```

**Step 2: Verify tree + build integrity**

```bash
npm ls latest   # expect: empty / (empty)
npm run lint    # expect: pass (eslint + lint-guardrails.mjs, max-warnings=0)
npm test        # vitest unit suite — expect full pass (was green at HEAD)
npm run build   # NEXT build — expect success
```

**Step 3: Audit delta check**

```bash
npm audit --audit-level=high | tail -1
# expect roughly: "7 vulnerabilities (0 low, 1 moderate, 5 high, 1 critical)"
#   (remaining: braces, deepmerge-ts, nodemailer, postcss, psp, shell-quote, source-map-js)
```

**Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "fix(deps): remove accidental 'latest' dependency pulling npm@2 toolchain

Commit c177938 accidentally added latest@0.2.0 (depends on npm@^2.5.1),
installing 201 packages of legacy npm internals under node_modules/npm —
the source of ~30 audit findings incl. tar/json-schema/minimist (all
'unfixable' upstream because the tree is uninstalled, not patched).
Nothing imported it; no code changes needed. Audit: 49 -> ~7."
```

### Task 1.2: Uninstall `node-mailer`

**Objective:** Remove the deprecated, never-imported mailer shim (audit chain for its transitive deps clears).

**Files:**
- Modify: `package.json` (line 50 — `"node-mailer": "^0.1.1",`)
- Modify: `package-lock.json`

Pre-verified facts implementer must not re-litigate: zero imports anywhere (`grep -rn "node-mailer" app lib scripts tests` → only package*.json hits); it's a deprecated wrapper that merely depends on nodemailer; the Google OIDC magic-link flow sends through `lib/notifications/email.ts` (nodemailer directly).

**Step 1: Remove and verify**

```bash
npm uninstall node-mailer
grep -rn "node-mailer" app lib scripts tests .lintstagedrc.json || echo "no references remain"
npm run lint && npm test && npm run build   # all three must pass untouched
```

**Step 2: Confirm nodemailer path still resolves (the real email seam)**

```bash
npm ls nodemailer node-mailer
# expect: nodemailer@9.1.1 only, under dependencies; node-mailer gone
node -e "require('nodemailer').createTransport; console.log('nodemailer import OK')" 2>/dev/null || \
  node --input-type=module -e "import('nodemailer').then(m => { m.createTransport(); console.log('ESM nodemailer OK') })"
```

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "fix(deps): remove unused deprecated node-mailer

Added 2026-09-08 (4bc176a) but never imported; email path is
lib/notifications/email.ts via nodemailer directly, incl. the OIDC
magic-link flow. npm registry marks it unmaintained/deprecated."
```

**Phase 1 exit gate:** `npm audit --audit-level=high` shows only the 7-item remainder; lint+test+build green; no import of removed packages anywhere in git history-referenced code paths (already grepped).

---

## Phase 2 — Safe upgrades with upstream fixes ✅ COMPLETE (2026-10-07)

**Status / outcome:**
- Task 2.1 committed `36fa57b` — lint-staged 17.6.0; the lint-staged→micromatch→braces path is gone (`npm ls braces` now shows only `eslint-config-next@15.5.26 → @next/eslint-plugin-next → fast-glob@3.3.1 → micromatch`, i.e. the Phase 3.2 item). Pre-commit hook smoke-tested on a staged file with existing `.lintstagedrc.json` (format unchanged, no config edits needed); scratch change reverted after. NOTE: lint-staged 17 requires Node ≥22.22.1 — our `engines` floor is 22.0.0 and CI's floating `node-version: '22'` resolves to newest 22.x; **tightening `engines`/CI pin is queued in Phase 4** (Task 4.1 note).
- Task 2.2 committed `11242df` — concurrently removed with zero code references; `shell-quote` gone from tree; **both critical advisories cleared** (17 → 14 after this task, both CRITICALs eliminated).
- Task 2.3 committed `3d450b5` — source-map-js at 1.2.2 everywhere via a plain `npm update source-map-js` re-resolution; **no override needed** (all consumers already accepted ^1.2.1) — plan's Step 2 fallback was not used, as expected from the range recon.
- Exit gate: clean `rm -rf node_modules .next && npm ci` → audit exactly **13 vulnerabilities (0 critical, 3 moderate, 10 high)** over the 5 planned Phase-3 targets only: braces (eslint path), deepmerge-ts, nodemailer×5, postcss (nested under next)×4, postcss-selector-parser. lint ✔ · tsc ✔ · 1938/1938 tests ✔ · build ✔ on that clean tree (prisma generate re-run after reinstall to restore engines).

### Task 2.1: Bump `lint-staged` 15 → 17 (kills one of two `braces` paths)

**Objective:** lint-staged 17.x drops micromatch/braces entirely (deps become tinyexec/picomatch/string-argv).

**Files:**
- Modify: `package.json` (`"lint-staged": "^15.4.0"` → `"^17.6.0"`)
- Check: `.lintstagedrc.json` (config format — 16/17 keep JSON object config; verify)

**Step 1: Upgrade and inspect the pre-commit hook contract**

```bash
npm i -D lint-staged@^17.6.0
cat .husky/pre-commit   # (or .git/hooks via husky prepare script) — confirm it calls `npx lint-staged`
npx lint-staged --help | head -3   # CLI smoke: 17.x binary present
```

**Step 2: Prove the hook actually runs and lints a staged file**

```bash
echo "" >> lib/logger.ts   # harmless whitespace change to stage
git add lib/logger.ts
npx lint-staged            # expect: prettier/eslint on logger.ts, clean exit
git checkout -- lib/logger.ts && git reset -q    # revert the scratch change
npm ls braces micromatch 2>/dev/null | grep -E "braces|micromatch" || echo "no micromatch via lint-staged"
```

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "fix(deps): lint-staged 15 -> 17 (drops micromatch/braces chain)

Removes the lint-staged->micromatch->braces DoS path flagged by
GHSA-vfj7-8cjw-p6xm. Pre-commit hook re-verified against .lintstagedrc.json."
```

### Task 2.2: Remove unused `concurrently` (kills the only standalone critical)

**Objective:** shell-quote command-injection (GHSA-pqg4-j6r4-53mv, critical) exists solely via concurrently@10 pinning shell-quote 1.9.0; no version fixes it, and the package is unused.

**Files:**
- Modify: `package.json` (`"concurrently": "^10.0.3",`)
- Modify: `package-lock.json`

**Step 1: Confirm usage absence one final time (belt-and-suspenders after lock churn)**

```bash
grep -rn "concurrently" package.json .github scripts .husky 2>/dev/null | grep -v node_modules || echo OK-unused
npm uninstall concurrently
test ! -e node_modules/shell-quote && echo "shell-quote gone from tree"
npm audit --audit-level=high | grep -c shell-quote   # expect: 0 (grep exit 1)
```

**Step 2: Full gate green + commit**

```bash
npm run lint && npm test && npm run build
git add package.json package-lock.json
git commit -m "fix(deps): remove unused concurrently (shell-quote critical CVE)

No script, workflow, or import uses it; shell-quote@1.9 is pinned by
concurrently 10 and unfixable upstream — removal is the clean fix for
GHSA-pqg4-j6r4-53mv."
```

### Task 2.3: Force `source-map-js` to 1.2.2 (patch-level bump)

**Objective:** Remove last pure-"safe fix" high; consumers all accept ^1.2.1 so 1.2.2 is compatible.

**Files:**
- Modify: `package.json` (add `"overrides"` block — repo has none today)
- Modify: `package-lock.json`

**Step 1: Try the natural resolution first**

```bash
npm install   # does plain re-resolution pick up source-map-js@1.2.2 since ranges are ^1.2.1?
npm ls source-map-js    # look for any remaining 1.2.1
```

**Step 2: If 1.2.1 persists, pin via overrides (exact snippet)**

Add to `package.json` (root level, beside `devDependencies`):

```json
"overrides": {
  "source-map-js": "^1.2.2"
}
```

then:

```bash
npm install && npm ls source-map-js   # expect all instances at 1.2.2
```

**Step 3: Verify compiled CSS/JS output unchanged in practice (CSS is the observable surface for source-map tooling)**

```bash
npm run build
ls -la .next/static/css | sed 's/.* //'    # record file list+hashes vs pre-change if diffable
npm audit --audit-level=high | grep -c source-map-js   # expect: 0
git add package.json package-lock.json
git commit -m "fix(deps): bump source-map-js to 1.2.2 (event-loop DoS fix)"
```

**Phase 2 exit gate:** `npm audit --audit-level=high` reports at most: braces (if eslint path remains), deepmerge-ts, nodemailer, postcss, postcss-selector-parser — i.e., **0 critical, ≤1 moderate**.

---

## Phase 3 — Major / framework upgrades ✅ COMPLETE (2026-10-07)

**Status / outcome:**
- Task 3.1 committed `07741fc` — nodemailer 9 → 10.0.16. New contract test `tests/unit/notifications-email.test.ts` (4 specs: transport options, mail shape, rejection→`{success:false,error}`, headerTitle) verified green on the v9 baseline BEFORE bumping, then green on v10. No code changes to email.ts (createTransport/sendMail unchanged); tsc clean against existing `@types/nodemailer@8.0.2` (its coverage ⊇ our usage), so no types shim; runtime import smoke of v10 in the same gate.
- Task 3.2 committed `d408d2e` — next 15 → 16.4.0 + eslint-config-next 16.4.0; nested `next/node_modules/postcss@8.4.31` gone (all instances ≥8.5.23). Three Next-16 breaking deltas handled minimally:
  - build/dev pinned `--webpack` in scripts (Next 16 defaults to Turbopack, which rejects the webpack-only next.config; full Turbopack migration deliberately out of scope).
  - `next lint` removed in Next 16 → `npm run lint` now runs `eslint . --max-warnings=0` directly (identical gate to CI's own command).
  - `revalidateTag(tag)` requires a cacheLife profile → all 11 mutation routes + the structural test expectation updated to `revalidateTag('org', { expire: 0 })` (behavior-preserving immediate purge); stale comment synced.
  - tsconfig.json/next-env.d.ts regenerated by the build; middleware.ts verified **byte-unchanged** and supported.
  - Confirmed BEFORE bump per plan gate: @next/eslint-plugin-next@16.4.0 **still** depends on fast-glob@3.3.1 → micromatch → braces, so the last braces entry survives Next 16 (vendor-blocked — disposition queued in Phase 4 acceptance table).
- Task 3.3 committed `d280e71` — deepmerge-ts override to ^8.0.2 took the **override path** (spike green): prisma validate ✔, generate ✔, migrate status ✔ (against live .env DB), full gate ✔. No acceptance needed.
- Task 3.4 committed `aacc823` — postcss-selector-parser override to ^7.1.6 took the **override path** with best-case evidence: built-CSS rule multiset byte-identical before/after (769 rules, `diff` exit 0) + full gate ✔. No acceptance needed.
- Exit gate on clean `rm -rf node_modules .next && npm ci`: lint ✔ · tsc ✔ · **1942/1942 tests** ✔ · build ✔ · audit down from 13 to the single expected residual — **5 high advisory entries, all one package: braces (GHSA-vfj7-8cjw-p6xm) via eslint-config-next → @next/eslint-plugin-next@16.4.0 → fast-glob@3.3.1 → micromatch**. Zero critical/moderate/low remain in the tree.
- Net delta for the phase: 13 findings → 5 (one package, dev-only static-analysis chain).

> Each of these must run the FULL gate: `npm run lint && npm test && npm run build` plus one targeted manual smoke (below), before merging.

### Task 3.1: nodemailer 9 → 10.0.16

**Objective:** Clear all five nodemailer advisories (tenant SMTP cache disclosure, addressparser DoS set).

**Files:**
- Modify: `package.json` (`"nodemailer": "^10.0.16"`; check `"@types/nodemailer"` — registry latest is 8.0.2, so if no v10 types exist, see Step 3)
- Modify (likely): `lib/notifications/email.ts` (only file importing nodemailer — createTransport + Transporter type; keep API usage identical unless 10 removes something)
- Test: `tests/unit/oidc-magic-link.test.ts` (mocks nodemailer), any email unit spec

**Step 1: Recon the exact 9→10 breaking surface before touching code**

```bash
npm view nodemailer@10.0.16   # changelog/dist; skim v10 migration notes in its README:
npm pack nodemailer@10.0.16 --pack-destination /tmp && tar -xzf /tmp/nodemailer-10.0.16.tgz -C /tmp --strip-components=1
grep -n "breaking\|Removed\|Removed" /tmp/README.md | head   # (adjust to actual changelog file)
npm view @types/nodemailer versions --json | tail   # re-check for v10 types at impl time
```

**Step 2: Write/extend the failing guard first** — add a unit spec pinning current `sendEmail` contract if absent:

Create `tests/unit/notifications-email.test.ts` (mirror existing mock style of `tests/unit/oidc-magic-link.test.ts:27`):

```ts
import { describe, it, expect, vi } from 'vitest';
vi.mock('nodemailer', () => ({
  createTransport: vi.fn(() => ({ sendMail: vi.fn().mockResolvedValue({ messageId: '<x>' }) })),
}));
import { sendEmail } from '@/lib/notifications/email';

describe('sendEmail (nodemailer v10 contract)', () => {
  it('sends via the shared transporter and returns success', async () => {
    const res = await sendEmail('a@b.co', 'sub', '<p>hi</p>', 'Hdr');
    expect(res.success).toBe(true);
  });
});
```

**Step 3: Run it against v9 (must pass) and against v10 (the real gate)**

```bash
npm test -- tests/unit/notifications-email.test.ts   # PASS on 9.x
npm i nodemailer@^10.0.16
# if @types/nodemailer <10: keep existing devDep; if tsc errors on types,
# add a minimal shim types/nodemailer-v10.d.ts (declare module) — verify with:
npm run type-check   # tsc --noEmit must pass
npm test -- tests/unit/notifications-email.test.ts tests/unit/oidc-magic-link.test.ts   # PASS on 10.x
```

**Step 4: Full gate + manual SMTP smoke (optional but recommended if a dev mailhog exists in env; skip with note if not):**

```bash
npm run lint && npm test && npm run build
git add -A && git commit -m "fix(deps): nodemailer 9 -> 10.0.16 (SMTP cache disclosure + addressparser DoS)"
```

### Task 3.2: Next.js 15 → 16 (removes nested postcss 8.4.31; may remove last braces path)

**Objective:** `node_modules/next/node_modules/postcss` (8.4.31, all four postcss advisories) disappears with a next line requiring ≥8.5.23; audit names next@16.4.0 explicitly.

**Files:**
- Modify: `package.json` (`"next": "^16.x"` and, if published for the 16 line, `"eslint-config-next": "matching major"` — check registry first)
- Watch: `middleware.ts` (Next 16 may rename middleware→proxy conventions), `app/**/route.ts` (route handler signatures), `.github/workflows/*.yml` (build env unchanged), `tailwind/postcss` config files

**Step 1: Registry recon — do NOT pick blindly**

```bash
npm view next@16 version engines --json | tail -5     # Node engine must satisfy our >=22<23 and CI node 22
N16=$(npm view next dist-tags.latest)
echo "candidate: $N16"
npm view "next@$N16" dependencies.postcss              # MUST be >=8.5.23 — that's the whole point
npm view "@next/eslint-plugin-next@$N16" dependencies  # note fast-glob presence/absence (braces path)
npm view eslint-config-next versions --json | tail -5  # decide companion bump
```

**Gate:** if `dependencies.postcss` < 8.5.23, STOP and record in PR — the phase's premise failed.

**Step 2: Bump + install (keep react@19 as-is; Next 16 supports it)**

```bash
npm i next@$N16   # + eslint-config-next bump if a 16-line release exists, else keep 15 config with a note
rm -rf .next && npm run build    # clean build — framework upgrades hide stale-cache issues
```

**Step 3: Framework-behaviour regression sweep (where breakages live)**

```bash
npm run lint && npm test        # full suite (1900+ unit/integration per commit msg)
# targeted checks the suite may not cover enough:
grep -rn "export default" middleware.ts | head -3   # confirm export shape still valid in 16
ls app/api | head    # spot-check one route handler compiles + responds (covered by integration tests)
```

Manual smoke (requires local env):

```bash
npm run dev &   # hit: /login (google button renders), one dashboard page, /api/health if present
# kill after 20–30s of green checks
```

**Step 4: Audit + tree verification, then commit**

```bash
npm ls postcss               # expect single top-level >=8.5.23, nothing nested under next
npm audit --audit-level=high | grep -cE "postcss$" || echo "postcss clear"
git add -A && git commit -m "fix(deps): next 15 -> 16 (drops nested postcss 8.4.31; postcss XSS/sourcemap advisories)

Also re-checks @next/eslint-plugin-next fast-glob/braces chain — recorded in PR."
```

### Task 3.3: `deepmerge-ts` — decide via spike, then override or document acceptance

**Objective:** Resolve the last "vendor-blocked" high (prisma → @prisma/config → deepmerge-ts 7.1.5; no Prisma stable has fixed it as of 2026-10).

**Files (if overriding):**
- Modify: `package.json` (`overrides.deepmerge-ts = "^8.0.2"`)
- Verify surface: prisma CLI only — `@prisma/client` doesn't depend on it (verified in registry metadata)

**Step 1: Spike the override in a throwaway fashion (no commit yet)**

```bash
node -e "const p=require('./package.json'); p.overrides=Object.assign({},p.overrides,{'deepmerge-ts':'^8.0.2'}); require('fs').writeFileSync('package.json', JSON.stringify(p,null,2)+'\n')"
npm install && npm ls deepmerge-ts   # expect 8.x everywhere
```

**Step 2: Exercise every prisma surface in the real dev env (this is what deepmerge touches)**

```bash
npx prisma validate                    # schema parses+merges through @prisma/config
npm run db:migrate -- --create-only    # OR: npx prisma migrate dev (per repo convention: they use `prisma db push`; use the least-destructive available: validate + generate first)
npx prisma generate
npm run db:seed 2>/dev/null || echo "(seed needs live DB — run in env where DATABASE_URL is set; record outcome)"
```

**Decision point:**
- All of the above green → **Step 3 commit the override.**
- Anything breaks → revert package.json, go to **Step 4 (acceptance).**

**Step 3 (override path): commit**

```bash
npm run lint && npm test && npm run build   # full gate once more
git add -A
git commit -m "fix(deps): override deepmerge-ts to 8.0.2 (stack-exhaustion DoS) via prisma config chain"
```

**Step 4 (acceptance path): document the accepted risk instead** — append to `SECURITY.md` a short block:

```markdown
## Accepted dependency risks

| Package | Advisory | Why accepted | Revisit when |
|---|---|---|---|
| deepmerge-ts 7.1.5 (via prisma) | GHSA-ggr8-5vv4-36mx stack exhaustion on recursive object graphs | Overriding to v8 <outcome-of-failure>; Prisma ships no fixed line yet; exposure is Prisma CLI config merging only, never request-path code | Next Prisma stable that depends on deepmerge-ts ≥8 (currently 8.0.x is RC-only); re-audit at each major dep refresh |
```

Commit docs change: `git add SECURITY.md && git commit -m "docs(security): record accepted risk for prisma deepmerge-ts (vendor-blocked)"`

### Task 3.4: `postcss-selector-parser` — override + CSS-diff, or accept

**Objective:** Clear the last moderate (typography hard-pins psp 6.0.10; DoS is CPU-exhaustion on quadratic selectors — attack surface = local CSS files only).

**Files (if overriding):** `package.json` (`overrides["postcss-selector-parser"] = "^7.1.6"`), watch generated CSS in `.next/static/css`.

**Step 1: Capture the "before" built CSS fingerprint**

```bash
npm run build && find .next/static/css -type f -exec shasum {} \; | tee /tmp/css-before.txt
```

**Step 2: Apply override, rebuild, diff fingerprints semantically (hashes WILL change due to sourcemap/versioned comments — compare rule content)**

```bash
node -e "const p=require('./package.json'); p.overrides=Object.assign({},p.overrides,{'postcss-selector-parser':'^7.1.6'}); require('fs').writeFileSync('package.json', JSON.stringify(p,null,2)+'\n')"
npm install && npm ls postcss-selector-parser   # expect 7.x
rm -rf .next && npm run build
# semantic diff: strip comments/whitespace, compare selector+declaration multisets:
for f in $(find .next/static/css -name '*.css'); do cat "$f"; done | tr -s ' \n' '  ' | grep -oE '[^ }]+' | sort -u > /tmp/css-tokens-after.txt
npm audit --audit-level=high | grep -c postcss-selector-parser || echo "psp clear"
```

**Decision point:** tokens set unchanged (modulo hashes) AND lint/test/build green → commit override. Any visual-relevant token drift → revert, document acceptance in the same `SECURITY.md` table:

```markdown
| postcss-selector-parser 6.0.10 (via @tailwindcss/typography) | GHSA-rj75-hqrm-r3gf quadratic parse CPU exhaustion | psp 7 forces CSS output drift (<outcome>); parser only processes checked-in CSS, not attacker input; no published typography ships the fix | When @tailwindcss/typography publishes a release on psp ≥7.1.6 |
```

**Phase 3 exit gate:** `npm audit --audit-level=high` reports either **0 vulnerabilities**, or every remaining line is present in SECURITY.md's accepted-risk table with a "revisit when" trigger.

---

## Phase 4 — Lock the win: CI hardening + record ✅ COMPLETE (2026-10-07)

**Status / outcome:**
- Task 4.1 — `engines` floor raised to `>=22.22.1 <23.0.0` (matches lint-staged 17's own
  `node >=22.22.1` requirement; CI's floating `node-version: '22'` resolves to newest 22.x,
  verified ≥22.22.1 at implementation time). No `.github/workflows/ci.yml` change needed —
  the audit job already does clean `npm ci` + `npm audit --audit-level=high` (exit code
  fails CI); per plan's Step-0 "change nothing if the existing job is sufficient."
  Gate proven on a clean `rm -rf node_modules .next && npm ci` tree: lint ✔ · tsc ✔ ·
  tests ✔ · build ✔ · audit exit=1 at exactly the **5 braces-chain findings** — identical
  to the Phase-3 exit-gate residue (reproducible from the committed lockfile). Local env note:
  npm 12 blocks postinstall scripts (`prisma generate` re-run after `npm ci` to restore
  generated types) — CI's npm 10.x runs them automatically, so the gate is green there.
- Task 4.2 — SECURITY.md §10 "Dependency Auditing" added: CI-gate description + remediation
  record (this phase's commits) + **Accepted Risk Register** with the single residual:
  `braces@3.0.3` GHSA-vfj7-8cjw-p6xm via the dev-only eslint chain. Disposition confirmed at
  implementation time: advisory range is ≤3.0.3 across ALL braces 3.x (no fix version
  published); fast-glob's only newer releases (3.3.2, 3.3.3) still depend on
  micromatch ^4 → braces; `@next/eslint-plugin-next` at dist-tags.latest (16.4.0) still pins
  fast-glob 3.3.1 exactly — the override path is a no-op for this chain, so acceptance with a
  dated revisit trigger is the plan's fallback branch ("…or every remaining line has a
  SECURITY.md accepted-risk entry"). `--omit=dev` explicitly rejected and documented as such
  (it would unscope the whole dev toolchain from the gate).

### Task 4.1: Make the audit gate tamper-evident and repeatable

**Files:** Modify: `.github/workflows/ci.yml` (audit job only)

CI already has the `audit` job (line 46–63). Strengthen minimally — no new tooling (YAGNI):

**Add (from Phase 2, Task 2.1 follow-up):** pin the runtime floor so a future CI Node bump / local drift can't quietly break lint-staged 17 (`engines: >=22.22.1`) or other tool chains:
- `package.json` engines: `"node": ">=22.0.0 <23.0.0"` → `">=22.22.1 <23.0.0"` (matches lint-staged 17's own requirement; CI already uses Node 22).
- Optionally tighten the audit job to assert it runs under a supported runner: no change needed — ubuntu-latest + setup-node '22' is fine as-is, just confirm in the PR that the resolved 22.x satisfies 22.22.1 (it does today; re-check at merge).

```yaml
      - name: Security audit
        run: |
          npm audit --audit-level=high
          # fail loudly and visibly on any blocking finding
```

(Change nothing if you consider the existing job sufficient — its exit code already fails CI. Only add a `npm ci` freshness guarantee if lockfile drift is observed.)

**Step 1: Prove the gate locally with CI's exact commands**

```bash
rm -rf node_modules && npm ci
npm audit --audit-level=high; echo "exit=$?"   # expect exit=0 (or accepted-risk note if Phase 3 landed on acceptance)
npx eslint . --max-warnings=0
npx tsc --noEmit
npm test
npm run build
```

**Step 2: Commit**

```bash
git add -A && git commit -m "chore(ci): verify clean install + high-level audit gate (phase 4 closure)"
```

### Task 4.2: Final report + accepted-risk register

**Files:** Modify: `SECURITY.md` (if no acceptance table exists, create the section; if Phase 3 produced acceptances, they're already there)

Add/refresh a "Dependency audit" note:

```markdown
## Dependency auditing
- CI: `npm audit --audit-level=high` on Node 22 (`.github/workflows/ci.yml`, `audit` job).
- Last full remediation: 2026-10-07 (security-scan branch) — removed accidental
  `latest`/npm@2 toolchain, node-mailer, concurrently; upgraded lint-staged 17,
  nodemailer 10, next 16, source-map-js 1.2.2; overrides: <list>. Residuals: <table or "none">.
```

**Step 3: Final full gate + commit**

```bash
npm run lint && npm test && npm run build
git add -A && git commit -m "docs(security): record dependency-audit remediation state (2026-10)"
```

---

## Files changed (whole plan)

| File | Phase |
|---|---|
| `package.json` | 1.1, 1.2, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4 |
| `package-lock.json` | every npm op above (always committed together with package.json) |
| `tests/unit/notifications-email.test.ts` | new — 3.1 Step 2 |
| `lib/notifications/email.ts` | 3.1 (only if v10 API forces a change) |
| `SECURITY.md` | 3.3/3.4 (acceptances, conditional), 4.2 |
| `.github/workflows/ci.yml` | 4.1 (minimal, conditional) |
| `middleware.ts`, route handlers | 3.2 (watch-list only — edit only if Next 16 breaks them; tests will tell first) |

## Verification summary (global exit criteria)

1. `rm -rf node_modules && npm ci` succeeds on Node 22 (matches CI).
2. `npm audit --audit-level=high` → exit 0, or every remaining line has a SECURITY.md accepted-risk entry dated and with a revisit trigger.
3. `npx eslint . --max-warnings=0`, `npx tsc --noEmit`, `npm test` (full suite), `npm run build` — all green after the last commit.
4. Pre-commit hook (`husky` + lint-staged 17) exercises a staged file successfully.
5. Email smoke: unit specs for `sendEmail` and OIDC magic-link pass on nodemailer 10; dev-env SMTP delivery spot-checked if mailhog/local relay available (else recorded as not-tested).
6. No direct import of `latest`, `node-mailer`, or `concurrently` introduced anywhere (they're gone, not replaced).

## Risks & tradeoffs

- **Task 3.2 (Next 16) is the highest-blast-radius step** — framework upgrade behind the largest test surface mitigation. Mitigation: own PR, clean `.next`, full suite + manual smoke, and the Step 1 registry gate that aborts if the postcss premise fails.
- **`overrides` are blunt instruments** (source-map-js safe; psp/deepmerge-ts can force API drift). Each override task includes a semantic-diff/spike step and a documented-fallback acceptance path — we never ship an override whose regression evidence is "looks fine".
- **Prisma RC trap:** `prisma` dist-tag `latest` = 8.0.0-rc.21; stable line (7.10.0) does NOT fix deepmerge-ts. Do NOT "upgrade to latest" as the fix — it's an RC and doesn't help. This is why Task 3.3 is spike-or-accept.
- **`@types/nodemailer` lags (8.0.2 vs runtime 10)**: resolved by checking at impl time, not preemptively vendoring types.
- **Audit output after Phase 1 is estimated** ("~7 vulnerabilities"); if the real count differs, trust the command and re-baseline before continuing — don't force-fit the narrative.
- Lockfile churn across phases: every phase ends with `npm ci` from the committed lock to prove CI reproducibility (Phase 4 does this globally; do it per-phase if any install misbehaves).

## Open questions (answer before/during Phase 3, not after ship)

1. Next 16 line: which exact version, and does its `@next/eslint-plugin-next` shed fast-glob? (Task 3.2 Step 1 answers; if no — the residual braces entry joins the acceptance table.)
2. Does @types/nodemailer v10 exist by execution date? (Task 3.1 Step 1.)
3. Is there a dev SMTP relay for the manual email smoke, or is unit+integration mocking sufficient? (Task 3.1 Step 4 — acceptable to skip with recorded note.)
4. Acceptance appetite: are postcss-selector-parser / deepmerge-ts residual risks acceptable under "local-input-only exposure" wording in SECURITY.md, or must both ship via override? (Owner call at Task 3.3/3.4 decision points.)
