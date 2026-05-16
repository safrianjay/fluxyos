# Product & UX Feature Intake Framework

Use this document as the standard thinking layer before adding any new feature, page, or enhancement.

Every time a new feature request appears, do not jump directly into UI or implementation. First define the business logic, user logic, job to be done, objective, scope, success criteria, and risk.

The goal is to make sure every feature has a reason, a role in the product, and a clear outcome.

---

## 1. Core Principle

A feature is not just something added to the interface.

A feature must answer:

- What user problem does this solve?
- What business objective does this support?
- What job is the user trying to complete?
- Where does this feature belong in the product system?
- What should change after the user uses it?
- How do we know if it works?

If these questions cannot be answered, the feature is not ready to build.

---

## 2. Feature Classification

Before defining the feature, classify the request.

### A. Page-level feature

A full page or major area in the product.

Examples:

- Finance Overview
- Finance Ledger
- Cash Flow Projection
- Invoice Management
- Vendor Management
- AI Analyst Page

Use this when the feature has its own purpose, navigation, data model, and user workflow.

### B. Section-level feature

A section inside an existing page.

Examples:

- Ledger Activity chart section
- Needs Action queue
- AI insight panel
- Receivables summary
- Transaction health cards

Use this when the feature supports the page purpose but does not need a standalone page.

### C. Component-level enhancement

A small UI or interaction improvement.

Examples:

- Transaction Type badge
- Amount positive/negative formatting
- Receipt indicator
- Status badge
- Filter chip
- Empty state improvement

Use this when the feature improves clarity, usability, or trust without changing the full workflow.

### D. Workflow feature

A multi-step process or operational flow.

Examples:

- Add transaction flow
- Approval flow
- Reconciliation flow
- Upload receipt flow
- Export report flow
- AI-assisted categorization flow

Use this when the user must complete a task across multiple steps.

### E. Intelligence feature

An insight, AI recommendation, automation, or decision-support feature.

Examples:

- Duplicate transaction detection
- AI monthly financial summary
- Anomaly detection
- Cash flow risk alert
- Suggested category
- Financial health explanation

Use this when the feature helps the user understand, decide, or act faster.

---

## 3. Required Feature Definition Template

Every new feature request should be documented using this structure.

```md
# Feature Name

## 1. Feature Type

Choose one:

- Page-level feature
- Section-level feature
- Component-level enhancement
- Workflow feature
- Intelligence feature

## 2. Context

What currently exists?
What is the user seeing or doing today?
What is missing, confusing, inefficient, or risky?

## 3. Main Objective

What is the primary goal of this feature?

This should be one clear sentence.

Example:
Help business owners quickly understand which ledger records need cleanup before they can trust the financial data.

## 4. Job To Be Done

Use this format:

When I [situation],
I want to [motivation/action],
so I can [desired outcome].

Example:
When I review my finance ledger,
I want to quickly see which transactions are incomplete or risky,
so I can clean the records before making business decisions.

## 5. Target User

Who is this mainly for?

Examples:

- Business owner
- Finance admin
- Accountant
- Operations manager
- Founder
- Approver
- Internal team member

## 6. User Problem

What pain does this solve?

Describe the real user problem, not the UI request.

Bad:
User needs a chart.

Good:
User needs to quickly detect unusual transaction activity without manually scanning hundreds of ledger rows.

## 7. Business Value

Why does this matter to the company/product?

Examples:

- Increases user trust
- Improves activation
- Reduces manual work
- Supports premium feature value
- Improves retention
- Makes the product feel more intelligent
- Helps the product become operationally useful

## 8. Product Logic

Explain where this feature belongs and why.

Questions:

- Does this belong on Overview, Ledger, Settings, Report, or another page?
- Is it a performance feature, control feature, or workflow feature?
- Does it duplicate another page?
- Does it support the page's main purpose?

Example:
This belongs on Finance Ledger because it helps users inspect transaction quality. It should not appear on Overview because Overview is focused on business performance and financial health.

## 9. Scope

### In Scope

- Item 1
- Item 2
- Item 3

### Out of Scope

- Item 1
- Item 2
- Item 3

Use this to prevent feature creep.

## 10. Functional Requirements

Define what the feature must do.

Example:

- Show total number of transactions.
- Show count of unreconciled transactions.
- Show count of missing receipts.
- Show transaction status breakdown.
- Use existing transaction data only.

## 11. UX Requirements

Define how the experience should behave.

Example:

- The feature must be easy to understand in under 5 seconds.
- It should not dominate the page.
- It should support the main table, not replace it.
- It should include empty states.
- It should work on desktop, tablet, and mobile.

## 12. Data Requirements

Define what data is needed.

Example:

- transaction.date
- transaction.status
- transaction.category
- transaction.amount
- transaction.receipt
- transaction.reconciliationStatus

Also define fallback behavior if data does not exist.

## 13. States

Cover all relevant states:

- Default state
- Loading state
- Empty state
- Error state
- Partial data state
- Permission-limited state

## 14. Success Metrics

How do we know this feature works?

Examples:

- Users can identify pending transactions faster.
- Users reduce uncategorized transactions.
- Users complete more approvals.
- Users attach missing receipts.
- Users spend less time searching manually.

## 15. Risks and Tradeoffs

What can go wrong?

Examples:

- Feature duplicates Overview.
- Adds visual clutter.
- Shows misleading numbers if data is incomplete.
- Creates false trust in unverified data.
- Requires backend fields that do not exist yet.

## 16. Acceptance Criteria

The feature is complete when:

- Requirement 1 is met.
- Requirement 2 is met.
- Requirement 3 is met.
- Existing functionality is not broken.
- Empty states are handled.
- Mobile layout works.

## 17. Implementation Guardrails

Define what must not change.

Example:

- Do not change backend schema.
- Do not change API behavior.
- Do not change existing routing.
- Do not change authentication or permissions.
- Do not change export logic.
- Do not refactor unrelated files.
```

---

## 4. Product Logic Checklist

Before approving any feature, answer these questions.

### User clarity

- Can the user understand the feature without explanation?
- Does it reduce confusion or add more complexity?
- Is the label clear?
- Is the hierarchy clear?

### Page fit

- Does the feature belong on this page?
- Does it support the main purpose of the page?
- Does it duplicate another page?
- Should it be a page, section, component, workflow, or AI insight?

### Business value

- Does this help the product become more valuable?
- Does it support activation, retention, monetization, trust, or operational usage?
- Is it solving a real business-owner problem?

### Data logic

- Do we already have the required data?
- If not, can we show a safe fallback?
- Are we making assumptions that may mislead users?
- Does this need auditability?

### UX quality

- Is the feature discoverable?
- Is it scannable?
- Does it have clear states?
- Does it work on mobile?
- Is the interaction obvious?

### Product risk

- Can this create wrong interpretation?
- Can this break trust?
- Can this make the page too crowded?
- Can this be abused or misused?

---

## 5. Page Purpose Framework

Use this to prevent duplicated features across pages.

### Overview Page

Purpose:
Business performance, financial health, and decision-making.

Main questions:

- How is the business doing?
- How much cash do I have?
- Is revenue growing?
- Is spending under control?
- Is the business profitable?
- What needs attention today?
- What should I do next?

Good features here:

- Cash on hand
- Revenue
- Spend
- Gross margin
- Cash flow projection
- Receivables and payables
- Needs Action summary
- AI business summary
- Financial health score

Avoid here:

- Too much transaction-level detail
- Deep audit logs
- Editing individual transaction data
- Complex table controls

### Finance Ledger Page

Purpose:
Transaction source of truth, audit, cleanup, and control.

Main questions:

- What exactly happened to my money?
- Which transactions need cleanup?
- Which records are incomplete?
- Which transactions are unreconciled?
- Which transactions need receipt or approval?
- Can I trust this ledger data?

Good features here:

- Transaction table
- Transaction type
- Status breakdown
- Unreconciled count
- Missing receipt count
- Uncategorized count
- Audit log
- Transaction detail drawer
- Filters
- Bulk actions
- CSV export

Avoid here:

- Revenue trend as primary chart
- Gross margin dashboard
- Cash flow projection
- Profit/loss dashboard
- Business performance duplication from Overview

### Reports Page

Purpose:
Formal financial reporting and export.

Main questions:

- What is the official financial result for this period?
- What report can I send to accountant, investor, or internal team?
- Can I export this data cleanly?

Good features here:

- Profit and loss report
- Cash flow report
- Expense report
- Tax-ready export
- PDF/CSV export
- Period comparison

### Settings Page

Purpose:
Configuration and preferences.

Main questions:

- How do I configure accounts, categories, permissions, and rules?

Good features here:

- Category management
- Account setup
- Role permissions
- Approval rules
- Export settings
- Currency settings
- AI preferences

---

## 6. Job To Be Done Library

Use these as reusable patterns.

### Finance Overview

When I open the finance dashboard,
I want to understand my business health quickly,
so I can decide what needs attention today.

### Ledger Review

When I review my ledger,
I want to see which records are incomplete, suspicious, or pending,
so I can clean the data before relying on reports.

### Transaction Search

When I need to investigate a money movement,
I want to search and filter transactions quickly,
so I can find the exact record without scanning manually.

### Receipt Management

When I prepare financial records,
I want to know which transactions are missing receipts,
so I can complete documentation before audit or tax reporting.

### Approval

When my team submits finance activity,
I want to review and approve important transactions,
so I can control spending and reduce financial risk.

### Reconciliation

When I compare ledger data with real bank or payment records,
I want to know which transactions are unmatched,
so I can trust the ledger balance.

### AI Insight

When there are many transactions or financial signals,
I want AI to highlight what matters,
so I can act faster without manually analyzing everything.

---

## 7. Feature Decision Matrix

Use this to decide priority.

| Score | Meaning |
|---|---|
| 1 | Low value or unclear problem |
| 2 | Nice to have |
| 3 | Useful but not urgent |
| 4 | Important for user workflow |
| 5 | Critical for product value or trust |

Evaluate each feature:

| Criteria | Score 1-5 |
|---|---:|
| User pain severity |  |
| Business value |  |
| Frequency of use |  |
| Impact on trust |  |
| Implementation effort |  |
| Risk of confusion |  |

Prioritization logic:

- High value + low effort = build soon
- High value + high effort = plan carefully
- Low value + low effort = only build if it improves polish
- Low value + high effort = avoid

---

## 8. Prompt Template for Future Feature Requests

Use this prompt whenever asking an AI coding agent to add a feature.

```text
You are working on the existing product.

Before implementing, define the product logic for this feature:

1. Feature type
2. Main objective
3. Job to be done
4. Target user
5. User problem
6. Business value
7. Page or product placement logic
8. In scope
9. Out of scope
10. Functional requirements
11. UX requirements
12. Data requirements
13. Empty/loading/error states
14. Success criteria
15. Risks and tradeoffs
16. Implementation guardrails

Then implement only the approved scope.

Important implementation rules:
- Do not change unrelated functionality.
- Do not modify backend/API/schema unless explicitly requested.
- Do not refactor unrelated files.
- Preserve existing routing, authentication, permissions, and data fetching.
- Preserve existing design system and component patterns.
- Add safe fallback states for missing data.
- Keep the implementation aligned with the page purpose.
```

---

## 9. Feature Documentation Example

# Feature: Ledger Activity Graphs

## 1. Feature Type

Section-level feature.

## 2. Context

The Finance Ledger page currently shows transaction records in a table. Users can search, export, and add transactions. However, they cannot quickly understand transaction activity patterns or status distribution without scanning rows manually.

## 3. Main Objective

Help users diagnose ledger activity and transaction status quality before reviewing the transaction table.

## 4. Job To Be Done

When I review my finance ledger,
I want to quickly understand transaction volume and status distribution,
so I can identify unusual activity or records that need attention.

## 5. Target User

- Business owner
- Finance admin
- Accountant

## 6. User Problem

The user needs to understand ledger condition quickly, but a transaction table alone requires manual scanning.

## 7. Business Value

This increases trust in the finance module by making the ledger feel more operational, auditable, and easier to review.

## 8. Product Logic

This belongs on the Finance Ledger page because it is about transaction diagnosis and data quality. It should not appear on the Overview page because Overview is focused on business performance and financial health.

## 9. Scope

### In Scope

- Transaction Volume Over Time chart
- Status Breakdown chart
- Compact graph cards
- Empty states
- Existing transaction data only

### Out of Scope

- Revenue trend
- Expense trend
- Profit/loss chart
- Cash flow projection
- Backend schema changes
- New API logic

## 10. Functional Requirements

- Group transactions by date.
- Count transaction volume per date.
- Count transactions by status.
- Render two compact graph cards.
- Use real ledger data.

## 11. UX Requirements

- Desktop: two graph cards side by side.
- Card height: around 240px.
- Tablet/mobile: stack vertically.
- Graphs should support the table, not dominate the page.

## 12. Data Requirements

- transaction.date
- transaction.status

Fallback:

- If no transactions exist, show empty state.
- If status is missing, show Not available.

## 13. States

- Default state with charts
- Empty state
- Partial data state
- Loading state if data is loading

## 14. Success Metrics

- Users can identify pending/failed transactions faster.
- Users can notice unusual transaction activity faster.
- Users spend less time manually scanning the table.

## 15. Risks and Tradeoffs

- Could make Ledger feel like another Overview dashboard.
- Could add visual clutter if charts are too large.
- Could mislead users if data is incomplete.

## 16. Acceptance Criteria

- Ledger Activity section appears above the table.
- Transaction Volume chart uses transaction count, not amount.
- Status Breakdown uses existing status field.
- Overview page remains unchanged.
- Existing ledger features continue to work.

## 17. Implementation Guardrails

- Do not change backend/API/schema.
- Do not change existing table behavior.
- Do not change search/export/add transaction/pagination.
- Do not add new chart dependency unless the project already uses one.

---

## 10. Final Rule

Every feature must have a reason.

If the feature only makes the UI look fuller but does not improve user understanding, task completion, trust, or business value, it should not be built yet.
