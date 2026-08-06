---
status: current
owns: [bank_statement_imports]
updated: 2026-08-07
source: docs/PROJECT_BACKGROUND.md §4 (sharded 2026-08-07)
---

# Bank Statement Imports

> Workspace-scoping rules for these collections live in
> [`PROJECT_BACKGROUND.md` §4](../PROJECT_BACKGROUND.md#4-firestore-database-schema).
> Read that first — it is always loaded; this shard is not.

### 4i. Bank Statement Imports — `users/{userId}/bank_statement_imports/{importId}`

Phase 1 review-drafts for an uploaded bank statement. Spec lives in
`docs/BANK_STATEMENT_IMPORT_AUTOMATION_PLAN.md`. The Phase 1 entry point is
the unified **Scan / Import** button in the Ledger page header — the
drawer that opens hosts a tab strip with **Receipt / Invoice** (the
legacy `document-capture.js` flow) and **Bank Statement** (this draft
flow). The secondary entry point on the Overview Bank Cash Balance card
is reserved for Phase 3.

The draft is never auto-converted into ledger transactions and never updates a
balance without an explicit user action. **Extraction, the Phase 2
confirm-to-ledger flow, and the Phase 3/A bank-account link + balance
certification are all built** (`docs/BANK_RECONCILIATION_PLAN.md`): the review
panel links a `bank_accounts` doc, imported transactions carry the full
cash-impact stamp (`cash_effective: true`, direction, `cash_account_id`), and
after import an explicit **Certify balance** action sets the account's
`latest_balance` to the statement's closing balance and appends a snapshot.
Statement-line ↔ ledger matching (Phase B) is still planned.

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
| `bank_account_id` | string \| null | **Live (recon Phase A):** linked via the review-panel account picker (or created from the detected identity); stamped onto imported transactions as `cash_account_id`. Null until the user links. |
| `reconciliation_status` | string \| null | Recon Phase A: `null` \| `'in_progress'` \| `'certified'`. |
| `certified_at` / `certified_by` / `certified_closing_balance` | mixed \| null | Set only by `certifyBankStatementImport` — updates the linked account's `latest_balance`, emits a `bank_balance_snapshots` doc (`source_type: 'statement_upload'`, `confidence: 'extracted'`), never touches journals. See `docs/BANK_RECONCILIATION_PLAN.md`. |
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
