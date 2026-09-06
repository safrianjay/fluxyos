---
status: current
owns: [pos_tables, pos_orders, pos_reservations, pos_table_directory, pos_outlet_settings, pos_discount_presets]
updated: 2026-09-05
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
references the table — or, since 2026-09-01, from whether a `pos_reservations`
doc holds it (§4a). Same principle as stock on hand being summed rather than
cached (`stock.md` §5): a stored status and a real order eventually disagree, and
nothing would report it.

## 3. `pos_orders/{orderId}` — the normalized order document

| Field | Type | Notes |
|---|---|---|
| `order_number` | string | `YYYYMMDD-NNN`, per outlet per day. Reserved transactionally through `counters/pos-{dimensionId}-{YYYYMMDD}` |
| `dimension_id` | string | Outlet. `buildJournal` stamps it onto every line it produces |
| `table_id` / `table_label` | string \| null | Null for takeaway |
| `channel` | enum | `staff` \| `qr` \| `connector` |
| `status` | enum | `open` \| `submitted` \| `sent` \| `ready` \| `served` \| `awaiting_payment` \| `paid` \| `void` |
| `lines` | array | `{ line_id, item_id, item_name, quantity, unit_price, gross_amount, discount_amount, discount_reason, note, modifiers, modifier_amount }` |
| `discount_amount` / `discount_reason` | integer / string | **Order-level**, separate from line discounts |
| `subtotal` / `discount_total` | integer | Σ line gross; Σ line + order discounts |
| `service_charge_amount` / `tax_amount` | integer | Always `0` in v1 — see §6 |
| `total_amount` | integer | What the customer owes |
| `payments` | array | `{ payment_id, method, tender, amount, amount_received, change_given, provider, reference, status, received_at, received_by }` — see below |
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

**Not built:** per-outlet modifier pricing.

### Modifier stock relief — BUILT 2026-09-03

> Previously: *"a priced modifier moves revenue today but not COGS, so a
> heavily-modified menu overstates gross margin by the cost of the extras."*

An option now declares what it takes off the shelf:

```
options: [{ id, name, price_delta, consumes: [{ item_id, quantity }] }]
```

`quantity` is an **integer in the component's own base unit** — the same rule
`components` follows (items.md §2), because cost flows through
`quantity × unit_cost` into a journal amount and a fraction puts binary rounding
error straight into the ledger. Up to five components; the item drawer edits the
first and carries the rest through untouched.

**Empty is the normal case and stays free.** A sugar level or a spice preference
consumes nothing measurable, and forcing every option to name an ingredient
would make the common case pay for the rare one.

**Snapshotted onto the LINE, not looked up at relief time.** What the sale
consumed is copied the way `unit_price` and `item_name` are: editing the recipe
next week must not retroactively change what left the shelf on Tuesday.

`_resolveSaleConsumption` multiplies each option by the LINE quantity — two
lattes with an extra shot each take two shots — explodes a component that is
itself a composite, and **merges** an item reached twice into one movement (a
shot from the recipe plus a shot from the modifier is one movement of 2, not two
of 1). The arithmetic is identical either way, but a subledger listing the same
item twice on one sale reads as a bug.

⚠️ **`consumes` crosses FOUR explicit field lists** between the item and the
stock movement — `normalizeModifierGroups`, `getPosMenu`, `posModifierGroups` in
`pos.js`, and the `soldLines` map in `_emitPosSale`. Every one of them is a
whitelist, and a field missing from any is `undefined` at the far end with the
feature silently doing nothing. The last of the four was found only by tracing
the path: `_emitPosSale` mapped lines to `{ item_id, quantity }` and dropped
`modifiers` entirely, so the resolver would never have seen them.

No rules change: `items` has no `hasOnly` and `pos_orders.lines[]` is
DAL-validated (§7). Guard: `tests/modifier-cogs.check.js` — 16 assertions,
pure, unconditional in the BE lane.

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

### Product photos are optional, and never cropped (2026-09-02)

`items.image_path` → the menu card. Full rationale in
[`items.md`](items.md) §9; the two things that matter here:

- **The ratio is kept.** `object-fit: contain` in a fixed 4:3 tile — the image is
  scaled to fit, never stretched and never cropped, because on a menu the part
  `cover` cuts is often what identifies the product. `.pos-grid.has-images` gives
  every card the tile once any visible item has a photo, so a part-illustrated
  menu does not rag.
- **The till never receives a URL.** `image_path` is a storage path; the card
  resolves it through an authenticated read into a short-lived `blob:` URL. A
  download URL would be a permanent public link to the workspace's menu.

Loaded lazily via `IntersectionObserver` (one authenticated round trip each, paid
as the cashier scrolls) and falling back to the item's initials on any failure.

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

**`ready` is a real state** (added 2026-09-01, rules deployed and stamped):
cooked and waiting to be carried out. It exists because it is a different
person's problem — a plate under the pass going cold is the runner's, not the
cook's — and without it the board showed a 12-minute "in the kitchen" for food
that was done in four. It has the tightest SLA on the board (slow at 2 min, late
at 4): cold food is the failure, and the fix costs one person ten seconds.

Adding it touched **three** allowlists, and only one of them was in rules. The
other two are in `pos-service.js`, and the second is the dangerous one:
`getPosOverview`'s `openStatuses` decides which orders count as ACTIVE, so a
status missing from it does not error — the order simply disappears from the
board and the floor plan, and the table it is sitting at reads as free. When
adding a status, grep for every list that enumerates them.

### `amount` is what the BILL absorbed; `amount_received` is what was handed over

Added 2026-09-01, and the difference is money.

Until then the till sent the whole tender as `amount`, so a Rp150.000 note
against a Rp120.000 bill recorded `paid_amount: 150.000`. **`getPosShiftTally`
sums exactly that**, so the close expected the drawer to still hold the
Rp30.000 that had already been handed back. Every over-tender made the count
read SHORT by the change given, and the variance posted to `6700 Cash Over &
Short` as a loss.

The ledger was never wrong — revenue posts from `total_amount`, not from the
payments (§4). Only the cash reconciliation was, which is the one thing the
shift exists to do.

```
amount           min(tender, amount due)   what the bill absorbed
amount_received  what crossed the counter
change_given     amount_received − amount
```

Recorded rather than derived: the bill can be discounted or refunded later, so
"what did this customer actually hand over" stops being recoverable from the
totals the moment anything else moves.

`payments[]` has **no `hasOnly`** in `firestore.rules` (§7), so these three
fields needed no rules change and no deploy. The validation lives entirely in
`recordPosPayment`, which refuses a tender below the applied amount and refuses
any change at all on a non-cash tender.

### `settlement` and `tender` answer different questions

| Field | Question | Cash | Transfer | QRIS / Card |
|---|---|---|---|---|
| `settlement` | which ACCOUNT does it land in | `1000` | `1000` | `1030` |
| `tender` | did NOTES enter this drawer | yes | no | no |

Conflating them was the second silent bug of the same day. `getPosShiftTally`
read `settlement === 'cash'` for "cash in the drawer", so **every bank transfer
was counted as notes that ought to be in the till** — the blind count came up
short by the transfers taken and the variance posted as a loss, exactly as
above. A transfer really does settle to the same account as cash; what it does
not do is put anything in the drawer.

`other` is `tender: 'external'` deliberately. It is whatever is not one of the
four named methods, and a drawer count is the wrong place to discover that
assumption was generous — counting it as notes produces an unexplained
shortfall, not counting it produces an unexplained **surplus**, which is the
direction that gets investigated rather than absorbed.

### Payment is a modal, and every figure goes through the money seam

`openPaymentModal` uses the shared `.pos-modal-layer` (blurred navy scrim, 16px
card, pinned footer) rather than the side drawer: taking money is the one moment
the cashier must not be doing anything else.

Cash specifics: the bill is stated once and large, the tender is entered against
locale-correct formatting, CHANGE is the loudest thing after the bill (it is
what physically leaves the drawer), and a tender below the bill cannot be
confirmed as a completed payment.

**Amount received belongs to cash and only to cash.** On every other method the
field states the bill and is disabled — the provider moves the exact figure, and
nobody counts change out of a drawer for a card. It is disabled rather than
removed: a field that vanishes makes the dialog jump under a cashier's hand
mid-payment and leaves them wondering whether they missed a step.

**Change is always stated on a cash payment, including zero.** It used to appear
only when there was change to give, so "exact money" and "the screen has not
caught up with what I typed" looked identical — the two cases are
indistinguishable when the row is simply absent, and this is the moment a
customer is standing there waiting to be told. A short tender shows the
shortfall instead; "Rp0 to give back" beside an insufficient payment is true and
useless.

⚠️ Both of those were also load-bearing on a CSS fix: `.pos-change` and
`.pos-quick` are `display: flex`, and a class rule outranks the UA stylesheet's
`[hidden]` rule — so `el.hidden = true` on either did nothing at all, and the
change box sat on screen for every payment showing an empty value. `pos.html`
now carries `[hidden] { display: none !important; }`.

**A short tender is refused outright.** The first cut allowed it as an explicit
part payment to preserve split tender — cash + QRIS on one bill — but the
business confirmed it does not take split tender: on this floor a short amount
is a miscount, and the useful thing is to refuse it while the customer is still
standing there. The button is disabled and the shortfall is stated above it; a
dead button with no explanation is the worst of both. `recordPosPayment` still
accepts partial amounts, so this is a till rule rather than a lost capability.

Quick-cash amounts come from `FluxyMoney.cashSuggestions`, which reads the
currency's own banknotes — see `MULTI_MARKET_ARCHITECTURE.md` §2d.

### Tickets split at the kitchen; the bill does not

**This is the model, and it took two wrong turns to reach.**

| | |
|---|---|
| **Order** | A TICKET — a unit of kitchen work, with its own status and lifecycle |
| **Bill** | Every live order at the table, summed |

`qr-order` merges a round into the live order only while `open` or `submitted`
— both mean the till has not sent it yet, so four people still choosing produce
one ticket rather than four. **Once a cook has the order, a new round is a new
document.** A merged ticket cannot tell a cook which lines are new, so they make
the already-served ones again.

⚠️ **On 2026-09-05 `APPENDABLE` was widened to `sent`, `ready` and `served`, and
the order was reset to `submitted` so the board would notice the new lines.** The
reset is what made it dangerous: the ENTIRE order went back to the kitchen,
served dishes included. Reverted 2026-09-06 on Jay's correction, and guarded in
both directions by `check:qr-order` — the appendable set, and that appending
never writes `status`.

### The dining session is DERIVED, not stored

`qr-order-status` returns every order at the table that is neither paid, voided,
nor stale, plus one `session` total across them. That set **is** the active
dining session: paying one drops it out, paying all of them ends the session, and
the next party starts clean with no boundary to maintain.

Same call `pos_tables` makes about occupancy (§2): a stored session and the real
orders eventually disagree, and nothing would report it. It also answers the
session cases without a new collection — a first order paid and a second unpaid
leaves exactly the second outstanding, because the paid one is no longer live.

The diner sees each ticket with its own progress and ONE total; the CTA quotes
the session's outstanding, never the newest ticket's.

⚠️ **Splitting the ticket must never split what they owe.** That is the whole
point of the separation, and the spec that fails if the CTA ever quotes a single
ticket is `TICKETS SPLIT AT THE KITCHEN; THE BILL DOES NOT`.

### One table, one bill — and what nearly broke it

`APPENDABLE` matched only `open` and `submitted`, so **the moment the kitchen
moved a ticket to `sent`, a second round stopped matching**: the client was told
`sitting_ended`, retried without a sitting, and a whole new order document was
created for the same table. The visible symptom was a diner asked to settle two
bills for one unpaid meal.

The fix taken on 2026-09-05 — widen `APPENDABLE` to `sent`, `ready` and
`served` — was the wrong one, and is described above. **The right answer was
that the second document was correct and the second BILL was the bug.**

So both halves now hold:

| | |
|---|---|
| `qr-order` | a round past the kitchen opens its own ticket |
| `qr-order-status` | one `session` total across every live ticket |
| `qr-request-bill` | moves **every** live ticket to `awaiting_payment` |
| `tableStateAt` | reports `orders`, `orderCount` and the table's `outstanding` |
| `payPosTableBill` | settles a table's tickets as ONE bill, in one transaction |

⚠️ **A ticket's STAGE never decides whether it is on the bill.** #001 eaten and
#002 still frying are one meal to the person paying for them; only paid, voided
and stale drop out. All three endpoints share the same 12-hour window, pinned by
`check:qr-order`, or a diner is shown a bill one of them would refuse to act on.

⚠️ **`qr-request-bill` scanned only the first live ticket for a day.** The board
then showed #002 ready to pay and #001 merely `served`, so a cashier settling the
table settled the newest round and left the meal before it open — a short
payment nothing reports, because both documents are individually consistent.

⚠️ **The floor tile printed one ticket's total for the same reason.** A table
holding 50.000 and 30.000 showed whichever the array yielded; the cashier
collects that, the diner leaves, and the rest stays open on a table that still
reads occupied. `tableStateAt` now sums the table and the tile marks
"2 tickets", and `state` is `bill` if **any** ticket is awaiting payment — read
off one ticket, a table whose first round was already waiting painted as merely
occupied and the cue to walk over never appeared.

⚠️ **`awaiting_payment` closes the table to new orders, whoever is asking.** The
bill has been quoted and a cashier is walking over; silently growing that total
is worse than refusing. The check does not depend on the client's own sitting —
a second phone at the table would otherwise slip past it — and the refusal is
its own error (`bill_requested`, not `sitting_ended`) so the page can say *why*
rather than retry into another ticket.

⚠️ **"The kitchen has my ticket" is not "my sitting is over".** `qr-order` asked
whether the client's sitting was the *appendable* order, so from the moment a
cook picked up round one, round two came back `sitting_ended` — and the page's
retry re-sent it carrying **no sitting at all**, straight through the hole in the
guard built to close exactly that. The test is liveness now: a live sitting
continues, into the open ticket or into a new one of its own.

⚠️ **One sitting, one rate card.** A new ticket inherits `pos_pricing` from the
sitting's oldest live ticket, exactly as an appended round does. Reading live
settings would let an owner editing a rate mid-meal produce a table whose two
tickets are taxed differently — and the consolidated total then carries a single
percentage describing neither.

### Merge and split are ONE control (2026-09-06)

The diner's phone consolidated a table's tickets; the **till** did not. Two
rounds at one table were two cards, two totals and two Pay buttons, and the
cashier added them up in their head — the under-collection shape again, from the
third direction.

`payPosTableBill(userId, orderIds, {...})` settles a list of tickets as one
bill. The board shows a strip on every card whose table holds more than one live
ticket ("Table 6 · 2 tickets · Rp80.000 · Bill together"), which opens a dialog
listing them with a checkbox each.

**All ticked is a merge; unticking one is a split.** One mechanism, because two
would eventually disagree about what a payment does — and whatever is left
unticked is stated in words ("1 ticket (Rp30.000) stays open on this table"),
since a split bill that silently leaves a ticket behind is how a table walks out
owing money nobody mentioned.

⚠️ **It does not merge the ORDERS, and must never start to.** Each ticket keeps
its document, its kitchen status and its own journal. What is merged is the act
of paying: one tender, one change calculation, one receipt, N settled tickets.

⚠️ **ONE TRANSACTION.** Every ticket is written together or none is. A loop of
`recordPosPayment` would leave the cashier holding cash against a half-settled
bill with no record of the half that failed. Firestore requires every read
before any write, which is what the sequential `tx.get` loop is for.

⚠️ **THE ALLOCATION IS WHAT KEEPS THE DRAWER HONEST**, and all three sums matter:

```
Σ amount           = the bill      what revenue absorbs
Σ amount_received  = the tender    what crossed the counter
Σ change_given     = the change    what went back
```

`getPosShiftTally` sums the last two off the payments, so putting the whole
tender on every ticket — or the change on more than one — makes the close read
over or short by exactly the difference, with every document individually
consistent. Same defect `amount` vs `amount_received` fixed for a single order
on 2026-09-01, one level up. The change rides on the **last** ticket because it
is one physical handful of notes, not a share of each.

**One table, one outlet.** Sitting together is the proxy for "one party paying
one bill"; without it a mis-tap settles another table's food against this
customer's cash and both orders look correct afterwards. Takeaway is excluded
for the same reason — no table means nothing says two bags are one person.

`payments[].bill_id` ties the payments taken together, and `bill_orders` carries
the ticket ids beside it. On the payment, not on the orders: `payments[]` has no
`hasOnly` (§7) so it needs no deploy, and it is a fact about what happened rather
than a session entity that would then have to be kept true. The receipt folds
payments sharing a `bill_id` back into one row — without it a single Rp80.000
tender prints as two payment lines and two change figures on the customer's own
copy.

⚠️ **`bill_orders` exists because `bill_id` alone is ungroupable.** Firestore
cannot query inside an array of maps, so the key would name a set nothing could
ever resolve — and the reprint would hand a customer one ticket's slip for a bill
they paid in full. The reprint is **the whole bill or nothing**: a ticket it
cannot load refuses the print and says so, because `pos_orders` is never deleted
so a miss is a network or permission problem and one more tap fixes it. A
receipt that understates a settled bill is the document that exists to prevent
the argument, arguing the wrong side.

**The floor tile promises the table, so the tap delivers it.** Once the tile
started showing the table's outstanding and its ticket count, tapping a table
reading "Rp80.000 · 2 tickets" opened ONE ticket's panel showing Rp50.000 —
nothing errored, the cashier was simply handed a smaller number than the tile
they had just pressed. A table with more than one live ticket now opens the same
bill dialog the board's strip does; a table with one still lands straight on the
till. The dialog carries a per-row **Open** so adding to a round is not a dead
end — with `preventDefault`, since the button sits inside the row's `<label>` and
would otherwise toggle what the bill covers on the way out.

**The receipt is ONE bill, not two receipts stapled together.** All the lines in
one list — identical items folded together, on the same identity the kitchen
merges on, so two rounds that each had a Nasi print as one line of two — then
one subtotal, one service line, one tax line and one total. The tickets are the
KITCHEN's unit of work and the customer never had them; a section per ticket
asks the person paying to do arithmetic about a split they did not make. **Every
order number is stated in the header**, which is the only place the separation
is any of their business and what a cashier reads back when somebody asks about
one of them.

It sections per ticket in exactly one case: tickets whose rate cards disagree
about whether tax is INSIDE the menu prices, which puts the tax line above the
total on one and below it on the other. A second ticket inherits the sitting's
`pos_pricing`, so that cannot happen within a sitting any more — it survives for
bills opened before that rule existed.

Guard: `check:pos-table-bill` — 41 assertions, pure, unconditional in the BE
lane, driving the real method against a fake transaction that throws on a read
after a write. Board: five specs in `tests/pos-orders-board.spec.js`.

### Split by item (2026-09-06)

"I'll pay for my dish." The bill dialog has two readings of one table —
**Whole tickets** and **By item** — and both end in the same
`payPosTableBill` call with a different selection. `lines` is
`[{ order_id, line_ids: [...] }]`; absent, whole tickets settle as before.

⚠️ **A dish costs more than its menu price.** The share carries that ticket's
service charge, tax and order-level discount with it — charge the menu price and
the rest is left on the ticket with nobody paying it, and the table can never
settle. A Rp125.000 burger on a 5%/11% ticket is **Rp145.000** to pay for.

⚠️ **THE INVARIANT IS EXACTNESS, NOT FAIRNESS.** Split a 232.000 ticket three
ways and the three amounts must total 232.000 **to the rupiah**: short by one and
the last payer cannot close the ticket, over by one and they are charged for a
rupiah nobody owes — either way the order sits unsettled with the table still
reading occupied. Proportional rounding does not give you that (three thirds of
319.000 round to 106.333 and sum to 319.999), so `splitLineShare` allocates on
the **running total**:

```
amount = round(total × coveredAfter / all) − round(total × covered / all)
```

Each payment is the difference between two rounded cumulative figures, so the
errors cancel and the final selection takes exactly what is left — in any order,
for any partition. The **weight** is the line net of its own discount (a
half-price dish carries half the service charge); an order-level discount is not
a line's, so dividing into `total` spreads it across everyone. A ticket
discounted to nothing weighs each line as one, so the partition still adds up.

It lives in `pos-pricing.js` — pure, UMD, and the same module the dialog quotes
with. A dialog that adds up its own way is how a customer is quoted one number
and charged another.

**`payments[].line_ids` is the record of which dishes a payment settled.** Read
back by the next split to know what is left, and by the receipt. Two guards
follow from it:

- **A line is paid for once.** Without the check the same dish can be charged to
  two people and both payments look correct — the ticket over-collects and
  nothing reconciles it back.
- **A ticket cannot be part-paid both ways.** A whole-ticket payment says
  nothing about which items it covered, so a split after one has no way to know
  what is left and would charge for it again. Refused, not guessed at.

**The split's receipt is their items and what they paid**, never the table's
ticket — that states a figure they did not pay, to the person least able to
check it. It is not itemised further: the share is allocated across the
SELECTION, so a per-dish tax line would be inventing a split of a split.

Splitting does **not** move the kitchen ladder — someone paying for their
starter must not take the main course off the cook's screen.

### Split evenly (2026-09-06)

"Three ways." The third reading of one bill, and the same call again —
`payPosTableBill(..., { splitWays: N })` takes **one share** and is called once
per payer. Mutually exclusive with `lines`: a bill is split by item or by head,
and asking for both means the cashier has not decided which.

⚠️ **N shares must total the bill to the rupiah.** Rounding a share and
multiplying does not do it — three thirds of 319.000 round to 106.333 and sum to
319.999, a rupiah the table does not owe on a ticket that could then never
close. `evenSplitShare` uses the same running-total rule as `splitLineShare`, so
319.000 three ways is **106.333 + 106.334 + 106.333** and the last share is
exactly what is left, by construction rather than by a special case.

**The split is derived, not stored** — the same call `pos_tables` makes about
occupancy and `qr-order-status` makes about the sitting. `payments[].split_ways`
is the only thing recorded; the index counts distinct `bill_id`s among payments
carrying it, and the base is reconstructed as *outstanding + what those shares
took*. That is what lets an interrupted split — one paid, the dialog closed, the
next payer served ten minutes later — pick up at share 2 instead of restarting
and over-collecting.

⚠️ **The index counts BILLS, not payments.** One share can settle several tickets
at a table, so counting payments would make it look like more payers had been
through than actually had — the fourth person would be asked for nothing and the
table would never close.

⚠️ **A three-way split has three shares, even when the bill has moved since.**
All three pay, then somebody orders another drink onto the ticket: it is no
longer settled, so nothing upstream refuses, and a fourth "share of three" would
be handed out. The drink is a new bill, not a fourth third.

A share fills tickets **oldest first**, so tickets close as the money comes in
rather than every one sitting part-paid until the last payer arrives. Its receipt
prints the table's items and states *Bagian 2 dari 3* — the payer has no items of
their own, and a slip reading only "Rp106.334" says nothing about what for.

### Reaching the dialog

⚠️ **A single ticket could not be split at all.** The strip appeared only from
the SECOND ticket, so a party of three sharing one order — the commonest table
there is, and the one that actually says "we'll split this" — had no way to pay
separately. It now shows for one ticket carrying more than one dish, labelled
**Split bill** rather than *Bill together*, and the dialog opens on **By item**:
with one ticket "Whole tickets" is the Pay button again, and splitting is the
reason it was opened. A single ticket with a single line still gets no strip —
nothing to split, nothing to merge.

**And from the order panel**, which is where the cashier is standing when the
customer says it. Sending them to the Orders board to find the same dialog is a
detour they would take every time.

**Still not built: split by SEAT.** The units are the item and the head.

Guards: `check:pos-table-bill` (78 assertions — three splits totalling the ticket
in two different orders and three even shares totalling the bill, the last taking
the exact remainder, both double-charge refusals, and the bill-not-payment index
count) and five board specs.

### Payment status and order status are TWO STATES (2026-09-06)

```
Order status     open → submitted → sent → ready → served → paid
Payment status   unpaid → paid          (paid_amount vs total_amount)
```

⚠️ **They were one field, and paying moved both.** `recordPosPayment` wrote
`status: 'paid'` whatever the kitchen was doing — so on a merged bill the ticket
still in the pan went terminal the moment the customer paid: off the Kitchen
tab, off the floor plan's active set, and reading as **done** to the cook who
still had to make it. Reported by Jay hours after the merged bill shipped.

`status` now only reaches `paid` once the kitchen has finished **and** the money
is in. Until then the ticket keeps its own rung and carries a **Paid** badge
beside it — never instead of it, because a cashier reading one pill cannot tell
whether the food has gone out.

⚠️ **"The kitchen still has work" is PROFILE data, not a property of the
status.** A retail counter has no ladder at all: its orders live at `open` and
paying is the end of them. The first cut hardcoded the F&B statuses and left
every pay-first sale sitting `open` forever, receipt printed, sale never closed
(`tests/pos-pay-first.spec.js` caught it). The till passes its own
`posProfile().ladder`; absent, payment closes the order out, which is what every
caller did before. `awaiting_payment` is a **payment** rung, so `served` leading
there is not outstanding kitchen work.

**Everything that asked `status === 'paid'` had to be re-read as "settled".**
Each was silent in its own direction:

| Reader | If left on the status |
|---|---|
| `_emitPosSale` gate | revenue posts only when the food is served — never, if nobody closes the ticket |
| `emitUnpostedPosSales` | the retry never finds it |
| **`getPosShiftTally`** | the drawer count omits the bill, and the close reads SHORT — the variance posting to 6700 as a loss |
| `getPosOverview.todayPaid` | `salesToday` understates the till's own takings |
| `voidPosOrder` | a paid order could be voided, leaving posted revenue behind |
| `refundPosOrder` / reprint | a customer who paid and changed their mind while the food cooked could not be refunded |
| line editing | a settled bill could have a dish added to it |

`todayPaid` and `activeOrders` now **overlap** — a settled ticket the kitchen
still has is both a sale taken today and live work — so every caller that
concatenates them dedupes by id (`allBoardOrders`).

**The diner keeps watching their food.** `qr-order-status` dropped a ticket on
`paid_at`, which took a diner's own order off their phone the moment they paid
for it. A ticket leaves the sitting when the food has **arrived** and the bill is
settled — which is what `status === 'paid'` now means.

⚠️ **`paid` HAD NO WAY TO BE REACHED.** It is deliberately absent from
`setPosOrderStatus` — earned, not asserted — which was complete while payment
moved the ladder itself. Once payment stopped doing that, an order paid
mid-kitchen had no route to a terminal state at all: the till answered
`"paid" is not a status an order can be moved to here` and the ticket could not
be closed. `closePosOrder` is that route, and keeps `paid` earned by refusing
anything not settled. It emits nothing — `_emitPosSale` already ran at payment,
and `transaction_id` is the idempotency key either way. Audited as
`pos_order.closed`, not `.paid`: `_emitPosSale` already writes that one, and two
entries under one name for two different events is an audit trail that reads as
complete and is not.

**A paid ticket at the pass closes in ONE press.** From `ready` the button reads
**Serve & close** — the plate goes out and the ticket finishes together. Making
a runner press Serve and then Close out is busywork, and a board full of
served-and-paid tickets nobody closed is what makes `status` untrustworthy.

**No rules change.** `status != 'paid' || paid_amount >= total_amount` is a
one-way implication and still holds; the frozen-paid transitions simply engage
when the ticket closes out rather than at payment. The window in between is
protected in the DAL instead: void, edit and pay all refuse a settled order.

Guards: `check:pos-table-bill` (the kitchen keeps its status, the board's clock
does not restart on a ticket that did not move, and a counter with no ladder
still closes out) and two board specs.

### The visit total is three figures, never one

A settled order is money that has already changed hands. Folding it into "what
you owe" asks the customer to pay twice, and the ledger has a posted `POS-SALE`
saying they did not. So the Pesanan sheet states the visit as **ordered / already
paid / still to pay** rather than a single combined bill, and a visit with
nothing settled shows no summary at all — the order's own total already is it.

Guards: `check:qr-order` (the appendable set, the exclusion, and the kitchen
hand-back) and two specs in `tests/customer-ordering.spec.js`.

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

## 4a. `pos_reservations/{reservationId}` — a claim on a table in the future

Added 2026-09-01. The reason it lives here, beside the tables, rather than in a
calendar module of its own: **the moment a booking exists, the floor plan and
the Create Order dialog must stop offering that table.** A reservation the till
cannot see is worse than no reservation system at all — the table gets sold
twice and the party holding the booking is the one turned away at the door.

| Field | Type | Notes |
|---|---|---|
| `dimension_id` | string | Outlet. Immutable after create |
| `table_id` / `table_label` | string \| null | **Null is a real answer** — a booking taken before the host knows where it will sit holds NOTHING. Holding a table nobody chose loses floor capacity to a maybe |
| `guest_name` | string 1–80 | Required. The only field that is always answerable |
| `guest_phone` / `guest_email` | string ≤32 / ≤120 \| null | |
| `party_size` | int 1–999 | Whole people; rules refuse a fractional count |
| `starts_at` | Timestamp | When the guest is expected |
| `duration_minutes` | int 15–600 | The assumed sitting. Bounded both ways — see below |
| `source` | enum | `direct` \| `phone` \| `whatsapp` \| `website` \| `instagram` \| `walk_in` \| `other`. Reporting only; nothing branches on it |
| `status` | enum | `pending` \| `confirmed` \| `arrived` \| `completed` \| `cancelled` \| `no_show` |
| `order_id` | string \| null | The order opened when the party was seated |
| `seated_at` / `released_at` / `release_reason` | | The trail |
| `note` | string ≤200 \| null | |
| `version` | integer | Concurrency guard, as on orders and shifts |

### One rule, four callers

`assets/js/pos-availability.js` is a **pure module** — no Firestore, no DOM, no
`window` — and it is the only place that answers "can this table take someone".
It is imported by:

| Caller | What it asks |
|---|---|
| `renderTables` (floor plan) | paint every table's state |
| `openCreateOrderDialog` | which options to disable, and a re-check at submit |
| `createPosOrder` (DAL) | refuse a walk-in on a held table |
| the reservations board | refuse an overlapping sitting |

Two copies of "is this table free" is exactly how a reserved table ends up sold
on one surface and held on another. Being pure is also what lets
`tests/pos-availability.check.js` exercise every boundary of the hold window in
milliseconds instead of during service.

### The hold window

```
starts_at − 30 min          the table stops being sellable   (HOLD_BEFORE_MIN)
starts_at                   the guest is expected
starts_at + duration        the sitting is assumed over
```

**Thirty minutes before, not at the booked minute.** A table that only locks at
19:00:00 is a table somebody was seated at 18:55, and the party with the booking
arrives to find it holding a main course.

`pending`, `confirmed` and `arrived` hold. `completed`, `cancelled` and
`no_show` release — and those three are **the only ways a table comes back into
supply.** Each is a person's decision.

### Nothing expires on a timer

A booking past its time with nobody seated is **late**, and it *keeps its
table*. Auto-releasing is the tempting behaviour and the wrong one: the table
would free itself while the party is still walking from the car park, a walk-in
would be seated in it, and nothing would report what happened. Lateness is
surfaced on the board with the two actions a host actually takes — seat them
anyway, or mark a no-show — and a human releases the table.

The `duration_minutes` bounds are the same shape of guard from the other end: a
zero-minute sitting holds nothing, and a twelve-hour one takes a table out of
service for a whole service by typo. Both are silent.

### What rules can and cannot do here

⚠️ Worth stating plainly, because the gap looks like an oversight. **"This table
is already booked at 19:00" is a QUERY**, and `firestore.rules` can only `get()`
a document whose id it already knows — there is no way to express it at any
price. Double-booking is therefore refused in `savePosReservation` and in
`createPosOrder`, which makes it a **business rule, not a security boundary** —
the same honest standing per-outlet scoping has (§8).

That check is also read-then-write rather than a transaction (Firestore has no
cross-document uniqueness constraint, and a table is not a document that could
be locked), so two hosts booking one table in the same second can both succeed.
The board therefore **detects** overlaps and flags them rather than trusting the
check made them impossible.

What rules do guarantee: only this workspace's staff can write one, the guest's
own words are bounded, `version` advances by exactly one, a booking cannot be
created already seated, and none is ever deleted.

### The link is one-directional

The reservation carries `order_id`; the order carries nothing. `pos_orders` has
a `hasOnly` and is frozen once paid, so a back-reference would have meant
widening the key set on the document the money path runs through — real risk,
for a link that is one client-side lookup away.

Seating writes the order **first**: if the status write then fails, the party is
sitting at a table with an order open, which a person can see and fix. The other
order of operations loses the sale.

When the bill is paid the booking is closed out automatically (best-effort — a
failure to tidy the booking must never surface as a failed payment). Without
that, a seated reservation would keep holding its table for the rest of its 90
minutes after the guests had gone: free on the order side, held on the
reservation side, which is the same disagreement this feature exists to prevent,
pointing the other way.

### Deliberately not built

**Table utilisation %.** The reference design carries one; it needs a service
window and a turn count this product does not model, so the figure would be
plausible and wrong. "Tables held now" is the true version of the same question.

Also absent: waitlists, deposits and no-show charges (money, and therefore a
posting rule — none exists), guest history across bookings, SMS/WhatsApp
confirmations, and per-zone capacity limits. A reservation posts nothing to the
kernel: no value has moved until the party eats.

### Rules

Read = all member roles **plus `cashier`**. Create/update = finance+ and
`cashier` — they are who answers the phone, and a book only the owner can write
to is a paper diary with extra steps. **Never deleted**: a cancelled booking is
a fact about the evening, and deleting it hides the no-show it may have become.

Emulator coverage: `tests/pos-rules-emulator-test.mjs` (19 reservation cases).
Rule engine: `tests/pos-availability.check.js` (47 assertions, no emulator).
Page: `tests/pos-reservations.spec.js`.

## 5. `pos_table_directory/{token}` — top-level, deny-all

`{ workspace_id, table_id, dimension_id, revoked }`. `allow read, write: if false`
for every client including the owner.

A verbatim copy of `commerce_shop_directory`: the QR ordering function resolves
tokens Admin-SDK-side, so a guessed token cannot even confirm a workspace exists,
and **the customer surface costs zero rules budget because it never touches
Firestore.**

### It is populated by a reconcile (2026-09-02)

It shipped with rules and a design and **nothing ever wrote it**, so every QR
endpoint resolved through an empty collection — correct and unreachable.

`npm run sync:table-directory` (`scripts/sync-pos-table-directory.js`) projects
it from `pos_tables`. Dry-run by default; `--commit` writes.

| Table state | Directory |
|---|---|
| active, has `qr_token` | upsert `{ workspace_id, table_id, dimension_id, revoked: false }` |
| archived | **revoke** — the printed card stops resolving |
| token rotated | revoke the old entry, upsert the new one |
| active, no `qr_token` | mint one (`--commit`), or its QR can never exist |

Because it is a projection it is idempotent and can be rebuilt at any time.

**REVOKED, NEVER DELETED.** A deleted entry and a token that was never issued
are indistinguishable, so a re-issued token could silently resurrect a card
somebody printed and threw away. `revoked: true` is a fact the resolver can
refuse on, and `netlify/functions/qr-menu-image.js` does — pinned by
`check:qr-image`.

### Verified in production 2026-09-02

11 entries written across 23 workspaces (all tables already carried a token;
nothing to mint or revoke). The photo endpoint then resolved a real token end to
end: `HTTP 200 · image/png`, with an unknown item, a garbage token and a
traversal attempt each answering `404`.

⚠️ **`FIREBASE_SERVICE_ACCOUNT` is a PER-SITE Netlify variable, and the till does
not have it.** The same URL returns `302` on `dashboard.fluxyos.com` and
`fluxyos.com` and `404` on `pos.fluxyos.com` — `initAdmin()` throws, the catch
swallows it, and the refusal is indistinguishable from a bad token. When the
`order` site is created it MUST carry this variable or every menu photo will be
silently missing. It is deliberately not added to the till: that origin has no
use for this endpoint, and a service-account credential should not be on a site
that does not need one.

⚠️ **The reconcile is not the intended long-term mechanism.** The entry should be
written **when the QR is generated**: a code cannot exist in the world before
somebody generates and prints it, and that is a deliberate action which can call
an authenticated function. Registering there means no sync window and a
directory holding only tables whose codes are actually out there. Firestore
triggers are not an option — they are Cloud Functions, and this backend is
Netlify Functions, which are HTTP and cannot watch a collection.

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

## 7a. The audit trail was denied for eleven days

Every POS audit write was refused from 2026-08-21 (POS shipping) to
2026-09-02. `isValidWorkspaceAuditLog` in `firestore.rules` validates
`target_collection` against an allowlist, and **none of the four POS
collections were on it** — so all ten actions the DAL emits were denied:

```
pos_order.paid / .refunded / .voided
pos_shift.opened / .closed
pos_table.created / .updated / .layout_saved
pos_reservation.created  (+ every status transition)
```

`business_categories.seeded` was denied the same way.

**Nothing went red.** `_auditCreateBestEffort` catches and warns, which is the
right behaviour for an audit write — losing the log must never lose the sale —
and is exactly why it went unnoticed. The Activity Log simply had no POS
entries, which looks identical to nobody using the till.

The two that matter most in a finance product are the ones that were missing:
`pos_order.refunded` is money handed back out, and `pos_shift.closed` is the
cash count. **An audit trail with a hole in it is worse than none, because it
looks complete.**

Adding names costs no expression budget — `in [...]` is one expression however
long the list is — but `audit_logs` create is `isMember`, not a finance role,
which is what lets a **cashier** write them. They perform most of these actions,
so that is the boundary the emulator cases exercise.

Guards: `tests/pos-rules-emulator-test.mjs` (14 cases; verified they FAIL
against the pre-fix allowlist) and `tests/pos-audit-trail.spec.js`, which writes
against the **deployed** rules — the emulator proves the rule accepts the shape,
not that production does, and `firestore.rules` is a separate deploy from
`git push`.

⚠️ **When a new collection starts writing audit entries, add it here too.** The
DAL's call and the rules allowlist are one claim in two files, and the failure
mode is silent.

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

## 11. `pos_outlet_settings/{dimensionId}` — what an outlet charges

Added 2026-09-05, with the POS Settings page. **Keyed BY the dimension id**, so
an outlet cannot own two and nothing has to join.

Deliberately NOT fields on `dimensions`: that document is the ledger's reference
entity — `name_key` is immutable precisely because journal history resolves
through it — and a warehouse has no opening hours or VAT rate. Widening this
must never mean touching the validator the posting engine depends on.

| Field | Type | Notes |
|---|---|---|
| `dimension_id` | string | == the doc id. Rules enforce the match |
| `address` / `phone` | string ≤200 / ≤32 \| null | Shown on the customer's order page |
| `hours` | list ≤7 | One row per weekday: `{day, closed, open, close}`. `closed` is a real answer and the default |
| `cover_image_path` | string ≤300 \| null | A Storage PATH, never a URL — same rule as `items.image_path` |
| `tax_enabled` / `tax_label` / `tax_rate_percent` / `tax_inclusive` | bool / string ≤24 / number 0–100 / bool | |
| `service_enabled` / `service_rate_percent` / `service_taxable` | bool / number 0–100 / bool | `service_taxable` defaults TRUE |

⚠️ **The rates are bounded in RULES, not only in the form.** They multiply every
bill the outlet ever rings up, and a rate typed as `1100` instead of `11` does
not fail anywhere else — it produces a plausible, enormous, wrong number on a
receipt and a matching liability in the books.

⚠️ **`hours` is validated in the DAL and nowhere else** (`_normalizeOpeningHours`),
the same standing trade-off `lines[]` and `payments[]` make: rules cannot iterate
cheaply and this ruleset has exhausted the evaluation budget in production once.
Rules bound its SIZE, which is the part that protects the document.

### The rates are SNAPSHOTTED onto the order

`pos_orders.pos_pricing` is what the outlet's rates were when the order opened.
Read once in `createPosOrder` and frozen, for the same reason `unit_price` is
copied onto a line: an owner editing the rate at 8pm must not silently re-price
the bills already open on the floor, and a receipt printed an hour ago has to
stay reproducible.

**One key holding a map**, not five scalars — five would cost five more
expressions on the document the money path runs through. Its shape is owned by
`pos-pricing.js`.

An order with no snapshot — every order written before this — prices at zero,
which is exactly what it billed before.

### One pricing module, three callers

`assets/js/pos-pricing.js` is **pure** and **UMD**, because the client is ES
modules and Netlify Functions are CommonJS and this is the seam between them:

| Caller | Surface |
|---|---|
| `_posTotals` | the staff till |
| `qr-order` / `qr-menu` | the diner's own phone |
| the settings preview | what the owner is shown |

Two copies of "what does this bill come to" is how a customer is charged one
number and the books record another. `money-format.js` and
`netlify/functions/lib/format.js` are the same split kept as two files synced by
a comment — which is what this avoids.

⚠️ **Inclusive pricing EXTRACTS, it does not add.** When menu prices already
contain the tax, adding it again charges the customer twice; the tax is carved
out of what they were always going to pay, `total` is unchanged by the rate, and
`revenue` drops instead — correct, because in that mode part of the menu price
was never this workspace's money.

Guard: `tests/pos-pricing.check.js` (1,200 combinations, pure, unconditional in
the BE lane). Posting: `tests/pos-tax-service.check.js` — see §4.

## 12. `pos_discount_presets/{presetId}` — named, reusable discounts

So a cashier taps instead of typing an amount and a reason free-hand with a
customer waiting. **They change nothing about posting**: a preset produces the
same `discount_amount` + `discount_reason` an ad-hoc discount does, and still
lands as contra-revenue in 4900 (§4).

| Field | Type | Notes |
|---|---|---|
| `name` | string 1–40 | "Staff 20%", "Happy Hour" |
| `kind` / `value` | `percent` \| `amount` / int ≥1 | Percent capped at 100 in rules — over that hands money back on every sale |
| `scope` | `order` \| `line` | Which discount it can be applied to |
| `reason` | string 1–80 | What lands on the order. The till REQUIRES a reason; a preset supplies its own so the cashier is not deciding under pressure |
| `dimension_id` | string \| null | **Null means every outlet** |
| `status` | `active` \| `archived` | Archived, never deleted — a preset applied to real sales is a fact about those sales |
| `sort` | int | |
| `auto` | map \| null | **The seam for automatic rules** — happy hour, minimum spend. Null on every preset today, and deliberately unvalidated in rules so adding conditions later needs no rules change and no deploy |

### At the till

The discount drawer offers the applicable presets as buttons, filtered by
`scope` — an order-wide "Staff 20%" against a single latte would be a button
that does not do what its name says.

⚠️ **Tapping one FILLS the form; it does not submit it.** One tap is the point,
but that dialog already has an Apply button, and a preset that skipped it would
make that button a lie AND turn a mis-tap at a busy counter into money out of
the door under a reason nobody chose. It fills the amount (resolved through
`presetDiscountAmount`, so a percentage rounds identically on every surface) and
the **reason** — which is the actual point of a preset. A discount's reason is
the only record of why money was given away, and composing one with a customer
waiting is how "promo" ends up on a third of them.

Presets are cached per outlet (`state.presetsFor`), not re-read on every
`refresh()` — that runs on every snapshot from the live watcher.

### The total has to foot

Once an outlet charges tax or a service fee, `total_amount` moves away from the
subtotal. Both the till's totals stack and the printed receipt now show the
service and tax lines, labelled from the ORDER's own `pos_pricing` snapshot — so
a bill opened at 10% still says 10% after the rate is changed.

**Inclusive tax is stated AFTER the total, never as a line above it.** It is
already inside the prices, and adding it as a row would make the arithmetic look
wrong to the one person guaranteed to check: the customer holding the receipt.

### The entry point is the DASHBOARD, and only the dashboard

Settings → Operations → Point of Sale (`/settings-pos`). There is deliberately
**no link from the till**, and adding one was considered and declined
(2026-09-05).

1. The page is `['app']` in `PAGE_ROLES`, so the till build prunes it and
   `pos.fluxyos.com/settings-pos` 301s to the dashboard origin anyway.
2. **Writes are finance+.** A cashier READS the rates — the till cannot price a
   bill otherwise — but cannot change them, and `applyToPage()` routes a
   POS-only role straight to `/pos`. A link on the till would be dead for the
   person most likely to tap it.

Accepted cost: an owner standing at the till switches origins to change a rate.
That is a set-up decision rather than a service-time one, and orders already
open keep their `pos_pricing` snapshot either way.

### Rules for both

Read = all member roles **plus `cashier`**: the till must be able to price a bill
and offer the discounts, and a cashier is who is standing at it. Create/update =
finance+ only — rates are money and hours are a promise to customers, neither of
which is a floor-staff decision. Never deleted.

Both are registered in all **three** finance-collection registries
(`scripts/qa-run.js`, `.claude/hooks/qa-gate.sh`, `PROJECT_BACKGROUND.md` §4) and
in the `audit_logs` `target_collection` allowlist — added WITH the collections
rather than eleven days later, which is what §7a cost last time.

Emulator coverage: 14 cases in `tests/pos-rules-emulator-test.mjs` (124 total).

## 9. What is NOT built

Offline-first (v1 is online-only with a visible connection banner — the largest
honest limitation), kitchen display, split-by-seat and split-by-item (the unit
of splitting is the TICKET — see §3),
per-outlet menu pricing, QR ordering, payment providers, and any AI over POS
data. §15 of the plan sequences all of them.
