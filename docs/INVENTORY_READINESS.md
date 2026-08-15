---
status: current
owns: [inventory readiness verdict, pre-build preparation backlog]
updated: 2026-08-15
---

# Inventory Management — Structural Readiness

Assessment of whether FluxyOS can carry an Inventory Management module, and what
had to be prepared first so that inventory — and later POS — connect to the
ledger without being rewritten. **This is not an inventory spec.** No inventory
collection, page, or posting rule was built.

**Admission is settled; scope and priority are not.** `PRODUCT_STRATEGY.md` §5
admits inventory under *moves*, but §5b caps it at the **minimum capability
required for financial correctness** because a demand review on 2026-08-15 found
zero verified customer requests. Read `INVENTORY_DEMAND_VALIDATION.md` alongside
this — that document sets the scope, this one describes whether the foundation
can carry it.

---

## Verdict

**The accounting kernel is ready. The module scaffolding was not.**

The kernel is genuinely strong and should be reused rather than worked around: a
balanced double-entry engine with structured `GL_*` errors, atomic
document + journal + balances writes, transactionally-reserved journal numbers,
rules-enforced immutability and period gating, and four existing source systems
already posting into it. Inventory does not need a new kernel; it needs a new
source system and one new primitive.

Three structural gaps stood in the way. One of them could not be fixed after
inventory starts posting, so it was fixed now. The other two are cheap now and
expensive later.

| # | Gap | Status |
|---|---|---|
| 1 | **No dimension.** Stock needs a location; per-outlet P&L needs an entity. Same primitive, and it cannot be retrofitted onto immutable journals | **Seam shipped** — `dimension_id` on every journal line |
| 2 | **No cursor pagination.** `startAfter` appeared zero times; every read is `limit(1000)` + client-side filter, truncating silently | **Pattern shipped** — `getRecordsPage` |
| 3 | **No item master.** Nothing joins a marketplace SKU to a purchased good | **Specified, not built** (§5) |

Plus one latent defect that inventory would have walked straight into, now fixed
(§3), and a marketing surface that was selling inventory and POS capabilities
that do not exist, now corrected (§7).

---

## 1. What is ready — reuse, do not rebuild

| Capability | Where | Why it matters to inventory |
|---|---|---|
| Balanced journal engine, `GL_*` structured errors | `assets/js/accounting-engine.js` | Movement postings are ordinary journals; the rule table takes new entries without engine changes |
| Document + journal + `ledger_balances` + audit in one `writeBatch` | `_commitSourceCreate` ([db-service.js:664](../assets/js/db-service.js#L664)) | A movement can never exist without its journal |
| Transactional counter reservation | `_reserveJournalNumbers` ([db-service.js:4046](../assets/js/db-service.js#L4046)) | The one correct read-modify-write pattern in the kernel — copy it for cost state (§4) |
| Period close blocks posting at three layers | `wsPeriodOpen` ([firestore.rules:3139](../firestore.rules#L3139)) | Backdated stock movements are refused by the same gate as everything else |
| `sak_category: 'inventory'` reserved in the enum | `accounting-engine.js` | No enum churn needed |
| `5100 COGS` seeded and wired into both statement surfaces | `statements-engine.js`, `db-service.js` | Gross margin already has somewhere to land |
| Workspace scoping through one 12-line seam + CI grep guard | `_scope()`, `scripts/qa-run.js` | New collections inherit team sharing correctly |
| Flat additive `<module>.<verb>` capability list | `assets/js/perms-service.js` | `inventory.read` / `.create` / `.adjust` are appends, not a redesign |
| Composite indexes at 6 of Firestore's 200 | `firestore.indexes.json` | No index pressure |
| **Reusable precedents** | `vendors` (master data), invoice `items` (line items), commerce deterministic doc ids (idempotency), `ledger_balances` + `increment` (running totals) | Every shape inventory needs already exists somewhere |

**The upstream already exists.** Commerce sync ingests
`{sku, name, quantity, unit_price, subtotal}` from Shopee and TikTok Shop into
`commerce_orders` ([models.js:176](../netlify/functions/lib/commerce/models.js#L176)),
deduplicated by deterministic doc id. Nothing reads `items[]`. The
quantity-*out* signal is in production code today; what is missing is unit-cost
state and the quantity-*in* signal (purchasing/receiving).

---

## 2. The dimension — why it had to land first

`entity_id` is stamped on every journal, account, and balance, which makes the
codebase look multi-entity. It is not. `_resolvedScopeId()`
([db-service.js:3865](../assets/js/db-service.js#L3865)) returns the workspace
id, always. There is one entity per workspace by construction, and
`entity_name` is read in exactly one place ([revenue-overview.js:210](../assets/js/revenue-overview.js#L210))
and written nowhere — so the Revenue Overview's "Business" breakdown can only
ever produce one bucket.

`PRODUCT_STRATEGY.md` §7 justified sequencing multi-entity first on the grounds
that "the plumbing already exists". The plumbing is a field name. §3 and §7 have
been corrected.

**Posted journals are immutable by rule** ([firestore.rules:3947](../firestore.rules#L3947)).
A dimension added after stock movements exist cannot be backfilled — the only
remedy would be reversing and reposting real history, in periods that may be
closed. The field costs one null per line today.

Shipped: `dimension_id` on every journal line, `stampDimension()`,
document-level pass-through in `buildJournal`, and per-line reading in
`buildManualJournal`. Everything is `null` today, so behaviour is unchanged.
Reversals carry the dimension through `reverseLines`' spread — load-bearing,
because a reversal that dropped it would leave any breakdown permanently
unbalanced against a workspace total that nets to zero correctly.

Full design, including the `dimensions` collection and the
`ledger_balances_by_dim` rollup: **`docs/DIMENSION_SEAM_DESIGN.md`**.

**Deliberately deferred:** the rollup collection and its integrity assertion.
`ledger_balances` is derived from journals — `scripts/reconcile-ledger-balances.js`
proves the derivation is rerunnable — so a by-dim breakdown can be built from
journal lines whenever it is needed. With every line currently `null` the check
would pass vacuously and the repair would have nothing to rebuild. **The line
field was irreversible; the rollup is not.** That asymmetry is the whole reason
this split where it did.

---

## 3. The defect inventory would have walked into

`cashSectionOf` ([statements-engine.js](../assets/js/statements-engine.js))
classified an asset account as operating only if its `sak_category` was in
`['accounts_receivable', 'other_current_asset']`. `'inventory'` was in neither
that list nor `NON_CURRENT_ASSET_CATEGORIES`, so **the first inventory account
anyone created would have reported every stock movement as investing cash
flow.**

The reason this could sit unnoticed: the three cash-flow sections are a
*partition* of the non-cash accounts, so a misfiled account moves between
sections without breaking the tie-out. The statement balances perfectly and
reports the wrong thing. The balance sheet was right by exclusion (anything not
non-current is current), so only one of the two statements was wrong — the
harder case to spot.

Fixed, with a regression guard: *"inventory is operating cash flow and a current
asset"* in `tests/statements-engine.spec.js`.

---

## 4. Decisions taken, with rationale

### ⚠️ Superseded 2026-08-15 — read `INVENTORY_DEMAND_VALIDATION.md` first

This section was written on the assumption that inventory was coming at full
module scope. A demand review the next day found **zero verified customer
requests** for inventory, and `PRODUCT_STRATEGY.md` §5b caps a
high-necessity/no-demand module at the minimum capability required for
correctness — a periodic stock count posting one COGS journal, with no item
master, no SKUs and no stock movements.

**The costing decision below is therefore deferred, not reversed.** It becomes
live only if demand evidence funds the full module. The readiness findings in
§§1–3 and §6 stand unchanged: they describe the foundation, which is needed
either way.

### Costing: perpetual model, periodic workflow first *(deferred — see above)*

The docs disagreed. `CHART_OF_ACCOUNTS_STRATEGY.md:57` and
`ACCOUNTING_DISCOVERY_STRATEGY.md` §2.14 both proposed periodic (month-end count
→ one JE) as a cheap v1; `PRODUCT_STRATEGY.md` §7 assumed perpetual weighted
average. **Resolved: the data model is perpetual weighted-average from day one,
and a month-end physical count ships first as a `count` movement type on that
model.**

This gets the cheap workflow to users quickly without the model needing
replacement. Pure periodic cannot consume POS or commerce line items later —
per-sale COGS requires perpetual cost state — so it would be rewritten, which is
the rework this exercise exists to avoid. Weighted average, not FIFO: both are
permitted under SAK, LIFO is not, and weighted average is the pragmatic default.

**The hard part is cost state under client-side posting.** Moving-average cost is
read-modify-write from a browser. The pattern to copy is
`_reserveJournalNumbers` — a real `runTransaction`, the one place in the kernel
that does this correctly. The pattern **not** to copy is `_payBillOnce`
([db-service.js:865](../assets/js/db-service.js#L865)), which is read-then-write
and not transactional: two concurrent "mark paid" clicks can both observe
`outstanding > 0` and both commit. `scripts/repair-bill-settlement.js` exists,
which suggests this has already bitten.

### Segment: generic goods model, both retail and F&B

`PRODUCT_STRATEGY.md` §7 warns that shipping generic warehouse inventory into an
F&B account is "worse than shipping nothing: confidently wrong COGS", because
F&B needs recipes/BOM, wastage, and yield. **That warning was considered and
overridden — the v1 model serves both segments.** Two mitigations make that
defensible rather than reckless:

1. **A composite-item seam from day one.** The item master carries
   `type: 'stock' | 'composite'` (§5) so recipes/BOM become a later *population*
   of an existing field rather than a schema change.
2. **Wastage posts separately from COGS.** `5150 Inventory Adjustment &
   Shrinkage` is seeded as `operating_expense`, deliberately not `cogs` — see
   below.

The residual risk is real and should be named to F&B customers rather than
papered over: **until BOM ships, a dish that consumes many ingredients cannot
have its COGS exploded at sale time.** Decrementing a finished-good SKU is not
the same computation.

### Accounts seeded dormant

Seeding ahead of the engine is this codebase's own pattern — `1030`, `2800`, and
the six tax accounts all shipped that way. `CHART_SEED_VERSION` 2 → 3.

| Code | Name | Category | Policy |
|---|---|---|---|
| `1200` | Inventory / **Persediaan** | `inventory` | **Closed to both human surfaces**, like 1100 A/R and 2000 A/P: the balance must equal Σ(qty × unit cost) in the subledger, which only holds if stock moves exclusively through it. Opening balances still reachable via `subtype: 'opening'` |
| `2050` | Goods Received Not Invoiced / **Barang Diterima Belum Ditagih** | `other_current_liability` | Stock received before the supplier bill arrives. Without it, receiving either waits for the bill (understating inventory) or fakes an A/P entry against a vendor who has not billed (overstating payables, breaking the A/P aging tie-out). Closed for the 1030 reason — it clears by matching, so manual entries leave unmatchable residue |
| `5150` | Inventory Adjustment & Shrinkage / **Penyesuaian & Susut Persediaan** | `operating_expense` | **Open on every surface.** Not `cogs`: COGS is the cost of stock a customer bought, and folding spoilage in makes gross margin absorb the loss it should expose. For F&B, where wastage is routine and material, that is the difference between a margin an owner can act on and one that hides the problem |

⚠️ **Pre-flight check before the subledger ships.** The `seed_version` heal
rewrites `is_system` and the policy flags on any doc below version, and cannot
distinguish a stale seeded doc from a user-created account sharing the code.
Query production for existing `1200`/`2050`/`5150` first. The account drawer
hands out 13xx for `sak_category: 'inventory'`, so collision is unlikely rather
than impossible.

---

## 5. Item master — specified, not built

No `products`/`items` collection exists; bills and invoices carry free-text
descriptions. Build it on the `vendors` shape — the repo's proven master-data
pattern (deterministic `name_key`, soft archive, `delete: if false`,
`default_account_code` participating in posting resolution).

Two fields must exist from the first write, for the same reason `dimension_id`
did — they are cheap now and structural later:

- **`type: 'stock' | 'composite'`** — the recipe/BOM seam. A composite item
  explodes into components at sale time; a stock item decrements directly.
- **`sku`** — the join to `commerce_orders.items[].sku`, which is the only
  reason the existing marketplace feed becomes usable as a quantity-out signal.

---

## 6. Constraints any implementation must respect

1. **Rules evaluation budget is the throughput ceiling.** Three production
   incidents are recorded in `firestore.rules` (3367, 3526, 3546) from validators
   exceeding the 1000-expression limit — and emulator fixtures are lean enough to
   pass, so **it only bites in production**. A movement document written
   thousands of times a day needs a validator in the `business_categories` class
   ([firestore.rules:3880](../firestore.rules#L3880)): inline field checks, zero
   helper calls, **≤12 validated keys**. Not the `bills` class, which is the
   cautionary tale. Avoid `getAfter()` or cross-doc `get()` on the movement path
   entirely.
2. **Register new collections in both guard lists** — `PROJECT_BACKGROUND.md` §4
   rule 2 *and* `FINANCE_COLLECTIONS` in `scripts/qa-run.js`. `vendors` was in
   neither, so the guard was blind to it from the day it shipped (fixed, along
   with a new §4 rule 7 making the requirement explicit).
3. **Add to `isValidWorkspaceAuditLog`'s `target_collection` enum**
   ([firestore.rules:3214](../firestore.rules#L3214)) or the first audit write
   fails with a confusing permission error.
4. **Use deterministic doc ids for movement journals.** Firestore has no unique
   constraint; a deterministic id is the only real one available. Commerce
   already does this (`cm_{platform}_{shop}_{order}_rev`) and it is the
   strongest idempotency guard in the codebase. `accounting_status`/`journal_ref`
   is a convention, not a constraint.
5. **Do not attach `FluxyLive` to movements.** `watchCollection` binds
   `onSnapshot` to an unfiltered collection ref — every teammate's every write
   ships the full document to every open tab, billed per read, to show a refresh
   pill. Use the new `watchQuery` with a `where` narrowing to today.
6. **Pre-aggregate stock balances.** One `stock_balances/{item}__{location}` doc
   per item+location on the `ledger_balances` + `FieldValue.increment` model,
   *not* a global total document — a single Firestore doc sustains roughly one
   write per second, so a workspace-wide "total inventory value" doc is a
   hotspot.
7. **New page checklist:** classify in `APP_PAGES` (`scripts/prepare-deploy.js`
   — both site builds fail otherwise, intentionally), add a `PAGE_CONFIG` entry
   in `onboarding-gate.js`, register in `scripts/i18n-audit.js`, add sidebar nav
   + icon, and ship Bahasa keys. Rules and indexes deploy separately from
   `git push`.
8. **Bills have no line items and no edit/void correction path.** Receiving stock
   against a bill needs both. This is the largest unbuilt dependency after the
   item master.

---

## 7. The evidence gap (unresolved — read this before committing)

**No interview notes, feedback log, or feature-request record in this repository
asks for inventory or POS.** This is stated plainly because the module's case
currently rests on the §4 COGS argument alone, which is an argument about
correctness, not about demand.

- `ACCOUNTING_EXPERT_INTERVIEW_GUIDE.md` and `ACCOUNTING_DISCOVERY_STRATEGY.md`
  are **unfilled instruments** — a plan for six sessions, with a findings
  template and no findings.
- Beila, Get-Pipeline, Dika, and Pitto appear only in ledger-integrity incident
  records (`LEDGER_BACKFILL_RUNBOOK.md`, `ACCOUNTING_CENTER_IA.md`). Their
  recorded pain is *books that do not tie*, and none of it triggered inventory
  work.
- Of the three verified testimonials in `pricing.html`, two are F&B and **none
  mention stock**. Melisha Agustin (Pujasera Group) asks for **per-outlet P&L** —
  the dimension, not inventory. Azis Senna (Bakkery Bread) describes ingredient
  purchases landing in one place, which is the purchase side inventory would
  later consume.
- Contact-sales leads (`netlify/functions/submit-contact-sales.js` captures
  `business_type`) live in Firestore and are not readable from the repo. **That
  is the one place worth checking before committing engineering months.**

Circumstantial support does exist: the Beila investor deck states "19 SKUs at
53.5% gross margin", and commit `aeac37d` shows its COGS had to be stated
manually — a real customer computing gross margin outside FluxyOS.

**Recommended validation before build:** query the contact-sales collection by
`business_type`, and run the discovery sessions the interview guide already
specifies. The preparation work in this document is correct either way, which is
why it did not wait for the answer.

---

## 8. What shipped in this pass

| Change | Files |
|---|---|
| Inventory classified as operating cash flow + regression test | `assets/js/statements-engine.js`, `tests/statements-engine.spec.js` |
| `1200` / `2050` / `5150` seeded dormant; `CHART_SEED_VERSION` → 3 | `assets/js/accounting-engine.js` |
| `dimension_id` on journal lines + `stampDimension` + pass-through | `assets/js/accounting-engine.js` |
| Dimension seam design | `docs/DIMENSION_SEAM_DESIGN.md` |
| `getRecordsPage` cursor pagination + end-to-end test | `assets/js/db-service.js`, `tests/cursor-pagination.spec.js` |
| `watchQuery` query-scoped live watcher | `assets/js/db-service.js` |
| `vendors` added to the scope guard + new §4 rule 7 | `scripts/qa-run.js`, `docs/PROJECT_BACKGROUND.md` |
| Doc drift: account counts, stale `cost_of_revenue` claim, `vendors`, `keyword` mappings | `docs/data-model/accounting.md`, `docs/data-model/chart-of-accounts.md` |
| POS / SKU / branch-P&L claims corrected incl. JSON-LD | `use-cases/{retail-franchises,ecommerce-brands}.html` + `/id/` mirrors |

**Not built, by design:** any inventory collection, page, or posting rule; the
`dimensions` collection and `ledger_balances_by_dim` rollup; conversion of
`ledger.html` to cursor pagination.

`ledger.html` was left alone deliberately. It loads 1,000 records and computes
its filters, sort, summary cards, charts, and CSV export client-side from that
array — summary cards cannot be computed from page one of a cursor. Converting
it is a page rearchitecture with its own QA, not a drop-in, and doing it as a
side effect of inventory prep is how the ledger breaks.

---

## 9. Recommended sequence from here

*Revised 2026-08-15 against the demand evidence — see
`INVENTORY_DEMAND_VALIDATION.md` §4.*

1. **Finish the dimension**: `dimensions` collection, `ledger_balances_by_dim`
   rollup + its integrity assertion, and the UI on the existing
   `entity-menu-add` stub. The only High-necessity **and** High-demand item —
   per-outlet profitability is the sole explicit unmet request on record.
2. **Minimum inventory for correctness**: a periodic stock value per period
   posting one COGS journal (Dr `5100` / Cr `1200`). No item master, no SKUs, no
   movements. Discharges the financial-correctness case in full and doubles as a
   demand instrument.
3. **Re-validate before expanding.** Item master, purchasing/receiving, per-SKU
   costing, POS and BOM stay unfunded until evidence supports them.
4. Only if funded: **inventory movements + weighted-average costing**, then
   **POS integration**, then **recipes/BOM**.

The earlier version of this list put demand validation first and then assumed the
full module. The validation has now been run against everything readable in the
repo; what it found is that step 1 outranks inventory entirely, and step 2 is
smaller than this document originally scoped.
