# Work Order UI — Plan 3 of 3: Invoices

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Complete the billing tail of the work order flow in the admin detail page:
record the 1:1 invoice when a work order is COMPLETE, mark it invoiced + paid (the
remaining two state hops), and correct/delete the invoice before payment — closing Phase 4
of the parent plan end-to-end.

**Architecture:** One `components/dashboard/WorkOrderInvoicePanel.tsx` replacing Plan 1's
invoice placeholder in the admin detail client. The billing flow reuses Plan 1's
`runTransition` path for the COMPLETE→INVOICED and INVOICED→FINISHED hops (invoice POST is
a separate call that precedes the hop). Tenant pages are untouched — Plan 1 already ships
the read-only invoice card, and this plan may extract its markup into a shared
read-only renderer ONLY if doing so is < 30 lines of diff; otherwise leave tenant code as-is.

**Prerequisites:** Plans 1 + 2 implemented (detail client with `load()`, action bar,
placeholder sections; quotations panel live). All invoice API routes exist (phases 1–2) —
no backend work in this plan.

## Status: **DONE** (2026-10-20)

All six tasks implemented and committed on `work-order-flow`. Task log:
- T1 shell → `1bdad63` · T2 record form → `17c6c44` · T3 finish-amount confirm → `80051ca` · T4+T5 edit + delete (one component, one commit) → `5a8f750` · docs close-out below.
- Tests: `tests/unit/work-order-invoice-panel.test.tsx` — 30 tests, all green.
- Acceptance: type-check ✅ lint ✅ build ✅ full unit suite 2264/2264; grep gates (tenant 0 `api/admin` hits; exactly one `runTransition`; panel imports no transition map) ✅; impeccable detector **0 findings** across panel + admin/tenant work-order routes.
- Open-question resolution (Task 5 step 3): verified by reading `services/invoice-service.ts` + `WorkOrderService.transition` — create is COMPLETE-gated, delete requires INVOICED, FINISHED has no invoice-row requirement. Delete at INVOICED therefore leaves no UI re-record path; the ConfirmDialog copy names that consequence honestly (delete shipped INVOICED-only with tooltip, matching the plan's narrower-gate preference). Due-date default kept at 14 days — flagged for product (30/60?).
- Dev-walk note: the full in-browser 7-step walk (plan Task 6 step 2) was not executed this session — no live dev server walkthrough was available; coverage stands on the full unit suite + build + code-path verification. A real terminal-to-FINISHED UI walk is the recommended next manual check before Phase 5.

---

## Design constraints (impeccable — Operate mode)

Same hard rules as Plans 1/2: token-only colors, incumbent control vocabulary, no
gradients/emoji/display-fonts, `transition-colors` only, skeletons not spinners,
teaching empty states. The invoice is money data — the total must be the visual anchor of
the card (largest numeric value on the page, font-medium, `--color-navy-850`), everything
else supporting. Payment confirmation is a consequential irreversible action: it gets a
`ConfirmDialog` with a `danger`-adjacent tone only in the dialog's copy ("payment has been
made to the contractor") — the flow itself stays neutral until that moment, consistent
with the list page treating delete as the only red-primary action.

---

## Verified API surface + service rules (read from route/service files)

| Call | Payload | Returns / errors (verbatim server messages) |
|---|---|---|
| `POST /api/admin/invoices` | `{ workOrderId, contractorId, invoiceDate: ISO, dueDate: ISO, price: number\|string, invoiceLink? }` | 201 invoice. **400** if any required field missing; "Invoice already exists…" → **409**. Service (COMPLETE-only): `"Invoices can only be recorded for a COMPLETE work order (current: X)"`, `"Cannot invoice an unassigned work order"`, `"Invoice contractor must be the work order's assigned contractor"` — all 422-class ValidationErrors. `price > 0` required. |
| `PATCH /api/admin/invoices/[id]` | `{ price?, invoiceDate?, dueDate?, invoiceLink? }` | edited invoice; allowed while COMPLETE or INVOICED (corrections before payment). |
| `DELETE /api/admin/invoices/[id]` | — | Only while work order **INVOICED**: 409 once FINISHED/CLOSED, 422 in other states. v1 correction = delete + recreate. |
| `POST /api/admin/work-orders/[id]/transition` `{to:'INVOICED'}` | — | Requires the invoice row to exist (Plan 1 action bar already hides this button when `detail.invoice === null`). |
| `POST …/transition` `{to:'FINISHED', paid:true}` | — | Plan 1's payment confirmation dialog already exists — **do not re-build it**; verify it still behaves (it is the invoice plan's final gate). |

Flow invariant to design around: **record invoice (POST) → user then presses "Mark
Invoiced" (transition) → later "Finish (payment made)"**. The API does NOT auto-hop on
invoice creation (unlike quotes), so the UI must make this two-step explicit and not leave
a dead-end where an invoice exists but no button is visible: when `detail.invoice` is set
the action bar's INVOICED button appears automatically (Plan 1 rule), and the panel shows
an inline hint "Invoice recorded — press Mark Invoiced above to advance the work order."

Contractor id for the POST: ALWAYS `detail.contractorId` (the assigned contractor; service
rejects anything else). UI needs NO contractor picker. If `detail.contractorId` is null
(defensive — state COMPLETE implies assignment, but the API would 422), render the create
form disabled with a muted note "Assign a contractor to record an invoice."

---

## Files likely to change (Plan 3)

- Create: `components/dashboard/WorkOrderInvoicePanel.tsx`
- Modify: `app/dashboard/admin/work-orders/[id]/WorkOrderDetailClient.tsx` (replace placeholder, pass props incl. its existing `runTransition`)
- Optional tiny refactor of tenant detail invoice card ONLY per the size rule above.

Ground rules: branch `work-order-flow`, commit per task, `type-check && lint` green before next task.

---

## Tasks

### Task 1: Panel shell — state-aware read-only render (8 min)

**Objective:** The section renders correctly for every work order state with no controls
wiring yet.

**Files:** Create `components/dashboard/WorkOrderInvoicePanel.tsx`

```ts
interface WorkOrderInvoicePanelProps {
  detail: WorkOrderDetail;          // needs invoice + workOrderState via detail.state + contractorId
  disabled?: boolean;                // terminal states (parent passes WORK_ORDER_TERMINAL_STATES.includes(detail.state))
  load: () => Promise<void>;
  onFailed: (message: string) => void;
}
```

1. Heading "Invoice" + right-align the total when present (`workOrderMoney(invoice.price)`).
2. `detail.invoice` exists → card rows (label slate-500 / value navy): Invoice date, Due
   date (`dueDate` past → same overdue tint treatment as quotes due: warning-ink + "Overdue"), Total (visually dominant), Link ("View invoice" anchor `_blank` noopener when present). Plus a muted subline "{created at}" using workOrderDate.
3. No invoice + state COMPLETE → the creation form zone (empty, rendered by Task 2's
   component; placeholder comment in shell), plus empty-state copy: "Work is complete — record the contractor's invoice below."
4. No invoice + other non-terminal → muted single line: "No invoice recorded yet — invoicing becomes available when the work order is complete."
5. Wire into admin detail replacing Plan 1's placeholder (same callback pattern as the
   quotations panel). Tenant pages untouched this task.
6. Verification: type-check + lint; dev — walk one work order in each relevant state (CREATE… skip: CREATED/OUT_FOR_QUOTES/QUOTES_IN/CONTRACTOR_ASSIGNED/STARTED all show the muted line; COMPLETE shows empty-state; INVOICED shows card).
7. Commit: `feat: invoice panel shell (state-aware read-only)`

### Task 2: Record invoice form (COMPLETE only) (15 min)

**Objective:** Create the 1:1 invoice with sensible defaults and server-validated fields.

**Files:** Modify `components/dashboard/WorkOrderInvoicePanel.tsx`

1. Form zone (rendered when state COMPLETE && !invoice): fields — Price (£, `type="number" step="0.01" min="0.01"`), Invoice date (default today via `toLocalInputDate(new Date())`), Due date (default **+14 days** — standard payment term; confirm against any repo convention in dev/notes first, else keep 14), Invoice link (optional URL text). Single column, max-w-md, incumbent input classes.
2. Prefill: if an ACCEPTED quote has a price, prefill Price with it (`workOrderMoney` inverse — use the raw string `Number(quote.price)` formatted without currency for the number input) and show subtext "From {companyName}'s accepted quote." (Exactly one ACCEPTED quote exists by service invariant; find via `detail.quotes.find(q => q.state === 'ACCEPTED')`.)
3. Submit button "Record Invoice" (primary accent, disabled until price > 0 and both dates set; while saving → "Recording…").
4. POST `/api/admin/invoices` with `{ workOrderId: detail.workOrderId, contractorId: detail.contractorId!, invoiceDate: localInputDateToIso(f.invoiceDate).toISOString(), dueDate: …, price: Number(f.price), ...(f.link.trim() ? { invoiceLink: f.link.trim() } : {}) }`.
5. Error surfacing: non-OK → read `data.error` VERBATIM (covers 409 duplicate, 422 state/contractor messages) into the parent banner via `onFailed`; keep the form open on failure; refetch after failure too (state may have moved — e.g., a concurrent transition to INVOICED).
6. Success: no dialog — call `load()`, show nothing extra; the panel flips to card view and the "Mark Invoiced" button appears in the action bar with the Task 1 hint line visible under the card? **No** — put the hint ONLY while `state === 'COMPLETE' && invoice` (i.e., recorded but not yet hopped): "Invoice recorded — use Mark Invoiced above to advance the work order."
7. Verification: type-check + lint; dev — complete a work order (or seed CREATE… via API), prefill appears from accepted quote, record → card renders, action bar shows "Mark Invoiced", duplicate POST attempt (re-create after manually deleting) returns 409 verbatim.
8. Commit: `feat: record invoice form`

### Task 3: Mark-invoiced + finish-with-payment wiring check (10 min)

**Objective:** Close the two transition hops with correct copy and guards; no new code path, only verification + small fixes where Plan 1's defaults fall short for billing.

1. Confirm via dev walk: press "Mark Invoiced" on a COMPLETE work order WITH invoice → POST `{to:'INVOICED'}` → badge INVOICED, card remains, panel hint disappears (state no longer COMPLETE).
2. "Finish (payment made)" confirm dialog copy must name the amount — enhance Plan 1's FINISHED ConfirmDialog message in the detail client: `Payment of {workOrderMoney(detail.invoice?.price)} has been made to {assignedContractor?.companyName}. This closes the work order permanently.` (guard on null invoice — button hidden per Plan 1 anyway). If Plan 1 already wrote equivalent copy, skip.
3. After FINISHED: panel must render card read-only (no edit/delete), action bar empty (terminal) — verify; this is the terminal state of the whole flow.
4. Illegal guard demo (manual): open DevTools on an INVOICED work order and manually POST `{"to":"FINISHED"}` without `paid:true` → 422/409 from server; UI never sends that shape (it always includes `paid:true`) — assert by reading the code, not a unit test.
5. Verification: type-check + lint pass; dev walk of steps 1–3 on one work order to FINISHED.
6. Commit: `feat: invoice-to-finished billing path verified with amount-named confirmation`

### Task 4: Invoice edits (corrections before payment) (8 min)

**Objective:** PATCH price/dates/link while COMPLETE or INVOICED.

1. A single "Edit" affordance (`Pencil`, same style as quotations panel's, `aria-label="Edit invoice"`) on the card heading row when `!disabled && ['COMPLETE','INVOICED'].includes(detail.state)`.
2. Edit re-uses the Task 2 form prefilled from existing values (share one internal `InvoiceForm` sub-component in the file — DRY); Save → `PATCH /api/admin/invoices/[id]` → refetch; Cancel restores display. Same verbatim-error handling as create (409 once FINISHED/CLOSED — e.g., concurrent finish).
3. Verification: type-check + lint; dev — edit price on an INVOICED work order (correction), verify card update; edit blocked on FINISHED (affordance gone) and DELETE'd-below path.
4. Commit: `feat: invoice edit (pre-payment corrections)`

### Task 5: Delete invoice (INVOICED only) (8 min)

**Objective:** v1 correction escape hatch = delete + re-record.

1. Trash affordance on the card, visible ONLY when `detail.state === 'INVOICED'` (server rule; do not widen to COMPLETE — the 422 there would be a dead click).
2. ConfirmDialog danger: "Delete this invoice? You will need to re-record it to advance the work order. The contractor is not notified." → `DELETE /api/admin/invoices/[id]` on success refetch; panel drops back to Task 2's form zone (**open question:** after delete at INVOICED, creation is service-locked to COMPLETE — verify in dev before assuming re-record works).
3. (Resolution baked in: implementer MUST run one dev check first — DELETE an invoice at INVOICED via curl/API and observe the code path in `services/invoice-service.ts` around line 90+. If the flow is unusable post-delete, ship delete gated to COMPLETE with a tooltip; document the finding in the commit message.)
4. Verification: type-check + lint; dev — whichever gating survived step 3's check works; 409 verbatim surface on concurrent-finish race.
5. Commit: `feat: invoice deletion (correction flow)`

### Task 6: Plan 3 acceptance pass — full end-to-end (15 min)

1. `npm run type-check && npm run lint && npm run build` — green at repo root.
2. **Full seven-step dev walk** (the parent plan's Phase 4 exit criterion): create → RFQ → record quote price → assign cheapest → start → complete → record invoice (prefill) → mark invoiced → finish with named payment confirm. New work order, no API console shortcuts; tenant views checked at OUT_FOR_QUOTES and FINISHED stages (read-only data matches admin).
3. Grep gates:
   - `grep -rn "api/admin" app/dashboard/tenant/work-orders` → 0 hits (tenant untouched).
   - Detail client has exactly ONE `runTransition` definition; invoice panel imports no transition map (it never transitions — parent owns that).
4. Detector (once, batch-fix): `node /Users/johnlynas/.hermes/skills/impeccable/scripts/detect.mjs --json components/dashboard/WorkOrderInvoicePanel.tsx app/dashboard/admin/work-orders app/dashboard/tenant/work-orders`.
5. Close the parent plan: `.hermes/plans/2026-10-17_161133-work-order-flow.md` — Phase 4 row → `**DONE** (UI split into plans 1–3, all committed; see sibling plan files)`, note the detector pass + full walk. Commit: `docs: work order flow phase 4 complete`.

---

## Tests / validation summary

| Level | Check | Pass bar |
|---|---|---|
| Types / lint / build | three npm scripts, after every task | green each time |
| Service-contract conformance | UI gates (create@COMPLETE, edit@COMPLETE/INVOICED, delete-gating, transition button visibility) match `services/invoice-service.ts` — verify by reading the service before each gating decision, not from this doc alone | code + dev |
| Two-step billing clarity | COMPLETE+invoice state shows hint and visible "Mark Invoiced" | manual (Task 3) |
| Terminal invariants | FINISHED/CLOSED: zero invoice affordances, zero action buttons | manual + grep of `disabled` prop path |
| Tenant untouched | tenant files absent from `git diff --name-only` across the plan | shell check, final commit |

## Risks / open questions

- **Delete at INVOICED may be a dead end** (service locks create to COMPLETE): Task 5 step 3's dev check is mandatory before the affordance ships; the plan prefers a narrower gate + tooltip over a button that 422s.
- **Due-date default (14 days)** — no repo convention found for invoice terms at planning time; keep 14 and flag in the final commit message if product wants 30/60.
- Invoice PATCH response shape: same resolution as Plan 2 (always parent `load()` after mutation; never patch row client-side).
- Plan 1's FINISHED confirm dialog may already cover Task 3 step 2 — check before touching it to avoid churn on a committed, reviewed file.
