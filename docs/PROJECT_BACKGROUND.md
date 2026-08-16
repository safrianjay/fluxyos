# FluxyOS — Project Background Reference

> Read this before implementing any new feature, page, or logic change.
> This is the single source of truth for architecture, data schema, logic rules, and conventions.
> For extension contracts and module ownership, also read `SYSTEM_DESIGN.md`.
> For dashboard roles, permissions, audit logs, and sensitive action rules, read
> `SECURITY_SYSTEM.md`.

---

## 1. What FluxyOS Is

FluxyOS is an **Intelligent Finance Operating System** that connects financial
operations, accounting, business operations, enterprise workflows, and
intelligence into one continuously connected system.

In implementation terms — which is what the rest of this document is about — it
is a double-entry accounting kernel with operational modules feeding it,
presented so that an owner can read it and an accountant can defend it.

> **Strategy, scope, and the test for what belongs in the product live in
> [`PRODUCT_STRATEGY.md`](PRODUCT_STRATEGY.md).** Read it before proposing any
> new module. This section describes what exists; that document decides what
> should.

**Two audiences, deliberately served together:**

| Audience | What they need |
|---|---|
| Owners & executives | Decision-grade KPIs, cash visibility, margin they can act on |
| Finance & accounting teams | Double-entry rigour, SAK compliance, auditability, period close |

The executive view is trustworthy *because* the accounting underneath is
rigorous. These are not two products.

**Key capabilities today:**
- Double-entry accounting kernel — journals, chart of accounts (SAK-aligned),
  trial balance, period close with retained earnings
- Live transaction ledger (revenue + expenses)
- Bills & payment scheduling; invoices with multi-currency
- Bank reconciliation and statement import
- Indonesian Tax Center; commerce/marketplace integration
- SaaS subscription tracking
- AI-powered financial analyst chat
- Dashboard KPIs: Revenue, Cash Position, OpEx vs Budget, Gross Margin, Cash
  Pressure, Net Profit

**Product is organised in five layers** (`PRODUCT_STRATEGY.md` §2): Financial
Foundation → Accounting Foundation → Operational Foundation → Financial
Intelligence → Decision Layer. That is a dependency order: Layer 4 intelligence
is only as good as the Layer 2 books, which are only as true as the Layer 3
operations feeding them.

**Layers 1 and 2 are substantially shipped** — including the full accounting
kernel. The audited gaps are multi-entity (Layer 2), approvals and the ERP
operational modules (Layer 3), forecasting (Layer 4), and role dashboards
(Layer 5). `PRODUCT_STRATEGY.md` §3 holds the verified per-capability status;
treat it as the baseline and never plan a shipped capability as future work.

**Direction (2026-08):** deepening toward ERP-class capability — inventory,
purchasing, and point-of-sale — as the operational foundation beneath the
intelligence layer. The rationale is not feature demand: without inventory
movement, cost of goods sold is an approximation, so gross margin is an
approximation. Modules are admitted only when they **create, move, protect,
predict, or explain financial performance** (`PRODUCT_STRATEGY.md` §5), and must
also answer the six connection questions in §5a. Modules that create or move
value post to the kernel; modules that predict or explain read derived balances.

**Architectural principle that follows from this:** the ledger is the product.
Everything else is a **source system** (emits documents, owns a posting rule) or
a **view** (reads derived balances, never recomputes truth). New modules add
source systems; they never add a second source of truth.

### Who it is for

**Businesses across their growth journey** — small and growing companies,
medium-sized businesses, large and enterprise organizations, multi-entity groups,
and eventually public and IPO-stage companies. The architecture must let a
business grow *with* FluxyOS rather than out of it.

**Indonesia is the home market and operating context, not the product ceiling.**
SAK, PPN, and Bahasa-first are foundational defaults. Indonesian SMBs are the
current beachhead and remain an important segment — the current customer base is
strongest in e-commerce and agencies, with F&B as the expansion segment driving
the inventory and POS work. That describes where we are, not how far the product
goes.

### Current capability vs direction vs future

Keep these three columns distinct in every document, every brief, and every piece
of copy. `PRODUCT_STRATEGY.md` §3 is the audited baseline and overrides this
table whenever they appear to disagree.

| Now (shipped) | Next (planned / prepared) | Future (direction only) |
|---|---|---|
| Financial operations — transactions, bills, revenue, subscriptions, budgets | Advanced accounting depth | POS and commercial operations |
| Accounting kernel — CoA, journals, GL, trial balance, IS/BS/CF, period close, AP/AR aging | Inventory, purchasing, vendor and product master | Multi-entity and consolidation |
| Bank reconciliation and statement import | Cost control and COGS from stock movement | Enterprise permissions, approval workflows, governance controls |
| Indonesian Tax Center; commerce/marketplace order sync | Operational workflows | Predictive cash flow and profitability, anomaly detection |
| AI analyst chat, receipt/document extraction | Dimension (branch/outlet/warehouse) rollout | AI operations analyst, decision automation |
| Team workspaces with role-based access | | IPO-grade controls and auditability |

**Nothing in the Future column exists.** Multi-entity in particular looks built —
`entity_id` is stamped on every journal, account, and balance — but it is always
the workspace id, so it is a constant rather than a dimension. Do not describe
any Future item as present.

---

## 2. Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Static HTML5 + Tailwind CSS CDN + Vanilla JS (ES modules) |
| Animation | Anime.js (landing page only) |
| Auth | Firebase Authentication (email/password) |
| Database | Firebase Firestore (user-scoped collections) |
| Backend | FastAPI (Python) — `main.py` — serves static files + 3 API endpoints |
| Hosting | Netlify (auto-deploys from `main` branch on GitHub) |
| Fonts | Google Fonts — Inter (body), Fira Code (mono) |

**No build step.** Files are served as-is. No npm, no bundler, no framework.

---

## 3. Pages & Their Responsibilities

| Page | File | Type | Auth Required | Footer | Sidebar |
|------|------|------|--------------|--------|---------|
| Homepage | `fluxyos.html` | Landing | No | ✅ | No |
| Budget Feature | `budgetlanding.html` | Landing | No | ✅ | No |
| Pricing | `pricing.html` | Landing | No | ✅ | No |
| Checkout | `checkout.html` | Auth billing | ✅ | No | No |
| Payment Status | `payment-pending.html` | Auth billing | ✅ | No | No |
| Redirect | `index.html` | Redirect | No | ✅ | No |
| Sign In | `login.html` | Auth | No | No | No |
| Dashboard | `dashboard.html` | App | ✅ | **No** | ✅ |
| Revenue Overview (KPI drill-down) | `revenue-overview.html` | App | ✅ | **No** | ✅ (Overview) |
| Cash Position (KPI drill-down) | `cash-position.html` | App | ✅ | **No** | ✅ (Overview) |
| Cash Pressure (KPI drill-down) | `cash-pressure.html` | App | ✅ | **No** | ✅ (Overview) |
| OpEx & Budget (KPI drill-down) | `opex-budget.html` | App | ✅ | **No** | ✅ (Overview) |
| Net Profit (KPI drill-down) | `net-profit.html` | App | ✅ | **No** | ✅ (Overview) |
| Ledger | `ledger.html` | App | ✅ | **No** | ✅ |
| Revenue Sync | `revenue-sync.html` | App | ✅ | **No** | ✅ |
| Bills | `bill.html` | App | ✅ | **No** | ✅ |
| Subscriptions | `subscription.html` | App | ✅ | **No** | ✅ |
| Budgets | `budget.html` | App | ✅ | **No** | ✅ |
| Invoices | `invoices.html` | App | ✅ | **No** | ✅ |
| Inventory | `inventory.html` | App | ✅ | **No** | ✅ |
| Stock Count | `inventory-count.html` | App | ✅ | **No** | ✅ |
| Outlet P&L | `outlet-pnl.html` | App | ✅ | **No** | ✅ |
| Accounting Center | `accounting.html` | App | ✅ | **No** | ✅ |
| Accounting Records | `accounting-records.html` | App | ✅ | **No** | ✅ |
| Reports & Exports | `reports.html` | App | ✅ | **No** | ✅ |
| Report Preview (viewer) | `report-preview.html` | App | ✅ | **No** | No |
| Integrations | `integration.html` | App | ✅ | **No** | ✅ |
| Settings (index) | `settings.html` | App | ✅ | **No** | ✅ |
| Settings — Cash & Bank Accounts | `settings-cash.html` | App | ✅ | **No** | ✅ |
| Settings — Budget Settings | `settings-budget.html` | App | ✅ | **No** | ✅ |
| Settings — Personal details | `settings-personal.html` | App | ✅ | **No** | ✅ |
| Settings — Business | `settings-business.html` | App | ✅ | **No** | ✅ |
| Settings — Finance preferences | `settings-finance.html` | App | ✅ | **No** | ✅ |
| Settings — Categories & import rules | `settings-import-rules.html` | App | ✅ | **No** | ✅ |
| Settings — AI preferences | `settings-ai.html` | App | ✅ | **No** | ✅ |
| Settings — WhatsApp connection | `settings-whatsapp.html` | App | ✅ | **No** | ✅ |
| Settings — Team and security | `settings-security.html` | App | ✅ | **No** | ✅ |
| Settings — Billing & plan | `settings-billing.html` | App | ✅ | **No** | ✅ |

**Rule:** Footer loads on all landing pages, never on app pages. Any page that renders `#sidebar` is an app page and must not load the marketing footer.

**Dashboard Content Width Standard:** Every data-heavy operational app page (KPIs,
tables, data grids, reports, analytics, accounting/reconciliation, budgets,
invoices, financial statements) wraps its scroll content in the shared container
`.fluxy-page-shell` → `.fluxy-page-canvas` (1540px). Transactions, Revenue Sync,
and Bills are the baseline; Budgets (`budget.html`, `budget-period.html`,
`budget-allocation.html`) and Invoices (`invoices.html`) follow it. Do not
introduce a page-specific content width (`max-w-7xl`/custom) on a data-heavy page
without a documented exception (there are currently none). Full
rule in [DESIGN_SYSTEM.md → Dashboard Content Width Standard](DESIGN_SYSTEM.md).

### 3a. Dashboard KPI drill-down pages

All six Overview KPI cards are navigation entry points, each routed to the most
relevant surface (bespoke detail page, existing page, or the primary driver) so
the click always answers "where is this number coming from?" while keeping the
FluxyOS design language.

- **Routes (flat, Netlify `pretty_urls` — no redirect needed):** `/revenue-overview`
  (`revenue-overview.html`), `/cash-position` (`cash-position.html`), `/cash-pressure`
  (`cash-pressure.html`), `/opex-budget` (`opex-budget.html`), `/net-profit`
  (`net-profit.html`). Each boots like every
  app page (Firebase + `applyToPage(user, { pageKey: 'overview' })`) and calls its page
  module init. One card reuses an existing page instead of a bespoke drill-down:
  **Gross margin → `/revenue-overview`** (margin is revenue-driven; a margin page would
  just re-present Revenue + OpEx).
- **Clickable KPIs:** all six Overview `<article>`s carry `.metric-cell-clickable`
  + `data-kpi-nav` + `role="link"` + `tabindex="0"`. `dashboard.js` `mountKpiDrillNav()`
  navigates on click/Enter/Space. `routes` (period-consuming) append the current
  dashboard range as `?period=<mode>&start=<key>&end=<key>`; `staticRoutes`
  (`pressure` → `/cash-pressure`) navigate plain. Clicks inside a
  `button`/`a` (the "?" info tooltip and bank/budget CTAs) are ignored so those keep
  their own action.
- **Range persistence (both directions):** dashboard period state is in-memory only, so
  the range travels on the URL. Dashboard → detail: `mountKpiDrillNav()` appends
  `?period&start&end`; the page reads it with `resolvePeriodFromUrl()` and rewrites its
  own URL via `writePeriodToUrl()` on period change so a reload keeps it. Detail →
  dashboard: the `[data-dashboard-back]` links (topbar "Back to Overview" + breadcrumb)
  are pointed at `dashboardBackUrl(period)` by `mountPeriodControls`, and `dashboard.js`
  `applyDashboardPeriodFromUrl()` restores the range on load — so returning reopens the
  Overview on the same period instead of resetting to This Month.
- **Shared scaffold — `assets/js/kpi-detail-shared.js`** (ES module) is the single
  source of the shared behavior: period model, `renderKpiStrip`, `renderTrendChart`
  (area/line, optional zero-baseline positive/negative fill + today marker, wired to
  `window.attachChartHover`), `bucketSeries`/`toCumulative`, `renderBreakdownList`, and
  `createSupportingTable` (search + sort + `createTablePaginator` + CSV export gated by
  `FluxyAccessGuard`). Page modules (`revenue-overview.js`, `cash-position.js`,
  `opex-budget.js`) are thin: fetch via `DataService`, aggregate, configure the scaffold.
- **Data sources (all workspace-scoped via `DataService`):** Revenue —
  `getRevenueTransactionsForDashboardStats` (revenue amount matches the Overview KPI:
  `abs(amount)` over `income`/`revenue`/`refund`/`pending_receivable`), broken down by
  `category` / `source` (labeled "Channel") / `entity_id` ("Business"). Cash —
  `getLedgerCashPosition` (net + `_entries` for opening balance and the running-balance
  trend), `getBankAccounts` (by-account + Bank cash), `getInvoices`/`getBills` (upcoming
  receivables/payables), `getTransactionsForPeriod` (cash-effective records table).
  OpEx — `getActiveBudget` + `getBudgetUsage` (budget-vs-actual, over-budget) +
  `getTransactions` filtered to `expense`/`fee`/`tax`. Cash Pressure — **forward**
  liquidity runway (distinct from Cash Position's realized view): `getBankAccounts`
  (starting balance) + open invoices (`getInvoices`) + unpaid bills (`getBills`) +
  subscription renewals (`getSubscriptions`) + `pending_receivable`/`pending_payable`
  transactions, over a **30/60/90-day horizon toggle** (not the historical period
  strip). Projected balance = bank cash + receivables due − payables due; the trend is
  a cumulative runway (`bucketSeries` → `toCumulative(bankCash)`) with overdue items
  clamped to today. Net Profit — `getTransactionsForDashboardOverview(uid, true)` (one
  cached all-time read; the period strip, the previous-period bridge, and the
  month/quarter/year comparison all slice it client-side), split into the same
  revenue/spend type sets `_calculateOverviewPerformance` uses.
- **Net Profit specifics (`/net-profit`, `net-profit.js`).** Net profit =
  `revenue − opex` over the identical type buckets as the Overview
  (`income`/`revenue`/`refund`/`pending_receivable` minus
  `expense`/`fee`/`tax`/`pending_payable`), so it is the absolute amount behind the
  Gross margin KPI and the two can never disagree. Beyond the shared scaffold the page
  adds: a **revenue-vs-expenses meter**, a **bridge** (previous net profit →
  revenue movement → expense movement → current, plus the top three category movers),
  and a **comparison-by-period chart** with a Month/Quarter/Year grain toggle — a
  diverging column chart (`renderComparisonColumns`), not a table: reading whether a
  business is improving means comparing shapes, not parsing six numeric columns. Each
  column is direct-labelled and its tooltip carries revenue, expenses, net profit,
  margin and change, so replacing the table lost no figure. There is
  no in-page AI panel — the topbar Fluxy AI drawer covers it, and the page still
  registers its live figures with `FluxyAIContext` so the drawer opens oriented on
  profit. Negative money on this page and on the Overview card renders `-Rp…` (red), not
  parentheses and never a leading `+` — a level, not a delta.
- **The revenue-vs-expenses meter is deliberately not a donut.** The question is a
  single ratio against a limit ("how much of the money that came in stayed in"), and
  expenses routinely exceed revenue — no ring can render a slice at 710% of itself, so a
  2-slice donut breaks on exactly the periods that matter most. The track is revenue =
  100%, the red segment is the share spent (clamped at the track), the green remainder
  is what was kept, and the part of spend beyond revenue renders as a separate hatched
  **over-run** bar with its own "Over revenue by Rp… · N% over" label. Red vs green is
  ΔE 3.7 under deuteranopia, so every segment carries a text label and a 2px surface
  gap — identity is never colour-alone.
- **One period definition per board (invariant).** Every Overview KPI must answer for
  the same window, so `Revenue − OpEx` reconciles with `Net profit` in *every* period
  mode. This was violated at **All Time**: `getRevenuePeriodRange('all_time')` returned
  `null`, which `calculateRevenueForRange` reads as "no date filter at all", so
  future-dated records counted toward the Revenue card while OpEx, Gross margin, Net
  profit, and every drill-down page (which resolve All Time to `earliest → today`)
  excluded them — the board showed two different revenue numbers. All Time is
  **inception-to-date**: open start, end clamped at today
  (`{ start: new Date(0), end }`). The revenue sparkline anchors its start to the first
  real record so it doesn't bucket from 1970, and clamps its end at today (it used
  `max(today, latest record)`, which one future-dated record stretched centuries out).
  Regression guard: "Overview Net profit reconciles with Revenue − OpEx in every period
  mode" in `tests/kpi-drilldown.spec.js`. Fixed 2026-07-31.
- **Future-dated records (data quality).** Correcting the reconciliation above means
  future-dated transactions are now excluded from every KPI — which would make them
  *invisible* rather than merely wrong. They are therefore surfaced, not silently
  filtered. `DataService.isFutureDatedTransaction(tx)` is the single detector (a
  non-voided transaction whose `_getTransactionDate` is after end-of-today; the Add
  Transaction drawer only accepts today or earlier, so a future date always came from
  an import or an external write). It drives three surfaces that therefore cannot
  drift: (a) `getDashboardOverview` → `actionItems.futureDatedRecords` +
  `overview.dataQuality.futureDated {count, amount, furthest}`, rendered as an Overview
  attention-queue row — deliberately **not** period-scoped, since these sit outside
  every period; (b) `/ledger?flag=future_dated`, a cleanup mode that replaces the
  range-scoped fetch with `DataService.getFutureDatedTransactions` (a normal date range
  can never contain them) and shows a removable "Cleanup" chip; (c) the Ledger's
  `implausibleDate` issue type, so the Trust Score, clean count, at-risk amount, and
  the "Needs your attention" panel all account for them — before this, a ledger of
  records dated in the year 9702 read "100% · 41/41 clean". Regression guard:
  `tests/data-quality-future-dated.spec.js`. Added 2026-08-01.
- **Overview financial charts (`assets/js/overview-charts.js`).** Six charts replaced
  the old Performance Trend panel (removed 2026-08-04): **Net profit** (full width),
  **Total income** + **Total expenses** (2-up), then **Gross profit margin** +
  **Expense breakdown** + **Bank accounts** (3-up). **Cash Flow** is unchanged below
  them. Each trend card is a headline value + prior-period value + delta + plot,
  rendered by `renderTrendMetricCard`; the two donuts use `renderDonutCard`.
  - **Every figure reuses an existing calculation** — no new query. Headlines come
    from `overview.performance` (`revenue` / `opex` / `netProfit` and their
    `*ChangePct` + `previous*` companions), so a chart can never state a different
    number than the KPI card above it. Series are bucketed client-side from
    `overview.chartTransactions`; the expense donut is
    `calculateExpenseBreakdown()` (`report-builder.js`) and the bank donut is
    `overview.bankCash.accounts`.
  - **Three additive `db-service.js` seams** support them: `previousChartTransactions`
    on `getDashboardOverview` (the prior slice was already computed and discarded),
    `accounts: [{id, name, bankName, balance}]` on `_getBankCashSnapshot`, and
    `_isCogsTransaction(tx, cogsKeys)` extracted from `_buildIncomeStatementBuckets`
    so the Overview's gross margin and the Accounting Center's income statement
    classify COGS identically.
  - **Gross profit margin refuses to guess.** It uses true cost of revenue via
    `getCogsSourceKeys` → `_incomeStatementCogsKeys`. With no cost-of-revenue
    account mapped there is no COGS to subtract, and `(revenue − 0) / revenue` would
    report a flat **100% margin for every business** — so the card renders a setup
    state deep-linking to `/accounting?tab=mapping` instead. Same call
    `calculateProfitLoss` already makes when it returns a null gross margin rather
    than inventing one. A genuine 100% is still possible and correct: a workspace
    that mapped a COGS category but recorded no COGS spend in the period really did
    have no direct cost.
  - **COGS is detected from the chart's `sak_category === 'cogs'`, not from the
    mapping's own fields.** `saveAccountingMapping` persists the target account's
    *catalog type* — 5100 Cost of Goods Sold is `type: 'expense'` — and nothing ever
    writes `statement_section` onto a mapping. Matching only those two fields (as
    the detector originally did) could never fire for a mapping made through
    Accounting → Setup → Account Mapping: the user mapped a category to Cost of
    Goods Sold and COGS stayed empty, so the Overview card kept telling them to do
    the thing they had just done and the income statement's Gross Profit always
    equalled Revenue. `_incomeStatementCogsKeys(mappings, chartAccounts)` now
    resolves `target_account_code` against the chart, which is the same signal
    `statements-engine.buildIncomeStatement` uses — so Overview, the income
    statement preview and the ledger statements agree. Guard:
    `tests/accounting-cogs-mapping.spec.js`. Fixed 2026-08-05.
  - **Net profit is a diverging column chart**, not a line: net profit goes negative
    regularly and only a zero-baselined column reads a loss honestly. Negative money
    renders `-Rp…` (red), matching the Overview card convention above.
  - **One centralized AI entry point.** No chart carries an AI action or an "fx"
    affordance; the right-rail AI Finance Summary panel remains the only one.
  - **Removed with Performance Trend:** the Budget-used series (budget stays fully
    visible on the OpEx vs budget KPI card), the Bar/Line toggle, and the
    `#cashflow-chart` / `#cashflow-budget-caption` / `[data-cashflow-chart-type]` /
    `data-tour-target="dashboard-cashflow"` hooks. Regression guard:
    `tests/overview-charts.spec.js` (17 checks).
- **Overview grid: two rows, not two columns.** `.overview-layout` is a 2×2 grid.
  Row 1 pairs `.summary-board` (KPI board) with `.overview-right-column` (the AI
  rail); row 2 is `.overview-wide-column`, spanning both columns, holding every
  chart and the attention queue. Two consequences worth knowing before editing it:
  - **The rail matches the KPI board's height with no JS.** They are siblings in
    one grid row, so `align-items: stretch` pairs them. But a grid row is as tall
    as its tallest item, and the rail's natural content (~837px: AI panel + three
    rail sections) is far taller than the KPI board (~442px) — left in flow it
    dragged the KPI board up to match. `.right-workbench` is therefore
    `position: absolute; inset: 0` inside a `position: relative` cell, so the cell
    has no in-flow content and the KPI board alone sizes the row. Overflow scrolls
    inside `.rail-scroll`, one region for the whole card. **When the layout stacks
    (≤1200px) `position` must be reset to `static`** or the card collapses to ~0.
  - **Charts get the full canvas**, not the narrower KPI column — `.overview-wide-column`
    is `grid-column: 1 / -1`. Plot heights step with card width (full-width > 2-up >
    3-up) via `.chart-plot` / `.chart-plot-stage` min-heights.
- **A line chart's SVG viewBox must match rendered size on BOTH axes.** With
  `preserveAspectRatio="none"`, a fixed viewBox height stretched into a taller
  stage scales y independently of x and turns the round point markers into ovals.
  `trackHeight()` derives the height from `.chart-plot` height − `LABELS_ROW_PX`,
  which is why `.chart-labels-scroll` is pinned to a fixed 30px — keep the CSS and
  the JS constant in sync.
- **Trend chart robustness (`renderTrendChart`/`bucketSeries`):** month/quarter ranges
  trim empty leading/trailing buckets (so All Time isn't padded with a flat zero tail —
  the fix for the line diving to Rp0 at the right edge), and the x-axis thins to ~10
  evenly-spaced labels (point markers hidden past 16 buckets) so long ranges don't
  overlap into an unreadable smear.
- **Row deep-link:** supporting-table rows link to `/ledger?record=<transactionId>` (or
  `/bill?record=<id>` for payables, `/invoices?record=<id>` for receivable invoices,
  `/subscription?record=<id>` for renewals) — the target page opens that record's detail
  view. `?record=` is the app-wide deep-link param; `invoices.js` accepts it as an alias
  for its native `?invoice=`. The dashboard **Upcoming** rail uses the same contract.
- **Extensibility:** additional KPI drill-downs reuse `kpi-detail-shared.js`, add a flat
  `<kpi>.html` + `<kpi>.js`, a `data-kpi-nav`/route entry in `mountKpiDrillNav()`, a
  `pageIdMap` entry in `sidebar-loader.js`, and page registration in
  `scripts/i18n-audit.js`.

---

## 4. Firestore Database Schema

**Auth scope:** Identity/billing collections are under `users/{userId}/`. **Finance/operational collections are WORKSPACE-scoped** under `workspaces/{workspaceId}/` and shared across team members (Stage 2). The schema paths below still read `users/{userId}/…` for historical reference, but at runtime every finance read/write resolves through `DataService._scope(userId)`.

> ### ⚠️ WORKSPACE DATA SCOPING — MANDATORY (read before any finance read/write)
>
> Invited team members must see the SAME finance data as the workspace owner.
> Getting this wrong silently shows members **0 data** while owners look fine
> (because `users/{ownerUid}/…` still holds the pre-migration copy as a rollback
> net — "owner seeing data does NOT prove correctness"). Rules:
>
> 1. **NEVER hardcode `users/${userId}/<financeCollection>`** in DataService, page
>    HTML, or page JS. Always go through the seam: `${this._scope(userId)}/…`
>    inside `db-service.js`, or `${ds._scope(userId)}/…` for an inline page query.
>    `_scope()` returns `workspaces/{wsId}` in workspace mode, `users/{uid}` otherwise.
> 2. **Finance/operational collections** (workspace-scoped — use `_scope`):
>    `transactions`, `bills`, `subscriptions`, `budgets`, `budget_allocations`,
>    `invoices`(+`items`), `audit_logs`, `bank_accounts`, `bank_balance_snapshots`,
>    `bank_statement_imports`(+`rows`), `documents`, `report_exports`, `accounting_mappings`,
>    `chart_of_accounts`, `business_categories`, `journals`, `counters`,
>    `ledger_balances`, `ledger_balances_by_dim`, `periods`, `vendors`,
>    `dimensions`, `items`, `goods_receipts`, `stock_movements`, `stock_adjustments`,
>    **(Tax Center, §4o)** `company_tax_profile`, `tax_mappings`,
>    `tax_transactions`, `tax_periods`, `tax_filings`, and
>    **(Commerce Integration, §4p)** `commerce_accounts`, `commerce_orders`,
>    `commerce_transactions`, `commerce_refunds`, `commerce_settlements`,
>    `commerce_payouts`, `commerce_sync_jobs`, `commerce_sync_errors`,
>    `commerce_webhook_logs`.
> 3. **Identity/billing collections** (stay user-scoped — keep `users/{uid}`):
>    `billing_subscription`, `billing_payment_requests`, `billing_invoices`,
>    `billing`, `payment_verifications`, `usage_limits`, `onboarding`,
>    `platform_learning`, `ai_chats`, `settings`, `receipts`, `internal_users`.
> 4. **Resolve before read.** A page must resolve the workspace before its first
>    finance read, or `_scope` falls back to `workspaces/{memberUid}` (which does
>    not exist → permission-denied for members). This is centralized: every app
>    page calls `applyToPage()` (`onboarding-gate.js`) right after auth, which now
>    resolves the workspace first. Shared finance components that load their own
>    `DataService` (e.g. in `shared-dashboard.js`) must also call
>    `resolveWorkspace(app, user)` after `authStateReady()` before reading.
> 5. **Server-side reads count too.** Netlify functions have their own seam:
>    `netlify/functions/lib/workspace-scope.js` (`resolveFinanceScopes` +
>    `readFinanceCollection`) for Admin-SDK readers, and `resolveFinanceScopes` /
>    `fetchFinanceCollectionSafe` inside `netlify/functions/api.js` for the
>    REST-with-caller-token readers. A function that reads `users/{uid}/…` does
>    **not** get a permission error — it gets the frozen pre-migration copy, so
>    every recent period silently computes as 0 while old months still look
>    plausible. That is exactly how the Fluxy AI answers and the Weekly Digest
>    came to report Rp0 for weeks that had records (fixed 2026-07-30; regression
>    tests: `npm run check:ai-scope`, `npm run smoke:digest`). The same leak made
>    bank statement extraction a no-op — the worker looked the draft up under
>    `users/{uid}` while the panel created it under `workspaces/{ws}`, so every
>    upload sat at `extraction_status: 'pending'` until the panel timed out
>    (fixed 2026-07-31; regression test: `npm run check:bank-scope`).
> 6. **Watch out for inline page queries.** Some pages build Firestore queries
>    directly in the HTML (`collection(ds.db, …)`) instead of calling a
>    DataService method — these bypass the seam and are the easiest place to
>    reintroduce the bug. Grep guard:
>    `grep -rnE 'users/\$\{[a-zA-Z_.]+\}/(transactions|bills|subscriptions|budgets|budget_allocations|invoices|bank_accounts|bank_balance_snapshots|bank_statement_imports|documents|report_exports|accounting_mappings|chart_of_accounts|business_categories|journals|counters|ledger_balances|ledger_balances_by_dim|periods|vendors|dimensions|items|goods_receipts|stock_movements|stock_adjustments|audit_logs|company_tax_profile|tax_mappings|tax_transactions|tax_periods|tax_filings|commerce_accounts|commerce_orders|commerce_transactions|commerce_refunds|commerce_settlements|commerce_payouts|commerce_sync_jobs|commerce_sync_errors|commerce_webhook_logs)' *.html assets/js/*.js | grep -v db-service.js`
>    must return nothing.
>
> 7. **A new module must register its collections in BOTH lists above** — rule 2
>    here and `FINANCE_COLLECTIONS` in `scripts/qa-run.js`, which is what `npm run
>    qa` actually executes. `vendors` shipped workspace-scoped but was added to
>    neither, so the guard was blind to it from the day it landed (fixed
>    2026-08-14). The guard protects exactly the names it is given and fails
>    silently — not loudly — for every name it is not.


### 4a–4p. Collection schemas — sharded

Field-level schemas moved to `docs/data-model/` on 2026-08-07. This file was
2,490 lines and was loaded whole to answer questions about one collection.
Read only the shard your change touches — `.claude/hooks/docs-read-gate.sh`
maps changed files to the shard it requires.

| Shard | Collections |
|---|---|
| [`data-model/transactions.md`](data-model/transactions.md) | `transactions` |
| [`data-model/bills.md`](data-model/bills.md) | `bills` |
| [`data-model/subscriptions.md`](data-model/subscriptions.md) | `subscriptions` |
| [`data-model/audit-logs.md`](data-model/audit-logs.md) | `audit_logs` |
| [`data-model/settings.md`](data-model/settings.md) | `settings` |
| [`data-model/bank-accounts.md`](data-model/bank-accounts.md) | `bank_accounts`, `bank_balance_snapshots` |
| [`data-model/budgets.md`](data-model/budgets.md) | `budgets`, `budget_allocations` |
| [`data-model/onboarding.md`](data-model/onboarding.md) | `onboarding`, `platform_learning` |
| [`data-model/documents.md`](data-model/documents.md) | `documents` |
| [`data-model/bank-statement-imports.md`](data-model/bank-statement-imports.md) | `bank_statement_imports` |
| [`data-model/internal-ops.md`](data-model/internal-ops.md) | `internal_users` |
| [`data-model/billing.md`](data-model/billing.md) | `billing_subscription`, `billing_payment_requests`, `voucher_codes` |
| [`data-model/accounting.md`](data-model/accounting.md) | `accounting_mappings`, `journals`, `ledger_balances`, `periods`, `counters` |
| [`data-model/dimensions.md`](data-model/dimensions.md) | `dimensions`, `ledger_balances_by_dim` |
| [`data-model/items.md`](data-model/items.md) | `items` |
| [`data-model/stock.md`](data-model/stock.md) | `goods_receipts`, `stock_movements`, `stock_adjustments` |
| [`data-model/invoices.md`](data-model/invoices.md) | `invoices` |
| [`data-model/tax-center.md`](data-model/tax-center.md) | `company_tax_profile`, `tax_mappings`, `tax_transactions`, `tax_periods`, `tax_filings` |
| [`data-model/commerce.md`](data-model/commerce.md) | `commerce_orders`, `commerce_accounts`, `commerce_settlements` |
| [`data-model/chart-of-accounts.md`](data-model/chart-of-accounts.md) | `chart_of_accounts`, `business_categories` |

**The scoping rules above apply to every shard.** A shard describes fields;
it does not repeat which scope a collection lives under.
## 5. Business Logic Rules

### Amount Formatting (Critical)

**Input → Display:** Dots as thousands separators (Indonesian format)
- User types: `1234567`
- Displayed in input: `1.234.567`
- Formula: `value.replace(/\D/g, "").replace(/\B(?=(\d{3})+(?!\d))/g, ".")`

**Display → Stored:** Strip dots, convert to float
- `parseFloat("1.234.567".replace(/\./g, ""))` → `1234567`

**Stored → Displayed in tables:** `"Rp" + Math.abs(amount).toLocaleString('id-ID')` — **no space after `Rp`** (e.g. `Rp1.234.567`). Render in Inter `tabular-nums` (plain zero), never a monospace face. See `docs/DESIGN_SYSTEM.md` → "Numeric & currency format (strict)".

**Never store a formatted string in Firestore.** Amount must always be a raw number.

### getDashboardStats Calculation

```
revenue = sum of amount WHERE type is 'income', legacy 'revenue', 'refund', or 'pending_receivable'
opex    = sum of Math.abs(amount) WHERE type is 'expense', 'fee', 'tax', or 'pending_payable'
margin  = ((revenue - opex) / revenue) * 100
```

**Edge cases:**
- If `revenue === 0`: margin returns `NaN` or `-Infinity` — UI must handle gracefully (show `0%`)
- `action_items_count` = count of rows where `status === 'Missing Receipt'`
- `revenue_change` is hardcoded `"0%"` (not yet calculated dynamically)

### Overview Period Context

The Overview period selector scopes the full dashboard view: `This Month`,
`Last Month`, `YTD`, `All Time`, or `Custom`. Revenue, OpEx, Gross Margin,
charts, attention queues, and Fluxy AI context follow the selected period.

`DataService.getRevenueTransactionsForDashboardStats(userId)` reads only
revenue-side transaction types (`income`, legacy `revenue`, `refund`,
`pending_receivable`) from `users/{userId}/transactions` without a Ledger row
limit. This supports the Revenue card's selected-period scope line, record
count, and secondary context: all-time revenue for every mode except `All
Time`, which shows this-month revenue. Missing timestamps count toward Revenue
`All Time` only.

`DataService.getTransactionsForDashboardOverview(userId, allTime)` preserves
the existing 1,000-row Overview read for bounded periods and removes the limit
only for the Overview `All Time` mode. Ledger limits are unchanged.

### Modal Context Rules

| Context | Default Category | Submit Label | Toast Message |
|---------|-----------------|--------------|---------------|
| `'transaction'` | none | `"Add Transaction"` | `"Transaction successfully deployed to your live ledger!"` |
| `'bill'` | `"Operations"` | `"Save Bill"` | `"Bill successfully added to your schedule!"` |
| `'subscription'` | `"SaaS"` | `"Activate Subscription"` | `"Subscription successfully activated!"` |

### Bulk Transaction CSV Import

The Add Transaction modal supports bulk CSV upload only for the
`'transaction'` context. Bills and subscriptions keep their single-record modal
flow.

The transaction modal must separate single entry and CSV import with tabs. Bulk
CSV mode reuses the same primary submit button as the modal footer (`Upload CSV`
while the bulk tab is active); do not add a second upload CTA inside the upload
panel.

Accepted headers:

| Header | Required | Notes |
|--------|----------|-------|
| `Description` or `vendor_name` | ✅ | Saved as `vendor_name` |
| `Category` | ✅ | Must be `Revenue`, `Marketing`, `Infrastructure`, `Operations`, or `SaaS` |
| `Type` | ✅ | May be `Income`, `Expense`, `Transfer`, `Refund`, `Adjustment`, `Fee`, `Tax`, `Pending receivable`, or `Pending payable`; legacy `revenue` is accepted |
| `Amount` | ✅ | Positive raw number; `Rp`, commas, or dots are stripped before save |
| `Status` | No | Defaults to `Completed`; may be `Completed` or `Missing Receipt` |
| `Date` | No | Optional transaction date in `YYYY-MM-DD`; defaults to the drawer's CSV date field when omitted |

Imports are limited to 500 rows per file and are written as a Firestore batch,
so validation failure prevents partial imports.

The entry drawer mounts the shared `FluxyDateRangePicker` in single-date mode
for transaction dates. It defaults to today and allows today or previous days
only. Single-date mode shows one calendar month, omits the range footer and
action buttons, and auto-selects/closes when a day is clicked. When the selected
single-entry date or any CSV row/default date is not today, the drawer shows an
info warning above the sticky submit button before saving. After a successful
single or CSV transaction add, the drawer closes automatically. The ledger table
renders 10 transactions per page and supports ascending/descending sort on Date,
Amount, Category, and Status with up/down icons.

The Finance Ledger page defaults to the current month using the shared
`FluxyDateRangePicker` in `assets/js/date-range-picker.js` beside Download CSV.
Single-day and custom-range views are selected inside the calendar, not through
separate Day/Month tabs. Ledger control cards, Ledger Activity charts, table
rows, pagination, and CSV export must all use the selected period so large
ledgers do not overload the page. Reuse this shared picker for every dashboard
calendar/date picker, including single-date entry fields; never create
page-local calendar components or native date inputs. Its Reset action returns
the picker to the configured default range, which is the current month for
ledger-style views and today for single-entry dates. The outer previous/next
arrows preserve full-month scope for monthly filters, including when returning
to the current partial month. Day-level arrow navigation is reserved for an
explicitly selected single-day range or single-date mode.

Example:

```csv
Description,Category,Type,Amount,Status,Date
Client Payment,Revenue,Income,1250000,Completed,2026-05-14
AWS,Infrastructure,Expense,450000,Missing Receipt,2026-05-13
```

---

## 6. Shared JS Components & Exact APIs

### `window.showAddTransactionModal(options)`
**File:** `assets/js/shared-dashboard.js`

```javascript
window.showAddTransactionModal({
  title: "Add Transaction",       // modal heading
  submitLabel: "Add Transaction", // submit button text
  defaultType: 'expense',         // pre-selected type dropdown
  defaultCategory: 'Operations',  // pre-selected category dropdown
  context: 'transaction'          // 'transaction' | 'bill' | 'subscription'
})
```

### `window.closeAddTransactionModal()`
Closes the right-side entry drawer, fades the black overlay, restores page
scroll, and removes `#global-tx-modal` from the DOM entirely. Always safe to
call.

### `window.showToast(message, type)`
```javascript
window.showToast("Your message", 'success') // 'success' | 'error' | 'info'
```
Auto-dismisses after 4000ms. Container ID: `#toast-container`.

### `window.renderEmptyState(containerId, config)`
```javascript
window.renderEmptyState('ledger-empty-state', {
  title: "No records",
  description: "Add your first record.",
  buttonText: "Add Now",
  onAction: () => window.showAddTransactionModal()
})
```

### `window.renderShimmer(containerId, rowCount = 5)`
Shows skeleton loading rows inside a container while data loads.

### Authenticated app table standard
**File:** `assets/css/shared-dashboard.css`

All authenticated dashboard/app tables should use the shared `fluxy-table*`
classes documented in `DESIGN_SYSTEM.md` and `COMPONENT_GUIDE.md`. Use
`fluxy-table-card`, `fluxy-table-scroll`, `fluxy-table`, `fluxy-table-row`,
`fluxy-table-cell`, `fluxy-table-money`, `fluxy-table-status`, and
`fluxy-table-pagination` rather than inventing page-local table typography,
money alignment, badge colors, or horizontal-scroll behavior. Preserve existing
DOM IDs, event selectors, Firestore access, and calculations when applying the
standard.

### `window.attachChartHover(container, options)`
**File:** `assets/js/shared-dashboard.js`

Wires Amplitude-style hover (crosshair + active-bar brightness + dark-navy tooltip card with edge flipping) to any bar chart inside `container`.

```javascript
window.attachChartHover(chartEl, {
    bars: '[data-chart-bar]',          // selector or NodeList of bar elements
    orientation: 'vertical',           // 'vertical' | 'horizontal'
    buildTooltip: (barEl, index) => '<html string>'
});
```

Idempotent — safe to call after every `innerHTML` re-render. Returns `{ destroy() }` for teardown. Used by Revenue Sync Volume and Ledger Volume charts. **Required** for any new bar chart per [DESIGN_SYSTEM.md §4 Charts](DESIGN_SYSTEM.md), step-by-step build in [COMPONENT_GUIDE.md Recipe 7](COMPONENT_GUIDE.md).

### `initUniverseCanvas(canvasElement)`
**File:** `assets/js/universe-canvas.js`
Starts the starfield animation on any `<canvas>` element. Used on login page and footer. Colors: dark navy `#0B0F19` base, purple glow only — no cyan or teal.

### `loadFooter()`
**File:** `assets/js/footer-loader.js`
Auto-runs on landing pages. Fetches `includes/footer.html`, appends to `<body>`, loads `assets/css/footer.css`, and calls `initUniverseCanvas()`. App pages with `#sidebar` must not load the marketing footer.

---

## 7. Key HTML Element IDs (referenced by JS — do not rename)

| ID | File | Purpose |
|----|------|---------|
| `kpi-revenue` | `dashboard.html` | Revenue KPI display value |
| `overview-period-selector` | `dashboard.html` | Overview-wide period selector |
| `revenue-scope-label` | `dashboard.html` | Visible Revenue KPI period scope |
| `revenue-record-count` | `dashboard.html` | Visible Revenue KPI record count |
| `revenue-secondary-label` | `dashboard.html` | All-time or this-month Revenue helper label |
| `revenue-secondary-value` | `dashboard.html` | All-time or this-month Revenue helper value |
| `kpi-opex` | `dashboard.html` | OpEx KPI display value |
| `kpi-margin` | `dashboard.html` | Margin % display value |
| `kpi-margin-bar` | `dashboard.html` | Margin progress bar (width set as %) |
| `ledger-body` | `dashboard.html`, `ledger.html` | `<tbody>` populated by JS |
| `ledger-table-container` | `dashboard.html` | Shown/hidden based on data presence |
| `ledger-empty-state` | `dashboard.html` | Shown when 0 transactions |
| `ledger-footer` | `dashboard.html` | Hidden when 0 transactions |
| `global-tx-modal` | Injected | Modal wrapper — removed on close |
| `global-tx-form` | Injected | Modal form |
| `tx-amount` | Injected | Amount input in modal |
| `tx-vendor` | Injected | Vendor name input in modal |
| `tx-category` | Injected | Category dropdown in modal |
| `tx-type` | Injected | Type dropdown in modal |
| `tx-submit-btn` | Injected | Submit button in modal |
| `toast-container` | Injected | Toast notification host |
| `sidebar` | All app pages | Sidebar container (populated by sidebar-loader.js) |
| `sidebar-user-name` | Sidebar | User display name |
| `sidebar-user-avatar` | Sidebar | User avatar `<img>` |
| `settings-search` | `settings.html` | Index page search input |
| `company-settings-form` | `settings-business.html` (Account details tab) | Saves `settings/company` (name + entity label) |
| `company-details-form` | `settings-business.html` (Business details tab) | Saves `settings/company` (business_type + country) |
| `finance-settings-form` | `settings-finance.html` | Saves `settings/finance` |
| `import-settings-form` | `settings-import-rules.html` | Saves `settings/import_rules` |
| `ai-settings-form` | `settings-ai.html` | Saves `settings/ai` |
| `whatsapp-settings-form` | `settings-whatsapp.html` | Saves `settings/whatsapp` |
| `login-universe-canvas` | `login.html` | Canvas for starfield animation |

---

## 8. Sidebar Navigation (sidebar-loader.js)

Sidebar is injected into every app page at `#sidebar`. Active item is detected by `window.location.pathname`.

| Group | Item | Element id | Type | Route / Action | Status |
|-------|------|-----------|------|----------------|--------|
| Command | Overview | `nav-overview` | Link | `/dashboard` | ✅ Shipped |
| Command | Fluxy AI | `nav-fluxy-ai` | Link | `/ai` | ✅ Shipped |
| Money Movement | Transactions | `nav-ledger` | Link | `/ledger` | ✅ Shipped |
| Money Movement | Revenue Sync | `nav-revenue-sync` | Link | `/revenue-sync` | ✅ Shipped |
| Money Movement | Bills | `nav-bills` | Link | `/bill` | ✅ Shipped |
| Money Movement | Subscriptions | `nav-subscriptions` | Link | `/subscription` | ✅ Shipped |
| Operations | Budgets | `nav-budgets` | Link | `/budget` | ✅ Shipped Phase 1 |
| Operations | Invoices | `nav-invoices` | Link | `/invoices` | ✅ Shipped MVP |
| Operations | Inventory | `nav-inventory` | Link | `/inventory` | ✅ Shipped — item master + stock on hand |
| Operations | Approvals | `nav-approvals` | Disabled button | `Soon` | 📋 Planned |
| Reporting | Accounting Center | `nav-accounting` | Link | `/accounting` | ✅ Shipped |
| Reporting | Outlet P&L | `nav-outlet-pnl` | Link | `/outlet-pnl` | ✅ Shipped — per-dimension income statement |
| Reporting | Reports & Exports | `nav-reports` | Link | `/reports` | ✅ Shipped MVP |
| Reporting | Activity Log | `nav-activity-log` | Link (`hidden`) | `/activity-log` | 🚧 Built, hidden |
| Tax & Compliance | Tax Center | `nav-tax-center` | Link | `/tax-center` | ✅ Shipped Phase 1 |
| Workspace | Integrations | `nav-integrations` | Link | `/integration` | ✅ Shipped |
| Workspace | Settings | `nav-settings` | Link | `/settings` | ✅ Shipped MVP |

**Balance Sheet page retired (2026-07-29).** The standalone `/balance-sheet` and
`/balance-sheet-records` pages are **deleted**; both 301 to `/accounting?tab=balance`
(rules in `deploy/_redirects.app` and `netlify.toml`). They were records-derived with
no chart of accounts, journals, retained earnings, or equity logic, and reported
**Net Position** where the ledger statement reports **Equity**. The Accounting
Center's ledger-derived Balance Sheet is now the only one, and it carries the CSV
export ported from the retired page (`exportBalanceSheet` in `accounting.js`,
audit-logged through `report_exports`). See `docs/ACCOUNTING_CENTER_IA.md` Phase 3.

Future sidebar entries stay visible only as disabled `Soon` buttons until a real
authenticated app page exists. Dashboard sidebar entries must never link to
public marketing pages.

Active styles: orange text/icon `#EA580C` on a transparent background.

---

## 9. Backend API Endpoints (main.py)

Base URL (local): `http://localhost:8000/api/v1`
Base URL (Netlify): `/.netlify/functions/api/v1`

| Method | Path | Request | Response |
|--------|------|---------|----------|
| GET | `/dashboard/summary` | — | `{revenue, revenue_change, opex, margin, action_items_count, action_items_details}` |
| GET | `/dashboard/ledger` | — | Array of `{id, vendor_name, amount, status, timestamp, category_name, entity_name, icon}` |
| POST | `/brain/chat` | `{message: string}` | `{response: string, suggested_action?: string}` |

**Note:** The current dashboard uses Firebase Firestore directly (not the API). The API endpoints are legacy/fallback. New features should use Firestore via `db-service.js`.

---

## 10. Brand & Design Conventions

| Token | Value | Usage |
|-------|-------|-------|
| Orange (Primary CTA) | `#EA580C` | Buttons, active sidebar items, logo accent |
| Dark Navy (Background) | `#0B0F19` | Footer, login left panel, sidebar |
| Purple Glow | `rgba(109,40,217,0.4)` | Canvas nebula edges, footer border, subtle accents |
| Gray-50 | `#F9FAFB` | Landing page section backgrounds |
| White | `#FFFFFF` | Main content area, cards |
| Logo | Black square (`#000000`), rx=8, white F path | Navbar (black on light), footer (orange on dark) |
| Favicon | `assets/images/favicon.svg` | Black F-logo, all pages |
| Fonts | Inter (body/UI), Fira Code (mono/code) | Via Google Fonts CDN |
| Icons | Heroicons SVG (stroke, not filled) | All UI icons |
| Amount locale | Indonesian (`id-ID`) | Dot as thousands separator |

Use-case hero product visuals are light-first: use white/off-white surfaces with
gray borders, not black/dark dashboard cards. Use-case hero titles should use
the shared marketing scale `text-[44px] md:text-[56px]`. Non-hero use-case
sections may use the established dark section pattern when it improves contrast
or hierarchy.

---

## 11. Git & Deployment Workflow

```
Work happens in worktree:
  /Users/slumdogmacbookair/Desktop/fluxionos/.claude/worktrees/confident-blackburn-3cefd2
  Branch: claude/confident-blackburn-3cefd2

Merge to main repo:
  git -C /Users/slumdogmacbookair/Desktop/fluxionos merge claude/confident-blackburn-3cefd2 --no-edit

Push to production:
  git -C /Users/slumdogmacbookair/Desktop/fluxionos push origin main

Netlify auto-deploys on main push. No manual deploy step needed.
```

---

## 12. What Does NOT Exist Yet (Avoid Duplicating)

- Edit / delete for transactions, bills, subscriptions (stubs exist but no handler)
- "Pay Now" on bills (button exists, no handler)
- "Manage" on subscriptions (button exists, no handler)
- Real AI backend — `/api/v1/brain/chat` exists but returns mock data
- CSV export for bills (button exists, no handler)
- Date range filtering on dashboard (button exists, no handler)
- Search on bills/subscriptions tables (input exists, no handler). Ledger search is implemented client-side against the selected date period.

**Before building any of the above: check this list first to avoid rebuilding from scratch.**

---

## 13. Reports & Exports (`reports.html`)

Reports & Exports is the controlled export workflow that turns user-scoped
records into a sendable finance package. It is an authenticated app page —
auth guard, sidebar, no marketing footer.

Flow: **choose period → check readiness → preview → confirm export → audit log**.

### Data sources (all user-scoped)

- Transactions: `users/{userId}/transactions`
- Bills: `users/{userId}/bills`
- Subscriptions: `users/{userId}/subscriptions`
- Recent export history: filtered from `users/{userId}/audit_logs`
  (`action == "export.create"`)

Period scope uses the shared `FluxyDateRangePicker`. Default range is the
current month. `DataService` exposes `getTransactionsForPeriod`,
`getBillsForPeriod`, `getSubscriptionsForPeriod`, `getRecentExportLogs`, and
`createExportAuditLog`.

### Report packages and CSV files

| Package | Files generated (slug = period, e.g. `2026_05`) |
|---------|-------------------------------------------------|
| Monthly Report Pack | `profit_loss_{slug}.csv`, `expense_breakdown_{slug}.csv`, `bills_payables_{slug}.csv`, `subscriptions_{slug}.csv`, `ledger_export_{slug}.csv`, `data_quality_{slug}.csv` |
| Profit & Loss | `profit_loss_{slug}.csv` |
| Expense Breakdown | `expense_breakdown_{slug}.csv` |
| Bills & Payables | `bills_payables_{slug}.csv` |
| Subscriptions | `subscriptions_{slug}.csv` |
| Ledger Export | `ledger_export_{slug}.csv` |
| Data Quality | `data_quality_{slug}.csv` |

### Calculation rules

- **Revenue** = sum of `amount` where `type ∈ {income, revenue, refund, pending_receivable}`
- **OpEx** = sum of `Math.abs(amount)` where `type ∈ {expense, fee, tax, pending_payable}`
- **Gross margin** = `revenue > 0 ? (revenue - opex) / revenue * 100 : 0`
  Never emit `NaN` or `Infinity`.
- **Net result** = `revenue - opex`
- **Readiness score**: starts at 100, subtracts `4 × missing_receipts +
  6 × bills_without_due_date + 6 × subs_without_renewal`, clamped to `[0, 100]`.
  If there are no records, score is `null` and UI shows "Not enough data".

### Export rules

- Generation never starts without an explicit Confirm export click.
- CSV files store **raw integer amounts** (never `Rp1.234.567` display strings).
- Audit log (`action: "export.create"`, `target_collection: "exports"`) is
  written **before** files are delivered. `"exports"` is the value allowlisted
  by `firestore.rules` (`isValidAuditLog`) for this flow. If the log write fails, no file is
  downloaded.
- Audit log `after` payload contains report type, period, formats,
  included sources, `record_counts`, and `warning_counts`. **It does not
  contain row-level financial data or CSV content.**
- Verified vs basic user: MVP defaults to verified. Future work: gate on a
  `users/{uid}/settings/account.verification_status` field; UI is already
  wired to disable Confirm export with a lock reason.

### Level 1 report viewer (`report-preview.html`)

The drawer's **Open Full Report** CTA stages a normalized
`monthlyReportPack` object into `sessionStorage` under
`fluxyos_report_preview` and navigates to `/report-preview`. The viewer
auth-guards, reads from sessionStorage, and renders all nine sections
(Cover, Executive Summary, Key Takeaways, Profit & Loss, Period
Comparison, Finance Predictability, Expense Breakdown, Bills &
Subscription Commitments, Report Confidence Method, Data Quality &
Cleanup, Export Manifest).

Toolbar actions:

- **Back to Reports** → returns to `/reports`
- **Print / Save PDF** → calls `window.print()` (browser-native PDF save;
  the app cannot verify the user actually saved the file, so no
  `downloaded: true` is ever logged)
- **Download CSV Bundle** → six sequential CSV downloads from the same
  report model
- **Confirm Export** → writes `report_exports` + `export.create` audit log
  (formats: `["pdf_print", "csv_bundle"]`)

`assets/js/report-builder.js` is the single source of truth for report
calculations. Both `reports.js` and `report-preview.js` import from it
so financial logic is never duplicated.

### `users/{userId}/report_exports/{exportId}`

Metadata for confirmed exports. Append-only. Must never contain
row-level financial data or CSV content.

| Field | Type | Notes |
|-------|------|-------|
| `report_type` | string | `"monthly_report_pack"`, `"profit_loss"`, etc. |
| `report_scope` | map \| absent | Optional. For YTD/YoY/quarter-to-date exports, stores `{ mode, comparison_mode, current_period, comparison_period, generated_title, fiscal_year_basis }`. |
| `period_start` / `period_end` | ISO date string | Current period (matches `report_scope.current_period` when present). |
| `formats` | string[] | Subset of `["csv_bundle", "pdf_print"]` |
| `status` | string | `"generated"` for Level 1 |
| `included_sections` | string[] | Section keys included in this run |
| `record_counts` | map | `{transactions, bills, subscriptions, current_period_transactions, comparison_period_transactions}` |
| `warning_counts` | map | `{missing_receipts, bills_without_due_date, subscriptions_without_renewal}` |
| `limitations` | string[] | e.g., "Previous-year records not found" |
| `created_at` | Timestamp | `serverTimestamp()` |
| `created_by` | string | `request.auth.uid` |

**Mutation rule:** owner read/create only — update and delete are
blocked. Recent Exports on `reports.html` reads from this collection.

### Report scope (YTD / YoY / QTD)

The Reports & Exports filter strip exposes two controls that drive the
shared `monthlyReportPack` model:

- **Report period:** `monthly | last_month | quarter_to_date | year_to_date | custom`
- **Compare with:** `none | previous_period | same_period_last_year | previous_year_to_date`

`report-builder.js → resolveReportScope({...})` turns those inputs into a
concrete `report_scope` object with current and comparison periods,
generated title (e.g. `2026 YTD Year-on-Year Financial Report`), and
fiscal-year basis (calendar year for MVP). Date math handles leap years
(Feb 29 → Feb 28 when the previous year is not a leap year) and clamps
end-of-period for partial months.

YTD/QTD modes add `ytd_summary` (averages, best/worst month, partial-
month flag) and `monthly_trend` to the pack. YoY comparison modes add
`yoy_comparison` (with `change_pct` returning `null` when previous is
zero, never `NaN`/`Infinity`) and `monthly_trend_comparison`.

Source-file lists are scope-aware: monthly exports emit
`profit_loss_YYYY_MM.csv` etc; YTD emits `ytd_profit_loss_YYYY.csv` +
`monthly_trend_YYYY_ytd.csv`; YTD YoY emits
`yoy_profit_loss_YYYY_vs_YYYY-1_ytd.csv` +
`monthly_trend_yoy_YYYY_vs_YYYY-1.csv`.
