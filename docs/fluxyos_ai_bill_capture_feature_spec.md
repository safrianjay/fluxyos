# FluxyOS Feature Spec — AI Bill Capture & Auto-Generated Bill Result

## 0. Purpose

Build a comprehensive bill upload and extraction feature for FluxyOS.

The feature lets users upload a bill, invoice, receipt, or payment document from either an online source or an offline physical bill photo. FluxyOS scans the document, extracts structured bill data, validates it, then places the result into the correct part of the platform: primarily the Bills page, with optional transaction linkage into the Ledger when the bill is marked as paid later.

This feature should feel like a finance operations workflow, not just an image upload.

---

## 1. Feature Type

**Workflow feature + Intelligence feature**

Why:
- It is a multi-step user workflow: upload → scan → review → save → track.
- It uses AI/OCR intelligence to extract vendor, amount, due date, category, and confidence.
- It directly improves the Bills module, which already exists in FluxyOS.

---

## 2. Product Context

FluxyOS is a financial operations platform for Indonesian businesses. The app already has:
- A Bills page at `bill.html`
- Firestore user-scoped `users/{userId}/bills`
- Add Bill modal using shared transaction modal logic
- A bills table ordered by newest first
- Bill status and due date display
- A Pay Now button that currently exists as a stub
- Firebase Auth and Firestore
- Static HTML + Tailwind CDN + Vanilla JS
- FastAPI backend in `main.py`, currently only with limited API endpoints

The current Bills module requires users to manually enter bill information. This creates friction because business owners and finance admins often receive bills as screenshots, PDF invoices, WhatsApp images, email attachments, paper receipts, vendor invoices, or SaaS billing documents.

The missing capability is automatic bill intake.

---

## 3. Main Objective

Help users convert bill documents into structured FluxyOS bill records with minimum manual entry and strong validation before saving.

---

## 4. Job To Be Done

When I receive a bill from a vendor, bank, marketplace, SaaS provider, or offline receipt,
I want to upload or photograph it and have FluxyOS automatically extract the important payment details,
so I can track, review, and schedule payment without manually typing everything.

---

## 5. Target Users

- Business owner
- Finance admin
- Founder
- Operations manager
- Accountant

---

## 6. User Problem

Users receive bills from many channels and formats:
- Offline printed receipts
- PDF invoices
- Screenshots
- WhatsApp images
- Email attachments
- Vendor invoices
- Bank transfer requests
- SaaS billing notices
- Marketplace supplier bills

Manual input is slow, error-prone, and often inconsistent. A user may mistype the amount, forget the due date, assign the wrong category, or save the bill without enough proof.

This weakens trust in the Bills page and makes FluxyOS feel less operational.

---

## 7. Business Value

This feature increases FluxyOS value because it:
- Reduces manual finance admin work
- Makes the Bills page more useful and differentiated
- Improves data completeness
- Supports future approval, audit log, and pay-now workflows
- Creates a strong AI-native finance operation experience
- Gives FluxyOS a clear product capability beyond basic ledger tracking

---

## 8. Product Placement Logic

### Primary placement

This feature belongs on the **Bills page** at `bill.html`.

Reason:
- The uploaded document represents a payable obligation.
- The immediate output is a bill record, not a completed transaction.
- The user needs to review extracted bill details before saving to `users/{userId}/bills`.

### Secondary placement

A future **Receipt Capture** page may reuse the same extraction engine, but this feature should not wait for that page.

### Relationship to Ledger

Do not automatically create a transaction in `users/{userId}/transactions` when a bill is uploaded.

A bill is not the same as a paid transaction.

Correct logic:
- Upload bill → create/update record in `users/{userId}/bills`
- Mark as paid later → create corresponding expense transaction in `users/{userId}/transactions`
- Keep source document reference attached to the bill and optionally attached to the generated transaction after payment

---

## 9. UX Principle

The user should never feel that AI secretly changed their financial data.

The extraction result must be shown as a review screen before saving. Every extracted field should be editable. Low-confidence fields should be visibly marked.

Core UX rule:

**AI suggests. User confirms. FluxyOS saves.**

---

## 10. User Flow

### Flow A — Upload from Bills page

1. User opens `bill.html`.
2. User clicks **Scan Bill** or **Upload Bill**.
3. A right-side drawer opens.
4. User uploads a file:
   - JPG
   - PNG
   - WebP
   - PDF
5. FluxyOS shows upload preview.
6. User clicks **Scan Bill**.
7. System processes the file.
8. Extraction result appears in a review form.
9. User edits fields if needed.
10. User clicks **Save Bill**.
11. Bill is saved to `users/{userId}/bills`.
12. Bills table refreshes.
13. Toast appears: `Bill scanned and added to your schedule.`

### Flow B — Offline physical bill photo

1. User takes a photo of a paper bill or receipt.
2. User uploads it into the drawer.
3. System detects rotation, blur risk, and unreadable image risk if possible.
4. System extracts bill data.
5. User reviews and corrects.
6. User saves the bill.

### Flow C — Low-confidence result

1. User uploads a document.
2. System scans the file but cannot confidently detect one or more fields.
3. Drawer shows extracted fields with confidence labels.
4. Missing fields are highlighted.
5. User must complete required fields before saving.
6. The original document is still attached.

### Flow D — Invalid document

1. User uploads an unrelated image or unreadable file.
2. System returns a safe error state.
3. User can retry, replace file, or enter bill manually.
4. No bill is saved automatically.

---

## 11. Required Fields to Extract

The extraction engine should return this normalized structure:

```json
{
  "document_type": "bill | invoice | receipt | payment_request | unknown",
  "vendor_name": "string | null",
  "amount": 1234567,
  "currency": "IDR",
  "due_date": "YYYY-MM-DD | null",
  "invoice_date": "YYYY-MM-DD | null",
  "invoice_number": "string | null",
  "category": "Revenue | Marketing | Infrastructure | Operations | SaaS",
  "type": "pending_payable",
  "status": "Completed | Missing Receipt",
  "payment_status": "unpaid | paid | overdue | unknown",
  "line_items": [
    {
      "description": "string",
      "quantity": 1,
      "unit_price": 100000,
      "amount": 100000
    }
  ],
  "tax_amount": 0,
  "subtotal_amount": 0,
  "total_amount": 1234567,
  "confidence": {
    "overall": 0.86,
    "vendor_name": 0.92,
    "amount": 0.97,
    "due_date": 0.71,
    "category": 0.63
  },
  "warnings": [
    "Due date confidence is low. Please review before saving."
  ],
  "raw_text_preview": "string",
  "source_file": {
    "file_name": "invoice-may-2026.pdf",
    "mime_type": "application/pdf",
    "size_bytes": 482901
  }
}
```

---

## 12. Mapping to FluxyOS Firestore Schema

The saved bill should match the existing Bills schema as much as possible.

Collection:

```text
users/{userId}/bills
```

Base saved fields:

```js
{
  amount: number,
  vendor_name: string,
  category: "Revenue" | "Marketing" | "Infrastructure" | "Operations" | "SaaS",
  type: "pending_payable",
  status: "Completed" | "Missing Receipt",
  icon: "💸",
  timestamp: serverTimestamp(),
  due_date: Timestamp | null,

  // New bill-capture metadata
  source: "scan",
  document_type: "bill" | "invoice" | "receipt" | "payment_request" | "unknown",
  invoice_number: string | null,
  invoice_date: Timestamp | null,
  payment_status: "unpaid",
  extraction_status: "reviewed",
  extraction_confidence: number,
  extraction_warnings: string[],
  raw_text_preview: string | null,
  source_file_name: string,
  source_file_mime_type: string,
  source_file_size_bytes: number,
  source_file_url: string | null,
  created_via: "bill_capture"
}
```

Important:
- `amount` must be saved as a raw number, never formatted with dots.
- Display should use Indonesian Rupiah formatting.
- `type` should be `pending_payable`, because an uploaded bill is usually unpaid.
- `icon` should be `💸`.
- Default `category` should be `Operations` when extraction is uncertain.
- `status` should not mean payment status. Existing status values are `Completed` or `Missing Receipt`, so add `payment_status` separately if needed.

---

## 13. Data Model Recommendation

Add minimal new fields to `users/{userId}/bills` instead of creating a totally separate feature-specific collection.

Reason:
- The Bills page already reads from `users/{userId}/bills`.
- The feature should improve the existing module, not create a parallel system.
- A separate `bill_scans` collection can be added later if audit and processing history becomes more complex.

### Optional future collection

Use this only if needed later:

```text
users/{userId}/bill_scans
```

Purpose:
- Store raw extraction attempts
- Store failed scans
- Track processing retries
- Support auditability
- Keep extraction history separate from final bill records

Not required for MVP.

---

## 14. UI Requirements

### Bills page header

Add a new primary/secondary action near the existing Add Bill action:

- Button label: **Scan Bill**
- Icon: document scanner / upload icon
- Placement: top-right action area on `bill.html`
- Do not remove existing Add Bill flow

### Scan Bill drawer

Use the same visual language as FluxyOS app pages:
- White surface
- Gray borders
- Orange accent only
- No orange background
- Dark navy only where already used by app shell
- Heroicons style SVG icons

Drawer sections:

1. Header
   - Title: `Scan Bill`
   - Subtitle: `Upload a bill, invoice, receipt, or payment request. FluxyOS will extract the key details for review.`

2. Upload zone
   - Drag and drop
   - Click to browse
   - Supported types label
   - Max size label

3. Preview area
   - Image preview for image files
   - PDF file card for PDFs
   - File name, size, type

4. Processing state
   - Shimmer or progress indicator
   - Message: `Reading document and extracting bill details...`

5. Review extracted result
   - Vendor
   - Amount
   - Due date
   - Invoice date
   - Invoice number
   - Category
   - Payment status
   - Notes/warnings
   - Confidence markers

6. Footer actions
   - `Cancel`
   - `Rescan`
   - `Save Bill`

---

## 15. UX States

### Empty upload state

Message:
`Upload a bill document to start.`

### Drag-over state

Message:
`Drop your bill here.`

### Upload selected state

Show:
- File preview
- File name
- File size
- Replace file action
- Scan Bill button

### Loading state

Show:
`Reading document and extracting bill details...`

### Extracted state

Show editable review form.

### Partial extraction state

Show extracted fields and highlight missing required fields:
- Vendor
- Amount
- Category
- Due date if available

### Low-confidence state

Show field-level warning:
`AI is not fully confident about this field. Please review.`

### Error state

Possible errors:
- Unsupported file type
- File too large
- Could not read document
- No bill-like data detected
- Network issue
- AI service unavailable
- Permission denied
- Firebase upload failed

### Offline state

If browser is offline:
- Allow local image selection and preview.
- Do not call AI extraction.
- Show: `Scanning needs internet connection. You can keep the file selected and scan when online.`
- If Firestore offline persistence is enabled and the user manually completes the form, allow a local pending save only if the implementation has been safely designed for sync.

---

## 16. Functional Requirements

### Upload

- Accept image and PDF files.
- Validate MIME type.
- Validate file size.
- Show selected file preview.
- Allow replacing the file before scan.
- Do not upload to permanent storage until user confirms or until backend scan requires temporary upload.

### Extraction

- Send document to backend scan endpoint.
- Backend should return structured JSON only.
- The result must match the required extraction schema.
- Use confidence scores.
- Normalize Indonesian currency formats.
- Detect `Rp`, `IDR`, and dot thousand separators.
- Convert amount into raw number.
- Infer category safely.
- Default category to `Operations` when uncertain.
- Do not save directly without review.

### Review

- All extracted fields are editable.
- Required fields:
  - vendor_name
  - amount
  - category
  - type
- `due_date` can be optional.
- Save button disabled until required fields are valid.
- Show original document preview during review.

### Save

- Save to `users/{userId}/bills`.
- Use authenticated user ID.
- Use Firestore server timestamp.
- Refresh Bills table after save.
- Close drawer after success.
- Show success toast.

### Audit

For MVP, add a basic audit log only if the current project already supports it in the relevant code path.

Suggested audit action:
```text
bill.scan_create
```

Audit log target:
```text
users/{userId}/audit_logs
```

---

## 17. Backend Requirements

FluxyOS currently has a FastAPI backend in `main.py`. Add one endpoint:

```http
POST /api/v1/bills/scan
```

Netlify path:
```text
/.netlify/functions/api/v1/bills/scan
```

### Request

Use multipart form data:

```text
file: uploaded file
userId: Firebase Auth UID
```

### Response

Return normalized JSON:

```json
{
  "ok": true,
  "data": {
    "vendor_name": "PLN",
    "amount": 1250000,
    "currency": "IDR",
    "due_date": "2026-05-28",
    "invoice_date": "2026-05-14",
    "invoice_number": "INV-2026-001",
    "category": "Operations",
    "type": "pending_payable",
    "document_type": "invoice",
    "confidence": {
      "overall": 0.88,
      "vendor_name": 0.94,
      "amount": 0.96,
      "due_date": 0.77,
      "category": 0.69
    },
    "warnings": [],
    "raw_text_preview": "..."
  }
}
```

### Error response

```json
{
  "ok": false,
  "error": {
    "code": "UNREADABLE_DOCUMENT",
    "message": "We could not read this bill clearly. Please upload a clearer image or enter the details manually."
  }
}
```

---

## 18. AI/OCR Implementation Strategy

Use a two-layer extraction model:

### Layer 1 — OCR / Vision extraction

Input:
- Bill image
- Receipt photo
- Invoice PDF page image

Output:
- Raw text
- Layout cues if available
- Candidate entities

Options:
- Multimodal model with vision input
- Google Document AI Invoice Parser / Receipt Parser
- OCR library fallback for local/dev testing

### Layer 2 — Structured normalization

Input:
- Raw OCR text and/or model vision result

Output:
- Strict JSON schema matching the FluxyOS extraction contract

The extraction engine must be strict. It should not return prose. It should return only JSON.

Recommended behavior:
- Use Structured Outputs or schema validation when using an LLM.
- Validate JSON server-side before sending it to the frontend.
- Retry once when required fields are missing but raw text contains bill-like data.
- Never hallucinate amount, due date, or vendor.
- If uncertain, return `null` and a warning.

---

## 19. Extraction Rules

### Vendor name

Detect from:
- Invoice header
- Merchant name
- Supplier name
- Biller name
- Company name
- Payment recipient

Fallback:
- Use the clearest merchant or supplier string.
- If no confident value, return `null`.

### Amount

Priority:
1. Total amount due
2. Grand total
3. Total invoice
4. Amount payable
5. Bill amount
6. Receipt total

Ignore:
- Unit price if line item total exists
- Tax amount if total exists
- Previous balance unless clearly the amount due

Normalize:
- `Rp 1.250.000` → `1250000`
- `IDR 1,250,000` → `1250000`
- `1.250.000,00` → `1250000`

### Due date

Detect:
- Due Date
- Pay Before
- Jatuh Tempo
- Batas Pembayaran
- Payment Due

If only invoice date exists, do not invent due date.

### Category

Map using vendor and line items:

- SaaS: software subscriptions, cloud tools, design tools, AI tools
- Infrastructure: hosting, cloud, server, domain, API, database, developer tools
- Marketing: ads, creative services, campaign tools, social media tools
- Operations: utilities, office, vendor invoices, general business expenses
- Revenue: only if document clearly represents money owed to the user, not a payable bill

For bill upload MVP, default uncertain category to `Operations`.

### Type

Default:
```text
pending_payable
```

Do not use `expense` until the bill is paid.

### Payment status

Default:
```text
unpaid
```

---

## 20. Validation Rules

Before save:
- Amount must be a positive number.
- Vendor name must not be empty.
- Category must be one of allowed FluxyOS categories.
- Type must be `pending_payable` for bill scan MVP.
- Due date must be valid if provided.
- Invoice date must be valid if provided.
- File metadata must be present.
- Do not store formatted amount strings.

---

## 21. Security & Privacy Requirements

- Only authenticated users can scan and save bills.
- Never expose one user's document to another user.
- Any stored file path must be user-scoped.
- Validate file type and size server-side.
- Do not trust frontend MIME type only.
- Avoid logging full OCR text in production logs.
- Avoid exposing raw sensitive document text in error messages.
- If source files are stored, use Firebase Storage or equivalent secure storage with user-scoped access rules.
- If files are not stored, keep only metadata and extracted fields.

---

## 22. Offline / Online Behavior

There are two different meanings of offline:

### Offline bill

This means a physical bill, receipt, or paper invoice captured as a photo.

This must be supported.

### Offline app state

This means the user has no internet connection.

For MVP:
- Support selecting and previewing the file while offline.
- Do not attempt AI extraction while offline.
- Show clear offline message.
- Allow manual bill entry using the existing Add Bill flow.

Future:
- Add local queue for scan requests.
- Add Firestore offline persistence only after security and trusted-device handling are decided.
- Sync pending local records when the browser is online.

---

## 23. Files Likely Affected

Expected files:

```text
bill.html
assets/js/bill.js
assets/js/shared-dashboard.js
main.py
```

Optional new files:

```text
assets/js/bill-capture.js
assets/css/bill-capture.css
docs/BILL_CAPTURE_FEATURE.md
```

Do not change:
- Landing pages
- Pricing page
- Dashboard KPI logic
- Ledger table behavior
- Revenue Sync
- Subscription page
- Sidebar routes unless adding a real Receipt Capture page later

---

## 24. Implementation Guardrails

- Do not rename existing HTML IDs used by JS.
- Do not break existing Add Bill modal.
- Do not change existing transaction schema.
- Do not store formatted Rupiah strings in Firestore.
- Do not auto-create ledger transactions from bill scans.
- Do not implement Pay Now in this feature.
- Do not implement edit/delete unless explicitly requested.
- Do not refactor unrelated app shell code.
- Do not add a new framework or build system.
- Preserve static HTML + Tailwind + Vanilla JS approach.
- Use shared toast and empty state helpers where possible.
- Keep app pages footer-free.
- Keep all Firestore data under `users/{userId}/`.

---

## 25. Acceptance Criteria

The feature is complete when:

- Bills page shows a `Scan Bill` action.
- User can upload a supported bill file.
- Unsupported file types show a safe error.
- Upload preview works.
- Scan loading state appears.
- Backend returns structured extraction result.
- Extracted fields populate a review form.
- User can edit extracted fields.
- Low-confidence fields are visually marked.
- Save Bill creates a record in `users/{userId}/bills`.
- Saved amount is raw number.
- Saved type is `pending_payable`.
- Saved category matches allowed FluxyOS categories.
- Bills table refreshes after save.
- Success and error toasts work.
- Offline app state is handled gracefully.
- Existing Add Bill flow still works.
- Existing Bills table still works.
- No ledger transaction is created automatically.
- Browser console has no 404, Firebase, CSP, or CORS errors.

---

## 26. Suggested MVP Build Order

### Phase 1 — UI shell

- Add Scan Bill button to `bill.html`.
- Build drawer UI.
- Add upload zone and preview.
- Add client-side file validation.

### Phase 2 — Mock extraction

- Add temporary mock scan function.
- Return sample JSON.
- Populate review form.
- Validate save flow into Firestore.

### Phase 3 — Real backend endpoint

- Add `POST /api/v1/bills/scan` to FastAPI.
- Accept multipart file upload.
- Convert PDF/image into extraction input.
- Return structured JSON.

### Phase 4 — AI/OCR extraction

- Add OCR/vision extraction provider.
- Add schema validation.
- Add confidence and warning logic.
- Add retry/fallback behavior.

### Phase 5 — QA and production

- Test image upload.
- Test PDF upload.
- Test unreadable image.
- Test low-confidence data.
- Test offline browser state.
- Test Firestore save.
- Test no ledger auto-create.
- Test mobile drawer layout.

---

# Claude / Codex Implementation Prompt

Use this prompt in Claude Code, Codex, or another coding agent.

```text
You are working inside the existing FluxyOS project.

Read these files first before implementation:
1. docs/PROJECT_BACKGROUND.md
2. docs/product_ux_feature_intake_framework.md
3. docs/ROADMAP.md
4. docs/WORKFLOW.md
5. CLAUDE.md or AGENTS.md depending on the agent

Task:
Build the MVP for "AI Bill Capture & Auto-Generated Bill Result" on the existing Bills page.

Feature objective:
Allow an authenticated user to upload a bill, invoice, receipt, payment request, or offline physical bill photo from the Bills page. The system should scan the document, extract structured bill fields, show the extracted result in an editable review form, and save the confirmed result into the existing user-scoped Firestore bills collection.

Product logic:
This belongs on bill.html because the output is a payable bill, not a completed ledger transaction. Do not auto-create transactions in users/{userId}/transactions. A bill becomes a ledger expense only later when the user explicitly marks it as paid, which is outside this feature scope.

Feature type:
Workflow feature + Intelligence feature.

Main user flow:
1. User opens bill.html.
2. User clicks "Scan Bill".
3. A right-side drawer opens.
4. User uploads JPG, PNG, WebP, or PDF.
5. User sees file preview.
6. User clicks "Scan Bill".
7. The app sends the file to a backend scan endpoint.
8. The backend returns structured JSON.
9. The drawer displays an editable review form.
10. User confirms and clicks "Save Bill".
11. The app saves the bill to users/{userId}/bills.
12. The bills table refreshes and a success toast appears.

MVP scope:
- Add Scan Bill action to the Bills page.
- Build Scan Bill drawer.
- Add upload area, file validation, preview, loading, extracted result, low-confidence, error, and offline states.
- Add backend endpoint POST /api/v1/bills/scan.
- For the first implementation, use a mock extraction response if no AI/OCR provider is configured.
- Structure the backend so a real OCR/vision provider can be added later without rewriting the UI.
- Save reviewed result to Firestore under users/{userId}/bills.
- Preserve existing Add Bill modal and existing Bills table behavior.

Out of scope:
- Pay Now
- Bill payment integration
- Auto-creating ledger transactions
- Edit/delete bills
- A separate Receipt Capture page
- Real bank/payment integration
- Approval workflow
- New frontend framework
- Build system changes
- Refactoring unrelated files

Technical constraints:
- Existing stack is static HTML + Tailwind + Vanilla JS.
- No npm build step.
- Auth is Firebase Auth.
- Data is Firebase Firestore.
- App pages must not load the marketing footer.
- Keep all bill records under users/{userId}/bills.
- Amount must be stored as raw number, never formatted string.
- Display currency as Indonesian Rupiah with dot thousand separators.
- Use existing shared helpers where available:
  - window.showToast(message, type)
  - window.renderEmptyState(containerId, config)
  - window.renderShimmer(containerId, rowCount)
- Do not rename existing IDs used by JavaScript.
- Do not break existing Add Bill flow.

Backend endpoint:
Add:

POST /api/v1/bills/scan

Request:
multipart/form-data
- file

Response success:
{
  "ok": true,
  "data": {
    "document_type": "bill | invoice | receipt | payment_request | unknown",
    "vendor_name": "string | null",
    "amount": 1234567,
    "currency": "IDR",
    "due_date": "YYYY-MM-DD | null",
    "invoice_date": "YYYY-MM-DD | null",
    "invoice_number": "string | null",
    "category": "Revenue | Marketing | Infrastructure | Operations | SaaS",
    "type": "pending_payable",
    "status": "Completed | Missing Receipt",
    "payment_status": "unpaid | paid | overdue | unknown",
    "line_items": [],
    "tax_amount": 0,
    "subtotal_amount": 0,
    "total_amount": 1234567,
    "confidence": {
      "overall": 0.86,
      "vendor_name": 0.92,
      "amount": 0.97,
      "due_date": 0.71,
      "category": 0.63
    },
    "warnings": [],
    "raw_text_preview": "string"
  }
}

Response error:
{
  "ok": false,
  "error": {
    "code": "UNREADABLE_DOCUMENT",
    "message": "We could not read this bill clearly. Please upload a clearer image or enter the details manually."
  }
}

Frontend save mapping:
When user clicks Save Bill after review, save this shape to Firestore:

{
  amount: number,
  vendor_name: string,
  category: "Revenue" | "Marketing" | "Infrastructure" | "Operations" | "SaaS",
  type: "pending_payable",
  status: "Completed" | "Missing Receipt",
  icon: "💸",
  timestamp: serverTimestamp(),
  due_date: Firestore Timestamp or null,

  source: "scan",
  document_type: "bill" | "invoice" | "receipt" | "payment_request" | "unknown",
  invoice_number: string | null,
  invoice_date: Firestore Timestamp or null,
  payment_status: "unpaid",
  extraction_status: "reviewed",
  extraction_confidence: number,
  extraction_warnings: string[],
  raw_text_preview: string | null,
  source_file_name: string,
  source_file_mime_type: string,
  source_file_size_bytes: number,
  source_file_url: null,
  created_via: "bill_capture"
}

Validation rules:
- vendor_name is required before saving.
- amount is required and must be a positive raw number.
- category is required and must be one of Revenue, Marketing, Infrastructure, Operations, SaaS.
- type must be pending_payable for this MVP.
- due_date is optional.
- invoice_date is optional.
- If extracted category confidence is low, default to Operations and show a warning.
- If amount or vendor is missing, keep Save Bill disabled until user fixes it.
- Do not hallucinate missing fields.

Extraction rules:
- Detect vendor from merchant, supplier, biller, company, payment recipient, or invoice header.
- Detect total amount due, grand total, amount payable, or total invoice.
- Do not confuse subtotal, tax, or unit price with total amount.
- Normalize Rp / IDR amounts into raw numbers:
  - Rp 1.250.000 -> 1250000
  - IDR 1,250,000 -> 1250000
  - 1.250.000,00 -> 1250000
- Detect due date from Due Date, Pay Before, Jatuh Tempo, Batas Pembayaran, Payment Due.
- Do not invent due date if only invoice date exists.
- Default type to pending_payable.
- Default payment_status to unpaid.

UX requirements:
- Drawer should match FluxyOS app design.
- Use orange only as accent/CTA, never as large background.
- Review fields should be editable.
- Field-level confidence should be visible for low-confidence fields.
- Include empty, drag-over, selected file, loading, extracted, partial, error, and offline states.
- Mobile layout must work.
- Do not make the AI result feel final before user confirmation.

Offline behavior:
- If navigator.onLine is false, allow selecting and previewing a file.
- Do not call the scan endpoint.
- Show a clear message: "Scanning needs internet connection. You can keep the file selected and scan when online."
- Existing manual Add Bill flow should remain available.

Implementation suggestion:
Create a dedicated assets/js/bill-capture.js if it keeps the code cleaner. Wire it from bill.html. The module should:
- openBillCaptureDrawer()
- closeBillCaptureDrawer()
- validateBillFile(file)
- renderBillFilePreview(file)
- scanBillFile(file)
- renderBillExtractionReview(data)
- validateBillReviewForm()
- saveScannedBill(data)
- normalizeRupiahAmount(value)
- mapExtractionToBillRecord(data)

Backend suggestion:
In main.py, add a route handler for /api/v1/bills/scan. For now, if no OCR provider key/config exists, return a realistic mock response based on filename or a static sample. Keep the code structured so a real provider can be added later:
- validate file
- extract raw text or call vision/OCR provider
- normalize to schema
- validate schema
- return JSON

QA:
After implementation:
- Verify every new JS/CSS file reference exists.
- Open bill.html in browser.
- Confirm no console errors.
- Test JPG upload.
- Test PNG upload.
- Test PDF upload.
- Test unsupported file.
- Test offline mode.
- Test low-confidence/mock warning state.
- Test saving to users/{userId}/bills.
- Confirm amount is stored as raw number.
- Confirm no transaction is created in users/{userId}/transactions.
- Confirm existing Add Bill still works.
- Confirm app page has no marketing footer.
- Follow docs/WORKFLOW.md and push only after QA_PASS=1 requirements are true.

Deliverables:
1. Working Scan Bill MVP on bill.html.
2. Backend scan endpoint with mock/provider-ready structure.
3. Clean review-and-save flow.
4. No unrelated refactors.
5. Short implementation summary with files changed and QA results.
```

---

## 27. Suggested AI Extraction System Prompt

Use this inside the backend when adding a real LLM/vision extraction provider.

```text
You are a financial document extraction engine for FluxyOS, an Indonesian business finance platform.

Your task:
Extract structured bill data from the provided document image, PDF text, OCR text, or multimodal document input.

Return only valid JSON matching the provided schema. Do not return prose, markdown, explanations, or comments.

Important:
- Do not hallucinate.
- If a field is not visible or not confidently present, return null.
- Amount must be a raw number, not a formatted string.
- Currency should default to IDR only if the document uses Rp, IDR, Indonesian language payment terms, or Indonesian bill context.
- Do not confuse subtotal, tax, unit price, admin fee, or previous balance with total amount due.
- Prefer total amount due, grand total, amount payable, or total invoice.
- If there are multiple totals, choose the one most clearly marked as payable.
- If unsure, add a warning.
- Extract due date only if explicitly present.
- Do not invent due date from invoice date.
- For bill upload, default type to pending_payable.
- Default payment_status to unpaid.
- Category must be one of: Revenue, Marketing, Infrastructure, Operations, SaaS.
- If category is uncertain, use Operations and set category confidence below 0.7.

JSON schema:
{
  "document_type": "bill | invoice | receipt | payment_request | unknown",
  "vendor_name": "string | null",
  "amount": "number | null",
  "currency": "IDR | null",
  "due_date": "YYYY-MM-DD | null",
  "invoice_date": "YYYY-MM-DD | null",
  "invoice_number": "string | null",
  "category": "Revenue | Marketing | Infrastructure | Operations | SaaS",
  "type": "pending_payable",
  "status": "Completed | Missing Receipt",
  "payment_status": "unpaid | paid | overdue | unknown",
  "line_items": [
    {
      "description": "string",
      "quantity": "number | null",
      "unit_price": "number | null",
      "amount": "number | null"
    }
  ],
  "tax_amount": "number | null",
  "subtotal_amount": "number | null",
  "total_amount": "number | null",
  "confidence": {
    "overall": "number from 0 to 1",
    "vendor_name": "number from 0 to 1",
    "amount": "number from 0 to 1",
    "due_date": "number from 0 to 1",
    "category": "number from 0 to 1"
  },
  "warnings": ["string"],
  "raw_text_preview": "string | null"
}
```
