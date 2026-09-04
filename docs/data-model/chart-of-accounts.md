# Chart of Accounts — Data Model (Phase 1, shipped)

The authoritative schema for the CoA foundation: the expanded account seed, the
founder-facing `business_categories` taxonomy, and how both bind to the
existing `accounting_mappings` resolution seam. Strategy background:
`docs/CHART_OF_ACCOUNTS_STRATEGY.md`; source research:
`docs/research/coa-strategy.md`.

**Scoping rule (mandatory):** all three collections are finance data and are
**workspace-scoped** — every read/write goes through `DataService._scope(userId)`
(`workspaces/{workspaceId}/…` in workspace mode). Never hardcode `users/…` paths
(PROJECT_BACKGROUND.md §4). Firestore rules for these collections exist only
under `workspaces/{workspaceId}` — a user-scoped write has no matching rule and
is denied by default.

## 1. `chart_of_accounts/{code}` (doc id = account code)

Single source of truth for the seed: `CHART_OF_ACCOUNTS_SEED` in
`assets/js/accounting-engine.js` (**46 accounts**; this line read "32" and
`accounting.md` read "33" while the seed held 34 — count it, don't quote it).
The db-service mapping catalog
(`ACCOUNTING_ACCOUNT_CATALOG`) and the Accounting Center mapping select
(`ACCOUNT_OPTIONS` in `accounting.js`) are both **derived** from it
(`mappable !== false` filter) — never edit them independently.

| Field | Type | Notes |
|---|---|---|
| `code` | string | 4 digits, `1000`–`9999`; equals the doc id (rules-enforced invariant); immutable; thousand block encodes type (1 asset, 2 liability, 3 equity, 4 revenue, 5/6/8 expense, 7 revenue/other-income) |
| `name` | string ≤120 | English display name; journal lines denormalize this at post time from the engine's in-module index — see caveat §5 |
| `name_id` | string \| null | Bahasa name (data for reports/AI; UI localization flows through `dashboard-i18n.js`) |
| `type` | enum | `asset` \| `liability` \| `equity` \| `revenue` \| `expense` — drives normal balance and signed trial-balance math |
| `subtype` | null | Reserved (deliberately unused; do not overload) |
| `sak_category` | enum | 16 Jurnal-style values in `SAK_CATEGORIES` (accounting-engine.js). `inventory` now has a seeded account (**1200**, dormant); `fixed_asset`/`accumulated_depreciation`/`long_term_liability`/`other_asset` remain reserved with no seeded account |
| `parent_code` | string \| null | One-level hierarchy; parent must exist, share `type` and thousand block (children: 641x under 6400, 4900 under 4000) |
| `is_system` | bool | Locked accounts: posting/tax engines hardcode them or default resolution targets them ({1000, 1100, 2000, 3000, 3900, 4000, 61xx–66xx, 6999} ∪ tax accounts). No edits, no archive |
| `normal_balance` | enum | `debit` \| `credit`; derived from type except contra accounts **3200 Prive** and **4900 Sales Discounts & Returns** which store `debit` explicitly (display-only — trial-balance signing uses `type`, so contra accounts show negative signed balances; correct, not a bug) |
| `is_active` | bool | Archive flag. Archived accounts drop out of pickers; history stays (trial balance reads `ledger_balances`) |
| `currency` / `entity_id` / `opening_balance` / timestamps | | As before |

### Seeding & backfill (`seedChartOfAccounts`, db-service.js)

Idempotent, runs on every Accounting Center load (best-effort; viewers fail
silently). One read, one batch:

- Missing code → full doc created.
- Existing doc **missing `sak_category`** → one-time merge backfill of
  `{sak_category, parent_code (existing wins), is_system, name_id, updated_at}`
  only. `name`, `type`, `is_active`, `opening_balance` are never touched, so
  user edits survive. After one run every doc has `sak_category` and later
  loads write nothing.
- Summary audit `chart_of_accounts.seeded` with `{created, backfilled}` counts.

### Mutation DAL & guard matrix (db-service.js)

`saveAccount` / `archiveAccount` / `reactivateAccount`; validation is pure
(`validateAccountDraft` in accounting-engine.js), all mutations audit-logged
(`chart_of_accounts.created|updated|archived|reactivated`). UI gate:
`FluxyWorkspace.can('accounting.post')`; rules gate: finance+ roles.

| Field / action | `is_system` | non-system |
|---|---|---|
| `code` | immutable (doc id) | immutable |
| `name` / `name_id` | blocked | allowed |
| `type` / `normal_balance` | blocked | blocked (Phase 1 allowlist excludes them) |
| `sak_category` / `parent_code` | blocked | allowed (parent same-type + same block) |
| archive / reactivate | blocked | allowed |
| delete | never (rules `delete: false`) | never |

`_accountInUse(userId, code)` (any `ledger_balances` row with activity) exists
for Phase 2's stricter edit rules; Phase 1's allowlist makes it moot for now.

## 2. `business_categories/{slug}` (doc id = deterministic slug)

The founder vocabulary over the CoA (the research report's "two-layer model" —
which FluxyOS already had structurally; this collection makes the category
layer data instead of hardcoded lists). Seeded by `seedBusinessCategories`
(idempotent, chained after the CoA seed in `accounting.js`).

| Field | Type | Notes |
|---|---|---|
| `name` | string ≤80 | For the built-in six, **byte-exact** with the hardcoded ledger lists (`Revenue`, `Marketing`, `Infrastructure`, `Operations`, `SaaS`, `Others`) — those lists are unchanged in Phase 1 |
| `name_id` | string | Bahasa display name |
| `type` | `income` \| `expense` | Income-side categories are dormant until Phase 3 (see §5) |
| `default_account_code` | string | Must exist in the seed; the category → account edge |
| `icon` / `color` | string \| null | Reserved for Phase 3 pickers |
| `is_active` | bool | Built-in six `true`; expanded 16 seed `false` until Phase 3 activates them in transaction pickers |
| `is_builtin` | bool | The six current categories |
| `sort_order` | number | Seed order |

Rules: read = all member roles; create/update = owner/admin/finance/accountant
(lean validation: name string ≤80, `default_account_code` string, `is_active`
bool — kept small for the rules eval budget); `delete: false`.

## 3. Binding to `accounting_mappings` (the resolution seam)

Posting resolution is unchanged (`resolveExpenseAccount`, accounting-engine.js):

```
accounting_mappings[category] → accounting_mappings[type]
  → CATEGORY_DEFAULTS → TYPE_EXPENSE_DEFAULTS → 6999 Other Expense
```

`seedBusinessCategories` also writes one
`accounting_mappings/transaction_category__{slug(name)}` doc per **expanded**
category (`confidence: 'system_default'`, `status: 'active'`) so activation in
Phase 3 needs zero engine changes. Invariants:

- Existing mapping docs (any confidence) are **never overwritten**.
- No mapping docs for the built-in six (engine `CATEGORY_DEFAULTS` covers them;
  also keeps the mapping tab's Suggested/Saved pills unchanged).
- No mapping for `Others` — 6999 stays a fallback-health signal, not a mapping.
- `_acctMapCache` is invalidated after seeding so the posting engine sees the
  new mappings immediately.

**Accepted behavior change (rollout note):** a manually-typed free-text
category whose name matches an expanded category (e.g. `Rent`) now resolves to
its mapped account (6420) instead of falling through to 6999. Intended
improvement, approved 2026-07-26.

## 4. Category taxonomy seed (22)

Built-in (active): Revenue→4000 · Marketing→6100 · Infrastructure→6300 ·
Operations→6400 · SaaS→6200 · Others→6999.

Expanded (inactive; mapping seeded): Payroll & Salaries→6410 · Rent→6420 ·
Utilities→6430 · Office Supplies→6440 · Travel→6450 · Meals &
Entertainment→6450 · Professional Services→6460 · Insurance→6400 ·
Training & Development→6400 · Cost of Goods→5100 · Bank Fees→6600 · Taxes→6500 ·
Owner Drawing→3200 · Discounts & Refunds→4900 · Owner Capital Injection→3100 ·
Interest Income→7100.

## 4b. Accounts seeded dormant (no engine posts to them yet)

Seeding an account before its engine exists is an established pattern here —
`1030 Payment Gateway Clearing`, `2800 Suspense`, and the six tax control
accounts all shipped this way. It keeps the chart complete, lets journal lines
resolve a name without a lookup, and means the engine that eventually posts does
not also have to migrate the chart.

| Code | Name (`name_id`) | `sak_category` | Why it is closed / open |
|---|---|---|---|
| `1200` | Inventory (Persediaan) | `inventory` | **Closed to both human surfaces**, like 1100 A/R and 2000 A/P: the balance must equal Σ(qty × unit cost) in the inventory subledger, which only holds if stock moves exclusively through it. Opening balances still reachable via `subtype: 'opening'` |
| `2050` | Goods Received Not Invoiced (Barang Diterima Belum Ditagih) | `other_current_liability` | Stock received before the supplier bill arrives. Closed for the 1030 reason — it clears by matching receipt to bill, so a manual entry leaves unmatchable residue |
| `5150` | Inventory Adjustment & Shrinkage (Penyesuaian & Susut Persediaan) | `operating_expense` | **Open on every surface.** Deliberately *not* `cogs`: COGS is the cost of stock a customer bought, and folding spoilage in makes gross margin absorb the loss it should expose (`PRODUCT_STRATEGY.md` §7). Writing stock off is a human judgement |

Two consequences worth knowing before the subledger ships:

1. **`1200` is a current asset in both statements, but only one of them was
   right by construction.** The balance sheet treats anything not in
   `NON_CURRENT_ASSET_CATEGORIES` as current, so it was always correct. The cash
   flow statement's `cashSectionOf` had the inverse default — anything not in
   `CURRENT_ASSET_CATEGORIES` is *investing* — so inventory movement was reported
   as investing cash flow. Fixed 2026-08-14; guard: "inventory is operating cash
   flow and a current asset" in `tests/statements-engine.spec.js`. The reason it
   could sit unnoticed is that the three cash-flow sections are a partition, so a
   misfiled account still ties out perfectly.
2. **The `CHART_SEED_VERSION` 2 → 3 heal rewrites `is_system` and the policy
   flags** on any doc below version — and it cannot tell a stale seeded doc from
   a user-created account that happens to share the code. A workspace that
   hand-made its own `1200` gets it converted to the locked system account. The
   drawer hands out 13xx for `sak_category: 'inventory'` (`SAK_CODE_RANGE` in
   `accounting.js`), so a collision is unlikely — but query production for
   existing `1200`/`2050`/`5150` before the subledger ships.

## 4c. `vendors/{vendorId}` — supplier master (previously undocumented)

Workspace-scoped (`firestore.rules` under `workspaces/{workspaceId}`), surfaced
at Accounting Center → Setup → Vendors (`assets/js/accounting.js`), DAL in
`db-service.js` (`getVendors`, `_vendorPayload`, cached via
`_loadVendorEntities`). It shipped without an entry in `PROJECT_BACKGROUND.md`
§4 or any shard, and without a place in the `qa-run.js` scope guard — both fixed
2026-08-14.

Shape worth copying for any future master-data collection (an inventory item
master is the obvious next one): deterministic `name_key` for dedupe, soft
archive via a status flag rather than deletion, `delete: if false` in rules, and
a `default_account_code` so the master participates in posting resolution
instead of duplicating it.

## 5. Caveats implementers must know

1. **Journal-line name denormalization.** `line()` in accounting-engine.js
   stamps `account_name` from the in-module seed index at post time, not from
   Firestore. Renaming an account doc does not rename history — and renaming a
   system account would desync future postings from the chart, which is why
   system accounts are rename-locked.
2. **Income-side mappings are dormant.** `TXN-INC-CASH` posts Cr 4000
   unconditionally; category mappings only affect the expense-side rules
   (`TXN-EXP-CASH`, `TXN-ACCRUE-AP`, `BILL-ACCRUE`, `SUB-ACCRUE`). The
   `owner-capital`→3100 and `interest-income`→7100 mappings are seeded data,
   live only when Phase 3 extends the income rule. `owner-drawing`→3200 works
   **today** via the expense path (Dr 3200 / Cr 1000 — a correct prive entry).
3. **Rules deploy is manual** (`firebase deploy --only firestore:rules`) and
   must precede shipping the JS. Emulator coverage:
   `tests/business-categories-rules-emulator-test.mjs`.
4. **Catalog derivation.** Adding an account to the seed automatically adds it
   to mapping validation and the mapping-tab select (unless `mappable: false`).
   There is no second list to update.
5. **Contra accounts** (3200, 4900) show negative signed balances in the trial
   balance when carrying balance — correct accounting, not a bug.

### Per-market tax accounts (2026-08-23)

The chart is **one set of 38 codes for every market**. Only the six tax accounts
are renamed per country:

| Code | ID (baseline) | PH | SG | MY |
|---|---|---|---|---|
| `1130` | PPN Masukan (Input VAT) | Input VAT | Input GST | Input Tax (SST) |
| `1140` | Prepaid PPh 25 | Prepaid Income Tax | Prepaid Income Tax | Prepaid Income Tax |
| `1150` | PPh Dipotong Pihak Lain | Creditable Withholding Tax (BIR 2307) | Withholding Tax Receivable | Withholding Tax Receivable |
| `2100` | PPN Keluaran (Output VAT) | Output VAT | Output GST | Output Tax (SST) |
| `2110` | PPh Payable | Withholding Tax Payable | Withholding Tax Payable | Withholding Tax Payable |
| `2200` | PPh 29 Payable | Income Tax Payable | Income Tax Payable | Income Tax Payable |

**The codes never change, and that is load-bearing.** Posting rules in
`accounting-engine.js`, `tax-engine.js` and `db-service.js` resolve accounts by
literal code, so a market that renumbered one would not fail loudly — it would
post to a missing account and corrupt the ledger silently. `check:structure`
asserts every market exposes the baseline's codes in the same order, and an
unknown country falls back to the Indonesian baseline unchanged.

Selected by `chartForCountry(country)` from `workspaces/{id}.country`, applied by
`seedChartOfAccounts`. The seeder's backfill branch **never renames an existing
account**, so a workspace seeded before this keeps its original names.

Seeded accounts now carry the workspace's `base_currency` rather than a hardcoded
`'IDR'`.

⚠️ **This is naming, not tax compliance.** The Tax Center remains Indonesian
PPN/PPh — a PH/SG/MY workspace gets correct bookkeeping with locally-named
accounts, not BIR/IRAS/LHDN filing. See `PROJECT_BACKGROUND.md` §4.

## 8. CSV import (`coa-import.js`)

Accounting Center → Chart of Accounts → **Import**. Engine
`assets/js/coa-import.js` (pure), surface the drawer in `accounting.js`, writer
`db-service.importChartOfAccounts`.

**The code is the upsert key**, which falls out of §1 rather than being a new
decision: the document id IS the code. An existing code updates that account; a
new one creates it. Xero works the same way, and that matters because Xero is
what people migrate *from* — a file exported there behaves the same here.

Two of Xero's documented traps do not exist for us, and the reasons are worth
keeping:

- Excel strips leading zeros from account codes. Ours are four digits in
  1000–9999, so there are none to strip.
- Changing a code *and* a name in one Xero file archives the account and creates
  a new one. Our code is immutable, so a code is either the same account or a
  different one — never a rename in disguise.

### What an import may not do

**System accounts are skipped, never updated.** The posting and tax engines
address `is_system` accounts by code, so renaming or re-typing one silently
re-points a journal. They are reported in the preview and left alone.

**Structural fields stay locked once an account has posted activity.** The
importer does not re-implement that — every write goes through `saveAccount`,
which already owns create-vs-update, the system guard, the in-use lock,
`validateAccountDraft` and the audit log. A second writer would have to
re-implement five rules and would eventually disagree with the drawer about what
a legal account is.

**It is not a Firestore batch, deliberately.** `saveAccount` reads the stored doc
to decide create vs update and to enforce the locks, and a batch cannot read.
Sequential writes also mean a parent is committed before the child that names it,
which is why rows are ordered parents-first. A failing row does not stop the
rest — refusing 99 good accounts because one names a dead category helps nobody.

### The template is the workspace's own chart

`buildCoaTemplateCsv` seeds from the live chart, not from a blank sheet. A blank
template makes somebody invent codes; their own chart makes the file a diff they
can edit, which is what importing an existing chart actually is. Its second row
is per-column guidance, and `analyzeCoaImport` skips it explicitly — leaving it
to the code check reported it as a bad code, so exporting the chart and importing
it straight back raised an error. An import that cannot round-trip its own
template is not one anybody will trust.

Guard: `tests/coa-import.spec.js`, including a test that pins the module's
block→type map to `accountTypeForCode` in `accounting-engine.js`. The two are
separate copies so this module stays loadable on its own; the test is what stops
them drifting. Note `9xxx` has no assigned type in either — a stricter copy here
would reject rows the real validator accepts.

## 9. The non-current sections were unreachable until 2026-08-29

`fixed_asset`, `accumulated_depreciation`, `other_asset` and
`long_term_liability` were valid `sak_category` values with **no seeded account
behind any of them**. `statements-engine.js` already classified all four
(`NON_CURRENT_ASSET_CATEGORIES` / `NON_CURRENT_LIABILITY_CATEGORIES`), so the
plumbing was complete and the accounts simply did not exist — a general
Indonesian UMKM had nowhere to put the motorbike, the oven or the bank loan, and
the balance sheet's non-current sections could never populate.

Seven accounts close it:

| Code | Name | Category |
|---|---|---|
| 1500 | Peralatan & Mesin | `fixed_asset` |
| 1510 | Kendaraan | `fixed_asset` |
| 1520 | Bangunan | `fixed_asset` |
| 1590 | Akumulasi Penyusutan | `accumulated_depreciation` |
| 1800 | Aset Tidak Berwujud & Lainnya | `other_asset` |
| 2700 | Utang Bank Jangka Panjang | `long_term_liability` |
| 6470 | Beban Penyusutan & Amortisasi | `operating_expense` |

**1590 is a contra-asset** and carries `normal_balance: 'credit'`, the same
treatment 3200 and 4900 get. Depreciation credits it rather than the asset, so
cost and accumulated wear stay separately visible — which is what a fixed-asset
register needs when one exists. **6470 is the other half of that entry**: without
it the credit had no matching debit account.

None are `is_system`. A business renames and archives these freely, unlike the
control accounts (1000, 1100, 1200, 2000, 2050) that the posting engine
addresses by code.

**This unblocks, but does not deliver, one-click depreciation.** That still needs
a fixed-asset register to run over — the accounts are the prerequisite, not the
feature. See the Flow tab's row 6.

⚠️ **Existing workspaces keep their old chart.** `seedChartOfAccounts` is
idempotent per code, so it adds missing accounts on its next run; a workspace
that has already seeded gets them only when that runs again. New workspaces get
all 45.
