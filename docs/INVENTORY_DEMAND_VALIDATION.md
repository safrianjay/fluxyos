---
status: current
owns: [inventory demand evidence, scope validation, segment call]
updated: 2026-08-15
verify: §7 supersedes §5 — demand verified 2026-08-15 from the founder sales pipeline (~15 blocked F&B prospects)
---

# Inventory — demand validation

Inventory has **two independent justifications, and they must not be conflated**:

| | |
|---|---|
| **Financial correctness** | FluxyOS publishes gross margin. For a stock-holding business that figure is wrong without inventory movement. This is an internal accounting rationale. |
| **Customer demand** | Are customers experiencing this problem and willing to pay to solve it? |

The first is **established** (`PRODUCT_STRATEGY.md` §4). The second is what this
document assesses. **A high financial necessity does not license a full module.**

---

> ## ⚠️ DEMAND VERIFIED 2026-08-15 — this document's original conclusion is overturned
>
> **~15 F&B prospects require POS and ingredient-level inventory. All are blocked:
> they will not sign until it ships.** Source: the founder's sales pipeline —
> evidence that exists outside the repository, which is why the sweep below could
> not find it.
>
> Confirmed depth — they need **all four**: ingredient stock and usage, recipe /
> menu COGS, waste and spoilage, and stock per outlet. POS situation is **mixed**:
> some already run a till, some need one.
>
> **This is Scenario A, not C.** Under §5b that is high financial necessity **and**
> high customer demand → build it, highest priority. Not a minimum capability.
>
> §§1–3 below are preserved as the record of what the repository contained. The
> scope call in §5 is **superseded by §7**.

---

## 1. Evidence tiers

Everything below is labelled. Nothing is inferred without saying so.

### ✅ VERIFIED — attributed customer voice

Three testimonials, published 2026-08-12 (commit `4422ed1`). These are the only
attributed customer statements in the repository, and they survived an
authenticity audit: commit `ff04214` removed fabricated metrics and invented
testimonials immediately before, and each of these was confirmed with the
customer before publishing.

| Customer | Segment | Verbatim | Underlying problem |
|---|---|---|---|
| **Azis Senna** — Owner, Bakkery Bread | F&B (bakery, stock-holding) | "I used to only find out whether we made money at the end of the month, and even then only after the receipts were collected. Now ingredient purchases and sales land in one place, so I can see where we stand that same day." | **Timeliness of profit visibility.** Note he describes ingredient *purchases* landing — the purchase side — not stock tracking |
| **Agus Sinaga** — Accounting, Kelapa Merdeka | not stated | "Bank reconciliation used to be the longest part of every close. Now the transactions are already matched and I only review the exceptions. The journals are clean and I can defend them." | **Close speed and defensibility.** Accounting, not operational |
| **Melisha Agustin** — CEO, Pujasera Group | F&B (food court, multi-outlet) | "Running several outlets means the numbers get buried into one total. What I needed was to see which outlet is working and which isn't, without asking my team for a manual report." | **Per-outlet profitability.** The only explicit unmet request in the corpus |

### ◐ INFERENCE — artifact-derived, never stated by a customer

The Beila Scarves investor deck (`beila.html`, built by FluxyOS *for* the
customer) states "19 SKUs profitably online at 53.5% blended gross margin" and
"Magnet Pin runs at 84%". Commit `aeac37d` — "state the core-hijab production
cost alongside blended COGS" — shows product-level COGS had to be written in by
hand.

**Inference:** a real customer needed per-SKU margin and computed it outside
FluxyOS. **This is not a request.** Beila never asked for inventory; we built the
deck and hit the gap ourselves.

### ❌ ABSENT — searched for, not found

- **No explicit request for inventory, POS, purchasing, procurement, or vendor
  management appears anywhere in the repository.** Zero.
- `ACCOUNTING_EXPERT_INTERVIEW_GUIDE.md` — a complete 6-session instrument whose
  findings template is **literally blank** (`Session #: ___ Date: ___`). None of
  the six sessions has been run.
- `ACCOUNTING_DISCOVERY_STRATEGY.md` §2.14 analyses inventory and concludes "Ask
  the expert" — unanswered.
- No support-conversation log, feature-request record, or churn note exists.
- Zero of the last 80 commits is attributed to a customer request.
- **Named production workspaces (Beila, Get-Pipeline, Dika Finance, Pitto) appear
  only in ledger-integrity incident records and repair scripts.** Their observed
  pain is books that do not tie — coverage gaps, scope leaks, drift.

### 🚫 UNREACHABLE — the richest source, not read

`netlify/functions/submit-contact-sales.js` writes every inbound lead to the
top-level Firestore collection **`sales_leads`**, carrying `business_type`,
`team_size`, and a free-text `message` up to 2,000 characters. Each lead is also
emailed and posted to `SLACK_WEBHOOK_URL`.

Form options map directly onto the segment question: *E-commerce · Retail &
Franchise · Food & Beverage · Agency · SaaS/Tech · Manufacturing · Professional
Services · Other*.

**None of this was readable when this document was written** — Firestore needs
production credentials, and the email/Slack archives sit outside the repo.
**Every conclusion below was provisional on that data — and §7 records the data arriving.**

---

## 2. Request classification

Explicit demand separated from underlying business problem, per segment.

| Category | Explicit demand | Underlying problem behind it | Tier |
|---|---|---|---|
| **Per-outlet / multi-branch profitability** | ✅ **Yes — Melisha** | "which outlet is working and which isn't" | Verified |
| Profit timeliness / cash visibility | ✅ Yes — Azis | "see where we stand that same day" | Verified |
| Close speed, journal defensibility | ✅ Yes — Agus | reconciliation was the longest part of close | Verified |
| COGS accuracy | ❌ none | Beila's product-level COGS computed by hand | Inference |
| **Inventory** | ❌ **none** | — | — |
| **POS** | ❌ **none** | — | — |
| Purchasing / procurement | ❌ none — Azis names ingredient purchases as something that *now works*, not a gap | — | — |
| Vendor management | ❌ none | — | — |

**The single most important line:** the strongest verified signal is
**per-outlet profitability**, and it is *not* a request for inventory. The
underlying problem — *"I don't know which outlet is losing money"* — is solved by
a dimension on postings, not by stock tracking.

---

## 3. Segment call

**Two of three named customers are F&B** (Bakkery Bread, Pujasera Group; Kelapa
Merdeka's industry is not stated). So the customer base leans F&B.

But the demand those F&B customers express is **financial visibility, not
operational control.** Neither asks about ingredients, recipes, waste, or stock
levels. Azis wants to know profit sooner; Melisha wants it split by outlet.

That distinction decides the scenario:

| Scenario (`PRODUCT_STRATEGY` framing) | Fits? |
|---|---|
| **A — F&B demanding operational control** (POS → outlet → purchasing → BOM → inventory) | ❌ The segment is F&B, but the demand is not operational |
| **B — Retail/e-commerce dominant** (SKU → inventory → COGS) | ❌ Only Beila, and by inference not request |
| **C — Multi-outlet financial visibility dominant** (dimensions → sales data → COGS → outlet P&L) | ✅ **This one.** The only explicit request, from the only CEO in the corpus |
| **D — No meaningful operational demand** | ◐ Partly true, and points the same way |

**⚠️ Verdict below was OVERTURNED on 2026-08-15 — see the banner at the top and §7. Retained as the record of what the repository alone supported.**

**Verdict (repository evidence only): Scenario C, with an F&B-leaning base.** Inventory enters later as the
upstream that makes outlet-level COGS accurate — not as the flagship.

---

## 4. Prioritization

Applying the two-axis framework (`PRODUCT_STRATEGY.md` §5b):

| Capability | Financial necessity | Customer demand | Verdict |
|---|---|---|---|
| **Outlet / entity dimension** | **High** — per-outlet financial information cannot be produced at all without it | **High** — the only explicit unmet request | **Highest priority** |
| **Inventory** | **High** — gross margin is materially wrong for stock-holders | **Unknown/none** — zero requests | **Minimum capability for correctness, then continue validating** |
| Purchasing / receiving | Moderate — the stock-in path | None | Follows inventory, not ahead of it |
| POS | High (revenue originates there) | None | Defer; no evidence, and it carries a different reliability contract |
| Recipes / BOM | High *for F&B* | None | Defer until F&B operational demand is verified |

Note the dimension is the rare High/High. It is also the cheapest of these, and
its irreversible half (`dimension_id` on journal lines) **already shipped**.

---

## 5. Smallest useful scope *(SUPERSEDED — see §7)*

> **Periodic inventory: a stock value per period, and one computed COGS journal.**
>
> `COGS = opening stock + purchases − closing stock`, posted as a period-end
> journal (Dr `5100` / Cr `1200`).

What that needs: one collection holding a per-period stock valuation, one posting
rule, one small entry surface. The accounts already exist — `1200 Persediaan` and
`2050 GRNI` are seeded dormant, `5100 COGS` is live and wired into both statement
surfaces.

What it deliberately does **not** need: item master, SKUs, UoM, stock movements,
per-unit costing, warehouses, recipes.

Why this is the right minimum:

1. **It makes gross margin materially true** for every stock-holding customer —
   which is the financial-correctness case, discharged in full.
2. **It presupposes no product scope.** It is the cheap v1 that
   `CHART_OF_ACCOUNTS_STRATEGY.md:57` and `ACCOUNTING_DISCOVERY_STRATEGY.md`
   §2.14 both originally proposed, before the roadmap assumed a full module.
3. **It is itself a demand instrument.** If customers enter counts and then ask
   for per-SKU detail, that is the demand evidence this document is missing. If
   they never enter a count, that is evidence too — and it cost one collection.

### ⚠️ This reverses my earlier recommendation, and the reversal matters

`INVENTORY_READINESS.md` §4 recorded "perpetual weighted-average model, periodic
count as the first UX". The argument was that pure periodic cannot consume POS
line items and would need rewriting.

**That argument assumed inventory was definitely coming at full scope.** Under
validated-demand thinking it inverts: a perpetual cost model built for unvalidated
demand is exactly the presumption of full scope this exercise exists to avoid.

The rework fear was also narrower than stated. **Periodic COGS journals are not
throwaway** — a correct period-end journal posted in August remains correct
history when perpetual costing arrives later. What would have needed reworking was
a perpetual *costing engine and item master*, which periodic-first simply does not
build. Building less costs nothing here.

---

## 6. What would change this

This document is provisional on `sales_leads`. Re-run the sweep and revise if:

- **`business_type` skews Food & Beverage AND messages describe operational
  control** (waste, ingredients, recipes, stock counts) → Scenario A. Reorder to
  POS → outlet → purchasing → BOM → inventory, and note `PRODUCT_STRATEGY` §7's
  warning that generic warehouse inventory in an F&B account is "worse than
  shipping nothing: confidently wrong COGS".
- **`business_type` skews E-commerce/Retail with SKU-level margin asks** →
  Scenario B. The commerce connectors already carry `sku`, `quantity` and
  `unit_price` into `commerce_orders`, so the quantity-out signal exists; a
  goods-for-resale model becomes appropriate and the generic-model decision made
  on 2026-08-14 is confirmed.
- **Explicit inventory or POS requests appear at volume** → inventory moves from
  "minimum capability" to a funded module, and this section is why.
- **The interview guide gets run** — six sessions, already written, and the
  qualitative half of the same question.

Until then: **build the minimum for correctness, keep validating, and do not fund
the full module.**


---

## 7. Revised plan on verified demand (2026-08-15)

### What the evidence now is

| | |
|---|---|
| **Volume** | ~15 F&B prospects |
| **Requirement** | POS **and** intelligent inventory |
| **Depth** | Ingredient stock/usage · recipe & menu COGS · waste & spoilage · stock per outlet — **all four** |
| **POS today** | **Mixed** — some run a till, some do not |
| **Sales stage** | **Blocked.** No signature until it ships |
| **Source** | Founder sales pipeline. Not in the repository; recorded here so it is |

### Three consequences

1. **The generic goods model is wrong for this base.** That decision was taken on
   2026-08-14 when no F&B demand signal existed. It does now, and
   `PRODUCT_STRATEGY.md` §7's warning is live: a dish consumes many ingredients,
   so menu COGS requires **exploding a recipe at sale time**, not decrementing a
   SKU. Recipes/BOM move from "fourth, later" to **core v1**.
2. **Perpetual weighted-average is the right model after all.** The original
   2026-08-14 call stands; the 2026-08-15 downgrade to periodic-only was made on
   absent evidence and is withdrawn. Periodic counts remain the first *workflow*
   on that model, and POS-driven per-sale decrement lands on it later without a
   rewrite.
3. **Unit-of-measure conversion is now mandatory, not optional.** You buy flour in
   kilos and sell it in portions. Without conversion factors, cost per unit is not
   computable — and this is independent of recipes.

### The wedge: ship the part that does not need a POS

"Mixed" POS is the sequencing problem — building a till serves only part of the
base and is the slowest thing on the list (offline-tolerant realtime, hardware,
a support contract unlike anything here today).

**Everything below works for all 15 regardless of their POS situation:**

```
ingredient master + UoM  →  recipes / BOM  →  purchasing & receiving
   →  periodic count per outlet  →  waste entry  →  COGS journal per outlet
   →  outlet P&L
```

That delivers all four requested capabilities. Menu COGS is *approximate* under
periodic counting rather than per-sale — worth naming to prospects, because it is
still the number they do not have today.

**POS integration then upgrades accuracy from periodic to per-sale** for the
subset that already runs a till, reusing the connector pattern that ships TikTok
Shop and Shopee. **Building our own terminal stays last** and only for the subset
that genuinely has no till — §7 of the strategy doc is unchanged on that point.

### Dependency order

1. **Dimensions collection + `ledger_balances_by_dim` rollup** — "stock per
   outlet" and "outlet P&L" both require it. The irreversible half
   (`dimension_id` on journal lines) already shipped.
2. **Item master with UoM + conversion**, `type: 'stock' | 'composite'` populated
   from the first write — the composite seam is what recipes later attach to.
3. **Recipes / BOM** — composite items exploding into components.
4. **Purchasing / receiving** — ingredient stock in, clearing through `2050 GRNI`.
5. **Periodic count per outlet + waste entry** — COGS journal (Dr `5100` /
   Cr `1200`), waste to `5150` (`operating_expense`, deliberately not `cogs`, so
   spoilage cannot hide inside gross margin).
6. **POS integration** for the subset that has a till.
7. **Own terminal** — only if the no-till subset is worth it on its own.

Steps 1–5 are the revenue unlock. Step 6 is the accuracy upgrade.

### The commercial risk, stated plainly

Fifteen prospects blocked on a multi-month build means **no revenue from any of
them until steps 1–5 ship**. That is a real cash-flow exposure and it argues for:

- **Sequencing to a demoable slice**, not to architectural completeness — an
  owner needs to see their own menu COGS before they believe it.
- **Design partners.** Fifteen blocked F&B prospects is exactly the discovery
  cohort `ACCOUNTING_EXPERT_INTERVIEW_GUIDE.md` was written for, and building
  *with* two or three of them beats building ahead of all fifteen.
- **Naming the periodic-vs-per-sale distinction up front**, so the first release
  is not measured against a promise nobody made.

---

## Demoing it — `scripts/seed-fnb-demo.js`

Builds a realistic Indonesian F&B workspace so the chain can be **walked**, not
described: three outlets, twelve ingredients on real shelves, a fortnight of
supplier deliveries, waste, a physical count that produces genuine COGS, revenue
tagged per outlet, and rent/utilities/staff as dimensioned bills.

The three outlets tell the story `/outlet-pnl` exists to tell — **Kemang**
healthy, **Senopati** thin, **Kelapa Gading** losing on waste and food cost.
Revenue is derived from the *actually posted* COGS, so each outlet's gross margin
really is the food cost its story claims rather than a number typed in.

```
node tests/qa-static-server.js
# open http://127.0.0.1:8765/dashboard.html and sign in

const { seedFnbDemo } = await import('/scripts/seed-fnb-demo.js');
await seedFnbDemo();                      # dry run — writes nothing
await seedFnbDemo({ confirm: 'WRITE' });  # applies
```

**It runs in the browser on purpose.** It calls the same `DataService` a user's
clicks call, so every journal, movement and balance row comes from the real
posting path and is checked by the real `firestore.rules`. An Admin-SDK seeder
would have to reimplement posting — the second set of books `PRODUCT_STRATEGY`
§6 forbids — and data that took a different path would prove nothing about the
product.

⚠️ **Use a fresh workspace.** Items, receipts, journals and movements are
immutable by rule; there is no undo, and demo figures would sit in real
statements permanently. The seeder refuses a workspace that already holds items
unless explicitly overridden.

Guard: `tests/seed-fnb-demo.spec.js` runs the real write path (one outlet, three
items) and pins both safety behaviours — a dry run writes nothing, and an
already-stocked workspace is refused.
