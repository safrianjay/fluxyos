---
status: current
updated: 2026-08-31
supersedes: nothing
source: audited against the codebase at `79ff8ac`
---

# POS by business type — audit, and the pay-first order flow

Two things, because the second is the first concrete piece of the first.

**Part A** audits the proposal to make POS business-type-aware (F&B / retail /
services) against what the code actually does today. **Part B** specifies the
**pay-first order flow** — the single change that separates a retail till from
an F&B one, and the one that can ship with no schema change and no rules deploy.

Read [`data-model/pos.md`](data-model/pos.md) first for the collections, and
[`POS_IMPLEMENTATION_PLAN.md`](POS_IMPLEMENTATION_PLAN.md) for the phase
sequencing this slots into.

---

# Part A — Audit

## A1. Verdict

The direction is right, and **more of the "shared POS core" already exists than
the proposal assumes**. The transaction engine, the posting rules, the inventory
relief and the capability seam are all already business-type agnostic.

What does *not* exist is most of what makes a retail till feel like one: barcode
scanning, product variants, customers, registers, and a tax model. Several of
those are listed in the proposal as shared core that merely needs re-pointing.
They are not built at all.

The proposal also contains one design instruction that would be a **regression**
if followed — see A4.

## A2. Already shared, already agnostic

| Capability | Where | Note |
|---|---|---|
| Capability gating by business type | `assets/js/feature-access.js` `FEATURE_RULES` | `allowCategories` / `allowCountries` / `allowEmails`. POS is **one array element** away from serving retail |
| `business_category` on the workspace | `workspaces/{id}.business_category` | `fnb`, `startup`, `technology`, `manufacturing`, `retail`, `services`, `other`. Mandatory at onboarding; `npm run check:structure` fails the build if the four files defining it disagree |
| Order document | `pos_orders` | Already **normalized**, with a `channel` seam (`staff` / `qr` / `connector`) designed for writers other than the first-party till |
| Payments, partial tender, change | `recordPosPayment` | No business-type knowledge |
| Receipt, void, refund | `openReceipt`, `voidPosOrder`, `refundPosOrder` | ⟂ business type |
| Cash drawer / shift / paid-in-out | `pos_shifts` | ⟂ business type |
| Revenue, COGS, refund posting | `POS-SALE`, `CM-ORDER-COGS`, `POS-REFUND` | ⟂ business type. `CM-ORDER-COGS` is *already* shared with marketplace orders |
| Outlet attribution | `dimensions` + `ledger_balances_by_dim` | ⟂ business type |
| Multi-site delivery | `PAGE_ROLES` in `scripts/prepare-deploy.js` | The `pos.fluxyos.com` split already exists. Proposal §12–13 are answered |

## A3. The retail order flow already works at the data layer

This is the finding that most changes the plan.

- `recordPosPayment` refuses exactly two things: an order that is already `paid`,
  and an order with no lines. **It has no status precondition.**
- `wsValidPosOrderUpdate` permits any value in the status enum with **no
  ordering constraint** — only `paid` is guarded, and only by the derived rule
  `paid_amount >= total_amount`.

So an `open` order can go straight to `paid` today. The F&B ladder —
`sent` → `served` → `awaiting_payment` — exists **only in `pos.js`'s
`advance()`**, walked via `STATUS[x].next`.

> It is UI workflow, not schema. That is why Part B costs no rules deploy.

## A4. One instruction in the proposal is a regression

The proposal's §8 asks for inventory behaviour to differ **by business type**:
retail relieves the SKU, F&B explodes a recipe.

That distinction is already implemented — and it is keyed off **the item's own
type, not the business category**:

```js
// db-service.js · _resolveSaleConsumption
const consumed = item.type === 'composite'
    ? Object.entries(explodeRecipe(byId, item.id, qty)).map(…)   // recipe → ingredients
    : [{ item_id: item.id, quantity: qty }];                     // stock item → itself
```

Item-driven is **more correct** than category-driven, and making it
category-driven would break real cases in both directions:

- an F&B business also sells bottled water, which is a stock item and must
  relieve itself;
- a retailer can sell a bundle, which is a composite and must explode.

**Do not make inventory relief category-aware.** Leave it keyed on `item.type`.

## A5. Listed as shared core, but not built

| Proposal says | Reality |
|---|---|
| "Customer selection" (§2) | **No customer on `pos_orders` at all.** And unlike `items` and `lines[]`, `pos_orders` **has a `hasOnly`** (`wsPosOrderKeys`) — so any new order field needs a rules change **and a deploy** |
| "Taxes" (§2) | `tax_amount` is hardcoded `0` by deliberate decision ([`pos.md`](data-model/pos.md) §6). Indonesian F&B owes regional **PBJT**, not PPN; booking gross as revenue overstates it ~9%. **Retail is a different regime.** This is the largest unbuilt financial question in POS, and it varies by business type *and by regency* |
| "Barcode scanning" (§4) | ~~stored and nothing scans it~~ **SHIPPED 2026-08-31.** A scanner is a keyboard: Enter in the POS search resolves an exact `items.barcode` match into the cart. The item drawer had no field for it either, so a code could not be taught — that is now there too |
| "Product variants" (§4) | Not built |
| "Returns" as distinct from refunds (§6) | Only `refundPosOrder` exists |
| "Register" (§5 Step 1) | `openPosShift` enforces **one open shift per outlet**. Two lanes at one store is a refused write today |
| KDS, appointments, staff, split bill, table transfer | None built |

## A6. Retail is not hypothetical, and the gaps are not evenly expensive

A building-supplies retailer is **already using the F&B till in production**
through the legacy `allowEmails` allowlist ([`feature-access.js`](../assets/js/feature-access.js)).
So the question is not whether retail can work on this engine — it demonstrably
does. The question is which gaps cost that business money.

| Costs money | Cosmetic |
|---|---|
| No barcode — slow, mis-keyed SKUs | "Tables" in the nav |
| Three pointless taps before every payment (Part B) | "Takeaway" wording |
| No registers — two lanes impossible | The floor plan |
| Tax regime unmodelled | "Select a table" vs "Scan a product" |

The proposal devotes §4, §5, §6 and §11 to the right-hand column. Invert that.

## A7. Recommended sequence

1. **Widen `allowCategories` to `['fnb', 'retail']`.** One line. It also closes
   the `allowEmails` decision open since 2026-08-30 — the allowlist exists only
   because `['fnb']` is *narrower* than it.
2. **`POS_PROFILE`** — a map keyed on `business_category` deciding which views
   appear, **which status ladder `advance()` walks**, and what the primary action
   says. Pure UI layer. No schema, no rules, no deploy. This is Part B.
3. ~~**Barcode**~~ (shipped 2026-08-31) → **registers** → **tax**, each its own
   scoped change. Barcode needed no rules deploy; registers and any customer
   field do.

**Non-goal:** category-driven inventory relief (A4).

---

# Part B — The pay-first order flow

## B1. The problem

Today every order walks the dine-in ladder, because that is the only ladder:

```
open ──"Send to kitchen"──▶ sent ──"Mark served"──▶ served
     ──"Request bill"──▶ awaiting_payment ──"Take payment"──▶ paid
```

That is correct for a restaurant: the customer eats, then pays. It is wrong for
every counter transaction — retail, takeaway coffee, a bakery — where **the
customer pays before they get the goods**. Those cashiers press three buttons
that mean nothing to them before they can reach the one that does, on every
single sale.

## B2. The flow

```
Shift open
    ↓
POS Home — empty cart
    ↓
Add items                      ← scan · search · tap. The cart IS an `open`
    ↓                            pos_order, exactly as today
┌─────────────────────────┐
│  Charge  Rp 125.000     │    ← ONE primary action, always visible,
└─────────────────────────┘      always showing the running total
    ↓
Payment drawer               method · amount tendered · change
    ↓
recordPosPayment
    ↓
paid_amount >= total_amount  →  status: 'paid'
    ↓
POS-SALE + stock relief + COGS      (same atomic batch, unchanged)
    ↓
Receipt opens
    ↓
Cart clears — next customer
```

## B3. What changes, and what does not

**Changes — all of it in `pos.js`:**

| Today | Pay-first |
|---|---|
| `advance()` walks `STATUS[x].next` | The profile supplies the ladder. Retail's is `open → paid`, so `advance()` goes straight to `openPaymentDrawer()` |
| `#pos-primary` reads "Send to kitchen" | Reads **`Charge Rp X`**, always |
| Paid order stays on screen; button reads "Close" | Reads **"New sale"** and clears — the same `advance()` branch, a different label |

**Does not change — and must not:**

- `pos_orders` schema. No new field, **no rules deploy**.
- `recordPosPayment`, partial tender, change calculation.
- `POS-SALE` / `CM-ORDER-COGS` / stock relief / the `transaction_id` idempotency
  stamp.
- The shift tally, refund and reprint paths.
- Voiding an unpaid order — that *is* the proposal's "cancel transaction".

## B4. Reachability after payment

A paid order currently **stays on screen** on purpose: it was the only route back
to Refund and Reprint, and clearing it immediately is how that button became
unreachable once already.

That constraint is now satisfied elsewhere — the Orders board's **Completed** tab
lists paid orders and `selectOrder` can open them (fixed 2026-08-31). So
pay-first may clear the cart the moment the receipt opens without losing the
refund path. **Verify the Completed tab lists the order before shipping this** —
if it ever regresses, pay-first silently strands every paid sale.

## B5. Edge cases

| Case | Behaviour | Action |
|---|---|---|
| **Partial payment** | `paid_amount < total_amount` → status `awaiting_payment`; primary becomes "Take remaining Rp Y" | Already correct. No new code |
| **Zero-total order** (100% discount) | `recordPosPayment` throws on `amt <= 0`, so the order **can never reach `paid`** and is stuck | ⚠️ Real gap. Decide: refuse a 100% discount, or add a zero-value settlement path |
| **Overtender** | Change is computed and shown in the drawer | Already correct |
| **Cancel mid-sale** | Void — unpaid only | Already correct |
| **Offline** | Online-only; the banner says so | Unchanged. Payment is recorded after money changes hands either way |
| **Two lanes at one outlet** | Refused — one open shift per outlet | Blocked until registers ship (A5) |

## B6. Explicitly out of scope: counter-service F&B

Pay-first for **F&B** — pay at the counter, *then* the kitchen makes it — is a
different problem and is **not** covered here.

It needs fulfilment to become an axis separate from payment, because a paid
order is **frozen** by rules: once `status == 'paid'` only the emission stamp and
the refund fields may change, so it can never afterwards be marked `served`.
That means a new field on `pos_orders`, which has a `hasOnly` — a rules change
and a deploy.

The version specified above works because **retail hands the goods over at the
counter, so there is nothing left to track**. Ship that first; sequence
counter-service F&B fulfilment as its own change with its own rules deploy.

## B7. Shipped 2026-08-31

Implemented as `POS_PROFILES` in `assets/js/pos.js`, with `allowCategories`
widened to `['fnb', 'retail']`. Coverage: `tests/pos-pay-first.spec.js`.

Two things learned building it, both worth keeping:

**`window.FluxyWorkspace` is published in STAGES.** `id` lands before the
profile read returns, so anything reading `businessCategory` right after waiting
on `id` gets `null` for a workspace that has one. Wait for `ready`. The first cut
of the spec captured a false "original" that way, and its restore — guarded by a
falsy check on that null — then skipped and left the QA workspace mis-stamped.
`if (original)` is the bug; restoring *absent* is a real state.

**A control that skips is a control that lies.** The F&B control originally
`test.skip`ped when it found the workspace still set to `retail` — reporting
green on precisely the leak it exists to catch. It asserts now.

## B8. Acceptance

- [ ] A retail workspace reaches payment in **one** press from a filled cart.
- [ ] An F&B workspace still walks the kitchen ladder, unchanged.
- [ ] The primary action states the amount that will be charged.
- [ ] A paid sale posts revenue, COGS and stock relief identically to today —
      diff a pay-first and a pay-last order's journals and they match.
- [ ] The cart clears after payment, and the sale is still reachable from the
      Orders board's Completed tab (B4).
- [ ] Partial payment still resolves to `awaiting_payment`.
- [ ] No change to `firestore.rules`; `check:deploy-stamp` stays green.

---

# Part C — Parking a sale (Hold / Resume)

## C1. The defect, verified

With a Rp20.000 cart open, pressing "New sale" today:

```
before  { title: "Takeaway", lines: 1, total: "Total Rp20.000" }
after   { title: "Takeaway", lines: 0, warned: false, toast: "" }
```

The cart is **silently abandoned**. It is not lost — it is still an `open`
document and reachable from the Orders board — but nothing on screen says so,
and the cashier has no reason to look. It is also where a workspace's pile of
stray open orders comes from.

## C2. Why it appears only now

**In F&B the table IS the parking slot.** Every dine-in order is attached to
one, so "park this and serve someone else" is walking to another table, and the
floor plan is the resume list. Retail has no tables, so with pay-first (Part B)
the cart has nowhere to go: the feature that was implicit became missing.

That is also what makes it cheap. **Every unpaid order is already parked** — an
`open` document that survives a reload, a crash and a shift change. This is an
affordance over data that already exists, not a new capability.

## C3. The flow

**Park.** The customer goes back for milk. Press **Hold**, optionally label it
("blue jacket", "Pak Budi"), the cart clears, the next customer is served.

**Resume.** A `Parked · 2` chip sits by the search. It opens the parked sales —
label, item count, total, age — and tapping one resumes it. The order-search
panel that already lists open orders becomes that list; it simply shows them
without a query typed first.

**The guard.** "New sale" with items in the cart PARKS the current one and says
so. Never discards.

## C4. Edge cases

| Situation | Behaviour |
|---|---|
| Hold an empty cart | Disabled — nothing to park |
| Hold a part-paid sale | Allowed. Payment is recorded; resuming shows the **balance**, not the whole bill again |
| Resume with another cart open | Auto-park the current one and say so. Never discard — that is the defect above |
| Paid on another device meanwhile | The `version` guard refuses the write; refresh and say it was already paid |
| Item repriced or hidden since parking | Already safe — the line carries the price copied onto it when added, never today's menu price |
| **Stock** | **Parking does not reserve stock.** Two carts may each hold the last unit; whoever pays first gets it. Correct, but say it or it becomes a surprise |
| Shift close with parked sales | The drawer count is still right (only paid sales count), but warn that N sales are on hold and not in it |
| Yesterday's holds | **Never auto-void** — that destroys a record. Show the age; let the cashier void it |
| Tab crash / reload mid-sale | The cart survives, but `state.orderId` is memory-only so today it looks lost. The parked list makes it findable — quietly the biggest win here |
| Void a parked sale | Already possible from the Orders board |
| Two lanes at one outlet | Out of scope until registers ship. Parked sales are outlet-scoped, so both lanes would see them |
| Dine-in | Hold is **pay-first only**. In F&B the table is the label, and a second parking concept would be two ways to do one thing |

## C5. Shipped 2026-08-31

`parkedSales()` / `parkCurrentSale()` / `openHoldDrawer()` in `assets/js/pos.js`,
`setPosOrderLabel` in `pos-service.js`. Coverage: `tests/pos-hold.spec.js`.

Three things learned building it:

**Do not refresh inside the park.** The label write wakes the live watcher, which
calls `refresh()` on its own — so parking also refreshing gives two overlapping
reads, one of them re-binding `state.order` from a copy taken while the order was
still selected. The cart the cashier just put down flickers back onto the screen,
intermittently. The updated document is already in hand, so the overview is
patched IN MEMORY and nothing is re-read.

**An empty order is not a parked sale.** It is residue from a cart someone opened
and walked away from. Listed, it makes the cashier read past noise to find the
one they put down — and resuming it looks exactly like losing their items.

**`selectOrder` returns silently when it cannot find the order.** The parked list
is a snapshot, so a sale paid or voided elsewhere since it was drawn leaves a row
that does nothing at all when tapped. Doing nothing is the worst available answer
— the cashier taps again. It now says so and re-reads the list.

⚠️ And a test-fixture rule, learned twice: when several specs flip the same
workspace field, capture the baseline ONCE for the file. Capturing per test means
the second one captures what the first left behind and faithfully restores THAT,
which perpetuates the leak and then fails a control for a reason that looks
nothing like the cause.

## C6. Cost

**No rules deploy.** `pos_orders.note` already exists, is already inside
`wsPosOrderKeys`, and the till has never written or read it — only LINE notes are
used. The hold label lives there.

⚠️ That reuse is worth knowing about: if an order-level note is ever wanted for
its own sake (a kitchen instruction for the whole ticket), it collides with the
hold label and one of them needs a new field — which, on this collection, means
a rules deploy.

Everything else is `pos.js`.
