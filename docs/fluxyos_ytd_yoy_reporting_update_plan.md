# FluxyOS Reports & Exports — YTD and YoY Reporting Update Plan

## 1. Goal

Extend the existing Level 1 Reports & Exports flow so users can generate:

- Year-to-date reports from the beginning of year to today.
- Year-on-year reports comparing the selected period with the same period last year.
- YTD YoY reports comparing this year's YTD against the same YTD range last year.

This update must fit inside the existing Reports & Exports page, not become a separate sidebar module.

Correct flow:

```text
Reports & Exports
→ Report period mode
→ Compare with mode
→ Generate Preview
→ Preview Drawer
→ Open Full Report
→ Print / Save PDF / CSV
```

## 2. Entry Point

The ideal entry point is the existing Reports & Exports filter strip.

Add these controls before `Generate preview`:

```text
[Report period ▼] [Compare with ▼] [Report package ▼] [Output ▼] [Generate preview]
```

### Report period options

```text
This month
Last month
Quarter to date
Year to date
Custom range
```

### Compare with options

```text
None
Previous period
Same period last year
Previous year to date
```

Use `Previous year to date` when `Report period = Year to date`.

Example:

```text
Current period:
1 Jan 2026 – 21 May 2026

Comparison period:
1 Jan 2025 – 21 May 2025
```

## 3. Product Rules

Do not make YTD and YoY separate random buttons.

Do not hide YTD/YoY inside the exported report only.

Do not make a new sidebar page.

The user must choose report scope before preview generation.

YTD and YoY are report scope settings, not separate products.

## 4. Dynamic Report Titles

When the user selects `Year to date` with no comparison:

```text
2026 Year-to-Date Financial Report
```

When the user selects `Year to date` and `Previous year to date`:

```text
2026 YTD Year-on-Year Financial Report
```

When the user selects `Custom range` and `Same period last year`:

```text
Custom Year-on-Year Financial Report
```

## 5. Updated Report Model

Add this object to the shared report model:

```js
report_scope: {
  mode: "monthly | quarter_to_date | year_to_date | custom",
  comparison_mode: "none | previous_period | same_period_last_year | previous_year_to_date",

  current_period: {
    start_date: "2026-01-01",
    end_date: "2026-05-21",
    label: "2026 YTD"
  },

  comparison_period: {
    start_date: "2025-01-01",
    end_date: "2025-05-21",
    label: "2025 YTD"
  },

  generated_title: "2026 YTD Year-on-Year Financial Report",
  fiscal_year_basis: "calendar_year | user_fiscal_year"
}
```

This report scope must feed:

- Reports page card labels
- Preview drawer
- Full report viewer
- CSV filenames
- `report_exports` metadata
- `audit_logs` metadata

## 6. Date Resolution Logic

Create or update:

```js
resolveReportScope({
  reportPeriodMode,
  comparisonMode,
  selectedStartDate,
  selectedEndDate,
  today,
  fiscalYearStart
})
```

### Year to date

For Level 1:

```js
current.start_date = `${currentYear}-01-01`;
current.end_date = selectedEndDate || today;
```

If fiscal-year settings exist later:

```js
current.start_date = userSettings.fiscal_year_start;
```

### Previous year to date

```js
comparison.start_date = `${currentYear - 1}-01-01`;
comparison.end_date = sameMonthAndDayLastYear(current.end_date);
```

### Same period last year

```js
comparison.start_date = subtractOneYear(current.start_date);
comparison.end_date = subtractOneYear(current.end_date);
```

### Previous period

Use same length as selected period, immediately before the current period.

### Leap year

If current end date is Feb 29 and previous year has no Feb 29, use Feb 28.

## 7. YTD Report Sections

When `Report period = Year to date` and `Compare with = None`, render:

```text
Cover / Report Identity
Executive Summary
YTD Key Takeaways
Year-to-Date Profit & Loss
Monthly Trend Breakdown
Finance Predictability Snapshot
Expense Breakdown
Bills & Subscription Commitments
Report Confidence Method
Data Quality & Cleanup
Export Manifest
```

### YTD Executive Summary

Must answer:

```text
Are we on track this year?
```

Example copy pattern:

```text
2026 YTD generated Rp X revenue, Rp Y OpEx, and Rp Z net result from Jan 1 to today. The strongest month was [Month], while [Category] was the largest cost driver.
```

### YTD required metrics

```text
YTD Revenue
YTD OpEx
YTD Net Result
YTD Gross Margin
Average Monthly Revenue
Average Monthly OpEx
Best Revenue Month
Worst Net Result Month
```

### Monthly Trend Breakdown

Required fields:

```text
Month
Revenue
OpEx
Net Result
Gross Margin
Record Count
Warnings
```

Use simple CSS bars or table-first layout. Do not add chart libraries.

## 8. YoY Report Sections

When `Report period = Year to date` and `Compare with = Previous year to date`, render:

```text
Cover / Report Identity
Executive Summary
YoY Key Takeaways
YTD Profit & Loss Comparison
Monthly Trend Comparison
Finance Predictability Snapshot
Expense Breakdown
Bills & Subscription Commitments
Report Confidence Method
Data Quality & Cleanup
Export Manifest
```

### YoY Executive Summary

Must answer:

```text
Are we better or worse than the same period last year?
```

Example copy pattern:

```text
Revenue increased/decreased by X% compared with the same period last year. OpEx changed by Y%, while net result changed by Z%. Margin expanded/compressed by N percentage points.
```

### YoY comparison table

Required columns:

```text
Metric
Current YTD
Previous YTD
Change
Change %
Interpretation
```

Required rows:

```text
Revenue
OpEx
Net Result
Gross Margin
Average Monthly Revenue
Average Monthly OpEx
```

For gross margin change, use percentage points:

```text
+2.8 pts
```

Do not write `+2.8%` unless it is actually percent change.

## 9. Calculation Rules

### Absolute change

```js
change = currentValue - previousValue;
```

### Percent change

```js
if (previousValue !== 0) {
  percentChange = ((currentValue - previousValue) / Math.abs(previousValue)) * 100;
} else {
  percentChange = null;
}
```

If previous value is zero, show:

```text
N/A
```

Never show:

```text
Infinity
NaN
-Infinity
```

### Gross margin point change

```js
marginPointChange = currentGrossMargin - previousGrossMargin;
```

Render as:

```text
+2.8 pts
```

### Average monthly values

```js
averageMonthlyRevenue = ytdRevenue / elapsedMonths;
averageMonthlyOpEx = ytdOpEx / elapsedMonths;
```

If current month is partial, label:

```text
Includes partial current month.
```

## 10. UI Updates in reports.html

### Filter strip

Update to:

```text
Report period
Compare with
Report package
Output
Generate preview
```

### Date picker behavior

If `Report period = Custom range`, enable the date picker normally.

If `Report period = Year to date`, show the resolved range:

```text
1 Jan 2026 – Today
```

If user changes the end date manually, keep start date at Jan 1.

### Monthly Report Pack card

Rename dynamically:

```text
Monthly Financial Report
Year-to-Date Financial Report
YTD Year-on-Year Financial Report
```

### Preview drawer

Drawer must show:

```text
Current period
Comparison period
Comparison mode
Section availability
Limitations
Generated CSV files
```

For YTD YoY:

```text
Preview: YTD Year-on-Year Financial Report

Current period:
1 Jan 2026 – 21 May 2026

Comparison period:
1 Jan 2025 – 21 May 2025
```

### Readiness panel

Add:

```text
Comparison readiness
```

Status values:

```text
Available
Partial
Unavailable
```

Based on previous period records, historical data completeness, and category consistency.

### Data coverage panel

Add:

```text
Current period records
Comparison period records
Previous-year categories
Recurring revenue
Bank balance
```

## 11. report-preview.html Updates

The cover must adapt.

### YTD cover

```text
2026 Year-to-Date Financial Report
Period: 1 Jan 2026 – 21 May 2026
```

### YTD YoY cover

```text
2026 YTD Year-on-Year Financial Report
Current: 1 Jan 2026 – 21 May 2026
Comparison: 1 Jan 2025 – 21 May 2025
```

Render sections conditionally based on:

```js
monthlyReportPack.report_scope.mode
monthlyReportPack.report_scope.comparison_mode
```

Do not render YoY tables if comparison data is unavailable.

Show honest partial/empty states instead.

## 12. CSV Output Updates

### YTD CSV files

```text
ytd_profit_loss_2026.csv
monthly_trend_2026_ytd.csv
expense_breakdown_2026_ytd.csv
bills_payables_2026_ytd.csv
ledger_export_2026_ytd.csv
data_quality_2026_ytd.csv
```

### YTD YoY CSV files

```text
yoy_profit_loss_2026_vs_2025_ytd.csv
monthly_trend_yoy_2026_vs_2025.csv
expense_breakdown_2026_ytd.csv
ledger_export_2026_ytd.csv
data_quality_2026_ytd.csv
```

CSV rules:

- Amounts must be raw numbers.
- Include period labels.
- Include source collection.
- Include record IDs where row-level data exists.
- Do not include fake comparison rows.
- If previous period has no data, output headers and limitation only.

## 13. Export Metadata Updates

Add `report_scope` to `users/{userId}/report_exports/{exportId}`:

```js
{
  report_type: "monthly_report_pack",
  report_scope: {
    mode: "year_to_date",
    comparison_mode: "previous_year_to_date",
    current_period: {
      start_date: "2026-01-01",
      end_date: "2026-05-21",
      label: "2026 YTD"
    },
    comparison_period: {
      start_date: "2025-01-01",
      end_date: "2025-05-21",
      label: "2025 YTD"
    }
  },
  formats: ["pdf_print", "csv_bundle"],
  status: "generated",
  included_sections: [],
  record_counts: {
    current_period_transactions: 0,
    comparison_period_transactions: 0,
    bills: 0,
    subscriptions: 0
  },
  warning_counts: {},
  limitations: [],
  created_at: serverTimestamp(),
  created_by: userId
}
```

Audit log must include report scope metadata, but not row-level report data.

## 14. Security

All data must stay under:

```text
users/{userId}/transactions
users/{userId}/bills
users/{userId}/subscriptions
users/{userId}/report_exports
users/{userId}/audit_logs
```

Never use global report collections.

Never compare against another user's data.

Never create cross-user benchmarks.

## 15. Empty and Partial States

### YTD no data

```text
No year-to-date data found.
Add transactions, bills, or subscriptions for this year before generating a YTD report.
```

### YoY no previous-year data

```text
Previous-year comparison unavailable.
FluxyOS found no records for the same period last year.
```

Do not block current-period report generation.

Show:

```text
YTD report: Available
YoY comparison: Unavailable
```

### Partial previous-year data

```text
Previous-year comparison is partial.
Some months or categories have no historical records, so YoY interpretation may be incomplete.
```

### Category mismatch

```text
Some categories are new this year and cannot be compared directly.
```

## 16. Report Confidence Updates

For YTD and YoY, confidence must include:

```text
Current period coverage
Comparison period coverage
Monthly trend completeness
Category mapping consistency
Receipt coverage
Due-date completeness
Recurring revenue classification
Audit trail
```

Report Confidence remains:

```text
Product-readiness indicator, not accounting assurance.
```

Do not imply the report is audited.

## 17. Implementation Steps

1. Add `Report period` and `Compare with` controls in `reports.html`.
2. Add `resolveReportScope(...)` in `report-builder.js`.
3. Fetch current and comparison period data.
4. Add `calculateYtdSummary(...)`.
5. Add `calculateMonthlyTrend(...)`.
6. Add `calculateYoYComparison(...)`.
7. Add `calculateMonthlyTrendComparison(...)`.
8. Add `report_scope` and `monthly_trend` to the report model.
9. Update preview drawer with current/comparison period info.
10. Update `report-preview.html` to render dynamic YTD and YoY sections.
11. Update CSV filenames and rows based on report scope.
12. Include `report_scope` in `report_exports` and `audit_logs`.
13. QA all modes.

## 18. Acceptance Criteria

Implementation is complete when:

1. Reports page has `Report period` control.
2. Reports page has `Compare with` control.
3. User can select `Year to date`.
4. User can select `Previous year to date`.
5. Date range resolves correctly.
6. Preview drawer shows current and comparison periods.
7. Report title changes based on report scope.
8. YTD report renders with YTD-specific sections.
9. YTD YoY report renders with YoY comparison sections.
10. Monthly trend table renders for YTD.
11. YoY comparison table renders when previous-year data exists.
12. Previous-year unavailable state renders when no comparison data exists.
13. YoY percent change never shows Infinity or NaN.
14. Gross margin point change uses `pts`.
15. CSV filenames adapt to YTD / YoY mode.
16. `report_exports` stores report_scope metadata.
17. `audit_logs` stores report_scope metadata.
18. No cross-user data access occurs.
19. No fake comparison data is rendered.
20. Existing monthly report behavior still works.
21. Print / Save PDF still works.
22. Download CSV Bundle still works.
23. Mobile layout works.
24. No console errors.

## 19. Manual QA Checklist

### YTD

- Select `Report period = Year to date`.
- Confirm start date resolves to Jan 1.
- Confirm end date resolves to today or selected end date.
- Generate preview.
- Confirm drawer title says Year-to-Date Financial Report.
- Open full report.
- Confirm YTD P&L renders.
- Confirm monthly trend renders.
- Confirm CSV files use YTD filenames.
- Confirm Print / Save PDF works.

### YTD YoY

- Select `Report period = Year to date`.
- Select `Compare with = Previous year to date`.
- Confirm current period is Jan 1 current year to today.
- Confirm comparison period is Jan 1 previous year to same month/day.
- Generate preview.
- Confirm drawer shows both periods.
- Open full report.
- Confirm YoY comparison table renders.
- Confirm margin change uses `pts`.
- Confirm no NaN or Infinity.
- Confirm previous-year limitations appear if historical data is partial.
- Confirm CSV files use YoY filenames.

### Regression

- Test monthly report.
- Test custom range.
- Test existing date picker.
- Test Generate Preview.
- Test Open Full Report.
- Test Confirm Export.
- Test Recent Exports.
- Test no-data state.
- Test mobile.

## 20. Final Report for Agent

After implementation, report:

```text
Files changed:
- ...

What was implemented:
- ...

How report period selection works:
- ...

How comparison selection works:
- ...

How YTD is calculated:
- ...

How YoY is calculated:
- ...

How report-preview adapts:
- ...

How CSV filenames adapt:
- ...

How export/audit metadata changed:
- ...

Manual QA completed:
- ...

Known limitations:
- ...
```

