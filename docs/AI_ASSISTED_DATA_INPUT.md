# AI-Assisted Data Input

This document describes the review-first upload workflow used by the Fluxy AI Command Center. The feature lets an authenticated user upload a finance document, receive a structured extraction preview, edit the fields, and save only after explicit confirmation.

## Safety Rules

- AI may detect, extract, map, and prepare data.
- AI must not silently create, edit, delete, pay, or reconcile records.
- Bills and invoices never create ledger transactions automatically.
- Payment screenshots never mark a bill as paid automatically.
- Amounts are stored as raw numbers and displayed as Indonesian Rupiah.
- Upload contents and raw OCR text are not logged or stored by default.
- All writes remain under `users/{uid}`.

## Backend Endpoints

### `POST /api/v1/ai/input-from-file`

The AI Command Center sends uploads using the JSON/base64 pattern used by Netlify Functions:

```json
{
  "file_base64": "...",
  "file_name": "invoice.pdf",
  "mime_type": "application/pdf",
  "size_bytes": 12345,
  "source_page": "ai_command_center",
  "destination_hint": "auto"
}
```

The response is a strict review contract:

```json
{
  "success": true,
  "detected_type": "invoice",
  "recommended_destination": "bills",
  "recommended_action": "review_and_save_to_bills",
  "confidence": 0.82,
  "extracted": {},
  "mapped_fields": {},
  "missing_required_fields": [],
  "validation_errors": [],
  "warnings": [],
  "message": "",
  "provider_state": "openai"
}
```

`provider_state` is one of:

- `openai`: provider extraction was used.
- `deterministic_fallback`: filename/MIME/date hints were used.
- `provider_not_configured`: no AI provider key is configured, so extraction is low-confidence and review-only.

### Existing Endpoints

- `/api/v1/ai/detect-document` remains the lightweight detection path.
- `/api/v1/bills/extract` remains the Bill Capture-compatible wrapper.

## Destination Mapping

| Detected type | Destination | Review action |
| --- | --- | --- |
| `bill`, `invoice` | Bills | `review_and_save_to_bills` |
| `receipt` | Ledger | `review_as_expense` |
| `payment_screenshot`, `bank_transfer` | Ledger | `review_transaction` |
| `subscription_invoice` | Subscriptions | `review_as_subscription` |
| `revenue_report` | Revenue Sync or Ledger review | `review_revenue_data` |
| `csv_transactions` | Ledger CSV import | `review_csv_import` |
| `unknown_financial_document` | AI Review | `ask_user` |
| `non_financial_image`, `unsupported_file` | None | `refuse` |

## Field Mapping

Bills map to `users/{uid}/bills`:

- `vendor_name`
- `amount`
- `category`
- `invoice_number`
- `invoice_date`
- `due_date`
- `extraction_confidence`
- `extraction_warnings`

Ledger records map to `users/{uid}/transactions`:

- `vendor_name`
- `amount`
- `category`
- `type`
- `status`
- `timestamp`
- `payment_reference`
- `notes`
- `extraction_confidence`
- `extraction_warnings`

Subscriptions map to `users/{uid}/subscriptions`:

- `vendor_name`
- `amount`
- `category`
- `billing_cycle`
- `renewal_date`
- `status`
- `notes`
- `extraction_confidence`
- `extraction_warnings`

Revenue reports are previewed and routed to Revenue Sync unless the reviewed result is a single clear revenue total that can safely become an income transaction.

CSV transaction files open the existing Ledger CSV import review flow instead of duplicating CSV parsing.

## Review UI

The review drawer is shared across Bill Capture, transaction scan, and subscription scan modes. It shows:

- detected document type
- confidence
- editable fields
- missing fields
- warnings
- duplicate warning when a likely duplicate exists
- cancel and save actions

Save is disabled when required fields are missing. Duplicate warnings do not silently block the user; the user can confirm and save after seeing the warning.

## Fallback Behavior

When provider extraction is unavailable, FluxyOS still classifies by safe filename/MIME hints and returns low-confidence mapped fields. The UI labels this as provider-dependent fallback and requires user review. It must not pretend extraction is live.

Supported image and PDF uploads are not refused solely because the filename is generic. If a file such as `vendor.jpg` has no clear finance keywords, FluxyOS treats it as `unknown_financial_document` and asks the user to choose the review destination.

With a configured AI provider, the backend may upgrade an ambiguous upload based on structured evidence:

- Bills/invoices require a real payment-obligation signal such as `due_date`, `amount due`, `payment due`, `pay before`, `pay by`, `batas pembayaran`, or `jatuh tempo`.
- Purchase receipts route to Ledger review when extraction finds a vendor and amount without bill-specific evidence.
- Vendor, amount, and invoice/order number alone are not enough to classify a document as a bill, because ordinary expense receipts also contain them.
- POS receipt wording wins over generic bill/invoice wording. A paid receipt that says `Tax Invoice`, `Bill No`, `Order Number`, `Order Time`, `Subtotal`, `QRIS`, `Total Paid`, `Cashier`, `Kasir`, or similar must still route to Ledger unless it has a real payment-obligation signal.

This guardrail is covered by `scripts/qa-ai-upload-routing.js`. Any future change to AI upload routing must keep the Starbucks-style receipt case routing to `receipt`/Ledger unless the extracted document has bill-specific evidence. Do not remove this regression check when changing provider prompts, schemas, or fallback routing.

## Duplicate Checks

The review drawer checks likely duplicates before saving:

- Bills: same vendor, amount, and invoice number or due date.
- Transactions: same vendor/recipient, amount, and transaction date.
- Subscriptions: same vendor and amount.

## Firestore Rules

Firestore rules allow reviewed AI-capture metadata on bills, transactions, and subscriptions while preserving user-scoped writes and validation for amount, category, type, status, and timestamp/date fields.
