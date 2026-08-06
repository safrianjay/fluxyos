---
status: current
owns: [invoices]
updated: 2026-08-07
source: docs/PROJECT_BACKGROUND.md §4 (sharded 2026-08-07)
---

# Invoices

> Workspace-scoping rules for these collections live in
> [`PROJECT_BACKGROUND.md` §4](../PROJECT_BACKGROUND.md#4-firestore-database-schema).
> Read that first — it is always loaded; this shard is not.

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

**Foreign currency (USD/SGD) rule:** the invoice stays in its currency forever
(customer view, PDF, email, stored face value); **only the payment posting
converts to IDR** — `markInvoicePaid(uid, id, { paymentDate, amountPaidIdr,
fxRate, fxRateDate })` posts the caller-supplied Rupiah amount and stamps the
fx fields on the invoice. Foreign invoices stay **outside the IDR accounting
kernel + Tax Center entirely** (export-style, no-PPN v1): finalize skips the
INV-ISSUE journal (plain receivable) and the payment transaction is written
with `accounting_status: 'excluded'` (no journal, no PPN appendix, no PPh
withholding) — posting cent-denominated amounts into the IDR journals is both
wrong and rules-rejected. The editor hides + clears the PPN tax-rate and PPh
customer-withholding fields for non-IDR invoices. Rules note: `open → paid` is
validated by the lean `isValidInvoicePaidTransition` (evaluated first, WITHOUT
`isValidInvoiceBase` — its diff is restricted to 8 individually-validated keys;
running the full base validator on this path blew the rules evaluation budget
on tax-carrying invoices and surfaced as permission-denied).

| Field | Type | Notes |
|-------|------|-------|
| `invoice_number` | string | `INV-YYYYMM-0001`, per-user, derived from the latest existing number (no global counters). Immutable after create. |
| `status` | string | `draft` → `open` (finalize) → `paid` (mark payment completed) or `void`. Delete is blocked — void instead. |
| `currency` | string | `"IDR"` (default) \| `"USD"` \| `"SGD"`. **Amounts are integer MINOR units**: IDR in rupiah (0 decimals, unchanged), USD/SGD in cents. Formatting via `assets/js/money-format.js` (`window.FluxyMoney`) client-side and `functions/lib/format.js` `formatMoney` server-side. The rest of the app stays strict-IDR; summary cards sum IDR invoices only. |
| `customer_name` | string | May be empty on draft; required (size > 0) to finalize. |
| `customer_email` | string \| null | Optional for draft/finalize; required for "Finalize and mark as sent". |
| `customer_address` | string \| null | Optional, ≤500 chars, multi-line. Shown in preview/detail and under "Bill to" on the PDF. |
| `customer_language` | string | Default `"English"`. |
| `amount_paid_idr`, `fx_rate`, `fx_rate_date` | int / number / string \| null | **Foreign-currency payments only** — stamped on `open → paid`: the Rupiah amount posted to the ledger, the IDR-per-unit rate used, and its date. Rate comes from `netlify/functions/fx-rate.js` (Frankfurter/ECB proxy, same-origin, no key); the mark-paid modal prefills and lets the user override. |
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

**Email delivery: automatic backend send (default-off) + Gmail fallback.**
"Finalize and send" auto-emails the invoice — with a server-rendered PDF
attached — to `customer_email`, entirely from the backend (Resend), gated by
the default-off `INVOICE_EMAIL_ENABLED` env on the dashboard Netlify site.
Pipeline: `finalize(true)` → POST `enqueue-invoice-email` (verifies the ID
token + workspace role, re-reads the invoice server-side, enqueues an
idempotent job) → `invoice-email-background` (the ONLY Chromium bundle:
renders the PDF, sends via `functions/lib/email.js` with `mail_log`
exactly-once, records the attempt) → `invoice-email-worker` (cron `*/5`,
exp-backoff retry sweep; dead-letter → one owner alert). Delivery state lives
ONLY in server-written `workspaces/{ws}/invoice_email_jobs` (+ `attempts`
subcollection) — the invoice doc is never modified; the detail view shows a
Sending/Sent/Failed badge + a **Resend** button and folds attempts into the
activity timeline. Idempotency is two-layer: deterministic job id
(`auto_{invoiceId}` vs `manual_{invoiceId}_{ts}`) + `mail_log` eventKey.
Per-workspace branding schema at `workspaces/{ws}/settings/invoice_email`
(sender_name/subject_template/message/logo_url/reply_to; editing UI deferred).
Spec: `netlify/functions/NOTIFICATIONS.md`. The legacy "Send by email"
Gmail-compose handoff (`target="_blank"` anchor — same-page navigation strands
the page-transition overlay, an iframe violates CSP `frame-src`) remains as a
manual fallback, and "Mark as sent" remains the explicit delivery stamp
(`sent_at` + `invoice.sent` audit).

**PDF: one shared template, two renderers.** The invoice-document markup is
single-sourced in `assets/js/invoice-doc-template.js` (UMD:
`window.FluxyInvoiceDoc` in the browser, `require()` on the server) with
injected currency-aware formatters. On-page "Preview PDF"/"Download PDF" keeps
the browser-print contract (`window.print()` scoped via `body.invoice-printing`;
the app never logs `downloaded: true`). The emailed PDF renders the SAME
markup wrapped in the module's frozen `INVOICE_DOC_CSS` via headless Chromium
(`netlify/functions/lib/invoice-pdf.js`, `puppeteer-core` +
`@sparticuz/chromium`, scoped esbuild config in `netlify.toml`) — so the two
outputs match by construction and cannot structurally drift.

**DataService methods:** `generateInvoiceNumber`, `getInvoices`, `getInvoice`,
`getInvoiceItems`, `createInvoiceDraft` (invoice + items + audit in one
`writeBatch`), `updateInvoiceDraft` (doc patch + item upsert/delete sync + audits
in one batch), `addInvoiceItem`, `updateInvoiceItem`, `deleteInvoiceItem`,
`finalizeInvoice(uid, id, { markSent })`, `recordInvoiceSent`,
`markInvoicePaid(uid, id, { paymentDate, amountPaidIdr, fxRate, fxRateDate })`
(income transaction + invoice patch + audit in one batch; returns
`{ id, transactionId }`; the fx args apply to foreign-currency invoices only),
`voidInvoice(uid, id, reason)`, plus delivery-status readers
`getInvoiceEmailJob(uid, invoiceId)` and `getInvoiceEmailAttempts(uid, jobId)`
(client-read of the server-written `invoice_email_jobs`).

**Audit actions** (`target_collection: "invoices"`): `invoice.draft_created`,
`invoice.draft_updated`, `invoice.item_added`, `invoice.item_updated`,
`invoice.item_deleted`, `invoice.finalized`, `invoice.sent`,
`invoice.mark_paid`, `invoice.voided`, plus `export.create` for the invoice
CSV export.

**Sidebar route:** `Invoices` → `/invoices`, Operations group directly under
Budgets (active id `nav-invoices`).
