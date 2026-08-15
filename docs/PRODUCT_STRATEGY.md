---
status: current
owns: [product vision, layer model, maturity ladder, module scope, roadmap admission]
updated: 2026-08-15
verify: none — this document states intent and audited status, not behaviour
---

# FluxyOS Product Strategy

> **Single source of truth for what FluxyOS is, what is already built, and what
> belongs in it next.**
>
> §3 is a **reality audit**, verified against the codebase on 2026-08-07 — not a
> wish list. Nothing already shipped is described here as future work.
> §5 is the admission test every proposed module must pass; §5a asks whether it
> is connected to the system, and §5b decides when it is built and how much of
> it. **Financial necessity is not customer demand** — do not conflate them.
>
> `PROJECT_BACKGROUND.md` §1 (positioning) and `ROADMAP.md` (sequencing) derive
> from this document. When they disagree, this wins.
>
> **§1 holds the canonical category and definition sentence.** Every other
> surface — docs, `README.md`, `llms.txt`, `seo/organization.json`, landing
> pages, `i18n.js` — restates it rather than inventing its own. Enforced by
> `npm run check:structure`.

---

## 1. Positioning

**FluxyOS is an Intelligent Finance Operating System that connects financial
operations, accounting, business operations, enterprise workflows, and
intelligence into one continuously connected system.**

That sentence is the category, the tagline, and the definition every other
document derives from. Use it verbatim; `npm run check:structure` enforces that
the canonical sources agree.

### What this is *more than*

FluxyOS may include all of these. None of them defines it:

| It is more than | Because |
|---|---|
| Bookkeeping software | Recording is the input, not the outcome |
| Accounting software | Correct books are the foundation, not the product |
| Financial reporting software | A report explains the past; the goal is to change the next decision |
| ERP software | ERP is structural discipline we adopt — see below |
| A finance dashboard | A dashboard displays; an operating system connects and acts |
| Expense management software | Spend is one flow among several |
| Business intelligence software | BI reads a warehouse; this reads a ledger it also writes |

The ambition is to become **the financial and operational control layer of a
business** — the system that understands how operational activity produces
financial outcomes, and what to do about it.

### Who it is for

**Businesses across their growth journey** — small and growing companies,
medium-sized businesses, large and enterprise organizations, multi-entity groups,
and eventually public and IPO-stage companies. The architecture must let a
business grow *with* FluxyOS rather than out of it.

| Stage | What they should be able to do |
|---|---|
| Small | Start with simple financial operations |
| Growing | Add accounting and operational workflows |
| Medium | Run multiple departments, entities, and processes |
| Large / Enterprise | Manage complex org structures, permissions, approvals, and financial controls |
| Public / IPO | Operate with stronger controls, auditability, governance, and financial integrity |

> ⚠️ **That table is architectural direction, not current capability.** Today's
> product serves the first two stages well. Multi-entity, approvals, and
> enterprise controls are **not built** — §3 is the audited truth and always
> wins over this table.

**Indonesia is the home market and operating context**, not the product ceiling.
SAK, PPN, and Bahasa-first are defaults we build into the foundation (§8).
Indonesian SMBs are the current beachhead and remain an important segment — they
are simply no longer the definition of how far the product goes.

We serve two audiences at once, and the tension between them is the product:

| Audience | Wants | Needs from us |
|---|---|---|
| Owners & executives | A trustworthy answer to "how are we doing?" | Decision-grade KPIs, cash visibility, margin they can act on |
| Finance & accounting teams | To close the books correctly and on time | Double-entry rigour, SAK compliance, auditability, period close |

We do not choose between them. The executive view is trustworthy *because* the
accounting underneath is rigorous.

### Why "ERP" is a capability, not a label

We are deliberately not marketing FluxyOS as an ERP. The word signals
implementation projects, consultants, and long rollouts — the opposite of what a
growing business will buy. But we will build ERP-class capability wherever it
makes the financial statements true.

The strategic model is additive rather than substitutive:

```
Accounting + Finance + Operations + ERP + Business Intelligence
  + AI + Automation + Decision Support
        = Intelligent Finance Operating System
```

**We take the structural discipline of ERP and add an intelligence layer that
continuously interprets financial and operational data.** ERP systems are
rigorous but inert: they record faithfully and explain nothing. The difference we
are building toward is a system that progressively answers:

*What happened? Why did it happen? What is changing? What is likely to happen?
What should the business do? What action should be taken? What financial impact
will that action have?*

**"Intelligent Finance Operating System" is the promise. ERP depth is how we keep
it.**

### Strategic benchmarks

Oracle NetSuite, SAP Business One, SAP S/4HANA, and Odoo are **architectural
benchmarks, not products to copy**. Read them for how they structure accounting
foundations, master data, document flow, multi-entity, tax, approvals,
permissions, audit trails, and data architecture at scale. A concrete
benchmark-by-benchmark assessment lives in `ERP_ARCHITECTURE_REVIEW.md`.

We differentiate on the intelligence layer, automation, UX, financial decision
support, and AI-native workflows — not on matching their module count. Do not
claim feature parity, and do not import enterprise complexity before the product
needs it.

---

## 2. The five layers

FluxyOS is organised as five layers. Each rests on the one below; none is a
separate product.

| Layer | Question it answers |
|---|---|
| **1 — Financial Foundation** | What money moved? |
| **2 — Accounting Foundation** | Are the books correct and closeable? |
| **3 — Operational Foundation** | Where does the money actually come from and go? |
| **4 — Financial Intelligence** | What does it mean, and what happens next? |
| **5 — Decision Layer** | What should each role do about it? |

The layers are a *dependency* order, not a build order. Layer 4 intelligence is
only as good as the Layer 2 books beneath it, which are only as true as the
Layer 3 operations feeding them. This is why operational depth is a finance
concern rather than scope creep — see §4.

### The loop the layers exist to close

"Operating system" is a claim about connection, not about feature count. The
system should increasingly understand how operational activity produces
financial outcomes, and feed that understanding back into operations:

```
Business Operations → Operational Data → Financial Events → Accounting
   → Financial Intelligence → Business Decisions → Operational Actions
        → (feeds back into Business Operations)
```

Concretely, the chains we are connecting:

| Operational activity | …becomes financial reality |
|---|---|
| Sales | Revenue |
| Purchasing → Inventory | COGS → Gross margin |
| POS | Sales + payments + stock movement |
| Inventory | Stock + cost + working capital |
| Bills | Accounts payable → cash flow |
| Payroll | Operating expenses → profitability |
| Accounting | Financial statements → management intelligence |
| Fluxy AI | Analysis → recommendations → actions |

**A module that does not join one of these chains is a feature, not part of the
operating system.** This is the difference between a product that connects and a
product that accumulates screens — and it is why §5a exists.

---

## 2a. The maturity ladder

The five layers describe what depends on what. The ladder below describes how
far along we are, and where the product is going. They are two views of the same
system, not two systems.

| Phase | Name | Contains | Maps to |
|---|---|---|---|
| **1** | Financial Operations | Transactions, bills, revenue, subscriptions, budgets, reporting | Layer 1 |
| **2** | Accounting Foundation | CoA, journals, GL, trial balance, IS/BS, AP/AR, reconciliation, tax, audit trail | Layer 2 |
| **3** | Operational ERP Foundation | Inventory, purchasing, vendors, products, stock movement, cost control, COGS, warehouse, sales | Layer 3 |
| **4** | Commercial Operations | POS, orders, payments, customers, sales channels, inventory sync, revenue sync | Layer 3 |
| **5** | Intelligent Finance OS | AI financial/operations/accounting analysts, forecasting, anomaly detection, recommendations, workflow automation, decision support, predictive cash flow and profitability | Layers 4–5 |

Phases 3 and 4 both sit in Layer 3 because they are the same layer approached
from two ends — purchasing pushes value in, commerce pulls it out. Phase 5 spans
Layers 4 and 5 because intelligence without a decision surface is a report.

**Where we actually are:** Phases 1 and 2 are substantially shipped. Phase 3 has
not started beyond preparation (`INVENTORY_READINESS.md`). Phase 4 exists only as
marketplace order sync. Phase 5 exists as AI chat and extraction, with no
forecasting. §3 holds the audited detail.

> This ladder is **strategic direction, not a roadmap.** It does not authorise
> building every module, and it sets no dates. Sequencing stays in §7 and
> `ROADMAP.md`, which remain phased and prioritized.

---

## 3. Reality audit — what actually exists (2026-08-07)

Verified against the codebase, not from memory or roadmap intent.

**Legend:** ✅ Shipped · ◐ Partial · 📋 Planned (specced, not built) · 🔭 Vision (admitted, not specced)

### Layer 1 — Financial Foundation · substantially ✅

| Capability | Status | Evidence |
|---|---|---|
| Financial dashboard + KPIs | ✅ | `dashboard.html`, 6 KPI drill-down pages |
| Ledger / transactions | ✅ | `ledger.html`, `transactions` collection |
| Bills & payment scheduling | ✅ | `bill.html`, `bills` |
| Budgeting (annual → period → allocation) | ✅ Phase 2 | `budget.html`, `budget-period.html`, `budget-allocation.html` |
| Reports & exports | ✅ MVP | `reports.html`, `report-preview.html` |
| Revenue tracking / sync | ✅ | `revenue-sync.html` |
| Subscriptions | ✅ | `subscription.html` |
| Cash & bank accounts, reconciliation | ✅ | `bank_accounts`, bank rec Phases A+B |
| Bank statement import | ✅ | `bank_statement_imports`, background extractor |
| Integrations | ✅ | `integration.html`, commerce connectors |
| AI chat | ✅ | `ai-chat.js`, `ai-command-center.js` |
| Settings (14 pages) | ✅ | `settings-*.html` |
| KYC & onboarding | ✅ | `onboarding.html`, `platform_learning` |
| Team management & workspaces | ✅ | `settings-team.html`, `workspaces/{id}/members`, `_scope()` |
| Invoices (multi-currency) | ✅ MVP | `invoices.html`, `invoices` + `items` |

### Layer 2 — Accounting Foundation · ✅ far more built than commonly assumed

> **This layer is not emerging — it is largely shipped.** The accounting kernel
> is real double-entry with immutable posted journals, period close, and
> SAK-aligned accounts. Any document or brief describing General Ledger, Journal
> Entries, Chart of Accounts, Closing, Tax, or Financial Statements as *future
> work* is out of date.

| Capability | Status | Evidence |
|---|---|---|
| Chart of Accounts | ✅ | 34 seeded SAK accounts, `chart_of_accounts`, `coa` panel, policy flags |
| Journal entries (manual + system) | ✅ | `accounting-journal.html`, `accounting-journal-new.html`, `journals` |
| General ledger | ✅ | `ledger` panel, `ledger_balances` (trial-balance source) |
| Trial balance | ✅ | `trial` panel, `trialBalanced` |
| Income statement | ✅ | `income` panel, `incomeStatement*` |
| Balance sheet | ✅ | `balance` panel, `balanceSheet*` |
| Cash flow statement | ✅ | `cashflow` panel, `cashFlowBuckets` |
| Period close / reopen | ✅ | `close` panel, `closePeriod()` → retained earnings, `reopenPeriod()` |
| AR / AP aging | ✅ | `aging` panel |
| Revenue & expense categorisation | ✅ | `accounting_mappings`, keyword rules |
| Tax management (Indonesia) | ✅ Phases 1–4, 5.1 | `tax-center.html`, 5 tax collections |
| Vendor management | ✅ | `vendors` panel, 123 refs in `db-service.js` |
| COGS detection | ✅ | via `sak_category === 'cogs'` — a categorization of spend, not a consequence of stock moving (see §4) |
| **Multi-entity accounting** | **📋 Not built** | Re-audited 2026-08-14. `entity_id` is carried on journals/accounts/balances, but `_resolvedScopeId()` returns the workspace id — it is a **constant, not a dimension**. One entity per workspace by construction; `entity_name` is read in one place and written nowhere. A `dimension_id` seam now exists on journal lines (`docs/DIMENSION_SEAM_DESIGN.md`); the collection, rollup, and UI are not built |

### Layer 3 — Operational Foundation · ◐ started, uneven

| Capability | Status | Evidence |
|---|---|---|
| Vendor / supplier management | ✅ | `vendors` panel, vendor master in mappings |
| Revenue operations | ✅ | `revenue-sync.html`, commerce connectors |
| Budget operations | ✅ | budget pages + assignment audit trail |
| User & team management | ✅ | `settings-team.html`, workspace roles |
| AI-assisted document processing | ✅ | bank statement extractor, 3 `scan-*` specs |
| Receipt & bill capture | ✅ | `document-attachment.js`, `documents` |
| Business settings | ✅ | `settings-business.html` |
| Commerce / marketplace order sync | ✅ Phases 1–3 | `commerce_*` collections, Shopee/TikTok connectors |
| WhatsApp AI | 📋 | `settings-whatsapp.html` exists; planning only |
| **Approval workflows** | **📋 Not built** | Sidebar shows disabled `Soon`; no data contract. The word appears only in budget copy. |
| Inventory & stock movement | 🔭 → **funded** | Admitted §5. **Demand verified 2026-08-15: ~15 F&B prospects require ingredient-level inventory + POS and are blocked on it (`INVENTORY_DEMAND_VALIDATION.md` §7).** High necessity AND high demand under §5b. Scope is the F&B stack — ingredient master with UoM, recipes/BOM, waste, stock per outlet — **not** generic SKU decrement. Kernel ready; dimension seam, cursor pagination and `1200`/`2050`/`5150` shipped as preparation. No inventory collection, page or posting rule is built yet |
| Purchasing / procurement | 🔭 | Admitted §5 |
| POS integration | 🔭 | Admitted §5 |
| Recipes / bill of materials | 🔭 | Admitted §5 (enables F&B COGS) |
| Order management | 🔭 | Partly exists as commerce orders; needs own-channel orders |
| Customer management | 🔭 | Invoice-level customers exist; no master |
| Branch management | 🔭 | Depends on multi-entity completion |
| Production | 🔭 | Follows inventory + BOM |
| Asset management & depreciation | 🔭 | Admitted §5 |
| Payroll | 🔭 | Admitted §5, high compliance surface |
| CRM | 🔭 | Admitted via §5 — predicts revenue |
| Project management | 🔭 | Admitted via §5 — explains cost and margin by project |

### Layer 4 — Financial Intelligence · ◐ differentiator, narrow today

| Capability | Status | Evidence |
|---|---|---|
| AI financial analyst / chat | ✅ | `ai-chat.js`, workspace-scoped reads |
| AI command center | ✅ | `ai-command-center.js` |
| Document extraction pipeline | ✅ | `bank-statement-extract-background.js` |
| AI review before save | ✅ | scan review specs |
| Finance Q&A | ✅ | via chat |
| WhatsApp AI | 📋 | planning |
| Forecasting / cash-flow prediction | 📋 Not built | no forecast code |
| Financial health monitoring | 🔭 | |
| Scenario planning | 🔭 | |
| Risk detection | 🔭 | |
| Cross-module intelligence | 🔭 | unlocked by Layer 3 depth |
| Autonomous finance workflows | 🔭 | |

### Layer 5 — Decision Layer · ◐ one dashboard, one audience

| Capability | Status | Evidence |
|---|---|---|
| Business overview + KPIs | ✅ | `dashboard.html` |
| KPI drill-downs | ✅ | 6 pages (revenue, cash position, cash pressure, opex, net profit, account detail) |
| Reports | ✅ MVP | `reports.html` |
| AI summary | ✅ | in overview |
| Role dashboards (CEO / Finance / Accounting / Ops) | 📋 Not built | only one dashboard exists |
| Investor dashboard | 🔭 | |
| Multi-branch dashboard | 🔭 | blocked on multi-entity |
| Executive command center | 🔭 | |

### What this audit changes

1. **Layer 2 should stop being described as emerging.** The kernel is shipped.
   The genuine Layer 2 gap is **multi-entity** — and it is larger than it looks.
   The `entity_id` plumbing does not exist: the field is stamped with the
   workspace id and never varies. Treat this as unbuilt, not half-built.
2. **Approvals is the notable Layer 3 gap** — often assumed present because the
   sidebar advertises it. It has no data contract.
3. **Forecasting is the notable Layer 4 gap** — the most requested "AI" capability
   and the one we do not have.
4. **Layer 5 serves one audience** despite the strategy naming five.

---

## 4. Why we go deeper — the argument from COGS

The expansion into inventory, POS, and operational modules is not a response to
feature requests. It is a response to a defect in what we can currently report.

FluxyOS computes Gross Margin from cost of revenue detected via
`sak_category === 'cogs'`. That is correct as far as it goes — but for a business
holding stock, **cost of goods sold is not an expense you record; it is a
consequence of inventory you moved.**

Without inventory movement:

- COGS is whatever was purchased in the period, not what was consumed.
- Gross margin's error equals the change in stock — material and seasonal in F&B.
- The balance sheet has no inventory asset.
- Period close is arithmetically valid and economically wrong.

For F&B, where COGS runs 30–40% of revenue, this is the number owners care most
about, and we cannot currently compute it correctly. **Inventory is a missing
input to a figure we already publish** — not an adjacent module.

The same logic applies to POS: revenue *originates* at the point of sale. Today
it reaches us aggregated and delayed, stripped of the line detail that makes
recipe-level COGS possible. POS and inventory are one capability from two ends.

Prospects asking for "POS and inventory" are not asking us to become a POS
vendor. They are telling us their financial operations are unreliable because
sales and stock live outside the system that reports their numbers.

---

## 5. The admission test

Every proposed module must answer this before entering the roadmap:

> **Does it create, move, protect, predict, or explain financial performance?**

If yes, it is in scope — it belongs to a layer and posts, feeds, or reads
through the stack. If no, it is out of scope regardless of how often it is
requested.

| Verb | Meaning | Example |
|---|---|---|
| **Creates** | Originates revenue or cost | POS, order management |
| **Moves** | Changes the position of value | Inventory, purchasing, payments |
| **Protects** | Prevents loss or error | Approvals, audit log, reconciliation |
| **Predicts** | Forecasts future position | CRM pipeline, cash-flow forecasting |
| **Explains** | Attributes performance to a cause | Project management, branch reporting |

**The test survived the 2026-08-15 vision expansion unchanged**, which is the
strongest evidence it was drawn correctly. Every capability the expanded vision
names already passes: payroll *creates* cost, approvals and enterprise controls
*protect*, multi-entity and branch reporting *explain*, forecasting and
predictive cash flow *predict*, inventory and purchasing *move*. A broader
ambition did not require a looser gate.

### The architectural consequence

The admission test decides *whether* a module belongs. This decides *how* it is
built:

> **Modules that create or move value must post to the ledger. Modules that
> predict or explain must read derived balances. Neither keeps its own books.**

A CRM does not post journals — it predicts, so it reads and forecasts. A POS
does post. Project management explains, so it attributes existing postings to a
dimension; it does not invent parallel totals.

Any proposal wanting its own totals, its own period concept, or its own
definition of revenue is architecturally wrong regardless of product merit.

### Still out of scope

Table reservations, staff scheduling (unless it drives labour cost postings),
and campaign management fail every verb. Loyalty programmes are a **boundary
case** — they create a contra-revenue liability — and go to the co-founders
rather than silently into the backlog.

---

## 5a. The connection test

Passing §5 earns a module a place in the system. This decides whether it is
*connected to* the system or merely hosted by it.

**FluxyOS must not become a collection of disconnected business modules.** Every
major module answers all six:

1. **What operational problem does this solve?**
2. **What financial data does it generate?**
3. **Which accounting records does it affect?** (which posting rule, which
   accounts, which subledger)
4. **Which other modules depend on this data?**
5. **What financial insight can be generated from it?**
6. **What actions can Fluxy AI eventually take based on it?**

Question 3 is the one that fails silently. A module that cannot name its posting
rule is building a parallel set of books, which §6 forbids outright.

Worked example — **Inventory**: solves "I do not know what my stock is worth or
what it cost me to sell"; generates stock movements and unit costs; posts
Dr Inventory / Cr GRNI on receipt and Dr COGS / Cr Inventory on sale; is depended
on by POS, purchasing, and gross-margin reporting; yields true gross margin and
working-capital visibility; and eventually lets Fluxy AI flag a SKU becoming a
working-capital risk before it ties up cash.

Answer these in the feature brief, not after implementation. Feature-level work
inside an existing module uses `product_ux_feature_intake_framework.md` instead.

---

## 5b. The prioritization test — necessity is not demand

§5 decides whether a module belongs. §5a decides whether it is connected. This
decides **when it gets built and how much of it.**

A module can be financially necessary without anyone asking for it, and asked for
without being financially necessary. **These are independent axes and conflating
them is how a finance product becomes an ERP nobody requested.**

| | **High customer demand** | **Low / unknown demand** |
|---|---|---|
| **High financial necessity** | **Build it.** Highest priority | **Build the minimum capability required for correctness, then keep validating.** Do not fund the full module |
| **Low financial necessity** | Investigate whether it creates an important financial workflow or a strategic entry point | Do not prioritize |

**Axis A — financial necessity:** does FluxyOS need this data to produce accurate
financial information? Inventory scores high because gross margin is materially
wrong for a stock-holding business without it (§4).

**Axis B — customer demand:** are customers actively experiencing this problem and
willing to pay to solve it? Requires *evidence*, not inference. Verified customer
statements, lead messages, interview findings, support conversations — labelled by
tier, never invented.

### Explicit demand is not the underlying problem

Classify every piece of evidence twice:

| Explicit demand | Underlying business problem |
|---|---|
| "We need inventory management" | *may* be "I cannot tell what my margin really is" |
| "Which outlet is losing money?" | is **not** an inventory request — it is a dimension request |

**These lead to different products.** A customer describing a symptom in the
vocabulary of a module they have seen elsewhere is not a specification.

### Do not build a module because ERPs have one

The Intelligent Finance Operating System framing (§1) is a commitment to
connection, not a licence to reproduce an ERP feature list. The reason to build
inventory is that it is necessary for a figure we publish and/or solves a
validated customer problem — never that mature ERPs ship one. The same test
applies to POS, CRM, procurement, payroll, asset management, production, order
management, and branch management.

> **Worked example — Inventory, assessed 2026-08-15.** A first pass over the
> repository found high financial necessity and **zero explicit demand**, which
> caps a module at minimum capability. The same day, the founder's sales pipeline
> supplied the missing axis: **~15 F&B prospects requiring POS and
> ingredient-level inventory, all blocked on it shipping.** High necessity **and**
> high demand → build it.
>
> Two lessons worth keeping. **The framework was right and the input was blind** —
> most demand evidence lives in a CRM, an inbox, or a founder's head, not in a
> repository, so "no evidence found" must be reported as *not found here*, never
> as *does not exist*. And the demand, once known, changed the **shape** as well as
> the priority: ingredient-level with recipes, waste and per-outlet stock is a
> different product from SKU-decrement inventory. Full record:
> `INVENTORY_DEMAND_VALIDATION.md` §7.

---

## 6. Why the architecture already supports this

FluxyOS is not a dashboard needing an accounting engine bolted on. It is a
double-entry ledger with several source systems already feeding it
(`data-model/accounting.md`):

- **`journals`** — immutable once posted, balanced, period-stamped, carrying
  `source: {collection, id}` and `posting_rule_id`
- **`ledger_balances`** — running per-account/period totals; the trial-balance source
- **`periods`** — real close posting net income to Retained Earnings, and a
  reopen that reverses it
- **`chart_of_accounts`** — 34 SAK-aligned accounts with policy flags governing
  what may post where
- **`counters`** — monotonic journal numbering reserved transactionally

Critically, **more than one source system already posts into it**: manual
transactions, bills, invoices, and marketplace commerce orders — the last
including fee and settlement handling through `1030 Payment Gateway Clearing`.

> **POS is commerce that happens in the room instead of on a marketplace.**
> Architecturally the same shape: an external system emits orders, posting rules
> map them to accounts, the kernel does the rest.

Inventory is the genuinely new primitive, because stock valuation is state the
ledger does not currently hold. That is the real engineering work.

**The governing principle: the ledger is the product. Everything else is a
source system or a view.** New modules add source systems; they never add a
second source of truth.

---

## 7. Honest assessment of cost

### Inventory costing is genuinely hard

Under Indonesian SAK (as under IFRS), **FIFO and weighted average are permitted;
LIFO is not.** Weighted average is the pragmatic F&B default and what we should
ship first. Costing touches every stock movement, must survive backdated entries
and period close, and is unforgiving of partial implementation.

### F&B needs more than generic inventory

- **Recipes / BOM** — a dish consumes many ingredients; COGS requires exploding
  the recipe at sale time, not decrementing a SKU.
- **Wastage and spoilage** — material in F&B, and must post as expense distinct
  from COGS or margin analysis misleads.
- **Yield and portioning** — 1kg purchased is not 1kg sold.
- **Daily cash reconciliation** — POS drawer versus deposit.

Shipping generic warehouse inventory into an F&B account would be worse than
shipping nothing: confidently wrong COGS.

### POS is a different reliability contract

A point of sale must keep taking orders when the internet drops — materially
different from a static dashboard over Firestore. **Integrate with existing POS
systems before building our own.** The financial value is in the postings, not
the terminal UI.

### Sequencing is driven by the customer problem, not the ERP ladder

**Do not sequence as** Finance → Accounting → Inventory → POS → ERP. That is an
ERP-centric mindset: it builds modules in the order a reference platform lists
them, and it will produce an inventory module before anyone has asked for one.

**Sequence along the chain a validated problem actually travels:**

```
Customer problem → Operational event → Financial impact
    → Financial intelligence → Business decision
```

Worked example, from the one explicit request we have:

```
"Which of my outlets is actually profitable?"   (Melisha, Pujasera Group)
    → outlet dimension on every posting
    → outlet-level revenue and cost
    → outlet P&L
    → AI explains why one outlet trails
    → owner changes something
```

Inventory enters that chain at the point where outlet-level COGS stops being
accurate — as the upstream that improves a figure, not as a destination. Which
module comes first therefore depends on which chain the evidence lights up, and
POS, inventory, purchasing, or a dimension may each legitimately be first.

### Current sequencing, on the evidence available 2026-08-15

1. **Outlet / entity dimension** — the only High-necessity **and** High-demand
   item (§5b). Per-outlet financial information cannot be produced without it,
   and it is the sole explicit unmet request on record. **Correction
   (2026-08-14): the plumbing does NOT already exist** — `entity_id` is the
   workspace id on every row, so this is a dimension built from scratch, not a
   switcher wired up. The line-level `dimension_id` seam has shipped because
   posted journals are immutable and it could not be retrofitted;
   `DIMENSION_SEAM_DESIGN.md` has the rest.
2. **Minimum inventory for financial correctness** — a periodic stock count
   posting one COGS journal. High necessity, **no verified demand**, so §5b caps
   it at the minimum rather than a module. `INVENTORY_DEMAND_VALIDATION.md` §5.
3. **Re-validate before expanding.** Purchasing, item master, per-SKU costing,
   POS and BOM stay unfunded until evidence supports them. Each has high
   financial necessity and, today, zero demand signal.
4. **Forecasting** — the Layer 4 gap; stronger once Layer 3 supplies real
   operational inputs.

Approvals and role dashboards are smaller and can interleave; both are
comparatively cheap and close visible gaps.

⚠️ **This ordering is provisional on evidence that was not readable when it was
written** — `sales_leads` in Firestore holds `business_type` and a free-text
message on every inbound lead. Re-run `INVENTORY_DEMAND_VALIDATION.md` §6 before
funding anything past step 2.

---

## 8. What stays true regardless

- **Bahasa-first, Indonesia-first — as market and foundation, not as ceiling.**
  SAK, PPN, and local operating reality are the default, not a localisation
  layer. This is a statement about where we are strongest and what we build into
  the foundation; it is not a limit on how large a business the product may
  serve (§1).
- **Growth-stage neutrality.** A design decision that works for a ten-person
  business but forecloses a fifty-entity one is a decision to re-litigate later.
  Prefer seams over ceilings — the cheapest version of this is a nullable field
  cut now rather than a migration against immutable data later.
- **Workspace-scoped finance data.** Every new collection follows
  `PROJECT_BACKGROUND.md` §4. A POS or inventory collection hardcoding
  `users/{uid}` shows invited members zero data.
- **The kernel is authoritative.** New modules post to it; they do not keep
  their own books.
- **Owner-legible, accountant-correct.** Readable by a non-accountant owner,
  defensible to an accountant.
- **Evolve, do not replace.** Existing modules, schemas, and product decisions
  stand unless they conflict with this document. Backward compatibility is the
  default.
- **We are not selling an implementation project.** If a capability needs
  consultants to deploy, we built it wrong for this market.

---

## 9. How to use this document

- **Proposing a module?** Answer §5, then §5a, then §5b. Unclear verb = boundary
  case; escalate, do not queue. A module that passes §5 but cannot answer §5a
  question 3 is a parallel set of books — and one that passes both but has no
  demand evidence gets the minimum capability, not the module (§5b).
- **Arguing a module is necessary?** Necessary and wanted are different claims.
  §5b requires both to be stated separately, with the demand side backed by
  labelled evidence rather than inference.
- **Proposing a feature inside an existing module?** This does not apply — use
  `product_ux_feature_intake_framework.md`.
- **Writing positioning copy anywhere** — docs, landing pages, `llms.txt`,
  structured data? §1 holds the canonical category and definition sentence. Use
  it verbatim; `npm run check:structure` fails the build if the canonical
  sources drift apart or a retired string reappears.
- **Tempted to describe a stage-based capability?** §1's stage table is
  direction. §3 is what exists. When they appear to disagree, §3 is right.
- **Writing docs or a roadmap?** §3 is the status baseline. Never describe a ✅
  capability as planned. If §3 disagrees with the code, re-audit and update §3
  rather than working around it.
- **Designing a data model?** §6 is binding: source system in, journal out, no
  parallel truth.
