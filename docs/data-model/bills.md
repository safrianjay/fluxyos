---
status: current
owns: [bills]
updated: 2026-08-07
source: docs/PROJECT_BACKGROUND.md §4 (sharded 2026-08-07)
---

# Bills

> Workspace-scoping rules for these collections live in
> [`PROJECT_BACKGROUND.md` §4](../PROJECT_BACKGROUND.md#4-firestore-database-schema).
> Read that first — it is always loaded; this shard is not.

### 4b. Bills — `users/{userId}/bills`

Same fields as transactions plus:

| Field | Type | Notes |
|-------|------|-------|
| `due_date` | Firestore Timestamp | Optional. Displayed via `.toDate().toLocaleDateString()`. Falls back to `"Next week"` if missing |
| `category` | string | Defaults to `"Operations"` when created via modal |
| `budget_id` | string \| null | Optional. Phase 1.5. Set by Add Bill drawer when an active budget exists. References `budgets/{id}`. |
| `budget_allocation_id` | string \| null | Optional. Phase 1.5. Set when the bill auto-matches a `budget_allocations/{id}` doc by category. Null when no allocation matched. |
| `budget_match_method` | string \| null | Optional. `"auto"`, `"manual"`, or `"none"`. |
| `budget_match_status` | string \| null | Optional. `"matched"`, `"needs_review"`, or `"unmatched"`. |
| `budget_impact_status` | string \| null | Optional. `"committed"`, `"released"`, or `"converted_to_actual"`. Drives the Budget page's committed-amount calculation; bills with `converted_to_actual` are excluded from committed totals. Exclusion flips this to `"released"`. |
| `budget_assignment_reason` | string \| null | Optional. Phase 2. ≤500 chars. Required for manual reassignment / restore writes. |
| `budget_assignment_updated_at` | Timestamp \| null | Optional. Phase 2. Server-set on each assignment write. |
| `budget_assignment_updated_by` | string \| null | Optional. Phase 2. Pinned by Firestore rule to `request.auth.uid`. |
| `budget_exclusion_reason` | string \| null | Optional. Phase 2. ≤500 chars. |

Enum extension (Phase 2): `budget_match_method` also accepts `"rule"` and
`"excluded"`; `budget_match_status` also accepts `"excluded"`.

All bill budget fields are optional and absent on legacy bills. The Add Bill
drawer omits the fields entirely when no active budget exists for the period,
preserving the legacy bill schema.

**Phase 2 budget assignment priority** (used by `DataService.resolveRecordAssignment`
for both transactions and bills, applied in `getBudgetUsage`):

1. `record.budget_match_status === 'excluded'` → record drops out of totals entirely.
2. `record.budget_allocation_id` set and the allocation is still active → counts against that allocation (source `'manual'` or `'explicit'`).
3. Category match — first active allocation whose `scope_values` contains `record.category` → counts against that allocation (source `'category'`).
4. Otherwise → unallocated bucket.

**Audit actions** (Phase 2, written to `users/{uid}/audit_logs`):
`budget_assignment.update`, `budget_assignment.exclude`,
`budget_assignment.restore`. Each manual write commits the record update +
the audit log in a single Firestore `writeBatch` so they succeed or fail
together. `after.budget_id` is set so the budget activity timeline can
filter logs to the current budget without a composite index.

**Double-counting guard**: a bill with `budget_impact_status ===
'converted_to_actual'` OR with `linked_transaction_id` set is skipped by the
committed-amount calculation.

**Mark as paid → Ledger (`DataService.markBillPaid`).** The Bills page
Record-Payment modal (Mark as Paid in the bill drawer) calls
`markBillPaid(uid, billId, { paymentDate, cashFields })`, which mirrors
`markInvoicePaid`: in a single `writeBatch` it (a) creates one expense ledger
transaction (`type: 'expense'`, the bill's `amount`/`vendor_name`/`category`,
`timestamp` = payment date, `linked_bill_id` = the bill, plus the bill's
carried-over budget assignment and the chosen `cash_*` fields), (b) updates the
bill (`payment_status: 'paid'`, `budget_impact_status: 'converted_to_actual'`,
`linked_transaction_id`, `updated_at`/`updated_by`), and (c) writes the
`bill.mark_paid` audit log (`target_collection: 'bills'`). The bill then drops
out of *committed* totals and the new expense lands in *actual_used* on the same
allocation — committed → actual, no double count. **Category and budget are
inherited from the bill — the user does not re-select them.** **Paid is
terminal** (no un-pay path), matching invoices. Cash defaults to actual cash-out;
the modal lets the user set the payment date, the paying bank account, and
actual/pending via the shared `FluxyCashImpact` control. The transaction create
rule allows the new `linked_bill_id` key; the bill update rule allows
`linked_transaction_id` + `updated_at`/`updated_by`.

**Ordering:** `timestamp DESC`.
