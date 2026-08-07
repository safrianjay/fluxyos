---
status: current
owns: [accounting_mappings, journals, ledger_balances, periods, counters]
updated: 2026-08-07
source: docs/PROJECT_BACKGROUND.md §4 (sharded 2026-08-07)
---

# Accounting Mappings & Kernel

> Workspace-scoping rules for these collections live in
> [`PROJECT_BACKGROUND.md` §4](../PROJECT_BACKGROUND.md#4-firestore-database-schema).
> Read that first — it is always loaded; this shard is not.

### 4m. Accounting Mappings — `users/{userId}/accounting_mappings/{mappingId}`

Accounting Center (Phase 1) saved category/type → accounting-account mappings.
**Strings/enums only — never store amounts or formatted currency here.** Doc id is
deterministic (`{source_type}__{source_value}` slugified), so re-saving a source
updates the same doc instead of duplicating.

| Field | Type | Notes |
|-------|------|-------|
| `source_type` | string | `"transaction_category"` \| `"transaction_type"` |
| `source_value` | string | The category label or transaction type being mapped (≤60 chars) |
| `target_account_code` | string | Account code, e.g. `"6100"` (≤12 chars) |
| `target_account_name` | string | Account name, e.g. `"Marketing Expense"` (≤80 chars) |
| `target_account_type` | string | `asset` \| `liability` \| `equity` \| `revenue` \| `expense` \| `contra_revenue` \| `contra_expense` |
| `confidence` | string | `system_default` \| `user_confirmed` \| `ai_suggested` (saves write `user_confirmed`) |
| `status` | string | `active` \| `archived` |
| `created_at` / `updated_at` | Timestamp | Server-set; `created_at` is preserved on update |

**Rules:** owner read/create/update; `delete: if false`; `source_type`/`source_value`
immutable on update; field-validated by `isValidAccountingMapping`. Saving writes an
audit log (`accounting_mapping.created`/`.updated`, target `accounting_mappings`).

**Accounting Center.** `accounting.html` + `assets/js/accounting.js`. Navigation is
**two-level** (shipped 2026-07-29, `docs/ACCOUNTING_CENTER_IA.md` Phase 1): a primary
group row (`.acct-tabs`, `data-acct-group`) over a child view row (`.acct-subtabs`,
`data-acct-tab` + `data-acct-parent`). Panel ids are unchanged.

| Group | Views (`data-acct-tab`) |
|-------|-------------------------|
| **Reports** | `income` · `balance` · `cashflow` · `aging` |
| **Ledger** | `journals` · `ledger` · `trial` |
| **Setup** | `coa` · `mapping` · `vendors` |
| **Close** | `close` · `cleanup` |

Groups follow the accounting funnel rather than ship order. Child buttons for
inactive groups carry the `hidden` attribute — **Playwright specs must route through
`tests/helpers/accounting-nav.js` `openAccountingTab()`**, never click
`[data-acct-tab=…]` directly. Views are linkable via `?tab=<id>`; `setTab()` resolves
the owning group, so cross-page drill-downs (`drillToLedger`) activate both levels.
Default landing is Reports → Income Statement. The cleanup count shows on its own
view and rolls up to the Close group badge.

**Overview is a header dropdown, not a group** (`#acct-overview-btn` /
`#acct-overview-panel`, moved there 2026-08-07 in place of the Export package
button). It holds Books health + Before you close, carries an attention dot when a
check fails or work is outstanding, and keeps the exports in its footer — that
button was the export's only entry point. `render()` therefore calls
`loadKernel()` outright: the dot reads trial-balance and unposted state, which used
to load only because Overview was in `KERNEL_TABS`. `?tab=overview` opens the panel.
See `docs/ACCOUNTING_CENTER_IA.md` §Overview.

**Export: one workbook or five CSVs, from one row model (2026-08-07).** The panel
footer offers **Export workbook** (`#acct-export-workbook`, primary) and **CSV
files** (`#acct-export-package`, secondary — same id, so its existing
disabled/label handling is unchanged). Both call `runAccountingExport(format)`,
which shares the readiness gate, the confirm, the working-papers fetch, the
integrity block, the `report_exports` row, and the audit log; only serialization
differs.

`accountingPackageSheets()` returns the package **as data** — per statement a
`{key, title, filename, columns, rows}`. `accountingPackageFiles()` serializes it
to CSV; `netlify/functions/statements-xlsx.js` serializes it to workbook tabs. A
line added to a statement therefore appears in both formats and they cannot drift.

The function is a **formatter only** — it computes no balances and reads no
Firestore; the client posts rows the ledger already produced. Re-deriving
statements server-side would be the second source of truth §6 of
`PRODUCT_STRATEGY.md` forbids. It uses SheetJS (already a dependency, already
bundled for *reading* spreadsheets in `bank-statement-extract-background.js`).
Amounts stay JS numbers into the cells so Excel treats them as numbers — a
workbook of strings cannot be summed, which is the only reason to prefer it over
CSV. Guard: `npm run check:statements-workbook` (unreachable from Playwright,
which serves static files with no functions).

⚠️ **Every cell under an `(IDR)` header must be an amount.** The Balance Sheet
used to end with an `As of period` row carrying a *date* in the amount column —
invisible in a text editor, wrong the moment the column is summed or read as a
number. The date now lives in the file's header block. `balanceSheetRows()` is
data only; `balanceSheetCsv()` adds the header for the standalone download.
`tests/accounting-export-package.spec.js` asserts `/^-?\d+$/` per amount column
rather than scanning the file for `Rp` — the General Ledger has a free-text Memo,
so a user typing "Bayar sewa Rp5.000.000" failed a whole-file scan on a correct
export.

**Close gate (2026-07-31).** "All entries posted to the ledger" is backed by
`DataService.countUnpostedSources`, not `countPendingPostings` — the latter matches
`accounting_status:'pending'` only, so a **never-queued** source (no flag at all) was
invisible and periods could be closed over an incomplete ledger. Terminal states are
`'posted'` **and** `'excluded'`; invoice-linked sources block like any
other — `INV-ISSUE` is wired (`Dr A/R / Cr Revenue`), so an unposted `INV-PAY` is an
ordinary gap (corrected 2026-08-01; see `docs/ACCOUNTING_CENTER_IA.md` §11).
`closePeriod()` enforces the same rule server-side — the UI gate mirrors it. The
remedy is `postUnpostedSources()`, exposed as "Post N unposted entries" on the Close
panel and folded into the Journals banner; it shares `_collectUnpostedSources()` with
the gate so the two cannot drift. Historical/multi-workspace gaps still go through
`docs/LEDGER_BACKFILL_RUNBOOK.md`.

**Statements are ledger-derived and load eagerly** with the page, because the KPI
strip reads the same `getFinancialStatements` result — strip, statement, and Trial
Balance therefore cannot disagree. The Income Statement carries a comparison column
(equal-length preceding window) and drills account line → General Ledger → Journal
Detail → source. `getIncomeStatementPreview` is **no longer a statement source**; it
remains the readiness/confidence source only.

> ⚠️ **Phase 2 is code-complete but NOT cleared for cutover.** On the QA workspace
> the ledger reports a Rp379m loss where the retired preview reported a Rp4.2bn
> profit, because **160 of 182 income transactions have no journal** (`pendingPostings
> = 0` — absent, not queued). Integrity checks pass (IS net income == Trial Balance,
> delta Rp0), so this is a data gap, not an engine bug. **The QA backfill has since
> RUN** (2026-07-29): coverage 85.7% → 96.9%, tie-out Rp0, and July net income moved
> from a Rp379m loss to a Rp1.05bn profit. The residual gap is the known unwired
> `INV-ISSUE` rule (23 invoice-linked txns).
>
> **Fix procedure: `docs/LEDGER_BACKFILL_RUNBOOK.md`** (`backfill-journals.js` →
> `backfill-journal-numbers.js` → `reconcile-ledger-balances.js`; all dry-run by
> default). Measure with **`scripts/ledger-coverage-report.js`** (authoritative) —
> not `listJournals`, which caps at `max:200` and filters period client-side.
> **Real user workspaces are still unbackfilled** (Beila 5.4%, Get-Pipeline 0%) and
> must be resolved before cutover. `docs/ACCOUNTING_CENTER_IA.md` Phase 2.
>
> A third P&L still exists at `/reports` and a second Balance Sheet at
> `/reports`. Read the IA doc before adding any statement.

The **Statements** tab is the ledger-derived Income Statement + Balance Sheet
(`DataService.getFinancialStatements`, pure `assets/js/statements-engine.js`).
It reads `ledger_balances` — the SAME source as the Trial Balance — so it can
never disagree with it, unlike the transactions-only Income Statement *preview*
on the first tab. The P&L is period-range MOVEMENT (Revenue → COGS → Gross
Profit → OpEx → Operating Income → Other Income/Expense → Net Income); the
Balance Sheet is CUMULATIVE through the period end with a real equity section
(owner capital, retained earnings, prive, opening equity, + a computed
Current-period-earnings line) and a tie-out badge. The tie-out is a real
integrity signal — Assets = Liabilities + Equity holds for balanced journals, so
a non-zero delta means the `ledger_balances` snapshot itself drifted (repair via
`scripts/reconcile-ledger-balances.js`).

The **Close** tab's readiness checklist is kernel-aware: it leads with the gates
that actually block a clean close — all entries posted to the ledger (pending
count) and a balanced trial balance — then the transaction-cleanup signals.

The Aging tab is the standard 30/60/90 A/R + A/P
aging (as-of today, not period-scoped): open IDR invoices + `pending_receivable`
accruals vs unpaid bills + `pending_payable` accruals — the same composition as
the Balance Sheet lines, so totals tie. Bucketing is pure
(`assets/js/aging-engine.js`); data via `DataService.getAgingReport`. Rows
deep-link to `/invoices?invoice=`, `/bill?record=`, `/ledger?record=`. The historical "Phase 1 read-only" description is
obsolete: the kernel tabs are live — journal posting, manual journals, period
close/reopen, and Chart of Accounts archive/reactivate all ship via the
Accounting Kernel (§4m.3; CoA Phase 1 details in
`docs/data-model/chart-of-accounts.md`). The cleanup queue, mapping preview, and
close-readiness checklist still render from existing records; there is no AI
write anywhere on the page.

`DataService` accounting methods:
- `getIncomeStatementPreview(uid, period, comparisonPeriod)` — **primary Accounting
  Center surface.** Builds a deterministic Income Statement Preview (P&L) from ledger
  **transactions only** for the selected period vs an auto-derived comparison period
  (`period`/`comparisonPeriod` accept `{ start, end }` day-key objects; the comparison
  defaults to the previous calendar month, or the preceding equal-length window). Returns
  `{ hasData, hasIncomeData, period, comparison_period, confidence, summary,
  previous_summary, rows, related_records_index, readiness, limitations }`. See
  classification + sign rules below.
- `getIncomeStatementRelatedRecords(uid, params)` — read-only `/accounting-records`
  drilldown source. Accepts `{ section, parent, category, type, period, compare }`, where
  `period` is `{ start, end }`; the page maps `period=YYYY-MM` to a full month and
  `period=YYYY-MM-DD..YYYY-MM-DD` to a custom range. Returns
  `{ section, label, period, comparison_period, summary, suggested_action, records,
  limitations }`. Statement summary amounts are still sourced from
  `getIncomeStatementPreview`; Bills and Subscriptions may appear as supporting context
  rows but do not change Income Statement totals.
- `getAccountingReadiness(uid, startKey, endKey)` — orchestrates `getTransactionsForPeriod`
  / `getBillsForPeriod` / `getSubscriptionsForPeriod` + `getAccountingMappings` +
  `listBankStatementImports`, and returns `{ hasData, score, band, kpis, counts,
  cleanupItems, mappingPreview, closeChecklist, closeStatus, limitations, bankSupported }`.
  `getIncomeStatementPreview` reuses this for its report-confidence banner and embeds the
  full object as `result.readiness` (the Cleanup / Account Mapping / Close tabs render from it).
- `getAccountingCleanupItems(uid, startKey, endKey)` — thin wrapper returning `cleanupItems`.
- `getAccountingMappings(uid)` — reads active saved mappings.
- `saveAccountingMapping(uid, data)` — deterministic upsert + audit log.

**Income Statement Preview classification (Phase 1, transactions only).** This is a
**preview**, not a posted journal-entry statement and not GAAP/IFRS-ready. Bills and
subscriptions are deliberately **not** folded into the amounts (they would double-count
realized spend); their counts only feed the confidence message.
- **Revenue** = `type ∈ {income, legacy revenue, refund, pending_receivable}`, grouped by
  category (default line `Revenue`). Mirrors `getDashboardStats` / `_calculateOverviewPerformance`.
- **Operating Expenses** = `type ∈ {expense, fee, tax, pending_payable}`, grouped into lines
  (`fee → Fees`, `tax → Tax`, else category or `Others`).
- **Cost of Revenue (COGS)** defaults to **0**. A category/type only moves under COGS when a
  saved `accounting_mappings` doc for it has `target_account_type === 'cost_of_revenue'` or
  `statement_section === 'cost_of_revenue'`. No such account type exists yet, so Infrastructure
  stays under OpEx by default (never auto-classified as COGS).
- **Other Income / Other Expense** are `0` in Phase 1; `transfer`/`adjustment`/custom types are
  neutral and excluded from the P&L.
- **Calculations:** `gross_profit = revenue − cost_of_revenue`, `operating_income = gross_profit
  − operating_expenses`, `net_income = operating_income + other_income − other_expense`. Margins
  are `0` when revenue is `0`. `change_amount = current − previous`; `change_pct = previous !== 0
  ? change/abs(previous)*100 : null` (UI shows **N/A**). Never renders NaN/Infinity. Component
  rows store positive magnitudes; the statement sign (parentheses for costs/negatives) is applied
  at render time by `row.kind` (`revenue` / `cost` / `subtotal`).
- **Row status** is derived from current-period transactions only: groups collapse to Mapped /
  Review / Needs cleanup / No records; child lines surface specific counts (e.g. `2 missing
  receipts`, `1 unmapped`). Source rows navigate to `/accounting-records`, a dedicated
  related-records subpage with search, filters, table inspection, and pagination. The
  calculated rows **Gross Profit**, **Operating Income**, and **Net Income** are not
  clickable and carry formula notes only.

**Readiness score** starts at 100 and subtracts per-bucket penalties — missing receipt
(−8), missing category (−6), unmapped category (−6, per distinct source), bill missing
due date (−8), bill missing invoice (−6), bank import needing review (−10), subscription
missing renewal (−6) — each bucket capped at 24, score clamped 0–100. **No records → no
score (no-data state), never a fake 100%.** Bands: 0–49 Needs cleanup, 50–79 Almost ready,
80–100 Ready for review. Built-in categories (Revenue, Marketing, SaaS, Infrastructure,
Operations) and AR/AP/fee/tax/income types map to defaults; custom / "Others" / empty
categories are treated as unmapped until a mapping is saved.

**Sidebar route:** `Accounting Center` → `/accounting`, under the Reporting group in
`sidebar-loader.js` (active id `nav-accounting`).

**Fluxy AI routes statement requests here (`statement_export`, 2026-08-07).**
"Buatkan balance sheet di Excel" used to reach the ambiguous branch and get a
polite decline. The intent **routes, it does not analyse**: `toolsForIntent`
returns `[]`, so no Firestore read runs and **no figure is quoted** — naming one
would mean computing a statement outside the ledger. The answer names the
statement, deep-links to its tab, and says the assistant does not generate the
file itself.

Two failure modes, both guarded by `npm run check:ai-statements`:

1. **Keyword order.** `'income statement'.includes('income')` is true and the
   revenue rule sits lower in `classifyIntent`, so an Income Statement request
   would return a revenue analysis; likewise `'neraca saldo'` (Trial Balance)
   contains `'neraca'` (Balance Sheet). Both return a plausible-looking answer,
   so neither shows up in manual testing. `isStatementRequest()` is checked
   before the revenue/expense rules and `statementTargetFor()` tests the longer
   term first. `cash flow` / `arus kas` route here only when an export word is
   also present — they are ordinary analysis questions at least as often.
2. **`recommended_actions` is model-written.** A free-form `href` there would let
   a prompt injection render an arbitrary link in a trusted panel. Actions carry
   `route`, validated against the closed `ACTION_ROUTES` allowlist in
   `sanitizeActions()`, and re-checked against a same-origin path pattern in both
   renderers (`ai-chat.js`, `ai-command-center.js`) so a bad value degrades to a
   plain card. Note `sanitizeActions` caps the list at 5.

**Balance Sheet — RETIRED (2026-07-29).** The standalone `balance-sheet.html` /
`balance-sheet-records.html` pages and `assets/js/balance-sheet*.js` are **deleted**.
Both paths 301 to `/accounting?tab=balance` (`deploy/_redirects.app` +
`netlify.toml`). They were a records-derived management view using **Net Position**
instead of Equity, with no chart of accounts, journals, retained earnings, or
opening balances — and they disagreed with the ledger statement.

`DataService.getBalanceSheetReport` / `_buildBalanceSheetSnapshot` remain in
`db-service.js` but have **no caller**; treat them as dead code pending removal, and
do not build on them. The ledger-derived Balance Sheet in the Accounting Center
(`getFinancialStatements` → `statements-engine.js:buildBalanceSheet`) is the only
Balance Sheet, and it carries the CSV export ported from the retired page
(`exportBalanceSheet` in `accounting.js`) — still confirmed, metered through
`report_exports`, and audit-logged via `createExportAuditLog` exactly as before.
See `docs/ACCOUNTING_CENTER_IA.md` Phase 3.

### 4m.3. Accounting Kernel — double-entry ledger (workspace-scoped)

The real double-entry engine that sits **behind** the business documents. Business
documents stay the only operational entry point; posting is silent. Pure posting
rules live in `assets/js/accounting-engine.js` (no Firestore/DOM, unit-tested in
`tests/accounting-engine.spec.js`); the Firestore I/O lives in the "ACCOUNTING
KERNEL" section of `db-service.js`. Rules verified in
`tests/accounting-kernel-rules-emulator-test.mjs` (17 cases).

**Architecture:** client-side posting; Firestore rules are the integrity boundary.
`addTransaction` / `addBill` / `addSubscription` / `markBillPaid` build the journal
via `buildJournal()` and write it **atomically in the same `writeBatch`** as the
document (helper `_postSourceJournal` → `_attachJournalToBatch`). Posting never
blocks the document — a build error marks the row `accounting_status: 'pending'`
for a later sweep. Money is always a raw integer Rupiah.

Four new **workspace-scoped** collections (route through `_scope()`; never
hardcode `users/`):

| Collection | Doc id | Key fields |
|---|---|---|
| `chart_of_accounts` | `{code}` | `code, name, type (asset/liability/equity/revenue/expense), subtype, parent_code, normal_balance, is_active, currency, entity_id, opening_balance, created_at`, plus the policy flags `mappable`, `allow_manual_journal`, `allow_direct_transaction` and a `seed_version` stamp. Seeded idempotently by `seedChartOfAccounts()` from `CHART_OF_ACCOUNTS_SEED` (33 accounts). Archive via `is_active`; **never deleted**. |
| `journals` | auto | `journal_number ('JE-YYYY-NNNNNN'), journal_seq (int), journal_type ('system'\|'manual'), manual_subtype, posting_rule_id, source:{collection,id}, source_number, period_key 'YYYY-MM', status (draft/posted/reversal/reversed), description, reference, entity_id, currency, memo, lines[], total_debit, total_credit, is_balanced, reverses_journal_id, reversed_by_journal_id, created_by, generated_by, posted_by, posted_at, created_at`. Posted entries are **immutable** (rules allow only `reversed_by_journal_id` to change; no delete) and created only into a **non-closed** period. `journal_type:'manual'` `status:'draft'` rows are editable/deletable until posted. |
| `counters` | `journal-{YYYY}` | `seq (int, monotonic), entity_id, updated_at`. Per-year journal-number sequence, reserved in a `runTransaction` before the posting batch (`_reserveJournalNumbers`). Rules enforce `seq` only ever grows; no delete. |
| `ledger_balances` | `{period_key}__{account_code}` | `period_key, account_code, account_type, entity_id, currency, debit_total, credit_total, updated_at`. Running per-account/period totals, written via `FieldValue.increment` alongside each journal. **The trial-balance source** — never sum all journal lines. |
| `periods` | `{period_key}` | `period_key, status (open/closed/locked), entity_id, closed_by, closed_at, retained_earnings_posted, updated_at`. Missing doc = open. `closePeriod()` posts a closing journal (net income → `3000 Retained Earnings`) and sets `closed`. `reopenPeriod()` (owner/admin only — rules gate the closed/locked → open transition) flips the period open and reverses the closing journal so net income backs out of Retained Earnings. Lock is owner/admin only. |

Foresight fields present on every journal/account now (multi-entity/-currency UI
deferred): `entity_id` (= workspaceId), `currency` ('IDR'), `fx_rate` (1),
`functional_amount`. Source documents gain `journal_ref` + `accounting_status`
(`posted`/`pending`/`excluded`) for drill-down.

**⚠️ Commerce revenue debits Cash at order time (live defect, 2026-08-03).** The
order-level revenue entry from `finance-map.js` is `type:'income'` → `TXN-INC-CASH`
→ Dr `1000` / Cr `4000`, but the money is still with the marketplace; the payout is
a non-posting `transfer`. Cash is overstated and the bank rec cannot tie for any
commerce-connected workspace. `1030 Payment Gateway Clearing` is **seeded for this
but not wired** — the fix needs a new posting rule, since `account_code` overrides
the categorizing leg, not the cash leg. Full writeup + wiring shape:
`docs/ACCOUNTING_SPEC_REVIEW.md` §7.4b.

**Account posting policy (the control layer, 2026-08-02).** Four independent flags
per account, all defaulting to PERMISSIVE when absent (fail-open — a user-created
account carries none of them and must stay pickable):

| Flag | Gates |
|---|---|
| `is_system` | rename/archive is locked |
| `mappable` | eligible as an **auto-mapping / categorization target** |
| `allow_manual_journal` | a human may name it on a **manual journal** line |
| `allow_direct_transaction` | a human may pick it on a **transaction/bill** line |

They are **not** implied by one another — `2800 Suspense` is deliberately
unmappable but hand-codeable. Eleven structural accounts (`1000`, `1100`, `2000`,
`3000`, `3900`, and the six tax control accounts) are closed to both human
surfaces, so A/R and A/P can only move through the invoice/bill subledgers and the
aging report keeps tying to the balance sheet.

Enforced at three layers: `fluxy-account-picker.js` `isSelectable()` (entry
drawer), `accounting-journal-new.js` (manual-journal option list), and the engine
itself — `assertManualJournalPolicy()` (GL_010/GL_012) and `explicitAccount()`
(GL_011), which **throws** rather than silently resolving to a default account.
`subtype: 'opening'` is exempt: opening balances are the one legitimate human path
into cash/equity, and the Manual Journal editor is the only in-app way to record
them (`buildOpeningJournal` has no caller).

⚠️ **Never gate inside `buildManualJournal`.** The Tax Center posts through it
directly (`recordCorporateTaxPayment`, `postAnnualCorporateTax`) using the very
accounts the policy blocks; the gate belongs in `postManualJournal` (the human
path) only. `tests/accounting-engine.spec.js` guards this.

**Reading the flags.** `seedChartOfAccounts` writes them, but correctness does
**not** depend on that having run: `getChartOfAccounts` overlays the seed's policy
onto every Firestore row via `_withAccountPolicy` (**seed wins**). This is
deliberate — the previous `mappable`-only guard was inert on every seeded
workspace precisely because the seeder never persisted the field. Safe only
because nothing writes the merged object back; `saveAccount` builds explicit
payloads and must never `setDoc(ref, {...account})`. Bump `CHART_SEED_VERSION`
when the seed gains fields the seeder must backfill (the heal predicate is a
version stamp, not an "is field X missing?" test). Proven by
`tests/coa-account-policy.spec.js`, which reads back through Firestore — a
seed-only assertion cannot catch this class of bug.

**Structured errors (`GL_*`).** `accounting-engine.js` exports `GL` + `glError()`;
every kernel throw carries `err.code`, `err.domain = 'accounting'`, and
`err.details` (the interpolated values). Codes: `GL_001` unbalanced · `GL_002`
too few lines · `GL_003` zero amount · `GL_010` manual-journal blocked · `GL_011`
direct-transaction blocked · `GL_012` archived · `GL_020` period locked · `GL_021`
period closed. Callers discriminate on the **code**, never on message prose —
`document-capture.js` used to decide whether to show the real reason by
regex-matching English, so translating a string would have silently changed
control flow. Render via `window.formatFluxyError(err, title)`
(`shared-dashboard.js`), which resolves `gl.<CODE>` through `FluxyI18n.t()` with
`err.details` as vars and returns an **escaped** body. Add a `gl.<CODE>` key to
`dashboard-i18n.js` for every new code — `scripts/i18n-audit.js` cannot see
`new Error('…')` strings, so `tests/dashboard-i18n.spec.js` asserts the coverage.

**Nightly integrity assertions.** `netlify/functions/ledger-integrity-sweep.js`
(cron `0 20 * * *` = 03:00 WIB, default-off `LEDGER_ASSERT_ENABLED`) runs the
five reconciliations per workspace and writes
`workspaces/{id}/ledger_integrity_reports/{YYYY-MM-DD}` (client read-only; the
admin SDK bypasses rules). Checks: A/R ties to open invoices, A/P ties to unpaid
bills, global Σdebit == Σcredit, `ledger_balances` vs journal lines, journal
coverage, plus an informational bank-vs-snapshot signal. Read-only — repair stays
with `scripts/reconcile-ledger-balances.js --commit`, which now shares the
recompute via `netlify/functions/lib/ledger-assert.js` so detector and repair
cannot disagree.

**Log level tracks actionability, not check result.** `console.error` is reserved
for a crashed sweep, a failed report write, and `trial_balance` failing (journal
lines that don't foot can only be an engine bug). Coverage gaps and
`ledger_balances` drift log at `console.warn` — they are known states with named
remedies, and logging them at ERROR nightly produces a permanently-red stream that
people stop reading, which defeats the point of automating the assertions. It enumerates `workspaces` **directly** rather than resolving
scope per-uid, which sidesteps the stale `users/{uid}` copy entirely. Unit-tested
without credentials: `npm run check:ledger-assert`.

**Posting rules** (`selectRule` → rule table in `accounting-engine.js`): expense→
Dr expense/Cr Cash; income→Dr Cash/Cr Revenue; `pending_payable`→Dr expense/Cr A/P;
bill→Dr expense/Cr A/P (accrual), bill payment (carries `linked_bill_id`)→Dr A/P/Cr
Cash (settlement, no double expense); subscription→accrual; invoice (non-draft)→Dr
A/R/Cr Revenue. `transfer`/`adjustment`/custom types and invoice drafts do **not**
post. Account selection honors saved `accounting_mappings` → category defaults →
type defaults → `6999` fallback.

**Known limitation (accepted):** rules verify Σdebit==Σcredit on the journal
**totals** but cannot sum the `lines[]` array — a client could submit balanced
totals with lopsided lines. Compensating controls: the Trial Balance view re-asserts
balance, and `scripts/reconcile-ledger-balances.js` (built — dry-run default;
recomputes every account/period balance from the journal lines, reports
drift/missing/orphan + a global Σdebit==Σcredit check, and `--commit` overwrites
ledger_balances with the authoritative totals) rebuilds balances from
journals. Server-side posting would close this; client-side was chosen for
architectural fit/speed.

**`DataService` kernel methods:** `seedChartOfAccounts`, `getChartOfAccounts`,
`listJournals`, `getJournalById`, `getTrialBalance` (from `ledger_balances`),
`getGeneralLedger` (running balance per account), `getPeriod`, `listPeriods`,
`closePeriod`. UI surfaces these as Accounting Center tabs: **Journals / General
Ledger / Trial Balance / Chart of Accounts** + a working **Close** panel
(`accounting.html` + `accounting.js`).

**Permissions:** `accounting.read` (all members incl. viewer), `accounting.post`
+ `period.close` (finance+), `period.lock` (owner/admin). See `perms-service.js`.

**Cutover / history:** `scripts/post-opening-balances.js` posts one opening-balance
journal per workspace (dry-run default; `--commit`; idempotent). For populating
historical periods, `scripts/backfill-journals.js` generates journals for existing
transactions/bills/subscriptions — dry-run default, idempotent (double-guarded by
`accounting_status`/`journal_ref` and existing journals-by-source), skips closed
periods and invoice-linked settlements, batched ≤100 docs. Reuses the real engine
via a data-URL import. Source docs gain `journal_ref` + `accounting_status` (the
document validators in `firestore.rules` allow these two keys via
`isValidAccountingLink`).

**Edit/void corrections (wired).** Editing or voiding a **transaction**
(`updateTransaction`/`voidTransaction`) reverses the document's journal and (for
an edit) reposts from the new state via `_correctSourceJournal` — both into an
OPEN period (correction-in-current-period; a closed book is never mutated). The
reversal + repost balance increments are aggregated before flushing
(`_flushBalanceAcc`) so the same `ledger_balances` doc is never written twice in
one batch. Editing/voiding a transaction whose journal sits in a **closed/locked
period** is blocked up front (`_assertEditablePeriod`) with a clear "reopen the
period first" message — a closed book is never mutated, and this avoids the raw
Firestore permission error the correction would otherwise hit (it can't post a
journal into a closed period).

**Invoices (wired).** `finalizeInvoice` posts `INV-ISSUE` (Dr A/R / Cr Revenue);
`markInvoicePaid` links the income transaction (`linked_invoice_id`) so it posts
`INV-PAY` (Dr Cash / Cr A/R) — settling the receivable, not double-recognizing
revenue (legacy invoices with no `INV-ISSUE` journal fall back to a plain income
posting); `voidInvoice` reverses the issue journal. Invoice docs carry
`journal_ref`/`accounting_status` (allowed via `isValidInvoiceBase`).

**Journal numbers (wired).** Every posted/reversal journal gets an immutable
`JE-YYYY-NNNNNN` (annual reset, sequenced by the journal's `period_key` year). The
number is reserved at post time via `_reserveJournalNumbers` (one `runTransaction`
over `counters/journal-{YYYY}`, reserving N at once for multi-journal batches like
corrections) and stamped by `_assignJournalNumbers` before the journal is staged in
the `writeBatch`. A failed batch after reservation leaves a harmless gap (never a
duplicate). Existing journals are numbered by `scripts/backfill-journal-numbers.js`
(dry-run default; seeds the counter docs). The Firestore doc id remains the internal
id; `journal_number` is the human reference.

**Manual journals (wired).** The accountant workflow for entries the engine doesn't
post (opening/accrual/adjustment/reclass/closing/audit/correction/depreciation/fx).
Lifecycle is **Draft → Posted**: `createManualJournalDraft`/`updateManualJournalDraft`
store an editable `status:'draft'` journal with **no number and no ledger impact**;
`postManualJournal` re-finalizes through `buildManualJournal` (asserts balance),
confirms the period is open, reserves a number, and flips the same doc to `posted`
while writing its `ledger_balances` increments. Drafts can be discarded
(`deleteManualJournalDraft`); posted entries never can. `reverseJournal` posts a
user-triggered reversal into the open period. UI: the Journal Register
(`accounting.html` Journals tab — Date / Journal # / Source / Description / Amount /
Status / Actions, with filters), the **Journal Detail** drill-down hub
(`accounting-journal.html`), and the **Manual Journal editor**
(`accounting-journal-new.html`). General Ledger and Trial Balance rows now drill into
Journal Detail (TB → GL → Journal → source), so no view dead-ends.

**Roles.** A fifth role, **`accountant`**, has the same finance-collection access as
`finance` plus the named accounting persona (capability `journals.manual`; posting
+ `period.close`; lock stays owner/admin). Added across `firestore.rules`,
`perms-service.js`, `settings-team.html`, and the invite/role validators.

**Bulk-import sweep (wired).** CSV (`addTransactions`) and bank-statement
(`confirmBankStatementImport`) imports create rows marked
`accounting_status: 'pending'` (no inline posting — would blow the 500-write batch
ceiling). `postPendingJournals(userId)` posts the backlog through the same numbered
path (`_reserveJournalNumbers` + `_assignJournalNumbers`), idempotent (only touches
`pending`), chunked (≤120 journals/batch), skipping closed periods. The Accounting
Center → Journals tab shows a pending banner + "Post pending entries" button
(`countPendingPostings` drives the count).

**Follow-ups (not yet wired):** edit/void corrections for **bills/subscriptions**
(same `_correctSourceJournal` pattern as transactions) — note bills/subscriptions
have no edit/void path in the app today, so this is only relevant once they become
editable.
