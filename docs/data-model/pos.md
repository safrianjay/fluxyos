---
status: current
owns: [pos_tables, pos_orders, pos_table_directory]
updated: 2026-08-31
source: docs/POS_IMPLEMENTATION_PLAN.md
---

# Point of sale — tables and orders

> Workspace-scoping rules for these collections live in
> [`PROJECT_BACKGROUND.md` §4](../PROJECT_BACKGROUND.md#4-firestore-database-schema).
> Read that first — it is always loaded; this shard is not.

Phase 1 of [`POS_IMPLEMENTATION_PLAN.md`](../POS_IMPLEMENTATION_PLAN.md).

**Status:** Phase 1.5 (shifts and the cash drawer) ships too — see §10. The
staff till ships in full — tables (create + archive), orders,
per-line and per-order discounts (amount or percent), line notes, manual payment
with partial tender, void, refund, a 58mm receipt, and posting through the
existing kernel. QR customer ordering (Phase 2), shifts
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
| `sort` | integer | List order in "Manage tables" |
| `layout_x` / `layout_y` | number 0–100 \| absent | Where the table sits on the floor plan: its **centre**, as a percentage of the canvas. Absent = never placed, and the floor packs it into a row automatically |
| `created_at` / `updated_at` | Timestamp | Server-set |

### The floor plan (2026-08-31)

Percentages, not pixels. The canvas is responsive and keeps a fixed aspect
ratio precisely so a percentage means something stable — a pixel grid saved on a
1440px laptop would be wrong on the 10" tablet at the host stand.

`pos_tables` has **no `hasOnly`** in `firestore.rules` — it validates `label`,
`dimension_id` and `status` and permits everything else — so these two fields
needed no rules change. That also means **the bounds are enforced in
`savePosTableLayout` and nowhere else**; the clamp there is not optional.

A table with no position is not broken. `layoutUnplacedTables` packs every
unplaced table into rows against the measured canvas and the measured
footprints, after paint. The first cut computed positions from a proportional
formula that ignored how wide a table actually is, and at the width the floor
really gets (~728px — the order panel takes the rest) six tables already
overlapped and twelve overlapped twelve times.

Arranging is the `pos.manage` capability, the same one that creates and archives
tables. A cashier reads the floor; they do not redraw the room.

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
| `lines` | array | `{ line_id, item_id, item_name, quantity, unit_price, gross_amount, discount_amount, discount_reason, note, modifiers, modifier_amount }` |
| `discount_amount` / `discount_reason` | integer / string | **Order-level**, separate from line discounts |
| `subtotal` / `discount_total` | integer | Σ line gross; Σ line + order discounts |
| `service_charge_amount` / `tax_amount` | integer | Always `0` in v1 — see §6 |
| `total_amount` | integer | What the customer owes |
| `payments` | array | `{ payment_id, method, provider, amount, reference, status, received_at, received_by }` |
| `paid_amount` | integer | Σ settled payments |
| `customer_name` | string ≤80 \| null | Taken in the Create Order dialog. Optional |
| `customer_phone` | string ≤32 \| null | How to call a takeaway back. Optional |
| `guest_count` | int 0–999 \| null | Covers, for a dine-in. Whole people — rules refuse a fractional count |
| `status_changed_at` | Timestamp | When the order ENTERED its current status. Stamped by the DAL **only on a real transition** — see below |
| `version` | integer | Bumped on every write — the concurrency guard |
| `transaction_id` / `stock_adjustment_id` | string \| null | What this order emitted. **The idempotency key** |
| `refund_transaction_id` / `refund_reason` / `refunded_at` | | The refund trail |

### Modifiers (2026-08-31)

Size, sugar level, add-ons. Authored on the **item** (`pos_modifier_groups`),
chosen at the till, stored on the line:

```
modifiers        [{ group_id, group_name, option_id, option_name, price_delta }]
modifier_amount  Σ price_delta, PER UNIT
gross_amount     (unit_price + modifier_amount) × quantity
```

**`unit_price` stays the MENU price.** The upcharge rides beside it, for exactly
the reason a discount is not folded into the price (§4): a line that has
forgotten what the menu charged can never be audited against it, and
per-option analytics become unbuildable.

Because the whole effect lands in `gross_amount` — already the only input to
`_posTotals` — **`POS-SALE`, the journal and the ledger need no knowledge of
modifiers at all.** An upcharge is revenue; a negative delta (a smaller size)
is a lower price, not a discount. The DAL refuses a combination that would take
a line below zero.

Lines merge on item + price + note + **the exact set of options**. Two iced
coffees where one is decaf are not the same line, and merging them loses the
instruction the kitchen needs.

Neither `items` nor `pos_orders.lines[]` is validated by `hasOnly` in
`firestore.rules`, so this needed **no rules change and no deploy** — and the
validation therefore lives entirely in `db-service.saveItem`
(`normalizeModifierGroups`) and `pos-service._normalizePosModifiers`.

⚠️ **`getPosMenu` projects an explicit field whitelist.** A field added to
`items` and not added there arrives at the till as `undefined` and the feature
silently does nothing — which is exactly what happened to `pos_modifier_groups`
on the first cut.

**Not built:** per-outlet modifier pricing, and modifier→recipe stock relief (an
extra shot consuming beans). The second one matters: a priced modifier moves
revenue today but not COGS, so a heavily-modified menu overstates gross margin
by the cost of the extras.

### Stock on the till warns, and never blocks (2026-08-31)

`getPosOverview` returns `onHand` — item id → base units — summed from the stock
movements it **already reads**, so the till can say "3 left" and "Out of stock"
at no extra read cost. Summed, never cached, for the reason `stock.md` §5 gives:
a stored count and the movements eventually disagree and nothing reports it.

**Advisory only.** A shop that has physically got the thing sells it, whatever
inventory believes, and a cashier cannot stop mid-service to reconcile. Refusing
the sale would make FluxyOS wrong about the MONEY as well as the stock — the
worse of the two errors. The negative on-hand left behind is the correct record
of what happened and surfaces in the next count as a real discrepancy.

Silent on anything with no on-hand number of its own: a **service**
(`track_stock: false`) is never held as stock, and a **recipe**'s availability
belongs to its ingredients rather than to itself.

⚠️ `getPosMenu` projects an explicit whitelist, so `track_stock` and `barcode`
had to be added to it. A field on `items` that is not in that map reaches the
till as `undefined` and the feature silently does nothing.

### Who the order is for (2026-09-01)

Captured when the order is CREATED, in the Create Order dialog, because both
answers are known before the first item is rung up — and because the dining type
used to be decided afterwards by a select in the order panel that is DISABLED
once an order exists, so getting it wrong meant voiding and starting again.

**Everything is optional except the table.** A queue does not wait while a
cashier types a phone number, so an order carrying nothing but a type is as valid
as one carrying all of it. A dine-in with no table is the one refusal: it has
nowhere to sit and nothing downstream could repair that.

A takeaway is never asked for a table it will not have, nor for a cover count
that means nothing without one.

**Every route into an order asks the same questions.** Tapping a free table on
the floor plan opens the same dialog with the table already answered and locked
— it used to create an order on the spot knowing nothing about it, which meant a
table order could never carry any details at all, since they can only be taken at
creation. The panel's table select routes here too. Three ways to start an order
is already one more than ideal; three that asked DIFFERENT questions would be a
bug reported as "the customer details are missing".

Creating always lands on the till, whichever route it came from: putting
something on the order is the next thing that happens, and leaving the cashier on
the floor plan is a step they would undo every time.

⚠️ These three are the first `pos_orders` fields added since the collection
shipped, and `pos_orders` has a `hasOnly` — so unlike modifiers, barcode and the
hold label, this **required a rules change and a deploy** (2026-08-31, stamped).
They are scalars, so unlike `lines[]`/`payments[]` they are bounded in rules as
well as in the DAL: nine expressions, which the lean POS validators afford, and
worth spending because they are the only fields on this document a customer's
own words reach.

### `status_changed_at`, and why `updated_at` could not do this job

The Orders board is a kitchen screen as much as a cashier's, and its rule is
*prioritise what needs attention next, not what happened last*. That needs one
number: how long this order has been sitting in the state it is in.

`updated_at` looks like that number and is not. Every write bumps it — a line
added, a note typed, a discount applied — so a waiter adding one drink to a table
that had been waiting forty minutes would reset the kitchen's timer to **zero**.
The order most in need of attention would drop to the BOTTOM of a longest-waiting
sort, silently, and the board would look entirely plausible while doing it.

So the DAL stamps `status_changed_at` inside `updatePosOrder`, guarded by
`changes.status !== current.status`. `createPosOrder` seeds it equal to
`opened_at`: an order is waiting from the moment it exists, not from its first
transition. Orders written before the field existed fall back to `opened_at` in
the UI, which OVER-states the wait rather than under-stating it — the safe
direction for a queue.

`pos_orders` has a `hasOnly`, so this required a rules change and a deploy
(2026-09-01, stamped). The frozen-paid paths are unaffected:
`wsValidPosOrderStamp` and `wsValidPosOrderRefund` check named fields rather than
the key set, so adding a key cannot loosen them.

**Lateness is per-status, and that is the point.** The board compares
minutes ÷ that status's own late threshold, never raw minutes. Cooking
legitimately takes longer than sending, so ranking by minutes floats every dish
above a bill the customer has already asked for and is still sitting with.
Thresholds live in `SLA` in `assets/js/pos.js`; a terminal status (`paid`,
`void`) has none, because a settled order is waiting on nobody and a permanently
amber board teaches staff to ignore the colour.

### The board's CTA is the next step, never a later one

Each order card carries exactly ONE action, taken from `STATUS[status].action`:
open → *Process to Kitchen*, sent → *Mark as Served*, served → *Request Bill*,
awaiting_payment → *Pay Bill*, paid → *Print receipt*, void → nothing.

It used to read "Pay Bills" on anything carrying a total, including an order
still being typed at the till. Naming a step three moves away invites the
cashier to skip the ones in between, and on a till that means a dish leaves the
pass unrecorded.

⚠️ **There is no `ready` state** between `sent` and `served`. A kitchen that
wants "Mark as Ready" and then "Serve" as two presses needs one, and that is a
schema change: the status enum is enforced in `firestore.rules`, so it needs a
deploy AND a seventh tab — orders in a status no tab matches are invisible.
Deliberately deferred.

### Payment is a modal, and every figure goes through the money seam

`openPaymentModal` uses the shared `.pos-modal-layer` (blurred navy scrim, 16px
card, pinned footer) rather than the side drawer: taking money is the one moment
the cashier must not be doing anything else.

Cash specifics: the bill is stated once and large, the tender is entered against
locale-correct formatting, CHANGE is the loudest thing after the bill (it is
what physically leaves the drawer), and a tender below the bill cannot be
confirmed as a completed payment.

**A short tender is still recordable as an explicit part payment**, and the
button says so. Blocking it outright would delete split tender — cash + QRIS on
one bill — which `_posSettlementAmounts` supports and which produced a silent
money bug on 2026-08-30 when it was got wrong. The guard the board needs is
"this must not LOOK settled", not "this must be impossible".

Quick-cash amounts come from `FluxyMoney.cashSuggestions`, which reads the
currency's own banknotes — see `MULTI_MARKET_ARCHITECTURE.md` §2d.

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
tieable and `1030`'s balance is the unsettled float.

**A split bill settles to both, in the same journal** (fixed 2026-08-30). The
transaction carries `pos_cash_amount` and `pos_clearing_amount`, and `POS-SALE`
emits one debit line per non-zero side. Until then the whole sale followed the
*largest* payment, so a Rp200.000 bill paid Rp120.000 cash + Rp80.000 QRIS booked
all Rp200.000 to cash — the bank rec wrong by the minority tender and `1030`,
whose balance is supposed to BE the float, wrong by the same amount. Both silent.

The apportionment rule: **non-cash tender is exact, cash absorbs the remainder.**
Nobody overpays a QRIS and change is only ever given in cash, so a proportional
split would mis-file any sale where the customer tendered more than the bill.
`cash` is derived as `amount − clearing`, so the two always total the amount and
an unbalanced POS journal is unreachable.

**Refunds go back the way the money came in.** `refundPosOrder` hardcoded
`pos_settlement: 'cash'`, so every refund of a non-cash sale credited `1000` —
money that had never been in the drawer — and stranded the float in `1030`
permanently. Unconditional, not just on split bills. Fixed in the same change.

**Rows written before the split carry neither field** and fall back to the old
single-account behaviour, so `postPendingJournals` re-posting an old pending row
reproduces the journal already on the books rather than a different one.

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

### The trading day is the business's, not the device's

`_posDayKey` (which keys the per-outlet order-number counter) and
`getPosOverview`'s "sales today" both read `new Date()` in the **device's**
timezone until 2026-08-30. A till set to UTC while trading in Jakarta rolls over
at 07:00 local — mid-service — restarting the order numbers with the room full
and splitting one day's sales across two.

Both now resolve through `FluxyMoney.businessDayKey` /
`startOfBusinessDay`, derived from the workspace **country** (ID → Asia/Jakarta,
PH → Asia/Manila, SG → Asia/Singapore, MY → Asia/Kuala_Lumpur). No new field and
no rules change: the country is already immutable workspace config shared by every
member, so it cannot disagree with itself. Indonesia's three zones collapse to
Asia/Jakarta — a per-outlet refinement belongs on the outlet if an eastern one
ever ships, and `settings/company.timezone` already accepts those values.

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

## 10. `pos_shifts/{shiftId}` — the cash drawer

What makes the till reconcilable. Without it an owner ends the day with a sales
figure and a drawer full of cash and no way to ask whether they agree — which is
the only question a close-of-day actually asks.

| Field | Type | Notes |
|---|---|---|
| `dimension_id` | string | Outlet. **One open shift per outlet** — two would each claim the same sales and neither would reconcile. Enforced in the DAL; rules cannot query |
| `status` | enum | `open` \| `closed` |
| `opening_float` | integer | Cash in the drawer at open. **Immutable after create** |
| `movements` | array | `{id, kind: 'paid_in'\|'paid_out', amount, reason, at, by}` |
| `counted_cash` | integer \| null | What was physically counted. **Write-once** — see below |
| `expected_cash` / `variance` | integer \| null | Computed at close. `variance = counted − expected` |
| `cash_sales` / `non_cash_sales` / `order_count` | integer | Tallied from orders carrying this `shift_id` |
| `journal_ref` / `accounting_status` | | Standard source-document link |
| `version` | integer | Concurrency guard, as on orders |

`pos_orders.shift_id` says which drawer rang a sale up. Exact, rather than a time
range — which two tills at one outlet would make ambiguous the moment that ships.
Null when no shift was open: the sale is real, it just sits outside every cash
count, which is what the shift bar says in words.

### The float does not post

Moving cash from the safe to the drawer is internal to `1000 Cash & Bank`. A
journal would be `Dr 1000 / Cr 1000` — nets to nothing and fails the engine's
balance assertion. The float still changes what the drawer *should* hold, so it
is arithmetic, not accounting. Counterintuitive enough to be worth stating.

### Paid in and paid out are not symmetrical

**Paid out** posts an ordinary expense — buying ice, paying a courier. That money
left the business. **Paid in** does not: it is change topped up from the safe,
which is internal. If a paid-in ever needs to post it is not a paid-in; it is a
sale or a refund and belongs on an order.

### Only the variance posts

```
drawer short   Dr 6700 Cash Over & Short / Cr 1000    POS-SHIFT-VARIANCE
drawer over    Dr 1000 / Cr 6700 Cash Over & Short    POS-SHIFT-VARIANCE
```

`6700` is new in the seed. A **single** account that swings both ways is the
standard treatment: a credit balance means the tills ran over, which is as much a
control signal as running short. Deliberately **not** netted into sales — folding
a short into revenue hides the exact thing the count exists to expose, the same
way waste posts to `5150` so spoilage cannot hide inside gross margin.

**A balanced drawer posts nothing.** `selectRule` returns null on a zero
variance; a zero journal would fail the balance assertion and would mean nothing.

**The shift is the source document and posts directly**, as `goods_receipts` and
`stock_adjustments` do. An earlier cut also wrote a `transactions` row so the
variance would appear in the ledger view — a double count waiting to happen: that
row carried `accounting_status: 'pending'`, so `postPendingJournals` would have
posted it a second time as an ordinary expense on top of the journal. Found
2026-08-22 by reading the shift back after a close.

### The blind count

`counted_cash` is **write-once** — rules refuse a second count once one exists.
A recount taken with the expected figure now on screen is not a blind count, and
the variance stops measuring anything. The UI holds the same line: expected cash
appears nowhere — not in the shift bar, not in the close drawer — until the count
has been submitted.

### Rules

Read = all member roles plus `cashier`. Create/update = finance+ **and
`cashier`**: they are the one holding the money, so withholding this would make
the feature unusable by the only role that needs it. Never deleted.
`opening_float` is immutable after create; `version` must advance by one.

## 9. What is NOT built

Offline-first (v1 is online-only with a visible connection banner — the largest
honest limitation), kitchen display, split-by-seat,
per-outlet menu pricing, QR ordering, payment providers, and any AI over POS
data. §15 of the plan sequences all of them.
