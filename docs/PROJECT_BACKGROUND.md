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
| Redirect | `index.html` | Redirect | No | ✅ | No |
| Sign In | `login.html` | Auth | No | No | No |
| Dashboard | `dashboard.html` | App | ✅ | **No** | ✅ |
| Ledger | `ledger.html` | App | ✅ | **No** | ✅ |
| Revenue Sync | `revenue-sync.html` | App | ✅ | **No** | ✅ |
| Bills | `bill.html` | App | ✅ | **No** | ✅ |
| Subscriptions | `subscription.html` | App | ✅ | **No** | ✅ |
| Budgets | `budget.html` | App | ✅ | **No** | ✅ |
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

**Rule:** Footer loads on all landing pages, never on app pages. Any page that renders `#sidebar` is an app page and must not load the marketing footer.

---

## 4. Firestore Database Schema

**Auth scope:** All collections are under `users/{userId}/` — each user only sees their own data.

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

All 9 budget fields are optional. Legacy transactions without them keep
working — `DataService.resolveRecordAssignment` falls back to category match.

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
committed-amount calculation (Phase 2 doesn't yet write `linked_transaction_id`,
but the resolver is ready).

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
summary); they do not write to Firestore.

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

### 4e.3. Budgets — `users/{userId}/budgets/{budgetId}`

Operating budgets that drive (a) `OpEx vs Budget` on Overview and `Budget Used`
on the Performance Trend chart, and (b) the live allocation usage on
`/budget`. The Budget page (Phase 1) and `settings-budget.html` operate on
the same active doc so both views stay coherent.

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
| `category_budgets` | map | Optional per-category split. The Budget page dual-writes a denormalized `{category → allocated_amount}` summary derived from `budget_allocations`, so the legacy OpEx-vs-Budget tracker stays in sync. |
| `notes` | string \| null | Optional, ≤500 chars. Written by the Budget page's Create Budget drawer; absent on legacy docs. |
| `created_from_budget_id` | string \| null | Optional source period budget ID when a period is duplicated. |
| `status` | string | `"active"` or `"archived"`. |
| `created_at` / `updated_at` | Timestamp | Server-set. |

**Period budget rule:** the Budget page selects an explicit period budget
instead of editing the latest active budget globally. `getActiveBudget` remains
for compatibility and returns the latest active period budget first, then falls
back to any active budget.

**Audit:** `budget.created`, `budget.updated`, `budget.archived`,
`budget.allocations_updated`.

### 4e.4. Budget Allocations — `users/{userId}/budget_allocations/{allocationId}`

Category-scoped sub-budgets that detail how the main `budgets` doc is split
into operational areas (e.g. Marketing, Infrastructure, Operations, SaaS).
Created via the Budget page's Create / Edit drawer.

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
new budget doc when creating. It only archives allocations that belong to that
same budget, so editing July does not change June. The budget doc, allocation
archive, and new allocation set commit in a **single Firestore
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
updates a `bank_accounts.latest_balance`. Confirm and reject flows are
deferred to Phase 2 (transactions) and Phase 3 (balance).

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

**Audit:** `bank_statement.import_created` is written on draft creation
(`target_collection: "bank_statement_imports"`). Phase 2/3 add
`bank_statement.import_confirmed`, `transaction.create_from_bank_statement`,
and `bank_account.balance_updated`.

`DataService` exposes `createBankStatementImport`, `getBankStatementImport`,
`listBankStatementImports`, `updateBankStatementImport`,
`addBankStatementRows`, `getBankStatementRows`, and
`uploadBankStatementFile`. The shared UI lives in
`assets/js/bank-statement-import.js` and is exposed as
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

#### `internal_users/{userId}` (open: read/create/update; delete blocked)

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
| `created_at`, `updated_at` | Timestamp | `serverTimestamp()`. |

**Population:** each user's own client upserts its own row via
`DataService.syncSelfToInternalIndex(uid, { email, display_name })`, called from the
`sidebar-loader.js` auth handler (every app page load) and from `onboarding.js`
`onSubmit`. Self-sync always refreshes identity/profile fields but **only seeds
status fields on first create** (or advances `not_started`/`in_progress` →
`submitted` on onboarding completion), so a reviewer's decision is never clobbered.
Covers only users who sign in after release; a backfill needs the Admin SDK.

#### `internal_audit_logs/{auditLogId}` (open: read/create; update/delete blocked)

| Field | Type | Notes |
|-------|------|-------|
| `actor_uid` | string \| null | `null` in the credential-gate MVP. |
| `actor_username` | string | `"fluxyos admin"`. |
| `actor_role` | string | `"internal_admin"`. |
| `action` | string | `kyc.approve`, `kyc.request_revision`, `kyc.reject`, `payment.under_review`, `payment.verify`, `payment.reject`, `user.activate`, `user.suspend`, `internal.note.update`. |
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

**Trial mirror (added):** `internal_users/{uid}` also carries `access_status`,
`trial_started_at`, `trial_ends_at`, `trial_days_remaining`, and
`payment_proof_file_name` so the console can show trial/payment status (see §4k).
These are written by `DataService.syncInternalUserAccessIndex`. Internal
`payment_status` has no `not_started`; the trial's `not_started` is simply not
mirrored.

### 4k. Billing Access & 3-Day Trial — `users/{userId}/billing/access`

User-scoped workspace access-state doc. The 3-day trial starts **after onboarding
completion** (not registration). Full spec:
`docs/TRIAL_ACCESS_AND_PAYMENT_BANNER_PLAN.md`.

| Field | Type | Notes |
|-------|------|-------|
| `access_status` | string | `trial_not_started`/`trial_active`/`trial_expiring`/`trial_expired`/`payment_pending`/`payment_submitted`/`payment_verified`/`active`/`suspended`. |
| `trial_duration_days` | number | `3`. |
| `trial_started_at` | Timestamp \| null | = onboarding `completed_at` when available, else creation time. |
| `trial_ends_at` | Timestamp \| null | `trial_started_at + 3 days`. |
| `trial_expired_at` | Timestamp \| null | Set when a trial flips to expired. |
| `payment_required` | bool | |
| `payment_status` | string | `not_started`/`pending`/`submitted`/`under_review`/`verified`/`rejected`. |
| `plan_id` | string \| null | |
| `account_status` | string | `trial`/`active`/`suspended`. |
| `created_at` / `updated_at` | Timestamp | `serverTimestamp()`. |

**Trial start logic:** `completeOnboarding` calls `ensureTrialAccessAfterOnboarding`
(best-effort). It creates the doc only if missing **and** the user is app-accessible
(onboarding completed or legacy-exempt) — retroactively granting current users a trial
on next login. Idempotent — never resets an existing trial.

**Eligibility / locks (client-side, UX only):** `assets/js/trial-access.js`
(`window.FluxyAccessGuard`) renders a slim banner and applies write/export/AI locks
when not active. Wired once in `sidebar-loader.js` so it runs on every app page. Real
enforcement still needs backend/rules (usage counters, server-side expiry).

**Mutation rule:** owner read/create/update only; delete blocked. No secrets, no
formatted currency strings. **Audit:** `trial.created`, `trial.expired`,
`access.activated` (`target_collection: "billing"`).

`DataService` exposes `getBillingAccess`, `createTrialAccess`,
`ensureTrialAccessAfterOnboarding`, `updateBillingAccess`, `expireTrialIfNeeded`,
`syncInternalUserAccessIndex`.

### 4l. Payment Verifications — `users/{userId}/payment_verifications/{paymentId}`

Manual bank-transfer proof submissions feeding the internal Payment Review queue.
Owner-scoped. Submitting **never auto-activates** the account — internal verification
is required.

| Field | Type | Notes |
|-------|------|-------|
| `amount` | number | Raw integer Rupiah. Never a formatted string. |
| `currency` | string | `"IDR"`. |
| `plan_id` | string \| null | |
| `billing_period` | string \| null | `monthly`/`annual`/`custom`. |
| `payment_method` | string | `bank_transfer`/`manual`/`other`. |
| `proof_document_id` | string \| null | → `users/{uid}/documents/{id}` (role `payment_proof`, context `payment`). |
| `proof_file_name` | string \| null | ≤240 chars. |
| `submitted_note` | string \| null | ≤500 chars. |
| `status` | string | `submitted`/`under_review`/`verified`/`rejected`. |
| `reviewer_id` / `reviewer_note` | string \| null | Set by the backend admin phase. |
| `submitted_at`/`reviewed_at`/`created_at`/`updated_at` | Timestamp | |

**Mutation rule:** owner read/create/update only; delete blocked. `submitPaymentVerification`
writes this doc + flips `billing/access` to `payment_submitted` in one batch, then
best-effort denormalizes status metadata (no proof image) onto `internal_users`.
**UI surface:** `payment.html` + `assets/js/payment.js`. **Audit:** `payment.submitted`
(`target_collection: "payment_verifications"`).

`DataService` exposes `getPaymentVerifications`, `getLatestPaymentVerification`,
`submitPaymentVerification`.

---

## 5. Business Logic Rules

### Amount Formatting (Critical)

**Input → Display:** Dots as thousands separators (Indonesian format)
- User types: `1234567`
- Displayed in input: `1.234.567`
- Formula: `value.replace(/\D/g, "").replace(/\B(?=(\d{3})+(?!\d))/g, ".")`

**Display → Stored:** Strip dots, convert to float
- `parseFloat("1.234.567".replace(/\./g, ""))` → `1234567`

**Stored → Displayed in tables:** `"Rp " + Math.abs(amount).toLocaleString()`

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
ledger-style views and today for single-entry dates.

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
- CSV files store **raw integer amounts** (never `Rp 1.234.567` display strings).
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
