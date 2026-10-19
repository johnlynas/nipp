# Work Order UI — Plan 2 of 3: Quotations

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Give super admins full quotation management on the work order detail page:
record/update prices, descriptions and links as quotes arrive, add a manual quote for a
contractor who wasn't in the RFQ, delete an erroneous quote row — with the incumbent
design vocabulary and zero new backend surface (all routes exist and are verified).

**Architecture:** One interactive Quotations section component
(`components/dashboard/WorkOrderQuotationsPanel.tsx`) added to the admin detail client in
place of Plan 1's placeholder; a small per-row edit mode inside the existing table
(inline row expansion, NOT a second modal stack — the table already carries all quote
fields). The tenant detail page's quotations section stays read-only (Plan 1 ships its
rendering; this plan only touches it if a shared read-only sub-component is extracted and
reused — prefer NOT re-shipping tenant code from this plan).

**Tech Stack:** Next.js 15, incumbent `Modal`/`ConfirmDialog`, lucide-react, CSS-var
tokens. No new npm dependencies. No react-query (fetch + refetch, incumbent pattern).

**Prerequisite:** Plan 1 (`…work-order-ui-1-work-orders-and-notes.md`) fully implemented —
the detail client exists with `load()`, the action bar, and the placeholder sections.

---

## Design constraints (impeccable — Operate mode)

Same hard rules as Plan 1: tokens only (`--color-navy-850`, slate scale, tints), same
control vocabulary, no gradients/emoji/display-fonts/decorative borders, motion limited
to `transition-colors`, skeletons not spinners, empty states that teach. The quotations
table is the highest-information-density element on the page — density is a virtue here;
keep row height compact (single-line cells) and let price be visually dominant (font-medium,
`var(--color-navy-850)`), state chips from `quoteStateMeta`.

Quote-row edit UX decision (do not re-litigate in implementation): **row expansion** —
clicking the `Pencil` affordance on a quote row replaces that one <tr>'s content with an
editing block (three labeled fields + Save/Cancel) inside the same table, no modal. This
matches the "operate in place" expectation for data tables and keeps the comparison
ordering stable while saving. If the existing `DataTable` component cannot render a custom
expanded row, render the quotes table as a plain `<table>` (same classes as DataTable's
internals — inspect `components/dashboard/DataTable.tsx` first and copy its header/cell
classes exactly) inside the panel.

---

## Verified API surface (read from route files — do not re-derive)

All super-admin gated; CSRF on non-GET; 401/403 via `requireSuperAdmin`.

| Call | Payload | Returns / errors |
|---|---|---|
| `POST /api/admin/quotes` | `{ workOrderId, contractorId, dueDate: ISO }` | 201 quote. Duplicate (workOrder+contractor) → 422 ValidationError: "A quotation already exists for this contractor on this work order". |
| `PATCH /api/admin/quotes/[id]` | subset of `{ price?: number\|string, description?: string, quoteLink?: string }` | updated quote incl. contractor join? **verify**: the route returns `QuotationService.update(...)` result — check whether it includes `contractor`; if not, merge `{...updated, contractor: existingRow.contractor}` client-side before refetch-less patch. Refetch is simpler and DRY: just call `load()` after any mutation. |
| `DELETE /api/admin/quotes/[id]` | — | 409 (server message) when work order INVOICED/FINISHED/CLOSED; else result. |

Service-verified rules the UI must not fight:
- `price > 0` required to set; **price cannot be cleared once set** ("price cannot be cleared
  once a quotation has been received") — so the edit form has no "clear price" affordance;
  description/quoteLink CAN be set to null (empty string is normalized to null server-side).
- Filling the first price on an `OUT_FOR_QUOTES` work order auto-hops it to `QUOTES_IN`
  (may fail with a logged server warning if state already changed — surface the API's own
  error message, don't special-case).
- Quote detail rows arrive pre-sorted price asc from `GET /api/admin/work-orders/[id]`;
  display-side nulls-last sort as in Plan 1 Task 5.

Contractor source for "add quote to contractor": same as Plan 1 Task 4 —
`GET /api/dashboard/admin/contractors?pageSize=100` → `{items: [{contractorId, companyName, name}]}`
(reuse the exact fetch + option-label code from the Send-RFQ dialog; if both dialogs are in
the same component file, lift it to one helper — DRY).

---

## Files likely to change (Plan 2)

- Create: `components/dashboard/WorkOrderQuotationsPanel.tsx`
- Modify: `app/dashboard/admin/work-orders/[id]/WorkOrderDetailClient.tsx` (replace the Plan 1 quotations placeholder with the panel; pass callbacks)
- Do not touch: tenant pages, list page, API routes, lib files.

Ground rules: branch `work-order-flow`, commit per task, `type-check && lint` green before next task.

---

## Tasks

### Task 1: Panel shell — render quotes read-only in the correct table (8 min)

**Objective:** The section component exists and renders the same comparison the admin
detail already shows, as its own component with a props contract ready for controls.

**Files:** Create `components/dashboard/WorkOrderQuotationsPanel.tsx`

```ts
interface WorkOrderQuotationsPanelProps {
  workOrderId: string;
  quotes: WorkOrderQuote[];           // from detail fetch (incl. contractor)
  workOrderState: WorkOrderStateValue;
  disabled?: boolean;                  // terminal states → no controls
  refetch: () => Promise<void>;        // parent's load()
  onFailed: (message: string) => void; // parent error banner
}
```

1. Render (always, read-only base): heading row "Quotations" + right-aligned count
   "{received}/{total}" (`price != null` vs array length — the operational question admins ask).
2. Table columns: Contractor (`companyName` sub `name`, slate-500), Price (medium weight,
   `workOrderMoney`), State chip (`quoteStateMeta`: label + its bg/text; round-full px-2 py-0.5 text-xs), Due (`workOrderDate(dueDate)`), Actions column only when `!disabled`.
3. Empty state row: "No quotations have been requested — send an RFQ from the actions above."
4. Wire into admin detail replacing the placeholder: `<WorkOrderQuotationsPanel workOrderId={detail.workOrderId} quotes={detail.quotes} workOrderState={detail.state} disabled={WORK_ORDER_TERMINAL_STATES.includes(detail.state)} refetch={load} onFailed={setError} />`.
5. Verification: type-check + lint; dev — admin detail shows identical information to Plan 1's placeholder state (table now visible), count reads "0/3" etc.
6. Commit: `feat: quotations panel shell (admin detail)`

### Task 2: Record/update quote — expanded-row edit (15 min)

**Objective:** Enter price/description/link on any OPEN quote row; save → refetch.

**Files:** Modify `components/dashboard/WorkOrderQuotationsPanel.tsx`

1. Editing state: `editingId: string | null`; form `{price: string, description: string, quoteLink: string}` initialized from the row (`price = row.price ?? ''`, others `?? ''`). Expanded row replaces the <tr> content with three labeled inputs (use the incumbent `inputClass`/`labelClass` pattern) + footer "Save" / "Cancel".
   - Price input: `type="number" step="0.01" min="0.01"`; show a hint when the field is being filled on an OUT_FOR_QUOTES work order: "Recording the first price moves this work order to Quotes In." (derive from `workOrderState` + row currently null-price — informational only).
2. Save handler:
   ```ts
   const payload: Record<string, unknown> = { description: form.description.trim(), quoteLink: form.quoteLink.trim() };
   if (form.price.trim() !== '' || row.price !== null) payload.price = form.price === '' ? row.price : Number(form.price); // never send clear-once-set
   const res = await fetch(`/api/admin/quotes/${row.quoteId}`, { method: 'PATCH', headers, body: JSON.stringify(payload) });
   if (!res.ok) throw new Error(data.error /* verbatim — covers 422 "price cannot be cleared…" */);
   ```
   On success: `refetch()`, clear editing state. While saving: Save disabled + "Saving…".
3. Affordance gating: pencil icon visible when `!disabled && (row.state === 'OPENED' || (workOrderState === 'QUOTES_IN'))` — the service allows updating OPEN quotations; keep it simple: allow when row `state === 'OPENED'`. Hidden on ACCEPTED/REJECTED/CLOSED rows (immutable after decision).
4. Focus + a11y: expand on button with `aria-label={Edit quotation from ${companyName}}`; Escape closes editing (cancel, no data loss warning — confirm if any field changed vs initial values via a lightweight diff; standard ConfirmDialog "Discard changes?" when dirty).
5. Verification: type-check + lint; dev walk — OUT_FOR_QUOTES work order with 3 OPENED quotes: record price £1,200 on one → row updates, count flips, work order badge auto-hops to QUOTES_IN (server side; visible after refetch), Save shows the hint line before first save.
6. Commit: `feat: quote record/update expanded-row edit`

### Task 3: Quote link + description display in the collapsed row (5 min)

**Objective:** Existing data must be visible, not only editable.

1. Collapsed row: under the contractor cell add one line (truncate, slate-500, `max-w-xs`)
   showing `description` when present; a small `ExternalLink h-3 w-3` anchor "View quote"
   (`target="_blank" rel="noopener noreferrer"`) when `quoteLink` present — anchor wraps the label text, not the icon-only.
2. If both description and link are null: muted "Not received yet" in that subline.
3. Verification: type-check + lint; dev — pre-fill a quote via API (or Task 2), collapsed row shows breakdown + link; verify external navigation.
4. Commit: `feat: quote breakdown and link display`

### Task 4: Add quotation for a missed contractor (10 min)

**Objective:** RFQ went out to 3 contractors but a 4th calls in — record without re-running the transition.

1. "Add quotation" button right-aligned on the section heading (plus icon, neutral style), visible when `!disabled && workOrderState === 'OUT_FOR_QUOTES'`.
2. `Modal size="sm"`: `MultiSelect` of contractors NOT already quoted (options computed from `/api/dashboard/admin/contractors` minus `quotes.map(q => q.contractorId)` — refetch the contractor list lazily like Plan 1 Task 4, cache in state at panel level), due date (`toLocalInputDate()` default today) with helper "The RFQ emails go only to contractors selected at send time — this just records their quotation."
3. Submit: `POST /api/admin/quotes { workOrderId, contractorId, dueDate: localInputDateToIso(dueDate).toISOString() }` → 201 → refetch + close; duplicate error (422) surfaced verbatim in modal footer (race where a quote appeared since opening — refreshes option list too).
4. Verification: type-check + lint; dev — add the 4th contractor, row appears OPENED, editable immediately (Task 2 path), duplicate attempt surfaces server message.
5. Commit: `feat: add manual quotation for missed contractors`

### Task 5: Delete a quote row (8 min)

**Objective:** Remove an erroneous row (e.g., contractor entered twice via RFQ + manual).

1. Actions cell: pencil + trash (`Trash2 h-3.5 w-3.5`, same hover pattern as the list page's delete: `hover:bg-danger-tint hover:text-danger-ink`), both gated by Task 2's visibility rule (OPENED only).
2. ConfirmDialog (danger variant) message: `Delete {companyName}'s quotation? This removes the record only — it does not email the contractor.` → `DELETE /api/admin/quotes/[id]`.
3. 409 response (work order moved past the block, e.g., concurrent assign): show server message in parent banner via `onFailed`, refetch to resync row states.
4. Verification: type-check + lint; dev — delete an OPENED row, table re-renders, count updates; attempt delete after assigning a contractor → affordance gone (row no longer OPENED), and direct API 409 text appears if forced.
5. Commit: `feat: delete quotation with confirmation`

### Task 6: Plan 2 acceptance pass (10 min)

1. `npm run type-check && npm run lint && npm run build` — green.
2. Dev walk, full quote lifecycle on one work order: RFQ → 3 OPENED rows → record price on 2 (badge hops) → add manual quote → update its link/description → delete a duplicate → assign the cheapest via Plan 1's Assign dialog (all prices visible and sorted). Confirm ACCEPTED/REJECTED chips render correctly with their tones.
3. Terminal-state check: on a FINISHED work order no pencil/trash/add affordances anywhere in the quotes section (`disabled` prop path); tenant detail still read-only, untouched by this plan.
4. Detector (once): `node /Users/johnlynas/.hermes/skills/impeccable/scripts/detect.mjs --json components/dashboard/WorkOrderQuotationsPanel.tsx app/dashboard/admin/work-orders/[id]` — batch-fix findings.
5. Update parent plan progress line (Phase 4 → "UI 1/3 + 2/3 DONE; invoices remain") and commit: `chore: mark work order UI plan 2 complete`.

---

## Tests / validation summary

| Level | Check | Pass bar |
|---|---|---|
| Types / lint / build | the three npm scripts at repo root | all green (run after EVERY task, not only Task 6) |
| Auto-hop visible | first price fill on OUT_FOR_QUOTES → badge QUOTES_IN after refetch | manual dev walk (Task 2) |
| Immutability after decision | no edit affordance on ACCEPTED/REJECTED/CLOSED rows | manual + code inspection (gating in one function, not per-icon checks — keep the predicate `canEditQuote(row)` single-sourced) |
| Tenant untouched | `git diff --name-only` shows no tenant file changes this plan | shell check before final commit |

## Risks / open questions

- **PATCH response shape** (does it include the contractor join?): resolved in Task 2 by always calling parent `refetch()` after mutation — the shape question becomes moot; do not patch row state client-side.
- **Expanded-row rendering inside `DataTable`:** if the component's `render: (row) => JSX` signature cannot host a multi-block cell that breaks table layout, use a plain `<table>` styled from DataTable internals (Task 1 step 2 already anticipates this). Decide at Task 1 by reading `DataTable.tsx`; both paths are budgeted.
- The auto-hop failure case ("work order may have moved already") is a server-logged warning; the price save itself SUCCEEDS and returns the quote — so no user-facing error expected; if the API does surface it, show verbatim and refetch.
