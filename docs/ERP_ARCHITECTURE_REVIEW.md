---
status: current
owns: [ERP-benchmark evaluation, pre-inventory structural decisions]
updated: 2026-08-14
---

# FluxyOS as an ERP — architecture review

Benchmarked against Oracle NetSuite, SAP Business One, SAP S/4HANA, and Odoo.
The question is not "which features are missing" but **whether the structure can
carry ERP-class modules without being rebuilt.** Companion to
`docs/INVENTORY_READINESS.md`, which assessed inventory specifically; this takes
the longer view.

---

## 1. The spine every one of those platforms shares

Strip NetSuite, SAP B1, S/4HANA and Odoo down and they are the same seven-layer
machine, in this dependency order:

```
  Master data      →  partners, items, UoM, locations, price lists, tax codes
  Documents        →  header + LINES, each line carrying account, tax, dimension
  Document flow    →  base doc copies to target doc (PO → receipt → invoice)
  Account determ.  →  rules mapping a line to a G/L account
  Subledgers       →  A/R, A/P, stock — reconciling to control accounts
  General ledger   →  balanced, immutable, period-controlled
  Dimensions       →  cost centre / profit centre / branch on every line
```

**FluxyOS has layers 4–6 built to a genuinely high standard and layers 1–3
almost not at all.** That inversion is the finding. Most SMB finance tools have
the opposite problem — a rich document UI over a fake ledger. FluxyOS built the
hard half first, which is the right half to have built, and it means the
remaining work is additive rather than corrective.

### Scorecard

| ERP layer | Benchmark equivalent | FluxyOS | |
|---|---|---|---|
| General ledger | S/4 ACDOCA, Odoo `account.move` | Balanced, immutable, numbered, period-gated | ●●●●● |
| Account determination | SAP OBYC / B1 G/L Account Determination | `selectRule` + `accounting_mappings` resolution chain | ●●●●○ |
| Subledger control | A/R, A/P control accounts | 1100/2000 closed to human posting; aging ties to BS | ●●●●● |
| Period control | Posting-period variant, close & carry-forward | Close posts to retained earnings; reopen reverses | ●●●●○ |
| Dimensions | Cost/profit centre, segment | `dimension_id` seam only; no master, no rollup | ●○○○○ |
| Documents with lines | `account.move.line`, marketing documents | Invoices only, and lines don't post | ●○○○○ |
| Document flow | 3-way match, copy-to | 3 payment-link fields; no PO/receipt chain | ○○○○○ |
| Master data | Business Partner, Item, UoM, price list | `vendors` only | ●○○○○ |
| Workflow / approvals | Approval matrices | Disabled "Soon" stub | ○○○○○ |
| Extensibility | Odoo modules, SuiteScript, UDF/BAdI | Manual registration in ~9 files | ●○○○○ |

---

## 2. What is genuinely ERP-grade (do not trade this away)

These are unusual in an SMB product and worth naming, because the temptation
when adding modules is to bypass them for speed:

- **Posting is rule-driven, not hardcoded per screen.** `selectRule` → rule table
  → account resolution chain (`explicit → category mapping → type mapping →
  defaults → 6999`) is structurally the same idea as SAP's account
  determination. New source systems add rules, not posting code.
- **Subledger discipline is enforced by the database, not by convention.**
  1000/1100/2000/3000/3900 and the tax control accounts are closed to both human
  posting surfaces, so A/R and A/P can only move through their subledgers. This
  is why the aging report ties to the balance sheet by construction. Most SMB
  tools let a user journal straight into A/R and quietly break it.
- **Journals are immutable; corrections are reversals.** Audit-grade, and it is
  what makes a real period close possible.
- **Period close is real** — closing journal to retained earnings, and a reopen
  that reverses it.
- **Integration ingestion is idempotent by deterministic document id**
  (`cm_{platform}_{shop}_{order}_rev`), which is the correct pattern and stronger
  than the `accounting_status` convention used elsewhere.
- **Multi-tenancy is properly seamed** — one `_scope()` function with a CI guard.

**The kernel is not the problem. Everything above the kernel is.**

---

## 3. Structural gaps, in priority order

### 3.1 There is no master data layer — the defining gap

An ERP is a master-data system that happens to keep books. FluxyOS keeps books
and has almost no master data.

| Master | NetSuite / SAP B1 / Odoo | FluxyOS |
|---|---|---|
| Vendor | Business Partner (vendor role) | ✅ `vendors` |
| **Customer** | Business Partner (customer role) | ❌ `customer_name` is a **free-text string on the invoice** |
| **Item / product** | Item master with costing method | ❌ nothing; invoice lines are free-text `description` |
| **Unit of measure** | Purchase/stock/sales UoM + conversion | ❌ nothing |
| **Location / warehouse** | Warehouse, bin | ❌ nothing (dimension seam only) |
| **Price list** | Price lists, customer-specific pricing | ❌ nothing; `unit_price` typed per line |
| Tax code | Tax code per line | ⚠️ one `tax_rate_percent` on the **header** |

Consequences that land directly on the next two modules:

- **Inventory is an item-master module.** Quantity and cost are attributes *of an
  item at a location*. Without the master there is nothing to hold them.
- **POS is a customer-and-price-list module.** A terminal needs to look up a
  price and attach a buyer. Both are free text today.
- **UoM absence breaks F&B costing specifically.** You buy flour in kg and sell
  it in portions. Without conversion factors, weighted-average cost per unit is
  not computable — and this is independent of recipes/BOM.
- **No landed cost.** For the e-commerce importers FluxyOS serves, freight and
  duty belong *in* item cost. With no item master there is nothing to capitalise
  onto, so margin is overstated by the entire import cost.
- **No batch / lot / expiry.** F&B needs expiry; it is also a costing dimension.

**Recommendation: build master data as one layer, not per module.** Follow SAP
B1's Business Partner idea — one partner record with customer/vendor roles —
rather than a `customers` collection bolted beside `vendors`, or a marketplace
buyer will exist in three places. `vendors` is already the right shape
(deterministic `name_key`, soft archive, `delete: if false`,
`default_account_code` participating in posting resolution); generalise it.

### 3.2 Documents post in aggregate, not by line

Invoices carry an `items` subcollection with `quantity`, `unit_price`, `amount` —
and `INV-ISSUE` posts **one** revenue line for the header total. The lines are
display data that never reach the ledger. Bills have no lines at all.

In every benchmark platform the line is the posting unit: each line carries its
own G/L account, tax code, dimension, and (for stock) item and quantity. That is
what makes per-item margin, per-branch P&L, and mixed-rate tax possible at all.

This is the second hard prerequisite for inventory. A goods receipt is a
document whose *lines* move stock; a sale posts COGS *per line*. Neither is
expressible against a header-total posting model.

### 3.3 There is no document flow

The procure-to-pay spine of every reference platform is:

```
  Purchase Order → Goods Receipt (stock in, GRNI up) → A/P Invoice (GRNI down, A/P up) → Payment
```

with three-way matching and tolerances between them. FluxyOS has three linkage
fields (`linked_bill_id`, `linked_invoice_id`, `linked_transaction_id`) and all
three are payment settlement. There is no purchase order, no goods receipt, no
partial receipt, no return, and no credit/debit note.

`2050 GRNI` now exists as an account, which is the ledger half. The document half
does not. **Inventory *is* the goods-receipt step** — this is not adjacent work.

### 3.4 Tax is header-level

`tax_rate_percent` sits on the invoice header, so every line is taxed alike. An
Indonesian retail basket mixes standard PPN, exempt items, and *DPP nilai lain*
treatments. Retail and F&B POS hit this on day one, and it cannot be
retrofitted onto a header field without reworking every posted document — the
same immutability trap as the dimension.

Tax codes belong on the line, alongside account and dimension.

### 3.5 No metadata registry — the reason module cost grows superlinearly

The finance-collection set is enumerated **four times, and the four disagree**:

| Location | Collections | State |
|---|---|---|
| `scripts/qa-run.js` `FINANCE_COLLECTIONS` | 34 | current |
| `docs/PROJECT_BACKGROUND.md` §4 rule 2 + rule 6 regex | 34 | current |
| `.claude/hooks/qa-gate.sh` `FIN_RE` | 33 | **missing `vendors`** |
| `scripts/migrate-to-workspaces.js` `FINANCE_COLLECTIONS` | 13 | **badly stale** — no journals, counters, ledger_balances, periods, chart_of_accounts, tax_*, commerce_* |

The migration script is one-shot and has already run, so the stale copy is
mostly inert — but it would silently under-migrate a workspace if re-run, and it
is the clearest possible symptom of the actual problem.

Adding one module today means hand-editing **at least nine registration
points**: `prepare-deploy.js` `APP_PAGES`, `onboarding-gate.js` `PAGE_CONFIG`,
`i18n-audit.js` `APP_PAGES`, `sidebar-loader.js` nav + icon map,
`perms-service.js` `CAPABILITIES`, `firestore.rules` match block *and*
`isValidWorkspaceAuditLog` enum, the four collection registries above,
`docs-read-gate.sh` shard map, a data-model shard, and `firestore.indexes.json`.

In Odoo a model is declared once and the ORM, ACL, views, and menus derive from
it. In NetSuite a custom record type gets permissions and UI automatically. Here
every cross-cutting concern re-enumerates the world by hand, so drift is not a
risk — it is the observed default. **This is what makes "become an ERP" expensive
in a way that no single feature reveals.**

**Recommendation:** one declarative module manifest (collection names, scope,
roles, nav entry, page classification, shard) that the guards, the deploy
script, and the docs gate all *read* instead of restate.

**Shipped as a first step — measure the drift while the manifest doesn't exist.**
`tests/structure-drift.check.js` (`npm run check:structure`, and unconditional in
the QA BE lane) verifies the claims this repo makes about itself in more than one
place:

| Check | Catches |
|---|---|
| Registry parity | the three live registries disagreeing (they read 34 / 33 before this) |
| **Rules coverage** | a collection getting a `firestore.rules` block and no registry entry — the `vendors` bug, **at its source** |
| Seed count | prose quoting an account count the seed no longer has |
| Seed codes | duplicate account codes (the seed is keyed by code as the doc id) |
| Shard index | `docs/data-model/` and the §4 shard table diverging, in both directions |
| **Statement coverage** | a seeded asset/liability `sak_category` in no classification list — **the exact inventory-as-investing bug** |
| **Positioning** | the canonical category drifting across its six sources, a retired category string reappearing, or SMB-ceiling phrasing returning — four competing category strings were shipping simultaneously before 2026-08-15 |

Two of these deserve emphasis because they are *preventive* rather than
descriptive: rules coverage means a future `stock_movements` collection cannot be
added without being registered, and statement coverage means a future
`fixed_asset` or `long_term_liability` account cannot be seeded without being
classified in both statements. Both failure modes are silent at runtime — that is
precisely why they need a checker rather than a convention.

All seven are mutation-tested: each was verified to fail when its invariant is
broken, then restored — including a false-positive guard confirming that
legitimate segment discussion ("Indonesian SMBs are the current beachhead")
still passes. A check that cannot fail is worse than no check, because
it reports green.

### 3.6 Client-side posting is the architectural ceiling

Every benchmark platform posts server-side inside a database transaction.
FluxyOS posts from the browser, and the documented consequence is that Firestore
rules "cannot sum `lines[]`" — a client can submit balanced totals over lopsided
lines. Compensating controls (trial balance, nightly sweep, reconcile script) are
detection, not prevention.

This has been an acceptable trade while every posting is a small, independent
document. It stops being acceptable at exactly the two modules now planned:

- **Perpetual costing is read-modify-write on shared state.** Moving-average cost
  must serialise per item; browsers racing over a cost document is the wrong
  place for that.
- **POS is high-frequency and multi-terminal**, with a different reliability
  contract (it must keep selling when the network drops).

**Recommendation:** decide the posting boundary *before* inventory, not during.
The narrow version — a server-side posting endpoint that owns stock movements
and costing only, leaving today's client posting untouched for ordinary
documents — is likely right, and it also gives POS somewhere to post to later.

### 3.7 Three different concurrency patterns for the same problem

| Operation | Pattern | Correct? |
|---|---|---|
| Journal numbering | `runTransaction` over `counters/journal-{YYYY}` | ✅ |
| Invoice numbering | read latest by `orderBy` desc, +1 | ❌ two concurrent drafts collide |
| Bill payment | read `outstanding`, then write | ❌ two clicks can both commit |

One codebase, one problem, three answers — and only one counter series exists
(`counters/journal-{YYYY}`) where ERPs have numbering series per document type
per year. Generalise the counter pattern; it is already built and proven.

### 3.8 More than one source of the same figure

Net income / gross profit is computed independently in `statements-engine.js`
(ledger-derived, authoritative), `report-builder.js` (records-derived, `/reports`),
and `db-service.js` (`_buildIncomeStatementBuckets` preview) — with the Overview
adding its own aggregation. `docs/data-model/accounting.md` already records "a
third P&L still exists at `/reports` and a second Balance Sheet at `/reports`."

`PRODUCT_STRATEGY.md` §6 says the ledger is the product and everything else is a
source system or a view. Three P&Ls is three answers to one question, and it is
the thing an accountant will find first.

### 3.9 Missing pieces that are smaller but real

- **No approval workflow.** ERPs gate exactly what inventory and POS generate —
  stock adjustments, write-offs, voids, refunds, discounts above threshold.
- **No FX revaluation.** Invoices are multi-currency and the ledger converts at
  payment, but open foreign-currency balances are never revalued at period end,
  so `7200 FX Gain/Loss` only ever sees realised movement.
- **Bills have no lifecycle.** No edit, no void, no correction path — so a
  mis-received stock quantity against a bill has nowhere to go.

---

## 4. The three decisions to take before inventory

Everything above reduces to three calls. They are ordered by how expensive they
get if deferred.

**1. Does the line become the posting unit?** (§3.2, §3.4)
Yes, and it should land before inventory. Line-level posting with account, tax
code, and dimension per line is the single change that unblocks per-item COGS,
per-branch P&L, and mixed-rate tax simultaneously. Deferring it means posted
documents that later have to be reworked — and journals are immutable.

**2. Where does the master data layer live?** (§3.1)
Build partners / items / UoM / locations as *one* layer with one shape, one rules
pattern, one UI pattern — generalising `vendors` — rather than each module
bringing its own. A per-module master is how you end up with a buyer in three
tables.

**3. Where does posting happen for shared mutable state?** (§3.6)
Draw the boundary now. Client posting stays for ordinary documents; stock
movements and costing get a server-side owner. Choosing this during inventory
means choosing it under deadline pressure, which is how the browser ends up
owning cost state permanently.

Two more that are cheap and should ride along: generalise the counter pattern to
document numbering series (§3.7), and introduce the module manifest (§3.5) —
that one pays for itself on the second module, and inventory plus POS is two.

---

## 5. Revised sequence

`INVENTORY_READINESS.md` §9 proposed: validate demand → dimension → item master →
purchasing → costing → POS. That ordering still holds; this review inserts two
structural steps and sharpens one.

1. **Validate demand.** Still the only open question — no recorded user request
   for inventory or POS exists in the repo.
2. **Module manifest** (§3.5). Small, and every step below is cheaper after it.
3. **Master data layer** (§3.1) — partners (customer + vendor roles), items with
   UoM, locations. This subsumes "item master" and "dimensions collection" from
   the earlier plan, because locations and dimensions are the same record.
4. **Document lines as the posting unit** (§3.2) + **line-level tax** (§3.4).
   Retrofit invoices onto it first, since they already have lines; bills gain
   lines here, which is what receiving needs.
5. **Document flow: PO → goods receipt → bill**, clearing through `2050 GRNI`
   (§3.3). This is the purchasing module and the stock-in path in one.
6. **Posting boundary decision** (§3.6), then **inventory movements + costing**,
   periodic count first.
7. **POS integration**, then **recipes/BOM**.

Steps 3, 4 and 5 are the ERP work. Costing — the part that feels hardest — is
step 6, and it is comparatively contained once the three below it exist.

---

## 6. Honest summary

FluxyOS is **an accounting kernel of genuine ERP quality with an SMB-app document
layer on top.** The kernel would not embarrass itself next to SAP B1's; the
master data and document layers are roughly where a bookkeeping tool sits.

That is a *good* position, because the kernel is the part that cannot be
retrofitted and the document layer is the part that can. But it means the honest
answer to "are we heading toward ERP?" is: **the direction is right and the
foundation is right, and the next three modules are not features — they are the
missing middle of the platform.** Treating item master, document lines, and
document flow as prerequisites rather than as parts of "the inventory feature" is
the difference between an ERP and a finance app with a stock screen.
