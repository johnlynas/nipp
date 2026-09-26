# Org Chart Right Slide-In Panel — Elegance Refactor (Option A)

> **For Hermes:** Use the `impeccable` skill (Operate mode, refinement) for execution. Load `reference/craft-floor.md` immediately before editing UI. Do NOT rerun `context.mjs`; context was resolved this session.

**Goal:** Make the org-chart right slide-in panel (`OrgChartSidebar`) as elegant and easy to use as the left admin nav rail, while preserving every existing function (org switcher, teams list, unassigned members, manage links, team-click → canvas expand, member-click → navigate away).

**Architecture:** Refinement of an incumbent surface — navy-850 identity, right position, slide/collapse behavior all stay. Interior is restructured: real identity header replaces the empty toggle bar, org combobox is demoted to a compact switcher popover, list sections get quiet micro-labels with canvas-sync state, collapsed rail gains an icon stack, and row types get affordance differentiation. Small state lift in `page.tsx` exposes which teams are open on the canvas so the panel mirrors it.

**Tech Stack:** Next.js 15 App Router, React client components, Tailwind (project tokens: `--color-navy-*`, `#e2e8f0`/`#94a3b8` text ramp), lucide-react icons, Vitest.

**Reference standard (what "the left slide-in menu" does well):**
`app/dashboard/admin/layout.tsx` — collapsed rail keeps 30px icons; group labels are `text-[11px] font-semibold uppercase tracking-wider text-slate-500`; rows = icon + label with active/hover states; consistent 200ms transitions.

---

## Out of scope (do not touch)

- `components/org-chart/OrgChart.tsx` canvas rendering, zoom/pan, on-canvas search, connector geometry, mobile accordion.
- `components/org-chart/OrgChartDetailModal.tsx`.
- `lib/org-chart.ts`, API routes, `tests/` fixtures for lib layer.
- `CalendarSidebar` behavior (Phase 5 extraction is a follow-up decision, not part of this deliverable).

## Current problems (evidence, with line refs in current file)

| # | Problem | Location |
|---|---------|----------|
| 1 | Collapsed state = empty w-16 navy bar with only a burger button — reads broken next to the icon-carrying left rail | `OrgChartSidebar.tsx:113-135` |
| 2 | Chrome-first layout: toggle bar sits above the org switcher; no identity header (org name + team/people counts) anywhere in panel | `OrgChartSidebar.tsx:118-196` |
| 3 | Five section headings of equal bright weight (`text-sm font-semibold`, `#e2e8f0`) — zero hierarchy, contradicts left rail's quiet micro-labels | `OrgChartSidebar.tsx:141,201,220,250` |
| 4 | Org combobox is a full form-field box for information that already appears on the canvas root node; visible to ALL roles though only super admins can switch | `OrgChartSidebar.tsx:139-196` |
| 5 | No canvas sync: panel never shows which teams are expanded in the chart | page state in `page.tsx:14,152-158` vs `OrgChart.tsx:44` (`openTeamIds` is internal) |
| 6 | Team rows (stay on page) and unassigned member rows (navigate away) share identical styling — accidental navigation trap | `OrgChartSidebar.tsx:232-243` vs `256-263` |
| 7 | Manage links are bare text, no icons, while left nav uses icons on every row | `OrgChartSidebar.tsx:106-216` |
| 8 | No way to find a team by name in the panel (search exists only on canvas) | — |
| 9 | Width asymmetry: right w-80 (320px) vs left w-64 (256px) squeezes canvas unevenly | `OrgChartSidebar.tsx:114-115` |

---

## Tasks

### Task 1: Identity header replaces empty toggle bar

**Objective:** Top of panel shows the organization's identity; toggle moves beside it.

**Files:** Modify `components/org-chart/OrgChartSidebar.tsx:112-135`

Steps:
1. Replace the border-b toggle-only div with a header row:
   - Left: org name — 16px semibold white, truncated; below it one quiet subline `text-xs text-slate-400`: `{tree.teams.length + (unassigned ? 1 : 0)} teams · {totalMemberCount} people` (sum member counts across `tree.teams`, add `tree.unassigned.length`).
   - Right: existing toggle icon button (unchanged behavior/aria-labels), `p-1.5 rounded hover:bg-navy-800`.
2. Keep `border-b` with `var(--color-navy-800)`; padding `px-4 py-3`; header must be `flex-shrink-0`.
3. Delete the now-redundant "Organization" section label (Task 2 removes its content).

Verify: desktop browser pass — expanded panel leads with org name + counts; collapse/expand animation unchanged (200ms width transition on the aside).

**Commit:** `refactor(org-chart): identity header in right panel`

---

### Task 2: Demote org combobox to compact super-admin switcher

**Objective:** Non-super-admins see nothing extra (header already shows org); super admins get a small icon-button popover with the searchable list. No form-field chrome in the panel body.

**Files:** Modify `components/org-chart/OrgChartSidebar.tsx:38-104,139-196`

Steps:
1. Gate render on `organizations.length > 0` (super admin only — the page already fetches the list and passes it; non-admins receive `[]`, see `page.tsx:149`).
2. Swap the `<input>` combobox for an icon button in the header row (next to name/subline, before the toggle): building/lucide `Building2` h-4 w-4, chevron-down; hover `bg-navy-800`; `aria-label="Switch organization"`.
3. Popover: absolute-right below the header, reusing the existing dropdown markup (`OrgChartSidebar.tsx:166-189`) — navy-800 surface, navy-700 border, max-h-60 scroll, live-filter input *inside* the popover (focus it on open), "No organizations match" empty state, selected row `bg-navy-700/40` + semibold. Outside-click/Escape close logic stays as-is (`useEffect` at :60-70).
4. Remove `orgFocused`/`displayedOrgText`/`effectiveOrgQuery` machinery from the main input (move filtering into popover-local state); delete the standalone "Organization" section block entirely.

Verify: super admin (logged in as johnlynas666@gmail.com at localhost:3000 with `?org=` list populated): button opens popover, typing filters, selecting swaps org and canvas resets centered (existing `useEffect` at `OrgChart.tsx:233-238`). Non-super-admin view: no combobox remnants.

**Commit:** `refactor(org-chart): compact org switcher for super admin`

---

### Task 3: Quiet micro-labels + team row upgrades + panel search

**Objective:** Hierarchy matching the left rail; team rows show open-state and counts elegantly; add a local filter.

**Files:** Modify `components/org-chart/OrgChartSidebar.tsx:219-247` (teams block), add `searchQuery` state near :38

Steps:
1. Section labels "Teams" / "Unassigned" (Manage, Task 4) → `text-[11px] font-semibold uppercase tracking-wider text-slate-500 px-4 pt-3 pb-1` — identical recipe to `layout.tsx:110`.
2. Panel search: small input above Teams list, same tokens as current combobox styling (`bg-navy-800 border navy-700 rounded text-sm`, placeholder "Filter teams…"); clear (X) button when non-empty; filters only the rendered team list (name substring, case-insensitive); empty result → `text-xs text-slate-400` "No teams match". Filters local to panel — canvas untouched (YAGNI: no two-way filtering now).
3. Team rows: keep left name `text-sm #e2e8f0`; count becomes a pill (`px-1.5 rounded-full bg-navy-700/40 text-xs text-slate-300`); add left-edge open indicator — 2px accent bar (`var(--color-accent)`) via `border-l-2` when team id ∈ `openTeamIds` prop (Task 5), plus `aria-current` on that row; hover state unchanged.

Verify: typing "eng" filters list; no canvas effect; open teams show accent edge (after Task 5); lint + existing sidebar-referencing tests untouched/passing.

**Commit:** `feat(org-chart): panel teams filter and quiet section labels`

---

### Task 4: Affordance differentiation — manage links, unassigned rows

**Objective:** "This leaves the page" must be visible at a glance; manage rows get iconography like the left rail.

**Files:** Modify `components/org-chart/OrgChartSidebar.tsx:106-217` (manage), `:248-268` (unassigned)

Steps:
1. Manage links: lucide icons — `Settings`, `UsersRound`, `Shield` (h-4 w-4, `shrink-0 mr-2 text-slate-500`); row = flex items-center, hover `bg-navy-800/60`; keep hrefs and `viewerCanEdit` gate exactly.
2. Unassigned rows: initials disc (first letters of first+last name, `h-6 w-6 rounded-full bg-navy-700/40 text-[10px]`) + member name + role subline; trailing `ExternalLink` icon h-3.5 slate-500 so navigation-away reads as external action; `title` attr "Open user profile".
3. Keep `onMemberClick` behavior byte-identical (navigates to `/admin/users/:id`, see `page.tsx:156-158`).

Verify: unassigned row click navigates exactly as before; manage link targets unchanged; screen-reader names sensible.

**Commit:** `refactor(org-chart): differentiate navigating rows, iconize manage links`

---

### Task 5: Canvas sync — openTeamIds surfaced to panel

**Objective:** Panel accent edge (Task 3) reflects live canvas expansion state.

**Files:** Modify `components/org-chart/OrgChart.tsx` (expose state), `app/dashboard/admin/org-chart/page.tsx:9-16,136-142`, `components/org-chart/OrgChartSidebar.tsx` (new prop)

Steps:
1. In `OrgChart.tsx`: add optional prop `onOpenTeamsChange?: (ids: Set<string>) => void`; call it in a `useEffect` on `openTeamIds` (send fresh copy). Do NOT change which ids are controlled — canvas still owns the Set; this is observation-only. Existing `focusTeamId` expand path (:65-71) flows through the same effect, so sidebar-initiated expansion also syncs back.
2. In `page.tsx`: `const [openTeamIds, setOpenTeamIds] = useState<Set<string>>(new Set())`; pass setter to `<OrgChart onOpenTeamsChange={setOpenTeamIds}>`, pass set to `<OrgChartSidebar openTeamIds={...}>`.
3. Sidebar: new optional prop `openTeamIds?: Set<string>`; use for the accent edge in Task 3.

Verify: expand a team on canvas → panel row gains accent bar; click that row in panel (re-collapse? no — it re-focuses/expands, existing behavior) → consistent; collapse org on canvas → bars clear; mobile accordion unaffected.

**Commit:** `feat(org-chart): sync expanded teams into right panel`

---

### Task 6: Collapsed rail icon stack + width parity

**Objective:** Kill the broken empty-strip look; balance panel widths with left rail.

**Files:** Modify `components/org-chart/OrgChartSidebar.tsx:112-135, after :270`

Steps:
1. When `!isExpanded`: render vertical stack in the w-16 strip — `Network` (expand), `UsersRound` (expand+scroll to unassigned section if present), each `h-[30px] w-[30px] mx-auto my-2 text-slate-400 hover:text-white` with `title` tooltips; clicking any icon calls `onToggle()` (expand) — matching left rail behavior.
2. Optional width: `w-80` → `w-72` (288px). Keep as a single decision point — if user keeps w-80, skip.
3. Transitions: keep `duration-200`; add `justify-center items-start pt-3` to stack container so icons sit at natural eye level.

Verify: collapse → strip shows icon stack (matches left rail idiom); expand → header layout unchanged; no horizontal scrollbar at any width between w-16↔w-72/80 during animation (overflow-hidden already present).

**Commit:** `refactor(org-chart): collapsed rail icon stack`

---

### Task 7: Verification pass (bounded)

**Objective:** Prove the finished panel against lint, tests, and a single batched browser inspection.

Steps:
1. `npm run lint` — clean.
2. `npm run test` — all pass (org-chart integration/unit suites must be green; no fixture changes expected).
3. `npm run build` — clean.
4. One batched browser round at localhost:3000 (login johnlynas666@gmail.com / RuthB3421): desktop 1440px + mobile 375px together — states: expanded, collapsed (+ icon stack), org-switch popover open, teams filtered ("no match" state), unassigned section present/absent, manage links (super admin only). Fix everything found in ONE batch fix, then at most one confirm round. Stop polishing after that.
5. Run the impeccable detector once over changed targets: `node /Users/johnlynas/.hermes/skills/impeccable/scripts/detect.mjs --json components/org-chart/OrgChartSidebar.tsx components/org-chart/OrgChart.tsx app/dashboard/admin/org-chart/page.tsx` — remediate findings inline, no second loop.

**Commit:** (only if fixes land) `polish(org-chart): browser-pass fixes`

---

## Follow-up (not in this deliverable — decide separately)

- **Phase 5 extraction:** extract the shared navy-sidebar shell (header/micro-labels/collapse-rail) into `components/dashboard/NavyPanelSidebar.tsx` so `CalendarSidebar.tsx` inherits the same header + label treatment. Only after Option A is proven on org-chart, and only if user wants calendar parity.
- **Option B/C** (light inspector surface / no panel at all): alternative directions discussed; not planned here.

**Open decisions:** settled — w-72 adopted; "teams" count = real teams only (unassigned counted in people). Confirmed no extra API call is needed: counts derive from `tree` (same payload rendering the rows) — structurally accurate.

**App target:** desktop browsers only (user's primary scene); mobile accordion path left untouched, out of scope.

## Risks / tradeoffs

- **State lift (Task 5)** adds a render prop; risk is a feedback loop if `onOpenTeamsChange` triggers page re-render that resets canvas state — guarded by using functional set in page + observation-only effect (no control). Monitor in Task 7 step 4.
- **Popover focus management:** moved filtering input into popover needs autofocus + Escape-back-to-button; existing outside-click logic reused to avoid duplication.
- **CalendarSidebar divergence:** after this refactor the two right panels differ in interior (calendar keeps its combobox form-field until Phase 5). Accepted per scope; flag to user.
