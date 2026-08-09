---
status: current
owns: [transactions]
updated: 2026-08-07
source: docs/PROJECT_BACKGROUND.md §4 (sharded 2026-08-07)
---

# Transactions

> Workspace-scoping rules for these collections live in
> [`PROJECT_BACKGROUND.md` §4](../PROJECT_BACKGROUND.md#4-firestore-database-schema).
> Read that first — it is always loaded; this shard is not.

### 4a. Transactions — `users/{userId}/transactions`

| Field | Type | Values / Notes |
|-------|------|----------------|
| `amount` | number | Raw integer (e.g. `1234567`). Never stored with dots. Always positive for revenue, positive for expense (type determines sign in display) |
| `vendor_name` | string | Free text (e.g. `"AWS"`, `"Client Payment"`) |
| `category` | string | One of the built-in labels — `"Revenue"`, `"Marketing"`, `"Infrastructure"`, `"Operations"`, `"SaaS"`, `"Others"` — or any free-text label up to 40 chars when the user picks "Others" and types their own (e.g., `"Event"`). |
| `type` | string | Transaction type. Built-in values: `"income"`, `"expense"`, `"transfer"`, `"refund"`, `"adjustment"`, `"fee"`, `"tax"`, `"pending_receivable"`, `"pending_payable"`. Legacy `"revenue"` is still accepted as income. The Add Transaction modal also exposes an "Others" option that stores the user's free-text label (up to 40 chars) — the ledger renders it as-is and treats it as neutral for sign/colour. |
| `status` | string | `"Completed"` \| `"Missing Receipt"` |
| `icon` | string | `"💰"` for positive-side transaction types, `"💸"` for spend-side transaction types |
| `timestamp` | Firestore Timestamp | Defaults to `serverTimestamp()`, but dashboard entry drawer and CSV import may set an explicit selected transaction date for today or a previous day |
| `budget_id` | string \| null | Optional. Phase 2. References the active `budgets/{id}` at assignment time. |
| `budget_allocation_id` | string \| null | Optional. Phase 2. References `budget_allocations/{id}`. Null when excluded or unmatched. |
| `budget_match_method` | string \| null | Optional. Phase 2. `"auto"` \| `"manual"` \| `"rule"` \| `"excluded"` \| `"none"`. |
| `budget_match_status` | string \| null | Optional. Phase 2. `"matched"` \| `"needs_review"` \| `"unmatched"` \| `"excluded"`. |
| `budget_match_confidence` | number \| null | Optional. Phase 2. 0–1, reserved for future rule/AI matching. |
| `budget_assignment_reason` | string \| null | Optional. Phase 2. ≤500 chars. Required by UI for manual/exclude/restore writes. |
| `budget_assignment_updated_at` | Timestamp \| null | Optional. Phase 2. Server-set on each assignment write. |
| `budget_assignment_updated_by` | string \| null | Optional. Phase 2. Pinned by Firestore rule to `request.auth.uid`. |
| `budget_exclusion_reason` | string \| null | Optional. Phase 2. ≤500 chars. |
| `cash_effective` | boolean \| null | Optional. Phase 1 cash impact. `true` when money has already moved, `false` when pending/neutral. |
| `cash_status` | string \| null | Optional. Phase 1 cash impact. `"actual"` \| `"pending"` \| `"none"`. |
| `cash_direction` | string \| null | Optional. Phase 1 cash impact. `"in"` \| `"out"` \| `"none"`. |
| `cash_account_id` | string \| null | Optional. The linked `bank_accounts/{id}` — **live, not reserved**. Set from the entry drawer / receipt capture / ledger editor account picker, from a bill payment, stamped from a statement import's `bank_account_id`, or chosen per file (or per CSV value) by the **bulk CSV importer**. `null` when unattributed. ⚠️ Rules allowlist this key but do **not** validate it — a stale or archived id writes cleanly and renders as nothing, so the writing surface is the only guard. |
| `cash_source` | string \| null | Optional. `"manual"` (a human classified it) \| `"auto"` (derived from `type` by `FluxyCashImpact.deriveFromType`) \| `"bank_statement_import"` \| `"integration"`. `isDerivable()` re-derives only the first two. |
| `cash_match_status` | string \| null | Optional. `"manual"` \| `"unmatched"` \| `"imported"` \| `null`. |
| `cash_effective_at` | Firestore Timestamp \| null | Optional. Phase 1 cash impact. Equals `timestamp` when `cash_effective` is `true`; `null` otherwise. |
| `cash_assignment_reason` | string \| null | Optional. Phase 2. ≤500 chars. Reason recorded when user manually updates cash-impact fields from Ledger. |
| `cash_assignment_updated_at` | Timestamp \| null | Optional. Phase 2. Server-set on each cash-impact assignment write. |
| `cash_assignment_updated_by` | string \| null | Optional. Phase 2. Set to `request.auth.uid` on each cash-impact write. |

All 9 budget fields, all 7 Phase 1 cash-impact fields, and all 3 Phase 2 cash-assignment audit fields are optional. Legacy transactions without them keep
working — `DataService.resolveRecordAssignment` falls back to category match.

**Creation-time allocation picker.** The three record-transaction entry points —
the Add Transaction drawer, the CSV bulk "apply allocation to all rows" control,
and the AI receipt-capture review — now let the user pin an expense to a specific
allocation *at create time* via the shared `window.FluxyBudgetPicker` helper
(`assets/js/shared-dashboard.js`). Shown only for expense-like types
(`expense`/`fee`/`tax`/`pending_payable`) when an active budget covers the
selected date. Picking an allocation writes `budget_id`, `budget_allocation_id`,
`budget_match_method: 'manual'`, `budget_match_status: 'matched'`,
`budget_match_confidence: 1` (no audit log on create, mirroring the Add Bill
drawer). "Auto-match by category" writes nothing (preserves the fallback);
"Don't track against budget" writes `budget_match_method/status: 'excluded'`.
The transaction create rule already allows these keys — no rules change.

**Cash impact at creation.** The Add Transaction drawer and the Ledger
transaction editor share one cash-impact control (`window.FluxyCashImpact`):
Actual / Pending / No-impact + direction (in/out) + optional bank-account link.
So `cash_direction` and `cash_account_id` are now user-chosen at creation
(previously direction was inferred from type and the account was always null).
`pending_payable`/`pending_receivable` stay forced-pending and `transfer` stays
neutral (control hidden, helper note shown).

**Bulk CSV import assigns the cash account (2026-08-09).** Imported rows used to
carry **no** `cash_*` fields at all, so every one had to be opened individually to
say which account the money moved through. The bulk panel now asks for the account
— the one part of cash impact that is not derivable — and stamps the rest via
`FluxyCashImpact.deriveFromType`, the same component the single-entry drawer uses,
so a row imported here and the same row typed by hand produce identical documents.

Two modes: one account applied to the whole file, or — when the CSV carries a
`Cash account` / `Bank account` / `Rekening` column — a per-value mapping. A bare
`Account` header is deliberately **not** recognised: in a FluxyOS-flavoured CSV
that means the Chart-of-Accounts account, and reading it as a bank account would
stamp `cash_effective` from the wrong column.

Three rules the implementation encodes, each of which is a way to get it wrong:

- **No account ⇒ no `cash_*` keys at all.** Not "cash moved, account unknown" —
  calling `deriveFromType` with an empty id still returns `cash_effective: true`
  for an expense, which would pull unmapped rows into the Cash Position KPI.
- **A value matching no account imports unlinked**, named in the preview *before*
  the import. Never a fallback to a default account.
- **An ambiguous label auto-matches nothing.** Two accounts at one bank means
  "BCA" resolves to neither. `recon-engine.js` hard-excludes a transaction whose
  `cash_account_id` differs from the statement's account and there is no bulk
  re-attribution tool, so a confident wrong guess is unrecoverable while an
  unmatched value is not. For the same reason an account is pre-selected only
  when the workspace has exactly one.

Consequence worth knowing: imported rows now enter `getLedgerCashPosition`, so
Cash Position and the dashboard headline move. The preview states the row count
and the rupiah effect before the import, not after. Guard:
`tests/csv-import-cash-account.spec.js`.

**Ordering:** `timestamp DESC` (newest first). Default limit: 50. Dashboard preview: 5.
