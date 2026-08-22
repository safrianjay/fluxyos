---
status: current
owns: [onboarding, platform_learning]
updated: 2026-08-07
source: docs/PROJECT_BACKGROUND.md §4 (sharded 2026-08-07)
---

# Onboarding & Platform Learning

> Workspace-scoping rules for these collections live in
> [`PROJECT_BACKGROUND.md` §4](../PROJECT_BACKGROUND.md#4-firestore-database-schema).
> Read that first — it is always loaded; this shard is not.

### 4f. Onboarding — `users/{userId}/onboarding/{onboardingDoc}`

User-scoped first-run setup. Applied **only to users created on/after
`ONBOARDING_RELEASE_CUTOFF` (2026-05-19T00:00:00.000Z)**. Pre-cutoff users get a
silent `onboarding_exempt: true` marker on first login and are never gated or
redirected.

| Document | Fields |
|----------|--------|
| `progress` | `onboarding_completed` (bool), `onboarding_exempt` (bool), `eligible_for_onboarding_gate` (bool), `kyc_enforced` (bool — see KYC review gate below), `current_step` (`business_setup`/`account_owner`/`finance_setup`/`review`/`complete`), `completed_steps` (string[]), `selected_first_action` (first selected setup preference, backward-compatible), `selected_first_actions` (string[]), `selected_learning_tours` (string[]), `primary_learning_tour` (string \| null), `skipped` (bool), `source` (`onboarding_v2`/`legacy_exemption`), `created_at`, `updated_at`, `completed_at`, `skipped_at` |
| `profile` | `business_name`, `country` (ISO 3166-1 alpha-2: `ID`/`PH`/`SG`/`MY`), `base_currency` (`IDR`/`PHP`/`SGD`/`MYR`) — **mirrors** of the canonical workspace fields, carried here so the KYC reviewer sees them alongside the documents, `role` (one of: `Owner / Founder`, `Finance admin`, `Accountant`, `Operations manager`, `Staff`), `main_goal`, `monthly_revenue_range`, `employee_count_range`, `legal_full_name`, `phone_country_code`, `phone_number` (normalized E.164-like string), `created_at`, `updated_at` |
| `documents` | `identity_document_status` (`not_uploaded`/`uploaded`), `identity_document_storage_path`, `identity_document_file_name`, `business_document_status`, `business_document_storage_path`, `business_document_file_name`, `created_at`, `updated_at` |

**Detection logic** lives in `assets/js/onboarding-gate.js`. Imported as an ES
module by `login.html` (for post-login routing) and by each app page's auth
guard (for in-page gate rendering). `DataService` exposes
`getOnboardingProgress`, `getOnboardingProfile`, `getOnboardingDocuments`,
`saveOnboardingProgress`, `saveOnboardingProfile`, `saveOnboardingDocuments`,
`completeOnboarding`, `skipOnboarding`,
`markLegacyOnboardingExempt`.

**Audit:** `onboarding.submit` and `onboarding.skip` actions are recorded under
`users/{userId}/audit_logs` via the existing `addAuditLog` method.

**Storage:** KYC documents upload to Firebase Storage at
`users/{uid}/kyc/{identity|business}/{fileName}` (JPG/PNG/PDF, ≤5MB), uploaded
**on file select** so a type/size rejection surfaces at the field rather than as
a failed submit. The **identity document is required**; the business document is
optional (many Indonesian SMBs are unregistered sole traders with no NIB).

The path is **user-scoped, not `_scope()`-routed** — a workspace teammate must
never be able to read the owner's ID. `storage.rules` grants read/write only to
that same uid, and no download URL is ever minted (`getDownloadURL()` bypasses
Security Rules — see the token note in `db-service.uploadDocument`). The user
re-reads via `getDocumentBlob()`. **Reviewers** read through
`netlify/functions/kyc-document-url.js`, a token-gated Admin-SDK endpoint that
returns a 10-minute signed URL and verifies the stored path is inside that
user's own KYC prefix before signing. Upload is `DataService.uploadKycDocument`,
which skips the plan-limit checks because it runs before any subscription
exists.

**Setup preference values:** `selected_first_actions` may contain
`csv_upload`, `add_transaction`, `add_bill`, `dashboard_overview`,
`revenue_review`, `subscriptions`, and `fluxy_ai`. They map to platform
learning tour IDs `ledger`, `bills`, `overview`, `revenue_sync`,
`subscriptions`, and `fluxy_ai`. The first post-KYC coachmark must start with
the `overview` tour, then any selected preference tours may continue after it,
queued via `sessionStorage.fluxy_pending_tour = "overview"` and
`sessionStorage.fluxy_pending_tours` with `overview` first. A **non-enforced**
user lands on `/dashboard` on completion and `onboarding.js routeAfterSubmit`
queues it there; a **KYC-enforced** user is locked instead, so `kyc-gate.js`
re-queues it from `selected_learning_tours` at approval (sessionStorage cannot
survive a multi-day review), and only when `platform_learning` shows the user
has never started, completed, skipped, or dismissed a tour.

### KYC review gate — `assets/js/kyc-gate.js`

A user is locked out of the **entire app** between submitting onboarding and
being approved in the Internal Operations Console — but **only** when
`onboarding/progress.kyc_enforced === true`.

That flag is the authoritative marker, and both halves of the feature read it:
the client gate and `ensureBillingSubscription` (which only ever receives a uid,
never the auth metadata), so they cannot disagree about who is enforced.
`KYC_ENFORCEMENT_CUTOFF` (`2026-08-07T00:00:00.000Z`, keyed on Firebase
`creationTime`) decides only **who gets the flag at submit time** — it is not
itself the lock condition. Deciding from the flag rather than from `creationTime`
is what keeps a submission made *before* this shipped safe: that user already
holds a running trial and carries no flag, so nothing retroactively locks them.
The whole existing roster sits at `kyc_status: 'submitted'` unreviewed and is
therefore untouched.

- **Decision source:** `internal_users/{uid}.kyc_status` (open read). Read
  failures fail open; a missing row blocks at `review` and retries the self-sync.
- **Wiring:** one delegation at the tail of `onboarding-gate.js applyToPage()`,
  which every app page already awaits before its data load and skips on a truthy
  return — so no page was edited. Variants: `submitted`/`in_progress`/
  `not_started` → "under review", `needs_revision` → resubmit CTA back into
  `/onboarding`, `rejected` → declined. All three carry `support@fluxyos.com`.
  A live `subscribeInternalUser` listener reloads the page on approval.
- **Resubmission:** `syncSelfToInternalIndex(uid, { resubmitted: true })` — set
  only by the onboarding submit handler — is the one path allowed to move
  `needs_revision` back to `submitted`. Ordinary page-load syncs never do.
- **Reviewer alerts:** every new signup and every new KYC submission emails
  `KYC_ALERT_EMAIL` (default `safrian@fluxyos.com`) with the full submitted
  profile + document status, via `reconcileInternalUsers` (the existing 5-minute
  notify sweep, so no new cron). **The recency window in `internalAlertFlags` is
  a backfill guard, not a nicety** — every existing roster user sits at
  `kyc_status: 'submitted'` unreviewed, so a status-only condition would send one
  email per existing user on the first sweep. Guarded twice (6h freshness +
  `NOTIFY_AFTER`) and pinned by `npm run check:kyc-alerts`.
- **Trial timing:** `completeOnboarding` no longer starts the trial. For an
  enforced user `ensureBillingSubscription` refuses until `kyc_status` is
  `approved` and then dates `trial_started_at` from the approval moment, so the
  3 days are not burned during review. Enforced server-side by
  `isTrialSubscriptionCreate` → `passesKycTrialGate` in `firestore.rules`.
  Trial duration, plan, and feature rules are otherwise unchanged.

### 4g. Platform Learning — `users/{userId}/platform_learning/state`

User-scoped post-KYC learning progress. This is an educational layer only and
must never bypass or replace the onboarding gate.

| Field | Type | Notes |
|-------|------|-------|
| `dismissed` | bool | If true, do not auto-render Quick ways to get started |
| `dismissed_at` | Firestore Timestamp \| null | Set when the learning section is dismissed |
| `first_rendered_at` | Firestore Timestamp | First time the learning section was rendered |
| `last_seen_at` | Firestore Timestamp | Latest learning section or tour activity |
| `started_tours` | string[] | Tour IDs the user started |
| `completed_tours` | string[] | Tour IDs the user completed |
| `skipped_tours` | string[] | Tour IDs the user skipped |
| `active_tour` | string \| null | Current tour intent, if any |
| `updated_at` | Firestore Timestamp | Server timestamp for the latest mutation |

Valid tour IDs: `overview`, `ledger`, `bills`, `budgets`, `fluxy_ai`,
`revenue_sync`, `subscriptions`.

`DataService` exposes `getPlatformLearningState`, `savePlatformLearningState`,
`markPlatformTourStarted`, `markPlatformTourCompleted`,
`markPlatformTourSkipped`, and `dismissPlatformLearning`.

Completed tours stay restartable from their cards while the quick-start section
is visible. When every rendered tour ID is present in `completed_tours`, the
dashboard action changes from Dismiss to Completed; clicking it stores
`dismissed: true` and stops future auto-renders.

**Critical order:** App pages must run auth and `FluxyOnboardingGate.applyToPage`
first. If the onboarding gate renders, clear `sessionStorage.fluxy_pending_tour`
and do not render Quick ways to get started or start coachmarks.

### Business country & base currency (set once, at signup)

Captured on the `business_setup` step and written to **two** places:

- `workspaces/{workspaceId}.country` / `.base_currency` — **canonical**. Written by
  `DataService.ensureWorkspace` at onboarding submit. This is what
  `workspace-service.js` reads and pushes into the money seam
  (`window.FluxyMoney.setBaseCurrency`), so every formatter in the app follows it.
- `users/{uid}/onboarding/profile` — a mirror, so the KYC reviewer sees the
  declared country next to the registration documents and can catch a mismatch
  **before** any financial data exists.

The country **pre-selects** the currency; it does not constrain it. Functional
currency follows the primary economic environment, not the place of incorporation
(IAS 21 / PSAK 10 / PAS 21), so a Singapore entity may legitimately keep books in
another supported currency. Once the user picks a currency themselves, changing
the country stops overwriting it.

**Immutable after it is set** — enforced by a set-once clause on the workspace
`allow update` in `firestore.rules`, not by hiding the Settings control. The base
currency is how every stored integer is *read* (IDR stores rupiah, the others
store cents), so changing it after records exist silently re-prices history and
re-interprets closed periods whose net income is already posted to Retained
Earnings. Regression test: `tests/base-currency-rules-emulator-test.mjs`.

A legitimate change runs server-side through `/internal` with the Admin SDK,
which these rules do not gate — safe only while the workspace still has no
financial records.
