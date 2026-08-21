---
status: current
owns: [pos_tables, pos_orders, pos_table_directory]
updated: 2026-08-21
source: docs/POS_IMPLEMENTATION_PLAN.md
---

# Point of sale — tables and orders

> Workspace-scoping rules for these collections live in
> [`PROJECT_BACKGROUND.md` §4](../PROJECT_BACKGROUND.md#4-firestore-database-schema).
> Read that first — it is always loaded; this shard is not.

Phase 1 of [`POS_IMPLEMENTATION_PLAN.md`](../POS_IMPLEMENTATION_PLAN.md).

**Status:** the staff till ships — tables, orders, manual payment, void, refund,
and posting through the existing kernel. QR customer ordering (Phase 2), shifts
and the cash drawer (Phase 1.5), and payment providers (Phase 5) are not built.

## 1. Why only two collections

Almost everything a POS needs already existed:

| Concept | Where it lives |
|---|---|
| Outlet | `dimensions` where `type == 'outlet'` |
| Menu item | `items` — an item with `sales_price` and `pos_visible` |
| Recipe / BOM | `items.components[]`, exploded by `explodeRecipe` |
| Stock relief | `stock_adjustments` where `adjustment_type == 'sale'` |
| COGS journal | `CM-ORDER-COGS` (shipped for marketplace orders 2026-08-20) |
| Revenue | `transactions` where `source == 'pos'` |
| Non-cash float | `1030 Payment Gateway Clearing`, cleared by `CM-SETTLE` |
| Per-outlet P&L | `ledger_balances_by_dim` |

**The menu is `items`.** No separate menu master, so a dish's recipe — and
therefore its true cost — is the same record the kitchen maintains. Two records
would drift, and the direction they drift in is a flattering gross margin.

## 2. `pos_tables/{tableId}`

| Field | Type | Notes |
|---|---|---|
| `label` | string 1–40 | "12", "A3", "Bar 2" |
| `dimension_id` | string | The outlet. **Required** — a table with no outlet cannot attribute its revenue |
| `seats` | integer ≥1 \| null | Display only |
| `zone` | string ≤40 \| null | "Lantai 2", "Teras" — groups the grid |
| `qr_token` | string 43 | 256 bits of CSPRNG output, base64url. Never derived from the table id, a sequence, or a timestamp |
| `status` | enum | `active` \| `archived`. Soft archive only |
| `sort` | integer | Grid order |
| `created_at` / `updated_at` | Timestamp | Server-set |

**Occupancy is not stored.** It derives from whether an open `pos_orders` doc
references the table. Same principle as stock on hand being summed rather than
cached (`stock.md` §5): a stored status and a real order eventually disagree, and
nothing would report it.

## 3. `pos_orders/{orderId}` — the normalized order document

| Field | Type | Notes |
|---|---|---|
| `order_number` | string | `YYYYMMDD-NNN`, per outlet per day. Reserved transactionally through `counters/pos-{dimensionId}-{YYYYMMDD}` |
| `dimension_id` | string | Outlet. `buildJournal` stamps it onto every line it produces |
| `table_id` / `table_label` | string \| null | Null for takeaway |
| `channel` | enum | `staff` \| `qr` \| `connector` |
| `status` | enum | `open` \| `submitted` \| `sent` \| `served` \| `awaiting_payment` \| `paid` \| `void` |
| `lines` | array | `{ line_id, item_id, item_name, quantity, unit_price, gross_amount, discount_amount, discount_reason, note }` |
| `discount_amount` / `discount_reason` | integer / string | **Order-level**, separate from line discounts |
| `subtotal` / `discount_total` | integer | Σ line gross; Σ line + order discounts |
| `service_charge_amount` / `tax_amount` | integer | Always `0` in v1 — see §6 |
| `total_amount` | integer | What the customer owes |
| `payments` | array | `{ payment_id, method, provider, amount, reference, status, received_at, received_by }` |
| `paid_amount` | integer | Σ settled payments |
| `version` | integer | Bumped on every write — the concurrency guard |
| `transaction_id` / `stock_adjustment_id` | string \| null | What this order emitted. **The idempotency key** |
| `refund_transaction_id` / `refund_reason` / `refunded_at` | | The refund trail |

### `channel` is the connector seam

`pos_orders` is a **normalized** order document; the first-party till is merely
its first writer. A Moka / Majoo / Olsera connector later writes the same
document with `channel: 'connector'`, and payment, stock relief, COGS, revenue,
outlet P&L and AI are all shared. This is what makes the
`POS_READINESS.md` §6 sequencing debate cost nothing either way.

### Lines and payments are embedded

You always want the whole order at once and always change it as a unit — the same
call `items.components[]` and the commerce order lines made. Invoices went the
other way because their lines are separately queryable; order lines are not.

### `version`, and why it exists

Two waiters on one table with stale reads: last-write-wins on an embedded
`lines[]` silently loses a dish, and nothing reports it. Every mutation runs
inside `runTransaction` against a fresh read, and rules require
`version == prev.version + 1`, so the second device is **refused** rather than
merged. Same shape as `expected_system_quantity` on `createStockAdjustment`.

### `paid` is derived, never asserted

Rules enforce `status != 'paid' || paid_amount >= total_amount`. Without it a
client could flip the flag and emit revenue for a table that never paid.

### A paid order is frozen

Rules permit only the emission stamp (§4) and the refund fields to change once
`paid`. Correction is by
refund, never by editing a paid order — the discipline journals have. `lines`,
`total_amount`, `paid_amount` and `dimension_id` must be identical to what
posted, or the order and the ledger part company with no way to tell which is
right.

## 4. Posting

```
till sale      Dr 1000 Cash | 1030 Clearing   (net)
               Dr 4900 Sales Discounts        (discount, if any)
                   Cr 4000 Revenue            (GROSS)               POS-SALE
stock relief   Dr 5100 COGS / Cr 1200         CM-ORDER-COGS  (already shipped)
till refund    Dr 4900 / Cr 1000|1030         POS-REFUND
payout         Dr 1000 / Cr 1030              CM-SETTLE      (already shipped)
```

**`amount` on the transaction is NET revenue** (gross − discount), because every
existing revenue surface sums transaction amounts — the dashboard KPI, the income
statement, `/outlet-pnl`. The gross price is recovered inside `POS-SALE` from
`pos_discount_amount`.

**The discount is contra-revenue, not a lower price.** Storing the discounted
price as the price loses the menu price permanently: no price integrity, no
discount analytics, and the discount-anomaly detection the plan promises becomes
unbuildable.

**Cash settles to `1000`; QRIS / card settle to `1030`**, so the bank rec stays
tieable and `1030`'s balance is the unsettled float. Settlement follows the
largest payment on a split bill; per-payment splitting across two journals is
deferred.

**`CM-ORDER-COGS` is shared with marketplace orders on purpose** — it is the same
journal caused by the same event. Its description was renamed from "Marketplace
cost of goods" to "Cost of goods sold" when POS started using it. The rule **ID**
still reads `CM-*` because it is stamped on immutable posted journals and
renaming it would orphan every one of them; `source.collection` says which front
end rang it up.

### Emission is idempotent without a flag, and atomic

`transaction_id` being set **is** the record that this order has emitted.

**The stamp is written in the SAME batch as what it stamps.** The first cut
stamped after the commit, on the reasoning that a crash mid-emission should leave
the order retryable. That was backwards: it opened a window where the transaction
existed and the order did not know it, and since `transaction_id` is the
idempotency key, the next sweep emitted the same sale **again**. Two transactions,
one order, silently — observed on 2026-08-21 while walking a shift.

A paid order is otherwise frozen, so this needs its own rules transition:
`wsValidPosOrderStamp` allows exactly one non-refund mutation, guarded by
`prev.transaction_id == null` so the key is write-once. Without it the stamp was
refused outright, which is how the double-emit was found.

`emitUnpostedPosSales` retries anything that still has no stamp; the POS overview
surfaces the backlog rather than hiding it.

### Who posts the journal

`_canPostJournals()` checks `accounting.post`. A **cashier cannot write
`journals` or `ledger_balances`**, and Firestore batches are atomic — attempting
the journal inline would fail the whole write and lose the sale. So a cashier's
sale lands `accounting_status: 'pending'` and the existing `postPendingJournals`
sweep posts it in the next finance session. Exactly the bulk-import and commerce
precedent (`finance-map.js`: "Never post here").

## 5. `pos_table_directory/{token}` — top-level, deny-all

`{ workspace_id, table_id, dimension_id, revoked }`. `allow read, write: if false`
for every client including the owner.

A verbatim copy of `commerce_shop_directory`: the QR ordering function resolves
tokens Admin-SDK-side, so a guessed token cannot even confirm a workspace exists,
and **the customer surface costs zero rules budget because it never touches
Firestore.** Unused until Phase 2 ships.

## 6. Tax is deliberately absent

Indonesian F&B is generally liable for a **regional** tax — historically PB1
(Pajak Restoran), consolidated under UU 1/2022 as **PBJT atas makanan dan/atau
minuman** — not PPN. It is collected on the government's behalf, so it is a
**liability, not revenue**: booking the gross amount the customer paid as revenue
overstates revenue by roughly 9%.

`tax_amount` exists on the order and is always `0`. There is no PB1/PBJT account
in `CHART_OF_ACCOUNTS_SEED`, and the rate, thresholds and liability vary by
regency. **Confirm with an Indonesian tax practitioner before any number reaches
a journal** — `ACCOUNTING_EXPERT_INTERVIEW_GUIDE.md` exists for this, and the
outcome belongs in `INDONESIA_TAX_CENTER_ARCHITECTURE.md`. Service charge is the
same shape and the same `0`.

## 7. Rules

Read on both = all member roles **plus `cashier`**. Create/update on
`pos_tables` = finance+; on `pos_orders` = finance+ and `cashier`. Refunding a
paid order = finance+ only. Neither is ever deleted.

`lines[]` and `payments[]` are validated in `db-service.js`, not in rules — rules
cannot iterate an array cheaply and the evaluation budget is real.

Three lean **per-transition** validators (`wsValidPosOrderCreate`, `…Update`,
`…Refund`) rather than one large one, because a validator that evaluates every
branch trips the 1000-expression budget — the invoice `open → paid` failure of
2026-07-14. The same trap bit the first cut of the `transactions` cashier clause:
it reused the 70-key `wsValidTxCreate` and tripped the budget, and **the DENY
cases still passed**, because a budget trip denies. `wsValidPosTxCreate` is the
16-key validator a cashier evaluates instead.

`source: 'pos'` had to be added to the `isValidAICaptureMetadata` enum. Despite
the name that enum is "how did this row get here" and already carried two non-AI
values; `source` is load-bearing because `selectRule` reads it to choose
`POS-SALE`. Commerce is absent from the enum only because its writer is the Admin
SDK, which bypasses rules — the till writes from the client and must pass them.

**An owner is held to the stricter validator.** `hasRole()` is true for an owner,
so `||` short-circuits into the `wsValidTxCreate` clause and never reaches the
lean cashier one. Both must therefore accept the identical payload — which is how
a missing `icon` (required by `isValidBaseRecord`'s `hasAll`) refused the write
for everyone.

Emulator coverage: `tests/pos-rules-emulator-test.mjs` (52 cases, over half of
them the cashier boundary). Posting rules: `tests/pos-posting.spec.js`. Page:
`tests/pos-ui.spec.js`.

## 8. The `cashier` role

The first role in this product that is **not** a finance role. Built from an
empty capability set, never from `READ_CAPS` — every other role inherits
`transactions.read` and `accounting.read`, so granting a waiter `viewer` would
hand them the ledger.

| Can | Cannot |
|---|---|
| Read `pos_tables`, `pos_orders`, `items`, `dimensions`, `counters` | Read `journals`, `ledger_balances`, `bank_accounts`, `transactions`, `invoices`, `bills`, any report |
| Create / update `pos_orders` | Delete anything |
| **Create-only** `transactions` (`source == 'pos'`, `accounting_status == 'pending'`) and `stock_adjustments` (`adjustment_type == 'sale'`) | Read them back; write `journals` or `ledger_balances`; refund a paid order |
| Reserve a `pos-*` counter | Touch `journal-*` counters |

`applyToPage()` routes a POS-only role to `/pos` **before** the onboarding and
KYC gates, because those are the owner's obligations and a cashier can action
neither. `sidebar-loader.js` collapses the nav to the till.

**Per-outlet scoping is a UI guard, not a boundary.** The page queries one
outlet; rules enforce workspace + role. A cashier calling `DataService` directly
could read another outlet's orders. Same honest distinction `feature-access.js`
documents for itself. Enforcing it needs a member-doc field read per evaluation —
check the budget first; Phase 3.

## 9. What is NOT built

Offline-first (v1 is online-only with a visible connection banner — the largest
honest limitation), shifts and the cash drawer, kitchen display, split-by-seat,
per-outlet menu pricing, QR ordering, payment providers, and any AI over POS
data. §15 of the plan sequences all of them.
