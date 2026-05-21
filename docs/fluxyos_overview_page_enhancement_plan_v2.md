# FluxyOS Overview Page Enhancement Plan

## Purpose

Enhance the existing FluxyOS Overview page so it becomes a real finance command center, not just a static dashboard.

The goal is to improve the overview page functionality, data usefulness, and decision support while preserving the existing top KPI card design and the current dashboard visual language.

This plan is written for Codex or another code agent to execute safely inside the existing FluxyOS codebase.

---

## 1. Product Context

FluxyOS is a financial operations platform for Indonesian businesses. The Overview page should help business owners and finance operators quickly understand:

- How the business is performing
- Whether revenue and spending are moving in the right direction
- What financial risks need attention
- Whether upcoming bills and subscriptions create cash pressure
- What action should be taken next

The Overview page is not the place for deep transaction management. It should summarize business health and route users into the right operational page when action is needed.

---

## 2. Main Objective

Upgrade the Overview page into a practical finance command center that shows current performance, period-aware metrics, upcoming obligations, and clear next actions using existing user-scoped financial data.

---

## 3. Feature Type

This is a combination of:

- Page-level enhancement
- Section-level feature additions
- Intelligence feature
- Component-level logic enhancement

It is not a full redesign.

---

## 4. Job To Be Done

When I open the FluxyOS Overview page,  
I want to quickly understand my business performance, risks, and next required actions,  
so I can decide what to fix, review, or investigate without opening every finance page manually.

---

## 5. Target Users

Primary:

- Business owner
- Founder
- Finance admin

Secondary:

- Accountant
- Operations manager
- Internal finance team member

---

## 6. Current Overview Page Assumption

The current Overview page already includes:

- Top KPI cards:
  - Revenue
  - OpEx
  - Gross Margin
  - Needs Action
- Ledger preview
- Add Transaction entry point
- Fluxy AI drawer access
- Some visible controls such as filters, date/period actions, export, and resolve actions
- Existing visual style and layout

Some visible controls may currently be stubs. This enhancement should make key controls functional without redesigning the whole page.

---

## 7. Critical Preservation Rule: Top KPI Cards

Do not redesign, restructure, replace, or visually restyle the existing top KPI card section.

The existing top KPI cards must remain visually and structurally consistent with the current dashboard:

- Keep the same card layout.
- Keep the same spacing.
- Keep the same hierarchy.
- Keep the same visual style.
- Keep the same border, radius, typography, and placement.
- Keep the same four top KPI cards:
  - Revenue
  - OpEx
  - Gross Margin
  - Needs Action
- Do not replace them with a new card design.
- Do not move them lower on the page.
- Do not introduce a new hero-style summary above them.
- Do not add a large AI summary above them.
- Do not add decorative cards above them.
- Do not create a new first-viewport layout unless explicitly requested later.

Only enhance the existing KPI cards in place with safe functional improvements, such as:

- Dynamic comparison values
- Selected period awareness
- Loading state
- Empty state
- Error state
- Safer fallback text when data is missing
- Correct period label
- Correct action link behavior

Any new sections, such as Cash Pressure, Receivables / Payables, AI Summary, Upcoming Bills, Subscription Renewals, or Financial Health, must be added below the existing top KPI card section.

---

## 8. Overview Page Product Boundaries

### Overview should include

- High-level financial performance
- Period-aware KPIs
- Revenue, OpEx, and gross margin context
- Needs Action summary
- Cash pressure proxy
- Upcoming bills and renewals summary
- Receivables and payables summary
- AI-generated finance summary based on real available data
- Clear links into Ledger, Bills, Subscriptions, Revenue Sync, Reports, or Fluxy AI

### Overview should not include

- Full transaction editing
- Deep audit log tables
- Complex transaction-level filters
- Full P&L report builder
- Full CSV import workflow
- Full receipt upload workflow
- Full bill payment execution
- Complex integration setup
- Team permission management

Those belong on their dedicated pages.

---

## 9. Existing Top KPI Card Enhancements

### 9.1 Revenue KPI

Enhance the existing Revenue card in place.

#### Functional requirements

- Continue using existing revenue calculation logic.
- Revenue includes:
  - `income`
  - legacy `revenue`
  - `refund` only if current project rules treat refund as revenue-positive
  - `pending_receivable` when expected revenue is relevant
- Add dynamic comparison against previous equivalent period.
- Replace hardcoded `0%` change with real calculated percentage.
- Show fallback text when comparison cannot be calculated.

#### UX requirements

- Preserve current card design.
- Keep the existing position.
- Do not change visual hierarchy.
- Use small secondary text for comparison.
- If previous period revenue is zero, do not show Infinity or NaN.
- Use plain language:
  - `No previous period data`
  - `Flat vs previous period`
  - `Up X% vs previous period`
  - `Down X% vs previous period`

---

### 9.2 OpEx KPI

Enhance the existing OpEx card in place.

#### Functional requirements

- Continue using current OpEx calculation logic.
- OpEx includes:
  - `expense`
  - `fee`
  - `tax`
  - `pending_payable`
- Add dynamic comparison against previous equivalent period.
- Add safe handling for zero previous period.
- Keep amounts displayed as Indonesian Rupiah.

#### UX requirements

- Preserve current card design.
- Do not introduce a new expense chart inside the card.
- Use warning-style language only when OpEx meaningfully increases.
- Do not overstate risk if data is incomplete.

---

### 9.3 Gross Margin KPI

Enhance the existing Gross Margin card in place.

#### Functional requirements

- Keep gross margin formula:
  - `((revenue - opex) / revenue) * 100`
- If revenue is zero, show `0%` or safe fallback.
- Never show:
  - `NaN`
  - `Infinity`
  - `-Infinity`
- Add comparison vs previous equivalent period.
- Keep existing margin progress bar behavior if it already exists.

#### UX requirements

- Preserve current card design.
- Keep progress bar in current style.
- Add short status text if useful:
  - `Healthy`
  - `Tight`
  - `Negative`
  - `No revenue data`

---

### 9.4 Needs Action KPI

Enhance the existing Needs Action card in place.

#### Functional requirements

Needs Action should summarize actionable finance items, not only missing receipts.

Include counts from available data:

- Transactions with `status === "Missing Receipt"`
- Bills that are overdue
- Bills due soon
- Subscriptions renewing soon
- Optional: pending receivables if supported by data
- Optional: data quality warnings if ledger data is incomplete

#### UX requirements

- Preserve current card design.
- Replace any broken `href="#"` action with a working click behavior.
- “Resolve Now” should route or scroll to the relevant action section.
- If no action items exist, show positive neutral state:
  - `No urgent action`
  - `Records look clean`

#### Action behavior

Preferred behavior:

- If missing receipts exist, route to Ledger with missing receipt context if supported.
- If overdue bills exist, route to Bills page.
- If renewals exist, route to Subscriptions page.
- If multiple action types exist, scroll to a new `Needs Attention` section below the KPI cards.

---

## 10. New Section: Period Control

Add a compact period control near the page header or existing dashboard controls.

### Functional requirements

Support:

- This month
- Last month
- Year to date
- Custom range if shared date range picker is already available and safe to use

### UX requirements

- Do not place period control above the top KPI cards if it disrupts the existing first viewport.
- Prefer placing it in the existing header/control area.
- Use existing dashboard button styling.
- Keep one primary action max in the viewport.
- Period changes must update:
  - Top KPI card values
  - KPI comparison labels
  - Cash Pressure section
  - Receivables / Payables summary
  - Needs Attention section
  - Ledger preview if appropriate

### Data behavior

- Use transaction timestamps for period filtering.
- Use bill due dates for bill-related period logic.
- Use subscription renewal dates for renewal logic.
- If dates are missing, show safe fallback states.

---

## 11. New Section: Cash Pressure Snapshot

Add this section below the existing top KPI cards.

### Purpose

Help the user understand whether upcoming obligations may create cash pressure.

### Functional requirements

Calculate using available data:

- Upcoming bills due within the selected period or next 30 days
- Upcoming subscription renewals within the selected period or next 30 days
- Pending payable transactions if supported
- Pending receivable transactions if supported
- Revenue and OpEx from selected period

Suggested output:

- Upcoming obligations total
- Expected incoming total
- Net pressure estimate
- Risk level:
  - Low
  - Watch
  - High

### Important limitation

Cash pressure is only a proxy unless real bank balance exists.

Show a limitation note when needed:

`Cash pressure is estimated from FluxyOS records only. Connect bank balance later for real liquidity analysis.`

### UX requirements

- Use one clear section/card below KPI cards.
- Do not overcomplicate the first version.
- Avoid pretending this is real cash balance.
- Include CTA links:
  - View Bills
  - View Subscriptions
  - Ask Fluxy AI

---

## 12. New Section: Receivables and Payables Summary

Add this section below the KPI cards, either beside or below Cash Pressure depending on available space.

### Purpose

Show money expected in and money expected out.

### Functional requirements

Receivables can include:

- `pending_receivable` transactions
- Revenue records marked as expected if such data exists later

Payables can include:

- Bills
- `pending_payable` transactions
- Upcoming subscriptions

Show:

- Total receivables
- Total payables
- Net expected position
- Count of related records

### UX requirements

- Keep it compact.
- Make it scannable in under 5 seconds.
- Include links to related pages.
- If no receivable/payable data exists, show empty state:
  - `No pending receivables found`
  - `No upcoming payables found`

---

## 13. New Section: Needs Attention

Add a section below the top KPI cards.

### Purpose

Convert the Needs Action KPI from a passive number into an actionable queue.

### Functional requirements

Show grouped action items:

1. Missing receipts
2. Overdue bills
3. Bills due soon
4. Subscriptions renewing soon
5. Unusually high OpEx, if detectable from period comparison
6. Data quality warning, if records are incomplete

Each item should include:

- Short title
- Count or amount
- Why it matters
- Recommended action
- Link to related page

### UX requirements

- Do not show a huge table.
- Show max 3 to 5 action items.
- Prioritize by urgency:
  1. Overdue bills
  2. Missing receipts
  3. High OpEx increase
  4. Upcoming renewals
  5. Data quality warning
- Include empty state:
  - `No urgent finance actions right now`

---

## 14. New Section: AI Business Summary

Add this section below KPI cards and below or near Needs Attention.

### Purpose

Make the overview feel intelligent and decision-oriented.

### Functional requirements

For first implementation, this can be rule-based if real AI orchestration is not ready.

It should summarize:

- Current selected period performance
- Main positive signal
- Main risk
- Suggested next action
- Data limitation if applicable

Example output:

`Here’s what I’m seeing: Revenue is higher than OpEx this period, but upcoming bills may pressure cash in the next 30 days. I’d check overdue bills first before adding new spend.`

### Important AI guardrails

- Do not invent numbers.
- Do not call OpenAI directly from frontend.
- If real AI is used, the backend must provide grounded finance data first.
- AI should explain backend-calculated data only.
- Do not create, edit, approve, export, or save records from AI without explicit user confirmation.

### UX requirements

- Do not place this above the top KPI cards.
- Do not make it visually louder than the KPI section.
- It should feel like a finance analyst note, not a generic chatbot.
- Include CTA:
  - `Ask Fluxy AI about this period`

---

## 15. New Section: Upcoming Bills and Renewals

Add a compact upcoming obligations section.

### Functional requirements

Show:

- Bills due soon
- Overdue bills
- Subscriptions renewing soon
- Amount
- Vendor name
- Due or renewal date
- Status

### UX requirements

- Max 5 records.
- Do not duplicate full Bills or Subscriptions page.
- Include CTA:
  - `View all bills`
  - `View subscriptions`
- Empty state:
  - `No upcoming bills or renewals`

---

## 16. Ledger Preview Enhancement

Enhance the existing dashboard ledger preview without turning it into the full Ledger page.

### Functional requirements

- Continue showing latest 5 transactions.
- Apply selected period if appropriate.
- Keep empty state behavior.
- Fix dashboard export button if currently a stub.
- Export only visible or selected-period records, clearly labeled.

### UX requirements

- Do not add complex filters here.
- Do not add full table pagination here.
- Link to full Ledger page for deep review.
- Keep dashboard preview compact.

---

## 17. Data Requirements

Use existing user-scoped collections only:

```text
users/{userId}/transactions
users/{userId}/bills
users/{userId}/subscriptions
users/{userId}/audit_logs
```

Do not create global financial collections.

Do not introduce workspace-scoped data unless a separate migration plan is created.

### Required fields

Transactions:

- `amount`
- `vendor_name`
- `category`
- `type`
- `status`
- `timestamp`

Bills:

- `amount`
- `vendor_name`
- `category`
- `type`
- `status`
- `timestamp`
- `due_date`

Subscriptions:

- `amount`
- `vendor_name`
- `category`
- `type`
- `status`
- `timestamp`
- `renewal_date`

### Fallback rules

If `due_date` is missing:

- Do not count it as overdue.
- Show fallback label only in display:
  - `No due date`

If `renewal_date` is missing:

- Do not count it as renewing soon.
- Show fallback label:
  - `No renewal date`

If `timestamp` is missing:

- Exclude from period comparison.
- Include only if existing current implementation already handles fallback.

---

## 18. Backend / DataService Requirements

Prefer adding or updating methods inside:

```text
assets/js/db-service.js
```

Do not scatter raw Firestore queries inside `dashboard.html` if a DataService method should own the logic.

Suggested methods:

```js
DataService.getDashboardOverview(userId, options)
DataService.getPeriodPerformance(userId, { startDate, endDate })
DataService.getPreviousPeriodPerformance(userId, { startDate, endDate })
DataService.getUpcomingBills(userId, { startDate, endDate, limit })
DataService.getUpcomingSubscriptions(userId, { startDate, endDate, limit })
DataService.getNeedsAttention(userId, { startDate, endDate })
```

If implementation effort needs to stay small, create only one method:

```js
DataService.getDashboardOverview(userId, { startDate, endDate })
```

and return a structured object containing all overview data.

### Suggested response shape

```js
{
  period: {
    label: "This month",
    startDate: Date,
    endDate: Date
  },
  performance: {
    revenue: number,
    opex: number,
    grossMargin: number,
    revenueChangePct: number | null,
    opexChangePct: number | null,
    marginChangePct: number | null
  },
  actionItems: {
    total: number,
    missingReceipts: number,
    overdueBills: number,
    billsDueSoon: number,
    renewalsSoon: number
  },
  cashPressure: {
    upcomingObligations: number,
    expectedIncoming: number,
    netPressure: number,
    riskLevel: "low" | "watch" | "high",
    limitation: string
  },
  receivablesPayables: {
    receivablesTotal: number,
    payablesTotal: number,
    netExpected: number,
    receivableCount: number,
    payableCount: number
  },
  upcoming: {
    bills: [],
    subscriptions: []
  },
  insights: {
    summary: string,
    mainRisk: string,
    recommendedAction: string,
    limitations: []
  }
}
```

---

## 19. Frontend Files Likely Touched

Expected files:

```text
dashboard.html
assets/js/db-service.js
assets/js/shared-dashboard.js
assets/css/shared-dashboard.css
```

Optional, only if required by existing project structure:

```text
assets/js/dashboard.js
assets/js/date-range-picker.js
```

Do not create a new framework, bundler, React component, or npm setup.

---

## 20. UI Placement Recommendation

Keep first viewport order:

1. Existing page header / title area
2. Existing top KPI card section
3. New Cash Pressure / Receivables-Payables section
4. New Needs Attention section
5. New AI Business Summary section
6. Upcoming Bills and Renewals
7. Existing ledger preview

If the current ledger preview already appears higher, preserve the current general structure unless moving it slightly downward improves clarity without breaking the existing layout.

The most important rule: top KPI cards remain the first major dashboard content block.

---

## 21. States to Handle

Every new or enhanced section must support:

### Loading state

- Use existing shimmer/skeleton pattern if available.
- Do not show blank cards.

### Empty state

Examples:

- `No transactions found for this period`
- `No upcoming bills found`
- `No subscriptions renewing soon`
- `No urgent finance actions right now`

### Error state

- Show friendly error message.
- Do not expose raw Firebase errors.
- Keep page usable.

### Partial data state

If some collections load but others fail:

- Show available data.
- Add limitation text:
  - `Bills data could not be loaded, so cash pressure may be incomplete.`

### No previous period state

If comparison cannot be calculated:

- Show:
  - `No previous period data`
- Do not show:
  - `0%`
  - `NaN`
  - `Infinity`

---

## 22. Security and Data Integrity Rules

- All reads must be scoped to authenticated `userId`.
- Never query global financial collections.
- Do not expose another user’s data.
- Do not store formatted currency strings.
- Amounts must remain raw numbers in Firestore.
- Do not implement edit, delete, approve, mark-paid, or AI write actions unless explicitly scoped.
- Do not create payment behavior.
- Do not mark bills as paid from the Overview page.
- Any sensitive future action must use confirmation and audit logs.
- Avoid logging sensitive financial records to browser console.

---

## 23. UX and Visual Requirements

- Preserve existing dashboard visual language.
- Preserve top KPI card design.
- Use existing cards, tables, buttons, typography, and spacing rules.
- Keep orange as accent only.
- Do not use orange page backgrounds.
- Use Indonesian Rupiah formatting:
  - `Rp 1.234.567`
- Use `Fira Code` or existing mono style for monetary values if already used.
- Use clear labels, not vague finance jargon.
- Ensure desktop, tablet, and mobile layout work.
- Avoid “card-per-everything” clutter.
- New sections should improve decision-making, not just add decoration.

---

## 24. Acceptance Criteria

This enhancement is complete when:

- Existing top KPI cards are visually unchanged.
- Existing top KPI cards remain at the top of dashboard content.
- Revenue, OpEx, Gross Margin, and Needs Action values still load correctly.
- Revenue change is calculated dynamically or safely falls back.
- OpEx and margin comparisons are calculated or safely fallback.
- No KPI shows `NaN`, `Infinity`, or broken values.
- Period selection updates all overview metrics.
- Cash Pressure section appears below KPI cards.
- Receivables / Payables summary appears below KPI cards.
- Needs Attention section shows grouped action items.
- AI Business Summary gives grounded, non-invented finance guidance.
- Upcoming Bills and Renewals section shows real user data or empty state.
- Ledger preview still works.
- Add Transaction still works.
- Fluxy AI drawer still opens.
- Sidebar still works.
- Auth guard still works.
- No footer appears on dashboard.
- No raw Firebase error appears to user.
- No unrelated page is redesigned.
- No backend schema is changed without documentation.
- No new framework or build tooling is introduced.

---

## 25. Manual QA Checklist

After implementation, run these checks:

### Dashboard basics

- Open `dashboard.html` after login.
- Confirm sidebar renders.
- Confirm top KPI cards look the same as before.
- Confirm top KPI cards are still the first major content block.
- Confirm Revenue, OpEx, Gross Margin, and Needs Action load.
- Confirm Add Transaction still opens the existing drawer.
- Confirm Fluxy AI drawer still opens.

### Data logic

- Add an income transaction and confirm Revenue updates.
- Add an expense transaction and confirm OpEx updates.
- Confirm Gross Margin calculation is correct.
- Confirm zero revenue does not break margin.
- Confirm missing receipt increases Needs Action.
- Confirm bills due soon appear in Needs Attention.
- Confirm overdue bills are prioritized.
- Confirm subscriptions renewing soon appear in upcoming obligations.

### Period logic

- Select This Month.
- Select Last Month.
- Select Year to Date.
- Confirm KPI values update.
- Confirm comparison labels update.
- Confirm no NaN or Infinity appears.
- Confirm empty previous period shows safe fallback.

### UI states

- Test empty account state.
- Test account with transactions only.
- Test account with bills only.
- Test account with subscriptions only.
- Test partial missing dates.
- Test Firebase permission/load error if possible.

### Regression

- Ledger page still works.
- Bills page still works.
- Subscriptions page still works.
- Revenue Sync page still works.
- Integrations page still works.
- Dashboard page has no marketing footer.
- Browser console has no red errors.

---

## 26. Out of Scope

Do not implement in this task:

- Full Reports & Exports page
- PDF report export
- AI document upload
- Receipt OCR
- WhatsApp assistant
- Real bank payment
- Payment rail integration
- Workspace/team permissions
- Role-based access control
- Full audit log page
- Full settings page
- Real OAuth integration setup
- Full Ledger redesign
- Full Bills redesign
- Full Subscriptions redesign
- Top KPI card redesign

---

## 27. Implementation Sequence

Recommended execution order:

1. Read existing `dashboard.html`.
2. Read existing `assets/js/db-service.js`.
3. Read existing shared dashboard helpers.
4. Identify current top KPI card markup and preserve it.
5. Add or update DataService overview aggregation.
6. Add period calculation helpers.
7. Enhance existing KPI cards in place without visual redesign.
8. Add Cash Pressure section below KPI cards.
9. Add Receivables / Payables section below KPI cards.
10. Add Needs Attention section below KPI cards.
11. Add AI Business Summary section below KPI cards.
12. Add Upcoming Bills and Renewals section.
13. Ensure Ledger preview still works.
14. Add loading, empty, partial, and error states.
15. Run manual QA.
16. Report exactly what changed and what was intentionally not changed.

---

## 28. Final Report Required From Codex

After implementation, Codex must report:

- Files changed
- Functions added or modified
- Whether the top KPI cards were preserved visually
- What new sections were added
- What data each section uses
- What empty/error states were added
- What was intentionally left out of scope
- Manual QA completed
- Any known limitation or follow-up needed
