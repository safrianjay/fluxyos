# FluxyOS Reports & Exports Page — Revamped Build Plan

## 0. Purpose of This Document

This MD file defines the updated product, UX, and implementation plan for the **Reports & Exports** page in FluxyOS, based on the refined sample design direction.

The goal is to help Claude Code implement the page as a real authenticated FluxyOS app module, not a generic dashboard card grid.

The updated design direction is:

> Choose a period → check report readiness → preview report → confirm export → write audit log.

This page must feel like a **finance control surface** for trusted reporting, not a visual-heavy SaaS template.

---

## 1. Product Context

FluxyOS is a finance operating system for Indonesian businesses. The Reports & Exports page is part of the Reporting domain and should help users create trusted, exportable finance outputs from their real FluxyOS records.

This page should answer:

- What financial report can I send out?
- What period does it cover?
- What records are included?
- What data is missing or risky?
- What files will be exported?
- Did the export leave an audit trail?

This page must not answer these questions with hardcoded or fake values.

---

## 2. External Product Reference Pattern

Use accounting/reporting tools only as structural references, not as visual references.

### QuickBooks pattern

QuickBooks supports exporting reports/data for sharing and access. The useful pattern is:

- reports are selected intentionally
- export is an action attached to a report
- export is treated as a data handoff, not decoration

Reference:
https://quickbooks.intuit.com/learn-support/en-global/help-article/list-management/export-data-reports-lists-quickbooks-online/L1xleDrLp_ROW_en

### Xero pattern

Xero allows reports to be exported or printed, with formats such as PDF, Microsoft Excel, and Google Sheets. The useful pattern is:

- preview/report view first
- export/print format choice second
- output is tied to the selected report state

Reference:
https://central.xero.com/s/article/Export-or-print-a-report

### OWASP logging pattern

Financial export is a sensitive action. Export metadata should be logged, and logs should avoid sensitive payloads.

Relevant OWASP logging guidance:
https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html

---

## 3. Feature Type

This is a combination of:

- Page-level feature
- Workflow feature
- Governance/security feature

It belongs in the sidebar under:

```text
Reporting → Reports & Exports
```

Current sidebar state should change from disabled `Soon` to a real authenticated route.

---

## 4. Main Objective

Help authenticated users generate trustworthy period-based finance reports from real FluxyOS data, with preview, confirmation, export, and audit logging.

---

## 5. Job To Be Done

When I need to send finance data to an accountant, investor, founder, or internal team,  
I want to generate a clear report package from real FluxyOS records,  
so I can confidently share the numbers without manually assembling spreadsheets.

---

## 6. Target Users

Primary:

- Business owner
- Founder
- Finance admin

Secondary:

- Accountant
- Operations manager
- Internal reviewer
- Future read-only viewer role

---

## 7. User Problem

Today, users can add transactions, bills, and subscriptions, but they do not yet have a trusted place to produce formal outputs from those records.

Without a dedicated reporting module, users have to:

- manually export ledger rows
- combine multiple sources themselves
- guess whether data is complete
- send raw data without warnings
- lose track of who exported what and when

The page must solve this by turning raw records into controlled report packages.

---

## 8. Business Value

This page increases FluxyOS product value because it:

- makes FluxyOS useful beyond daily entry
- supports accountant handoff
- increases trust in the ledger
- turns data quality into a visible product loop
- creates a natural upgrade/verification boundary
- makes the product feel like a finance operating system, not a static dashboard

---

## 9. Design Direction From Updated Sample

The first design was too generic because it used too many equal-weight report cards. The updated design uses a stronger hierarchy:

### New hierarchy

1. **Page intent**
   - “Choose a period. Check readiness. Export only after review.”

2. **Report readiness**
   - A compact readiness score and coverage bars.

3. **Filter strip**
   - Period
   - Report package
   - Data source
   - Apply

4. **Recommended output**
   - Monthly Report Pack as the dominant primary report.

5. **Individual reports**
   - Table-based list instead of card grid.

6. **Right-side intelligence/governance column**
   - Data coverage
   - Needs cleanup
   - Recent exports

7. **Preview drawer**
   - Financial summary
   - Included sources
   - Generated files
   - Warnings
   - Confirm export action

This should feel operational, dense, and controlled.

---

## 10. UX Principles

### Do

- Use a clear reporting workflow.
- Use one dominant primary action.
- Prefer table/list density for report options.
- Show data coverage before export.
- Show data quality warnings before export.
- Use preview drawer before file generation.
- Confirm export explicitly.
- Log export metadata after successful export.
- Keep color usage restrained.
- Use orange only as an accent, not as a background.
- Use real data only.

### Do not

- Do not use a generic card grid as the main pattern.
- Do not show many equal-weight CTAs.
- Do not auto-download files from a report card.
- Do not use hardcoded sample financial numbers in production.
- Do not show fake trends or fake report readiness.
- Do not export without user confirmation.
- Do not export across users.
- Do not put the marketing footer on this app page.
- Do not introduce React, npm, a bundler, or framework migration.

---

## 11. Route and Files

### New route/page

Create:

```text
reports.html
```

Clean URL should be:

```text
/reports
```

or, if the current route convention prefers:

```text
/reports-export
```

Recommended route:

```text
/reports
```

because the sidebar label is “Reports & Exports,” but the route can stay clean and short.

### Files to update

Likely files:

```text
reports.html
assets/js/reports.js
assets/js/db-service.js
assets/js/sidebar-loader.js
assets/css/shared-dashboard.css
PROJECT_BACKGROUND.md
ROADMAP.md
QA_CHECKLIST.md
```

If Netlify routing requires explicit redirects, also inspect:

```text
netlify.toml
```

### Files to read before implementation

Claude Code must read:

```text
CLAUDE.md
docs/PROJECT_BACKGROUND.md
docs/SYSTEM_DESIGN.md
docs/SECURITY_SYSTEM.md
docs/QA_CHECKLIST.md
docs/product_ux_feature_intake_framework.md
docs/ROADMAP.md
```

If `fluxyos_multi_agent_workflow_rules.md` exists, read it too.

---

## 12. Existing Product Constraints

Use the existing FluxyOS stack:

- Static HTML
- Tailwind / vanilla CSS
- Vanilla JS
- Firebase Auth
- Firestore
- FastAPI only when needed
- Data scoped only under `users/{userId}/...`

No framework migration.

No global finance collections.

No OpenAI involvement needed for MVP export generation.

---

## 13. Page Structure

### 13.1 Authenticated app shell

The page must include:

```html
<div id="sidebar"></div>
```

And load:

```html
<link rel="stylesheet" href="assets/css/shared-dashboard.css">
<script src="assets/js/sidebar-loader.js"></script>
<script src="assets/js/shared-dashboard.js"></script>
<script type="module" src="assets/js/db-service.js"></script>
<script type="module" src="assets/js/reports.js"></script>
```

Follow the same auth guard pattern as existing app pages.

The marketing footer must not load.

---

## 14. Visual Layout

### 14.1 App shell

Use the existing dashboard layout:

- fixed 220px sidebar
- white sidebar
- white topbar
- gray app background
- content max width around 1400px
- desktop padding around 32px
- mobile padding around 20px

### 14.2 Topbar

Content:

```text
Reports & Exports
[View audit trail] [Generate report]
```

Primary action:

```text
Generate report
```

The action should open the report preview flow for the selected default package.

### 14.3 Intro section

Two-column layout on desktop:

Left: main explanation card  
Right: report readiness panel

Left copy:

```text
Controlled financial export

Choose a period. Check readiness. Export only after review.

This page turns FluxyOS records into a sendable finance package without pretending the data is cleaner than it is. The main job is trust: what is included, what is missing, and what gets logged.
```

Workflow chips:

```text
1 Select period
2 Review coverage
3 Preview report
4 Confirm export
```

### 14.4 Report readiness panel

Show:

- readiness score
- ledger completeness
- receipt coverage
- bills with due dates

Example labels:

```text
Report readiness
Enough data to generate May report, but receipt coverage needs cleanup before accountant handoff.

Ledger completeness
Receipt coverage
Bills with due dates
```

Important:

- These values must be calculated from real data.
- If no data exists, show no-data state instead of fake score.
- If readiness cannot be calculated, show “Not enough data.”

### 14.5 Filter strip

Fields:

```text
Reporting period
Report package
Data source
Apply
```

For date range:

- use shared `FluxyDateRangePicker`
- do not use native date input in production
- default to current month
- disable future dates
- report counts and exports must follow selected range

Report package options:

```text
Monthly Report Pack
Profit & Loss only
Ledger export only
Data quality only
```

Data source options:

```text
Transactions, bills, subscriptions
Transactions only
Bills only
Subscriptions only
```

Future option:

```text
Revenue Sync
```

Only include Revenue Sync when the data source exists and is implemented.

---

## 15. Main Content Structure

### 15.1 Recommended output panel

This is the central focus.

Title:

```text
Recommended output
```

Description:

```text
A single monthly pack is the default because it matches the real user job: handoff, review, and decision-making.
```

Status tag:

```text
Verified export enabled
```

If user is not verified:

```text
Preview available · Export locked
```

### 15.2 Monthly Report Pack card

This is the primary report module.

Content:

```text
Monthly Report Pack

One controlled export containing P&L, expense breakdown, payables, subscriptions, ledger rows, and data quality notes for the selected period.
```

Actions:

```text
Generate preview
Fix warnings first
```

`Generate preview` is primary.

`Fix warnings first` is secondary and can link to Ledger/Data Quality later. For MVP, it may scroll/focus the Needs Cleanup panel.

### 15.3 Report detail list

Use key-value rows, not more cards.

Rows:

| Label | Value | Status |
|---|---|---|
| Primary use | Monthly close, accountant handoff, founder review | Core |
| Included files | Profit & Loss CSV, Expense Breakdown CSV, Bills CSV, Subscriptions CSV, Ledger CSV, Data Quality CSV | 6 files |
| Export formats | CSV bundle first. PDF summary can be generated from preview state. | CSV / PDF |
| Security | User must confirm export. Export metadata is stored in audit log. | Logged |
| Limitations | Revenue Sync is excluded until connected. Missing receipts are listed as report warnings. | Partial data |

In production, `Limitations` should be dynamic.

---

## 16. Individual Reports Table

Use a table instead of a card grid.

Columns:

```text
Report
Purpose
Data source
Format
Action
```

Rows:

### Profit & Loss

Purpose:

```text
Understand official result for the period.
```

Data source:

```text
Transactions + pending receivables/payables
```

Format:

```text
CSV / PDF
```

### Expense Breakdown

Purpose:

```text
Find where money went and which vendors dominate spend.
```

Data source:

```text
Transactions + subscriptions
```

Format:

```text
CSV
```

### Bills & Payables

Purpose:

```text
Review short-term cash pressure from unpaid bills.
```

Data source:

```text
Bills
```

Format:

```text
CSV
```

### Subscriptions

Purpose:

```text
Track SaaS renewals and recurring vendor costs.
```

Data source:

```text
Subscriptions
```

Format:

```text
CSV
```

### Data Quality

Purpose:

```text
List missing receipts, missing dates, and incomplete records.
```

Data source:

```text
All finance records
```

Format:

```text
CSV
```

Each row action:

```text
Preview
```

Never use direct export from the table row.

---

## 17. Right-Side Column

### 17.1 Data Coverage

Show scoped record counts for the selected period.

Items:

```text
Transactions
Bills
Subscriptions
Revenue Sync
```

Rules:

- show `0` if no records
- show `Not connected` for Revenue Sync if unavailable
- never fake counts
- update when filters change

### 17.2 Needs Cleanup

Show data quality warnings.

Initial warning types:

```text
Missing receipts
Bills without due date
Subscriptions without renewal
```

Future warning types:

```text
Uncategorized transactions
Unknown vendors
Unsupported transaction type
Invalid amount
Missing timestamp
Duplicate-looking records
```

Each warning should show:

- warning label
- short explanation
- count

### 17.3 Recent Exports

Show latest export audit records.

Source:

```text
users/{userId}/audit_logs
```

Filter:

```text
action == "export.create"
```

If query limitations make this hard client-side, fetch latest audit logs and filter in JS for MVP.

Show:

```text
Report name
Period
Actor display name if available
Status
Timestamp
```

If no export logs exist:

```text
No exports yet. Confirmed exports will appear here.
```

---

## 18. Preview Drawer

The preview drawer is required before export.

Open drawer when user clicks:

```text
Generate preview
Preview
Generate report
```

### Drawer title

```text
Preview: {reportName}
```

### Drawer description

```text
Confirm the period, included sources, generated files, and warnings before exporting financial data.
```

### Drawer sections

#### 18.1 Notice

If this is development/sample state:

```text
This is a sample UI state. Production must calculate values from authenticated user-scoped records under users/{userId}/...
```

Remove or replace this in production with real limitations.

#### 18.2 Financial summary

For Monthly Report Pack / Profit & Loss:

```text
Revenue
OpEx
Gross margin
Net result
```

Rules:

- Revenue includes `income`, legacy `revenue`, `refund`, and `pending_receivable`.
- OpEx includes `expense`, `fee`, `tax`, and `pending_payable`.
- Gross margin = `((revenue - opex) / revenue) * 100`.
- If revenue is 0, show `0%` or `Not available`, never `NaN` or `Infinity`.

#### 18.3 Included sources

Show:

```text
Transactions
Bills
Subscriptions
Revenue Sync
```

With statuses:

```text
Included
Excluded
Not connected
No records
```

#### 18.4 Generated files

For Monthly Report Pack:

```text
profit_loss_{period}.csv
expense_breakdown_{period}.csv
bills_payables_{period}.csv
subscriptions_{period}.csv
ledger_export_{period}.csv
data_quality_{period}.csv
```

For individual reports, only show the relevant file.

#### 18.5 Warnings

If there are data quality issues, show them before confirmation:

```text
6 transactions are missing receipts
2 bills have no due date
1 subscription has no renewal date
```

### Drawer footer

Actions:

```text
Cancel
Confirm export & log action
```

Confirm export should be disabled when:

- data is still loading
- user is not verified
- user lacks export permission in future role model
- no records exist for selected scope
- report generation failed

---

## 19. Report Data Sources

### Transactions

Path:

```text
users/{userId}/transactions
```

Fields:

```text
amount
vendor_name
category
type
status
timestamp
icon
```

### Bills

Path:

```text
users/{userId}/bills
```

Fields:

```text
amount
vendor_name
category
type
status
timestamp
due_date
```

### Subscriptions

Path:

```text
users/{userId}/subscriptions
```

Fields:

```text
amount
vendor_name
category
type
status
timestamp
renewal_date
```

### Audit logs

Path:

```text
users/{userId}/audit_logs
```

Used for:

```text
Recent exports
Export confirmation history
```

---

## 20. DataService Requirements

Add new methods to `assets/js/db-service.js`.

Do not scatter raw Firestore paths inside `reports.js`.

Recommended methods:

```js
async getReportSourceData(userId, { startDate, endDate, sources })
```

Returns:

```js
{
  transactions: [],
  bills: [],
  subscriptions: []
}
```

Optional individual methods if easier:

```js
async getTransactionsForPeriod(userId, startDate, endDate)
async getBillsForPeriod(userId, startDate, endDate)
async getSubscriptionsForPeriod(userId, startDate, endDate)
async getRecentExportLogs(userId, limitCount = 10)
async addExportAuditLog(userId, payload)
```

If existing `getTransactions`, `getBills`, and `getSubscriptions` do not support date filtering yet, either:

1. add period-specific methods, or
2. fetch existing records and filter in JS for MVP.

Preferred:

- add period-specific methods
- keep newest-first ordering
- apply user scope
- keep records limited where possible

---

## 21. Report Calculation Rules

### Revenue

Include transaction types:

```text
income
revenue
refund
pending_receivable
```

### OpEx

Include transaction types:

```text
expense
fee
tax
pending_payable
```

### Gross margin

```js
const margin = revenue === 0 ? 0 : ((revenue - opex) / revenue) * 100;
```

Never show:

```text
NaN
Infinity
-Infinity
```

### Net result

```js
netResult = revenue - opex
```

### Bills payable total

For bills, use amount where:

```text
type == pending_payable
```

or all bill amounts if bill records are treated as payables by definition.

Be explicit in code comments.

### Missing receipts

```js
status === "Missing Receipt"
```

### Bills without due date

```js
!bill.due_date
```

### Subscriptions without renewal

```js
!subscription.renewal_date
```

---

## 22. Export Format Requirements

### MVP

Allowed:

```text
CSV
```

Optional:

```text
PDF summary through print-friendly HTML
```

Do not introduce a heavy PDF library unless explicitly approved.

### CSV files

CSV output should include raw numbers, not formatted Rupiah strings.

Display can use:

```text
Rp 1.234.567
```

CSV should use:

```text
1234567
```

### Monthly Report Pack CSV files

Generate a zip only if the project already has safe support or a simple library is approved.

MVP alternative:

- generate one CSV at a time for selected report
- or create multiple CSV download actions after confirmation

Recommended MVP:

- Monthly Report Pack confirmation generates multiple CSV downloads sequentially
- if browser blocks multiple downloads, show one download button per generated file after confirmation

### File naming

Use lowercase snake case:

```text
profit_loss_2026_05.csv
expense_breakdown_2026_05.csv
bills_payables_2026_05.csv
subscriptions_2026_05.csv
ledger_export_2026_05.csv
data_quality_2026_05.csv
```

For custom date range:

```text
profit_loss_2026_05_01_to_2026_05_31.csv
```

---

## 23. CSV Schemas

### 23.1 Profit & Loss CSV

```csv
Report,Profit & Loss
Period Start,2026-05-01
Period End,2026-05-31
Generated At,2026-05-20T10:30:00Z

Metric,Amount
Revenue,86500000
OpEx,42300000
Gross Margin %,51.1
Net Result,44200000

Data Source,Record Count
transactions,42
bills,8
subscriptions,5

Warnings,Count
Missing Receipt,6
Missing Due Date,2
Missing Renewal Date,1
```

### 23.2 Expense Breakdown CSV

```csv
Category,Amount,Record Count
Infrastructure,14800000,7
Marketing,11600000,9
Operations,9400000,12
SaaS,6500000,5

Vendor,Amount,Record Count
AWS,2800000,2
Figma,850000,1
Office Rent,12000000,1
```

### 23.3 Bills & Payables CSV

```csv
Date,Vendor,Category,Type,Amount,Status,Due Date,Record ID
2026-05-05,Office Rent,Operations,pending_payable,12000000,Completed,2026-05-15,bill_001
```

### 23.4 Subscriptions CSV

```csv
Date,Vendor,Category,Type,Amount,Status,Renewal Date,Record ID
2026-05-07,Figma,SaaS,expense,850000,Completed,2026-06-07,sub_001
```

### 23.5 Ledger Export CSV

```csv
Date,Source,Vendor,Category,Type,Amount,Status,Record ID
2026-05-01,transactions,Client Payment,Revenue,income,12500000,Completed,tx_001
2026-05-03,transactions,AWS,Infrastructure,expense,2800000,Missing Receipt,tx_002
```

### 23.6 Data Quality CSV

```csv
Issue Type,Source,Record ID,Vendor,Description,Severity
Missing Receipt,transactions,tx_002,AWS,Transaction is missing receipt,warning
Missing Due Date,bills,bill_002,Vendor X,Bill has no due date,warning
Missing Renewal Date,subscriptions,sub_003,Tool Y,Subscription has no renewal date,warning
```

---

## 24. Audit Logging

Every confirmed export must write an audit log.

Path:

```text
users/{userId}/audit_logs
```

Action:

```text
export.create
```

Recommended payload:

```js
{
  actor_uid: currentUser.uid,
  actor_role: null,
  action: "export.create",
  target_collection: "reports",
  target_id: reportRunId,
  before: null,
  after: {
    report_type: selectedReportType,
    period_start: startDateISO,
    period_end: endDateISO,
    formats: ["csv"],
    included_sources: ["transactions", "bills", "subscriptions"],
    record_counts: {
      transactions: transactions.length,
      bills: bills.length,
      subscriptions: subscriptions.length
    },
    warning_counts: {
      missing_receipts: missingReceiptsCount,
      missing_due_dates: missingDueDatesCount,
      missing_renewal_dates: missingRenewalDatesCount
    }
  },
  reason: null,
  source: "dashboard",
  created_at: serverTimestamp()
}
```

Do not store full exported row data in the audit log.

Do not store CSV content in the audit log.

Do not allow editing/deleting audit logs.

---

## 25. Basic vs Verified User Logic

MVP can use a placeholder user verification field if already available.

Possible future field:

```text
users/{userId}/profile.verification_status
```

or:

```text
users/{userId}/settings/account.verification_status
```

Do not invent a new schema unless approved.

If no verified-user field exists yet:

- implement UI as ready for the state
- default current users to export-enabled
- add TODO comments for future verification gate

### Basic user behavior

Basic users can:

- open Reports & Exports
- select period
- preview report structure
- see data coverage
- see warnings

Basic users cannot:

- confirm export
- download files

CTA text:

```text
Export locked · Complete verification
```

### Verified user behavior

Verified users can:

- preview reports
- confirm export
- download CSV files
- create export audit log

---

## 26. Empty States

### No records at all

Show:

```text
No report data yet

Reports are generated from real FluxyOS records.
Add transactions, bills, or subscriptions first before creating a report.

[Add Transaction] [Add Bill]
```

Actions:

- Add Transaction opens shared transaction drawer
- Add Bill opens shared bill drawer

### No records in selected period

Show:

```text
No records for this period

Try another date range or add records for this period.
```

### No export history

Show:

```text
No exports yet

Confirmed exports will appear here after a report is downloaded.
```

### Revenue Sync not connected

Show:

```text
Revenue Sync not connected
This source is excluded from the report.
```

Do not treat it as an error.

---

## 27. Loading and Error States

### Loading

Show skeleton/shimmer for:

- readiness panel
- data coverage
- report table
- recent exports
- preview drawer

Use existing shared shimmer helper if available.

### Error

If Firestore read fails:

```text
Unable to load report data.
Please refresh or try again.
```

If export generation fails:

```text
Export failed.
No file was downloaded and no audit log was created.
```

If audit log write fails after file generation:

Preferred behavior:

- do not download until audit log write succeeds
- if log fails, block export and show error

This keeps export history trustworthy.

---

## 28. Export Flow

### Generate preview

1. User selects date range and report package.
2. User clicks Generate Preview.
3. Frontend fetches scoped data.
4. Frontend calculates report summary.
5. Frontend builds preview state.
6. Drawer opens.

### Confirm export

1. User clicks Confirm export & log action.
2. Frontend validates user is authenticated.
3. Frontend validates export is allowed.
4. Frontend writes audit log.
5. Frontend generates CSV file(s).
6. Frontend triggers download.
7. Frontend shows success toast.
8. Recent exports list refreshes.

Important:

- Do not generate/download files before confirmation.
- Do not write audit log if user cancels.
- Do not write audit log for preview-only.
- Do not export if the user session has expired.
- Do not export empty files unless user explicitly confirms an empty report.

---

## 29. Frontend State Model

Recommended page-level state:

```js
const reportsState = {
  user: null,
  isVerified: true,
  selectedPeriod: {
    label: "This Month",
    startDate: null,
    endDate: null
  },
  selectedReportType: "monthly_report_pack",
  selectedSources: ["transactions", "bills", "subscriptions"],
  sourceData: {
    transactions: [],
    bills: [],
    subscriptions: []
  },
  derived: {
    revenue: 0,
    opex: 0,
    grossMargin: 0,
    netResult: 0,
    recordCounts: {},
    warningCounts: {},
    readinessScore: null
  },
  recentExports: [],
  loading: false,
  previewOpen: false,
  exportInProgress: false,
  error: null
};
```

---

## 30. Suggested JS Function Structure

Create `assets/js/reports.js`.

Recommended functions:

```js
initReportsPage()
bindReportEvents()
loadReportData()
applyReportFilters()
calculateReportDerivedData(sourceData)
calculateReadinessScore(derived)
renderIntroReadiness()
renderDataCoverage()
renderNeedsCleanup()
renderRecommendedReport()
renderIndividualReportsTable()
renderRecentExports()
openReportPreview(reportType)
closeReportPreview()
renderPreviewDrawer(reportRun)
confirmExport(reportRun)
generateCsvFiles(reportRun)
downloadCsv(filename, csvContent)
refreshRecentExports()
showReportError(message)
```

Use defensive coding.

Avoid global pollution except where existing project patterns require it.

---

## 31. Readiness Score Logic

MVP formula can be simple and transparent.

Example:

```js
let score = 100;

if (totalRecords === 0) return null;

score -= missingReceiptsCount * 4;
score -= billsWithoutDueDateCount * 6;
score -= subscriptionsWithoutRenewalDateCount * 6;

score = Math.max(0, Math.min(100, score));
```

Display:

- `Not enough data` if no records
- `Needs cleanup` if score < 70
- `Ready with warnings` if score 70–89
- `Ready` if score >= 90

Do not imply accounting accuracy. This is data readiness, not financial correctness.

---

## 32. Security Requirements

- Auth guard must redirect unauthenticated users to `/login`.
- All reads must use `currentUser.uid`.
- All paths must be under `users/{userId}/...`.
- Do not allow cross-user reads.
- Do not create global report collections.
- Do not store exported CSV content in Firestore.
- Do not log full financial rows to console.
- Do not show raw Firebase errors to users.
- Confirm before export.
- Audit log before download.
- Disable export button during export.
- Prevent duplicate export submissions.

---

## 33. Firestore Rules

Current user-scoped rule intent is enough for MVP:

```js
match /users/{userId}/{document=**} {
  allow read, write: if request.auth != null
    && request.auth.uid == userId;
}
```

Future stricter rules should make audit logs append-only:

```js
match /users/{userId}/audit_logs/{auditLogId} {
  allow read, create: if request.auth != null
    && request.auth.uid == userId;
  allow update, delete: if false;
}
```

Do not implement broader workspace rules unless workspace migration is approved.

---

## 34. Design System Rules

Follow FluxyOS dashboard design system:

- app background: gray-50 / slate-50
- panels: white
- borders: gray-200
- radius: 18px / rounded-xl
- sidebar width: 220px
- topbar height: 64px
- active sidebar item: orange text only
- orange is accent only
- no orange page backgrounds
- no generic purple neon SaaS look
- no excessive glow/glassmorphism
- use Inter
- use Fira Code for monetary numbers
- use restrained shadows
- table density should be clean and readable

---

## 35. Responsive Requirements

### Desktop

- Sidebar visible.
- Intro uses two columns.
- Main content uses large report panel + right governance column.
- Individual reports shown as table.

### Tablet

- Intro stacks.
- Workspace stacks.
- Right column moves below main panel.
- Table remains horizontally scrollable.

### Mobile

- Sidebar hidden per existing mobile app behavior.
- Topbar actions reduce.
- Filter strip stacks.
- Report detail rows stack.
- Individual report table hides less critical columns if needed.
- Drawer takes full width.
- No horizontal page overflow.

Test widths:

```text
375px
768px
1280px
```

---

## 36. Accessibility Requirements

- Buttons must be real `<button>` elements.
- Drawer close button must have `aria-label`.
- Drawer should close on Escape.
- Drawer overlay click should close.
- Disabled export button must use `disabled`.
- Status should not rely on color alone.
- Tables need proper `thead` and `th`.
- Focus states should remain visible.
- Text contrast must stay readable.

---

## 37. Acceptance Criteria

The feature is complete when:

1. Reports & Exports is a real authenticated app page.
2. Sidebar item is active on the reports route.
3. Page loads only after Firebase Auth confirms the user.
4. Marketing footer does not appear.
5. Page uses the updated revamped layout, not the old card grid.
6. Date range filter defaults to current month.
7. Data coverage uses real scoped records.
8. Readiness panel uses real derived counts.
9. Monthly Report Pack is the dominant recommended output.
10. Individual reports are shown in a table.
11. Preview drawer opens before export.
12. Export requires explicit confirmation.
13. CSV output uses raw numbers.
14. No fake financial numbers appear in production.
15. Export writes an `export.create` audit log before download.
16. Export button is disabled during export.
17. Basic/non-verified state prevents export if verification logic exists.
18. Empty states are handled.
19. Firestore reads/writes stay under `users/{userId}/...`.
20. User A cannot see or export User B data.
21. Console has no errors.
22. Mobile layout has no horizontal overflow.
23. Existing dashboard, ledger, bills, subscriptions, revenue sync, integrations pages still work.

---

## 38. Manual QA Checklist

Run these after implementation.

### App page QA

- Open `/reports` while logged out.
- Confirm redirect to `/login`.
- Log in.
- Open `/reports`.
- Confirm sidebar renders.
- Confirm Reports & Exports is active.
- Confirm footer is absent.
- Confirm topbar renders.

### Data QA

- Add a transaction in current month.
- Confirm transaction count updates.
- Add a bill.
- Confirm bills count updates.
- Add a subscription.
- Confirm subscriptions count updates.
- Add a Missing Receipt transaction.
- Confirm warning count updates.
- Test period with no records.
- Confirm no fake values appear.

### Preview QA

- Click Generate preview.
- Confirm drawer opens.
- Confirm report title matches selected report.
- Confirm included sources match filters.
- Confirm warning section appears when needed.
- Press Escape.
- Confirm drawer closes.

### Export QA

- Click Confirm export.
- Confirm audit log is created.
- Confirm CSV downloads.
- Confirm CSV uses raw amount numbers.
- Confirm success toast appears.
- Confirm duplicate clicking does not create duplicate exports.
- Simulate Firestore permission error if possible.
- Confirm friendly error appears.

### Security QA

- Use User A and User B if available.
- Confirm User A cannot see User B report data.
- Confirm audit logs are user-scoped.
- Confirm no full CSV data is stored in audit log.
- Confirm no sensitive finance payload is printed to console.

### Responsive QA

- Test 375px.
- Test 768px.
- Test 1280px.
- Confirm no horizontal overflow.
- Confirm table scrolls properly.
- Confirm drawer works on mobile.

---

## 39. Implementation Guardrails

Do not change:

- existing Add Transaction modal behavior
- ledger table behavior
- bills page behavior
- subscriptions page behavior
- revenue sync behavior
- auth logic outside what is needed for this page
- global Firestore schema without approval
- existing shared APIs unless backward-compatible
- sidebar structure except enabling Reports & Exports route

Do not add:

- React
- npm dependencies
- build step
- global report collections
- fake sample values in production
- auto-export
- cross-user access
- AI-generated numbers

---

## 40. Suggested Claude Code Prompt

Use this prompt to execute the build.

```text
You are working on the existing FluxyOS project.

Build the Reports & Exports page based on docs/reports_exports_revamped_plan.md.

Before coding, read:
- CLAUDE.md
- docs/PROJECT_BACKGROUND.md
- docs/SYSTEM_DESIGN.md
- docs/SECURITY_SYSTEM.md
- docs/QA_CHECKLIST.md
- docs/product_ux_feature_intake_framework.md
- docs/ROADMAP.md
- docs/fluxyos_multi_agent_workflow_rules.md if it exists

Goal:
Implement an authenticated Reports & Exports app page using the revamped design direction:
Choose period → check readiness → preview report → confirm export → write audit log.

Stack constraints:
- Static HTML
- Tailwind / vanilla CSS
- Vanilla JS
- Firebase Auth
- Firestore
- No React
- No npm
- No build step
- Use FastAPI only if already required, but MVP should use Firestore through db-service.js

Create or update:
- reports.html
- assets/js/reports.js
- assets/js/db-service.js
- assets/js/sidebar-loader.js
- docs/PROJECT_BACKGROUND.md
- docs/ROADMAP.md
- docs/QA_CHECKLIST.md

Functional requirements:
1. Add a real Reports & Exports app route.
2. Enable the sidebar item under Reporting.
3. Use the existing authenticated dashboard shell.
4. Do not load the marketing footer.
5. Use user-scoped Firestore data only under users/{userId}/...
6. Load transactions, bills, subscriptions, and recent export audit logs.
7. Default period to current month.
8. Use the shared FluxyDateRangePicker if available.
9. Show report readiness based on real data.
10. Show data coverage counts.
11. Show needs-cleanup counts.
12. Show Monthly Report Pack as the dominant recommended output.
13. Show individual reports in a table.
14. Open preview drawer before export.
15. Generate CSV output only after user confirms.
16. Write export.create audit log before download.
17. Do not store CSV content in audit logs.
18. Disable export while processing.
19. Handle no-data, loading, error, and permission states.
20. Never show hardcoded fake financial numbers in production.

Security:
- All reads/writes must use currentUser.uid.
- No global financial collections.
- No cross-user access.
- No auto-export.
- No export without confirmation.
- No raw Firebase errors shown to users.
- No sensitive exported row data in console logs.

Design:
- Follow the revamped finance-control layout from this MD.
- Avoid the old equal-card grid.
- Use restrained dashboard styling.
- Orange is accent only.
- No orange backgrounds.
- No generic purple neon SaaS styling.
- Make the main hierarchy clear within 3 seconds.

Acceptance:
- Page works on desktop, tablet, and mobile.
- No console errors.
- Exported CSV has raw amount numbers.
- Audit log appears after confirmed export.
- Existing dashboard, ledger, bills, subscriptions, revenue sync, and integrations pages are not broken.

Final report:
After implementation, summarize:
- files changed
- data methods added
- route added
- QA performed
- manual checks still needed
- any known limitations
```

---

## 41. Final Product Decision

The best version of this page is not a download center.

It is a controlled reporting workflow.

The page should make the user feel:

> “I know what data is included, I know what is missing, and I can safely export this because FluxyOS logged the action.”

That is the product standard for Reports & Exports.
