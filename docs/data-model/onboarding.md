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
| `progress` | `onboarding_completed` (bool), `onboarding_exempt` (bool), `eligible_for_onboarding_gate` (bool), `current_step` (`business_setup`/`account_owner`/`finance_setup`/`review`/`complete`), `completed_steps` (string[]), `selected_first_action` (first selected setup preference, backward-compatible), `selected_first_actions` (string[]), `selected_learning_tours` (string[]), `primary_learning_tour` (string \| null), `skipped` (bool), `source` (`onboarding_v2`/`legacy_exemption`), `created_at`, `updated_at`, `completed_at`, `skipped_at` |
| `profile` | `business_name`, `role` (one of: `Owner / Founder`, `Finance admin`, `Accountant`, `Operations manager`, `Staff`), `main_goal`, `monthly_revenue_range`, `employee_count_range`, `legal_full_name`, `phone_country_code`, `phone_number` (normalized E.164-like string), `created_at`, `updated_at` |
| `documents` | `identity_document_status` (`not_uploaded`/`uploaded`), `identity_document_storage_path` (null in v1), `business_document_status`, `business_document_storage_path` (null in v1), `created_at`, `updated_at` |

**Detection logic** lives in `assets/js/onboarding-gate.js`. Imported as an ES
module by `login.html` (for post-login routing) and by each app page's auth
guard (for in-page gate rendering). `DataService` exposes
`getOnboardingProgress`, `getOnboardingProfile`, `getOnboardingDocuments`,
`saveOnboardingProgress`, `saveOnboardingProfile`, `saveOnboardingDocuments`,
`completeOnboarding`, `skipOnboarding`,
`markLegacyOnboardingExempt`.

**Audit:** `onboarding.submit` and `onboarding.skip` actions are recorded under
`users/{userId}/audit_logs` via the existing `addAuditLog` method.

**Storage:** Document upload is UI-stub only in v1 — no Firebase Storage writes,
no PII persisted beyond legal name + phone in `profile`. Storage paths remain
null.

**Setup preference values:** `selected_first_actions` may contain
`csv_upload`, `add_transaction`, `add_bill`, `dashboard_overview`,
`revenue_review`, `subscriptions`, and `fluxy_ai`. They map to platform
learning tour IDs `ledger`, `bills`, `overview`, `revenue_sync`,
`subscriptions`, and `fluxy_ai`. On completion the user always lands on
`/dashboard`; the first post-KYC coachmark must start with the `overview`
tour, then any selected preference tours may continue after it. Onboarding
queues this via `sessionStorage.fluxy_pending_tour = "overview"` and
`sessionStorage.fluxy_pending_tours` with `overview` first.

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
