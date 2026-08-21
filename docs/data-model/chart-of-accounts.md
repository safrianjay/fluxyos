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
`assets/js/accounting-engine.js` (**38 accounts**; this line read "32" and
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
