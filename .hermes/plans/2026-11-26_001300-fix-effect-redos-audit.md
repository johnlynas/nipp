# Fix `effect` ReDoS audit finding (GHSA-7589-6fvf-x4pw) via npm override

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Bring `npm audit --audit-level=high` back to zero findings by forcing the transitive `effect` dependency (pulled in by Prisma's CLI toolchain) from the vulnerable 3.20.0 to a patched 3.22.x.

**Architecture:** The vulnerability is not in our code — `@prisma/config@7.10.1` (a dev-only dep of the `prisma` CLI) pins `effect` at exactly `3.20.0`, and no newer stable Prisma exists that fixes it (Prisma 8 is RC/dev only). The fix is an npm `overrides` pin: `"effect": "^3.22.1"`, which resolves to 3.22.5 (first patched line per the advisory: `<=3.22.0` vulnerable). No repo code imports `effect` directly (verified: zero matches outside `node_modules`), so the override is low-risk; `effect` is `devOptional` and only runs inside Prisma CLI config loading, never in the app runtime.

**Tech Stack:** npm overrides, package-lock.json, Prisma 7.10.1 toolchain (unchanged).

---

## Current context / assumptions (verified 2026-11-26)

- `package.json` deps: `prisma@7.10.1`, `@prisma/client@7.10.1`, `@prisma/adapter-pg@7.10.1` (all pinned).
- `package-lock.json` resolves `node_modules/effect` to **3.20.0** (vulnerable); `node_modules/@prisma/config` declares `"effect": "3.20.0"`.
- Local `node_modules/effect` is currently 3.22.5 (manually drifted — `npm ls effect` reports `invalid: "3.20.0"`), which is why the user's audit output looks odd; the lockfile is what CI (`npm ci`) will install, and it still contains 3.20.0.
- `npm view prisma version` → latest stable is **7.10.1** (8.0.0 is RC only); `@prisma/config` latest is 7.10.1 with the same exact pin. **Upgrading Prisma is not an option right now.**
- CI gate: `.github/workflows/ci.yml` runs `npm audit --audit-level=high` in a dedicated `audit` job (line 70).
- Repo has uncommitted changes to two test files (`tests/unit/tenant-mgmt-members.test.ts`, `tests/unit/tenant-mgmt-settings.test.ts`) — leave them untouched; do not include them in the commit.

## Proposed approach

Single-phase, single-commit change: add one override entry, clean-install so the lockfile picks it up, gate on audit + type-check + tests, commit `package.json` + `package-lock.json`.

---

### Task 1: Baseline snapshot (read-only)

**Objective:** Record pre-change state so the post-change delta is provable.

**Steps:**
1. Run: `npm ls effect prisma @prisma/config` — expect `effect@3.20.0 invalid` style output (lockfile vs node_modules drift).
2. Run: `npm audit --json > /tmp/audit-before.json`, then parse with a small script file (do NOT pipe npm output into `node -e`):

   ```js
   // /tmp/report.js
   const d = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
   for (const [k, v] of Object.entries(d.vulnerabilities || {})) {
     console.log(k, v.severity, v.range, v.fixAvailable ? JSON.stringify(v.fixAvailable) : 'no-fix');
   }
   console.log('high:', d.metadata?.vulnerabilities?.high ?? 0);
   ```
   Run: `node /tmp/report.js /tmp/audit-before.json` — expect 3 high (effect cluster).

**Verification:** Baseline numbers captured in the session report. No files changed.

### Task 2: Add the `effect` override

**Objective:** Force patched `effect` into the dependency tree without touching Prisma versions.

**Files:**
- Modify: `package.json` — the existing `"overrides"` block (currently lines ~97-100, containing `postcss-selector-parser` and `minimatch`).

**Step 1: Edit**

Add one key to the overrides object, keeping it alphabetized-ish with the existing entries:

```json
"overrides": {
  "effect": "^3.22.1",
  "postcss-selector-parser": "^6.1.5",
  "minimatch": "^11.0.1"
}
```

**Step 2: Verify the edit landed**

Run: `node -e "console.log(require('./package.json').overrides)"` — expect all three keys printed.

### Task 3: Clean install to sync lockfile + node_modules

**Objective:** Make the override land in `package-lock.json` and fix the local drift (`npm ls effect` currently says `invalid`).

**Steps:**
1. Run: `rm -rf node_modules && npm ci` — clean install is required so the override actually re-resolves (a plain `npm install` on a drifted tree can keep stale entries). Note `postinstall` runs `patch-package`; `patches/next+16.4.3.patch` must apply cleanly — if it fails, stop and report.
2. Run: `npm ls effect @prisma/config prisma` — expect **no** `invalid` flag; `effect@3.22.5` under `@prisma/config`. npm will print an override warning that `@prisma/config`'s exact pin is being overridden — expected, note it in the report.

### Task 4: Security gate (the actual fix proof)

**Objective:** Prove the audit finding is gone at the CI severity level.

**Steps:**
1. Run: `npm audit --audit-level=high` — **Expected: exit code 0, "found 0 vulnerabilities" (or no high findings).** This is the pass/fail gate for the whole task.
2. Run: `npm audit --json > /tmp/audit-after.json && node /tmp/report.js /tmp/audit-after.json` — expect 0 high; compare against Task 1 baseline and record any remaining non-high findings in the report.

**If this fails:** do not proceed. Re-check `npm ls effect` (is it really 3.22.5?) and re-run a clean install once. If still red, stop and report — do not escalate to `npm audit fix --force`.

### Task 5: Quality gates

**Objective:** Confirm the override didn't break anything (it shouldn't — dev-only dep — but verify).

**Steps (all must pass):**
1. `npm run type-check`
2. `npm test` (unit)
3. `npm run lint`
4. `npm run build` (CI runs it; catches any Prisma client generation surprise)

### Task 6: Commit

**Objective:** One bisectable commit, lockfile in sync, unrelated dirty files excluded.

**Steps:**
1. Run: `git status --short` — confirm only `package.json` + `package-lock.json` are staged; the two pre-existing test-file modifications must stay unstaged/uncommitted.
2. Run:

   ```bash
   git add package.json package-lock.json
   git commit -m "fix(security): override effect to ^3.22.1 (GHSA-7589 ReDoS in @prisma/config chain)"
   ```

### Task 7: Report + accepted-risk note

**Objective:** Close the loop and record the band-aid for future removal.

**Steps:**
1. Report: before/after audit counts, `npm ls effect` output, gate results (type-check/test/lint/build), override warning text.
2. Note in the report (and as a follow-up if the user wants it tracked): **drop the `effect` override when Prisma ships a stable release whose `@prisma/config` pins `effect >= 3.22.1`** (Prisma 8 RCs exist; re-check `npm view @prisma/config version` + its `dependencies.effect` at that point). If the repo has an accepted-risk convention (e.g. SECURITY.md), add a row documenting this override there — check first, don't create new docs unprompted.

---

## Files likely to change

| File | Change |
|---|---|
| `package.json` | +1 line in `overrides` (`"effect": "^3.22.1"`) |
| `package-lock.json` | `node_modules/effect` re-resolved 3.20.0 → 3.22.5 (plus its deps) |

Nothing else. No Prisma version bumps, no code changes.

## Tests / validation

- `npm audit --audit-level=high` → exit 0 (the CI gate at `.github/workflows/ci.yml:70`)
- `npm ls effect` → clean (no `invalid`)
- `npm run type-check`, `npm test`, `npm run lint`, `npm run build` → all green

## Risks, tradeoffs, open questions

- **Override vs. upgrade:** upgrading Prisma is the "clean" fix but no stable release exists that fixes it (7.10.1 is latest stable; 8.x is RC). Override is the pragmatic fix and is what `npm audit` itself can't do without `--force` (which would downgrade to prisma@6 — a major breaking change we must not take).
- **Override band-aid:** npm will warn that `@prisma/config`'s exact pin is overridden. Acceptable because `effect` only runs inside the Prisma CLI's config loading (`devOptional`), never in the app runtime, and 3.22.5 is a patch-level bump within the same major.
- **Re-check trigger:** when Prisma 8 (or any later stable) lands, verify its `@prisma/config` effect pin and remove the override if it's fixed upstream.
- **Local drift:** user's local `node_modules` already had 3.22.5 while the lockfile had 3.20.0 — the clean install in Task 3 normalizes this; anyone with a stale tree should also reinstall.
- **Open question (non-blocking):** none — approach is determined by registry facts.
