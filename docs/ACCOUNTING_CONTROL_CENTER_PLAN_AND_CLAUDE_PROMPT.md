# Accounting Control Center — Plan & Working Notes

> Living record for the Accounting Center (`/accounting`). Read alongside
> `PROJECT_BACKGROUND.md` §4m, `ROADMAP.md` (Accounting Center), and
> `QA_CHECKLIST.md` §N. Phase 1 is **read-only** except for saved account
> mappings: no journal posting, no period close, no `accounting_periods`
> collection, no AI writes, no global Firestore collections.

## Current surface (Phase 1)

The Accounting Center leads with an **Income Statement Preview**, not readiness.

- **Income Statement Preview replaces the readiness-first tab.** The old
  readiness-heavy "Overview" tab is gone. The tab list is now
  **Income Statement / Cleanup / Account Mapping / Close**.
- **Readiness is now report confidence / supporting metadata.** The big
  readiness card was demoted to:
  - a **Report confidence** KPI (score ring + band) in the KPI strip, and
  - a **confidence banner** above the table (Ready / Almost ready / Needs
    cleanup + message + "View blockers" CTA that jumps to the Cleanup tab).
  The Cleanup, Account Mapping, and Close tabs still render from the same
  readiness object (`getIncomeStatementPreview(...).readiness`).

### Income Statement Preview

Built by `DataService.getIncomeStatementPreview(uid, period, comparisonPeriod)`
from ledger **transactions only** (bills/subscriptions are not folded into the
numbers — they would double-count realized spend; their counts feed the
confidence message only).

Rows: Revenue → Cost of Revenue → **Gross Profit** → Operating Expenses →
**Operating Income** → Other Income → Other Expense → **Net Income**.

- **Revenue:** `type ∈ {income, legacy revenue, refund, pending_receivable}`.
- **Operating Expenses:** `type ∈ {expense, fee, tax, pending_payable}`
  (`fee → Fees`, `tax → Tax`, else category or `Others`).
- **Cost of Revenue:** defaults to **0**. Only moves a category/type under COGS
  when a saved `accounting_mappings` doc has `target_account_type` /
  `statement_section === 'cost_of_revenue'`. No such account type exists yet, so
  Infrastructure stays under OpEx by default — never auto-classified as COGS.
- **Other Income / Other Expense:** `0` in Phase 1; `transfer` / `adjustment` /
  custom types are neutral and excluded.
- **Math:** `gross_profit = revenue − cost_of_revenue`,
  `operating_income = gross_profit − operating_expenses`,
  `net_income = operating_income + other_income − other_expense`. Margins are `0`
  when revenue is `0`. `change_pct` is **N/A** when previous is `0`; never
  NaN/Infinity.

Clicking a source row opens `/accounting-records`, a dedicated related-records
subpage with breadcrumb, summary cards, suggested action, search, filters,
pagination, and a source-record table. Gross Profit, Operating Income, and Net
Income are calculated totals and stay non-clickable.

The subpage uses `DataService.getIncomeStatementRelatedRecords(uid, params)`.
Income Statement amounts still come from ledger transactions only. Bills and
Subscriptions may appear as supporting context rows for OpEx/COGS drilldowns,
but they do not change P&L totals.

This is a **preview**, not a posted journal-entry statement and not GAAP/IFRS
ready. Labelled "Income Statement Preview" (tab: "Income Statement").

## Files

- `accounting.html` — KPI strip (Revenue / Gross Profit / OpEx / Net Income /
  Report confidence), confidence banner, tabs, Income Statement report card +
  table container, AI panel, limitations note. Empty/loading/error states.
- `accounting-records.html` — authenticated related-records subpage for large
  Income Statement drilldowns; no marketing footer.
- `assets/js/accounting.js` — page controller: KPIs, confidence banner, income
  statement table render + collapse + related-records navigation, plus the existing
  cleanup / mapping / close renderers (now fed from `result.readiness`).
- `assets/js/accounting-records.js` — page controller for query parsing, search,
  filters, sorting, pagination, empty/loading/error states, and read-only links
  back to Ledger/Bills/Subscriptions by search query.
- `assets/css/accounting.css` — confidence banner, income-statement table, tone
  helpers, and related-records subpage table styles.
- `assets/js/db-service.js` — `getIncomeStatementPreview`,
  `getIncomeStatementRelatedRecords` + helpers
  (`_buildIncomeStatementBuckets`, `_incomeLineStatus`, `_incomeChange`,
  `_previousPeriodRange`, `_incomeStatementColumnLabel`, `_incomeRecordSummary`,
  `_coercePeriodKeys`). Reuses `getAccountingReadiness` for confidence.

## Not in scope (still Planned)

Posted journal-entry statements, Balance Sheet, Cash Flow, Trial Balance,
multi-entity columns, eliminations, tax filing, official close automation,
AI auto-save, COGS classification UI, and any global Firestore collections.
