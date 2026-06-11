# FluxyOS Voucher Code Implementation Plan

## 0. Purpose

Implement voucher code support on the FluxyOS checkout page and add an internal dashboard admin tab where the internal team can generate voucher codes, configure discount percentage, control status, and review usage.

The feature must support the current FluxyOS stack:

- Static HTML
- Tailwind CSS
- Vanilla JavaScript
- Firebase Auth
- Firestore
- FastAPI backend when server-side validation is required
- No React, no npm, no new build tooling, no framework migration

This is a payment-adjacent feature, so do not implement it as a purely client-side discount calculation. Voucher validation and redemption must be handled by the backend or a hardened server-side endpoint to prevent users from editing browser code and applying fake discounts.

---

## 1. Feature Type

Workflow feature + internal admin feature.

### Public/user-facing part

Checkout enhancement: user can apply a voucher code below the billing frequency section before payment confirmation.

### Internal/admin part

Internal dashboard enhancement: admin can create, activate, deactivate, expire, and inspect voucher codes.

---

## 2. Context

FluxyOS already has pricing, trial, billing, and internal admin planning work. The checkout page needs a controlled discount mechanism so the team can support launch campaigns, founder discounts, partner codes, investor/referral codes, and manual sales-led discounts without hardcoding pricing changes.

Current risk if implemented poorly:

- User could manipulate the discount from browser devtools.
- Voucher logic could drift between checkout UI and payment provider pricing.
- Admin-generated vouchers could be readable or writable by normal users.
- Discount could stack unexpectedly with monthly/annual billing discounts.
- Voucher usage could be unauditable.

---

## 3. Main Objective

Let users apply a valid voucher code during checkout while giving FluxyOS admins a safe internal tool to generate and manage discount codes.

---

## 4. Job To Be Done

### Checkout user

When I am choosing a billing plan,
I want to enter a voucher code before I pay,
so I can confirm the final discounted price before subscribing.

### Internal admin

When I run a promotion or close a sales deal,
I want to generate a voucher code with a clear discount percentage and limits,
so I can offer controlled discounts without changing production pricing manually.

---

## 5. Target Users

### User-facing

- Founder
- Business owner
- Finance admin signing up for FluxyOS
- Trial user converting to paid

### Internal-facing

- FluxyOS admin
- Founder/operator
- Sales/operator role in the internal dashboard

---

## 6. Product Logic

### Where the checkout voucher belongs

Put the voucher input directly under the billing frequency section.

Reason:

- Billing frequency affects the base price first.
- Voucher should apply after the user chooses Monthly or Annual.
- The user should see the discount before payment confirmation.
- The checkout price summary can show the final calculation clearly.

Recommended order:

1. Plan selection
2. Billing frequency
3. Voucher code
4. Price summary
5. Payment action

### Where admin voucher generation belongs

Add a new tab in the existing internal dashboard.

Recommended tab label:

`Vouchers`

Do not put this under normal user settings. It is an internal operational tool, not a workspace/user finance setting.

---

## 7. Pricing Calculation Rules

Use this order:

```text
base_monthly_price or base_annual_price
→ billing frequency adjustment
→ voucher percentage discount
→ final checkout amount
```

Example:

```text
Growth monthly base price: Rp 249.000
Voucher: 20%
Discount amount: Rp 49.800
Final amount: Rp 199.200
```

Rules:

- Discount percentage must be an integer from 1 to 100.
- Default maximum should be 90 unless admin explicitly allows 100 for special free-trial or grant campaigns.
- The UI must show the discount amount and final amount before payment.
- Never store formatted Rupiah strings in Firestore. Store raw integer amounts only.
- Never trust the frontend-calculated price. Backend must recalculate from canonical plan price + frequency + voucher.
- If annual billing already has its own annual discount, the voucher applies to the annual price after the annual price is selected, not to monthly price multiplied manually unless that is the existing pricing model.
- Do not allow multiple vouchers in v1.
- Do not allow stacking vouchers.

---

## 8. User-Facing Checkout UX

### Placement

Add this section under the billing frequency section:

```text
Have a voucher code?
[ Enter voucher code ] [ Apply ]
```

### Visual behavior

Default state:

- Compact input and secondary Apply button.
- Helper text: `Apply a valid FluxyOS voucher before checkout.`

Applied state:

- Show green/success confirmation.
- Show the applied code.
- Show discount percentage.
- Show `Remove` or `Change code` action.

Invalid state:

- Show inline error under the input.
- Do not update the checkout total.

Loading state:

- Disable Apply button.
- Button label changes to `Checking...`.
- Keep selected plan and billing frequency unchanged.

Expired state:

- Message: `This voucher has expired.`

Usage limit reached state:

- Message: `This voucher has already reached its usage limit.`

Plan mismatch state:

- Message: `This voucher is not available for this plan.`

Frequency mismatch state:

- Message: `This voucher is not available for this billing frequency.`

### Price summary after valid voucher

Add rows to checkout summary:

```text
Plan                         Growth
Billing                      Monthly
Subtotal                     Rp 249.000
Voucher FLUXY20              -Rp 49.800
Total due today              Rp 199.200
```

### UX guardrails

- Do not auto-apply voucher from URL query in v1 unless explicitly requested.
- Do not hide the normal price after applying discount. Show subtotal and discount separately.
- Do not show admin-only metadata to users.
- Do not expose total global usage count to users.
- Do not claim the discount is reserved until backend creates a checkout/session record.

---

## 9. Internal Dashboard UX

### New tab

Add one new tab to the internal dashboard:

```text
Vouchers
```

Recommended tab order:

1. Users
2. Trials
3. Payments / Billing
4. Vouchers
5. Logs / Admin activity

Use the current internal dashboard tab pattern. Do not redesign the whole internal dashboard.

### Vouchers tab layout

Top area:

- Page title: `Voucher Codes`
- Description: `Create and manage checkout discounts for FluxyOS plans.`
- Primary action: `Create voucher`

Stats row:

- Active vouchers
- Total redemptions
- Expiring soon
- Disabled vouchers

Table columns:

- Code
- Discount
- Status
- Applies to
- Usage
- Expiry
- Created by
- Created date
- Actions

Actions:

- Copy code
- Edit
- Disable / Enable
- View usage

### Create voucher drawer/modal

Fields:

- Voucher code
  - Required
  - Uppercase letters, numbers, hyphen, underscore only
  - 4 to 32 chars
  - Example: `LAUNCH20`
  - Add `Generate random code` secondary action

- Discount percentage
  - Required
  - Number input
  - 1 to 100
  - Warn if above 50
  - Require extra confirmation if 100

- Applies to plans
  - Multi-select
  - Basic, Growth, ERP / Enterprise, or All plans

- Applies to billing frequency
  - Monthly
  - Annual
  - Both

- Max total redemptions
  - Optional
  - Number
  - Empty means unlimited, but show warning: `Unlimited vouchers can create uncontrolled discounts.`

- Max redemptions per user
  - Required default: 1
  - Recommended v1: locked to 1

- Start date
  - Optional
  - Defaults to now

- Expiry date
  - Optional but recommended

- Status
  - Active / Disabled
  - Default: Active

- Internal note
  - Optional
  - For campaign/source reason
  - Not visible to users

Buttons:

- Cancel
- Create voucher

### Edit voucher behavior

Editable fields:

- Status
- Expiry date
- Max total redemptions
- Internal note
- Applies to plans/frequency only if there are no redemptions yet

Do not allow editing these after redemption:

- Code
- Discount percentage

Reason: changing the discount after use makes audit and support confusing.

---

## 10. Data Model

Because vouchers are internal/admin-owned platform config, do not store them under normal users. Also do not expose voucher documents directly to client-side users.

Recommended server-only Firestore paths:

```text
internal/voucher_codes/{voucherId}
internal/voucher_redemptions/{redemptionId}
internal/admin_audit_logs/{auditLogId}
```

These are not user financial collections. They are platform/admin configuration. Firestore rules must block normal client access and allow access only through backend/admin flows.

### `internal/voucher_codes/{voucherId}`

| Field | Type | Notes |
|---|---|---|
| `code` | string | Uppercase unique code. Store normalized version. |
| `code_normalized` | string | Same as code, uppercase and trimmed. Use for lookup. |
| `discount_type` | string | v1 locked to `percentage`. |
| `discount_percent` | number | Integer 1-100. |
| `status` | string | `active`, `disabled`, `expired`, `archived`. |
| `applies_to_plans` | string[] | Example: `["basic", "growth"]` or `["all"]`. |
| `applies_to_frequency` | string[] | `monthly`, `annual`, or both. |
| `max_total_redemptions` | number/null | Null means unlimited. |
| `max_redemptions_per_user` | number | Default 1. |
| `current_redemption_count` | number | Incremented server-side only. |
| `starts_at` | timestamp/null | Optional. |
| `expires_at` | timestamp/null | Optional. |
| `internal_note` | string/null | Admin-only. |
| `created_by` | string | Admin UID or internal admin identifier. |
| `updated_by` | string/null | Admin UID. |
| `created_at` | timestamp | Server timestamp. |
| `updated_at` | timestamp | Server timestamp. |

### `internal/voucher_redemptions/{redemptionId}`

| Field | Type | Notes |
|---|---|---|
| `voucher_id` | string | Refers to `voucher_codes`. |
| `code_normalized` | string | Snapshot for support lookup. |
| `user_id` | string | Firebase Auth UID of redeemer. |
| `plan_id` | string | Selected plan. |
| `billing_frequency` | string | `monthly` or `annual`. |
| `subtotal_amount` | number | Raw integer IDR. |
| `discount_percent` | number | Snapshot. |
| `discount_amount` | number | Raw integer IDR. |
| `final_amount` | number | Raw integer IDR. |
| `checkout_session_id` | string/null | Payment provider / internal checkout session ID. |
| `payment_status` | string | `pending`, `paid`, `failed`, `cancelled`. |
| `redeemed_at` | timestamp | Server timestamp. |
| `created_at` | timestamp | Server timestamp. |

### User-scoped billing snapshot

After a successful payment or checkout session creation, store only the user-visible billing snapshot under the user scope:

```text
users/{userId}/billing/checkout_sessions/{checkoutSessionId}
```

Fields:

| Field | Type | Notes |
|---|---|---|
| `plan_id` | string | Selected plan. |
| `billing_frequency` | string | `monthly` or `annual`. |
| `subtotal_amount` | number | Raw integer IDR. |
| `voucher_code` | string/null | Applied code snapshot. |
| `voucher_id` | string/null | Internal voucher id if available. |
| `discount_percent` | number/null | Snapshot. |
| `discount_amount` | number | Raw integer IDR. |
| `final_amount` | number | Raw integer IDR. |
| `payment_status` | string | `pending`, `paid`, `failed`, `cancelled`. |
| `created_at` | timestamp | Server timestamp. |
| `updated_at` | timestamp | Server timestamp. |

Do not store card data, payment secrets, provider tokens, OTPs, or sensitive payment credentials in Firestore.

---

## 11. Backend API Contract

Add backend endpoints. Do not validate voucher codes purely in browser JS.

### Checkout endpoint: validate voucher

```http
POST /api/v1/billing/vouchers/validate
```

Request:

```json
{
  "code": "LAUNCH20",
  "plan_id": "growth",
  "billing_frequency": "monthly"
}
```

Backend derives `user_id` from Firebase auth token. Do not trust user_id from request body.

Response if valid:

```json
{
  "valid": true,
  "voucher_id": "abc123",
  "code": "LAUNCH20",
  "discount_percent": 20,
  "subtotal_amount": 249000,
  "discount_amount": 49800,
  "final_amount": 199200,
  "message": "Voucher applied."
}
```

Response if invalid:

```json
{
  "valid": false,
  "reason": "expired",
  "message": "This voucher has expired."
}
```

Supported invalid reasons:

- `not_found`
- `disabled`
- `expired`
- `not_started`
- `usage_limit_reached`
- `user_limit_reached`
- `plan_not_allowed`
- `frequency_not_allowed`
- `invalid_request`

### Checkout endpoint: create checkout session

```http
POST /api/v1/billing/checkout/session
```

Request:

```json
{
  "plan_id": "growth",
  "billing_frequency": "monthly",
  "voucher_code": "LAUNCH20"
}
```

Backend must:

1. Authenticate user.
2. Load canonical plan pricing from server config.
3. Validate voucher again.
4. Recalculate subtotal, discount, and final amount server-side.
5. Create payment provider checkout/session using final amount or provider coupon equivalent.
6. Create `users/{userId}/billing/checkout_sessions/{checkoutSessionId}`.
7. Create or reserve `internal/voucher_redemptions/{redemptionId}` with `payment_status: pending`.
8. Increment `current_redemption_count` only when payment is confirmed, unless the payment provider requires reservation logic.

Important: validation and checkout session creation must not rely on cached frontend values.

### Internal admin endpoints

```http
GET /api/v1/internal/vouchers
POST /api/v1/internal/vouchers
PATCH /api/v1/internal/vouchers/{voucherId}
POST /api/v1/internal/vouchers/{voucherId}/disable
POST /api/v1/internal/vouchers/{voucherId}/enable
GET /api/v1/internal/vouchers/{voucherId}/redemptions
```

Admin endpoint requirements:

- Require authenticated admin identity.
- Do not allow normal users to call these endpoints.
- Rate limit create/update actions.
- Write `internal/admin_audit_logs` for every create/update/enable/disable action.

---

## 12. Security Requirements

### Hard rules

- Voucher validation must happen server-side.
- Normal users must not read `internal/voucher_codes` directly from Firestore.
- Normal users must not write redemptions directly.
- Firestore rules must deny direct client access to `internal/*` unless an explicit admin custom claim exists.
- Backend must derive user identity from verified Firebase token.
- Backend must recalculate final amount. Never trust frontend subtotal, discount, or final amount.
- Create audit logs for admin voucher actions.
- Do not expose internal notes, created_by, usage details, or other admin metadata in checkout responses.

### Abuse protection

- Normalize code: trim spaces and uppercase before lookup.
- Add basic rate limiting to validate endpoint by user/IP.
- Return generic invalid message for repeated failed attempts if abuse is detected.
- Prevent race condition on limited vouchers using transaction/batch logic.
- Ensure `current_redemption_count` cannot exceed `max_total_redemptions`.
- Ensure per-user limit checks look at paid and pending redemptions depending on chosen reservation logic.

---

## 13. Firestore Rules

Add rule intent like this:

```javascript
match /internal/{document=**} {
  allow read, write: if false;
}
```

If the internal dashboard currently reads Firestore directly with admin custom claims, use a stricter helper:

```javascript
function isInternalAdmin() {
  return request.auth != null && request.auth.token.internal_admin == true;
}

match /internal/voucher_codes/{voucherId} {
  allow read: if isInternalAdmin();
  allow create, update: if isInternalAdmin();
  allow delete: if false;
}

match /internal/voucher_redemptions/{redemptionId} {
  allow read: if isInternalAdmin();
  allow create, update, delete: if false;
}

match /internal/admin_audit_logs/{auditId} {
  allow read: if isInternalAdmin();
  allow create, update, delete: if false;
}
```

Preferred approach: keep internal voucher writes backend-only.

---

## 14. Files To Read Before Implementation

Read these first:

- `docs/PROJECT_BACKGROUND.md`
- `docs/SYSTEM_DESIGN.md`
- `docs/SECURITY_SYSTEM.md`
- `docs/QA_CHECKLIST.md`
- `docs/product_ux_feature_intake_framework.md`
- Existing checkout/pricing/billing files
- Existing internal dashboard files
- Existing FastAPI billing/payment endpoints if already present
- Existing Firestore rules

Likely files to inspect and update:

- `pricing.html`
- Checkout page file if separate, for example `checkout.html` or billing checkout route
- Existing billing/settings page files if checkout lives there
- Internal dashboard HTML file
- Internal dashboard JS file
- `assets/js/db-service.js` only if user-scoped billing snapshot methods are needed
- Backend FastAPI files under `api/`
- `firestore.rules`
- `docs/PROJECT_BACKGROUND.md`
- `docs/ROADMAP.md`
- `docs/QA_CHECKLIST.md`
- `docs/CHANGELOG.md`

Do not invent new file names without checking the repo first.

---

## 15. Implementation Steps

### Step 1 — Locate checkout and billing flow

Find the current checkout implementation:

- Search for billing frequency toggle.
- Search for payment buttons.
- Search for pricing plan selection.
- Identify whether checkout exists inside `pricing.html` or a separate checkout page.

Document exact files touched in the final report.

### Step 2 — Add voucher UI under billing frequency

Add a compact voucher block under billing frequency.

Requirements:

- Input normalizes code to uppercase on blur or apply.
- Apply button calls backend validation endpoint.
- Remove/change code action clears applied voucher and recalculates displayed total.
- Price summary updates only after backend confirms voucher validity.
- Errors render inline, not as browser alerts.
- Works on 375px mobile without horizontal overflow.

### Step 3 — Add server-side voucher validation

Implement `/api/v1/billing/vouchers/validate`.

Validation order:

1. Auth token valid.
2. Code format valid.
3. Voucher exists.
4. Status active.
5. Start date valid.
6. Expiry date valid.
7. Plan allowed.
8. Frequency allowed.
9. Total usage not exceeded.
10. User usage not exceeded.
11. Server calculates subtotal, discount, final amount.
12. Return safe response.

### Step 4 — Add checkout session protection

Update checkout/payment submit logic so it submits plan, frequency, and voucher code to backend.

Backend must revalidate voucher and calculate final price again before creating payment session.

### Step 5 — Add internal dashboard Vouchers tab

Add a new tab using the current internal dashboard tab pattern.

Implement:

- Voucher list table
- Create voucher modal/drawer
- Edit voucher flow
- Disable/enable voucher action
- View usage drawer/table
- Copy code action
- Empty state
- Loading state
- Error state

Use existing internal dashboard components/styles where possible.

### Step 6 — Add backend admin endpoints

Create internal API handlers for vouchers.

Admin endpoints must:

- Require admin auth/custom claim or existing internal admin auth mechanism.
- Validate input server-side.
- Write audit logs.
- Avoid hard delete. Use disabled/archived status.

### Step 7 — Add Firestore rules

Protect `internal/*` paths.

Normal users should only see voucher effect through checkout API response and their own checkout session snapshot under `users/{userId}/billing/checkout_sessions`.

### Step 8 — Update docs

Update docs:

- `PROJECT_BACKGROUND.md`: add voucher and checkout session schema.
- `ROADMAP.md`: mark voucher code as shipped or in progress.
- `QA_CHECKLIST.md`: add billing/voucher QA section.
- `CHANGELOG.md`: add Unreleased entry.

---

## 16. Validation Details

### Voucher code format

Allowed:

```text
A-Z
0-9
-
_
```

Length:

```text
4 to 32 characters
```

Normalize:

```javascript
const normalized = input.trim().toUpperCase();
```

Reject:

- Spaces inside code
- Special symbols
- Lowercase should be converted, not rejected
- Empty code

### Discount calculation

Use integer math for IDR:

```javascript
const discountAmount = Math.floor(subtotalAmount * (discountPercent / 100));
const finalAmount = Math.max(0, subtotalAmount - discountAmount);
```

Backend should use the equivalent safe calculation.

### Status resolution

A voucher is usable only when:

```text
status === active
AND now >= starts_at, if starts_at exists
AND now <= expires_at, if expires_at exists
AND current_redemption_count < max_total_redemptions, if max_total_redemptions exists
AND user redemption count < max_redemptions_per_user
AND selected plan is allowed
AND selected frequency is allowed
```

---

## 17. Acceptance Criteria

### Checkout

- Voucher section appears directly under billing frequency.
- User can apply a valid code.
- User sees discount percentage, discount amount, and final amount.
- Invalid code shows a clear inline error.
- Expired, disabled, usage-limit, plan-mismatch, and frequency-mismatch states are handled.
- Changing plan or billing frequency clears or revalidates the voucher.
- Final checkout submit revalidates voucher server-side.
- Frontend cannot force an arbitrary discount by editing JavaScript.
- No formatted Rupiah strings are stored in Firestore.

### Internal dashboard

- New `Vouchers` tab exists.
- Admin can create a voucher with code, discount percentage, applicable plans, applicable frequency, limits, dates, status, and internal note.
- Admin can generate random voucher code.
- Admin can disable/enable voucher.
- Admin can view usage.
- Admin can copy voucher code.
- Audit logs are written for create/update/disable/enable actions.
- Non-admin users cannot access voucher admin data.

### Security

- Normal users cannot read or write `internal/voucher_codes` directly.
- Normal users cannot create their own redemptions.
- Backend derives user identity from auth token.
- Backend recalculates price using canonical plan pricing.
- Voucher usage count cannot exceed max limit under concurrent redemption.

### QA

- Checkout works on desktop, tablet, and 375px mobile.
- Internal dashboard Vouchers tab works on desktop and mobile if internal dashboard supports responsive layouts.
- Console is clean.
- Existing checkout without voucher still works.
- Existing plan selection and billing frequency selection still work.
- Existing payment flow is not broken.

---

## 18. Out of Scope for V1

Do not implement these unless explicitly requested:

- Referral system
- Affiliate tracking
- Public campaign pages
- Automatic URL coupon application
- Multiple stacked vouchers
- Fixed amount discount
- Free trial extension logic
- Payment provider coupon sync dashboard
- Advanced analytics charts
- Customer support override flow
- Workspace/team-based voucher permissions

---

## 19. Manual QA Checklist

### Checkout QA

- [ ] Checkout page loads with no console errors.
- [ ] Billing frequency section still works.
- [ ] Voucher section appears under billing frequency.
- [ ] Empty voucher apply shows validation message.
- [ ] Lowercase code normalizes to uppercase.
- [ ] Valid voucher applies successfully.
- [ ] Price summary shows subtotal, discount, and total.
- [ ] Remove/change code restores original total.
- [ ] Invalid code does not change total.
- [ ] Expired code shows expired message.
- [ ] Disabled code shows unavailable message.
- [ ] Plan-restricted code fails on wrong plan.
- [ ] Frequency-restricted code fails on wrong frequency.
- [ ] Changing plan/frequency revalidates or clears code.
- [ ] Submit checkout revalidates voucher server-side.
- [ ] Firestore stores raw integer amounts.

### Internal dashboard QA

- [ ] Internal dashboard loads.
- [ ] Vouchers tab is visible for admin.
- [ ] Vouchers tab is not accessible to normal users.
- [ ] Empty state renders when no vouchers exist.
- [ ] Create voucher drawer opens.
- [ ] Invalid code format is blocked.
- [ ] Discount percentage below 1 or above 100 is blocked.
- [ ] 100% discount requires confirmation.
- [ ] Voucher creates successfully.
- [ ] Table refreshes after create.
- [ ] Copy code works.
- [ ] Disable voucher works.
- [ ] Disabled voucher cannot be applied at checkout.
- [ ] Enable voucher works.
- [ ] Usage drawer shows redemptions.
- [ ] Audit log is written for admin actions.

### Regression QA

- [ ] Pricing page still loads.
- [ ] Login still works.
- [ ] Dashboard still loads.
- [ ] Sidebar still works.
- [ ] Existing billing/trial/payment status UI is not broken.
- [ ] No marketing footer appears on internal/app pages.
- [ ] No global user financial collections were created.

---

## 20. Implementation Prompt for Claude/Codex

Use this prompt after attaching this MD file.

```text
You are working inside the FluxyOS codebase.

Implement the voucher code feature exactly as specified in:

FLUXYOS_VOUCHER_CODE_IMPLEMENTATION_PLAN.md

Before coding, read:
- docs/PROJECT_BACKGROUND.md
- docs/SYSTEM_DESIGN.md
- docs/SECURITY_SYSTEM.md
- docs/QA_CHECKLIST.md
- docs/product_ux_feature_intake_framework.md
- Existing checkout/pricing/billing files
- Existing internal dashboard files
- Existing FastAPI API files
- firestore.rules

Goal:
Add a voucher code input under the billing frequency section on checkout, and add a Vouchers tab in the internal dashboard where admins can generate voucher codes and set discount percentage.

Scope:
1. Checkout UI under billing frequency.
2. Server-side voucher validation endpoint.
3. Server-side checkout revalidation before payment/session creation.
4. Internal dashboard Vouchers tab.
5. Internal voucher admin endpoints.
6. Firestore rules for internal voucher collections.
7. User-scoped checkout session snapshot after checkout/session creation.
8. Docs and QA updates.

Out of scope:
- Referral system
- Multiple voucher stacking
- Fixed-amount discounts
- URL auto-apply vouchers
- New frontend framework
- New build tooling
- React/npm migration

Technical rules:
- Use static HTML, Tailwind CSS, Vanilla JS, Firebase Auth, Firestore, and FastAPI only.
- Do not bypass DataService for user-scoped dashboard data unless the feature is backend-only.
- Do not expose internal voucher Firestore documents to normal users.
- Backend must validate voucher and calculate final amount.
- Frontend must never be the source of truth for discount.
- Store all monetary values as raw integer IDR.
- Do not store formatted Rupiah strings.
- Do not store payment secrets, card data, OTPs, API keys, or provider tokens in Firestore.
- Do not change unrelated UI, navbar, sidebar, pricing copy, or checkout layout beyond the voucher section.
- Do not redesign the internal dashboard. Add only the Vouchers tab and required voucher UI.

Security requirements:
- Normal users cannot read/write internal voucher collections directly.
- Admin actions require internal admin auth/custom claim or the existing internal admin auth mechanism.
- Every admin create/update/disable/enable action writes an admin audit log.
- Voucher usage limits must be enforced server-side and must be race-condition safe.
- Checkout submit must revalidate voucher server-side before creating payment/session.

UX requirements:
- Voucher block appears directly under billing frequency.
- It supports default, loading, applied, invalid, expired, disabled, usage-limit, plan-mismatch, and frequency-mismatch states.
- Price summary shows subtotal, voucher discount, and final amount.
- Admin tab includes voucher table, create drawer/modal, edit flow, disable/enable, copy code, and usage view.
- Mobile width 375px must not overflow.

After implementation:
- Update PROJECT_BACKGROUND.md with voucher schema.
- Update ROADMAP.md.
- Update QA_CHECKLIST.md with voucher QA.
- Update CHANGELOG.md under Unreleased.
- Run relevant QA from the checklist.

Final report must include:
- Files changed
- Backend endpoints added
- Firestore paths added
- Security rules changed
- QA completed
- Any manual QA that still needs real payment provider/admin credentials
```

---

## 21. Final Implementation Notes

Recommended build sequence:

1. Implement the checkout UI and backend validation first.
2. Add internal admin voucher creation second.
3. Add checkout session redemption logic third.
4. Add docs and QA last.

Reason: user-facing checkout needs a safe validation contract before internal generation becomes useful. Do not create admin UI that writes vouchers before the checkout validation path is secure.
