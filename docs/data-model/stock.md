---
status: current
owns: [goods_receipts, stock_movements]
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
