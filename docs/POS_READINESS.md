---
status: current
updated: 2026-08-17
supersedes: nothing
source: grounded in the codebase as of `b03aca1`
---

# POS readiness — and why the first build is not a POS

Written after the inventory chain shipped (items → receiving → count → outlet
P&L, `b03aca1`). The ~15 F&B prospects require "POS **and** intelligent
inventory" (`INVENTORY_DEMAND_VALIDATION.md` §7). Inventory is now reachable.
This asks what POS actually costs, and finds that the question is mis-framed.

---

## 1. The finding

**FluxyOS already runs an order pipeline that posts revenue. It has never
relieved stock.**

`commerce_orders` ingests marketplace orders through Connector → Normalization →
Finance Mapping → Ledger, and four posting rules are live:

| Rule | What it posts |
|---|---|
| `CM-ORDER-REV` | Dr Marketplace clearing / Cr Revenue |
| `CM-ORDER-FEE` | Dr Fee expense / Cr clearing |
| `CM-ORDER-REFUND` | Reverses revenue |
| `CM-SETTLE` | Dr Bank / Cr clearing |

There is **no `CM-ORDER-COGS`**, and no order has ever written a
`stock_movements` row. Every marketplace sale books revenue at full margin and
leaves inventory untouched — the same defect the F&B prospects are describing,
in a pipeline that is already shipped and already carrying paying customers.

The join was designed for this and is already built: order lines normalize to
`[{ sku, name, quantity, unit_price, subtotal }]`
(`netlify/functions/lib/commerce/models.js:62`), and `items.sku` is documented as
"**the join to `commerce_orders.items[].sku`**" (`data-model/items.md` §1). Step 2
of the inventory chain put the key in place; nothing has turned it yet.

---

## 2. What this reframes

> **POS is not a new module. It is one more connector into an existing pipeline,
> plus one missing capability that pipeline needs anyway.**

The missing capability is **per-sale stock relief and COGS**: given an order
line, resolve the SKU to an item, explode it if it is a recipe, relieve stock at
weighted-average cost, and post `Dr 5100 / Cr 1200`.

That capability is worth building **on commerce orders first**, before any till:

1. **It serves the current customer base immediately.** `PROJECT_BACKGROUND.md`
   §1 records the base as "strongest in e-commerce and agencies". Those customers
   have orders flowing today and gross margins that are wrong today. No POS is
   required for them to benefit.
2. **It validates the hardest part without hardware.** Recipe explosion at sale
   time, rounding once per movement, and SKU→item resolution are where per-sale
   costing actually gets difficult. None of that needs a cash drawer.
3. **It is the upgrade `INVENTORY_DEMAND_VALIDATION.md` §7 already sequenced** —
   "POS integration then upgrades accuracy from periodic to per-sale". The
   periodic count shipped; this is the named next rung.
4. **POS is "Mixed" among the 15** (§7): some run a till, some do not. Per-sale
   costing built on the order pipeline serves whichever front end eventually
   feeds it.

---

## 3. The admission tests

**§5 — five verbs.** A POS **creates** revenue and **moves** stock. Passes on the
first verb; no argument needed.

**§5a — the six connection questions**, answered for *per-sale costing* (the
capability), not for a till:

| Question | Answer |
|---|---|
| Operational problem | A sale leaves the building without its cost leaving the books |
| Financial data generated | Quantity and cost of goods that left, per line, per outlet |
| Accounting records affected | `Dr 5100 COGS / Cr 1200 Inventory`, plus a `stock_movements` row per line |
| Dependent modules | Item master (SKU join), recipes (explosion), dimensions (which outlet) — **all shipped** |
| Insight produced | True gross margin per item, per outlet, per channel — the figure §7 says owners care most about |
| AI action enabled | Reorder points, margin erosion alerts, waste-vs-theft discrimination |

It names its posting rule, which is §5a's actual bar. A **till** — drawer,
shift, cash reconciliation — has to answer these separately, and does not yet.

**§6 — the ledger is the product.** A POS is a *source system*: it emits
documents and owns a posting rule. It must not keep its own books, its own stock
figure, or its own revenue total.

---

## 4. What per-sale costing costs

Small, because the parts exist.

| Piece | State |
|---|---|
| Order lines with SKU + quantity | **Shipped** (`commerce_orders.items[]`) |
| SKU → item resolution | **Shipped** (`items.sku`, unique at create) |
| Recipe explosion | **Shipped** (`explodeRecipe`, cycle-safe, merges shared ingredients) |
| Weighted-average unit cost | **Shipped** (`unitCostOf`, derived from movements) |
| Stock movement writer | **Shipped** (same batch as the journal) |
| Dimension on the posting | **Shipped** (`buildJournal` stamps `document.dimension_id`) |
| `CM-ORDER-COGS` posting rule | **Missing** — one rule |
| Movement rows per order line | **Missing** — one loop in the commerce writer |

**No new collection.** Which matters: `firestore.rules` is at **199,701 bytes,
92% of the usable ceiling**, with ~18KB of headroom. Adding a `pos_*` collection
family would spend a large part of that; extending the existing pipeline spends
none.

### The one genuinely hard decision

**What happens when a sale outruns stock.** A marketplace order can arrive for an
item with no recorded cost, or more quantity than the subledger believes is on
hand. The options are not equivalent:

- refuse the posting → an unpostable order blocks the sync pipeline
- post revenue with zero COGS → silently overstates margin, the current defect
- post at zero cost and flag → honest, visible, needs a review surface
- allow negative stock at last known cost → keeps margin sane, lets the
  subledger go negative

This is the decision that should be made deliberately and written down, because
every option is wrong in some circumstance and the failure is invisible in three
of the four.

---

## 5. What an actual till would additionally need

Deliberately separated, because it is a different size of problem and should not
be smuggled in behind "per-sale costing".

- **Offline-first.** A till that stops selling when the internet drops is not a
  till. That is a local queue and a conflict model, not a form.
- **Shifts and the cash drawer.** Open float, paid-in/paid-out, blind close,
  over/short posted somewhere real. This is the part that is genuinely new
  accounting.
- **Payment mix.** Cash, QRIS, card, e-wallet each settle differently — QRIS and
  cards land T+1 through a clearing account, exactly as `CM-SETTLE` already does.
- **Hardware and certification.** Printers, drawers, scanners; and in Indonesia,
  whether the till must issue a compliant receipt.
- **Rules budget.** Shifts and payments plausibly need their own collections. At
  92% of ceiling, that trim is a **prerequisite**, not cleanup — and there is no
  free trim left (0 unreferenced helpers as of `b03aca1`); it would mean
  collapsing create/update validator pairs, which is real work with real risk.

**A realistic reading: FluxyOS should integrate with the tills these prospects
already run before it considers building one.** §7 already says the same thing —
"Prospects asking for POS and inventory are not asking us to become a POS
vendor."

---

## 6. Recommended sequence

1. **Per-sale COGS on `commerce_orders`.** One posting rule, one movement loop,
   one written-down decision about overselling. Serves existing paying customers
   immediately and needs no till.
2. **Validate with the current base** — do the marketplace sellers' gross margins
   become right? That is checkable against real data we already hold.
3. **A POS *connector*** for whichever till the F&B prospects actually run
   (Moka, Majoo, Olsera, Pawoon). By the commerce platform's own design a new
   connector is "`connectors/` + a registry loader line + its env vars — nothing
   else changes".
4. **Only then** consider a first-party till, and only if the connector route is
   demonstrably insufficient.

**Before step 1**, the outstanding gate was: nobody has walked the inventory
chain on real data. `scripts/seed-fnb-demo.js` exists for exactly that.

**Gate closed 2026-08-21.** The chain was driven end to end through the real UI
— every screen opened, every screenshot looked at — rather than through
DataService. The kernel specs were all green and the console was clean, and it
still turned up three defects no spec was asking about: a blank reorder point
stored as `0` (so the Overview and Restock reported 78 and 27 items for the same
population), a tab badge whose `hidden` class lost on specificity and rendered
an empty pill, and `Net` sitting 38px off the right edge of Outlet P&L behind a
scroll nobody looks for. All three were user-visible; none was detectable from
the assertions that existed. Walking it is what found them.
