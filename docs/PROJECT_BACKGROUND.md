# FluxyOS — Project Background Reference

> Read this before implementing any new feature, page, or logic change.
> This is the single source of truth for architecture, data schema, logic rules, and conventions.
> For extension contracts and module ownership, also read `SYSTEM_DESIGN.md`.
> For dashboard roles, permissions, audit logs, and sensitive action rules, read
> `SECURITY_SYSTEM.md`.

---

## 1. What FluxyOS Is

FluxyOS is a **financial operations platform** for Indonesian businesses. It consolidates multi-entity ledgers, vendor spending, and live revenue feeds into one unified dashboard.

**Target user:** Finance teams managing multiple business entities (e.g. e-commerce brands, agencies).

**Key capabilities:**
- Live transaction ledger (revenue + expenses)
- Bills & payment scheduling
- SaaS subscription tracking
- AI-powered financial analyst chat
- Dashboard KPIs: Revenue, OpEx, Gross Margin, Action Items

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
| Ledger | `ledger.html` | App | ✅ | **No** | ✅ |
| Revenue Sync | `revenue-sync.html` | App | ✅ | **No** | ✅ |
| Bills | `bill.html` | App | ✅ | **No** | ✅ |
| Subscriptions | `subscription.html` | App | ✅ | **No** | ✅ |
| Budgets | `budget.html` | App | ✅ | **No** | ✅ |
| Invoices | `invoices.html` | App | ✅ | **No** | ✅ |
| Accounting Center | `accounting.html` | App | ✅ | **No** | ✅ |
| Accounting Records | `accounting-records.html` | App | ✅ | **No** | ✅ |
| Reports & Exports | `reports.html` | App | ✅ | **No** | ✅ |
| Balance Sheet | `balance-sheet.html` | App | ✅ | **No** | ✅ |
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
without a documented exception (`balance-sheet.html` is the one exception). Full
rule in [DESIGN_SYSTEM.md → Dashboard Content Width Standard](DESIGN_SYSTEM.md).

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
>    `chart_of_accounts`, `journals`, `counters`, `ledger_balances`, `periods`, and
>    **(planned — Tax Center, §4o)** `company_tax_profile`, `tax_mappings`,
>    `tax_transactions`, `tax_periods`, `tax_filings`.
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
> 5. **Watch out for inline page queries.** Some pages build Firestore queries
>    directly in the HTML (`collection(ds.db, …)`) instead of calling a
>    DataService method — these bypass the seam and are the easiest place to
>    reintroduce the bug. Grep guard:
>    `grep -rnE 'users/\$\{[a-zA-Z_.]+\}/(transactions|bills|subscriptions|budgets|budget_allocations|invoices|bank_accounts|bank_balance_snapshots|bank_statement_imports|documents|report_exports|accounting_mappings|audit_logs|company_tax_profile|tax_mappings|tax_transactions|tax_periods|tax_filings)' *.html assets/js/*.js | grep -v db-service.js`
>    must return nothing.

### 4a. Transactions — `users/{userId}/transactions`

| Field | Type | Values / Notes |
|-------|------|----------------|
| `amount` | number | Raw integer (e.g. `1234567`). Never stored with dots. Always positive for revenue, positive for expense (type determines sign in display) |
| `vendor_name` | string | Free text (e.g. `"AWS"`, `"Client Payment"`) |
| `category` | string | One of the built-in labels — `"Revenue"`, `"Marketing"`, `"Infrastructure"`, `"Operations"`, `"SaaS"`, `"Others"` — or any free-text label up to 40 chars when the user picks "Others" and types their own (e.g., `"Event"`). |
| `type` | string | Transaction type. Built-in values: `"income"`, `"expense"`, `"transfer"`, `"refund"`, `"adjustment"`, `"fee"`, `"tax"`, `"pending_receivable"`, `"pending_payable"`. Legacy `"revenue"` is still accepted as income. The Add Transaction modal also exposes an "Others" option that stores the user's free-text label (up to 40 chars) — the ledger renders it as-is and treats it as neutral for sign/colour. |
| `status` | string | `"Completed"` \| `"Missing Receipt"` |
| `icon` | string | `"💰"` for positive-side transaction types, `"💸"` for spend-side transaction types |
| `timestamp` | Firestore Timestamp | Defaults to `serverTimestamp()`, but dashboard entry drawer and CSV import may set an explicit selected transaction date for today or a previous day |
| `budget_id` | string \| null | Optional. Phase 2. References the active `budgets/{id}` at assignment time. |
| `budget_allocation_id` | string \| null | Optional. Phase 2. References `budget_allocations/{id}`. Null when excluded or unmatched. |
| `budget_match_method` | string \| null | Optional. Phase 2. `"auto"` \| `"manual"` \| `"rule"` \| `"excluded"` \| `"none"`. |
| `budget_match_status` | string \| null | Optional. Phase 2. `"matched"` \| `"needs_review"` \| `"unmatched"` \| `"excluded"`. |
| `budget_match_confidence` | number \| null | Optional. Phase 2. 0–1, reserved for future rule/AI matching. |
| `budget_assignment_reason` | string \| null | Optional. Phase 2. ≤500 chars. Required by UI for manual/exclude/restore writes. |
| `budget_assignment_updated_at` | Timestamp \| null | Optional. Phase 2. Server-set on each assignment write. |
| `budget_assignment_updated_by` | string \| null | Optional. Phase 2. Pinned by Firestore rule to `request.auth.uid`. |
| `budget_exclusion_reason` | string \| null | Optional. Phase 2. ≤500 chars. |
| `cash_effective` | boolean \| null | Optional. Phase 1 cash impact. `true` when money has already moved, `false` when pending/neutral. |
| `cash_status` | string \| null | Optional. Phase 1 cash impact. `"actual"` \| `"pending"` \| `"none"`. |
| `cash_direction` | string \| null | Optional. Phase 1 cash impact. `"in"` \| `"out"` \| `"none"`. |
| `cash_account_id` | string \| null | Optional. Phase 1 cash impact. Reserved for future bank account linkage; always `null` in Phase 1. |
| `cash_source` | string \| null | Optional. Phase 1 cash impact. `"manual"` for user-entered transactions. |
| `cash_match_status` | string \| null | Optional. Phase 1 cash impact. `"manual"` \| `"unmatched"` \| `null`. |
| `cash_effective_at` | Firestore Timestamp \| null | Optional. Phase 1 cash impact. Equals `timestamp` when `cash_effective` is `true`; `null` otherwise. |
| `cash_assignment_reason` | string \| null | Optional. Phase 2. ≤500 chars. Reason recorded when user manually updates cash-impact fields from Ledger. |
| `cash_assignment_updated_at` | Timestamp \| null | Optional. Phase 2. Server-set on each cash-impact assignment write. |
| `cash_assignment_updated_by` | string \| null | Optional. Phase 2. Set to `request.auth.uid` on each cash-impact write. |

All 9 budget fields, all 7 Phase 1 cash-impact fields, and all 3 Phase 2 cash-assignment audit fields are optional. Legacy transactions without them keep
working — `DataService.resolveRecordAssignment` falls back to category match.

**Creation-time allocation picker.** The three record-transaction entry points —
the Add Transaction drawer, the CSV bulk "apply allocation to all rows" control,
and the AI receipt-capture review — now let the user pin an expense to a specific
allocation *at create time* via the shared `window.FluxyBudgetPicker` helper
(`assets/js/shared-dashboard.js`). Shown only for expense-like types
(`expense`/`fee`/`tax`/`pending_payable`) when an active budget covers the
selected date. Picking an allocation writes `budget_id`, `budget_allocation_id`,
`budget_match_method: 'manual'`, `budget_match_status: 'matched'`,
`budget_match_confidence: 1` (no audit log on create, mirroring the Add Bill
drawer). "Auto-match by category" writes nothing (preserves the fallback);
"Don't track against budget" writes `budget_match_method/status: 'excluded'`.
The transaction create rule already allows these keys — no rules change.

**Cash impact at creation.** The Add Transaction drawer and the Ledger
transaction editor share one cash-impact control (`window.FluxyCashImpact`):
Actual / Pending / No-impact + direction (in/out) + optional bank-account link.
So `cash_direction` and `cash_account_id` are now user-chosen at creation
(previously direction was inferred from type and the account was always null).
`pending_payable`/`pending_receivable` stay forced-pending and `transfer` stays
neutral (control hidden, helper note shown).

**Ordering:** `timestamp DESC` (newest first). Default limit: 50. Dashboard preview: 5.

### 4b. Bills — `users/{userId}/bills`

Same fields as transactions plus:

| Field | Type | Notes |
|-------|------|-------|
| `due_date` | Firestore Timestamp | Optional. Displayed via `.toDate().toLocaleDateString()`. Falls back to `"Next week"` if missing |
| `category` | string | Defaults to `"Operations"` when created via modal |
| `budget_id` | string \| null | Optional. Phase 1.5. Set by Add Bill drawer when an active budget exists. References `budgets/{id}`. |
| `budget_allocation_id` | string \| null | Optional. Phase 1.5. Set when the bill auto-matches a `budget_allocations/{id}` doc by category. Null when no allocation matched. |
| `budget_match_method` | string \| null | Optional. `"auto"`, `"manual"`, or `"none"`. |
| `budget_match_status` | string \| null | Optional. `"matched"`, `"needs_review"`, or `"unmatched"`. |
| `budget_impact_status` | string \| null | Optional. `"committed"`, `"released"`, or `"converted_to_actual"`. Drives the Budget page's committed-amount calculation; bills with `converted_to_actual` are excluded from committed totals. Exclusion flips this to `"released"`. |
| `budget_assignment_reason` | string \| null | Optional. Phase 2. ≤500 chars. Required for manual reassignment / restore writes. |
| `budget_assignment_updated_at` | Timestamp \| null | Optional. Phase 2. Server-set on each assignment write. |
| `budget_assignment_updated_by` | string \| null | Optional. Phase 2. Pinned by Firestore rule to `request.auth.uid`. |
| `budget_exclusion_reason` | string \| null | Optional. Phase 2. ≤500 chars. |

Enum extension (Phase 2): `budget_match_method` also accepts `"rule"` and
`"excluded"`; `budget_match_status` also accepts `"excluded"`.

All bill budget fields are optional and absent on legacy bills. The Add Bill
drawer omits the fields entirely when no active budget exists for the period,
preserving the legacy bill schema.

**Phase 2 budget assignment priority** (used by `DataService.resolveRecordAssignment`
for both transactions and bills, applied in `getBudgetUsage`):

1. `record.budget_match_status === 'excluded'` → record drops out of totals entirely.
2. `record.budget_allocation_id` set and the allocation is still active → counts against that allocation (source `'manual'` or `'explicit'`).
3. Category match — first active allocation whose `scope_values` contains `record.category` → counts against that allocation (source `'category'`).
4. Otherwise → unallocated bucket.

**Audit actions** (Phase 2, written to `users/{uid}/audit_logs`):
`budget_assignment.update`, `budget_assignment.exclude`,
`budget_assignment.restore`. Each manual write commits the record update +
the audit log in a single Firestore `writeBatch` so they succeed or fail
together. `after.budget_id` is set so the budget activity timeline can
filter logs to the current budget without a composite index.

**Double-counting guard**: a bill with `budget_impact_status ===
'converted_to_actual'` OR with `linked_transaction_id` set is skipped by the
committed-amount calculation.

**Mark as paid → Ledger (`DataService.markBillPaid`).** The Bills page
Record-Payment modal (Mark as Paid in the bill drawer) calls
`markBillPaid(uid, billId, { paymentDate, cashFields })`, which mirrors
`markInvoicePaid`: in a single `writeBatch` it (a) creates one expense ledger
transaction (`type: 'expense'`, the bill's `amount`/`vendor_name`/`category`,
`timestamp` = payment date, `linked_bill_id` = the bill, plus the bill's
carried-over budget assignment and the chosen `cash_*` fields), (b) updates the
bill (`payment_status: 'paid'`, `budget_impact_status: 'converted_to_actual'`,
`linked_transaction_id`, `updated_at`/`updated_by`), and (c) writes the
`bill.mark_paid` audit log (`target_collection: 'bills'`). The bill then drops
out of *committed* totals and the new expense lands in *actual_used* on the same
allocation — committed → actual, no double count. **Category and budget are
inherited from the bill — the user does not re-select them.** **Paid is
terminal** (no un-pay path), matching invoices. Cash defaults to actual cash-out;
the modal lets the user set the payment date, the paying bank account, and
actual/pending via the shared `FluxyCashImpact` control. The transaction create
rule allows the new `linked_bill_id` key; the bill update rule allows
`linked_transaction_id` + `updated_at`/`updated_by`.

**Ordering:** `timestamp DESC`.

### 4c. Subscriptions — `users/{userId}/subscriptions`

Same fields as transactions plus:

| Field | Type | Notes |
|-------|------|-------|
| `renewal_date` | Firestore Timestamp | Optional. Falls back to `"Next month"` if missing |
| `category` | string | Defaults to `"SaaS"` when created via modal |

**Ordering:** `timestamp DESC`.

### 4d. Audit Logs — `users/{userId}/audit_logs`

Append-only records for sensitive dashboard actions. Add audit logs before
shipping edit/delete, approvals, exports, integrations, or AI write actions.

| Field | Type | Notes |
|-------|------|-------|
| `actor_uid` | string | Firebase Auth UID of the user who performed the action |
| `actor_role` | string \| null | Future role at time of action; currently nullable |
| `action` | string | Example: `"transaction.create"` or `"bill.approve"` |
| `target_collection` | string | Collection affected, e.g. `"transactions"` |
| `target_id` | string | Document ID affected; empty string allowed before target exists |
| `before` | map \| null | Sensitive snapshot before change |
| `after` | map \| null | Sensitive snapshot after change |
| `reason` | string \| null | Required by future UI for delete/reject/override flows |
| `source` | string | `"dashboard"` \| `"ai"` \| `"integration"` \| `"system"` |
| `created_at` | Firestore Timestamp | `serverTimestamp()` — always server-side |

**Ordering:** `created_at DESC`. Default limit: 100.
**Mutation rule:** create/read only for the owning user; never update/delete.

### 4e. Settings — `users/{userId}/settings/{settingsDoc}`

Settings are user-scoped workspace preferences. They must never store secrets,
tokens, OTPs, card data, bank credentials, or formatted currency strings.

| Document | Fields |
|----------|--------|
| `company` | `business_name`, `business_type`, `country`, `entity_label`, `updated_at` |
| `finance` | `currency` (`"IDR"`), `locale` (`"id-ID"`), `timezone`, `date_format`, `categories`, `updated_at` |
| `import_rules` | `csv_date_behavior`, `unknown_document_route`, `bill_scan_behavior`, `receipt_scan_behavior`, `payment_screenshot_behavior`, `require_confirmation_before_save`, `updated_at` |
| `ai` | `answer_style`, `default_analysis_period`, `show_data_quality_warnings`, `allow_ai_suggestions`, `allow_ai_draft_actions`, `require_confirmation_before_save`, `updated_at` |
| `whatsapp` | `status`, `phone_number`, `business_display_name`, `last_sync_at`, `last_verified_at`, `provider`, `updated_at` |
| `reports` | `arr_source` (`"none"` or `"tagged_income_categories"`), `recurring_revenue_category_ids` (string[] up to 32), `updated_at`. Drives Estimated ARR in Reports & Exports; without tagged categories ARR stays `unavailable`. |
| `email_preferences` | `weekly_digest_enabled` (bool, default true), `delivery_day` (`monday`…`sunday`, default `monday`), `delivery_hour` (int 0–23, default 9), `timezone` (string, user-local with `Asia/Jakarta` fallback), `metrics` (map of 8 bools: `financial_health`, `cash_position`, `bills`, `budgets`, `revenue`, `expenses`, `subscriptions`, `vendors`), `updated_at`. Drives the **Weekly Financial Digest** (`netlify/functions/weekly-digest.js`). AI Insights + Recommended Actions are always-on and not stored as toggles. A missing doc is treated as enabled-with-defaults. |

**Mutation rule:** owner read/create/update only through `DataService`; delete is
blocked. WhatsApp status is configuration metadata only. Real WhatsApp API
tokens must not be stored in Firestore.

**UI surface:** Settings expose this schema through an index page
(`settings.html`) and 9 focused detail pages: `settings-personal.html`,
`settings-business.html`, `settings-finance.html`, `settings-import-rules.html`,
`settings-ai.html`, `settings-whatsapp.html`, `settings-security.html`,
`settings-cash.html` (Cash & Bank Accounts), and `settings-budget.html`
(Budget Settings). Each detail page reads its slice via
`DataService.getUserSettings(uid)` and saves through the matching
`save*Settings` method (or, for the Finance Setup pages, the bank/budget
DataService methods documented in §4e.1–4e.3). `settings-personal.html` and
`settings-security.html` are display-only (Firebase Auth profile + posture
summary); they do not write to Firestore. `settings-notifications.html`
(Notifications & email) reads/writes `email_preferences` via
`DataService.saveEmailPreferences` and configures the Weekly Financial Digest.

**Weekly Financial Digest:** a per-user AI-narrated weekly summary email,
delivered by the Netlify scheduled function `weekly-digest.js` (hourly scan,
per-user delivery day/hour/timezone, ISO-week idempotency via `mail_log`). It
reuses the deterministic finance engine + AI narrator from
`netlify/functions/api.js` (`exports.digest`) — every number is computed there,
OpenAI only narrates — and the shared email pipeline. Audit actions
`weekly_digest.generated` / `.sent` / `.failed` are written server-side. Gated
by a default-off `DIGEST_ENABLED` env. Spec: `netlify/functions/NOTIFICATIONS.md`.

### 4e.1. Bank Accounts — `users/{userId}/bank_accounts/{bankAccountId}`

Manual (and future synced) bank accounts that power Bank Cash Balance and
Cash Pressure. User-scoped. Soft-archive only — `delete` is blocked.

| Field | Type | Notes |
|-------|------|-------|
| `account_name` | string | User-chosen nickname (≤120 chars). |
| `bank_name` | string | Free text (e.g., `"BCA"`). |
| `bank_code` | string \| null | Optional bank identifier. |
| `currency` | string | Locked to `"IDR"`. |
| `last_four` | string \| null | Last four digits of account number. |
| `source_type` | string | `"manual"`, `"statement_upload"`, or `"auto_sync"` (Phase 1 only writes `"manual"`). |
| `provider` | string \| null | Reserved for future auto-sync. |
| `provider_account_id` | string \| null | Reserved for future auto-sync. |
| `status` | string | `"active"` or `"archived"`. |
| `latest_balance` | number | Raw integer Rupiah. |
| `latest_balance_at` | Timestamp | When the balance was reported by the user. |
| `sync_status` | string | `"manual"`, `"pending"`, `"connected"`, or `"failed"`. |
| `last_sync_at` | Timestamp \| null | Reserved for auto-sync. |
| `confidence` | string \| null | `"user_entered"`, `"extracted"`, or `"synced"`. |
| `notes` | string \| null | ≤500 chars. |
| `created_at` | Timestamp | `serverTimestamp()`. |
| `updated_at` | Timestamp | `serverTimestamp()` on every write. |

**Audit:** `bank_account.created`, `bank_account.balance_updated`,
`bank_account.archived`. All target_collection: `"bank_accounts"`.

### 4e.2. Bank Balance Snapshots — `users/{userId}/bank_balance_snapshots/{snapshotId}`

Append-only balance history. One snapshot per balance write
(`addManualBankAccount` and `updateBankAccountBalance` both emit one).

| Field | Type | Notes |
|-------|------|-------|
| `bank_account_id` | string | Document ID in `bank_accounts/`. |
| `balance` | number | Raw integer Rupiah at the time of snapshot. |
| `currency` | string | Locked to `"IDR"`. |
| `source_type` | string | Matches the originating account's source type. |
| `snapshot_at` | Timestamp | User-supplied "as of" timestamp. |
| `confidence` | string \| null | Same enum as bank_accounts. |
| `notes` | string \| null | ≤500 chars. |
| `created_at` | Timestamp | `serverTimestamp()`. |

**Mutation rule:** create + read only — update and delete are blocked.

The Overview Bank Cash Balance KPI reads these user-scoped snapshots to render
an aggregate active-account sparkline using the same green area-line treatment
as Revenue. A single real snapshot renders as a flat baseline, not a fabricated
trend. Every real snapshot remains a chart point in timestamp order, including
multiple balance updates on the same day. Its card order is balance, update
source and timestamp, 30-day outlook and coverage, then the snapshot trend
graphic.

### 4e.3. Budgets — `users/{userId}/budgets/{budgetId}`

Operating budgets that drive (a) `OpEx vs Budget` on Overview and `Budget Used`
on the Performance Trend chart, and (b) the Budget hierarchy. `/budget` is the
Main Budget page for annual envelopes and child period budgets.
`/budget-period` is the Period Budget Detail page where allocations/sub-budgets
are managed. `settings-budget.html` still uses the budget collection for
settings/history compatibility.

| Field | Type | Notes |
|-------|------|-------|
| `name` | string | User-chosen label. |
| `budget_type` | string | Optional Phase B field: `"annual"` or `"period"`. Legacy docs omit it and are normalized at read time. |
| `parent_budget_id` | string \| null | Optional annual envelope document ID for period budgets. |
| `period_type` | string | `"monthly"`, `"quarterly"`, `"custom"`, or `"yearly"` for annual envelope docs. |
| `period_label` | string \| null | Optional display label such as `"June 2026"` or `"Q3 2026"`. |
| `period_start` | Timestamp | Start of the budget period. |
| `period_end` | Timestamp | End of the period (inclusive). |
| `currency` | string | Locked to `"IDR"`. |
| `total_budget` | number | Raw integer Rupiah. |
| `category_budgets` | map | Optional per-category split. The Period Budget Detail allocation flow dual-writes a denormalized `{category → allocated_amount}` summary derived from `budget_allocations`, so the legacy OpEx-vs-Budget tracker stays in sync. |
| `notes` | string \| null | Optional, ≤500 chars. Written by the Budget page's Create Budget modal and Period Budget Detail allocation flow; absent on legacy docs. |
| `created_from_budget_id` | string \| null | Optional source period budget ID when a period is duplicated. |
| `status` | string | `"active"` or `"archived"`. |
| `created_at` / `updated_at` | Timestamp | Server-set. |

**Budget hierarchy rule:** `/budget` selects an explicit annual/main budget and
lists only active period budgets whose `parent_budget_id` points to that main
budget. Its Create Budget wizard is main/annual-only and can create quarterly
period budget children under the new annual budget; allocation categories are
still managed later from `/budget-period`. `/budget-period/{periodBudgetId}`
selects an explicit period budget for allocation work. Legacy
`/budget-period.html?budgetId={mainBudgetId}&periodId={periodBudgetId}` links
remain readable and canonicalize in-browser to the clean route. `getActiveBudget`
remains for compatibility and returns the latest active period budget first,
then falls back to any active budget.

**Audit:** `budget.created`, `budget.updated`, `budget.archived`,
`budget.allocations_updated`.

### 4e.4. Budget Allocations — `users/{userId}/budget_allocations/{allocationId}`

Category-scoped sub-budgets that detail how a selected period `budgets` doc is
split into operational areas (e.g. Marketing, Infrastructure, Operations, SaaS).
Created from the Period Budget Detail page, not from the `/budget` Main Budget
page. `parent_budget_id` must point to the period budget document.
`/budget-allocation/{allocationId}` opens allocation detail by reading the
allocation first, then deriving the period budget from `parent_budget_id`.
Legacy `/budget-allocation.html?budgetId={mainBudgetId}&periodId={periodBudgetId}&allocationId={allocationId}`
links remain readable and canonicalize in-browser to the clean route.

| Field | Type | Notes |
|-------|------|-------|
| `parent_budget_id` | string | Document ID in `budgets/`. |
| `name` | string | Allocation label (1–120 chars). |
| `allocated_amount` | number | Raw integer Rupiah (≤ 999,999,999,999). |
| `scope_type` | string | Locked to `"category"` in Phase 1. |
| `scope_values` | string[] | 1–10 category names. Phase 1 picker exposes `Marketing`, `Infrastructure`, `Operations`, `SaaS`. |
| `alert_threshold_percent` | number \| null | Optional, 0–100. Defaults to 80. |
| `hard_limit_enabled` | bool | Defaults to false. Phase 1 does not enforce hard limits. |
| `created_from_allocation_id` | string \| null | Optional source allocation ID when duplicating a period budget. |
| `status` | string | `"active"` or `"archived"`. Re-saving the budget archives the previous set in place and writes a fresh set. |
| `created_at` / `updated_at` | Timestamp | Server-set. |

**Mutation rule:** owner read/create/update only; delete is blocked.

**Atomic write:** `DataService.addBudgetWithAllocations(uid, budgetData, allocations)`
commits the explicit budget doc in `budgetData.budget_id` when editing, or a
new budget doc when creating. Passing an empty allocation array is valid for
annual/main budgets and newly created period budgets before allocations are
added. It only archives allocations that belong to that same period budget, so
editing July does not change June. The budget doc, allocation archive, and new
allocation set commit in a **single Firestore
`writeBatch`**. If any row is rejected (rules, validation, network), nothing
is written — the existing budget doc stays intact. Audit logs are written
post-commit and are best-effort (failures are non-fatal). `setActiveBudget`
remains the simpler path used by `settings-budget.html` and does not write
allocations.

**Usage calculation:** `DataService.getBudgetUsage(uid, budgetId)` returns
allocations with `actual_used` (transactions where `type ∈ {expense, fee,
tax}` and category matches), `committed_amount` (pending-payable transactions
+ unpaid bills with `payment_status !== 'paid'` and
`budget_impact_status !== 'converted_to_actual'`), `remaining_amount`,
`usage_percent`, and `status` (`healthy < 70 < watch < 85 < at_risk < 100 ≤
exceeded`). `usage_percent` is always finite (never `NaN`/`Infinity`).
Bill inclusion uses `due_date`, then `date`, then `timestamp`, then
`created_at`, so committed spend follows the selected budget period.

**Duplicate period:** `DataService.duplicateBudgetPeriod(uid, sourceBudgetId,
targetBudgetData)` creates a new period budget and new allocation docs only.
It copies allocation structure, not transactions, bills, actual usage,
committed usage, or activity.

**Audit:** `budget.allocations_updated` is logged on each batch write; the
log's `target_collection` is `"budget_allocations"`.

### 4f. Onboarding — `users/{userId}/onboarding/{onboardingDoc}`

User-scoped first-run setup. Applied **only to users created on/after
`ONBOARDING_RELEASE_CUTOFF` (2026-05-19T00:00:00.000Z)**. Pre-cutoff users get a
silent `onboarding_exempt: true` marker on first login and are never gated or
redirected.

| Document | Fields |
|----------|--------|
| `progress` | `onboarding_completed` (bool), `onboarding_exempt` (bool), `eligible_for_onboarding_gate` (bool), `current_step` (`business_setup`/`account_owner`/`finance_setup`/`review`/`complete`), `completed_steps` (string[]), `selected_first_action` (first selected setup preference, backward-compatible), `selected_first_actions` (string[]), `selected_learning_tours` (string[]), `primary_learning_tour` (string \| null), `skipped` (bool), `source` (`onboarding_v2`/`legacy_exemption`), `created_at`, `updated_at`, `completed_at`, `skipped_at` |
| `profile` | `business_name`, `role` (one of: `Owner / Founder`, `Finance admin`, `Accountant`, `Operations manager`, `Staff`), `main_goal`, `monthly_revenue_range`, `employee_count_range`, `legal_full_name`, `phone_country_code`, `phone_number` (normalized E.164-like string), `created_at`, `updated_at` |
| `documents` | `identity_document_status` (`not_uploaded`/`uploaded`), `identity_document_storage_path` (null in v1), `business_document_status`, `business_document_storage_path` (null in v1), `created_at`, `updated_at` |

**Detection logic** lives in `assets/js/onboarding-gate.js`. Imported as an ES
module by `login.html` (for post-login routing) and by each app page's auth
guard (for in-page gate rendering). `DataService` exposes
`getOnboardingProgress`, `getOnboardingProfile`, `getOnboardingDocuments`,
`saveOnboardingProgress`, `saveOnboardingProfile`, `saveOnboardingDocuments`,
`completeOnboarding`, `skipOnboarding`,
`markLegacyOnboardingExempt`.

**Audit:** `onboarding.submit` and `onboarding.skip` actions are recorded under
`users/{userId}/audit_logs` via the existing `addAuditLog` method.

**Storage:** Document upload is UI-stub only in v1 — no Firebase Storage writes,
no PII persisted beyond legal name + phone in `profile`. Storage paths remain
null.

**Setup preference values:** `selected_first_actions` may contain
`csv_upload`, `add_transaction`, `add_bill`, `dashboard_overview`,
`revenue_review`, `subscriptions`, and `fluxy_ai`. They map to platform
learning tour IDs `ledger`, `bills`, `overview`, `revenue_sync`,
`subscriptions`, and `fluxy_ai`. On completion the user always lands on
`/dashboard`; the first post-KYC coachmark must start with the `overview`
tour, then any selected preference tours may continue after it. Onboarding
queues this via `sessionStorage.fluxy_pending_tour = "overview"` and
`sessionStorage.fluxy_pending_tours` with `overview` first.

### 4g. Platform Learning — `users/{userId}/platform_learning/state`

User-scoped post-KYC learning progress. This is an educational layer only and
must never bypass or replace the onboarding gate.

| Field | Type | Notes |
|-------|------|-------|
| `dismissed` | bool | If true, do not auto-render Quick ways to get started |
| `dismissed_at` | Firestore Timestamp \| null | Set when the learning section is dismissed |
| `first_rendered_at` | Firestore Timestamp | First time the learning section was rendered |
| `last_seen_at` | Firestore Timestamp | Latest learning section or tour activity |
| `started_tours` | string[] | Tour IDs the user started |
| `completed_tours` | string[] | Tour IDs the user completed |
| `skipped_tours` | string[] | Tour IDs the user skipped |
| `active_tour` | string \| null | Current tour intent, if any |
| `updated_at` | Firestore Timestamp | Server timestamp for the latest mutation |

Valid tour IDs: `overview`, `ledger`, `bills`, `budgets`, `fluxy_ai`,
`revenue_sync`, `subscriptions`.

`DataService` exposes `getPlatformLearningState`, `savePlatformLearningState`,
`markPlatformTourStarted`, `markPlatformTourCompleted`,
`markPlatformTourSkipped`, and `dismissPlatformLearning`.

Completed tours stay restartable from their cards while the quick-start section
is visible. When every rendered tour ID is present in `completed_tours`, the
dashboard action changes from Dismiss to Completed; clicking it stores
`dismissed: true` and stops future auto-renders.

**Critical order:** App pages must run auth and `FluxyOnboardingGate.applyToPage`
first. If the onboarding gate renders, clear `sessionStorage.fluxy_pending_tour`
and do not render Quick ways to get started or start coachmarks.

### 4h. Documents — `users/{userId}/documents/{documentId}`

User-scoped document metadata for the shared receipt / invoice / proof
attachment workflow. Files themselves live in Firebase Storage under
`users/{userId}/documents/{documentId}/{fileName}` (≤5 MB, JPG/PNG/WebP/PDF
only). Spec lives in `docs/RECEIPT_DOCUMENT_ATTACHMENT_PLAN.md`.

| Field | Type | Notes |
|-------|------|-------|
| `file_name` | string | Sanitized filename (≤240 chars). |
| `file_mime_type` | string | One of `image/jpeg`, `image/png`, `image/webp`, `application/pdf`. |
| `file_size` | number | Bytes, ≤ 5 MB. |
| `storage_path` | string | Always under `users/{uid}/documents/{documentId}/`. |
| `document_role` | string | `receipt` \| `invoice` \| `payment_proof` \| `revenue_proof` \| `unknown_finance_document`. |
| `source_context` | string | `transaction` \| `revenue` \| `bill` \| `subscription`. |
| `target_collection` | string \| null | `transactions` \| `bills` \| `subscriptions` once linked. |
| `target_id` | string | Empty until linked. |
| `upload_status` | string | `pending` \| `uploaded` \| `failed` \| `removed`. |
| `extraction_status` | string | Phase 1 always `not_requested`. Reserved for backend AI extraction. |
| `review_status` | string | Phase 1 always `not_required`. |
| `created_at` / `updated_at` | Timestamp | Server-set. |

**Mutation rule:** owner read/create/update only; delete blocked. The
`storage_path` cannot change after create.

**Linked records:** transactions and bills carry an `attached_documents`
array of `{ document_id, role, storage_path, attached_at }` references
(≤20 entries). Bills additionally accept `invoice_status: "attached"`
when an invoice has been attached. **Attaching never mutates a bill's
`payment_status` and never creates a transaction.**

For backward compatibility with the legacy ledger thumbnail rendering,
image receipt uploads on **transactions** also dual-write the existing
`receipt_url` field with the Storage download URL. New code should prefer
`attached_documents`.

`DataService` exposes `uploadDocument`, `addDocumentMetadata`,
`linkDocumentTarget`, and `attachDocumentToRecord`. The shared UI
component lives in `assets/js/document-attachment.js` and is exposed as
`window.FluxyDocumentAttachment`.

### 4i. Bank Statement Imports — `users/{userId}/bank_statement_imports/{importId}`

Phase 1 review-drafts for an uploaded bank statement. Spec lives in
`docs/BANK_STATEMENT_IMPORT_AUTOMATION_PLAN.md`. The Phase 1 entry point is
the unified **Scan / Import** button in the Ledger page header — the
drawer that opens hosts a tab strip with **Receipt / Invoice** (the
legacy `document-capture.js` flow) and **Bank Statement** (this draft
flow). The secondary entry point on the Overview Bank Cash Balance card
is reserved for Phase 3.

The draft is never auto-converted into ledger transactions and never
updates a `bank_accounts.latest_balance`. **Extraction and the Phase 2
confirm-to-ledger flow are now built**; the bank-account/balance update
(Phase 3) is still deferred.

**Extraction (built).** After upload the client calls the Netlify
*background* function `bank-statement-extract-background.js` (route
`POST /api/v1/bank-statements/extract`, mapped in `netlify.toml`). It runs
detached: server-side Storage download via Admin SDK (no large base64 request
body), then parses the file — **PDF via OpenAI** (Responses API with PDF file
input + strict `json_schema`, the same `OPENAI_API_KEY` that powers bill
scanning; model from `BANK_STATEMENT_AI_MODEL`, default `gpt-4.1-mini` for its
32K output window), **CSV/XLSX deterministically via SheetJS** — runs the
balance-equation + per-row running-balance checks,
flags possible duplicates against existing `transactions`, and writes the
`rows` subcollection + patches the draft (`extraction_status: 'completed'`,
metadata, counts, `balance_check_status`). The model only returns JSON; the
function does every read/write and never logs statement contents. Requires a
Netlify plan with Background Functions.

**Confirm-to-ledger (built, Phase 2).** The Ledger Scan/Import → Bank
Statement panel watches the draft (`extraction_status` flips), renders an
interactive review table (select/ignore rows, edit suggested type/category,
skip duplicates), and on **Confirm Import** calls
`DataService.confirmBankStatementImport`, which batch-creates one transaction
per selected row and links them. Imported transactions carry
`source: 'bank_statement_import'`, `bank_statement_import_id`,
`bank_statement_row_id`, and `imported_at` (plus optional `bank_account_id`) —
the transaction create rule + `isValidAICaptureMetadata` allow these keys and
the new `source` value. Each row gets `created_transaction_id` +
`review_status: 'confirmed'`; the draft becomes `imported`. Idempotent — rows
that already carry a `created_transaction_id` are skipped on re-confirm.

| Field | Type | Notes |
|-------|------|-------|
| `bank_account_id` | string \| null | Reserved for Phase 3 reconciliation. Always null in Phase 1. |
| `file_name` | string | Sanitized uploaded file name (≤240 chars). |
| `file_mime_type` | string | One of `application/pdf`, `text/csv`, `application/vnd.ms-excel`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`. |
| `file_size` | number | Bytes, ≤ 10 MB. |
| `storage_path` | string \| null | Always under `users/{userId}/bank_statement_imports/{importId}/`. Null between draft creation and file upload. |
| `document_type` | string | Locked to `"bank_statement"`. |
| `extraction_status` | string | `pending` \| `processing` \| `completed` \| `failed`. Phase 1 always writes `pending`. |
| `review_status` | string | `draft` \| `needs_review` \| `ready_to_import` \| `imported` \| `rejected`. Phase 1 creates as `draft`; updates allow flipping to `rejected`. |
| `bank_name`, `account_holder`, `account_number_masked` | string \| null | Masked identity only (e.g., `"****1234"`). Never store full account numbers. |
| `currency` | string | Locked to `"IDR"`. |
| `statement_start_date`, `statement_end_date` | Timestamp \| null | Detected statement period. |
| `opening_balance`, `closing_balance`, `total_debit`, `total_credit` | number \| null | Raw integer Rupiah. Never formatted strings. |
| `row_count`, `duplicate_count`, `needs_review_count` | number | Non-negative integers. |
| `balance_check_status`, `running_balance_check_status` | string | `passed` \| `failed` \| `unavailable`. |
| `created_at`, `updated_at` | Timestamp | `serverTimestamp()`. |
| `confirmed_at`, `imported_at` | Timestamp \| null | Set by Phase 2/3 only. |

**Mutation rule:** owner read/create/update only; delete is blocked. File
name, mime type, and size are immutable after create.

**Rows subcollection:** `users/{userId}/bank_statement_imports/{importId}/rows/{rowId}`
holds extracted lines with `row_index`, `transaction_date`, `posting_date`,
`description_raw`, `debit`, `credit`, `running_balance`, `suggested_*`,
`match_status`, `confidence`, `selected_for_import`, `review_status`, and
`created_transaction_id` (always null in Phase 1).

**Storage:** uploaded statement files live under
`users/{userId}/bank_statement_imports/{importId}/{fileName}` with a 10 MB
ceiling. Allowed content types: PDF, CSV, XLS, XLSX.

**Audit:** `bank_statement.import_created` is written on draft creation, and
`bank_statement.import_confirmed` on confirm-to-ledger (both
`target_collection: "bank_statement_imports"`). Phase 3 adds
`bank_account.balance_updated`.

`DataService` exposes `createBankStatementImport`, `getBankStatementImport`,
`listBankStatementImports`, `updateBankStatementImport`,
`addBankStatementRows`, `getBankStatementRows`, `uploadBankStatementFile`,
`requestBankStatementExtraction`, `watchBankStatementImport`,
`updateBankStatementRow`, and `confirmBankStatementImport`. The shared UI lives
in `assets/js/bank-statement-import.js` and is exposed as
`window.FluxyBankStatementImport`.

### 4j. Internal Operations Console (Phase 1 MVP)

The Internal Operations Console (`internal.html` + `assets/js/internal-dashboard.js`)
is an internal-only activation & verification tool. It is **not** a customer page:
no marketing footer, no public nav, no customer sidebar, and it is never linked
from public navigation, the dashboard sidebar, or `sitemap.xml`. Full spec:
`docs/internal_operations_console_plan.md`.

**Auth (temporary):** a client-side credential gate (`username "fluxyos admin"`,
sessionStorage key `fluxy_internal_admin_session`) marked
`MVP_INTERNAL_ONLY_TEMPORARY_AUTH`. It is **not** a Firebase identity, so the
console is unauthenticated to Firestore. Replace with Firebase custom claims or a
backend-verified admin session before production.

These are the only **top-level (non-user-scoped)** collections in the schema, and
their `firestore.rules` are intentionally open (field-validated). They hold
operational metadata only — never financial ledger rows, balances, secrets, or
formatted currency strings.

#### `internal_users/{userId}` (open: read/create/update; client delete blocked)

| Field | Type | Notes |
|-------|------|-------|
| `user_id` | string | Matches the Firebase Auth UID / doc id. |
| `email`, `display_name`, `phone_number` | string \| null | Identity, refreshed by self-sync. |
| `business_name`, `role` | string \| null | Derived from `onboarding/profile`. |
| `account_status` | string | See §13 of the plan (`registered`…`suspended`). |
| `kyc_status` | string | `not_started`…`rejected`. |
| `payment_status` | string | `not_required`…`expired`. |
| `onboarding_completed` | bool | Mirrors `onboarding/progress`. |
| `kyc_submitted_at`, `kyc_reviewed_at`, `payment_submitted_at`, `payment_verified_at` | Timestamp \| null | |
| `plan_id`, `payment_method` | string \| null | Denormalized payment fields. |
| `payment_amount` | number \| null | Raw integer Rupiah. Never a formatted string. |
| `assigned_reviewer_id`, `last_internal_note`, `risk_level` | string \| null | Internal metadata. |
| `last_active_at` | Timestamp \| null | Presence heartbeat — last time the user was active in the app. Powers the console Users tab **Activity** column (Online / last-seen). |
| `archived` | bool | Soft-archive flag. `true` hides the user from the console's active surfaces (Users table default view, KYC/Payment queues, Overview, tab badges) — reversible, and never deletes data. |
| `archived_at` | Timestamp \| null | When the user was archived; cleared to `null` on restore. |
| `created_at`, `updated_at` | Timestamp | `serverTimestamp()`. |

**Population:** each user's own client upserts its own row via
`DataService.syncSelfToInternalIndex(uid, { email, display_name })`, called from the
`sidebar-loader.js` auth handler (every app page load) and from `onboarding.js`
`onSubmit`. Self-sync always refreshes identity/profile fields but **only seeds
status fields on first create** (or advances `not_started`/`in_progress` →
`submitted` on onboarding completion), so a reviewer's decision is never clobbered.
Covers only users who sign in after release; a backfill needs the Admin SDK.

**Presence heartbeat:** `DataService.touchActivity(uid)` stamps `last_active_at`
= `serverTimestamp()` on the user's own `internal_users` row. Wired from
`sidebar-loader.js` right after the self-sync — fires once on load, then on real
interaction (`pointerdown`/`keydown`/`scroll`/`focus`/`visibilitychange`) — and is
self-throttled to **≤1 write/60s** (skipped while the tab is hidden), so an
actively-used tab keeps beating while an idle-open tab ages into "last seen". The
console treats activity within 2 minutes as **Online**; otherwise it shows relative
last-seen, escalating to the absolute stamp past 24h. `firestore.rules`
(`isValidInternalUser`) validates `last_active_at` as a timestamp.

**Auth deletion cleanup:** `functions/index.js` exports the 1st-gen Firebase Auth
trigger `cleanupInternalUserOnAuthDelete`. Deleting a single Firebase
Authentication account removes its denormalized `internal_users/{uid}` row via
the Admin SDK, so the user disappears from `/internal` after refresh. The trigger
does not delete owner-scoped `users/{uid}/...` finance data or historical
`internal_audit_logs`. Firebase Admin SDK bulk deletion does not emit per-user
Auth deletion events; delete accounts one at a time when this automatic cleanup
is required. Production activation requires a Blaze-plan Firebase project and:
`firebase deploy --only functions:cleanupInternalUserOnAuthDelete`.

#### `internal_audit_logs/{auditLogId}` (open: read/create; update/delete blocked)

| Field | Type | Notes |
|-------|------|-------|
| `actor_uid` | string \| null | `null` in the credential-gate MVP. |
| `actor_username` | string | `"fluxyos admin"`. |
| `actor_role` | string | `"internal_admin"`. |
| `action` | string | `kyc.approve`, `kyc.request_revision`, `kyc.reject`, `payment.under_review`, `payment.verify`, `payment.reject`, `user.activate`, `user.suspend`, `user.archive`, `user.restore`, `trial.extended`, `internal.note.update`. |
| `target_user_id` | string | Affected `internal_users` doc id. |
| `before` / `after` | map \| null | Primitive status snapshots only. |
| `reason` | string \| null | Required for revision/reject/suspend. |
| `source` | string | Locked to `"internal_dashboard"`. |
| `created_at` | Timestamp | `serverTimestamp()` (must equal `request.time`). |

The console cannot write the owner-scoped `users/{uid}/audit_logs` (validation
requires a real `actor_uid`), so the user-scoped audit mirror is deferred to the
backend phase.

**DataService methods:** `getInternalUsers({ limitCount })`, `getInternalUser`,
`updateInternalUserStatus(userId, statusPayload, auditContext)` (status update +
audit log), `addInternalAuditLog`, `getInternalAuditLogs(limitCount = 100)`,
`syncSelfToInternalIndex`. Status-action rules (allowed-from states, resulting
statuses, audit actions) are specified in `docs/internal_operations_console_plan.md`
§18.

#### `sales_leads/{leadId}` (open read; client writes blocked — Admin SDK only)

Public **Contact Sales** enquiries from `/contact-sales` (Enterprise AI is
sales-led). The page POSTs to the `submit-contact-sales` Netlify function, which
honeypot-filters + validates and writes the lead via the **Admin SDK** (bypasses
rules). `firestore.rules` therefore allows open `read` (the credential-gated
console reads it unauthenticated, same MVP posture as `internal_users`) and
denies client `create`/`delete`. The credential-gated console may `update`
**only** the workflow `status` (rule restricts the diff to `status` +
`status_updated_at`, `status in [new, contacted, closed, spam]`), so core lead
fields stay immutable and the collection can't be spammed or wiped. Fields:
`name`, `email`, `whatsapp`, `company`, `business_type`, `team_size`, `message`,
`status` (`new`→`contacted`/
`closed`/`spam`), `source` (`contact-sales`), `plan_interest` (`enterprise`),
`user_agent`, `created_at`, `status_updated_at`. Surfaced in the console's
**Sales Leads** tab via `DataService.getSalesLeads({ limitCount })` +
`updateSalesLeadStatus(leadId, status)`. The function also fires best-effort
new-lead alerts: Resend email to `SALES_ALERT_EMAIL` and/or a Slack message to
`SLACK_WEBHOOK_URL` (each gated by its own env; missing config = silent skip).

#### `outreach_leads/{leadId}` (open read + field-validated client writes)

Manually-added prospects behind the console's **Sales Leads → Outreach**
sub-view (`internal.html` `panel-leads`, `internal-dashboard.js`). The operator
adds a prospect and the bilingual meeting-reminder email is sent in one step.
CRUD is done by the console directly against Firestore (open read +
field-validated create/update/delete, `isValidOutreachLead`, MVP posture like
`internal_digest_jobs`). The **email send** is the only gated action: it goes
through the **`send-lead-outreach`** Netlify function, which renders the
`lead_outreach` bilingual template (`functions/lib/templates.js`) and sends via
Resend from `hello@fluxyos.com`, authorized by the `INTERNAL_API_TOKEN` env that
the console passes in the `x-internal-token` header (the console has no Firebase
Auth — MVP_INTERNAL_ONLY_TEMPORARY). Fields: `name`, `gender`
(`male`/`female`, drives the honorific Bapak/Ibu · Mr/Mrs), `email`, `role`
(optional), `company` (optional), `meeting_at` (Timestamp, formatted to WIB in
the email), `status` (`new`/`sent`/`meeting_booked`/`closed`), `last_sent_at`
(optional), `created_at`, `updated_at`. **DataService:** `getOutreachLeads`,
`addOutreachLead`, `updateOutreachLead`, `deleteOutreachLead`. Distinct from the
public `sales_leads` (Contact-Sales) collection above.

**Trial mirror (added):** `internal_users/{uid}` also carries `access_status`,
`trial_started_at`, `trial_ends_at`, `trial_days_remaining`, and
`payment_proof_file_name` so the console can show trial/payment status (see §4k).
These are written by `DataService.syncInternalUserAccessIndex`. Internal
`payment_status` has no `not_started`; the trial's `not_started` is simply not
mirrored.

**Extend Trial (console action):** the Users tab shows a per-row **Extend Trial**
button **only for live trials** (`access_status` `trial_active`/`trial_expiring`).
It opens a 1 week / 2 weeks / 1 month dropdown that POSTs to the token-gated
**`extend-trial`** Netlify function (`x-internal-token: INTERNAL_API_TOKEN`, same
MVP posture as `send-lead-outreach`). Because the canonical trial lives in the
owner-scoped `billing_subscription/current` (§4k) — which `firestore.rules` lets
only the signed-in owner write, and the credential-gated console has no Firebase
Auth — the write **must** go through this Admin-SDK function (it bypasses rules).
The function guards `status === 'trialing'` server-side, extends **additively**
(`new_end = max(now, current trial_ends_at) + duration`, calendar month for
`1m`), and commits in one batch: canonical `billing_subscription/current`
(`trial_ends_at`, keeps `trial_started_at`), the `workspaces/{uid}` plan summary,
the `internal_users/{uid}` mirror (`access_status`, `trial_ends_at`,
`trial_days_remaining`), and an `internal_audit_logs` `trial.extended` entry
(admin, before/after end, duration, timestamp). It reuses the existing
`FIREBASE_SERVICE_ACCOUNT` + `INTERNAL_API_TOKEN` envs and the default function
path (no `netlify.toml` route). This is the automated, per-user counterpart to the
one-shot `scripts/extend-grace-trial.js`.

**Row actions & Archive User (console):** each Users-tab row has a primary
**Review** button plus a **⋮ overflow menu** (reuses the voucher-menu shell) —
secondary actions live there so the table stays scannable. The menu holds
**Extend Trial** (the trial-only group above) and **Archive user** / **Restore
user**. Archiving is a **soft, reversible hide that touches only the open
`internal_users` index** — no owner-scoped finance data, so (unlike Extend Trial)
**no server function**: the console writes `archived` + `archived_at` client-side
through `DataService.updateInternalUserStatus` (the `internal_users` update +
`internal_audit_logs` write in one batch, actions `user.archive` / `user.restore`).
Archive prompts a danger-tone `showConfirmDialog`. A per-tab **Active / Archived**
toggle switches the Users view; archived users are excluded from the active Users
list, the KYC and Payment review queues, the Overview KPIs/action list, and the
KYC/Payment tab-count badges. All historical records (transactions, subscriptions,
KYC, payments, audit logs) are preserved — archive never deletes.

### 4k. Billing Subscription — `users/{userId}/billing_subscription/current`

Canonical user-scoped package and trial state. Full spec:
`docs/PAYMENT_CHECKOUT_AND_VERIFICATION_PLAN.md`.

| Field | Type | Notes |
|-------|------|-------|
| `plan_id` | string | `trial`/`core`/`growth`/`enterprise`. |
| `plan_name` | string | Display name. |
| `status` | string | `trialing`/`awaiting_payment`/`pending_verification`/`active`/`past_due`/`expired`/`payment_failed`. `awaiting_payment` is the QRIS "pay the QR first" state (see §4l). |
| `billing_frequency` | string \| null | `monthly`/`annually`. |
| `current_payment_request_id` | string \| null | Latest canonical request ID. |
| `trial_started_at`, `trial_ends_at` | Timestamp \| null | Trial timing. |
| `current_period_start`, `current_period_end` | Timestamp \| null | Active billing period. Manual internal verification stamps these from the admin's `payment_verified_at` time using `billing_frequency` (`monthly` → +1 month, `annually` → +1 year). |
| `updated_at` | Timestamp | `serverTimestamp()`. |

`assets/js/trial-access.js` reads this doc through
`DataService.ensureBillingSubscription`. It creates a 3-day trial after onboarding,
migrates safe frozen legacy state on authenticated load, renders the shared banner,
and applies the existing UX-only write/export/AI locks.

**Internal review reconcile:** the credential-gated ops console (`internal.html`)
has no Firebase identity, so its Verify/Reject buttons only update the open
`internal_users/{uid}` index — they cannot write owner-scoped billing docs. On the
user's next authenticated load, `ensureBillingSubscription` →
`reconcileBillingFromInternalIndex` carries that decision into
`billing_subscription/current`:

- **Verified (`payment_status == 'verified'`) → `active`.** A verified payment is a
  definitive grant, so it promotes the subscription from **any** not-yet-active
  state — `pending_verification`, `awaiting_payment`, **`expired`, or `trialing`** —
  and, when `current_period_end` is missing, sets the active billing period from
  the admin verification timestamp based on `billing_frequency` (`monthly` or
  `annually`). This is what the billing settings page uses for "Next billing."
  It does **not** require `internal_users.updated_at` to be newer than the
  subscription's `updated_at`. (The automatic trial-expiry write bumps the
  subscription's `updated_at` *after* the manual review; requiring "internal newer"
  used to strand an approved-but-expired user on the "Your trial has ended" banner
  forever — that was a bug, fixed by widening both this method and the rule.)
- **Rejected (`payment_status == 'rejected'`) → `payment_failed`**, but only from an
  in-flight `pending_verification`/`awaiting_payment` state **and** only when
  `internal_users.updated_at` is newer than the subscription's own `updated_at`, so
  a fresh retry is never clobbered by a stale rejection.
- Already-active subscriptions are only touched to backfill a missing active billing
  period after an internal verified payment. `suspended` subscriptions are never
  touched.

The Firestore rule `isInternalReviewReconcile` authorizes exactly this owner
self-write (and mirrors the same state matrix).
`DataService.getBillingReviewReason` surfaces the reviewer note
(`internal_users.last_internal_note`) on `/payment-pending` for the rejected state.
This is UX-only MVP enforcement (the internal index is open); a trusted backend
should own activation in production.

**Access enforcement (`assets/js/trial-access.js`).** `deriveState` derives
`isBlocked` — the user has no usable access and must pay: trial ended without paying
(`expired`) or a payment was rejected and the trial window is also over
(`payment_failed` with no trial time left). Payments still in review
(`pending_verification`/`awaiting_payment`) are **not** blocked. When `isBlocked`,
`applyToPage` renders a **full-screen, non-dismissable paywall** (`renderPaywall`):
the page is blurred and fully non-interactive behind a centered "choose a plan" /
"retry payment" card, with `/payment-pending` and Sign out escape links. It replaces
the slim banner for blocked users. All other states keep the slim banner +
per-action locks. Because the guard is wired only through `sidebar-loader.js`, the
paywall never appears on `/pricing`, `/checkout`, or `/payment-pending` (no sidebar),
so the user can always reach checkout. UX-only MVP enforcement.

**Billing & plan settings page (`settings-billing.html`, Phase 1, read-only view).**
The Settings → Product → Billing & plan tile routes to `/settings-billing`. The
page is a **read-only** surface + **safe** subscription actions; it reads the same
canonical `billing_subscription/current` doc the trial/paywall system uses (never a
divergent source), normalizes it into a view-model, and layers seat/storage/AI
limits from `assets/js/billing-config.js` `PLAN_LIMITS` (trial → 1 seat, 5 MB
storage, 3 Fluxy AI chats; basic/core → 5 seats & 5 GB, growth → 10 & 10 GB,
enterprise → 50 & 50 GB). It renders
four summary cards, a Your Plan card, a Payment Method card, a Usage & Limits card,
and a Billing History table. The frontend **never** mutates subscription status
(Firestore rules block it). DataService methods (all owner-scoped, all degrade
safely): `getBillingSettingsOverview`, `getBillingInvoices`, `getBillingUsage`,
`requestBillingCheckout`, `requestBillingUpgrade`, `requestCancelRenewal`,
`requestReactivateSubscription`. The existing `getBillingSubscription` /
`ensureBillingSubscription` are reused unchanged. Checkout/upgrade/fix-payment route
to the real `/pricing` + `/checkout` flow; cancel/reactivate call the documented
backend endpoints (`/api/v1/billing/*`) which are **not part of this build** and fail
safely with a toast — never a fake success and never a local status change. Billing
history reads `users/{uid}/billing_invoices/{invoiceId}` (owner-read rule; client
writes blocked; issued by a trusted backend) and shows an empty state when absent.
Usage numbers come only from real user-scoped records (`documents` +
`bank_statement_imports` file sizes for storage, `usage_limits/ai_chat_trial` for
trial AI chats, and `documents` / `report_exports` counts for the current month);
anything not yet metered shows a "being prepared" fallback rather than an invented
number. The cancel-renewal flow uses the shared `showConfirmDialog` (danger tone),
not `window.confirm()`.

**Plan limit enforcement.** Runtime quotas are enforced from the same
`PLAN_LIMITS` source. `DataService.assertCanUseStorage` blocks document, receipt,
and bank statement uploads when the incoming file would exceed the effective
plan storage quota; pending/unverified payment states keep trial entitlements
until internal verification promotes the subscription to `active`. Payment proof
uploads bypass this gate so users can still activate a subscription. The
Netlify/FastAPI `/api/v1/brain/chat` endpoint enforces the trial Fluxy AI quota
by incrementing `users/{uid}/usage_limits/ai_chat_trial` through Firestore rules;
the owner can only increment that counter from 1 to 3 and cannot reset it. Firebase
rules enforce ownership, AI counter monotonicity, and per-file limits where rules
can inspect a single write. Aggregate storage counting is preflighted by
`DataService` using `getBillingUsage`; a future server-side storage counter would
be needed for fully race-proof aggregate storage enforcement across simultaneous
uploads.

### 4l. Billing Payment Requests — `users/{userId}/billing_payment_requests/{id}`

Metadata-only manual verification request created from `/checkout`. Amounts are raw
integers, currency is locked to `IDR`. No card, bank, OTP, tax-ID, or
provider-sensitive values are stored. `DataService.createPaymentRequest` writes the
request, subscription transition, and audit row atomically.

**QRIS lifecycle (manual):** `awaiting_payment → pending_verification → verified |
failed | expired`. QRIS requests are created as `awaiting_payment` (the subscription
mirrors this) so the user sees the QR payment screen first; all other methods
(`va`/`card`/`invoice`) are created directly as `pending_verification` (unchanged).
`verified`/`failed`/`expired` stay server/manual-owned — the client can never write
them. The static merchant QR + bank reference are display constants in
`assets/js/billing-config.js` (`QRIS_PAYMENT_INFO`) and the image at
`assets/images/qris-tanda360.png`; they are **not** persisted per user.

Fields beyond the base 18: `user_confirmed_payment_at`,
`submitted_for_verification_at` (Timestamp|null), and the optional proof reference
`proof_document_id`/`proof_file_name` (string|null) + `proof_uploaded_at`
(Timestamp|null). All start `null` at create. Proof files reuse the
`documents/{id}` + Storage flow (`document_role: 'payment_proof'`,
`source_context: 'payment'`); only the doc id + file name are referenced here.

**DataService:** `createPaymentRequest` (status by method), `getLatestPaymentRequest`,
`getLatestPaymentRequestWithLegacyFallback`, `getPaymentRequestById`, and
`submitPaymentRequestForVerification(uid, requestId, { proofDocumentId, proofFileName })`
(batched request update → `pending_verification` + subscription transition + audit
`billing.payment_confirmation_submitted`). The QRIS screen + verification-in-progress
state both render from `/payment-pending` (`?requestId=` optional); revisiting while
`awaiting_payment` re-shows the QR. The app banner (`assets/js/trial-access.js`) adds a
"QRIS payment waiting" state with a "View QRIS payment" CTA.

Legacy `users/{uid}/billing/access` and `users/{uid}/payment_verifications/{id}`
remain owner-readable migration inputs only. Customer writes are blocked.

### 4l.1. Voucher Codes — `voucher_codes/{CODE}` + `voucher_redemptions/{paymentRequestId}`

Percentage checkout discounts. Full spec:
`docs/FLUXYOS_VOUCHER_CODE_IMPLEMENTATION_PLAN.md`. Managed from the internal
console's **Vouchers** tab; applied on `/checkout` under Billing frequency.

**Enforcement model (no billing backend):** client-side validation
(`DataService.validateVoucherCode`) is UX only. The binding check is in
`firestore.rules` at payment-request creation
(`hasValidPaymentRequestVoucher`): rules `get()` the voucher doc themselves,
re-check status/window/plan/frequency/usage, recompute
`discount = subtotal * percent / 100`, and require — in the SAME commit — the
`voucher_redemptions/{paymentRequestId}` doc and an exactly-+1
`redemption_count` bump. A tampered client discount is rejected by Firestore.

**Math contract (integer-exact, shared by `billing-config.js` and rules):**
all plan subtotals are multiples of 10.000, so
`discount = subtotal * percent / 100` and
`tax = (subtotal - discount) * 11 / 100` are exact integers — PPN applies to
the **discounted** subtotal; `total = subtotal - discount + tax`.
`calculateBilling(planId, frequency, voucher?)` returns
`voucherDiscountAmount` (0 when no voucher; no-voucher output unchanged).

`voucher_codes/{CODE}` (doc id == normalized uppercase code, `^[A-Z0-9_-]{4,32}$`
— unique by construction; rules allow `get` but deny `list`):

| Field | Type | Notes |
|-------|------|-------|
| `code` | string | Equals the doc id. |
| `discount_type` | string | Locked to `"percentage"`. |
| `discount_value` | number | Integer 1–100. Immutable after create. |
| `status` | string | `active` / `disabled` / `expired`. |
| `max_redemptions` | number \| null | `null` = unlimited. |
| `redemption_count` | number | Server-checked +1 per checkout commit. |
| `valid_from`, `valid_until` | Timestamp \| null | Local-day bounds from the console. |
| `allowed_plan_ids` | string[] \| null | Subset of `core/growth/enterprise`; `null` = all. |
| `allowed_billing_frequencies` | string[] \| null | Subset of `monthly/annually` (**`annually`**, never `annual`); `null` = both. |
| `created_by`, `created_at`, `updated_at` | — | Console identity + server timestamps. |
| `disabled_at`, `disabled_by` | — | Stamped on disable. |
| `notes` | string \| null | Internal-only, ≤500. |

`voucher_code_index/registry` — `{ codes: string[], updated_at }`; lets the
console list vouchers (via per-code gets) since `list` is denied. Maintained by
`arrayUnion` in the create batch.

`voucher_redemptions/{paymentRequestId}` (doc id == the payment request id;
created only inside the checkout transaction; doubles as the redemption audit
record): `voucher_id`/`code`, `user_id` (must equal `auth.uid`),
`checkout_session_id` (== doc id), `plan_id`, `billing_frequency`,
`original_amount` (= subtotal), `discount_amount`, `final_amount`
(= total incl. PPN), `currency: 'IDR'`, `status`
(`reserved` → `redeemed` on internal `payment.verify`, or `cancelled` when the
owner cancels the payment request — `cancelPaymentRequest` settles it
best-effort; the voucher's `redemption_count` is NOT decremented, so a
cancelled redemption still consumes a slot in v1), `created_at`,
`redeemed_at`. Raw integers only. Rules mirror every amount against the
payment request written in the same commit via `getAfter()`.

**Payment request voucher snapshot:** `billing_payment_requests` gains 4
optional fields (`hasOnly`, not `hasAll`, so pre-voucher cached clients keep
working): `voucher_id`, `voucher_code`, `voucher_discount_percent`,
`voucher_discount_amount` — all `null` when no voucher. Immutable post-create
(existing `affectedKeys` allow-lists).

**DataService:** `normalizeVoucherCode`, `validateVoucherCode({ code, planId,
billingFrequency })`, `getVoucherCode`, `getVoucherCodes` (registry fan-out),
`createVoucherCode` (atomic: voucher + registry + `voucher.create` audit),
`updateVoucherCode` (notes/valid_until/max_redemptions only),
`disableVoucherCode` (`voucher.disable` audit), `getVoucherRedemptions`,
`getAllVoucherRedemptions`, `markVoucherRedemptionsRedeemed(userId)` (called
best-effort after the console's `payment.verify`). `createPaymentRequest`
accepts an optional `voucher_code` and routes voucher checkouts through a
`runTransaction` (read voucher + subscription → revalidate → write request +
subscription + redemption + counter), so the last slot of a limited voucher
can never be redeemed twice. Typed errors: `voucher-invalid`,
`voucher-disabled`, `voucher-expired`, `voucher-not-started`,
`voucher-usage-limit`, `voucher-plan-mismatch`, `voucher-frequency-mismatch`.

**Security posture (MVP, same as `internal_users`):** voucher admin writes are
field-validated but NOT identity-gated (the console has no Firebase identity);
`voucher_redemptions` reads are open for the console. Known accepted gaps until
custom-claims admin auth exists: anyone knowing the paths can create/disable
vouchers or read redemption metadata, and any signed-in user can burn
redemption slots via the bare +1 counter update (DoS only — never a bigger
discount, because rules recompute the price from the voucher doc). Audit
actions written to `internal_audit_logs` with `target_user_id` = the voucher
code: `voucher.create`, `voucher.update`, `voucher.disable`.

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

**Accounting Center (Phase 1, read-only).** `accounting.html` + `assets/js/accounting.js`.
The **primary tab is the Income Statement Preview** (a deterministic P&L); readiness was
demoted from the main experience to a supporting **report confidence** banner + KPI.
Tabs are **Income Statement / Cleanup / Account Mapping / Close** (the old readiness-first
"Overview" tab was replaced). The page still renders the cleanup queue, mapping preview,
and close-readiness checklist from existing user-scoped records. There is **no** journal
posting, period close, or AI write in Phase 1 (the Close action is a disabled "Planned"
control; no `accounting_periods` collection is created).

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

**Balance Sheet (Phase 1 Management View).** `balance-sheet.html` + `assets/js/balance-sheet.js`
render a standalone authenticated report under Reporting. It is a point-in-time
management view based on existing FluxyOS records, not a formal accounting-grade
balance sheet. The UI uses **Net Position** instead of Equity because FluxyOS does
not yet have opening balances, retained earnings, owner capital, journal entries,
or a full chart of accounts.

`DataService.getBalanceSheetReport(uid, options)` reads only user-scoped data:
`bank_accounts`, `bank_balance_snapshots`, `transactions`, and `bills`. Options are
`{ asOfDate, compareAsOfDate, cadence, filters }`; returned amounts are raw integer
IDR values. Sections are Assets, Liabilities, and calculated Net Position.

Calculation rules:
- **Cash & Bank** = active `bank_accounts.latest_balance`; for point-in-time
  comparison, the latest `bank_balance_snapshots` row on or before the as-of date
  is used when available, falling back to `latest_balance`.
- **Accounts Receivable** = `transactions.type == "pending_receivable"` on or
  before the as-of date.
- **Accounts Payable** = unpaid `bills` (`payment_status != "paid"` or missing)
  whose first available bill date (`due_date`, `date`, `timestamp`, `created_at`)
  is on or before the as-of date.
- **Pending Payables** = `transactions.type == "pending_payable"` on or before
  the as-of date.
- **Net Position** = total assets minus total liabilities.

The page supports comparison dates, section/source filters, expandable report
rows, and a read-only related-records drawer. CSV export contains raw integer
amounts only. Confirmed exports create `users/{uid}/report_exports` metadata with
`report_type: "balance_sheet"` and write an `export.create` audit log through
`createExportAuditLog`, targeting `report_exports`; no CSV content or row-level
financial records are stored in Firestore.

**Sidebar route:** `Balance Sheet` → `/balance-sheet`, under the Reporting group
in `sidebar-loader.js` (active id `nav-balance-sheet`).

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
| `chart_of_accounts` | `{code}` | `code, name, type (asset/liability/equity/revenue/expense), subtype, parent_code, normal_balance, is_active, currency, entity_id, opening_balance, created_at`. Seeded idempotently by `seedChartOfAccounts()` from `CHART_OF_ACCOUNTS_SEED`. Archive via `is_active`; **never deleted**. |
| `journals` | auto | `journal_number ('JE-YYYY-NNNNNN'), journal_seq (int), journal_type ('system'\|'manual'), manual_subtype, posting_rule_id, source:{collection,id}, source_number, period_key 'YYYY-MM', status (draft/posted/reversal/reversed), description, reference, entity_id, currency, memo, lines[], total_debit, total_credit, is_balanced, reverses_journal_id, reversed_by_journal_id, created_by, generated_by, posted_by, posted_at, created_at`. Posted entries are **immutable** (rules allow only `reversed_by_journal_id` to change; no delete) and created only into a **non-closed** period. `journal_type:'manual'` `status:'draft'` rows are editable/deletable until posted. |
| `counters` | `journal-{YYYY}` | `seq (int, monotonic), entity_id, updated_at`. Per-year journal-number sequence, reserved in a `runTransaction` before the posting batch (`_reserveJournalNumbers`). Rules enforce `seq` only ever grows; no delete. |
| `ledger_balances` | `{period_key}__{account_code}` | `period_key, account_code, account_type, entity_id, currency, debit_total, credit_total, updated_at`. Running per-account/period totals, written via `FieldValue.increment` alongside each journal. **The trial-balance source** — never sum all journal lines. |
| `periods` | `{period_key}` | `period_key, status (open/closed/locked), entity_id, closed_by, closed_at, retained_earnings_posted, updated_at`. Missing doc = open. `closePeriod()` posts a closing journal (net income → `3000 Retained Earnings`) and sets `closed`. `reopenPeriod()` (owner/admin only — rules gate the closed/locked → open transition) flips the period open and reverses the closing journal so net income backs out of Retained Earnings. Lock is owner/admin only. |

Foresight fields present on every journal/account now (multi-entity/-currency UI
deferred): `entity_id` (= workspaceId), `currency` ('IDR'), `fx_rate` (1),
`functional_amount`. Source documents gain `journal_ref` + `accounting_status`
(`posted`/`pending`/`excluded`) for drill-down.

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

### 4n. Invoices — `users/{userId}/invoices/{invoiceId}` (+ `items` subcollection)

Customer invoices for the Operations → Invoices page (`invoices.html` +
`assets/js/invoices.js`). Full spec: `docs/fluxyos_create_invoice_feature_plan.md`.

**Accounting rule (critical):** a finalized (`open`) invoice is an **expected
receivable only**. Finalizing NEVER creates a `users/{uid}/transactions` record,
never marks anything paid, and never charges a customer. The ledger record is
created only by **Mark payment completed** (`markInvoicePaid`): an explicit user
confirmation on an `open` invoice that, in ONE `writeBatch`, creates a single
income transaction (`type: "income"`, `category: "Revenue"`, `status:
"Completed"`, `amount` = full `total_amount`, `vendor_name` = customer name,
`invoice_number` + `notes` for provenance, `timestamp` = user-picked payment
date), stamps `paid_at` + `linked_transaction_id` on the invoice, and writes the
`invoice.mark_paid` audit log. The category is never user-selected (Revenue is
the only income category in the taxonomy) and partial payments are not
supported in v1. Never auto-mark paid.

| Field | Type | Notes |
|-------|------|-------|
| `invoice_number` | string | `INV-YYYYMM-0001`, per-user, derived from the latest existing number (no global counters). Immutable after create. |
| `status` | string | `draft` → `open` (finalize) → `paid` (mark payment completed) or `void`. Delete is blocked — void instead. |
| `currency` | string | Locked to `"IDR"` in v1. |
| `customer_name` | string | May be empty on draft; required (size > 0) to finalize. |
| `customer_email` | string \| null | Optional for draft/finalize; required for "Finalize and mark as sent". |
| `customer_language` | string | Default `"English"`. |
| `issue_date` | Timestamp | Defaults to draft-creation day. |
| `due_date` | Timestamp \| null | Required to finalize. Derived from `due_terms`. |
| `due_terms` | string | `due_on_receipt` \| `due_in_7_days` \| `due_in_14_days` \| `due_in_30_days` \| `custom`. |
| `item_count` | number | Denormalized item count so the list renders without N subcollection reads. Must be > 0 to finalize. |
| `subtotal_amount`, `tax_amount`, `discount_amount`, `total_amount`, `amount_due` | number | Raw integer Rupiah. Never formatted strings. `discount_amount` is always `0` in v1. |
| `tax_rate_percent` | number \| null | Optional 0–100; `tax_amount = round(subtotal × rate / 100)`. |
| `memo`, `footer` | string \| null | ≤500 chars each. Still editable on `open` invoices (metadata-only update). |
| `payment_collection_method` | string | `request_payment` \| `manual_only`. No real payment processing in v1. |
| `payment_link_enabled` | bool | Always `false` in v1. |
| `payment_page_url` | null | Must be null in v1 (rules-enforced). |
| `finalized_at`, `sent_at`, `voided_at` | Timestamp \| null | Stamped server-side on finalize / mark-sent / void. |
| `paid_at` | Timestamp \| null | Stamped (`request.time`) only on the `open → paid` transition. Any other write of a non-null `paid_at` is rules-blocked. |
| `linked_transaction_id` | string \| null | Set only on `open → paid`: the id of the income ledger transaction created in the same batch. |
| `void_reason` | string \| null | Required (1–500 chars) when status becomes `void`. |
| `created_at`/`updated_at`, `created_by`/`updated_by` | Timestamp / string | Server timestamps; pinned to `request.auth.uid`. |

**Items subcollection** `users/{userId}/invoices/{invoiceId}/items/{itemId}`:
`description` (1–240), `quantity` (> 0, ≤2 decimals), `unit_price` (raw integer),
`amount` (= round(quantity × unit_price)), `position`, `created_at`, `updated_at`.
Item writes/deletes are allowed while the parent invoice is a draft OR a
finalized-but-unsent (`open` + `sent_at == null`) invoice
(`getAfter`-checked, so the create-draft batch validates).

**Status transitions (rules-enforced):** `draft → draft` (free edit),
`draft → open` (finalize: customer name, due date, `item_count > 0`,
`total_amount > 0`, `finalized_at == request.time`), `open → open` full edit
while unsent ("finalize only": same required-field checks, `finalized_at`
preserved), `open → open` metadata-only diff (`memo`/`footer`/`sent_at`),
`open → paid` (mark payment completed: `paid_at == request.time`,
`linked_transaction_id` required, diff limited to
`status`/`paid_at`/`linked_transaction_id`/`updated_at`/`updated_by`),
`draft|open → void` (requires `void_reason` + `voided_at == request.time`).
`void`/`paid` are terminal for the client — no edit, void, or un-pay after
paid.

**Overdue is display-only:** stored status stays `open`; the UI shows
`Overdue` when `status == "open" && due_date < today && amount_due > 0`.

**Email delivery is a Gmail-compose handoff only.** The detail view's "Send
by email" action (open invoices with a `customer_email`) opens
`mail.google.com` compose (`view=cm`) in a new tab pre-filled with the
recipient, subject, and invoice-summary body. FluxyOS has no email provider
and never sends mail itself; "Mark as sent" remains the explicit delivery
stamp (`sent_at` + `invoice.sent` audit). Implementation note: it must be a
`target="_blank"` anchor — a same-page navigation fires `beforeunload` and
strands the page-transition overlay, and a hidden iframe violates the
production CSP `frame-src` (both were real bugs).

**PDF is browser-print only.** The detail view's "Preview PDF" modal renders
the invoice document; "Download PDF" calls `window.print()` scoped via a
`body.invoice-printing` print stylesheet so only the document prints
(suggested filename = invoice number via a temporary `document.title`). Same
contract as `report-preview.html`: the app cannot verify the user saved the
file, so it never logs `downloaded: true`. The modal also surfaces an
"Open Gmail draft" button (open + emailable invoices) so download-then-email
happens in one place — the user attaches the saved PDF manually, because
browsers do not allow websites to pre-attach files to a Gmail/mailto draft.

**DataService methods:** `generateInvoiceNumber`, `getInvoices`, `getInvoice`,
`getInvoiceItems`, `createInvoiceDraft` (invoice + items + audit in one
`writeBatch`), `updateInvoiceDraft` (doc patch + item upsert/delete sync + audits
in one batch), `addInvoiceItem`, `updateInvoiceItem`, `deleteInvoiceItem`,
`finalizeInvoice(uid, id, { markSent })`, `recordInvoiceSent`,
`markInvoicePaid(uid, id, { paymentDate })` (income transaction + invoice patch
+ audit in one batch; returns `{ id, transactionId }`),
`voidInvoice(uid, id, reason)`.

**Audit actions** (`target_collection: "invoices"`): `invoice.draft_created`,
`invoice.draft_updated`, `invoice.item_added`, `invoice.item_updated`,
`invoice.item_deleted`, `invoice.finalized`, `invoice.sent`,
`invoice.mark_paid`, `invoice.voided`, plus `export.create` for the invoice
CSV export.

**Sidebar route:** `Invoices` → `/invoices`, Operations group directly under
Budgets (active id `nav-invoices`).

### 4o. Tax Center — Indonesian tax collections (SHIPPED Phases 1–4 + 5.1, workspace-scoped)

**Status: live on main (rules deployed).** PPN (output `2100` / input `1130`),
withholding (`2110` we-withhold / `1150` customers-withhold), tax periods
(compute/file/lock), SPT PPN + Bukti Potong CSV exports, `tax_filings`, corporate
tax (PPh 25 installments → `1140`; annual PPh 29 → `2200`, UMKM 0.5% / ordinary 22%),
and the AI Tax Assistant foundation (deterministic compliance insights +
`FluxyAIContext` drawer context, read-only) are all shipped. Phase 5.2
(Coretax/e-Faktur/e-Bupot) is blocked on real DJP API access. Full spec:
`docs/INDONESIA_TAX_CENTER_ARCHITECTURE.md`. Listed here so the schema reference and
the §4 grep guard cover the collections from day one. The Tax Center is **derived**:
tax amounts post as **additional lines on the journal the business document already
generates** through the existing Accounting Kernel (§4m.3) — never a parallel ledger.
Pure rules live in `assets/js/tax-engine.js` (mirrors `accounting-engine.js`: no
Firestore/DOM, unit-tested). All amounts raw integer Rupiah; route every path through
`_scope()`; append-only collections soft-archive via `status`.

| Collection | Doc id | Key fields |
|---|---|---|
| `company_tax_profile` | `current` | `npwp, nik, pkp_status ('pkp'\|'non_pkp'), pkp_effective_date, umkm_final (bool), tax_office_kpp, business_classification, default_ppn_rate (int %), entity_id, updated_by, updated_at`. One per workspace; drives every engine branch. |
| `tax_mappings` | `{source_type}__{source_value}` | `source_type, source_value, tax_code, tax_rate_percent, effective_from, effective_until, status ('active'\|'archived'), created_by, created_at, updated_at`. Mirrors `accounting_mappings`. |
| `tax_transactions` | auto (append-only) | `source_collection, source_id, source_number, tax_code, tax_name, direction ('output'\|'input'\|'withheld_by_us'\|'withheld_by_other'\|'final'), tax_rate_percent, taxable_base (int), tax_amount (int), period_key 'YYYY-MM', journal_ref, npwp_counterparty, faktur_number, bukti_potong_no, status ('draft'\|'posted'\|'corrected'\|'reversed'), reverses_tax_tx_id, reversed_by_tax_tx_id, entity_id, created_by, created_at`. |
| `tax_periods` | `{period_type}-{period_key}` | `period_type ('monthly'\|'quarterly'\|'annual'), period_key, period_start, period_end, filing_deadline, status ('open'\|'computed'\|'filed'\|'amended'\|'settled'), ppn_output, ppn_input, ppn_payable, pph_withheld, pph_credit, pph_final (all int), entity_id, closed_by, closed_at, updated_at`. Cached summary of `tax_transactions` (the rows are the source), like `ledger_balances`. |
| `tax_filings` | auto (append-only) | `period_id, filing_type ('SPT_PPN'\|'SPT_PPh_Unifikasi'\|'SPT_PPh21'\|'SPT_Tahunan'\|'Tax_Certificate'), filing_date, reference_number, status ('draft'\|'filed'\|'accepted'\|'rejected'\|'amended'), file_path, external_link, filed_by, audit_log_id, entity_id, created_at, updated_at`. |

**New COA accounts** (added to `CHART_OF_ACCOUNTS_SEED`): `1130` PPN Masukan,
`1140` Prepaid PPh 25, `1150` PPh withheld-by-customers, `2100` PPN Keluaran,
`2110` PPh Payable, `2200` PPh 29 Payable.

**New optional fields on transactions/bills/invoices** (additive; validators must
allow them like `isValidAccountingLink`): `tax_code`, `taxable_base` (int),
`tax_amount` (int), `npwp_counterparty`, `faktur_number`, `bukti_potong_no`,
`withholding_flag` (bool).

**Permissions:** `tax.read` (all incl. viewer), `tax.map`/`tax.post`/`tax.period.close`
(finance+/accountant), `tax.file` (owner/admin). **Audit actions** (`target_collection`
the tax collection): `tax_profile.update`, `tax_mapping.create/update/archive`,
`tax_transaction.post/reverse`, `tax_period.compute/close`,
`tax_filing.submit/accept/reject`. Rules deploy separately
(`firebase deploy --only firestore:rules`).

---

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

| Group | Item | Type | Route / Action | Status |
|-------|------|------|----------------|--------|
| Command | Overview | Link | `/dashboard` | ✅ Shipped |
| Command | Fluxy AI | Button | `window.toggleFluxyAI()` | ✅ Shipped |
| Money Movement | Transactions | Link | `/ledger` | ✅ Shipped |
| Money Movement | Revenue Sync | Link | `/revenue-sync` | ✅ Shipped |
| Money Movement | Bills | Link | `/bill` | ✅ Shipped |
| Money Movement | Subscriptions | Link | `/subscription` | ✅ Shipped |
| Operations | Vendor Spend | Disabled button | `Soon` | 📋 Planned |
| Operations | Receipt Capture | Disabled button | `Soon` | 📋 Planned |
| Operations | Budgets | Link | `/budget` | ✅ Shipped Phase 1 |
| Operations | Invoices | Link | `/invoices` | ✅ Shipped MVP |
| Operations | Approvals | Disabled button | `Soon` | 📋 Planned |
| Reporting | Reports & Exports | Link | `/reports` | ✅ Shipped MVP |
| Reporting | Audit Log | Disabled button | `Soon` | 📋 Planned |
| Workspace | Integrations | Link | `/integration` | ✅ Shipped |
| Workspace | Settings | Link | `/settings` | ✅ Shipped MVP |

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
