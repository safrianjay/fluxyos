# FluxyOS Payment Checkout and Verification Lifecycle

> Canonical replacement plan for the customer billing flow. Implemented June 2026.
> The original product specification was supplied as
> `/Users/jay/Downloads/PAYMENT_CHECKOUT_AND_VERIFICATION_PLAN.md`.

## Purpose

FluxyOS lets an authenticated user select a package, submit a metadata-only
payment request, see a pending-verification page, and keep trial access while a
payment is reviewed. This phase does not integrate a payment provider and never
activates a package before trusted verification.

## Canonical Data Model

All customer billing records stay under the authenticated user:

```text
users/{uid}/billing_payment_requests/{paymentRequestId}
users/{uid}/billing_subscription/current
users/{uid}/audit_logs/{auditLogId}
```

`billing_subscription/current` is the canonical access source. Legacy
`billing/access` and `payment_verifications` records are owner-readable migration
inputs only; customer writes are frozen.

## Checkout

Routes:

```text
/checkout
/checkout?plan=growth&billing=annually
/payment-pending
```

Packages:

| Plan | Monthly | Annual monthly equivalent |
|------|--------:|--------------------------:|
| Core Ops | Rp 3.500.000 | Rp 2.790.000 |
| Growth Engine | Rp 8.500.000 | Rp 6.790.000 |
| Enterprise AI | Rp 18.000.000 | Rp 14.390.000 |

Annual subtotal is `annualMonthlyEquivalent * 12`. Estimated PPN is
`Math.round(subtotal * 0.11)`. Amounts are stored as raw numbers with
`currency: "IDR"`.

Selectable methods are `qris`, `va`, `card`, and `invoice`. They create manual
pending requests only. No PAN, CVC, OTP, bank-account number, provider secret,
NPWP, or sensitive provider payload is collected or stored.

## Manual QRIS Payment Step

QRIS uses a real "pay the QR first" step. Lifecycle:
`awaiting_payment → pending_verification → verified | failed | expired`.

```text
checkout (QRIS) → request created awaiting_payment + subscription awaiting_payment
  → /payment-pending?requestId={id} shows the QR screen
  → "I've completed payment" → optional proof upload → "Submit for verification"
  → request + subscription move to pending_verification (one batch)
  → verification-in-progress state (manual verify later)
```

Non-QRIS methods skip `awaiting_payment` and are created directly as
`pending_verification` (unchanged). The QR image
(`assets/images/qris-tanda360.png`) and bank reference (Safrian Jayadi · OCBC
Nisp · 6938-1098-7877) are static display constants
(`QRIS_PAYMENT_INFO` in `assets/js/billing-config.js`) — never persisted per
user, never sensitive credentials. Optional proof reuses the
`documents/{id}` + Storage flow (`document_role: 'payment_proof'`,
`source_context: 'payment'`); only `proof_document_id` + `proof_file_name` are
referenced on the request. Revisiting `/payment-pending` while `awaiting_payment`
re-shows the QR.

## DataService Contract

- `createPaymentRequest(userId, paymentData)`
- `getLatestPaymentRequest(userId)`
- `getLatestPaymentRequestWithLegacyFallback(userId)`
- `getPaymentRequestById(userId, paymentRequestId)`
- `submitPaymentRequestForVerification(userId, paymentRequestId, { proofDocumentId, proofFileName })`
- `getBillingSubscription(userId)`
- `upsertBillingSubscription(userId, subscriptionData)`
- `ensureBillingSubscription(userId)`
- `expireBillingSubscriptionIfNeeded(userId, subscription?)`

`createPaymentRequest` recalculates trusted amounts and commits the request,
subscription transition (`awaiting_payment` for QRIS, else `pending_verification`),
and `billing.payment_request_created` audit row in one Firestore batch.
`submitPaymentRequestForVerification` batches the QRIS request update
(`awaiting_payment → pending_verification` + optional proof reference +
`user_confirmed_payment_at`/`submitted_for_verification_at`), the matching
subscription transition, and a `billing.payment_confirmation_submitted` audit row.

## Access Banner

| Subscription status | Banner | CTA |
|---------------------|--------|-----|
| `trialing` | Trial end-date reminder | `/pricing` |
| `awaiting_payment` | QRIS payment waiting | `/payment-pending?requestId=...` |
| `pending_verification` | Verification in progress | `/payment-pending` |
| `active` | Hidden | — |
| `payment_failed` | Retry payment | `/checkout?plan=...&billing=...` |
| `expired` | Trial ended | `/pricing` |

Awaiting-payment, pending, and failed users retain trial permissions only while `trial_ends_at` is
still in the future. Trial enforcement remains client-side UX protection until
a trusted backend is added.

## Security And Provider Limitations

- Customer clients can create pending requests and confirm a QRIS payment
  (`awaiting_payment → pending_verification`, with an optional proof reference),
  but cannot otherwise update, delete, or verify them.
- Customer clients cannot set subscriptions to `active`, `past_due`, or
  `payment_failed`.
- Firebase Console or a future trusted backend owns verification transitions.
- Real QRIS generation, Virtual Accounts, card tokenization, webhooks, invoice
  PDFs, refunds, cancellation, and proration remain out of scope.
