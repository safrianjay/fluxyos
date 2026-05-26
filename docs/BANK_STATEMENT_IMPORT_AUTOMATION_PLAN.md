# FluxyOS — Bank Statement Import & Cash Balance Automation Plan

## 1. Feature Name

Bank Statement Import & Cash Balance Automation

## 2. Feature Type

Workflow feature + intelligence feature.

This is not a simple upload field. A bank statement import can create many ledger rows, update cash balance, detect duplicate transactions, and become part of the user's financial source of truth.

## 3. Product Decision

Do not treat this as generic Receipt Capture.

Receipt Capture handles individual supporting documents such as receipts, invoices, and payment screenshots.

Bank Statement Import handles account-level financial movement and must follow a stricter workflow:

```text
Upload bank statement / bank balance file
→ Detect document type
→ Extract account, balance, period, and transaction rows
→ Validate balances
→ Detect duplicates and existing ledger matches
→ Show review table
→ User confirms
→ Save selected rows
→ Update bank cash balance only after confirmation
```

The system must never auto-create transactions or update balances without user confirmation.

## 4. Main Objective

Help users convert uploaded bank statement PDFs, CSVs, or spreadsheets into reviewed ledger transactions and an updated bank cash balance without manually entering every row.

## 5. Job To Be Done

When I have a bank statement or bank balance sheet from my bank,
I want FluxyOS to detect the account, period, balances, and money movements,
so I can review, import, and reconcile my ledger without manual entry.

## 6. Target Users

- Business owner
- Founder
- Finance admin
- Accountant
- Operations finance user

## 7. User Problem

Many Indonesian SMB users may not connect bank accounts through open banking yet. They may only have:

- PDF bank statements
- Downloaded CSV/XLS/XLSX bank exports
- Screenshot or PDF balance summaries
- Manual bank balance sheets

Without automation, users must manually type each transaction into the ledger, which creates:

- Missing transactions
- Wrong amounts
- Wrong dates
- Duplicate rows
- Untrusted dashboard numbers
- Wrong cash balance
- Poor cash pressure analysis

## 8. Business Value

This feature makes FluxyOS feel like a finance operating system, not only a manual ledger.

It improves:

- Activation, because users can populate ledger data quickly.
- Trust, because imported data comes from bank statements.
- Retention, because users can refresh cash/ledger data periodically.
- AI usefulness, because Fluxy AI has more grounded finance data.
- Reporting quality, because ledger completeness improves.
- Future bank connection readiness, because manual import prepares the reconciliation model.

## 9. Product Placement

### Primary entry point

Ledger page:

```text
Financial Ledger → Import Bank Statement
```

Place the action near existing header actions, beside or near:

```text
Download CSV
Scan Transaction
Add Transaction
```

Recommended button label:

```text
Import Bank Statement
```

### Secondary entry point

Overview Bank Cash Balance card:

```text
Bank Cash Balance → Import / Update Balance
```

This should open the same import workflow, not a separate implementation.

### Do not place primary upload in Bills

Bills are scheduled payables. A bank statement is actual money movement. The import may later help match paid bills, but the starting point should be Ledger or Bank Cash Balance.

## 10. Relationship to Existing FluxyOS Data

Current financial collections must remain user-scoped:

```text
users/{userId}/transactions
users/{userId}/bills
users/{userId}/subscriptions
users/{userId}/audit_logs
```

This feature adds only user-scoped collections.

Do not create global bank statement collections.

Do not allow cross-user access.

Do not let OpenAI query Firestore directly.

## 11. Phase Strategy

### Phase 1 — Import Draft & Review Only

Goal:
Upload and extract a bank statement into a safe review draft.

In scope:

- Add Ledger entry point: Import Bank Statement.
- Add import drawer/modal.
- Accept PDF, CSV, XLS, XLSX where technically possible.
- Store upload metadata under user scope.
- Detect document type.
- Detect bank/account/period/opening balance/closing balance when available.
- Extract transaction rows into import draft rows.
- Show summary and review table.
- Run validation checks.
- Do not save transactions yet unless explicitly included in Phase 2.
- Do not update bank cash balance yet unless explicitly included in Phase 3.
- Use fallback states for unsupported/low-confidence files.

Out of scope:

- Auto-save to ledger.
- Auto-update balance.
- Auto-mark bills paid.
- Real bank API connection.
- Full reconciliation engine.
- Vendor/category rule builder.
- AI auto-categorization without review.
- Payment execution.
- Workspace/multi-user approval flow.

### Phase 2 — Confirmed Ledger Import

Goal:
Allow user to select rows and create ledger transactions after confirmation.

In scope:

- Row-level review.
- Select/import/ignore rows.
- Duplicate detection.
- Possible match detection.
- Confirm import summary.
- Create transactions only after user confirms.
- Link every created transaction to source statement import and row.
- Keep audit trail if audit system is available.

### Phase 3 — Bank Account & Cash Balance Update

Goal:
Create/update a bank account record and update cash balance after confirmed import.

In scope:

- Create `bank_accounts` collection.
- Store masked account identity.
- Store current balance, balance source, and balance as-of date.
- Update balance only after user confirmation.
- Show Bank Cash Balance card based on confirmed bank account balance.

### Phase 4 — Reconciliation

Goal:
Match bank rows to existing ledger records, bills, and subscriptions.

In scope:

- Match existing transaction.
- Possible duplicate.
- Match bill payment after user review.
- Match subscription payment after user review.
- Reconciliation status on imported rows and transactions.

### Phase 5 — Rules & Learning

Goal:
Suggest recurring mappings based on descriptions.

In scope:

- Description keyword rules.
- Vendor/category/type suggestions.
- User-confirmed learning.
- No silent auto-save without user preference and safeguards.

## 12. Accepted File Types

Phase 1 should allow:

```text
.pdf
.csv
.xls
.xlsx
```

PDF is common, but CSV/XLS/XLSX should be supported because machine-readable exports are often more reliable than scanned PDFs.

If the file is image-only or scanned PDF and the backend cannot extract tables reliably, return:

```text
This statement needs manual review. We detected the file but could not extract reliable rows.
```

## 13. Detection Requirements

The system should attempt to detect:

```json
{
  "document_type": "bank_statement",
  "bank_name": "BCA",
  "account_holder": "PT Example Indonesia",
  "account_number_masked": "****1234",
  "currency": "IDR",
  "statement_period": {
    "start_date": "2026-05-01",
    "end_date": "2026-05-31"
  },
  "opening_balance": 120000000,
  "closing_balance": 114500000,
  "row_count": 42
}
```

If fields are missing, keep them nullable and show clear review warnings. Do not invent bank/account/balance values.

## 14. Extracted Row Requirements

Each extracted row should support:

```json
{
  "row_index": 1,
  "transaction_date": "2026-05-03",
  "posting_date": "2026-05-03",
  "description_raw": "TRSF E-BANKING AWS",
  "debit": 450000,
  "credit": 0,
  "running_balance": 119550000,
  "suggested_vendor_name": "AWS",
  "suggested_category": "Infrastructure",
  "suggested_type": "expense",
  "confidence": 0.86,
  "match_status": "new"
}
```

Important:

- Store debit and credit as raw numbers.
- Never store formatted `Rp` strings in Firestore.
- Use display formatting only in UI.
- If both debit and credit are present in one row, flag as invalid.
- If neither debit nor credit exists, flag as invalid or informational.

## 15. Type Mapping Logic

Suggested mapping:

| Bank statement signal | FluxyOS transaction type |
|---|---|
| Credit / CR / Masuk | `income` |
| Debit / DB / Keluar | `expense` |
| Admin bank fee | `fee` |
| Pajak / tax | `tax` |
| Transfer to own account | `transfer` |
| Refund received | `refund` |

Mapping must be treated as a suggestion. User review is required.

## 16. Validation Logic

### Balance equation

If opening and closing balances are available:

```text
opening_balance + total_credit - total_debit = closing_balance
```

If this fails, set:

```text
balance_check_status = "failed"
review_status = "needs_review"
```

Do not allow one-click import without review.

### Running balance check

If row-level running balances exist:

```text
previous_running_balance + credit - debit = current_running_balance
```

Rows that fail should be flagged.

### Duplicate detection

Compare each extracted row against existing transactions.

Possible duplicate if:

```text
same or near date
same amount
similar vendor/description
same type direction
```

Statuses:

```text
new
possible_duplicate
matched_existing
ignored
needs_review
```

### Period overlap

If the user already imported the same account and overlapping statement period, show:

```text
This statement overlaps with an existing import.
```

### Account mismatch

If the selected account does not match detected account identity, show:

```text
This statement appears to belong to a different bank account.
```

## 17. Firestore Data Model

### Bank accounts

Path:

```text
users/{userId}/bank_accounts/{bankAccountId}
```

Fields:

```js
{
  bank_name: "BCA",
  account_name: "Main Operating Account",
  account_holder_name: "PT Example Indonesia",
  account_number_masked: "****1234",
  currency: "IDR",
  current_balance: 114500000,
  balance_source: "statement_import",
  balance_as_of: "2026-05-31",
  created_at,
  updated_at
}
```

### Bank statement imports

Path:

```text
users/{userId}/bank_statement_imports/{importId}
```

Fields:

```js
{
  bank_account_id,
  file_name,
  file_mime_type,
  file_size,
  storage_path,

  document_type: "bank_statement",
  extraction_status: "pending | processing | completed | failed",
  review_status: "draft | needs_review | ready_to_import | imported | rejected",

  bank_name,
  account_holder,
  account_number_masked,
  currency,

  statement_start_date,
  statement_end_date,
  opening_balance,
  closing_balance,
  total_debit,
  total_credit,
  row_count,

  balance_check_status: "passed | failed | unavailable",
  running_balance_check_status: "passed | failed | unavailable",
  duplicate_count,
  needs_review_count,

  created_at,
  confirmed_at,
  imported_at
}
```

### Extracted rows

Path:

```text
users/{userId}/bank_statement_imports/{importId}/rows/{rowId}
```

Fields:

```js
{
  row_index,
  transaction_date,
  posting_date,
  description_raw,
  debit,
  credit,
  running_balance,

  suggested_vendor_name,
  suggested_category,
  suggested_type,

  match_status: "new | possible_duplicate | matched_existing | ignored | needs_review",
  matched_transaction_id,
  confidence,

  selected_for_import: true,
  review_status: "pending | confirmed | ignored",
  created_transaction_id
}
```

### Confirmed transaction records

Path:

```text
users/{userId}/transactions/{transactionId}
```

Additional fields for imported transactions:

```js
{
  source: "bank_statement_import",
  bank_statement_import_id,
  bank_statement_row_id,
  bank_account_id,
  imported_at
}
```

## 18. Storage Path

Use user-scoped file storage only.

```text
users/{userId}/bank_statement_imports/{importId}/{fileName}
```

Do not store public financial documents.

Do not log file contents to the browser console.

## 19. Backend API Design

The frontend should not call OpenAI directly.

Recommended backend endpoints:

```text
POST /api/v1/bank-statements/imports
GET  /api/v1/bank-statements/imports/{importId}
POST /api/v1/bank-statements/imports/{importId}/confirm
POST /api/v1/bank-statements/imports/{importId}/reject
```

### POST `/api/v1/bank-statements/imports`

Responsibilities:

- Verify authenticated user.
- Validate file type and size.
- Store file safely.
- Create import record.
- Extract raw text/table rows.
- Use deterministic parsing where possible.
- Use OpenAI structured extraction only through backend where needed.
- Save extracted rows under user scope.
- Return import summary.

### POST `/confirm`

Responsibilities:

- Verify authenticated user.
- Re-read import draft.
- Validate selected rows.
- Skip ignored rows.
- Avoid duplicate rows unless user explicitly confirms.
- Create transactions.
- Optionally create/update bank account only if included in current phase.
- Mark import as imported.
- Create audit logs if audit infrastructure is active.

## 20. AI Extraction Rules

OpenAI can help with:

- Document type detection.
- Bank/account/period extraction.
- Row extraction from unstructured text.
- Vendor/category/type suggestions.
- Explanation of low-confidence rows.

OpenAI must not:

- Query Firestore.
- Save transactions directly.
- Update bank balance directly.
- Mark bills paid.
- Create payments.
- Invent missing balances.
- Override validation checks.
- Hide uncertainty.

Use structured output schema.

Recommended schema groups:

```text
statement_metadata
statement_transactions[]
validation_notes[]
confidence
```

## 21. Frontend UX

### Entry point

Ledger page header:

```text
Import Bank Statement
```

Overview Bank Cash Balance card:

```text
Import / Update Balance
```

Both open the same workflow.

### Step 1 — Upload

Drawer/modal title:

```text
Import Bank Statement
```

Copy:

```text
Upload a bank statement PDF, CSV, or spreadsheet. FluxyOS will extract transactions and show a review before anything is saved.
```

### Step 2 — Processing

Show:

```text
Reading statement...
Detecting account, balances, and transaction rows.
```

### Step 3 — Detection Summary

Show:

```text
Detected bank: BCA
Account: ****1234
Period: 1 May 2026 - 31 May 2026
Opening balance: Rp 120.000.000
Closing balance: Rp 114.500.000
Rows detected: 42
Balance check: Passed
Possible duplicates: 3
Needs review: 6
```

### Step 4 — Review Table

Columns:

```text
Date
Description
Money in
Money out
Balance
Suggested type
Suggested category
Match status
Action
```

Row actions:

```text
Import
Ignore
Match existing
Edit
```

### Step 5 — Confirm

Copy:

```text
You are about to import 36 new transactions, ignore 3 rows, and match 3 existing ledger records. Bank cash balance will be updated to Rp 114.500.000 as of 31 May 2026.
```

Buttons:

```text
Cancel
Confirm Import
```

If balance update is not included in current phase, remove balance update from confirmation copy.

## 22. UI States

Required states:

- Default upload
- Uploading
- Processing
- Extracted successfully
- Needs review
- Failed extraction
- Unsupported file
- Balance check failed
- Duplicate warning
- Empty rows
- Confirming import
- Import success
- Import error
- Permission error

## 23. Security Rules

All writes must stay under authenticated user scope.

Firestore:

```text
users/{userId}/bank_accounts
users/{userId}/bank_statement_imports
users/{userId}/bank_statement_imports/{importId}/rows
users/{userId}/transactions
```

Storage:

```text
users/{userId}/bank_statement_imports/{importId}/{fileName}
```

Validation:

- Authenticated user only.
- User can access only their own files and records.
- File size limit.
- Allowed content types only.
- Never store bank login credentials.
- Never store full bank account numbers if not needed.
- Mask account numbers.

## 24. Audit Requirements

When import confirms transactions or updates bank balance, create audit logs if the current project supports them.

Audit action examples:

```text
bank_statement.import_created
bank_statement.import_confirmed
transaction.create_from_bank_statement
bank_account.balance_updated
```

Each audit log should include:

- actor_uid
- action
- target_collection
- target_id
- before
- after
- source = "bank_statement_import"
- created_at

## 25. Out of Scope

For MVP, do not build:

- Direct bank connection.
- Payment execution.
- Auto-paid bill marking.
- Auto-reconciliation without review.
- Vendor profile creation.
- AI autonomous ledger writes.
- Multi-entity bank account routing.
- Open banking connection.
- Bank credential storage.
- Global bank statement dataset.
- Workspace-level permissions unless workspace migration is already active.

## 26. Acceptance Criteria

Phase 1 is complete when:

- Ledger page shows Import Bank Statement.
- User can upload supported file type.
- Invalid type and oversized file are rejected with friendly UI.
- Import draft is created under user scope.
- Statement metadata is shown when detected.
- Extracted rows appear in review table.
- Balance check is shown as passed, failed, or unavailable.
- Duplicate candidates are flagged if duplicate logic is included.
- No transaction is created without user confirmation.
- No bank balance is updated without user confirmation.
- Firestore and Storage paths are user-scoped.
- Existing ledger Add Transaction, Scan Transaction, CSV import, date filter, search, sort, pagination, and CSV export still work.
- No standalone sidebar page is created unless explicitly requested.

## 27. QA Checklist

Run:

- Smoke Tests
- Dashboard/App Page Changes
- Ledger table/search/filter/date/export checks
- Add Transaction modal regression
- Database & Logic Verification
- Security checks for user-scoped reads/writes
- Storage upload checks
- Mobile 375px
- Desktop 1280px
- Browser console clean
- Cross-page regression if shared files are touched

## 28. Implementation Guardrails

Do not:

- Refactor unrelated pages.
- Change sidebar IA.
- Rename existing DOM IDs used by JS.
- Change existing transaction schema in a breaking way.
- Store formatted money strings.
- Trust AI output without deterministic validation.
- Save rows with missing amount/date unless user edits them.
- Mark bills paid automatically.
- Create payment actions.
- Print sensitive statement data in console logs.

## 29. Final Product Rule

Bank Statement Import should always be:

```text
Detect → Extract → Validate → Review → Confirm → Save
```

The user owns the final decision. FluxyOS can assist, suggest, and validate, but it must not silently change the ledger or bank balance.
