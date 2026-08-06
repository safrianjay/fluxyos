---
status: current
owns: [billing_subscription, billing_payment_requests, voucher_codes]
updated: 2026-08-07
source: docs/PROJECT_BACKGROUND.md §4 (sharded 2026-08-07)
---

# Billing, Payments & Vouchers

> Workspace-scoping rules for these collections live in
> [`PROJECT_BACKGROUND.md` §4](../PROJECT_BACKGROUND.md#4-firestore-database-schema).
> Read that first — it is always loaded; this shard is not.

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
