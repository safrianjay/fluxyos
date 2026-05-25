# FluxyOS Receipt & Document Attachment Plan

## 1. Purpose

Enable receipt, invoice, revenue proof, and payment proof attachment across the existing FluxyOS finance entry points without creating redundant upload flows.

This is **not** a standalone Receipt Capture page implementation yet.

The goal is to create one shared document workflow that can be reused by:

- Add Transaction drawer
- Add Revenue drawer
- Bill Details drawer
- Future Receipt Capture operations inbox
- Future WhatsApp document upload
- Future AI document extraction and review

## 2. Product Principle

Receipt capture must follow this logic:

```text
Attach / Upload
→ Validate
→ Optional AI extraction
→ Review / mismatch warning
→ User confirms
→ Save or link to the correct record
```

Never auto-save extracted data.
Never auto-mark a bill as paid.
Never create a ledger transaction from a bill/invoice without user confirmation.

## 3. Current Entry Points

### 3.1 Add Transaction drawer

Existing state:

- Drawer title can be `Add Transaction`
- Tabs: `Single transaction`, `CSV bulk upload`
- Form includes:
  - Amount
  - Vendor / Description
  - Transaction Date
  - Category
  - Type
  - Status
  - Receipt optional

Recommended behavior:

- Keep the existing drawer layout.
- Keep `Single transaction` and `CSV bulk upload`.
- Do not add a third tab in Phase 1.
- Improve the existing `Receipt (optional)` section into a shared document attachment component.
- The user is already entering the transaction manually, so document attachment should support proof/linking first.

### 3.2 Add Revenue drawer

Existing state:

- Same base drawer as Add Transaction
- Category = Revenue
- Type = Income
- Receipt optional exists

Recommended behavior:

- Use the same shared attachment component.
- Label should be context-aware:
  - For expense transaction: `Receipt (optional)`
  - For revenue/income: `Proof / document (optional)` or `Attach proof of income`
- Revenue proof can include:
  - Payment screenshot
  - Bank transfer proof
  - Settlement report
  - Paid invoice confirmation
  - Platform payout evidence

Do not force revenue documents into receipt language.

### 3.3 Bill Details drawer

Existing state:

- Drawer title: `Bill Details`
- Shows vendor, category, amount, due date, created date
- Shows Payment Readiness copy
- Existing disabled actions:
  - Attach Invoice
  - Convert to Transaction
  - Mark as Paid

Recommended behavior:

#### Attach Invoice

Meaning:

```text
Attach source invoice/document to this bill.
```

Rules:

- Attach-only in Phase 1.
- Do not create a transaction.
- Do not mark bill as paid.
- Store invoice document metadata and link it to the bill.
- Keep the bill as payable until user confirms payment separately.

#### Convert to Transaction

Meaning:

```text
This bill has been paid. Create an expense transaction from this bill.
```

Rules:

- Must open a review-confirm flow.
- Pre-fill:
  - vendor_name from bill
  - amount from bill
  - category from bill
  - type = expense
  - status = Completed unless missing receipt/invoice
  - date = today by default, editable to previous date
- Create a transaction only after user confirmation.
- Link the new transaction to the bill.
- Mark bill as paid only after the user confirms the conversion.
- Do not ship this in Phase 1 unless audit/confirmation logic is completed.

## 4. Feature Type

Workflow feature + component-level enhancement.

It is not yet a page-level feature.

## 5. Main Objective

Create one shared document attachment workflow so receipts, invoices, and proof documents can be attached to finance records consistently without duplicated upload implementations.

## 6. Job To Be Done

When I create or review a financial record,
I want to attach the supporting document in the same place,
so I can keep my ledger, bills, and revenue records trustworthy without managing files separately.

## 7. Target Users

- Business owner
- Finance admin
- Accountant
- Founder
- Operations manager

## 8. Problems This Solves

- Users can attach proof while creating a transaction.
- Users can attach invoices to bills without converting them to transactions.
- Users can avoid duplicate file upload implementations.
- Users can later use the same foundation for AI extraction and WhatsApp upload.
- Finance data becomes more auditable and trustworthy.

## 9. Product Placement Logic

Do not start with a new Receipt Capture page.

Use current entry points first:

| Entry Point | Phase 1 Behavior | Later Behavior |
|---|---|---|
| Add Transaction drawer | Attach receipt/proof file | AI validates/extracts and warns mismatch |
| Add Revenue drawer | Attach proof/document | AI detects payment proof / revenue evidence |
| Bill Details drawer | Attach invoice to bill | Convert bill to transaction after review |
| Sidebar Receipt Capture | Keep disabled `Soon` | Future upload/review inbox |

A dedicated Receipt Capture page should only be created when FluxyOS needs an operational queue for uploaded documents:

- Needs review
- Matched
- Unmatched
- Saved
- Rejected
- Failed extraction

## 10. Scope

### Phase 1 In Scope

- Create shared document attachment logic.
- Use it in the existing Add Transaction/Add Revenue drawer receipt area.
- Use it in Bill Details Attach Invoice if current bill drawer code supports it safely.
- Validate file type and size.
- Show selected filename.
- Show remove/replace behavior.
- Store file metadata in Firestore.
- Preserve existing Add Transaction, Add Revenue, Add Bill, CSV import, and Bill Details behavior.
- Use authenticated user scope only.
- Add safe fallback states.

### Phase 1 Out of Scope

- Standalone Receipt Capture page.
- AI extraction.
- OCR.
- Auto-prefill from receipt.
- Auto-save.
- Auto-match to existing transactions.
- Auto-mark bill paid.
- Payment execution.
- Multi-user approvals.
- WhatsApp upload.
- Vendor profile creation.
- Complex document management UI.
- Permanent delete of financial documents.

### Phase 2 In Scope

- Optional backend AI extraction endpoint.
- Extract fields into structured JSON.
- Show mismatch warnings before save.
- Suggest category/type/date/vendor/amount.
- Allow user to review and confirm extracted fields.
- Attach document to existing Missing Receipt transaction.
- Link receipt upload to transaction.

### Phase 3 In Scope

- Receipt Capture operations page.
- Document review queue.
- Matched/unmatched records.
- Saved/rejected history.
- WhatsApp upload integration.
- AI document Q&A.

## 11. Shared Document Attachment Engine

Create or extend a reusable module.

Recommended file:

```text
assets/js/document-attachment.js
```

Alternative if project conventions prefer fewer files:

```text
assets/js/shared-dashboard.js
```

But avoid scattering upload logic across multiple page files.

### Required Public API

```js
window.FluxyDocumentAttachment = {
  validateFile(file, options),
  createAttachmentComponent(options),
  uploadDocument(userId, file, options),
  attachDocumentToRecord(userId, payload),
  removePendingAttachment(attachmentId),
  buildDocumentMetadata(file, options)
}
```

### Suggested Main Flow

```js
documentAttachmentFlow({
  sourceContext: "transaction" | "revenue" | "bill" | "subscription",
  targetCollection: "transactions" | "bills" | "subscriptions",
  targetId: null | "existingRecordId",
  documentRole: "receipt" | "invoice" | "payment_proof" | "revenue_proof",
  mode: "attach_only" | "extract_and_prefill" | "convert_after_confirm"
});
```

### Modes

| Mode | Meaning |
|---|---|
| `attach_only` | Upload/link document only |
| `extract_and_prefill` | Future AI flow that extracts fields for user review |
| `convert_after_confirm` | Future bill-to-transaction review flow |

## 12. File Validation Rules

Phase 1 allowed types:

```text
image/jpeg
image/png
image/webp
application/pdf
```

Recommended max size:

```text
5MB
```

If the current UI says max 1MB, either:

1. Keep 1MB for Phase 1 to avoid UI changes, or
2. Update copy and validation together to 5MB.

Do not update the copy without updating validation.

### Error Messages

Use friendly messages:

- `This file type is not supported. Please upload JPG, PNG, WebP, or PDF.`
- `This file is too large. Please compress it and try again.`
- `We could not attach this document. Please try again.`
- `You need to sign in again before uploading this document.`

## 13. Storage Path

Use user-scoped Firebase Storage paths:

```text
users/{userId}/documents/{documentId}/{fileName}
```

Examples:

```text
users/abc123/documents/doc_789/aws-receipt.jpg
users/abc123/documents/doc_790/epson-invoice.pdf
```

Do not store documents in a global path.

## 14. Firestore Data Model

### 14.1 Document metadata collection

Recommended path:

```text
users/{userId}/documents/{documentId}
```

Recommended fields:

```js
{
  file_name: "aws-receipt.jpg",
  file_mime_type: "image/jpeg",
  file_size: 428102,
  storage_path: "users/{userId}/documents/{documentId}/aws-receipt.jpg",

  document_role: "receipt", // receipt | invoice | payment_proof | revenue_proof | unknown_finance_document
  source_context: "transaction", // transaction | revenue | bill | subscription
  target_collection: "transactions", // transactions | bills | subscriptions | null
  target_id: null,

  upload_status: "uploaded", // pending | uploaded | failed | removed
  extraction_status: "not_requested", // not_requested | pending | completed | failed
  review_status: "not_required", // not_required | needs_review | confirmed | rejected

  created_at: serverTimestamp(),
  updated_at: serverTimestamp()
}
```

### 14.2 Transaction attachment fields

When saving a transaction with attached receipt/proof, prefer the generic array:

```js
{
  attached_documents: [
    {
      document_id: "doc_123",
      role: "receipt",
      storage_path: "users/{userId}/documents/doc_123/file.jpg",
      attached_at: Timestamp
    }
  ]
}
```

For backward compatibility with the existing ledger receipt thumbnail, image uploads on transactions ALSO dual-write the legacy `receipt_url` field with the Storage download URL.

### 14.3 Bill attachment fields

When attaching invoice to bill:

```js
{
  attached_documents: [
    {
      document_id: "doc_456",
      role: "invoice",
      storage_path: "users/{userId}/documents/doc_456/invoice.pdf",
      attached_at: Timestamp
    }
  ],
  invoice_status: "attached"
}
```

Do not create a transaction from invoice attachment.

## 15. AI Extraction Model For Future Phase

AI extraction is not Phase 1 unless backend support already exists.

When implemented, extraction must happen on the FastAPI backend only.

Frontend must not call OpenAI directly.

### Suggested Backend Endpoint

```text
POST /api/v1/documents/extract
```

Request:

```json
{
  "document_id": "doc_123",
  "source_context": "transaction",
  "document_role": "receipt"
}
```

Response:

```json
{
  "document_id": "doc_123",
  "detected_document_type": "receipt",
  "confidence": 0.86,
  "extracted_fields": {
    "vendor_name": "AWS",
    "amount": 450000,
    "currency": "IDR",
    "transaction_date": "2026-05-25",
    "category": "Infrastructure",
    "type": "expense",
    "status": "Completed"
  },
  "warnings": [
    {
      "field": "amount",
      "message": "Extracted amount differs from the entered amount."
    }
  ]
}
```

### Extraction Rules

- OpenAI is used for document understanding and structured extraction only.
- Backend validates the result.
- Backend does not write transaction/bill/subscription records automatically.
- User must review and confirm before any save.
- If confidence is low, show `Needs review`.

## 16. Mismatch Warning Logic

Future Phase 2 behavior:

When user attaches a document to a manually filled transaction, compare extracted fields with form fields.

Check:

- vendor_name
- amount
- date
- category
- type

If mismatch exists, show warning before save:

```text
The attached receipt looks different from the transaction details.
Please review before saving.
```

Examples:

- Receipt amount is Rp 450.000 but transaction amount is Rp 500.000.
- Receipt vendor is AWS but transaction vendor is Vercel.
- Receipt date is May 20 but transaction date is May 25.

Do not block save unless the user chooses to fix it. Show clear confirmation.

## 17. UX Requirements

### Add Transaction / Add Revenue drawer

Keep existing visual alignment.

The attachment area should show:

Default:

```text
Attach receipt image
JPG, PNG, WebP, or PDF · Max 5MB
```

After selection:

```text
aws-receipt.jpg
428 KB
[Replace] [Remove]
```

Uploading:

```text
Uploading document...
```

Success:

```text
Document attached
```

Error:

```text
Could not attach document. Try again.
```

### Bill Details drawer

`Attach Invoice` becomes active. Convert to Transaction and Mark as Paid remain disabled.

Default:

```text
Attach Invoice
```

After attached:

```text
Invoice attached
View / Replace
```

The action does not affect bill payment status.

### Button behavior

- The main transaction submit button remains disabled until required transaction fields are valid.
- Attachment is optional unless the status is `Missing Receipt` and the user is resolving that status.
- File upload errors should not erase the form.
- Closing the drawer should clear pending unsaved attachment state unless the record was saved.

## 18. Security Rules

### Firestore

All document metadata must be scoped under:

```text
users/{userId}/documents
```

Only authenticated owner can read/write.

### Storage

All files must be scoped under:

```text
users/{userId}/documents
```

Rules should ensure:

- `request.auth != null`
- `request.auth.uid == userId`
- file size is within limit (5MB)
- content type is allowed (image/jpeg, image/png, image/webp, application/pdf)

Example intent:

```js
match /users/{userId}/documents/{documentId}/{fileName} {
  allow read, write: if request.auth != null
    && request.auth.uid == userId
    && request.resource.size < 5 * 1024 * 1024
    && request.resource.contentType in ['image/jpeg','image/png','image/webp','application/pdf'];
}
```

## 19. Data Integrity Rules

- Amount remains a raw number.
- Do not store formatted `Rp` strings.
- Do not duplicate file metadata across multiple places unless needed for display.
- Use `document_id` links instead of copying full file data into transactions/bills.
- Do not store public download URLs unless the existing project already handles secure token lifecycle.
- Prefer `storage_path` for controlled access.
- Do not log sensitive file metadata to browser console.

## 20. Required Files To Inspect Before Implementation

Read:

```text
CLAUDE.md
docs/PROJECT_BACKGROUND.md
docs/product_ux_feature_intake_framework.md
docs/SYSTEM_DESIGN.md
docs/SECURITY_SYSTEM.md
docs/QA_CHECKLIST.md
assets/js/shared-dashboard.js
assets/js/db-service.js
assets/js/sidebar-loader.js
bill.html
ledger.html
dashboard.html
```

## 21. Files Likely To Change

Expected:

```text
assets/js/shared-dashboard.js
assets/js/db-service.js
assets/js/document-attachment.js (new)
bill.html
firestore.rules
storage.rules
docs/PROJECT_BACKGROUND.md
docs/QA_CHECKLIST.md
```

Do not change unrelated landing pages.

## 22. Implementation Plan

### Step 1: Audit current implementation

Find:

- Existing receipt upload input in Add Transaction drawer
- Existing CSV upload state
- Existing Add Transaction submit flow
- Existing Bill Details drawer logic
- Existing disabled Attach Invoice action
- Existing DataService methods

Document what exists before editing.

### Step 2: Add shared attachment state

Create one shared state object:

```js
const pending = {
  file: null,
  documentRole: null,
  sourceContext: null,
  uploadStatus: "idle",
  documentId: null,
  storagePath: null,
  error: null
};
```

Reset when drawer closes.

### Step 3: Validate file selection

Implement validation for:

- type (jpeg/png/webp/pdf)
- size (<=5MB)
- required auth
- empty file

### Step 4: Update drawer UI

Replace dumb receipt area with component states:

- empty
- selected
- uploading
- attached
- error

Do not break existing tab switching.

### Step 5: Save metadata

On transaction save:

- Upload file if selected.
- Create document metadata under `users/{userId}/documents`.
- Save transaction with `attached_documents`.
- For images: dual-write legacy `receipt_url` so existing ledger thumbnails still work.
- If file upload fails, show error and do not silently save incomplete attachment.

### Step 6: Bill invoice attach

- Enable `Attach Invoice`.
- Let user select invoice file.
- Upload file and create document metadata.
- Update bill with `attached_documents` and `invoice_status: "attached"`.
- Do not convert bill to transaction.
- Do not mark bill paid.

### Step 7: QA

Run relevant QA checks per §24 and `docs/QA_CHECKLIST.md`.

## 23. Acceptance Criteria

Phase 1 is complete when:

- Existing receipt field is upgraded to a working shared attachment component.
- Add Transaction works with and without attachment.
- Add Revenue works with and without attachment.
- CSV bulk upload still works exactly as before.
- File type and size validation are handled (jpeg/png/webp/pdf, 5MB).
- Uploaded file metadata is saved under authenticated user scope.
- Transaction document links to attached document metadata.
- Bill invoice attachment is implemented (attach-only).
- No standalone Receipt Capture page is created.
- No AI extraction is implemented.
- No bill is marked paid by attaching an invoice.
- No duplicate upload logic is created per entry point.
- QA checklist is completed.

## 24. Manual QA Checklist

### Add Transaction

- Open Add Transaction drawer.
- Select Manual Entry.
- Fill amount, vendor, date, category, type, status.
- Attach JPG file.
- Confirm filename appears.
- Remove file.
- Attach again.
- Submit.
- Verify transaction appears in ledger.
- Verify document metadata exists under user scope.
- Verify transaction has attached document reference.

### Add Revenue

- Open Add Revenue drawer.
- Confirm label says `Proof / document` or equivalent.
- Attach valid file.
- Submit.
- Verify revenue transaction is saved correctly.
- Verify category/type remain Revenue/Income.

### CSV Import

- Open Add Transaction drawer.
- Switch to CSV bulk upload.
- Upload valid CSV.
- Confirm CSV flow still works.
- Confirm attachment component does not interfere with CSV state.

### Invalid Files

- Try unsupported file type.
- Try file over max size.
- Confirm friendly error.
- Confirm form data remains intact.

### Bill Details

- Open bill detail drawer.
- Click Attach Invoice.
- Attach invoice.
- Confirm bill remains unpaid.
- Confirm no transaction is created.
- Confirm invoice metadata is linked to bill.

### Regression

- Dashboard loads.
- Ledger loads.
- Bills page loads.
- Subscriptions page loads.
- Sidebar works.
- No console errors.
- Mobile layout has no horizontal overflow.

## 25. Final Implementation Report Template

After implementation, report:

```text
Implemented:
- ...

Files changed:
- ...

Data model changes:
- ...

Security notes:
- ...

QA completed:
- ...

Not implemented / intentionally deferred:
- ...

Risks or follow-up:
- ...
```

## 26. Do Not Do

- Do not create `receipt-capture.html` in Phase 1.
- Do not add a new sidebar route.
- Do not make a third tab unless explicitly approved.
- Do not create separate upload logic for each entry point.
- Do not call OpenAI from frontend.
- Do not auto-save AI extracted fields.
- Do not auto-mark bills as paid.
- Do not convert bill to transaction from invoice attach.
- Do not store `Rp` formatted strings in Firestore.
- Do not store uploaded files globally.
- Do not break CSV import.
- Do not refactor unrelated files.
