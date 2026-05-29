# FluxyOS Internal Operations Console — Implementation Plan

> Phase 1 shipped. See `docs/ROADMAP.md` (Internal Operations Console) and
> `docs/QA_CHECKLIST.md` §M for status and QA coverage. Implementation notes and
> deviations are recorded at the end of this document under "Phase 1 build notes".

## 0. Purpose

Build an internal-only operations console for FluxyOS so the internal team can
monitor registered users, review KYC/onboarding status, verify manual payments,
and activate or reject users safely.

This is not a normal customer dashboard page. It is an internal activation and
verification console.

The first implementation focuses on visibility and controlled status updates.
Register/login flow changes remain a later milestone.

---

## 1. Feature Type

Workflow feature + internal dashboard page. It supports a multi-step internal
operational workflow:

1. User registers.
2. User completes KYC/onboarding.
3. Internal team reviews KYC.
4. User submits payment proof or payment status becomes pending.
5. Internal team verifies payment.
6. User account becomes active.

## 2. Main Objective

Help the FluxyOS internal team review user onboarding, KYC, payment verification,
and activation status from one secure internal console without changing the
customer-facing registration or login flow yet.

## 3. Job To Be Done

When an internal FluxyOS team member needs to review new users, I want to see each
user's KYC, onboarding, and payment verification status, so I can approve, reject,
request revision, or activate the account without manually checking Firestore.

## 4. Target User

FluxyOS founder/owner, internal operations admin, KYC reviewer, payment
verification reviewer, support/admin team member.

## 5. Business Value

Better activation control, safer KYC and payment verification, less manual
Firestore checking, faster onboarding support, better auditability for sensitive
actions, cleaner future transition into paid account gating.

## 6. Existing Product Context

FluxyOS uses static HTML, Tailwind CSS, vanilla JS, Firebase Auth, Firestore,
shared `DataService` methods in `assets/js/db-service.js`, shared dashboard UI in
`assets/js/shared-dashboard.js`, and a centralized sidebar in
`assets/js/sidebar-loader.js`.

User financial data stays under authenticated user scope:

```
users/{userId}/transactions
users/{userId}/bills
users/{userId}/subscriptions
users/{userId}/settings/...
users/{userId}/onboarding/...
users/{userId}/audit_logs
```

Do not create global financial collections. The internal console may use an
internal admin index for operational metadata only; it must not expose financial
ledger data unless a separate support permission model is created later.

## 7. Phase

Phase 1 only — Internal Operations Console MVP.

In scope: internal-only login guard, internal dashboard page, user list table,
user detail drawer, KYC/payment/account status visibility, manual status update
actions, audit log write for every internal action, existing component/style
reuse.

Out of scope: customer-facing login/register gate changes, payment gateway
integration, real money movement, automatic activation after payment upload,
admin creation of Firebase Auth users from the frontend, reading user ledger/
bills/subscriptions/financial records, workspace migration, role-based multi-admin
UI beyond the first simple credential gate.

## 8. Internal Credentials Requirement

MVP protection is a simple internal credential gate:

```
Username: fluxyos admin
Password: Jakarta1352!
```

Security rules: not production-grade; do not expose in public marketing pages; do
not commit as a long-term permanent production secret; mark client-side temporary
implementation clearly as `MVP_INTERNAL_ONLY_TEMPORARY_AUTH`; keep the route hidden
from public navigation. Later, replace with Firebase Auth custom claims or backend
admin session verification.

Recommended MVP behavior:

```
/internal -> enter username + password -> if valid, store sessionStorage flag ->
internal pages check sessionStorage before rendering
```

Session key:

```js
sessionStorage.setItem('fluxy_internal_admin_session', 'active');
```

Do not use localStorage for this temporary admin session.

## 9. Routes / Files

Phase 1 keeps the surface small (single page with an inline gate):

```
internal.html                         // gate overlay + console with tabs
assets/js/internal-dashboard.js       // all console logic
assets/js/db-service.js               // internal methods added inline
firestore.rules                       // internal_users + internal_audit_logs
```

Tabs inside `internal.html`: Overview, Users, KYC Review, Payment Review, Audit.
Do not add these routes to public landing navigation or the customer dashboard
sidebar.

## 10. Layout

Reuse the existing FluxyOS app/dashboard visual language: white/light-gray app
background, compact app-style topbar, internal-only label "Internal Operations",
no marketing footer, no public landing header, no normal user sidebar.

Reuse: cards (`bg-white border border-gray-200 rounded-xl shadow-sm`), dashboard
table rhythm, primary dark-navy / secondary white buttons, semantic status badges,
`window.showToast`, `window.showConfirmDialog`, `window.showAlertDialog`. Never use
native `confirm()`/`alert()`. No orange page backgrounds.

## 11. Information Architecture

- **Overview** — activation health KPI cards (total users, KYC submitted, KYC
  pending review, payment pending review, active, rejected/needs-revision, stuck in
  onboarding) plus a "latest users needing action" list. Empty state when no users.
- **Users** — full table (user, email, business, phone, KYC, payment, account
  status, created, action). Search + status filters. Actions: Review, Copy UID.
- **KYC Review** — pre-filtered to `kyc_status in [submitted, needs_revision]`.
- **Payment Review** — pre-filtered to `payment_status in [submitted, under_review,
  pending]`.
- **Audit** — latest 100 internal actions. No sensitive document URLs or
  row-level financial data.

Every status-changing action: confirmation dialog -> reviewer note required for
rejection/revision/suspend -> update status -> write audit log -> refresh ->
toast.

## 12. User Detail Drawer

Right-side drawer titled "Review user" with sections: Account summary, Business &
onboarding profile, KYC data, Payment verification, Internal note + actions.
Guardrails: Activate enabled only when KYC approved and payment verified; Verify
payment never creates a transaction; Approve KYC never auto-activates unless
payment already verified; Suspend uses danger confirmation.

## 13. Status Model

```
account_status: registered, kyc_incomplete, kyc_submitted, kyc_approved,
                kyc_rejected, payment_pending, payment_submitted,
                payment_verified, active, suspended
kyc_status:     not_started, in_progress, submitted, needs_revision, approved,
                rejected
payment_status: not_required, pending, submitted, under_review, verified,
                rejected, expired
```

## 14. Firestore Data Model

### 14.1 Existing user-owned onboarding data (read-only reference)

```
users/{userId}/onboarding/progress
users/{userId}/onboarding/profile
users/{userId}/onboarding/documents
users/{userId}/settings/company
```

Do not move existing onboarding data.

### 14.2 Internal operational index — `internal_users/{userId}`

Operational metadata only. No ledger rows, bills, subscriptions, balances, or
financial reports. Schema:

```js
{
  user_id, email, display_name, phone_number,
  business_name, role,
  account_status, kyc_status, payment_status,
  onboarding_completed,
  kyc_submitted_at, kyc_reviewed_at, payment_submitted_at, payment_verified_at,
  plan_id, payment_amount, payment_method,           // denormalized payment fields
  assigned_reviewer_id, last_internal_note, risk_level,
  created_at, updated_at
}
```

### 14.3 Payment verifications (future) — `users/{userId}/payment_verifications/{paymentId}`

Reserved for a future customer-facing payment-proof upload flow. Phase 1 does not
read this subcollection (it is owner-scoped and not readable by the unauthenticated
console); payment status is driven by the denormalized fields on `internal_users`.

### 14.4 Internal audit logs — `internal_audit_logs/{auditLogId}`

```js
{
  actor_uid,                 // null in the credential-gate MVP
  actor_username,            // 'fluxyos admin'
  actor_role,                // 'internal_admin'
  action, target_user_id, before, after, reason,
  source,                    // 'internal_dashboard'
  created_at
}
```

## 15. DataService Requirements

Methods added to `assets/js/db-service.js`:

```
getInternalUsers({ limitCount })
getInternalUser(userId)
updateInternalUserStatus(userId, statusPayload, auditContext)
addInternalAuditLog(payload)
getInternalAuditLogs(limitCount = 100)
syncSelfToInternalIndex(userId, { email, display_name })
```

Rules: all writes include `updated_at: serverTimestamp()`; sensitive writes write
an audit log; no formatted currency strings; no user financial collections read in
the MVP; existing `DataService` behavior stays backward-compatible.

## 16. Internal Auth MVP Logic

```js
// MVP_INTERNAL_ONLY_TEMPORARY_AUTH
// Replace with Firebase custom claims or backend-verified admin sessions
// before production use.
const INTERNAL_USERNAME = 'fluxyos admin';
const INTERNAL_PASSWORD = 'Jakarta1352!';
const INTERNAL_SESSION_KEY = 'fluxy_internal_admin_session';
```

Login: trim username, exact password match, set sessionStorage key on success,
inline error on failure. Guard: `internal.html` checks the session key on load and
shows the gate when missing; the sign-out button clears the key.

## 17–23

Frontend functional requirements, UI states, security guardrails, later-phase
register/login implications, QA checklist, and acceptance criteria are implemented
as specified in the original intake. Acceptance criteria for Phase 1 are met (see
build notes).

## 24–25 Later phases

Phase 2 (customer payment submission + proof upload), Phase 3 (login/account
access gates), Phase 4 (invite/create user via backend Admin SDK), Phase 5 (real
admin auth — Firebase custom claims / backend-verified admin session).

---

## Phase 1 build notes (as implemented)

**Files:** `internal.html`, `assets/js/internal-dashboard.js`, internal methods in
`assets/js/db-service.js`, `internal_users` + `internal_audit_logs` blocks in
`firestore.rules`, self-upsert hooks in `assets/js/sidebar-loader.js` and
`assets/js/onboarding.js`.

**Decisions / deviations (approved):**

- **Auth = credential gate only + open (scoped) rules.** The console is
  unauthenticated to Firestore, so `internal_users` and `internal_audit_logs` are
  intentionally open (field-validated, no delete; audit logs are create/read only).
  `MVP_INTERNAL_ONLY_TEMPORARY` — replace with custom claims / backend before
  production. **The new rules must be deployed for the console to load data.**
- **Population = self-upsert.** Each user's own client upserts its own
  `internal_users/{uid}` row via `DataService.syncSelfToInternalIndex` on app load
  (sidebar-loader auth handler) and on onboarding submit. No customer UX change.
  Reviewer-controlled status fields are never overwritten by self-sync.
- **Audit = single-write to `internal_audit_logs`.** The console cannot write the
  owner-scoped `users/{uid}/audit_logs` (validation requires a real `actor_uid`),
  so the dual user-scoped audit write is deferred to the backend phase.
- **Payment Review uses denormalized fields on `internal_users`** (the user-scoped
  `payment_verifications` subcollection and a real proof-upload flow are future
  work).
- **`internal_users` only covers users who sign in after this ships.** A backfill
  for pre-existing users needs the Admin SDK.
