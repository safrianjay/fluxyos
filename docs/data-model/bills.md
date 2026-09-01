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
inherited from the bill — the user does not re-select them.** Paid is terminal
as a *user action* — there is no un-pay button, matching invoices. Cash defaults to actual cash-out;
the modal lets the user set the payment date, the paying bank account, and
actual/pending via the shared `FluxyCashImpact` control. The transaction create
rule allows the new `linked_bill_id` key; the bill update rule allows
`linked_transaction_id` + `updated_at`/`updated_by`.

**Voiding a payment gives the settlement back (2026-08-09).** A bill payment is
not only a transaction — it *settled a bill*. `voidTransaction` reverses the
payment's journal, which puts the liability back in the general ledger, so
`DataService._rollbackBillSettlement` stages the inverse of `_payBillOnce`'s bill
patch **into the same batch**: `amount_paid` decremented by the settled amount,
`outstanding_amount` restored, `payment_status` back to `partial` (or `unpaid`
when nothing is left paid), `budget_impact_status` back to `committed`, and
`linked_transaction_id` cleared when it pointed at the voided transaction.

Without it the general ledger says the vendor is still owed money while the bills
list says the bill is paid. That is not hypothetical — one workspace's A/P was
understated by **Rp20.500.000** because two payments on a Rp89.500.000 bill were
voided and the bill stayed `paid`. The nightly `ap_subledger` assertion is what
surfaced it.

Two constraints shaped the implementation:

- **IDR only, precisely.** For an IDR bill the payment transaction's `amount` *is*
  the settled amount. For a foreign bill it is not — `amount_paid` accumulates
  foreign units while the transaction carries the Rupiah paid. Foreign bills are
  full-payment-only, so the one invertible shape (this payment settled the whole
  bill) is handled and anything else is left untouched rather than guessed at.
  Foreign bills sit outside the IDR kernel, so no ledger tie depends on it.
- **`'unpaid'` had to join the LEAN `isValidBillPayTransition`.** It would
  otherwise fall through to `wsValidBillUpdate`, which validates the whole
  document and lands within sight of the 1000-expression rules ceiling — the
  emulator already reports exhaustion there. A tax-carrying bill would have
  denied a legitimate rollback, the same trap `isValidInvoicePaidTransition`
  exists to avoid. **Requires `firebase deploy --only firestore:rules`.**

⚠️ **Invoices have the identical gap and it is NOT fixed.** Voiding an income
transaction with `linked_invoice_id` leaves the invoice's `amount_paid`/status
stale the same way. It needs its own lean transition validator, because
`isValidInvoicePartialTransition` requires `existingData.status in ['open',
'partial']` and so rejects a `paid → partial` rollback, and the remaining branch
is the full `isValidInvoiceBase` that already blew the rules budget once.

### `goods_receipt_id` — invoicing a delivery (2026-09-02)

| Field | Type | Notes |
|---|---|---|
| `goods_receipt_id` | string \| null | The delivery this bill invoices. **Its presence routes the posting**: `BILL-GRNI` (Dr 2050 / Cr 2000) instead of `BILL-ACCRUE` (Dr expense / Cr 2000) |

Set by the Add Bill drawer's "Is this for a delivery?" picker, **with the
create** — it must be on the payload before it commits, because that is what
`selectRule` reads, and journals are immutable afterwards.

Why it matters: receiving goods already booked the cost as inventory. A bill
that accrues an expense for the same goods counts the money twice — once in
Dashboard OpEx when the bill is paid (a payment writes a `type: 'expense'`
transaction), and again as COGS when the stock sells. Full history, the measured
exposure, and the repair procedure for pre-existing bills:
[`stock.md` §1a](stock.md).

⚠️ `bills` has a `hasOnly` on both create and update, so this key required a
rules change and a **deploy**.

**Ordering:** `timestamp DESC`.
