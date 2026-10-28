# Work Order UI — Plan 1 of 3: Work Orders and Work Order Notes

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Complete the work order flow's core admin + tenant UI: the full super-admin
work order detail page (state header, all transition actions incl. Send-RFQ and
Assign-contractor dialogs, notes panel) plus both read-only tenant pages.

**Architecture:** `fetch` + `useState` client components (the incumbent dashboard
pattern — NO react-query), one admin detail client component whose action buttons are
derived from the single shared state map in `lib/work-order-state.ts`. Quotes and
invoicing management are delivered by Plans 2 and 3 as incremental panels added to the
same page; this plan ships them as placeholders that Plan 1 renders read-only where data
already exists. All APIs already exist and are verified — no backend work here.

**Tech Stack:** Next.js 15 App Router, Tailwind (CSS-var token vocabulary), incumbent
shared components (`DataTable`, `Modal`, `ConfirmDialog`, `MultiSelect`, `PageHeader`,
`SearchBar`, `StatCard`, `PaginationControls`, `PageSkeleton`), lucide-react.
**No new npm dependencies.**

**Companion plans:** Plan 2 `…work-order-ui-2-quotations.md`, Plan 3 `…work-order-ui-3-invoices.md`.
Parent plan: `.hermes/plans/2026-10-17_161133-work-order-flow.md` (phases 1–3 DONE).

---

## Design constraints (impeccable — Operate mode)

Mode is **Operate**: the visitor completes a task. Scanability, consistency with the
incumbent dashboard, and native expectations outrank expression. The incumbent
implementation is design authority; these pages must be indistinguishable in vocabulary
from `app/dashboard/admin/contractors/page.tsx` and the rest of the admin shell.

Hard rules for every screen in all three plans:

- Tokens only: `--color-navy-850`, `--color-slate-200/400/500`, `--color-accent`,
  `text-accent-ink`, danger/warning/success tints, `--color-canvas-subtle`. No raw hexes
  beyond the two already used in `lib/work-order-state.ts` (`#EEF2FA`).
- Same control vocabulary as the incumbents: `inputClass`/`inputStyle` patterns copied
  from `app/dashboard/admin/work-orders/page.tsx` (which is done and committed-style).
- No gradient cards, no emoji-as-icons, no decorative borders, no display fonts.
  Icons lucide only, sized `h-4 w-4` / `h-3.5 w-3.5` like the list page.
- Motion: none beyond `transition-colors` on buttons/hover (150–200 ms). No orchestrated
  reveals. Loading = skeleton rows (`PageSkeleton`), never a spinner in content.
- Empty states teach: e.g. quotes panel "No quotations have been requested yet — send an
  RFQ to invite contractors." rather than "nothing here."
- Modals are acceptable here because they match the incumbent (create/edit/delete all use
  `Modal`); do not introduce inline-edit grids or new overlay primitives.
- Every interactive control gets: default, hover, focus, disabled/loading state. Buttons
  show a spinner-text suffix ("Creating…", "Saving…") while awaiting, and the confirm
  action is disabled until the request settles.

---

## Context & verified ground truth

Branch `work-order-flow`. Phases 1–3 (data, services/API, email+scheduler) are committed
and green. Already on disk for the UI:

| Asset | State |
|---|---|
| `app/dashboard/admin/work-orders/page.tsx` (list) | DONE — stat tiles, search, state filter, create/edit/delete, overdue indicator. Do NOT modify this file in Plan 1 ( Plans 2/3 may not touch it either). |
| `lib/work-order-state.ts` | DONE — `WORK_ORDER_STATES`, `WORK_ORDER_TRANSITIONS`, terminal states, labels, badge tones. SERVER + client single source of truth. Import, never duplicate. |
| `components/dashboard/work-order-shared.ts` | DONE — `WorkOrderDetail`, `WorkOrderQuote`, `WorkOrderInvoice`, `ContractorBrief`, `workOrderDate`, `workOrderMoney`, `toLocalInputDate`, `localInputDateToIso`, `quoteStateMeta`. |
| `components/dashboard/WorkOrderStateBadge.tsx` | DONE. |
| Nav entries | DONE — admin layout line 25, tenant layout line 37 (both point at the pages this plan builds). |
| `app/dashboard/admin/work-orders/[id]/page.tsx` | Stub server wrapper importing the next task's client. |
| `app/dashboard/admin/work-orders/[id]/WorkOrderDetailClient.tsx` | **Stray, broken 106-line fragment — two `npm run type-check` errors trace to it (and the stub). Delete and rewrite.** |
| Tenant pages | Missing entirely. |

**Current baseline failure (fix in Task 1):**
```
app/dashboard/admin/work-orders/[id]/page.tsx(14,33): error TS2322
app/dashboard/admin/work-orders/[id]/WorkOrderDetailClient.tsx(45,35): error TS2741
```

### API surface (all verified against route files — do not re-derive)

Admin (super-admin gated; 401/403 handled by `requireSuperAdmin`):

| Call | Payload / params | Returns | Notes |
|---|---|---|---|
| `GET /api/admin/work-orders/[id]` | — | `{...workOrder, organizationName, notes[], quotes[] (incl. contractor, sorted price asc), invoice (incl. contractor) | null, assignedContractor \| null}` | Main detail fetch. |
| `PATCH /api/admin/work-orders/[id]` | `{description?, openedBy?}` | updated row | Used by list-page edit; not needed on detail page. |
| `DELETE /api/admin/work-orders/[id]` | — | result | List page only. |
| `POST /api/admin/work-orders/[id]/transition` | `{to, contractorIds?, quotesDue? (ISO), quoteId?, paid?}` | updated row | 409 = illegal transition; 422 = missing option. Side effects + emails run server-side. |
| `POST /api/admin/work-order-notes` | `{workOrderId, note}` | 201 note | Notes ≤ 2000 chars (service-enforced). |
| `PATCH /api/admin/work-order-notes/[id]` | `{note?}` | updated note | |
| `DELETE /api/admin/work-order-notes/[id]` | — | result | |
| `GET /api/dashboard/admin/contractors?page=1&search=` | — | `{items: [{contractorId, companyName, name, email, …}], pagination}` | Contractor picker source for Send-RFQ. Confirm exact field names against the route response in dev before finalizing the option label. |

Tenant (membership OR super-admin; foreign-org ids 404 via RLS):

| Call | Returns |
|---|---|
| `GET /api/organizations/[orgId]/work-orders?page&pageSize&search&state` | `{items[], pagination}` — same row shape as admin list minus joined org name. |
| `GET /api/organizations/[orgId]/work-orders/[id]` | `{...workOrder, notes, quotes (incl. contractor), invoice}` — **no `assignedContractor`**: resolve display from the ACCEPTED quote's contractor, else "Unassigned". |

Shared UI components to reuse (exact paths):
`@/components/dashboard/{DataTable,Modal,ConfirmDialog,MultiSelect,PageHeader,SearchBar,StatCard,PageSkeleton}`,
`@/components/admin/PaginationControls`, `@/lib/client-error-logger`.
`MultiSelect` props: `{options: {id,label}[], selected: string[], onChange: (string[]) => void, placeholder?, 'aria-label'?}`.

Tenant orgId resolution pattern (copy from `app/dashboard/tenant/calendar/page.tsx:28-46`):
`/api/auth/me` → `activeOrganizationId`, fallback `localStorage.getItem('nipp-active-org-id')`;
super admin (`useTenantScope().isReadOnly === false`) may append `?org=<id>` to view any
tenant org (`/api/admin/organizations/list` resolves the name).

---

## Files likely to change (Plan 1)

- Delete: `app/dashboard/admin/work-orders/[id]/WorkOrderDetailClient.tsx` (broken fragment)
- Create: `app/dashboard/admin/work-orders/[id]/WorkOrderDetailClient.tsx` (real, full)
- Create: `components/dashboard/WorkOrderNotesPanel.tsx` (shared read list + admin add/delete controls)
- Create: `app/dashboard/tenant/work-orders/page.tsx`
- Create: `app/dashboard/tenant/work-orders/[id]/page.tsx`
- Modify: none of the done list page, lib files, nav, or API routes.

Ground rules (all tasks): work on `work-order-flow`; commit after every task; a task is
done when `npm run type-check && npm run lint` pass and the manual check listed in the
task succeeds.

---

## Tasks

### Task 1: Remove the broken fragment, make the detail route render minimally (3 min)

**Objective:** Clear the baseline type errors and get a working stub for iteration.

**Files:**
- Delete: `app/dashboard/admin/work-orders/[id]/WorkOrderDetailClient.tsx`
- Create (replacement): same path — client component `WorkOrderDetailClient({ id }: { id: string })`
  that renders only: `<PageHeader title={id} />` + a "not implemented" placeholder.
  Keep `page.tsx` as-is (Next 15 async-params wrapper is already correct).

**Steps:**
1. Delete the stray file with `git rm` (it is untracked — plain delete is fine).
2. Write the minimal client (no fetch, no imports beyond PageHeader).
3. Run: `npm run type-check` → expected: clean (both baseline errors gone).
4. Commit: `git add … && git commit -m "chore: replace broken work order detail fragment with stub"`

### Task 2: Detail fetch + header/meta section (admin) (10 min)

**Objective:** Load the work order and render the top of the page like the incumbent
detail surfaces.

**Files:** Modify `app/dashboard/admin/work-orders/[id]/WorkOrderDetailClient.tsx`

1. Add detail fetch (`useEffect` + `AbortController`, pattern from list page `fetchData`):
   - state: `detail: WorkOrderDetail | null`, `loading`, `error`; refetch helper `load()`.
   - on non-OK: surface `data.error`, `logClientError(message, 'work-order-detail', 'fetch')`, show the error banner (same class as list page).
2. Render while loading: `<PageSkeleton rows={6} cols={4} />`.
3. Header block (after fetch):
   - Back link to `/dashboard/admin/work-orders` (`ArrowLeft` `h-4 w-4`).
   - `WorkOrderStateBadge state={detail.state}` + description as the page title (truncate, full text in a paragraph below).
   - Meta rows (label/value, slate-500 labels): Organization `{organizationName}`, Opened by `{openedBy}` ({workOrderDate(createdAt)}), Quotes due `{workOrderDate(quotesDue)}` with overdue tint when `state === 'OUT_FOR_QUOTES' && quotesDue < now` (copy `isQuoteOverdue` from the list page — extract to `components/dashboard/work-order-shared.ts` to keep DRY: move both helper and its use).
   - Assigned contractor line: `{assignedContractor ? `${companyName} — ${name}` : 'Unassigned'}`.
4. Reserve two labeled section placeholders below (plain `<section>` with heading + a single-line placeholder text): "Quotations" ("Quote entry lands in Plan 2") and "Invoice" ("Invoice recording lands in Plan 3"). These get replaced by the real panels without touching anything else — the placeholder markup is deliberately the whole content of that section.
5. Verification: `npm run type-check && npm run lint` pass; dev walk — open a seeded work order, header meta matches the API response (check DevTools).
6. Commit: `feat: work order detail header and meta (admin)`

### Task 3: Action bar — transitions derived from `WORK_ORDER_TRANSITIONS` (15 min)

**Objective:** The state action bar. Buttons come ONLY from the shared map; each
destination routes to the right dialog. No client-side duplicate of the transition table.

**Files:** Modify `…/WorkOrderDetailClient.tsx`

1. Build an action registry inside the component:
   ```ts
   const actions = WORK_ORDER_TRANSITIONS[detail.state].map((to) => ({
     to, label: ACTION_LABELS[to], // local copy of display labels only; map is shared
   }));
   ```
   `ACTION_LABELS` (UI copy for the destinations that exist in this plan's scope):
   `{ OUT_FOR_QUOTES:'Send RFQ', QUOTES_IN:'Mark Quotes In', CONTRACTOR_ASSIGNED:'Assign Contractor', STARTED:'Start Work', COMPLETE:'Mark Complete', INVOICED:'Mark Invoiced', FINISHED:'Finish (payment made)', CLOSED:'Close Work Order' }`.
   **Gate:** `to === 'INVOICED'` is only shown when `detail.invoice` exists (the service
   requires it; hiding the button avoids a guaranteed 409).
2. Click behavior per destination:
   - `OUT_FOR_QUOTES` → open Send-RFQ dialog (Task 4).
   - `CONTRACTOR_ASSIGNED` → open Assign dialog (Task 5).
   - `FINISHED` → payment ConfIRmation dialog, then POST `{to:'FINISHED', paid:true}`.
   - `CLOSED` → `ConfirmDialog` ("Close this work order early? Open quotations will be closed and no further state changes are possible.") → POST `{to:'CLOSED'}`.
   - Everything else (`QUOTES_IN`, `STARTED`, `COMPLETE`) → small `ConfirmDialog` with one line of context ("Start work on {description}?") → POST `{to}`.
3. Shared submit path:
   ```ts
   const runTransition = async (payload: Record<string, unknown>) => {
     setBusy(true);
     try {
       const res = await fetch(`/api/admin/work-orders/${detail.workOrderId}/transition`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
       if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Transition failed');
       setDialogOpen(false); await load(); // refetch whole detail — quotes/invoice/states may have changed
     } catch (err) { /* error banner + logClientError; for 409 mention the server message verbatim */ }
   ```
4. Button styling: primary (`--color-accent` / `text-accent-ink`) for the "forward" action of the current state, neutral-bordered for `CLOSED`, danger tint for… nothing gets a red primary — Close uses the neutral style with a warning-color confirm in its dialog (match incumbent delete semantics).
5. While any transition is in flight: every action button disabled + the active one shows `…`.
6. Verification: type-check + lint; dev walk through a CREATED work order — only "Send RFQ" and "Close Work Order" show; after closing, no action buttons at all (terminal). A stale page (work order advanced elsewhere → refetch) must not offer an illegal hop because the button set is computed from the fetched `state`.
7. Commit: `feat: work order detail action bar from shared state map`

### Task 4: Send-RFQ dialog (10 min)

**Objective:** Multi-select contractors + due date → transition to OUT_FOR_QUOTES.

**Files:** Modify `…/WorkOrderDetailClient.tsx`

1. Dialog state: `{contractorIds: string[], quotesDue: string}`; default
   `quotesDue = toLocalInputDate(new Date(Date.now() + 7 * 86400_000))` (design D8).
2. Contractors list fetched lazily on first dialog open:
   `GET /api/dashboard/admin/contractors?pageSize=100` → options
   `{id: contractorId, label: `${companyName} — ${name}`}`; loading = a single skeleton row inside the MultiSelect placeholder area; failure → error text in-dialog.
3. Body: `MultiSelect` (required ≥ 1), date input (min = today), helper line "RFQ emails are sent to the selected contractors without portal links — they reply by phone/email."
4. Submit disabled until selection non-empty; POST `{to:'OUT_FOR_QUOTES', contractorIds, quotesDue: localInputDateToIso(quotesDue).toISOString()}` via `runTransition`. On 422 (e.g., duplicate contractor already quoted), surface the message verbatim.
5. Verification: type-check + lint; dev walk — open RFQ dialog from a seeded work order, confirm selected count and due date land in the POST payload (DevTools), quotesDue column on list page updates after refetch.
6. Commit: `feat: send-RFQ dialog on work order detail`

### Task 5: Assign-contractor dialog with quote comparison table (10 min)

**Objective:** Pick a quotation → transition to CONTRACTOR_ASSIGNED (server accepts the
chosen quote, rejects/closes the rest).

**Files:** Modify `…/WorkOrderDetailClient.tsx`

1. Dialog body = comparison table from `detail.quotes` (already sorted price asc server-side — keep that order): columns Contractor (`contractor.companyName` / name), Price (`workOrderMoney`, "—" when null), State chip via `quoteStateMeta` (label + bg/text), Due date. Quote rows without a price render last visually if the API sort puts them so (null-safe: sort client-side `[...quotes].sort((a,b) => num(a.price)-num(b.price))` with nulls last — do this once here, it is display-only).
2. One radio per quote row that HAS a price (`price != null`) and state `OPENED`/`ACCEPTED`; selection state `quoteId`. If no quotes have prices: the body shows the empty state "Quotations are out at {workOrderDate(quotesDue)} — no priced quotation has been recorded yet. Record quotes below, or close this work order." (quotes panel comes in Plan 2). Then only Cancel is enabled.
3. Footer copy under confirm button: "The chosen contractor will be notified by email; other quotations are marked rejected." Submit → POST `{to:'CONTRACTOR_ASSIGNED', quoteId}` via `runTransition`.
4. Verification: type-check + lint; dev walk with an OUT_FOR_QUOTES work order (quotes exist from a prior RFQ, one priced): dialog lists rows price-asc, picking submits the right quoteId, header now shows the assigned contractor after refetch.
5. Commit: `feat: assign-contractor quote comparison dialog`

### Task 6: Notes panel (shared, admin interactive) (10 min)

**Objective:** One component used by admin (add + delete) and tenant (read-only), so Plan… no — the tenant detail page is built in this plan too, both consume it now.

**Files:** Create `components/dashboard/WorkOrderNotesPanel.tsx`

Props:
```ts
{ notes: WorkOrderNote[]; interactive: boolean; onAdded?: () => void; onDeleted?: (id: string) => void; onFailed?: (msg: string) => void; }
```
1. Read list (always): newest first, each note `note` text + timestamp `{workOrderDate(createdAt)} · {new Date(...).toLocaleTimeString()}` in slate-500, divider rows (`divide-y divide-slate-100`).
2. Empty state: interactive → "No notes yet — record progress below."; read-only → "No notes recorded."
3. `interactive === true` only: textarea (max 2000 chars, visible counter `<span className="text-xs">` "{n}/2000") + Add button (`Plus` icon); `POST /api/admin/work-order-notes {workOrderId…}` — pass `workOrderId` via an extra prop `workOrderId: string`. Per-note delete: `Trash2 h-3.5 w-3.5` slate-400 → danger on hover, confirm with a small inline ConfirmDialog, `DELETE /api/admin/work-order-notes/[id]`, then `onDeleted(id)` removes optimistically + parent refetch.
   Non-terminal guard is server-enforced; when the parent shows the panel on a terminal work order it passes `interactive={false}` (parent owns the rule via `WORK_ORDER_TERMINAL_STATES`).
4. Wire into admin detail: section "Notes", above the placeholders, passing callbacks that call `load()`; error path → parent error banner.
5. Verification: type-check + lint; dev walk — add a note on an active work order (appears immediately after refetch), delete it, and confirm nothing renders when empty.
6. Commit: `feat: work order notes panel (admin interactive + shared read-only)`

### Task 7: Tenant list page (read-only) (10 min)

**Objective:** Org-scoped work order list; zero mutation affordances.

**Files:** Create `app/dashboard/tenant/work-orders/page.tsx`

1. `'use client'`. orgId resolution exactly per the verified pattern (`/api/auth/me` →
   `activeOrganizationId`, localStorage fallback, super-admin `?org=` switcher using
   `useTenantScope()`). No create/edit/delete buttons anywhere; no action column at all —
   rows are Links.
2. Fetch `GET /api/organizations/${orgId}/work-orders?page&pageSize&search&state` → `{items, pagination}`. State filter chips (not a `<select>`): horizontal wrap of pill buttons "All" + one per state from `WORK_ORDER_STATES`/`WORK_ORDER_STATE_LABELS`, active chip uses `--color-navy-850` bg with white text — check one incumbent tenant page (calendar or units) first and match its filter affordance instead if it differs; consistency beats this spec.
3. Columns: Work Order (description link → `/dashboard/tenant/work-orders/[id]` + "Opened {date} · {openedBy}"), State badge, Contractor ("Unassigned" until state reaches CONTRACTOR_ASSIGNED — from row data there is no contractor name in the list; keep that column out of the list and show it on detail only), Quotes Due (overdue marker like the admin list).
4. Skeleton + empty state: "No work orders for this organization yet." Pagination via `PaginationControls`. Same PageHeader with NO primaryAction.
5. Verification: type-check + lint; dev walk as a tenant user — sees only own-org rows, no `/api/admin` string anywhere in the rendered client (grep the file), non-member org ids 404.
6. Commit: `feat: tenant work order list (read-only)`

### Task 8: Tenant detail page (read-only) (10 min)

**Objective:** Full read picture of a work order for org members.

**Files:** Create `app/dashboard/tenant/work-orders/[id]/page.tsx` (+ its client if you keep the server-wrapper pattern from admin — do, it's one line).

Layout mirrors the admin detail (same section order, minus every control):
1. Back link → `/dashboard/tenant/work-orders`; badge + description title; meta rows identical to admin (org name not shown — same org by construction); Assigned contractor: `assignedContractor` is absent from this API — resolve as "the contractor of the quote with state ACCEPTED" else `'Unassigned'`.
2. Notes: `<WorkOrderNotesPanel notes={detail.notes} interactive={false} />`.
3. Quotations section (read-only now, Plan 2 keeps it read-only here): table Contractor / Price / State chip / Due date from `detail.quotes` (same nulls-last display sort as Task 5). Empty state as in Task 5's empty copy.
4. Invoice section: if `detail.invoice` — card rows Total (`workOrderMoney`), Invoice date, Due date, Link (anchor target _blank rel noopener when present); else muted "No invoice recorded yet." (Plan 3 reuses this read-only rendering.)
5. NO buttons of any kind on the page (grep-verified: no `fetch(` with a method other than `'GET'`, no `/api/admin`).
6. Verification: type-check + lint; dev walk as tenant — detail matches admin view content minus actions; foreign-org id → 404 page path handled by Next's notFound() from the route's 404 (show the standard not-found block if the fetch returns 404).
7. Commit: `feat: tenant work order detail (read-only)`

### Task 9: Plan 1 acceptance pass (15 min)

**Objective:** Prove the core loop works and close the loop on the parent plan.

1. Full checks at repo root: `npm run type-check && npm run lint && npm run build` — all green.
2. Manual walk (dev, seeded contractors; use 3 work orders in CREATED / OUT_FOR_QUOTES-with-priced-quote / STARTED): full admin happy path CREATED → Send RFQ (verify quote rows appear) → Assign (pick priced quote; verify others REJECTED) → Start → Complete; close a second one from OUT_FOR_QUOTES; add + delete notes; tenant views show the same data with zero controls.
3. Run the impeccable detector once over the changed web UI:
   `node /Users/johnlynas/.hermes/skills/impeccable/scripts/detect.mjs --json app/dashboard/admin/work-orders app/dashboard/tenant/work-orders components/dashboard/WorkOrderNotesPanel.tsx` — fix findings in one batched pass.
4. Update the parent plan's progress table (`.hermes/plans/2026-10-17_161133-work-order-flow.md`, Phase 4 row → "UI 1/3 DONE (work orders + notes); quotations & invoices remain") and commit: `chore: mark work order UI plan 1 complete`.

---

## Tests / validation summary

| Level | Command / check | Pass bar |
|---|---|---|
| Types | `npm run type-check` | clean (baseline had 2 errors; Task 1 removes them, must stay clean) |
| Lint | `npm run lint` | clean |
| Build | `npm run build` | clean |
| No admin leakage (tenant) | `grep -c "api/admin" app/dashboard/tenant/work-orders/page.tsx app/dashboard/tenant/work-orders/[id]/page.tsx` | both 0 |
| State truth single-source | grep client for `WORK_ORDER_TRANSITIONS` imports only; no inline transition arrays in the detail client besides ACTION_LABELS display map | manual |
| Detector | impeccable detect.mjs (Task 9) | zero unfixed findings |

## Risks / open questions

- **Contractor list field names** — verify the `/api/dashboard/admin/contractors` item shape in DevTools before hardcoding labels (Task 4 notes it).
- **Quotes panel absent until Plan 2:** a work order stuck in OUT_FOR_QUOTES without any priced quote cannot be assigned via UI; the dialog's empty state tells admins quotes are pending. That is acceptable per design (advisory deadlines) — do not add manual quote entry here (Plan 2 owns it).
- Tenant detail "assigned contractor" resolution depends on server marking exactly one ACCEPTED quote — the service guarantees this at assignment time; if `contractorId` is set but no ACCEPTED quote row exists, show the raw fallback name from any quote matching `workOrder.contractorId`.
- Plan 2/3 will edit the same detail client file as this plan — each task's commit keeps type-check green so incremental diffs stay reviewable.
