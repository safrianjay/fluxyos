---
status: current
owns: [goods_receipts, stock_movements, stock_adjustments]
updated: 2026-08-16
source: docs/INVENTORY_DEMAND_VALIDATION.md §7
---

# Goods receipts & stock movements

> Workspace-scoping rules for these collections live in
> [`PROJECT_BACKGROUND.md` §4](../PROJECT_BACKGROUND.md#4-firestore-database-schema).
> Read that first — it is always loaded; this shard is not.

Step 4 of the F&B chain. **This is where inventory first touches the ledger.**

```
goods receipt   Dr 1200 Inventory  / Cr 2050 GRNI    (GR-RECEIPT)
supplier bill   Dr 2050 GRNI       / Cr 2000 A/P     (BILL-GRNI)
```

## 1. Why GRNI exists

The goods and the invoice arrive on different days. Without a clearing account,
receiving would have to either wait for the bill — understating stock and
overstating margin for as long as the invoice takes — or credit a payable to a
vendor who has not billed yet, which overstates A/P and breaks the aging tie-out.

`2050 Goods Received Not Invoiced` holds the liability in between. It should
trend to zero: a persistently growing balance means receipts are not being
matched to bills.

## 2. `goods_receipts/{id}`

| Field | Type | Notes |
|---|---|---|
| `vendor_name` / `vendor_id` | string \| null | |
| `dimension_id` | string \| null | **Where the stock arrived.** Flows onto the journal lines, so `ledger_balances_by_dim` gets its first real use |
| `reference` | string ≤60 \| null | Delivery note / PO reference |
| `lines` | array | `{ item_id, item_name, base_unit, quantity, amount }` |
| `total_amount` | integer | Σ line amounts. **This is what posts** |
| `status` | enum | `received` \| `billed` \| `reversed` |
| `bill_id` | string \| null | Set when a supplier bill clears this out of GRNI |
| `timestamp` | Timestamp | Receipt date — drives `period_key` |
| `journal_ref` / `accounting_status` | | Standard source-document link |

**`amount` is authoritative; unit cost is derived.** A line stores an integer
quantity (in the item's base unit) and an integer Rupiah amount. Unit cost is
`amount / quantity` and may be fractional — Rp 0.012 per gram of flour is a
legitimate cost *rate*, and it is never stored as money or as a quantity. Same
split as everywhere else: money and quantities are integers, rates are not.

**Composite items cannot be received.** Receiving a recipe would put it into
stock without consuming its ingredients — what physically arrived is the
components. `createGoodsReceipt` rejects it.

## 3. `stock_movements/{id}` — the subledger

| Field | Type | Notes |
|---|---|---|
| `item_id` / `item_name` | string | |
| `dimension_id` | string \| null | Which outlet/warehouse |
| `quantity` | integer, **signed** | Positive in, negative out |
| `base_unit` | string | Copied from the item at movement time |
| `amount` | integer | Rupiah value of this movement |
| `movement_type` | enum | `receipt` \| `issue` \| `adjustment` \| `count` \| `waste` \| `transfer` |
| `source` | map | `{ collection, id }` — the document that caused it |
| `journal_ref` | string \| null | The journal that moved 1200 |
| `period_key` | string | `YYYY-MM` |

**Quantity is signed rather than a quantity plus a direction flag.** A sum over
the collection *is* the balance, so the two can never disagree with each other.

### The control-account contract

> **`1200 Inventory`'s balance must equal Σ(`amount`) in `stock_movements`.**

This is the same contract `1100` has with invoices and `2000` has with bills, and
it is why `1200` is closed to both human posting surfaces
(`docs/data-model/chart-of-accounts.md` §4b): stock can only move through this
subledger, so the control account cannot drift from it.

**Movements are immutable — `allow update, delete: if false`.** Deleting one
would silently put the control account out of agreement with the subledger, and
nothing would report it. Correct by posting an opposing movement, exactly as
journals are corrected by reversal.

Written in the **same batch** as the journal that moved 1200, so a receipt can
never land without its movements.

## 4. Posting

`selectRule` routes `goods_receipts` → `GR-RECEIPT`, and a bill carrying
`goods_receipt_id` → `BILL-GRNI` instead of the usual `BILL-ACCRUE`.

That branch matters: a bill for received goods must **clear GRNI, not book a
second expense**. The cost already entered the books as inventory when the goods
arrived. `BILL-ACCRUE` there would double-count it and leave GRNI open forever.

The journal posts the receipt **total** to 1200, not one line per item — exactly
as an invoice posts its total to A/R while the line detail lives in its own
subcollection. Per-item detail is what `stock_movements` is for.

## 4b. `stock_adjustments/{id}` — count and waste

Where inventory becomes COGS.

```
count short   Dr 5100 COGS / Cr 1200    STOCK-COUNT-COGS
count over    Dr 1200      / Cr 5100    STOCK-COUNT-GAIN
waste         Dr 5150      / Cr 1200    STOCK-WASTE
```

| Field | Type | Notes |
|---|---|---|
| `adjustment_type` | enum | `count` \| `waste` \| `sale` |
| `dimension_id` | string \| null | Which outlet was counted |
| `lines` | array | count: `{item_id, system_quantity, counted_quantity, quantity, amount}` · waste: `{item_id, system_quantity, quantity, amount}` |
| `total_amount` | integer, **signed** | Negative means stock left. Deliberately not bounded ≥ 0 the way a receipt total is |

**Waste posts to `5150`, not to COGS.** Folding spoilage into cost of goods sold
makes gross margin absorb the loss it should expose. For F&B, where waste is
routine and material, that is the difference between a margin an owner can act on
and one that hides the problem (`PRODUCT_STRATEGY.md` §7).

**Waste and counts do not double-count.** Waste recorded as it happens reduces
the system quantity, so the next count's variance is what the kitchen actually
consumed.

**Costing is weighted average, derived not stored.** Unit cost is value on hand ÷
quantity on hand, both sums over `stock_movements`. There is no cached cost to
drift. The rate is fractional on purpose; money is rounded **once per line**,
because each line becomes a movement whose integer amounts must sum to the
journal.

A count that nets to zero is rejected rather than posted — a zero journal would
fail the engine's balance assertion and would mean nothing.

### Per-sale relief — `adjustment_type: 'sale'`

```
marketplace sale   Dr 5100 COGS / Cr 1200 Inventory    CM-ORDER-COGS
```

`commerce_orders` has posted revenue since it shipped (`CM-ORDER-REV`) and never
relieved stock, so every marketplace sale booked at full margin.
`DataService.relieveCommerceCogs` closes that **once something calls it** — see
the wiring note below: order lines resolve to items by
**`items.sku`** — the join that field was designed for — composites explode to
their ingredients, and stock relieves at weighted average.

**Idempotency carries no flag.** `commerce_orders` is `allow update: if false`, so
relief cannot be marked on the order. It does not need to be: the movement already
records `source: { collection: 'commerce_orders', id }`, so the subledger *is* the
record of what has been relieved. Same principle as on-hand being summed rather
than cached.

**Overselling relieves anyway, at the last known cost.** If a sale exceeds what the
subledger believes is on hand, the goods still left — a wrong subledger is a data
problem, not a reason to misstate COGS. Stock goes negative so the gap is visible,
which is why `inventory.html` surfaces a **Negative stock** signal.

⚠️ **Recipe explosion in this path was broken from the day it shipped.**
`explodeRecipe` returns an OBJECT keyed by item id, and `relieveCommerceCogs`
called `.forEach` on it — so the sweep threw on the first order containing a
composite. Marketplace sales of recipe items therefore never relieved stock and
booked at full margin, the exact defect `CM-ORDER-COGS` was built to close. It
went unnoticed because `tests/commerce-cogs.spec.js` only ever sells `stock`
items; nothing exercised the recipe path. Found 2026-08-21 while walking a POS
sale of a recipe item, and fixed by routing both channels through the shared
`_resolveSaleConsumption`.

### It was dead code for a day

`relieveCommerceCogs` shipped 2026-08-20 with **exactly one call site: its own
spec.** No page, no button, no scheduled function. So §1 of `POS_READINESS.md` —
"every marketplace sale books revenue at full margin and leaves inventory
untouched" — stayed true after the commit that was supposed to close it.

It is now wired to the **Inventory Overview**: a count of orders that sold stock
without relieving it, and one action, following the "Post N unposted entries"
pattern from the Accounting Center. `countUnrelievedCommerceOrders` is the
dry-run half and must never write — a banner renders on every Overview load.

Guard: `tests/commerce-cogs.spec.js` (contract on an empty set) and
`tests/commerce-cogs-wiring.spec.js` (the explosion itself, plus the surface).
The first could not catch either defect and says so in its own comment: it
asserts "the DAL's CONTRACT on an EMPTY order set", because `commerce_orders` is
Admin-SDK-only and no browser spec can seed one. The pure resolver is the guard
that works.

### Optimistic concurrency

A caller may pass `expected_system_quantity` per line — what the count sheet
showed the counter. If the subledger has moved since, `createStockAdjustment`
throws `STOCK_MOVED` (with `err.moved`) instead of posting.

Without it the variance is measured against a state the counter never saw. A
sheet opened at 24.500 g, a 5.000 g delivery received mid-count, then 21.500 g
posted, books **-8.000 g** of consumption instead of the -3.000 g that actually
left. Nothing errors; the books quietly overstate cost.

Omitting the field keeps the previous behaviour, so non-interactive callers are
unaffected. `inventory-count.html` always sends it.
Guard: `tests/inventory-count-ui.spec.js` → "stock moving mid-count is refused".

## 4c. Outlet P&L

`getOutletPnL(userId, { periodKey })` reads `ledger_balances_by_dim`, joins
`sak_category` from the chart, and runs **the same `buildIncomeStatement`** the
consolidated statement uses, once per dimension.

Reusing it is the point. An outlet P&L computed by different arithmetic would
eventually disagree with the company one, and `PRODUCT_STRATEGY.md` §6 forbids a
second source of truth.

Postings with no dimension are surfaced as **"Unassigned"**, never hidden — they
are real money, and dropping them would make the outlets fail to sum to the
company.

## 4d. Opening balances — `importInventoryItems`

```
opening stock   Dr 1200 Inventory / Cr 3900 Opening Balance Equity    OPENING
```

Where a business that already has stock states what it owns, on the way in. The
inventory bulk import (`docs/data-model/items.md` §7) posts it, and it is the
**first caller of `buildOpeningJournal`** — which shipped with the chart and had
sat unused since.

**Why 3900 and not 2050 GRNI.** A goods receipt credits GRNI because a supplier
is owed for goods they have not invoiced yet. Nobody is owed for stock a business
already had. Crediting GRNI would overstate the liability and sit in that account
forever, which is the exact signal `2050` exists to raise (§1). 3900 exists for
precisely this: recording an opening position without inventing revenue for it.

**One journal per opening DATE, not per file.** A journal carries a single
`period_key`, and a migration routinely carries balances struck on different
days. `_assignJournalNumbers` restarts its cursor per call, so all of an import's
journals are numbered in **one** call — numbering them individually hands every
journal the same number, silently, because nothing downstream asserts uniqueness.

**Movements are `adjustment`, not `receipt`.** Nothing was received. `receipt` is
reserved for goods that physically arrived against a vendor, and the Restock tab
reads that distinction. Their `source` is `{ collection: 'journals', id }`: the
opening journal *is* the source document, and inventing a collection to hold an
empty one would cost a `firestore.rules` block for nothing.

**Closed periods refuse, they never re-date.** Every distinct opening date is
checked with `_assertOpenPostingPeriod` **before** the batch is staged, so the
failure names the period instead of arriving as a rules rejection two hundred
writes in. The preview checks the same thing against `listPeriods` and marks the
row, so it is normally caught before the user ever presses Confirm.

**No rules change was needed**, which is worth knowing given the ruleset sits at
~97% of its expression-complexity ceiling: `adjustment` is already an allowed
`movement_type`, `items` and `stock_movements` are already in the audit-log
allowlist, the `journals` create rule accepts any balanced numbered system
journal, and the `items` validator uses explicit field checks with no `hasOnly`
(§5 of `items.md`) so new fields pass. Nothing here needs
`firebase deploy --only firestore:rules`.

**An untracked item cannot carry one.** `track_stock: false` is a service; the
importer errors the row, and `createGoodsReceipt` refuses it too.

## 5. Stock on hand

`getStockOnHand(userId, { byDimension })` sums the movements. **Deliberately not
a stored running total:** the movements are the record, and a cached balance is
one more thing that can disagree with them. If that becomes a performance
problem, the fix is the `ledger_balances` pattern — increment a rollup in the
same batch, and reconcile it against the movements nightly — not a cache.

## 6. Rules

Read = all member roles; create/update = owner/admin/finance/accountant.
`goods_receipts` is never deleted (it carries an immutable journal);
`stock_movements` is never updated *or* deleted.

`lines[]` is validated in `db-service`, not in rules — rules cannot iterate an
array cheaply and the evaluation budget is real (incidents recorded at
`firestore.rules` 3367, 3526, 3546).

Emulator coverage: `tests/stock-rules-emulator-test.mjs`.
