---
status: current
owns: [product vision, module scope, roadmap admission]
updated: 2026-08-07
verify: none — this document states intent, not behaviour
---

# FluxyOS Product Strategy

> **Single source of truth for what FluxyOS is and what belongs in it.**
> Every feature proposal is tested against §3. If a proposal cannot answer §3,
> it is not ready to build regardless of who asked for it.
>
> Positioning statement (`PROJECT_BACKGROUND.md` §1) and roadmap sequencing
> (`ROADMAP.md`) both derive from this document. When they disagree, this wins.

---

## 1. Positioning — unchanged

**FluxyOS is a Finance Operating System.** That is the tagline, the category, and
the way we describe ourselves to the market. It is not changing.

What is changing is our understanding of how *deep* a Finance OS has to go before
the numbers it reports are actually true.

We serve two audiences at once, and the tension between them is the product:

| Audience | Wants | Needs from us |
|---|---|---|
| Owners & executives | A trustworthy answer to "how are we doing?" | Decision-grade KPIs, cash visibility, margin they can act on |
| Finance & accounting teams | To close the books correctly and on time | Double-entry rigour, SAK compliance, auditability, period close |

We do not choose between them. The executive view is only trustworthy *because*
the accounting underneath is rigorous. A dashboard built on estimates is a
liability dressed as a feature.

### Why "ERP" is a capability, not a label

We are deliberately not marketing FluxyOS as an ERP. The word signals
implementation projects, consultants, and 18-month rollouts — the opposite of
what an Indonesian SMB will buy. But we will absolutely build ERP-class
capability where it makes the financial statements true.

**"Finance Operating System" is the promise. ERP depth is how we keep it.**

---

## 2. Why we are going deeper — the argument from COGS

The expansion into POS, inventory, and operational modules is not a response to
feature requests. It is a response to a defect in what we can currently report.

### The problem, stated precisely

FluxyOS today computes Gross Margin from cost of revenue detected via the chart
of accounts (`sak_category === 'cogs'`). That is correct as far as it goes — but
for a business that holds stock, **cost of goods sold is not an expense you
record; it is a consequence of inventory you moved.**

Without inventory movement:

- COGS is whatever was purchased in the period, not what was consumed.
- Gross margin is therefore an approximation whose error equals the change in
  stock — which in F&B is material and seasonal.
- The balance sheet has no inventory asset, so it does not balance against
  reality.
- Period close is arithmetically valid and economically wrong.

For an F&B business where COGS runs 30–40% of revenue, this is not a rounding
error. It is the single number the owner cares most about, and we currently
cannot compute it correctly.

**This is the whole argument.** Inventory is not an adjacent module we are adding
because customers asked. It is the missing input to a number we already publish.

### The same logic for POS

A restaurant's revenue *originates* at the point of sale. Today that revenue
reaches FluxyOS as a manual entry or a bank deposit — after aggregation, after
delay, stripped of the line-item detail that makes COGS computable.

POS gives us revenue at the moment and granularity it occurs, which is what
makes recipe-level COGS possible at all. POS and inventory are one capability
described from two ends.

### What the F&B discovery signal actually told us

Prospects asking for "POS and inventory" are not asking us to become a POS
vendor. They are telling us their financial operations are unreliable because
sales and stock live outside the system that reports their numbers. That is a
Finance OS problem.

---

## 3. The admission test — does this module belong?

Every proposed module, feature, or integration must answer this before it enters
the roadmap:

> **Does it produce or consume a posting in the ledger?**

If a module changes the financial statements — or supplies data a posting
depends on — it is in scope. If it does not, it is out of scope no matter how
often it is requested. This is the discipline that lets us go ERP-deep without
becoming an undifferentiated ERP.

| Module | Posting relationship | Verdict |
|---|---|---|
| Point of sale | Produces revenue, PPN payable, COGS, cash/settlement | **In** |
| Inventory & stock movement | Produces COGS, wastage expense, inventory asset | **In** |
| Purchasing / procurement | Produces AP, inventory receipt, accrual | **In** |
| Recipes / bill of materials | Consumed by COGS calculation | **In** (enables inventory) |
| Fixed assets & depreciation | Produces depreciation, asset carrying value | **In** |
| Payroll | Produces payroll expense, tax withholding, accrual | **In** (later) |
| Supplier & customer master | Consumed by AP/AR postings | **In** (partially exists) |
| Table reservations | None | **Out** |
| Staff scheduling | None directly — only via labour cost | **Out** unless it drives a posting |
| CRM pipeline | None until it becomes an invoice | **Out** |
| Loyalty programme | Produces a contra-revenue / liability posting | **Boundary** — revisit with evidence |
| Marketing campaign management | None | **Out** |

**Boundary cases go to the co-founders, not to the backlog.** A module that only
*might* post is a decision, not a ticket.

### Applying the test to a feature, not just a module

The same question scales down. "Add a supplier rating field" produces no
posting, but it is consumed by purchasing decisions that do — so it is in scope
as part of an in-scope module, not as a standalone feature. The test governs
*modules*; within an admitted module, normal product judgement applies
(`product_ux_feature_intake_framework.md`).

---

## 4. Why our architecture already supports this

This expansion is far less disruptive than it sounds, because the substrate
exists. FluxyOS is not a dashboard that needs an accounting engine bolted on —
it is already a double-entry ledger with several source systems feeding it.

What is already built (`data-model/accounting.md`):

- **`journals`** — immutable once posted, balanced, period-stamped, with
  `source: {collection, id}` and `posting_rule_id` on every entry
- **`ledger_balances`** — running per-account/period totals; the trial-balance
  source
- **`periods`** — open/closed/locked with a real close that posts net income to
  Retained Earnings, and a reopen that reverses it
- **`chart_of_accounts`** — 33 seeded accounts carrying `sak_category`, aligned
  to Indonesian SAK, with policy flags governing what may post where
- **`counters`** — monotonic journal numbering reserved transactionally

And critically: **more than one source system already posts into it.** Manual
transactions, bills, invoices, and marketplace commerce orders all become
journals through the same engine. The commerce integration proved the pattern —
external order data in, balanced journal out, including fee and settlement
handling through `1030 Payment Gateway Clearing`.

> **POS is commerce that happens in the room instead of on a marketplace.**
> Architecturally it is the same shape: an external system emits orders, we map
> them to accounts through posting rules, and the kernel does the rest.

Inventory is the genuinely new primitive — it introduces stock valuation, which
is state the ledger does not currently hold. That is the real engineering work,
and §5 treats it honestly.

### The architectural principle this establishes

**The ledger is the product. Everything else is a source system or a view.**

- A *source system* (POS, commerce, bills, invoices, bank import) emits business
  documents and owns a posting rule that turns them into balanced journals.
- A *view* (dashboard, reports, tax centre, AI analyst) reads derived balances
  and never recomputes truth from raw documents.
- New modules add source systems. They do not add second sources of truth.

Any proposal that wants its own parallel totals, its own notion of a period, or
its own idea of what revenue means is architecturally wrong regardless of its
product merit.

---

## 5. Honest assessment of what this costs

Strategy documents that only argue *for* things are marketing. Three risks are
worth stating plainly.

### Inventory costing is genuinely hard

Under Indonesian SAK (as under IFRS), **FIFO and weighted average are permitted;
LIFO is not.** Weighted average is the pragmatic default for F&B and the one we
should ship first. But costing touches every stock movement, needs to survive
backdated entries and period close, and is unforgiving of partial
implementations. This is not a sprint.

### F&B has specific requirements that generic inventory misses

- **Recipes / BOM** — a dish consumes many ingredients; COGS requires exploding
  the recipe at sale time, not just decrementing a SKU.
- **Wastage and spoilage** — material in F&B and must post as expense
  distinct from COGS, or margin analysis is misleading.
- **Yield and portioning** — 1kg purchased is not 1kg sold.
- **Daily cash reconciliation** — POS drawer versus deposit is a routine
  operational control we would inherit responsibility for.

Shipping generic warehouse inventory into an F&B account would be worse than
shipping nothing, because it would produce confidently wrong COGS.

### POS is a real-time, offline-tolerant system

A point of sale must keep taking orders when the internet drops. That is a
materially different reliability contract from the rest of FluxyOS, which is a
static dashboard over Firestore. **Strong recommendation: integrate with existing POS
systems before building our own.** The financial value is in the postings, not
in the terminal UI, and integration gets us the postings at a fraction of the
cost and risk.

### Sequencing implied by the above

1. **Inventory + purchasing first** — makes existing COGS and gross margin true
   for every customer that holds stock, not only F&B.
2. **POS integration second** — adapters for the POS systems our F&B prospects
   already run, reusing the commerce connector pattern.
3. **Recipes / BOM third** — turns POS line items into ingredient-level COGS.
4. **Own POS terminal — only with evidence** that integration is insufficient.

This order front-loads the financial correctness win and defers the hardest
reliability problem until it is demonstrably necessary.

---

## 6. What stays true regardless

These constraints survive the expansion and bound every module we admit:

- **Bahasa-first, Indonesia-first.** SAK, PPN, and local operating reality are
  the default, not a localisation layer.
- **Workspace-scoped finance data.** Every new collection follows the scoping
  rule in `PROJECT_BACKGROUND.md` §4. A POS or inventory collection that
  hardcodes `users/{uid}` shows invited members zero data.
- **The kernel is authoritative.** New modules post to it; they do not keep
  their own books.
- **Owner-legible, accountant-correct.** Every surface must be readable by a
  non-accountant owner while remaining defensible to an accountant.
- **We are not selling an implementation project.** If a capability requires
  consultants to deploy, we have built it wrong for this market.

---

## 7. How to use this document

- **Proposing a module?** Answer §3. If the posting relationship is unclear, it
  is a boundary case — escalate, do not queue it.
- **Proposing a feature inside an admitted module?** This document does not
  apply; use `product_ux_feature_intake_framework.md`.
- **Designing the data model?** §4's architectural principle is binding:
  source system in, journal out, no parallel truth.
- **Writing the roadmap?** Sequencing in §5 is a recommendation with stated
  reasoning. Deviating is fine; deviating silently is not.
