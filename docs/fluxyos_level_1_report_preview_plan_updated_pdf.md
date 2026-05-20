# FluxyOS Reports & Exports — Level 1 Report Preview Implementation Plan

## 0. Purpose

Implement **Level 1 report access** for FluxyOS.

Level 1 means:

- Users can generate a report preview from the existing `reports.html` page.
- Users can open a full report viewer page.
- The report visual style must follow the attached `preview (4).html`.
- The report numbers, insights, warnings, and limitations must come from actual authenticated user data.
- Users can print/save the report as PDF using the browser print flow from `report-preview.html`.
- The report preview can be downloaded as PDF through a `Print / Save PDF` button.
- Level 1 uses browser-native PDF save behavior via `window.print()`, not backend PDF generation.
- Users can download CSV source files from the same report model.
- Confirmed exports create metadata in Recent Exports and an audit log.
- No persistent PDF file storage yet.
- No guaranteed detection that the PDF file was actually saved.
- No backend/PPTX generation yet.

This is a **report access and preview workflow**, not a redesign of the whole Reports & Exports page.

---

## 1. Files to Read First

Read these files before changing code:

```text
reports.html
assets/js/reports.js
assets/js/db-service.js
assets/js/date-range-picker.js
assets/js/shared-dashboard.js
assets/css/shared-dashboard.css
SECURITY_SYSTEM.md
SYSTEM_DESIGN.md
QA_CHECKLIST.md
product_ux_feature_intake_framework.md
preview (4).html
```

The attached `preview (4).html` is the visual benchmark for the full report output. Use its visual structure and information architecture as the target report viewer style:

- Dark/navy report cover
- Orange glow/accent
- Light gray report canvas
- White report cards
- Large section headings
- Mono font for financial values
- Bar charts and tables
- Finance Predictability Snapshot
- Report Confidence Method
- Data Quality & Cleanup
- Export Manifest
- Print/PDF-ready CSS

Do not copy sample numbers as production data. Use the visual and content structure only.

---

## 2. Current Context

The existing `reports.html` already has the right control-surface structure:

- Header with Generate Report CTA
- Intro / workflow explanation
- Report readiness panel
- Date range and report filters
- Empty state
- Recommended Monthly Report Pack card
- Individual reports table
- Data coverage panel
- Needs cleanup panel
- Recent exports panel
- Preview drawer before export

The missing part is the **user-accessible full report output**.

Currently, the preview drawer shows financial summary, included sources, generated files, and warnings. That is good for confirmation, but not enough for a user to read the full report before export.

---

## 3. Main Objective

Help users generate, inspect, print/save, and export a full Monthly Report Pack from actual FluxyOS user data, while preserving the existing Reports & Exports control flow and preventing false confidence.

---

## 4. Job To Be Done

When I need to review or share my business performance for a selected period,  
I want FluxyOS to generate a complete source-backed report preview from my real records,  
so I can inspect the numbers, understand the limitations, and export only after confirmation.

---

## 5. Product Decision

### Keep `reports.html` as the control center

`reports.html` should answer:

```text
Is this report ready to generate and export?
```

It should not display the full long report directly.

### Add a dedicated report viewer page

Create:

```text
report-preview.html
```

This page answers:

```text
Is this report good enough to read, print, save as PDF, or share?
```

The full visual report should live here.

### Use Level 1 access model

```text
Reports & Exports
→ Generate Preview
→ Preview Drawer
→ Open Full Report
→ report-preview.html
→ Print / Save PDF
→ Download CSV Bundle
→ Confirm Export
→ Recent Exports + Audit Log
```

---

## 6. Scope

### In Scope

1. Add `report-preview.html`.
2. Reuse visual layout from `preview (4).html`.
3. Build report data from actual user-scoped Firestore records.
4. Add `Open Full Report` CTA inside the preview drawer.
5. Use `sessionStorage` for Level 1 preview state handoff.
6. Generate CSV files client-side from the same report model.
7. Use browser `window.print()` for PDF save.
8. Add report sections:
   - Cover / Report Identity
   - Executive Summary
   - Key Takeaways
   - Profit & Loss Summary
   - Period Comparison
   - Finance Predictability Snapshot
   - Expense Breakdown
   - Bills & Subscription Commitments
   - Report Confidence Method
   - Data Quality & Cleanup
   - Export Manifest
9. Add section availability and limitations to the preview drawer.
10. Add report export metadata to Recent Exports after confirmation.
11. Write audit log metadata under `users/{userId}/audit_logs/{auditLogId}` when export is confirmed.
12. Keep all data under authenticated `users/{userId}/...` scope.

### Out of Scope

1. Backend PDF generation.
2. Storing generated PDF files in Firebase Storage.
3. PPTX/deck export.
4. Sending reports by email.
5. Public share links.
6. Workspace migration.
7. Role-based report sharing.
8. Bank reconciliation.
9. Real cash runway if no bank balance exists.
10. AI-generated numbers.
11. OpenAI direct Firestore querying.
12. Rebuilding the Reports page from scratch.

---

## 7. Required User Flow

### 7.1 Reports page load

On page load:

1. Require Firebase Auth.
2. Resolve `userId`.
3. Load selected-period data through existing data service only.
4. Compute report readiness.
5. Render:
   - Readiness score
   - Data coverage
   - Cleanup warnings
   - Monthly Report Pack state
   - Recent exports if available

### 7.2 User selects period

When date range changes:

1. Refresh report model using selected period.
2. Refresh readiness.
3. Refresh coverage.
4. Refresh cleanup counts.
5. Refresh preview availability.
6. Do not export automatically.

### 7.3 User clicks Generate Preview

Open preview drawer.

Drawer must show:

- Selected period
- Report package name
- Available formats: PDF Summary + CSV Bundle
- Financial summary
- Included sources
- Generated CSV files
- Data warnings
- Report sections availability
- Finance Predictability availability
- Export limitations

Add these drawer actions:

```text
Cancel
Open Full Report
Confirm Export
```

### 7.4 User clicks Open Full Report

On click:

1. Build `monthlyReportPack` object from actual user data.
2. Save it to `sessionStorage`:

```js
sessionStorage.setItem("fluxyos_report_preview", JSON.stringify(monthlyReportPack));
```

3. Navigate to:

```js
window.location.href = "report-preview.html";
```

or open in a new tab if preferred:

```js
window.open("report-preview.html", "_blank", "noopener");
```

Recommended for Level 1: same tab, with a Back to Reports button.

### 7.5 User opens report-preview.html

`report-preview.html` must:

1. Require Firebase Auth.
2. Read `sessionStorage.getItem("fluxyos_report_preview")`.
3. If missing, show safe empty state:
   - “No report preview found”
   - Button: “Back to Reports”
4. Render the full report using the `preview (4).html` visual language.
5. Use actual report model values, not sample values.
6. Provide actions:
   - Back to Reports
   - Print / Save PDF
   - Download CSV Bundle
   - Confirm Export

### 7.6 User prints/saves PDF

Use:

```js
window.print();
```

This opens browser print/save PDF.

Important audit note:

- Browser print cannot guarantee the user actually saved the PDF.
- For Level 1, do not claim `downloaded: true`.
- Track print action only as `print_dialog_opened` if needed.

### 7.7 User confirms export

On confirmation:

1. Create export metadata record.
2. Create audit log record.
3. Update Recent Exports UI.
4. Show success toast.
5. Do not store full financial rows in audit log.

---

## 8. Level 1 PDF Download / Save Behavior

### 8.1 Product decision

For Level 1, the full report can be downloaded as a PDF through the browser print/save flow.

The user-facing CTA should be:

```text
Print / Save PDF
```

Do not label this as a guaranteed direct file download because the browser controls the final save destination and the app cannot reliably verify whether the user saved or cancelled.

### 8.2 Correct entry point

The PDF action must live on the full report viewer:

```text
reports.html
→ Generate Preview
→ Preview Drawer
→ Open Full Report
→ report-preview.html
→ Print / Save PDF
```

Do not make the drawer itself generate the PDF. The drawer is a checkpoint. The full report page is the readable/exportable artifact.

### 8.3 Required toolbar on report-preview.html

Add a sticky toolbar:

```text
Back to Reports
Print / Save PDF
Download CSV Bundle
Confirm Export
```

Button behavior:

```js
document.getElementById("print-report-btn").addEventListener("click", () => {
  window.print();
});
```

### 8.4 Print CSS requirements

`report-preview.html` must include print-specific CSS.

Required:

```css
html {
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

@media print {
  .toolbar,
  .sample-note,
  .screen-only {
    display: none !important;
  }

  body {
    background: var(--page);
  }

  .report {
    margin: 0;
    width: 100%;
    max-width: none;
    border: 0;
    border-radius: 0;
    box-shadow: none;
  }

  .section,
  .cover,
  .card,
  table,
  .metric-card,
  .takeaway {
    break-inside: avoid;
  }

  @page {
    size: A4;
    margin: 0;
  }
}
```

If the visual needs to preserve the long-page report format from `preview (4).html`, use a custom long page size only for the benchmark or internal export route. For production, prefer A4-friendly sections unless the product intentionally chooses a long-page PDF report.

### 8.5 PDF audit behavior

Browser print/save PDF has an important limitation:

- `window.print()` opens the print dialog.
- The app cannot reliably know if the user saved the PDF, printed it, or cancelled.
- `afterprint` can fire after printing starts or after preview closes, so it must not be treated as proof of file download.

If logging the print action, use this metadata:

```js
{
  action: "export.print_dialog_opened",
  report_type: "monthly_report_pack",
  format: "pdf_print",
  status: "print_dialog_opened",
  period_start: "...",
  period_end: "...",
  created_at: serverTimestamp()
}
```

Do not log:

```js
{
  downloaded: true
}
```

unless the product later implements backend-generated PDF downloads or stored files.

### 8.6 Confirm Export vs Print / Save PDF

Keep these actions separate:

```text
Print / Save PDF
```

Means:
- Opens browser print dialog.
- Lets user save PDF manually.
- Does not prove file was saved.

```text
Confirm Export
```

Means:
- User confirms the report package as generated/exported.
- Writes `report_exports` metadata.
- Writes `audit_logs` metadata.
- Updates Recent Exports.

The user can print before confirming, but the product should encourage confirmation after reviewing the report.

### 8.7 Future Level 2 direct PDF download

Future production flow:

```text
POST /api/v1/reports/monthly/pdf
→ verify Firebase token
→ query users/{userId}/...
→ calculate report model
→ render HTML template
→ generate PDF server-side
→ return file response
→ write report_exports metadata
→ write audit_logs metadata
```

Level 2 can use FastAPI plus a PDF renderer. Do not implement this in Level 1.

---

## 9. Data Model

### 8.1 Main report preview model

Use a single normalized object shared by:

- Reports page readiness
- Preview drawer
- Full report viewer
- CSV exports
- Export metadata
- Audit log metadata

```js
const monthlyReportPack = {
  report_identity: {
    report_type: "monthly_report_pack",
    report_title: "Monthly Financial Report",
    business_name: "",
    period_start: "",
    period_end: "",
    generated_by_uid: "",
    generated_by_name: "",
    generated_at: "",
    status: "draft_management_report",
    disclaimer: "Management report generated from FluxyOS operational records. Not audited financial statements."
  },

  executive_summary: {
    revenue: 0,
    opex: 0,
    net_result: 0,
    gross_margin: 0,
    report_confidence: 0,
    summary_text: ""
  },

  key_takeaways: [],

  profit_loss: {
    rows: [],
    chart: [],
    calculation_note: "",
    interpretation: ""
  },

  period_comparison: {
    status: "available | partial | unavailable",
    previous_period: {},
    current_period: {},
    rows: [],
    limitations: []
  },

  finance_predictability: {
    status: "available | partial | unavailable",
    monthly_revenue_run_rate: 0,
    annualized_revenue_run_rate: 0,
    arr: {
      status: "available | partial | unavailable",
      value: 0,
      basis: "recurring_revenue_only",
      limitation: ""
    },
    year_end_revenue_outlook: {
      conservative: 0,
      current_run_rate: 0,
      growth_case: 0
    },
    year_end_net_result_outlook: {
      low: 0,
      high: 0
    },
    assumptions: [],
    limitations: []
  },

  expense_breakdown: {
    categories: [],
    top_vendors: [],
    interpretation: "",
    csv_columns: []
  },

  bills_subscriptions: {
    upcoming_bills_count: 0,
    overdue_bills_count: 0,
    active_subscriptions_count: 0,
    pending_payable_total: 0,
    obligation_windows: [],
    interpretation: "",
    csv_columns: []
  },

  report_confidence_method: {
    score: 0,
    label: "",
    explanation: "",
    breakdown: [],
    formula_note: "Confidence score is a product-readiness indicator. It is not an accounting assurance opinion."
  },

  data_quality: {
    warnings: [],
    recommended_cleanup: ""
  },

  export_manifest: {
    included_sources: [],
    excluded_or_limited: [],
    source_files: [],
    audit: {
      action: "export.create",
      audit_ref: "",
      generated_by: "",
      generated_at: ""
    }
  }
};
```

---

## 10. Firestore Data Sources

All data must be read under authenticated user scope only:

```text
users/{userId}/transactions
users/{userId}/bills
users/{userId}/subscriptions
users/{userId}/audit_logs
users/{userId}/report_exports
```

Do not read from global collections.

Do not create cross-user report records.

Do not store user financial report data outside `users/{userId}/...`.

---

## 11. Calculation Rules

### 11.1 Revenue

Include transaction records that represent income/revenue.

Suggested accepted transaction types:

```text
income
revenue
pending_receivable
```

Use actual project field names from existing `reports.js` / `db-service.js`.

Do not count refunds as revenue-positive unless the project already treats refunds that way.

### 11.2 OpEx

Include:

```text
expense
fee
tax
pending_payable
```

Use project field names.

### 11.3 Net Result

```js
netResult = revenue - opex;
```

### 11.4 Gross Margin

```js
grossMargin = revenue > 0 ? ((revenue - opex) / revenue) * 100 : 0;
```

Never show:

```text
NaN
Infinity
-Infinity
```

### 11.5 Period Comparison

Compare selected period to previous equivalent period.

Example:

- Selected period: May 1–31
- Previous period: Apr 1–30

Metrics:

- Revenue
- OpEx
- Net Result
- Gross Margin

If previous-period data is missing:

- Status: `unavailable`
- Show limitation: “Previous period records not found”
- Do not invent comparison.

### 11.6 Finance Predictability

This is forward-looking and must be treated carefully.

#### Monthly revenue run rate

```js
monthlyRevenueRunRate = currentPeriodRevenue;
```

#### Annualized revenue run rate

```js
annualizedRevenueRunRate = currentPeriodRevenue * 12;
```

Label as:

```text
Simple run-rate projection, not a committed forecast.
```

#### ARR

ARR must only use recurring revenue.

Allowed only when recurring revenue classification exists.

Possible sources:

- recurring revenue transactions
- revenue sync records marked recurring
- customer contracts if future data exists

Do not calculate ARR from all revenue.

If recurring revenue does not exist:

```js
arr.status = "unavailable";
arr.value = null;
arr.limitation = "No recurring revenue source detected.";
```

If partial recurring classification exists:

```js
arr.status = "partial";
arr.limitation = "Recurring revenue classification is incomplete.";
```

#### Year-end revenue outlook

Use scenarios:

```js
conservative = averageMonthlyRevenueSoFar * 12;
currentRunRate = currentPeriodRevenue * 12;
growthCase = currentRunRate * 1.04; // only if explicitly defined as a product assumption
```

For Level 1, use clear assumption labels. Do not make it sound guaranteed.

#### Year-end net result outlook

Use:

```js
projectedRevenue - projectedOpEx
```

Where projected OpEx uses current/average OpEx pattern.

Label as:

```text
Scenario estimate using current revenue and OpEx pattern.
```

### 11.7 Cash Pressure

Use bills/subscriptions only.

Do not call this:

```text
runway
cash runway
bank balance
can cover bills
```

unless real bank balance exists.

Use:

```text
cash pressure proxy
pending payable pressure
```

### 11.8 Report Confidence

Report Confidence is not financial performance.

Calculate from data readiness inputs:

- receipt coverage
- due-date completeness
- subscription renewal completeness
- connected source coverage
- audit/export readiness

Suggested rough Level 1 formula:

```js
score = weightedAverage([
  receiptCoverage * 0.30,
  dueDateCompleteness * 0.20,
  renewalDateCompleteness * 0.15,
  ledgerCompleteness * 0.20,
  sourceCoverage * 0.15
]);
```

Keep the formula explainable.

If any value is missing, show partial state and safe fallback.

---

## 12. UI Changes in reports.html

### 12.1 Keep existing layout

Do not redesign the full page.

Preserve:

- Sidebar
- Header
- Intro/control surface
- Date range picker
- Monthly Report Pack card
- Individual reports table
- Data coverage panel
- Needs cleanup panel
- Recent exports panel
- Preview drawer

### 12.2 Update Monthly Report Pack card

Update copy to show the report now includes:

```text
Executive Summary
Profit & Loss
Period Comparison
Finance Predictability
Expense Breakdown
Bills & Subscriptions
Report Confidence
Data Quality
Export Manifest
```

Update export formats:

```text
PDF Summary + CSV Bundle
```

Instead of presenting it as only CSV.

### 12.3 Add Predictability readiness

In the readiness panel, add a fourth bar:

```text
Predictability readiness
```

It should reflect:

- current period revenue exists
- previous period records exist
- recurring revenue classification exists
- OpEx pattern exists

### 12.4 Expand Data coverage panel

Add coverage tiles or rows:

```text
Previous period
Recurring revenue
Predictability
Bank balance
```

Example states:

```text
Previous period: Available
Recurring revenue: Partial
Predictability: Partial
Bank balance: Not connected
```

### 12.5 Upgrade preview drawer

Add sections:

1. Financial summary
2. Included sources
3. Report sections
4. Finance Predictability
5. Generated files
6. Warnings / limitations
7. Export confirmation

Add CTA:

```text
Open Full Report
```

Final drawer CTA layout:

```text
Cancel
Open Full Report
Confirm Export & Log Action
```

On mobile, stack buttons.

### 12.6 Recent exports

Change copy from:

```text
Preview of what later belongs in Audit Log.
```

To:

```text
Reports you generated or confirmed.
```

Rows should show:

```text
Monthly Report Pack
May 2026 · PDF + CSV · 9 warnings
Generated 20 May 2026
View details
```

If no saved files exist, do not show “Download again.”

---

## 13. New Page: report-preview.html

### 13.1 Purpose

A full-page report viewer using the visual benchmark from `preview (4).html`.

### 13.2 Required layout

Use the visual style from attached preview:

1. Sticky toolbar
   - Back to Reports
   - Print / Save PDF
   - Download CSV Bundle
   - Confirm Export

2. Dark cover
   - FluxyOS brand
   - Monthly Report Pack
   - Report title
   - Business name
   - Period
   - Generated by
   - Export package
   - Draft status
   - Disclaimer

3. Executive Summary

4. Key Takeaways

5. Profit & Loss Summary

6. Period Comparison

7. Finance Predictability Snapshot

8. Expense Breakdown

9. Bills & Subscription Commitments

10. Report Confidence Method

11. Data Quality & Cleanup

12. Export Manifest

### 13.3 Required behavior

On load:

```js
const raw = sessionStorage.getItem("fluxyos_report_preview");
```

If missing:

- Show empty state.
- Button: Back to Reports.
- Do not render fake data.

If present:

- Parse JSON.
- Validate basic schema.
- Render report.
- Format all amounts as Indonesian Rupiah.
- Format dates.
- Replace missing values with safe labels:
  - `Unavailable`
  - `Partial`
  - `No data`
  - `Not connected`

---

## 14. CSV Export Requirements

CSV files should be generated from the same `monthlyReportPack` model.

Level 1 CSV bundle can be implemented as multiple direct downloads, or one ZIP later.

For now, allow separate CSV downloads if zip support does not exist.

Required CSV outputs:

```text
profit_loss_{period}.csv
expense_breakdown_{period}.csv
bills_payables_{period}.csv
subscriptions_{period}.csv
ledger_export_{period}.csv
data_quality_{period}.csv
```

### CSV rules

- Amount must be raw number, not formatted string.
- Include source collection.
- Include record ID when row-level data exists.
- Include status.
- Include period.
- Escape commas and quotes properly.
- Use UTF-8.
- Do not include fake rows.

---

## 15. Audit and Export Metadata

### 15.1 Create report export metadata

On confirmed export, write:

```text
users/{userId}/report_exports/{exportId}
```

Fields:

```js
{
  report_type: "monthly_report_pack",
  period_start: "...",
  period_end: "...",
  formats: ["pdf_print", "csv_bundle"],
  status: "generated",
  included_sections: [
    "executive_summary",
    "profit_loss",
    "period_comparison",
    "finance_predictability",
    "expense_breakdown",
    "bills_subscriptions",
    "report_confidence",
    "data_quality",
    "export_manifest"
  ],
  record_counts: {
    transactions: 0,
    bills: 0,
    subscriptions: 0
  },
  warning_counts: {
    missing_receipts: 0,
    bills_without_due_date: 0,
    subscriptions_without_renewal: 0
  },
  limitations: [],
  created_at: serverTimestamp(),
  created_by: userId
}
```

### 15.2 Create audit log

Write:

```text
users/{userId}/audit_logs/{auditLogId}
```

Fields:

```js
{
  actor_uid: userId,
  actor_role: null,
  action: "export.create",
  target_collection: "report_exports",
  target_id: exportId,
  before: null,
  after: {
    report_type: "monthly_report_pack",
    period_start: "...",
    period_end: "...",
    formats: ["pdf_print", "csv_bundle"],
    record_counts: {
      transactions: 0,
      bills: 0,
      subscriptions: 0
    },
    included_sections: [...]
  },
  reason: null,
  source: "dashboard",
  created_at: serverTimestamp()
}
```

Do not store full report rows in audit log.

---

## 16. Security Rules

Required:

- Only authenticated user can read/write their own report exports.
- No cross-user access.
- Audit logs are append-only.
- Export action requires explicit user confirmation.

Firestore paths:

```text
users/{userId}/report_exports/{exportId}
users/{userId}/audit_logs/{auditLogId}
```

Rules intent:

```text
allow read: if request.auth.uid == userId
allow create: if request.auth.uid == userId
deny update/delete for audit logs
```

---

## 17. Empty, Partial, and Error States

### No finance records

Show:

```text
No report data yet.
Reports are generated from real FluxyOS records. Add transactions, bills, or subscriptions first.
```

Disable:

- Open Full Report
- Confirm Export
- Download CSV

### Partial data

Allow preview, but show limitations:

- Revenue Sync not connected
- Previous period unavailable
- ARR unavailable
- Missing receipts
- Missing due dates
- Missing renewal dates
- Bank balance not connected

### Permission error

Show friendly toast/banner:

```text
We couldn’t load your report data. Please check your account access and try again.
```

Never show raw Firebase error details.

### Missing sessionStorage preview

On `report-preview.html`:

```text
No report preview found.
Go back to Reports & Exports and generate a preview first.
```

---

## 18. Implementation Steps

### Step 1 — Add shared report builder

In `assets/js/reports.js` or a new module:

```text
assets/js/report-builder.js
```

Recommended to create `report-builder.js` for clarity.

Functions:

```js
buildMonthlyReportPack({ userId, periodStart, periodEnd, transactions, bills, subscriptions, settings })
calculateProfitLoss(records)
calculatePeriodComparison(currentRecords, previousRecords)
calculateFinancePredictability(reportData)
calculateExpenseBreakdown(transactions, subscriptions)
calculateBillsSubscriptions(bills, subscriptions)
calculateReportConfidence(reportData)
calculateDataQuality(transactions, bills, subscriptions)
buildExportManifest(reportData)
```

### Step 2 — Connect reports.html to report builder

Update `reports.js`:

- Load data through existing DataService.
- Build `monthlyReportPack`.
- Render readiness and coverage from the report model.
- Use report model for drawer preview.
- Do not duplicate calculation logic in multiple places.

### Step 3 — Upgrade drawer

Add:

- Section availability table
- Finance Predictability summary
- Open Full Report button
- Updated generated files list
- Limitations list

### Step 4 — Add report-preview.html

Create page from visual benchmark.

Use:

```html
<link rel="stylesheet" href="assets/css/shared-dashboard.css">
<script src="assets/js/shared-dashboard.js"></script>
```

But keep report-specific styles scoped inside the page or a dedicated CSS file:

```text
assets/css/report-preview.css
```

### Step 5 — Add report-preview.js

Create:

```text
assets/js/report-preview.js
```

Responsibilities:

- Auth guard
- Read sessionStorage report model
- Render report
- Handle Back to Reports
- Handle Print / Save PDF
- Handle CSV download
- Handle Confirm Export
- Show empty state if no report model exists

### Step 6 — Add CSV utilities

Create or reuse:

```text
assets/js/report-export-utils.js
```

Functions:

```js
toCsv(rows, columns)
downloadCsv(filename, csvString)
downloadReportCsvBundle(monthlyReportPack)
```

If no ZIP library exists, download files individually for Level 1.

Do not add npm or build tooling.

### Step 7 — Add report export metadata + audit log writes

Use existing Firebase/Firestore patterns.

Create export metadata only after explicit confirm.

### Step 8 — Update Recent Exports

Read from:

```text
users/{userId}/report_exports
```

Sort newest first.

Render:

- Report type
- Period
- Formats
- Warning count
- Created date
- View details

For Level 1, View Details can open a lightweight drawer using saved metadata. Do not promise file download unless files are actually stored.

---

## 19. Visual Requirements

### report-preview.html must follow `preview (4).html`

Use:

- Dark/navy gradient cover
- Orange glow
- White cards
- Light gray page background
- Large headings
- Bar charts and tables
- Mono font for financial values
- Dark final manifest section
- Print/PDF-ready CSS

Do not:

- Make it look like the Overview page.
- Use dashboard KPI card layout as the main visual structure.
- Add random decorative circles to metric cards.
- Add donut charts unless truly useful.
- Use fake sample data in production render.
- Add external chart libraries.

---

## 20. Print / PDF Requirements

Use the Level 1 PDF behavior defined in Section 8.

Required:

- `Print / Save PDF` CTA on `report-preview.html`.
- Use `window.print()` for browser-native print/save PDF.
- Hide toolbar and screen-only controls in print.
- Preserve colors with `print-color-adjust`.
- Avoid breaking cards, cover, tables, metric cards, and takeaway cards across printed pages.
- Do not claim the PDF was downloaded unless backend PDF generation is implemented later.
- Do not create PDF automatically from the drawer.

Implementation:

```js
function handlePrintReport() {
  window.print();
}
```

Optional print lifecycle events may be used for UI cleanup only. Do not use `afterprint` as proof that a PDF file was saved.

---

## 21. Acceptance Criteria

The implementation is complete when:

1. `reports.html` still loads with sidebar, date picker, readiness, filters, recommended output, individual reports, coverage, cleanup, and recent exports.
2. User can select a report period.
3. User can click Generate Preview.
4. Preview drawer shows real selected-period data.
5. Preview drawer includes report section availability.
6. Preview drawer includes Finance Predictability availability and limitations.
7. User can click Open Full Report.
8. `report-preview.html` opens and renders the full visual report.
9. Report visual follows attached `preview (4).html`.
10. Report values come from actual authenticated user records.
11. No sample numbers appear in production render.
12. If no data exists, report viewer shows a no-preview/no-data state.
13. User can click `Print / Save PDF` from report viewer.
14. Browser print dialog opens from `window.print()`.
15. Print CSS hides toolbar and preserves the report visual.
16. User can download CSV source files.
17. User can confirm export only after preview.
18. Confirmed export creates a `report_exports` metadata record.
19. Confirmed export creates an `audit_logs` record.
20. Recent Exports updates after confirmation.
21. No cross-user data access is possible.
22. Empty, partial, and error states are handled.
23. Mobile layout works.
24. Existing Add Transaction, Add Bill, Subscriptions, sidebar, Fluxy AI drawer, and date picker behavior are not broken.
---

## 22. Manual QA Checklist

### Reports page

- Open `reports.html` while logged out.
- Confirm redirect to login.
- Log in.
- Open Reports & Exports.
- Confirm sidebar active state still works.
- Confirm date picker renders.
- Confirm readiness loads.
- Confirm no-data state works.
- Change reporting period.
- Confirm numbers update.
- Click Generate Preview.
- Confirm drawer opens.
- Confirm drawer data matches selected period.
- Confirm warnings appear before export.
- Confirm Open Full Report button exists.
- Confirm Confirm Export is disabled if no data or permission missing.

### Report viewer

- Open Full Report from drawer.
- Confirm report viewer loads from sessionStorage.
- Confirm Back to Reports works.
- Confirm all report sections render.
- Confirm no sample numbers are hardcoded.
- Confirm Finance Predictability shows available/partial/unavailable correctly.
- Confirm ARR is unavailable when recurring revenue is missing.
- Confirm cash pressure is not called runway.
- Confirm disclaimer is visible.
- Confirm `Print / Save PDF` button opens the browser print dialog.
- Confirm toolbar is hidden in print preview.
- Confirm report colors, cover, tables, and card structure are preserved.
- Confirm the app does not claim the PDF was successfully downloaded after print dialog closes.
- Confirm mobile layout works.

### CSV

- Download P&L CSV.
- Download expense CSV.
- Download bills/payables CSV.
- Download ledger CSV.
- Confirm amounts are raw numbers.
- Confirm record IDs exist where row-level data exists.
- Confirm empty data does not generate fake rows.

### Audit

- Confirm export metadata is created only after explicit confirmation.
- Confirm audit log is created only after explicit confirmation.
- Confirm audit log stores metadata, not full exported rows.
- Confirm audit logs cannot be edited/deleted from dashboard.

### Regression

- Add Transaction still works.
- Add Bill still works.
- Subscription table still works.
- Ledger CSV export still works.
- Sidebar loads.
- Fluxy AI drawer still opens.
- No console errors.

---

## 23. Final Report for Agent

After implementation, provide:

```text
Files changed:
- ...

What was implemented:
- ...

How report preview works:
- ...

How real user data is used:
- ...

How export confirmation and audit logging works:
- ...

What is still Level 2 / future:
- Backend PDF generation
- Stored PDF files
- ZIP CSV bundle
- PPTX deck export
- Role-based report sharing

Manual QA completed:
- ...

Known limitations:
- ...
```
