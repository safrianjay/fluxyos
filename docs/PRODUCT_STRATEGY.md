---
status: current
owns: [product vision, layer model, module scope, roadmap admission]
updated: 2026-08-07
verify: none — this document states intent and audited status, not behaviour
---

# FluxyOS Product Strategy

> **Single source of truth for what FluxyOS is, what is already built, and what
> belongs in it next.**
>
> §3 is a **reality audit**, verified against the codebase on 2026-08-07 — not a
> wish list. Nothing already shipped is described here as future work.
> §5 is the admission test every proposed module must pass.
>
> `PROJECT_BACKGROUND.md` §1 (positioning) and `ROADMAP.md` (sequencing) derive
> from this document. When they disagree, this wins.

---

## 1. Positioning — unchanged

**FluxyOS is a Finance Operating System.** That is the tagline, the category, and
how we describe ourselves to the market. It is not changing.

What has changed is our understanding of how *deep* a Finance OS must go before
the numbers it reports are true.

We serve two audiences at once, and the tension between them is the product:

| Audience | Wants | Needs from us |
|---|---|---|
| Owners & executives | A trustworthy answer to "how are we doing?" | Decision-grade KPIs, cash visibility, margin they can act on |
| Finance & accounting teams | To close the books correctly and on time | Double-entry rigour, SAK compliance, auditability, period close |

We do not choose between them. The executive view is trustworthy *because* the
accounting underneath is rigorous.

### Why "ERP" is a capability, not a label

We are deliberately not marketing FluxyOS as an ERP. The word signals
implementation projects, consultants, and long rollouts — the opposite of what
an Indonesian SMB will buy. But we will build ERP-class capability wherever it
makes the financial statements true.

**"Finance Operating System" is the promise. ERP depth is how we keep it.**

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
| Inventory & stock movement | 🔭 | Admitted §5. The missing input to true COGS. **Readiness assessed 2026-08-14 — `docs/INVENTORY_READINESS.md`.** Kernel is ready; the line-level dimension seam, cursor pagination, and the `1200`/`2050`/`5150` accounts have shipped as preparation. No inventory collection, page, or posting rule is built |
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

### Recommended sequencing

1. **Multi-entity completion** — finishes Layer 2 and unblocks branch
   reporting. **Correction (2026-08-14): the plumbing does NOT already exist.**
   `entity_id` is the workspace id on every row, so this is building a dimension
   from scratch, not wiring up a switcher. The line-level `dimension_id` seam
   has shipped because posted journals are immutable and it could not be
   retrofitted; `docs/DIMENSION_SEAM_DESIGN.md` has the rest. It is still the
   right thing to do first — inventory needs stock locations and per-outlet P&L
   needs entities, and those are one primitive.
2. **Inventory + purchasing** — makes existing COGS and gross margin true for
   every stock-holding customer, not only F&B.
3. **POS integration** — adapters reusing the commerce connector pattern.
4. **Recipes / BOM** — turns POS line items into ingredient-level COGS.
5. **Forecasting** — the Layer 4 gap; becomes far stronger once Layer 3 supplies
   real operational inputs.
6. **Own POS terminal** — only with evidence integration is insufficient.

Approvals and role dashboards are smaller and can interleave; both are
comparatively cheap and close visible gaps.

---

## 8. What stays true regardless

- **Bahasa-first, Indonesia-first.** SAK, PPN, and local operating reality are
  the default, not a localisation layer.
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

- **Proposing a module?** Answer §5. Unclear verb = boundary case; escalate,
  do not queue.
- **Proposing a feature inside an existing module?** This does not apply — use
  `product_ux_feature_intake_framework.md`.
- **Writing docs or a roadmap?** §3 is the status baseline. Never describe a ✅
  capability as planned. If §3 disagrees with the code, re-audit and update §3
  rather than working around it.
- **Designing a data model?** §6 is binding: source system in, journal out, no
  parallel truth.
