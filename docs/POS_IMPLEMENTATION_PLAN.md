---
status: current
updated: 2026-08-21
built: Phase 0 + Phase 1 shipped 2026-08-21 (see POS_READINESS.md §7)
owns: [pos scope, pos data model, pos posting rules, qr ordering architecture]
supersedes: POS_READINESS.md §6 step 1 (shipped 2026-08-20) — §5 and §6 steps 3–4 stand
source: grounded in the codebase as of `53532d6`
---

# POS — product scope and implementation plan

> **Read first:** `PRODUCT_STRATEGY.md` §5/§5a/§6, `POS_READINESS.md`,
> `INVENTORY_DEMAND_VALIDATION.md` §7, `data-model/stock.md`,
> `data-model/items.md`, `data-model/dimensions.md`.
>
> This plan does not introduce a new architecture. It adds **one operational
> document** to a pipeline that already ingests orders, relieves stock, posts
> COGS, and attributes both to an outlet.

---

## 0. What changed, and the one disagreement worth stating

`POS_READINESS.md` (2026-08-17) argued the first build should not be a POS. Three
things have happened since, and they close the gate it set:

| Gate | State |
|---|---|
| Per-sale stock relief + COGS on a real pipeline | **Shipped** — `CM-ORDER-COGS`, `1cc8b8b`, 2026-08-20 |
| Recipes authorable without a script | **Shipped** — recipe editor, `53532d6`, 2026-08-21 |
| Inventory chain walked end-to-end on real data | **Done** — `POS_READINESS.md` §6, gate closed 2026-08-21 |

So the capability that document wanted built *instead of* a POS exists and is
proven. The open question is no longer "POS or per-sale costing" — it is
`POS_READINESS.md` §6 **step 3 (a connector) versus step 4 (a first-party till)**.

### The disagreement, stated once

`POS_READINESS.md` §5 and `INVENTORY_DEMAND_VALIDATION.md` §7 both recommend
integrating with the tills prospects already run before building one, because POS
is **"Mixed"** among the 15 blocked F&B prospects — some run a till, some do not.
A first-party terminal directly serves only the no-till subset.

**This plan builds the terminal anyway, and is shaped so that choice costs
nothing if it turns out to be wrong:**

> `pos_orders` is a **normalized order document**. The first-party terminal is
> merely its first writer. A Moka / Majoo / Olsera / Pawoon connector later writes
> the same document, and every downstream consumer — payment, stock relief, COGS,
> revenue, outlet P&L, AI — is shared.

Choosing the terminal first does not foreclose the connector. It builds the half
the connector would need regardless. And the terminal is the only surface QR
ordering can attach to, which no third-party till will give us.

**One assumption to validate before Phase 1 code:** of the ~15 prospects, how many
run no till at all? If the answer is two, this sequencing is wrong and the
connector should lead. That number lives in the founder's pipeline, not the
repository — same blind spot `PRODUCT_STRATEGY.md` §5b recorded for inventory.

---

## 1. POS product scope

### The admission tests

**§5 — five verbs.** A POS **creates** revenue and **moves** stock. Passes twice.

**§5a — the six connection questions:**

| Question | Answer |
|---|---|
| Operational problem | Sales originate in the room and reach the books aggregated, delayed, and stripped of the line detail that makes menu-level COGS possible |
| Financial data generated | Per-line quantity, gross price, discount, tax and settlement type, per table, per outlet, at the minute it happened |
| Accounting records affected | `POS-SALE` (Dr Cash **or** 1030 Clearing, Dr 4900 Discounts, Cr 4000 Revenue, Cr tax payable) and the **already-shipped** `CM-ORDER-COGS` (Dr 5100 / Cr 1200) via a `stock_adjustments` row |
| Dependent modules | Items + recipes (explosion), stock movements (relief), dimensions (which outlet), Tax Center (PB1/PPN), Outlet P&L, Fluxy AI |
| Insight produced | True gross margin per menu item, per outlet, per hour — and discount and void behaviour, which nothing currently sees |
| AI action enabled | Menu-mix and margin-erosion analysis, prep-quantity forecasting from real sales curves, discount and void anomaly detection |

**§6 — the ledger is the product.** POS is a **source system**. It emits documents
and owns posting rules. It keeps **no** revenue total, **no** stock figure, and
**no** period concept of its own. See §7.4 for the one place this rule bites in
the UI.

### In scope — v1

Table management · staff order entry · order lifecycle · manual payment capture ·
per-outlet association · sales records · revenue and COGS posting through the
existing kernel.

### In scope — later phases, designed for now

QR customer ordering · payment provider integration · AI intelligence.

### Out of scope, v1 — deliberately

| Not building | Why |
|---|---|
| **Offline-first operation** | A local queue plus a conflict model is a distributed-systems problem, not a form. v1 is online-only with an explicit connection banner (§18.1). This is the single largest honest limitation of v1 |
| **Cash drawer, shift open/close, blind close, over/short** | Genuinely new accounting (`POS_READINESS.md` §5). Phase 1.5, specced separately |
| **Hardware** — printers, drawers, scanners | Receipt is a browser print / share sheet in v1 |
| **Kitchen display system** | Purely operational, generates no financial event. Deferred, not banned — it is what makes a POS usable in a real kitchen and will be asked for |
| **Split-by-seat billing** | Split-by-amount ships in v1; per-seat allocation is a different data model |

### Out of scope, permanently

**Table reservations** — `PRODUCT_STRATEGY.md` §5 names it explicitly as failing
every verb. A POS that manages tables will attract this request; the answer is no.
**Staff scheduling** unless it drives labour-cost postings. **Loyalty programmes**
are a §5 boundary case (contra-revenue liability) and go to the co-founders, never
silently into the backlog.

---

## 2. MVP feature list (Phase 1)

Ordered by build sequence, not importance.

1. **Outlet selection.** Reuses `dimensions` where `type == 'outlet'`. No new concept.
2. **Menu.** Reuses `items`. An item is on the menu when `sales_price` is set and `pos_visible` is true. A `composite` carries a recipe and therefore a real cost; a `stock` item (bottled drink) carries its own.
3. **Table management.** Create / rename / archive tables per outlet; live status grid.
4. **Open an order** on a table, or as takeaway with no table.
5. **Order entry.** Add item, change quantity, remove line, per-line note, order note.
6. **Discounts.** Per-line and per-order, amount or percent, with a required reason. Stored separately from price — never as a reduced price (§18.4).
7. **Order lifecycle.** `open → sent → served → awaiting_payment → paid`, plus `void`.
8. **Payment capture.** Cash, bank transfer, manual QRIS, other. Partial payments supported; `paid` is only reached when the balance is zero.
9. **Void and refund**, both requiring a reason and both auditable.
10. **POS overview.** Open tables, active orders, awaiting payment, orders and gross recorded today.
11. **Receipt.** Print / share, itemised, with tax shown separately.
12. **Posting.** On `paid`, emit the source documents; the existing sweep journals them.

**What is NOT on this list, on purpose:** analytics, charts, forecasting, best
sellers, an AI panel. `PROJECT_BACKGROUND.md`'s Overview already carries the
company-level charts, and the brief is explicit that a v1 POS dashboard must not
be overloaded. The POS overview answers *"what is happening in this room right
now"* and nothing else.

---

## 3. Staff POS flow

```
Sign in → POS → pick outlet (remembered per device)
   │
   ├─ Table grid ─────────────────────────────────────────────┐
   │   Available · Occupied · Awaiting payment                │
   │                                                          │
   ├─ Tap an available table → open order                     │
   ├─ Tap an occupied table → its active order                │
   │                                                          │
   └─ Order screen                                            │
        add / change qty / remove / note / discount           │
        Send to kitchen        → status: sent                 │
        Mark served            → status: served               │
        Request bill           → status: awaiting_payment     │
        Take payment ──────────────────────────────────────►  │
             method · amount tendered · change                │
             partial payment allowed, balance shown           │
             balance = 0 → status: paid, table freed          │
                    │                                         │
                    ▼                                         │
        EMISSION (one atomic batch)                           │
          transactions{source:'pos', accounting_status:'pending'}
          stock_adjustments{adjustment_type:'sale'}
                    │
                    ▼
        postPendingJournals  →  POS-SALE  +  CM-ORDER-COGS
```

**Design constraints for this screen**, from `DESIGN_SYSTEM.md`:

- Built for **speed under one thumb**. Hierarchy must hold at **375px** — that is
  the primary target here, not a responsive afterthought. The table grid and order
  screen are the first surfaces in this app where mobile is the design case.
- **One primary action per zone.** On the order screen that is the single
  advancing action (Send / Serve / Bill / Take payment), whose label changes with
  status. Never two equal-weight buttons.
- Money in `Inter` `tabular-nums`, `Rp1.234.567`, no space after `Rp`.
- Status carries **text**, never colour alone.
- No orange backgrounds. Status uses the semantic scale already in
  `shared-dashboard.css`.
- Reuse `fluxy-table*`, `FluxyDateRangePicker`, the shared dialog and the custom
  select. Build no page-local equivalents.

---

## 4. Customer QR ordering flow

```
Customer scans the QR on Table 12
        ▼
order.fluxyos.com/t/{token}          ← static page, no Firebase SDK at all
        ▼
GET /api/v1/order/menu?t={token}
   function resolves token → pos_table_directory → {workspace, outlet, table}
   returns ONLY: outlet name, table label, menu (id, name, price, description)
        ▼
Customer builds a cart in localStorage      ← nothing is written server-side yet
        ▼
POST /api/v1/order/submit {t, lines[], idempotency_key}
   • every item_id verified to belong to this token's workspace and be pos_visible
   • EVERY PRICE RE-READ SERVER-SIDE from items.sales_price — client prices ignored
   • creates or appends pos_orders{channel:'qr', status:'submitted'}
   • returns an order_ref (a second random token)
        ▼
Staff POS shows the order live (onSnapshot) with a "New QR order" alert
        ▼
Staff confirms → status: sent.  Staff may edit or reject before confirming.
        ▼
GET /api/v1/order/status?t={token}&o={order_ref}   ← customer polls
   returns ONLY: status, their own lines, their own total
        ▼
Payment: staff-recorded (v1) or provider-webhook-confirmed (Phase 5).
         The customer NEVER marks an order paid.
```

### What the customer surface can never do

Read another table's order · read any total but their own · see cost, stock,
margin, or any other order's existence · apply a discount · void · mark paid ·
learn the workspace id · reach Firestore at all.

**Staff confirmation is a security control, not a nicety.** A QR code is
photographable and works from the car park. Confirmation is what binds a submitted
order to a person actually sitting at the table.

---

## 5. Payment flow

`Unpaid → Partially paid → Paid`, with `Refunded` and `Cancelled` as terminal
branches. **An order is never paid because it was created.** Payment is an
explicit, separately recorded event, and `paid` is a *derived* state: it is
reached only when `Σ payments.amount ≥ total`.

```
        ┌─────────── unpaid ───────────┐
        │                              │
   record payment                    void
        │                              ▼
        ▼                          cancelled  (no posting, ever)
  Σ < total → partially_paid
  Σ ≥ total → paid ──► EMIT ──► POS-SALE + CM-ORDER-COGS
        │
        └─ refund ──► reverse journals, reverse stock relief
```

Every payment is a record — `{method, provider, amount, reference, received_at,
received_by, status}` — appended to `pos_orders.payments[]`. **Manual is a
provider** (`provider: 'manual'`), not a special case. That single decision is
what makes Phase 5 additive rather than a rewrite (§11).

---

## 6. Accounting: when POS touches the ledger, and when it must not

> **An open order posts nothing.** A voided order posts nothing. Only a **paid**
> order emits.

The brief asks to separate operational events from accounting truth. The
architecture supports this directly, and the codebase has already decided how:

```js
// netlify/functions/lib/commerce/finance-map.js:47
// Journals are posted later by the existing client sweep
// (postPendingJournals) — the bulk-import precedent. Never post here.
```

**There is exactly one posting implementation, `accounting-engine.js`, and it runs
client-side.** POS follows the commerce precedent exactly: write the source
document with `accounting_status: 'pending'`, let the sweep journal it. This is
also what makes the cashier role safe (§9.2).

### The posting rules

**`POS-SALE` — one new rule.** A multi-line journal, because a POS sale genuinely
has four economic parts and flattening them destroys the discount signal §14 needs:

```
Dr  1000 Cash            (cash settlement)     ─┐ one or the other,
Dr  1030 Payment Gateway Clearing (non-cash)   ─┘ per settlement type
Dr  4900 Sales Discounts & Returns             (discount total, if > 0)
    Cr  4000 Revenue                           (GROSS line total)
    Cr  2xxx Tax payable                       (PB1 / PPN, if configured — §18.7)
```

Both `1030` and `4900` already exist in `CHART_OF_ACCOUNTS_SEED`. `4900` is
contra-revenue (`type: 'revenue'`, `normal_balance: 'debit'`, `parent_code: '4000'`)
— exactly the shape a discount needs.

Non-cash settlement then clears through **the existing `CM-SETTLE`** (Dr Bank /
Cr 1030) when the provider pays out, identically to a marketplace payout. Its
description string reads "Marketplace payout" and should be generalised.

**COGS — zero new rules.** `selectRule` already routes
`stock_adjustments{adjustment_type: 'sale'}` → `CM-ORDER-COGS`
(`accounting-engine.js:576`). POS writes that document; the shipped rule journals
it. The rule's *description* says "Marketplace cost of goods" and needs to become
source-aware or source-neutral — a one-line change, but a user-visible one on
every accounting drill-down.

**Refund** reverses via the existing `reverseJournal` path, which already carries
`dimension_id` forward (`data-model/dimensions.md`).

### Revenue recognition

Revenue is recognised **on payment**, not on service. For dine-in F&B these differ
by minutes inside one period, so the difference is immaterial — *except* for an
order served and never paid. That is precisely why an abandoned order must be
explicitly **voided or written off**, never left open. Unposted-order age is a
surfaced metric (§16), not a background assumption.

---

## 7. Data model

### 7.1 What already exists — the reuse table

This is the core of the plan. Almost nothing is new.

| Concept | Where it lives | State |
|---|---|---|
| Outlet | `dimensions` where `type == 'outlet'` | ✅ shipped |
| Menu item | `items` (`composite` for a dish, `stock` for a bottled drink) | ✅ shipped |
| Recipe / BOM | `items.components[]` + `explodeRecipe` | ✅ shipped |
| Unit conversion | `toBase` / `fromBase` | ✅ shipped |
| Weighted-average cost | `unitCostOf`, derived from movements | ✅ shipped |
| Stock relief on sale | `stock_adjustments{adjustment_type:'sale'}` | ✅ shipped |
| COGS journal | `CM-ORDER-COGS` | ✅ shipped |
| Non-cash clearing + payout | `1030` + `CM-SETTLE` | ✅ shipped |
| Discount account | `4900 Sales Discounts & Returns` | ✅ shipped |
| Per-outlet P&L | `ledger_balances_by_dim` → `getOutletPnL` | ✅ shipped |
| Refresh-after-write | `window.FluxyDataSync` | ✅ shipped |
| **Menu price** | new field `sales_price` on `items` | **new field** |
| **Table** | `pos_tables` | **new collection** |
| **Order + lines + payments** | `pos_orders` (embedded arrays) | **new collection** |
| **QR token → workspace** | `pos_table_directory` (deny-all, top-level) | **new, ~50 bytes** |
| **Revenue journal** | `POS-SALE` | **new rule, no new collection** |

**Two new workspace collections. One new posting rule. One new field. That is the
whole data cost.**

### 7.2 New fields on `items`

`sales_price` (integer Rupiah, nullable), `pos_visible` (bool), `pos_category`
(string ≤40 — "Makanan", "Minuman"), `pos_sort` (integer).

⚠️ **Verify before relying on this.** `data-model/items.md` §5 records that the
`items` validator uses explicit field checks **with no `hasOnly`**, so new fields
pass without a rules change. That property is load-bearing here and is *not*
shared by `transactions`/`bills`/`subscriptions`, which do use `hasOnly`. Confirm
it still holds at implementation time; if `hasOnly` was ever added, an unlisted
key is `permission-denied` **for the whole write**, not a silently dropped field.

**`pos_order_id` on `transactions` DOES need a rules edit** — `wsValidTxCreate`
and `wsValidTxUpdate` both use `hasOnly` (`firestore.rules:2681`, `:2717`). Two
list entries, ~34 bytes. Do not smuggle it through the existing
`commerce_order_id`: that field is validated by `isValidCommerceLink` and
overloading it would make every commerce query silently include POS rows.

### 7.3 `pos_tables/{tableId}`

| Field | Type | Notes |
|---|---|---|
| `label` | string 1–40 | "12", "A3", "Bar 2" |
| `dimension_id` | string | The outlet. **Required** — a table without an outlet cannot attribute its revenue |
| `seats` | integer ≥1 \| null | Display only |
| `zone` | string ≤40 \| null | "Lantai 2", "Teras" — groups the grid |
| `qr_token` | string 43 | 256-bit random, base64url. **Never a sequential id** (§18.9) |
| `status` | enum | `active` \| `archived`. Soft archive only |
| `sort` | integer | Grid order |
| `created_at` / `updated_at` | Timestamp | Server-set |

Table *occupancy is not stored here.* It is derived from whether an open
`pos_orders` doc references the table — the same principle as stock on hand being
summed rather than cached (`data-model/stock.md` §5). A stored status and a real
order will eventually disagree, and nothing would report it.

### 7.4 `pos_orders/{orderId}`

| Field | Type | Notes |
|---|---|---|
| `order_number` | string | Human reference, per outlet per day (`KMG-2026-08-21-014`) |
| `dimension_id` | string | Outlet. Flows onto every journal line via `stampDimension` |
| `table_id` / `table_label` | string \| null | Null for takeaway |
| `channel` | enum | `staff` \| `qr` \| `connector` — the seam that lets a Moka connector write this doc |
| `status` | enum | `open` \| `submitted` \| `sent` \| `served` \| `awaiting_payment` \| `paid` \| `void` |
| `lines` | array | `{ line_id, item_id, item_name, quantity, unit_price, gross_amount, discount_amount, discount_reason, note }` |
| `discount_amount` / `discount_reason` | integer / string | **Order-level.** Separate from line discounts |
| `subtotal` | integer | Σ line `gross_amount` |
| `discount_total` | integer | Σ line discounts + order discount |
| `tax_amount` / `tax_code` | integer / string \| null | §18.7 |
| `service_charge_amount` | integer | §18.8 |
| `total_amount` | integer | What the customer owes |
| `payments` | array | `{ payment_id, method, provider, amount, reference, status, received_at, received_by }` |
| `paid_amount` | integer | Σ settled payments. `paid` requires `≥ total_amount` |
| `version` | integer | Bumped on every write. Concurrency guard — §18.2 |
| `opened_at` / `paid_at` / `voided_at` | Timestamp | |
| `void_reason` | string \| null | Required when `void` |
| `transaction_id` / `stock_adjustment_id` | string \| null | The documents this order emitted. **Idempotency key** |
| `created_by` / `updated_by` | string | uid |

**Lines and payments are embedded, not subcollections.** You always want the whole
order at once and always change it as a unit — the same call `items.components[]`
and the commerce order lines made (`data-model/items.md` §3). Invoices went the
other way because their lines are separately queryable; order lines are not.

**Orders are mutable while open and effectively immutable once `paid`.** After
`paid`, rules permit only `refund`-related field changes. Correction is by refund,
never by editing a paid order — the same discipline journals have.

**Idempotency carries no separate flag.** `transaction_id` being set *is* the
record that this order has emitted. Re-running emission is a no-op. Same principle
as `relieveCommerceCogs`, which uses the movement's `source` rather than a flag on
an immutable order (`data-model/stock.md` §4b).

### 7.5 `pos_table_directory/{token}` — top-level, deny-all

`{ workspace_id, table_id, dimension_id, revoked }`. Written only by the Admin SDK,
read only by the Admin SDK. `allow read, write: if false` — ~50 bytes of rules.

This is a **verbatim copy of `commerce_shop_directory`** (`firestore.rules:3643`),
which resolves an external shop id to a workspace for webhook delivery. Same
problem, same shape, same proven security property: the mapping is invisible to
every client, so a guessed token cannot even confirm a workspace exists.

Why a directory rather than a collection-group query on `pos_tables.qr_token`: O(1)
`get` instead of a query, no composite index, and no risk of a rules change ever
making tokens listable.

### 7.6 The `§6` consequence in the UI

The POS overview shows **"Sales recorded today"** — a sum over `pos_orders`. The
dashboard shows **Revenue** — a sum over the ledger. These are different numbers
until posting runs, and a product with two revenue figures is exactly what §6
forbids.

The resolution is labelling, not a second calculation: the POS figure is
explicitly *operational* ("recorded at the till"), carries the count of orders not
yet posted, and links to `/revenue-overview` for the accounting figure. An
unposted count above zero for more than a day is an alert, not a footnote.

### 7.7 Rules budget

`firestore.rules` is **199,709 bytes** against the `RULES_CEILING = 218_000` in
`tests/deploy-stamp.check.js` — **91.6%, with 18,291 bytes of headroom.**

| Item | Estimate |
|---|---|
| `pos_tables` block | ~600 B |
| `pos_orders` block (status transitions are the expensive part) | ~1,400 B |
| `pos_table_directory` deny-all | ~50 B |
| `pos_order_id` in two `hasOnly` lists | ~34 B |
| `cashier` in existing role lists | ~120 B |
| **Total** | **~2.2 KB — 12% of remaining headroom** |

> ⚠️ **Measured after building it: ~10KB, not 2.2KB** — `firestore.rules` went
> 199,709 → 209,981 bytes (96% of ceiling, ~8KB left). The 31-key order validator
> and the comments were both under-counted here. The customer-facing surface did
> cost nothing, as predicted; the estimate was simply too low for the rest. **A
> trim is now a prerequisite for the next collection, not a "plan one".**

This fits, and it fits *because* the customer-facing surface adds nothing (§10)
and because four capabilities reuse shipped collections. `POS_READINESS.md` §5
warned that "a `pos_*` collection family would spend a large part of that" — true
of a family, not of two collections.

**Two hard constraints on writing those blocks**, both learned the expensive way:

1. **Never iterate `lines[]` in rules.** Line validation lives in `db-service.js`,
   exactly as it does for `goods_receipts` and `stock_adjustments`
   (`data-model/stock.md` §6).
2. **Lean per-transition validators.** The rules evaluation budget has been tripped
   in production before — the invoice `open → paid` transition, 2026-07-14. Use the
   `isValidInvoicePaidTransition` pattern: one small validator per transition, not
   one large one that evaluates every branch. Keep emulator test docs ≤10 keys.

Before Phase 1 merges: run `npm run check:deploy-stamp`, and remember that
`firestore.rules` **does not ship with `git push`** — it needs
`firebase deploy --only firestore:rules`, a verification spec against the deployed
rules, and `npm run deploy:stamp`.

---

## 8. Backend / API architecture

Two distinct backends, because they have two distinct trust models.

### 8.1 Staff POS — no backend

The staff terminal is an authenticated app page using `DataService` and
`firestore.rules`, like every other app page. No API. This is not a shortcut: it
inherits workspace scoping, role enforcement, the audit log, the posting sweep,
and `FluxyDataSync` for free, and adds no new attack surface.

**One documented exception: `onSnapshot`.** `shared-dashboard.js:3538` records a
deliberate decision *against* live listeners, on the grounds that "live listeners
on transactions/bills/invoices would multiply reads on every open tab for a
problem that is really 'refetch after a write I already know about'."

POS is the case that rationale does not cover: a QR order is a write the staff tab
does *not* know about. The exception is therefore narrow and must stay narrow —
**one listener, one query** (`pos_orders` where `dimension_id == outlet` and
`status` in the open set, for today), on the POS page only. Log it under the
`DESIGN_SYSTEM.md` Exception Protocol with this rationale.

### 8.2 Customer ordering — Netlify functions, Admin SDK only

Three public endpoints. The customer **never** touches Firestore and **never**
authenticates.

| Endpoint | Returns |
|---|---|
| `GET  /api/v1/order/menu?t=` | outlet name, table label, menu (id, name, price, description, category) |
| `POST /api/v1/order/submit` | `{ order_ref, status }` |
| `GET  /api/v1/order/status?t=&o=` | that order's status, lines, total |

This is not a new pattern. It is **exactly** how `submit-contact-sales.js` handles
anonymous public writes today:

```js
// netlify/functions/submit-contact-sales.js:5
// There is NO Firebase Auth on this endpoint (the visitor is anonymous), so the
// Admin SDK is the ONLY writer — firestore.rules deny all client writes to
// sales_leads, which keeps the public collection spam-proof.
```

Consequences, all of them good:

- **No anonymous Firebase Auth.** No new identity type, no orphan auth accounts, no
  token lifecycle to reason about.
- **Zero rules budget on the customer path.** Isolation is enforced in one function
  that resolves a token to exactly one workspace, not in a rules block that must be
  correct for every possible client query.
- **The multi-tenant boundary is one code path**, reviewable in full, testable
  without an emulator.
- Route registration mirrors the commerce webhook lines already in
  `deploy/_redirects.app` — the ordering routes go in `deploy/_redirects.order`.

### 8.3 Payment webhooks — Phase 5

Mirrors `commerce-webhook.js` line for line: thin receiver, fat worker. Verify the
provider HMAC **against the exact raw bytes** (`event.isBase64Encoded` honoured,
never `JSON.parse` before verification), resolve merchant → workspace through a
deny-all directory, log the delivery under a **deterministic doc id** so a
redelivery dedupes, enqueue a job, return 200 fast. A nightly reconcile backstops
lost deliveries.

---

## 9. Security model

### 9.1 Threat model — what is actually new

Everything in FluxyOS today is behind Firebase Auth and `hasRole`. POS adds two
genuinely new things: **an unauthenticated write path**, and **a staff role that
must not see finance**.

| Threat | Control |
|---|---|
| Token enumeration → read another business's menu | 256-bit random tokens; deny-all directory; no listable collection; uniform 404 for unknown/revoked |
| Order spam / cost attack via public endpoint | **Rate limiting — does not exist anywhere in this codebase today. Must be built (§18.10).** Per-token, per-IP, and per-workspace daily caps |
| Price tampering | Every price re-read server-side from `items.sales_price`. Client prices are ignored, never validated-then-trusted |
| Cross-tenant item injection | Every `item_id` verified to belong to the token's workspace before the write |
| Off-premises ordering from a photographed QR | Mandatory staff confirmation; per-table open-order caps; token rotation per table |
| Replay / double-submit on flaky mobile data | `idempotency_key` → deterministic doc id, the `commerce_webhook_logs` pattern |
| **Staff-token theft via the ordering page** | **The reason for a separate origin — §10** |
| Cashier reads the P&L | New role, narrow grants — §9.2 |
| Cashier posts an arbitrary journal | Cashier has **no** write access to `journals` or `ledger_balances`; posting runs in a finance session — §6 |

### 9.2 The `cashier` role — a real gap

`perms-service.js` defines `ROLES = ['owner','admin','finance','accountant','viewer']`.
**Every one of them is a finance role.** There is no role for a waiter, and
`viewer` is in the read list of essentially every finance collection — so granting
a waiter `viewer` would hand them the ledger.

`cashier` is therefore new, and it is defined by what it *cannot* do:

| Can | Cannot |
|---|---|
| Read `pos_tables`, `pos_orders`, `items`, `dimensions` | Read `journals`, `ledger_balances`, `bank_accounts`, `transactions`, `invoices`, `bills`, any report |
| Create / update `pos_orders` | Delete anything |
| **Create-only** `transactions` + `stock_adjustments`, constrained by rules to `source == 'pos'` and `accounting_status == 'pending'` | Read them back, or write `journals` / `ledger_balances` |

Create-without-read is what makes this safe: a cashier appends the accounting
emission and can never inspect, aggregate, or alter the books. The operational
figures they legitimately need come from `pos_orders`, which is theirs.

**Three things this breaks that must be handled, not discovered:**

1. A cashier signing in lands on `/dashboard`, which reads collections they cannot
   read — a wall of `permission-denied`. `applyToPage()` must route a cashier
   straight to `/pos`, and `sidebar-loader.js` must render a POS-only sidebar.
2. `settings-team.html` must offer the role, and `ROLE_META` must describe it in
   both languages.
3. Adding a role to `ROLES` without adding it to any `hasRole` list means an
   existing member's page silently fails on the collections it was never granted.
   Enumerate the grants; do not infer them.

**Per-outlet scoping is a v1 UI guard, not a security boundary.** The POS page
queries only the selected outlet, but rules enforce workspace + role, not outlet.
A cashier calling `DataService` directly could read another outlet's orders. This
is the same honest distinction `feature-access.js` documents for itself, and it is
stated here rather than implied. Enforcing it in rules needs a member-doc field
read per evaluation — feasible, but check the evaluation budget first, and treat
it as Phase 3.

---

## 10. Domain / infrastructure recommendation

### The recommendation

> **Phase 1: no new infrastructure and no new domain.** The staff POS is an app
> page on `dashboard.fluxyos.com`, classified in `APP_PAGES`.
>
> **Phase 2, when QR ordering ships: a third `SITE_ROLE`, `order.fluxyos.com`,
> on the same Netlify account, the same Firebase project, and the same Firestore.**
> Separate origin. Shared backend and data. **Never separate infrastructure.**

That is: **separate domain + shared backend**, arrived at in two steps so nothing
is built before it is needed.

### Why not simply a path on the app site

This is the tempting answer and it is wrong for one specific, non-theoretical
reason.

**Firebase persists the signed-in owner's refresh token in IndexedDB, keyed by
origin.** If the customer ordering page is served from `dashboard.fluxyos.com`, any
script-injection on that page — a menu item named with a payload, a dependency, a
mistake — runs in an origin that can read the *owner's* Firebase credentials out of
IndexedDB and exfiltrate them. That is full workspace compromise from a page whose
entire threat model is "strangers point phones at it".

A separate origin makes that impossible by browser policy rather than by review
discipline. Everything else below is a supporting argument; this one is sufficient
on its own.

### The full evaluation

| Criterion | Same origin | **Separate origin, shared backend** | Separate infrastructure |
|---|---|---|---|
| **Security** | Shared IndexedDB with staff tokens — unacceptable | Origin isolation by browser policy | Same benefit, far more cost |
| **Authentication** | Customer must be kept out of an auth-carrying origin | No auth on that origin at all | Same |
| **Customer access** | `dashboard.fluxyos.com/order?t=…` reads wrong to a diner | `order.fluxyos.com/t/{token}` — short, scannable, obviously not a login | Same |
| **Performance** | Ordering page inherits the app's heavy CSP and shared cache | Ships a minimal page, its own cache, its own budget | Same |
| **Scalability** | QR traffic spike shares the dashboard's edge | Isolated traffic profile | Same |
| **POS reliability** | A scraper on the public path degrades the dashboard | Blast radius contained to the ordering site | Same |
| **Multi-tenant isolation** | Enforced identically in both — one function, one token resolution | Same | Same |
| **Firestore** | One database either way | **Same database.** A second would fork the data architecture — §6 forbids it | **Forks the data model. Disqualifying** |
| **Backend API** | Same functions | **Same functions directory**, routed per role | Duplicate deploy, duplicate secrets, duplicate Admin SDK |
| **Payment integration** | One webhook receiver either way | Same | Two places to verify HMACs |
| **Deployment** | One site | `prepare-deploy.js` already does exactly this pruning for two roles — a third is a page list plus `_redirects.order` | New pipeline, new env, new rollback story |
| **Monitoring** | Mixed signals | Public-surface errors separated from app errors | Two dashboards |
| **Future expansion** | — | `api.fluxyos.com` can be split out later without moving pages | Premature |

### Why the incremental cost is genuinely small

`scripts/prepare-deploy.js` is already a role-driven pruner: it deletes the other
role's pages, installs `deploy/_redirects.<role>`, and writes role-specific headers
— and is a **no-op when `SITE_ROLE` is unset**, which is what keeps local dev,
Playwright, deploy previews and rollback working. Adding `order` means:

- an `ORDER_PAGES` list (one page) and a third branch in the existing classifier
- `deploy/_redirects.order` — the three API routes, everything else 404
- an `_headers` with a **much tighter CSP** than the app's: `default-src 'self'`,
  `connect-src 'self'`, **no** `gstatic`, **no** `googleapis`, **no** Firebase
  origins, `frame-ancestors 'none'`
- `noindex`, disallow-all robots
- the existing guard extended: `node tests/prepare-deploy.check.js` must fail on an
  unclassified page across **three** lists, not two

The ordering page loads **no Firebase SDK at all**. That is checkable in CI and is
the strongest single invariant in this plan.

### What we are explicitly not doing

**No separate Firebase project, no second Firestore, no separate Netlify account.**
The brief's `api.fluxyos.com` is a fine eventual shape but is not needed: functions
are already routed by path from both sites, and splitting the API to its own origin
now would add a CORS surface for zero benefit. Revisit if and when a non-web client
(a native till app) appears.

---

## 11. Payment provider integration — Midtrans / Xendit

### The abstraction, and why it already exists here

`netlify/functions/lib/commerce/registry.js` defines a connector contract and lazy
per-platform loaders, so that adding a marketplace is "one file + a registry loader
line + its env vars — nothing else changes". **Payments get the identical
structure**, `netlify/functions/lib/payments/`:

```
POS order → PaymentService → registry.get(provider) → midtrans | xendit | manual
```

```js
// Provider contract
{
  id, displayName, requiredEnv: [...],
  createCharge({ order, method, amount, idempotencyKey }),  // -> { providerRef, status, payUrl?, qrString? }
  verifyWebhook({ headers, rawBody, url }),                  // -> { ok, merchantId?, eventType? }
  parseWebhookEvent(rawBody),                                // -> { providerRef, status, amount, occurredAt }
  normalizeStatus(raw),                                      // -> pending|settled|failed|expired|refunded
  refund({ providerRef, amount, idempotencyKey })
}
```

`isConfigured(provider)` gates on env vars exactly as the commerce registry does,
which is what makes activation a deploy-and-set-env operation rather than a code
change.

### Manual is a provider

`provider: 'manual'` implements `createCharge` as an immediate local settle and
`verifyWebhook` as "never called". Every downstream consumer — the order state
machine, the posting rules, reconciliation, the AI — is written once against the
provider interface. **This is the decision that makes Phase 5 additive.** Writing
manual payment as a special case and adding an abstraction later is the rewrite the
brief asks us to avoid.

### The five hard parts, addressed

| Concern | Approach |
|---|---|
| **Idempotency** | Deterministic doc id from `{provider}_{providerRef}`. Redelivery overwrites identically. `createCharge` sends an idempotency key derived from `{order_id, payment_id}` so a retried charge cannot double-charge |
| **Status sync** | The webhook is authoritative; the client never sets `settled`. A poll-on-open fallback covers a dropped webhook, and a nightly reconcile is the backstop — the `commerce-reconcile.js` shape |
| **Failed / expired** | A failed payment leaves the order `unpaid` and is retryable. It **never** produces a journal. Only `settled` emits |
| **Refunds** | Reverse the sale journal via `reverseJournal` **and** reverse the stock relief with an opposing movement. A refund that reverses revenue but not COGS silently inverts gross margin — the mirror of the defect `CM-ORDER-COGS` fixed |
| **Reconciliation** | Non-cash settles through `1030`, whose balance **is** the unsettled float. A provider payout posts `CM-SETTLE` and clears it. A `1030` balance that stops trending to zero means payouts are not landing — the same signal `2050 GRNI` gives for receipts |

### Ordering note

Midtrans and Xendit both require a registered merchant, a signed agreement, and
production credentials that take real calendar time. **Start that paperwork during
Phase 1**, not at the start of Phase 5.

---

## 12. Inventory integration strategy

### The MVP must run without it

A POS sale posts revenue whether or not the item has a recipe. Cost relief is a
**separate document** (`stock_adjustments`), written in the same batch but
independently valid. An item with no recipe and no cost simply produces no COGS
row.

**This must be visible, never silent.** A menu item selling with zero cost inflates
gross margin exactly the way marketplace orders did before `CM-ORDER-COGS` — the
defect this codebase has already been bitten by once. The POS overview carries a
**"Menu items with no cost basis: N"** signal, and the item drawer says so at the
point of authoring.

### The chain, all of which is shipped

```
Menu item (items, composite)
   → explodeRecipe → stock items + gross quantities   [shipped, cycle-safe]
   → unitCostOf → weighted-average cost               [shipped, derived not stored]
   → stock_adjustments{adjustment_type:'sale'}        [shipped]
   → stock_movements rows, one per component          [shipped]
   → CM-ORDER-COGS: Dr 5100 / Cr 1200                 [shipped]
```

`DataService.relieveCommerceCogs` already does exactly this for marketplace orders.
**The POS path should call the same function**, generalised from
`commerce_orders`-shaped input to a normalized line array. Reimplementing it would
create the second costing implementation §6 forbids, and the two would drift
silently on rounding.

### Three inherited decisions, all already made

- **Rounding once per movement.** `explodeRecipe` returns fractional requirements
  on purpose; rounding happens once when a movement is recorded, so per-component
  error cannot accumulate across a recipe (`data-model/items.md` §3).
- **Overselling relieves anyway, at last known cost.** The goods left; a wrong
  subledger is a data problem, not a reason to misstate COGS. Stock goes negative
  so the gap is visible (`data-model/stock.md` §4b). Already decided, already
  surfaced on `inventory.html`.
- **Retail is the same model.** A `stock` item with a `sales_price` and no
  `components` relieves itself one-for-one. No separate retail path.

### Where periodic counting still fits

Per-sale relief does not retire the count sheet. Counts now measure **theoretical
vs actual** — the gap between what the recipes say was consumed and what physically
left. That gap is waste, theft, or over-portioning, and it is a number an F&B owner
has never been able to see. This is a *Phase 4 insight*, and it is the strongest
single argument for POS + inventory together.

---

## 13. Outlet architecture

Already built. `dimensions` (`type: 'outlet'`) plus the
`ledger_balances_by_dim` rollup plus `/outlet-pnl` all ship, and `buildJournal`
stamps `dimension_id` from the source document onto every line it produces.

**What POS must do:** carry `dimension_id` on the order, and propagate it to both
emitted documents. `transactions` and `stock_adjustments` already allow the field.
Nothing else is required for per-outlet revenue, COGS, margin, and P&L.

**What POS closes.** `data-model/dimensions.md` records the open asymmetry:
stranded revenue makes an outlet look worse than it is; stranded **cost** makes it
look better, and that is the dangerous direction because it keeps a losing outlet
open. POS revenue is dimensioned from the first write, so it never joins the
"Unassigned" bucket. **Invoices remain the outstanding gap** — unrelated to POS,
still worth fixing.

**What POS needs that does not exist:** an outlet-management screen. Today outlets
are created from the receive-stock drawer and renaming or archiving is DAL-only.
A POS makes outlets a daily concept for non-finance staff, so Phase 1 should add a
minimal outlet list to Settings. Small, and currently missing.

---

## 14. AI integration roadmap

**Not before Phase 6.** `PRODUCT_STRATEGY.md` §3 is blunt that Layer 4 intelligence
is only as good as the Layer 2 books, which are only as true as the Layer 3
operations feeding them. AI over a week-old POS with unposted orders and
zero-cost menu items would produce confident nonsense.

The gate is measurable, not editorial. AI turns on when, for 30 consecutive days:
unposted orders older than 24h = 0; menu items with no cost basis = 0; and
`1200 Inventory` ties to `Σ stock_movements`.

Then, in order of increasing claim strength:

| Tier | Capability | Reads |
|---|---|---|
| **Describes** | Best/worst sellers, menu mix, peak hours, outlet comparison | `pos_orders` + `ledger_balances_by_dim` |
| **Explains** | Margin by item and why it moved — price, cost, mix, or discount. Requires the four-part journal (§6) | Journals + `stock_movements` |
| **Detects** | Discount and void anomalies by staff member; theoretical-vs-actual gap (§12); payment mix drift | Derived balances |
| **Predicts** | Prep quantities from real sales curves; reorder timing; outlet contribution forecast | All of the above |

**Fluxy AI reads derived balances; it does not recompute.** `PRODUCT_STRATEGY.md`
§5 puts predict-and-explain modules on the read side, and
`FLUXY_AI_DATA_READ_PATH.md` plus `npm run check:ai-scope` already exist to keep
that honest — including the workspace-scoping trap that made the AI answer Rp0 for
recent weeks in 2026-07.

The framing that matters: **AI explains the financial impact of POS activity.**
"Nasi Goreng is your top seller" is a report. "Nasi Goreng is your top seller and
your third-worst margin because chicken cost rose 22% and the price did not" is the
product.

---

## 15. Implementation phases

Each phase is independently shippable and independently valuable.

### Phase 0 — Foundations (before any POS UI)

Rules blocks for `pos_tables` / `pos_orders` / `pos_table_directory`, deployed and
**verified with a spec against deployed rules**, then `npm run deploy:stamp`. The
`cashier` role end to end (rules, `perms-service.js`, `ROLE_META`, team settings,
sidebar, `applyToPage` routing). `sales_price` / `pos_visible` on `items` plus the
item-drawer fields. A minimal outlet manager in Settings. `POS-SALE` in
`accounting-engine.js` with unit tests. Generalise `relieveCommerceCogs` to accept
a normalized line array. Rename the `CM-ORDER-COGS` / `CM-SETTLE` descriptions to
be source-neutral.

*Exit:* a POS sale can be posted from a test script and appears correctly on the
trial balance, the income statement, and `/outlet-pnl`.

> **Phase 0 and Phase 1 shipped 2026-08-21.** Rules deployed and stamped. See
> `docs/data-model/pos.md` for the built schema and
> `POS_READINESS.md` §7 for what the build proved and disproved.

### Phase 1 — Staff POS

`pos.html` (app page, classified in `APP_PAGES`, eligibility-gated via
`feature-access.js` exactly as Inventory and Outlet P&L are). Table grid, order
screen, payment capture, void/refund, receipt, POS overview. `onSnapshot` on the
open-orders query. Bahasa-first copy plus the EN pairing.

*Exit:* a full shift can be run on real hardware, and the day's sales tie to the
ledger.

### Phase 1.5 — Shifts and the cash drawer

Open float, paid-in/paid-out, blind close, over/short posted to a real account.
Specced separately because it is genuinely new accounting
(`POS_READINESS.md` §5), and because a business can run Phase 1 without it while
they cannot run it without tables.

### Phase 2 — QR customer ordering

`SITE_ROLE=order`, `order.fluxyos.com`, `deploy/_redirects.order`, the tightened
`_headers`. The three public endpoints. QR generation and printable table cards.
Token rotation and revocation. **Rate limiting (§18.10) is a Phase 2 blocker, not a
follow-up.**

### Phase 3 — Depth

Per-outlet rules scoping (after a rules-budget check). Split bills. Order transfer
between tables. Menu availability / 86-ing. Per-outlet menu pricing.

### Phase 4 — Inventory closure

Theoretical-vs-actual variance reporting. Menu engineering (margin × popularity).
Waste attribution against POS consumption.

### Phase 5 — Payment providers

The payments registry, Midtrans, Xendit, webhook receiver + worker, refunds,
reconciliation, the `1030` settlement dashboard.

### Phase 6 — AI

Only once the §14 gate holds for 30 days.

---

## 16. Acceptance criteria

**Correctness — the ledger**

- A paid POS order produces exactly one balanced `POS-SALE` journal and, when the
  items have a cost basis, exactly one `CM-ORDER-COGS` journal.
- Gross revenue on the journal equals `Σ line gross_amount`. Discounts appear as a
  **debit to 4900**, never as a reduced revenue credit.
- Emitting twice for one order is impossible: `transaction_id` set is a no-op.
- A voided order produces **no** journal and **no** stock movement.
- A refund reverses **both** the revenue journal and the stock relief.
- `1200 Inventory` still equals `Σ stock_movements.amount` after a day of POS
  trading.
- The day's POS gross reconciles to the ledger revenue for that outlet and date,
  to the Rupiah.
- `/outlet-pnl` attributes every POS sale to its outlet; POS contributes **nothing**
  to "Unassigned".

**Correctness — operations**

- An order is `paid` only when `Σ settled payments ≥ total_amount`.
- Two devices editing one order cannot lose a line (§18.2).
- A table shows occupied if and only if an open order references it.
- An order paid into a **closed period** is refused with an explanation, not
  silently posted.

**Security**

- The ordering page loads **zero** Firebase SDK bytes. Asserted in CI.
- A valid token for workspace A cannot read, submit to, or infer anything about
  workspace B. Asserted per endpoint.
- Submitting a tampered price results in the **server-side price** being stored.
- An unknown, revoked, or malformed token returns an identical response.
- A `cashier` receives `permission-denied` on `journals`, `ledger_balances`,
  `bank_accounts`, and `transactions` **reads**.
- A `cashier` signing in reaches `/pos` without a single console error.

**Product**

- Table grid → open order → first item added in **under three taps**.
- Hierarchy holds at **375px** and 1280px.
- Menu items with no cost basis are **surfaced**, not silent.
- The POS "sales today" figure is labelled operational and links to the accounting
  figure. The two are never presented as interchangeable.

**Process**

- `npm run qa` green on the pushed commit, non-partial.
- `npm run check:structure` and `npm run check:deploy-stamp` green.
- `firestore.rules` deployed, **verified against a deployed-rules spec**, stamped,
  and the stamp committed with the change.
- `node scripts/i18n-audit.js` at (near-)zero English gaps for the new pages.

---

## 17. Manual QA checklist

Read `QA_CHECKLIST.md` sections matching the change type. `npm run qa` covers the
mechanical rules; these are the ones it cannot judge.

**Walk it in a browser — this is not optional.** Walking the inventory chain found
three user-visible defects that every green spec missed
(`POS_READINESS.md` §6). A POS has more state than inventory does.

### A full shift, on a phone

1. Sign in as `cashier`. Land on `/pos` — console clean, no `permission-denied`.
2. Pick an outlet. Reload. The outlet is remembered.
3. Open Table 5, add three items, change a quantity, remove one, add a note.
4. Apply a line discount and an order discount. Check the total by hand.
5. Send → Serve → Bill. The primary action changes label; there is never more than
   one primary button.
6. Take a **partial** payment. Order stays `partially_paid`, balance is right.
7. Take the rest. Order goes `paid`; Table 5 shows available again.
8. Open the ledger as the owner. Find the journal. Confirm gross revenue, the 4900
   discount debit, and the COGS journal.
9. Confirm `/outlet-pnl` moved for that outlet and not for the others.

### The parts that break

10. **Two devices, one table.** Add an item on each without refreshing. Neither
    line may be lost.
11. **Turn off wifi mid-order.** Something honest must appear. Turn it back on —
    the order must not be corrupted or duplicated.
12. **Void an order** with items. No journal, no stock movement. Reason recorded.
13. **Refund a paid order.** Both journals reverse. Stock returns. Margin is right.
14. **Sell a menu item with no recipe.** Revenue posts, no COGS, and the missing
    cost basis is visible on the overview.
15. **Sell more than is in stock.** Relief happens at last known cost; stock goes
    negative; `inventory.html` shows the negative-stock signal.
16. **Pay into a closed period.** Refused with an explanation.
17. **Order number rollover** at midnight and across two outlets simultaneously.

### QR (Phase 2)

18. Scan on a real phone, on mobile data, not desktop-emulated.
19. Submit. It appears on the staff screen without a refresh.
20. **Edit the price in devtools before submitting.** The stored price is the
    server's.
21. **Change the token by one character.** Uniform not-found.
22. **Use another workspace's token.** Nothing about this workspace is reachable.
23. **Double-tap submit on a slow connection.** One order, not two.
24. **Open devtools on the ordering page.** No Firebase SDK. No IndexedDB entry.
    No workspace id anywhere in the response payloads.
25. Scan a **revoked** token.

### Design (anti-slop, `DESIGN_SYSTEM.md`)

26. At 375px: what the screen is, what to do next, what matters most — all readable
    in three seconds.
27. No orange backgrounds anywhere.
28. All money `Rp1.234.567`, Inter `tabular-nums`, plain zero, no space after `Rp`.
29. Every status readable without colour.
30. Type on the 6-step dashboard scale. No `text-[11px]` / `text-[13px]`.
31. Empty states offer a *relevant* action, not a generic "Add Record".
32. Loading uses the shared shimmer with the **real** column count.
33. Check it in **Safari**. An animated composited pseudo-element paints over
    content there and nowhere else.

### Localisation

34. Every new string in Bahasa first, English via Settings → Language.
35. `node scripts/i18n-audit.js` at (near-)zero gaps.
36. Brand terms stay English; the category renders as
    "Sistem Operasi Keuangan Cerdas".

---

## 18. Risks and edge cases

### 18.1 Offline is the honest limitation

A till that stops selling when the internet drops is not a till
(`POS_READINESS.md` §5). **v1 does not solve this**, and pretending otherwise in a
sales conversation is the fastest way to lose an F&B customer in month two.

v1 ships: Firestore's IndexedDB persistence, a **visible and unmissable**
connection banner, and a local draft of the current order. It does **not** ship a
queue-and-reconcile model, because that requires deciding what happens when two
tills reconnect with conflicting state for one table — a conflict model, not a
feature. Name this to prospects up front, exactly as the periodic-vs-per-sale
distinction was named for inventory.

### 18.2 Concurrent edits to one order

Two waiters, one table, stale reads: last-write-wins on an embedded `lines[]`
silently loses a line, and nothing reports it.

**Mitigation:** every mutation goes through `runTransaction` (already imported in
`db-service.js`), plus a `version` integer bumped on each write. A stale client is
**refused with a reload prompt**, never merged. This is the same shape as
`expected_system_quantity` in `createStockAdjustment`, which exists because
measuring against a state the user never saw silently misstates cost.

### 18.3 Two revenue numbers

The POS knows a figure; the ledger knows a figure; they differ until posting runs.
`PRODUCT_STRATEGY.md` §6 forbids a second source of truth. **Mitigation:** §7.6 —
label the operational figure as operational, show the unposted count, link to the
accounting figure, and alert when orders stay unposted over 24h.

### 18.4 Discounts must not be a reduced price

If a Rp50.000 dish sold at Rp40.000 is stored as `unit_price: 40000`, the discount
is gone forever — no menu price integrity, no discount analytics, no anomaly
detection, and the §14 "unusual discounts" capability is unbuildable.

**Mitigation:** store `gross_amount` and `discount_amount` separately on every
line, and post the discount as a debit to `4900`. This is why `POS-SALE` is a
four-line journal rather than a two-line one.

### 18.5 Comps, staff meals, and wastage sold

A comped order has revenue of zero but **consumed real stock**. Booking nothing at
all leaves the stock relief unexplained; booking revenue overstates sales.

**Mitigation:** a comp is a 100% discount — full gross revenue, full offsetting
`4900` debit, full COGS relief. Net revenue is zero, the food cost is visible, and
the comp is countable. A staff meal is arguably `6xxx` staff cost rather than
contra-revenue; **decide this with an accountant** and write the decision down.

### 18.6 Rounding

IDR has no sub-unit, but percentage discounts and percentage taxes produce
fractions, and the arithmetic must close to the Rupiah or `buildJournal`'s balance
assertion rejects the journal.

**Mitigation:** round **once**, at the order level, and let the largest line absorb
the residue. Never round per line and sum. The precedent is explicit: `recipeCost`
and stock relief both round once, at the end.

### 18.7 Indonesian F&B tax — PB1 / PBJT

**This is the highest-value item in this section and the easiest to get wrong.**

Restaurant and food-service sales in Indonesia are generally subject to a
**regional** tax — historically PB1 (Pajak Restoran), consolidated under UU 1/2022
(HKPD) as **PBJT atas makanan dan/atau minuman**, at a rate set by regional
regulation, commonly 10%. A business in that regime charges PBJT **instead of**
PPN on those sales.

The accounting consequence is large: **PBJT is collected on behalf of the regional
government, so it is a liability, not revenue.** Booking the gross amount the
customer paid as revenue overstates revenue by roughly 9% and correspondingly
distorts gross margin — on the exact number F&B owners care most about.

The chart has `2100 PPN Keluaran` but **no PB1/PBJT account**. One is needed, plus
a per-workspace setting for rate and applicability.

⚠️ **Rate, thresholds, and whether a given outlet is liable vary by regency and
change.** Confirm with an Indonesian tax practitioner before any number reaches a
journal — `ACCOUNTING_EXPERT_INTERVIEW_GUIDE.md` exists for exactly this, and
`INDONESIA_TAX_CENTER_ARCHITECTURE.md` is where the outcome belongs.

### 18.8 Service charge

Typically 5–7%. If retained by the business it is revenue; if distributed to staff
it is a **liability** until paid, then a payroll cost. Getting this wrong
misstates both revenue and staff cost. Make it configurable, default to revenue,
and document the choice per workspace.

### 18.9 QR token lifecycle

A printed QR outlives the software. Tokens must be revocable without reprinting
every table card (revoke maps to a new token behind a stable printed short-URL, or
accept reprinting and say so), rotatable on a schedule, and useless once revoked.
Never derive a token from a table id, a sequence, or a timestamp — 256 bits of
CSPRNG output, base64url.

### 18.10 No rate limiting exists anywhere

`grep` across `netlify/` returns nothing for rate limiting. Today that is
acceptable because every write path is authenticated. **A public order endpoint
changes that**: an unthrottled `POST` that writes a Firestore document is a direct
cost-and-noise attack on a customer's workspace.

Per-token, per-IP, and per-workspace daily caps must exist **before** Phase 2
ships. This is new infrastructure the plan requires and the codebase does not have
— call it out in the Phase 2 estimate rather than discovering it in review.

### 18.11 Rules ceiling and evaluation budget

At 91.6% of ceiling, this plan's ~2.2KB fits (§7.7). But rules **do not deploy with
`git push`**, and a missing rules block does not degrade gracefully: Firestore batch
writes are atomic, so it fails **every** posting, not just the new feature. That
nearly shipped on 2026-08-16 with full QA green.

Separately, the *evaluation* budget has been tripped in production before (invoice
`open → paid`, 2026-07-14). Order status transitions are the same shape. Use lean
per-transition validators; keep emulator test docs ≤10 keys.

### 18.12 The cashier role's blast radius

Adding a role to `ROLES` without enumerating every `hasRole` list it must appear in
produces silent `permission-denied` on pages nobody tested. Enumerate the grants;
do not infer them. And a cashier landing on `/dashboard` must be *routed*, not
merely denied.

### 18.13 Menu price changes mid-service

A price edited while an order is open must not retroactively change that order.
**Mitigation:** `unit_price` is copied onto the line at add time, exactly as
`base_unit` is copied onto a stock movement. The menu is a master; the order is a
document.

### 18.14 Order numbering

Per outlet, per day, monotonic, with two tills allocating simultaneously. Use the
existing `counters` collection and its transactional reservation — the same
mechanism journal numbering uses. Do not invent a second scheme, and do not derive
a number from a timestamp.

### 18.15 The strategic risk

Fifteen F&B prospects are blocked, POS is "Mixed" among them, and this plan's
Phase 1 serves only the no-till subset directly. If that subset is small, Phase 1
generates no revenue while consuming the quarter.

**Mitigation:** get the number first (§0). Ship Phase 1 to **two or three design
partners**, not to all fifteen — `INVENTORY_DEMAND_VALIDATION.md` §7 already makes
this argument, and building *with* a few beats building ahead of all of them.
