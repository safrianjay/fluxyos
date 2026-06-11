# FluxyOS Create Invoice Feature Implementation Plan

## 0. Purpose

Build a **Create Invoice** feature for FluxyOS, placed under the **Operations** menu and positioned directly under **Budgets** as the main entry point.

The experience should use the Stripe invoice creation flow as the benchmark for interaction quality: a focused invoice editor on the left, a live preview on the right, staged customer/item/payment steps, and a final review modal before sending/finalizing.

This feature must be adjusted to the current FluxyOS product, stack, data model, and design system. Do not clone Stripe visually. Use Stripe only as a workflow and layout benchmark.

---

## 1. Feature Type

- Page-level feature
- Workflow feature
- Finance operations feature

---

## 2. Context

FluxyOS currently supports:

- Transactions
- Revenue Sync
- Bills
- Subscriptions
- Budgets
- Reports & Exports
- Settings
- AI chat drawer

However, FluxyOS does not yet have a native invoice creation flow. For Indonesian businesses, invoices are a core operational finance object because they connect revenue collection, receivables, customer billing, payment status, and reporting.

The Stripe benchmark shows a good pattern:

1. Enter customer.
2. Select currency.
3. Add invoice line items.
4. Configure payment collection.
5. Add optional memo/tax/footer.
6. Preview the invoice live.
7. Review before sending/finalizing.
8. Show invoice detail after completion.

FluxyOS should adopt this workflow, but remove or simplify capabilities that are unnecessary for MVP.

---

## 3. Main Objective

Help FluxyOS users create, review, and track customer invoices from inside the finance operations workflow without leaving the platform.

---

## 4. Job To Be Done

When I need to bill a customer,
I want to create a clear invoice, preview it, and confirm before sending or saving,
so I can track expected revenue and avoid manual billing mistakes.

---

## 5. Target User

- Business owner
- Founder
- Finance admin
- Accountant
- Operations manager

---

## 6. User Problem

Users currently need to create invoices outside FluxyOS or manually record expected revenue after the fact. This creates gaps between billing, receivables, revenue tracking, and financial reporting.

The feature solves this by making invoice creation part of the operational finance flow.

---

## 7. Business Value

This feature increases FluxyOS value because it connects:

- Revenue operations
- Receivables tracking
- Customer billing
- Cash pressure visibility
- Reports and finance summaries
- Future AI finance questions such as:
  - Which invoices are unpaid?
  - How much receivable is due this month?
  - Which customers are late?
  - Can I cover upcoming bills from expected invoice payments?

---

## 8. Product Placement Logic

### Sidebar placement

Add a new item under the **Operations** group:

```text
Operations
- Vendor Spend       Soon
- Receipt Capture    Soon
- Budgets            Active link
- Invoices           New active link
- Approvals          Soon
```

Place **Invoices** directly under **Budgets**.

### Route

Use:

```text
/invoices
```

Main file:

```text
invoices.html
```

Page controller:

```text
assets/js/invoices.js
```

Data access:

```text
assets/js/db-service.js
```

Optional shared styles only if needed:

```text
assets/css/shared-dashboard.css
```

Do not create a marketing page. This is an authenticated app page.

---

## 9. MVP Scope

### In Scope

1. Invoices app page under Operations.
2. Sidebar entry for Invoices under Budgets.
3. Auth guard and shared sidebar.
4. Invoice list/table.
5. Empty state.
6. Create Invoice button.
7. Full-page invoice editor inspired by Stripe:
   - Left form/editor panel
   - Right live invoice preview
   - Sticky top action bar
8. Customer section:
   - Customer name
   - Customer email
   - Optional company name
9. Currency:
   - MVP locked to IDR
   - Do not support multi-currency in MVP
10. Line items:
   - Description
   - Quantity
   - Unit price
   - Amount calculation
   - Add/remove item
11. Payment collection:
   - Request payment only
   - Payment due date options:
     - Due on receipt
     - Due in 7 days
     - Due in 14 days
     - Due in 30 days
     - Custom date
12. Additional options:
   - Memo
   - Footer note
   - Tax ID display field
13. Live preview:
   - Invoice number
   - Issue date
   - Due date
   - Customer details
   - Line items
   - Subtotal
   - Tax if enabled
   - Total
   - Amount due
14. Review modal before save/finalize.
15. Save as draft.
16. Finalize invoice.
17. Invoice detail page or detail drawer.
18. Status tracking:
   - Draft
   - Open
   - Paid
   - Void
   - Overdue
19. Firestore user-scoped storage.
20. Audit logs for create, update, finalize, void, and mark paid actions.
21. QA checklist updates for invoices.

### Out of Scope

Do not implement these in MVP:

- Real payment processing
- Payment page hosting
- Stripe integration
- Autopay customer
- Payment method setup
- Resend invoice email through provider
- Email delivery through SMTP
- PDF generation from backend
- Automatic ledger transaction creation
- Automatic mark as paid
- Multi-currency
- Customer database module
- Product catalog module
- Recurring invoices
- Discounts/coupons
- E-signature
- Bank transfer reconciliation
- AI invoice auto-generation

---

## 10. Important Finance Rule

A finalized invoice represents expected revenue / receivable. It must **not** automatically create a completed ledger transaction.

Recommended behavior:

- Draft invoice: no revenue impact.
- Open invoice: can be included as `pending_receivable` in receivables/cash pressure analysis.
- Paid invoice: after user confirms payment received, create or link a ledger transaction.
- Void invoice: excluded from receivables and revenue.

Never mark invoice paid without explicit user confirmation.

---

## 11. Data Model

All invoice data must stay under authenticated user scope.

### New collection

```text
users/{userId}/invoices/{invoiceId}
```

### Invoice fields

| Field | Type | Notes |
|---|---|---|
| `invoice_number` | string | Example: `INV-2026-0001`. Generated client-side or by DataService helper. Must be unique enough per user. |
| `status` | string | `draft`, `open`, `paid`, `void`, `overdue` |
| `currency` | string | Locked to `IDR` in MVP |
| `customer_name` | string | Required |
| `customer_email` | string | Required for finalize/send action, optional for draft |
| `customer_company` | string/null | Optional |
| `issue_date` | Timestamp | Required |
| `due_date` | Timestamp | Required before finalize |
| `due_terms` | string | `due_on_receipt`, `net_7`, `net_14`, `net_30`, `custom` |
| `line_items` | array | See line item shape below |
| `subtotal` | number | Raw integer Rupiah |
| `tax_enabled` | boolean | Default false |
| `tax_rate_percent` | number/null | Optional |
| `tax_amount` | number | Raw integer Rupiah |
| `total_amount` | number | Raw integer Rupiah |
| `amount_paid` | number | Raw integer Rupiah, default `0` |
| `amount_due` | number | Raw integer Rupiah |
| `memo` | string/null | Optional, max 500 chars |
| `footer_note` | string/null | Optional, max 500 chars |
| `tax_id_label` | string/null | Optional |
| `tax_id_value` | string/null | Optional |
| `payment_collection_method` | string | MVP: `request_payment` only |
| `payment_link` | string/null | Null in MVP unless future provider exists |
| `linked_transaction_id` | string/null | Set only if user marks paid and creates/links transaction |
| `created_at` | Timestamp | Server timestamp |
| `updated_at` | Timestamp | Server timestamp |
| `finalized_at` | Timestamp/null | Set when finalized |
| `paid_at` | Timestamp/null | Set when marked paid |
| `voided_at` | Timestamp/null | Set when voided |
| `created_by` | string | Auth user UID |
| `updated_by` | string | Auth user UID |

### Line item shape

```js
{
  id: "line_...",
  description: "Consulting service",
  quantity: 1,
  unit_price: 1000000,
  amount: 1000000
}
```

Rules:

- `unit_price` and `amount` are raw numbers.
- Do not store formatted strings such as `Rp1.000.000`.
- `quantity` can be decimal, but MVP should use max 2 decimal places.
- Line item amount = `quantity * unit_price`, rounded to nearest integer.
- At least one line item is required before finalize.
- Draft can be saved with incomplete fields, but must show completion warnings.

---

## 12. Firestore Rules

Add invoice rules under existing user-scoped rules.

Intent:

```js
match /users/{userId}/invoices/{invoiceId} {
  allow read: if request.auth != null && request.auth.uid == userId;
  allow create: if request.auth != null
    && request.auth.uid == userId
    && isValidInvoiceCreate();
  allow update: if request.auth != null
    && request.auth.uid == userId
    && isValidInvoiceUpdate();
  allow delete: if false;
}
```

Validation requirements:

- `amount` fields must be numbers.
- `currency` must be `"IDR"`.
- `status` must be one of:
  - `draft`
  - `open`
  - `paid`
  - `void`
  - `overdue`
- `customer_name` must be string.
- `customer_email` must be string or null.
- `line_items` must be list.
- `subtotal`, `tax_amount`, `total_amount`, `amount_paid`, `amount_due` must be numbers.
- `created_by` and `updated_by` must equal `request.auth.uid` where applicable.
- Delete must be blocked.
- Void instead of delete.

---

## 13. Audit Logging

Write audit logs under:

```text
users/{userId}/audit_logs/{auditLogId}
```

Required actions:

| Action | When |
|---|---|
| `invoice.create_draft` | Draft invoice created |
| `invoice.update_draft` | Draft invoice updated |
| `invoice.finalize` | Invoice moved from draft to open |
| `invoice.mark_paid` | User confirms payment received |
| `invoice.void` | User voids invoice |
| `invoice.update_open` | Open invoice metadata changed |

Audit log requirements:

- Use `target_collection: "invoices"`.
- Include `target_id`.
- Include `before` and `after` for sensitive updates.
- Include `reason` for void.
- Use `source: "dashboard"`.
- Use server timestamp.

If `audit_logs` rule allowlist restricts `target_collection`, extend it to include `"invoices"`.

---

## 14. DataService API

Add methods to `assets/js/db-service.js`.

```js
async getInvoices(userId, limitCount = 100)
async getInvoice(userId, invoiceId)
async createInvoiceDraft(userId, invoiceData)
async updateInvoice(userId, invoiceId, invoiceData)
async finalizeInvoice(userId, invoiceId)
async voidInvoice(userId, invoiceId, reason)
async markInvoicePaid(userId, invoiceId, paymentData)
async generateInvoiceNumber(userId)
```

### Method behavior

#### `getInvoices`

- Query `users/{uid}/invoices`
- Order by `created_at` or `issue_date` descending
- Limit 100
- Return normalized objects

#### `createInvoiceDraft`

- Validate data
- Calculate totals
- Write invoice with `status: "draft"`
- Write audit log `invoice.create_draft`

#### `updateInvoice`

- Fetch current invoice first
- Recalculate totals
- Prevent editing `paid` or `void` invoices except allowed metadata if explicitly needed
- Write audit log

#### `finalizeInvoice`

- Fetch invoice
- Validate:
  - customer name
  - customer email
  - issue date
  - due date
  - at least one line item
  - total > 0
- Change status to `open`
- Set `finalized_at`
- Write audit log
- Do not create transaction

#### `voidInvoice`

- Require reason
- Change status to `void`
- Set `voided_at`
- Write audit log
- Do not delete

#### `markInvoicePaid`

- Require explicit confirmation from UI
- Ask whether to create linked ledger transaction
- If creating transaction:
  - Write transaction under `users/{uid}/transactions`
  - Type: `income`
  - Category: `Revenue`
  - Amount: invoice total or received amount
  - Vendor/customer: customer name
  - Status: `Completed`
  - Link `linked_transaction_id` on invoice
- Use Firestore batch for invoice update + transaction create + audit log where possible.
- Never auto-mark paid.

---

## 15. Page Structure

### File

```text
invoices.html
```

### Layout

Use the authenticated app shell:

- `#sidebar`
- shared dashboard CSS
- shared sidebar loader
- shared dashboard JS
- auth guard
- page-specific `assets/js/invoices.js`

Do not load footer.

### Header

Top area:

- Page title: `Invoices`
- Subtitle: `Create and track customer invoices, receivables, and payment status.`
- Primary CTA: `Create invoice`
- Secondary action: `Export CSV` if invoice records exist

### Summary cards

Show compact cards:

1. **Open invoices**
   - Count and total amount due
2. **Overdue**
   - Count and amount
3. **Paid this month**
   - Count and amount
4. **Drafts**
   - Count

Use real data only. If no data, show `Rp0` and count `0`.

### Table columns

| Column | Notes |
|---|---|
| Invoice | invoice number + customer |
| Status | Draft/Open/Paid/Overdue/Void badge |
| Issue date | formatted date |
| Due date | formatted date |
| Amount due | Rp format |
| Total | Rp format |
| Actions | View/Edit/Finalize/Mark paid/Void based on status |

### Empty state

Title:

```text
Create your first invoice
```

Description:

```text
Bill a customer, preview the invoice, and track whether the payment is still open, overdue, or paid.
```

CTA:

```text
Create invoice
```

---

## 16. Invoice Editor Experience

### Route options

Preferred MVP:

```text
/invoices?create=1
/invoices?edit={invoiceId}
```

Use a full-page editor state inside `invoices.html` instead of creating too many separate HTML files.

Alternative if simpler:

```text
invoice-editor.html
```

But only do this if the existing routing style makes full-page state hard.

### Layout benchmark from Stripe

Use this structure:

```text
Sticky topbar
- Close/back
- Create invoice / Edit invoice title
- Draft saved state
- Hide preview
- Review invoice

Main split layout
- Left editor column
- Right preview column
```

### FluxyOS adjustment

Use FluxyOS colors and components:

- No Stripe purple primary button
- Primary action should use FluxyOS app button pattern
- Active sidebar item stays orange accent
- Cards use white, gray borders, rounded-xl
- Monetary values use Fira Code
- App typography must follow dashboard scale

### Left editor sections

1. Customer
2. Currency
3. Items
4. Payment collection
5. Additional options

Each section should be visually separated but not over-carded.

#### Customer section

Default compact state:

- If no customer:
  - Show input row/button: `Add customer`
- On click:
  - Inline form expands:
    - Name
    - Email
    - Company name optional
    - Language disabled or hidden in MVP
  - Buttons:
    - Cancel
    - Save customer

After saved:

```text
Customer
Jay
jay@gmail.com
Company name if available
Edit
```

#### Currency section

MVP:

- Show locked select:
  - `IDR - Indonesian Rupiah`
- Helper:
  - `Invoices are issued in Indonesian Rupiah for this version.`
- Do not allow changing currency yet.

#### Items section

Behavior:

- Input/select pattern:
  - `Add an item`
  - `Add a new line item`
- Inline item editor:
  - Item/description
  - Quantity
  - Price
  - Unit label optional
  - Add item button
  - Save and add another
- After save:
  - Show item row:
    - Description
    - Qty
    - Unit price
    - Amount
    - Edit/remove actions

Validation:

- Description required
- Quantity > 0
- Unit price > 0
- Total recalculates live
- Remove item requires confirmation if invoice is already open

#### Payment collection

MVP options:

- Request payment
  - selected by default
- Autopay customer
  - hide or disabled with `Coming later`

Due terms:

- Due on receipt
- Due in 7 days
- Due in 14 days
- Due in 30 days
- Custom date

Do not show card/link payment method chips unless payment provider exists.

Use copy:

```text
FluxyOS will track this as an open receivable after the invoice is finalized.
```

#### Additional options

MVP fields:

- Memo
- Footer note
- Tax ID
- Tax percentage optional

Do not implement:

- Template selector
- Product catalog
- Coupon
- Payment page branding
- Automated reminders

---

## 17. Live Preview

Right side shows a live invoice document preview.

### Desktop

- Sticky preview area
- Tabs:
  - Invoice preview
  - Email preview disabled
  - Payment page disabled
- The disabled tabs should have clear `Coming later` tooltip/copy.

### Mobile

- Preview hidden by default
- Button: `Show preview`
- Opens preview as bottom sheet or full-width section below form
- Must not cause horizontal scroll

### Preview content

Use a clean invoice document:

```text
Invoice

Invoice number: INV-2026-0001
Issue date: Jun 11, 2026
Due date: Jul 11, 2026

From:
{business name from settings/company or FluxyOS workspace fallback}

Bill to:
{customer name}
{customer email}

Rp1.000.000 due Jul 11, 2026

Table:
Description | Qty | Unit price | Amount

Subtotal
Tax
Total
Amount due

Memo
Footer note
```

### Branding fallback

Use business name from:

```text
users/{uid}/settings/company.business_name
```

Fallback:

```text
Your business
```

Do not use `Jay sandbox` or Stripe-like copy.

---

## 18. Review Modal

When the user clicks `Review invoice`, open a modal similar to the Stripe benchmark but adapted to FluxyOS.

### Modal title

```text
Review Rp1.000.000 invoice for Jay
```

### Options

Primary choice:

- `Finalize invoice`

Optional secondary:

- `Save as draft`

Do not include `Finalize and send` as the primary action unless email sending exists.

Recommended MVP labels:

- Primary: `Finalize invoice`
- Secondary: `Save draft`
- Cancel: `Cancel`

### Modal content

Left panel:

- Customer email
- Due date
- Amount
- Payment collection method
- Checkbox:
  - `Track as open receivable after finalizing`
  - checked and disabled for MVP
- Warning:
  - `This will not create a completed ledger transaction until you mark the invoice as paid.`

Right panel:

- Invoice preview

### Confirmation behavior

On `Finalize invoice`:

- Validate required fields
- Save/update invoice
- Set status to `open`
- Write audit log
- Close modal
- Show success toast:
  - `Invoice finalized and added to receivables.`
- Return to invoice detail view

---

## 19. Invoice Detail View

After finalize or when clicking table row, show invoice detail.

MVP can be a detail drawer or a detail page.

Recommended:

```text
/invoices?invoice={invoiceId}
```

Render detail state inside same page.

### Detail layout

Header:

- Back to invoices
- Invoice number
- Status badge
- Amount due
- Customer name
- Actions:
  - Edit invoice
  - Mark as paid
  - Void invoice
  - Download preview disabled or browser print only if easy
  - Copy invoice summary

Main:

- Recent activity
- Summary
- Customer
- Line items
- Payment status
- Metadata/audit summary

### Status actions

#### Draft

Allowed:

- Edit
- Finalize
- Void

#### Open

Allowed:

- Edit limited metadata
- Mark as paid
- Void
- Copy invoice summary

#### Paid

Allowed:

- View
- Copy summary
- Link to ledger transaction if created

Blocked:

- Edit amount
- Void unless future correction workflow exists

#### Void

Allowed:

- View only

---

## 20. Status Logic

### Status values

```js
draft
open
paid
void
overdue
```

### Overdue display logic

Do not permanently mutate to `overdue` unless page load or backend process updates it.

MVP approach:

- Stored status remains `open`
- UI displays `Overdue` when:
  - `status === "open"`
  - `due_date < today`
  - `amount_due > 0`

Optional later:

- Scheduled backend job updates status to `overdue`

### Amount due

```js
amount_due = Math.max(total_amount - amount_paid, 0)
```

If `amount_due === 0` and status is open, user should be asked whether to mark paid.

---

## 21. CSV Export

Add simple invoice CSV export from the invoice list.

Columns:

```text
invoice_number,status,customer_name,customer_email,issue_date,due_date,currency,subtotal,tax_amount,total_amount,amount_paid,amount_due
```

Rules:

- Amounts raw integer in CSV.
- No `Rp` prefix.
- No dot separators.
- Export button disabled when no invoices.
- Write `export.create` audit log if following reports export behavior, or document as future if not implemented in MVP.

---

## 22. AI Integration Rules

Do not make Fluxy AI create invoices automatically in this MVP.

Allowed future AI behavior:

- Explain unpaid invoices.
- Summarize overdue receivables.
- Draft an invoice payload for review.
- Suggest line items from project context.

Never allowed:

- Send invoice without confirmation.
- Mark invoice paid without confirmation.
- Create ledger transaction without confirmation.
- Invent invoice totals.

Future AI write flow must follow:

```text
Detect intent → Draft invoice → Show review → User confirms → Save
```

---

## 23. UI Design Requirements

### Must follow FluxyOS dashboard design

- Sidebar: centralized `sidebar-loader.js`
- App background: gray-50
- Cards: white, gray-200 border, rounded-xl
- Primary action: follow current app primary button style
- Orange only for accent/active state, not page backgrounds
- Money values: Fira Code
- App type scale only:
  - 10 / 12 / 14 / 16 / 20 / 24 px
- No custom Stripe purple UI
- No giant decorative gradients
- No unrelated animation

### Required responsive behavior

Desktop:

- Invoice editor uses split view:
  - Left editor: about 50%
  - Right preview: about 50%
- Preview sticky while form scrolls

Tablet:

- Split can remain if enough width, otherwise preview collapses below

Mobile:

- Single-column editor
- Preview hidden behind `Show preview`
- Sticky bottom action bar:
  - Save draft
  - Review invoice
- No horizontal scroll

---

## 24. Functional Requirements

### Invoice list

- Load invoices after auth.
- Show loading shimmer.
- Show empty state when none.
- Show table when records exist.
- Search by invoice number, customer name, email, status.
- Filter by status:
  - All
  - Draft
  - Open
  - Overdue
  - Paid
  - Void
- Sort newest first.

### Create/edit flow

- User can start invoice from Create invoice.
- User can save draft with partial data.
- User cannot finalize until required fields are valid.
- Draft state should autosave only if safe to implement. If not, use explicit Save Draft.
- Show unsaved change warning before leaving editor.
- Review modal appears before finalize.
- Finalize does not create transaction.
- Mark paid requires confirmation.
- Void requires reason.

### Totals

- Recalculate on every item/tax change.
- Always store raw integer amounts.
- Always display Rp format in UI.
- Never show NaN or Infinity.

### Toasts

Use `window.showToast`.

Suggested messages:

- Draft saved:
  - `Invoice draft saved.`
- Finalized:
  - `Invoice finalized and added to receivables.`
- Updated:
  - `Invoice updated.`
- Paid:
  - `Invoice marked as paid.`
- Voided:
  - `Invoice voided.`
- Error:
  - `Could not save invoice. Check your connection and try again.`

---

## 25. Validation Rules

### Draft save

Allow partial invoice, but validate type safety:

- Customer can be empty.
- Line items can be empty.
- Amounts must be valid numbers if present.
- Currency always IDR.
- Status draft.

### Finalize

Required:

- Customer name
- Customer email
- Due date
- At least one line item
- Each line item has description
- Quantity > 0
- Unit price > 0
- Total amount > 0

### Mark paid

Required:

- Invoice status open or overdue display state
- Payment date
- Amount received > 0
- Amount received <= amount due unless overpayment support is implemented
- Explicit confirmation
- Optional linked transaction confirmation

### Void

Required:

- Reason
- Confirmation dialog
- Status not paid

---

## 26. Recommended UI Copy

### Page subtitle

```text
Create invoices, track open receivables, and keep revenue collection visible.
```

### Empty state description

```text
Start by creating an invoice for a customer. Finalized invoices appear as open receivables until you confirm payment.
```

### Payment collection helper

```text
FluxyOS tracks the invoice as an open receivable. It will not create revenue in your ledger until payment is confirmed.
```

### Review modal warning

```text
Finalizing this invoice makes it visible as an open receivable. It does not mark the invoice as paid or create a completed ledger transaction.
```

### Mark paid confirmation

```text
Confirm that payment was received. FluxyOS can also create a linked income transaction in your ledger.
```

---

## 27. Implementation Steps

### Step 1 — Read project docs

Before coding, read:

```text
docs/PROJECT_BACKGROUND.md
docs/product_ux_feature_intake_framework.md
docs/DESIGN_SYSTEM.md
docs/SECURITY_SYSTEM.md
docs/QA_CHECKLIST.md
docs/SYSTEM_DESIGN.md
```

### Step 2 — Add docs first

Update:

```text
docs/PROJECT_BACKGROUND.md
docs/ROADMAP.md
docs/QA_CHECKLIST.md
```

Add:

- Invoice collection schema
- Invoice page responsibility
- DataService methods
- QA checklist section for invoices
- Roadmap row: `Invoices` as MVP shipped after implementation

### Step 3 — Add Firestore rules

Update:

```text
firestore.rules
```

Add:

- invoices collection rule
- validation helpers
- audit log allowlist update for `target_collection: "invoices"`

### Step 4 — Add DataService methods

Update:

```text
assets/js/db-service.js
```

Add:

- invoice CRUD methods
- calculation helpers
- invoice number generator
- audit log writes

### Step 5 — Add sidebar entry

Update:

```text
assets/js/sidebar-loader.js
```

Under Operations:

```text
Budgets
Invoices
Approvals
```

Make Invoices a real link:

```text
/invoices
```

Active state must highlight on `/invoices`.

### Step 6 — Create page

Create:

```text
invoices.html
assets/js/invoices.js
```

Use existing app page structure.

### Step 7 — Build invoice list

Implement:

- auth guard
- sidebar
- loading
- summary cards
- table
- empty state
- search/filter
- export CSV if included

### Step 8 — Build editor state

Implement:

- create mode
- edit draft mode
- left form
- right preview
- draft save
- validation
- unsaved warning

### Step 9 — Build review modal

Use shared dialog/modal style. Do not use native `alert()` or `confirm()`.

Implement:

- review content
- validation errors
- finalize action
- success state

### Step 10 — Build detail state

Implement:

- invoice detail view/drawer
- status actions
- mark paid confirmation
- void confirmation with reason

### Step 11 — QA

Run the checklist below.

---

## 28. QA Checklist For Invoices

Add this to `docs/QA_CHECKLIST.md` as a new section.

### Invoice Page QA

| # | Check |
|---|---|
| 1 | Opening `/invoices` while signed out redirects to `/login` within 2s |
| 2 | After sign-in, `/invoices` renders with shared sidebar and no marketing footer |
| 3 | Sidebar Operations group shows Invoices directly under Budgets |
| 4 | Sidebar Invoices active state uses orange accent and does not affect Budgets active state |
| 5 | Empty account shows invoice empty state and Create invoice CTA |
| 6 | Create invoice opens full editor state with left form and right preview on desktop |
| 7 | Mobile 375px shows single-column editor and hides preview behind Show preview |
| 8 | Currency is locked to IDR |
| 9 | Adding a line item recalculates subtotal, total, and amount due live |
| 10 | Unit price stores as raw integer, not formatted string |
| 11 | Save draft works with partial data and writes only under `users/{uid}/invoices` |
| 12 | Finalize is blocked until customer, due date, at least one valid item, and total > 0 exist |
| 13 | Review modal appears before finalize |
| 14 | Finalizing writes status `open`, sets `finalized_at`, and writes audit log `invoice.finalize` |
| 15 | Finalizing does not create a transaction |
| 16 | Open invoice appears in invoice table with correct status and amount due |
| 17 | Overdue invoice displays Overdue when due date is past and amount due > 0 |
| 18 | Mark paid requires explicit confirmation |
| 19 | Mark paid can create a linked income transaction only after explicit user confirmation |
| 20 | Void requires a reason and writes audit log `invoice.void` |
| 21 | Delete is not available in UI and blocked by Firestore rules |
| 22 | Invoice search filters by number, customer, email, and status |
| 23 | Invoice CSV export contains raw integer amounts only |
| 24 | No invoice data appears for another authenticated user |
| 25 | Browser console is clean: no Firebase permission, CSP, CORS, or 404 errors |
| 26 | Existing pages still load: Dashboard, Ledger, Bills, Subscriptions, Budgets, Reports, Settings |
| 27 | Existing Add Transaction, Add Bill, Add Subscription flows still work |

---

## 29. Regression Guardrails

Do not change:

- Existing transaction schema except optional `linked_invoice_id` if needed for paid invoice linking.
- Existing bills behavior.
- Existing budget behavior.
- Existing reports behavior unless adding invoice receivable support intentionally.
- Existing Add Transaction drawer behavior.
- Existing Add Bill drawer budget impact preview.
- Existing sidebar layout beyond adding Invoices.
- Existing auth guard pattern.
- Existing landing pages.

Do not:

- Add React, npm, bundler, or framework migration.
- Store invoice data globally.
- Store formatted currency strings.
- Use Stripe API in MVP.
- Create real payment links.
- Claim payment has been collected.
- Auto-create ledger revenue before payment confirmation.
- Use native `alert()` or `confirm()`.
- Use orange as a page background.

---

## 30. Future Phase Recommendations

### Phase 2 — Receivables integration

- Include open invoices in cash pressure.
- Add dashboard receivables card.
- Add invoice records to Fluxy AI finance Q&A.
- Add customer-level receivable summary.

### Phase 3 — PDF and email

- Generate PDF from backend.
- Send invoice email via backend.
- Add email preview.
- Add reminder schedule.

### Phase 4 — Payment provider

- Connect Stripe/Xendit/Midtrans.
- Create real hosted payment page.
- Webhook payment status updates.
- Auto-suggest ledger transaction on payment success, still with audit trail.

### Phase 5 — AI invoice assistant

- Draft invoice from chat.
- Extract invoice from contract/order.
- Suggest line items.
- Create only after review and confirmation.

---

## 31. Final Expected Result

After implementation, FluxyOS should have:

1. A working **Invoices** page under Operations below Budgets.
2. A Stripe-inspired but FluxyOS-native invoice creation workflow.
3. A live invoice preview.
4. Save draft and finalize flows.
5. Review-before-finalize confirmation.
6. User-scoped Firestore invoice records.
7. Audit logs for sensitive actions.
8. No automatic ledger transaction unless user confirms payment received.
9. Responsive desktop/mobile experience.
10. No regression to existing dashboard, budget, bill, transaction, subscription, and report flows.
