# FluxyOS — 3-Day Trial Access & Payment Banner

> Workspace access-status system: a 3-day trial that starts after onboarding,
> a slim trial/payment banner across authenticated app pages, a manual payment
> entry point, expiry locks, and internal-ops visibility. **Shipped (Phase 1+2).**

## 1. Product decision

Trial starts **after onboarding/KYC completion**, not registration, so users don't
burn trial time during setup.

```
Register → Complete onboarding → 3-day trial starts → trial banner across app
→ limited use → trial expires → write/export/AI locked → user pays
→ internal team verifies → account active → banner disappears
```

`trial_started_at = onboarding completed_at` (fallback: now). `trial_ends_at = start + 3 days`.

**Legacy/retroactive policy (chosen):** any app-accessible user (onboarding completed
**or** legacy-exempt) without a `billing/access` doc gets a fresh 3-day trial on their
next login. New post-rollout users get it at onboarding completion.

## 2. Data model

### `users/{uid}/billing/access` (owner-scoped)
```
access_status: 'trial_not_started'|'trial_active'|'trial_expiring'|'trial_expired'
              |'payment_pending'|'payment_submitted'|'payment_verified'|'active'|'suspended'
trial_duration_days: 3
trial_started_at, trial_ends_at, trial_expired_at: Timestamp|null
payment_required: bool
payment_status: 'not_started'|'pending'|'submitted'|'under_review'|'verified'|'rejected'
plan_id: string|null
account_status: 'trial'|'active'|'suspended'
created_at, updated_at: Timestamp
```

### `users/{uid}/payment_verifications/{paymentId}` (owner-scoped)
```
amount: number (raw int Rp)   currency: 'IDR'
plan_id, billing_period ('monthly'|'annual'|'custom'), payment_method ('bank_transfer'|'manual'|'other')
proof_document_id, proof_file_name, submitted_note: string|null
status: 'submitted'|'under_review'|'verified'|'rejected'
reviewer_id, reviewer_note: string|null
submitted_at, reviewed_at, created_at, updated_at: Timestamp
```
Proof file uploads via the shared `FluxyDocumentAttachment` (`document_role:
'payment_proof'`, `source_context: 'payment'`) into `users/{uid}/documents/...` +
Storage. No card data / secrets / formatted currency stored.

### `internal_users/{uid}` (open index — added fields)
`access_status`, `trial_started_at`, `trial_ends_at`, `trial_days_remaining`,
`payment_proof_file_name`, plus the existing `payment_status`/`payment_*` fields.
**Non-financial status metadata only** — never ledger rows. Internal `payment_status`
has no `not_started`; the trial's `not_started` is simply not mirrored (stays seeded
`pending`).

## 3. DataService methods (`assets/js/db-service.js`)
`getBillingAccess`, `createTrialAccess`, `ensureTrialAccessAfterOnboarding`,
`updateBillingAccess`, `expireTrialIfNeeded`, `getPaymentVerifications`,
`getLatestPaymentVerification`, `submitPaymentVerification`,
`syncInternalUserAccessIndex`. `completeOnboarding` calls
`ensureTrialAccessAfterOnboarding` (best-effort).

## 4. Access guard (`assets/js/trial-access.js`)
ES module exposing `applyToPage(authUser)` and `window.FluxyAccessGuard`
(`check`, `renderBanner`, `applyPageLocks`, `requireWriteAccess`,
`requireExportAccess`, `requireAIUsage`). Wired in **one place** —
`sidebar-loader.js`'s auth handler — so it runs on every page that loads the sidebar
(all app pages; never landing/login/onboarding/internal/report-preview). Caches state
on `window.__fluxyAccessState`. Skips the banner on `payment.html` itself.

On load it: reads `billing/access` → creates the trial if eligible & missing →
expires if past `trial_ends_at` → reconciles a console verify/reject decision back
into billing (the open console can't write owner-scoped `billing/access`) → derives
state → renders banner + applies locks when not active.

### Gating matrix
| Status | Read | Add records | Export | Fluxy AI | Payment page |
|---|---|---|---|---|---|
| trial_active / expiring | Yes | Yes | No | Yes | Yes |
| trial_expired | Yes (read-only) | No | No | No | Yes |
| payment_submitted | Yes (read-only) | No | No | No | Yes |
| active / verified | Yes | Yes | Yes | Yes | Yes |
| suspended | No | No | No | No | Support only |

Banner copy (slim cream surface, single orange CTA, no orange background block):
Trial active · {n} days left · Trial ends today · Trial ended · Payment submitted ·
Under review · Payment needs revision. Active/verified → no banner.

## 5. Locks & modal
Runtime guards (fail open if state unloaded): `showAddTransactionModal`
(write — covers add tx/bill/sub + CSV import), `toggleFluxyAI` (AI),
`reports.js confirmExportFromDrawer` + ledger CSV download (export), ledger bank
statement import tab (locked until paid). `applyPageLocks` also disables the matching
buttons. Blocked actions show the canonical `showConfirmDialog` "Your FluxyOS trial
has ended" modal (Complete payment / Contact support) — never `alert`/`confirm`.

## 6. Payment page (`payment.html` + `assets/js/payment.js`)
Auth-guarded app shell, no marketing footer. Static MVP plan/amount + bank-transfer
instructions, amount input, proof upload (`FluxyDocumentAttachment`), note, submit.
States: form / under review / rejected (reviewer note + resubmit) / verified. Submit
calls `submitPaymentVerification` (never auto-activates).

## 7. Internal console
Users table: **Access** badge + **Trial left** columns; an **Access** filter (trial
active / ending today / expired / payment not started / submitted / under review /
rejected / verified / active). Drawer: **Trial & payment** section (access, trial
start/end, days remaining, payment + account status). Existing verify/reject/activate
actions unchanged.

## 8. Firestore rules
Added owner-scoped `billing/{doc}` (`isValidBillingAccess`) and
`payment_verifications/{id}` (`isValidPaymentVerification`); extended the audit
`target_collection` whitelist (`billing`, `payment_verifications`), `isValidInternalUser`
(`access_status`, `trial_days_remaining`, `payment_proof_file_name`), and document
`source_context` (`payment`). No global/financial collections added.

## 9. Audit logs
`trial.created`, `trial.expired`, `payment.submitted`, `access.activated` under
`users/{uid}/audit_logs` (source `system`/`dashboard`). Internal reviewer actions keep
writing `internal_audit_logs` (unchanged).

## 10. Known limitations (need backend for production)
- Client-side locks + `expireTrialIfNeeded` are **UX only** — real enforcement needs
  server-side expiry + usage counters (Cloud Functions / rules).
- Per-feature trial counters (30 tx / 10 bills / 5 subs / 10 AI msgs / 3 uploads)
  are **deferred** to the hard-enforcement phase.
- The open (credential-gated) console can't write owner-scoped `billing/access`;
  activation is reconciled client-side on the user's next load — an Admin-SDK backend
  sync is the production path.
- In-console proof-image viewing is still blocked until admin Firebase auth
  (Phase 5), per the internal console Phase 2 plan §6.

## 11. Out of scope (this phase)
Payment gateway, auto-verification, subscription billing provider, bank auto-sync,
WhatsApp AI for trial users, deleting expired data, multi-plan pricing engine,
moving financial data out of `users/{uid}`.
