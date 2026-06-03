# FluxyOS Changelog

All notable changes to FluxyOS are recorded here, newest first.

---

## [Unreleased]
> Changes in progress — not yet pushed to main

### Fixed (Internal review reaches the user)
- **Reviewer Verify/Reject now reaches the customer.** The ops console only writes the open `internal_users` index (it has no Firebase identity), so its decisions never touched the canonical `billing_subscription/current` — a rejected/verified user saw no change. Added `DataService.reconcileBillingFromInternalIndex` (called from `ensureBillingSubscription`): on the user's next load an in-flight `pending_verification`/`awaiting_payment` subscription becomes `payment_failed` (rejected) or `active` (verified), gated so the internal decision must be newer than the subscription's last write (retries aren't clobbered). New rule `isInternalReviewReconcile` authorizes the owner self-write; `getBillingReviewReason` surfaces the reviewer note.
- **Rejected payment UX on `/payment-pending`** — shows the reviewer's reason, a "Complete payment again" primary CTA, and a "Back to dashboard" secondary. The existing `payment_failed` banner already drives the retry. (UX-only MVP enforcement; the internal index is open, so a trusted backend should own activation in production.)

### Added (Manual QRIS payment step)
- **QRIS "pay the QR first" flow** — choosing QRIS at checkout now creates the payment request as `awaiting_payment` and routes to `/payment-pending?requestId=...`, which renders a premium two-column QR screen (checkout's purple/navy gradient): the merchant QR (`assets/images/qris-tanda360.png`), exact amount, plan/billing, request ID, and bank reference (Safrian Jayadi · OCBC Nisp · 6938-1098-7877). Non-QRIS methods are unchanged (direct `pending_verification`).
- **Confirm + optional proof** — "I've completed payment" reveals an optional proof upload (JPG/PNG/WebP/PDF ≤5 MB, reusing the `documents/` + Storage flow as `payment_proof`/`payment` context) and "Submit for verification", which moves the request + subscription to `pending_verification` in one batch and shows the verification-in-progress state. Revisiting `/payment-pending` while `awaiting_payment` re-shows the QR.
- **`awaiting_payment` banner state** (`assets/js/trial-access.js`) — "QRIS payment waiting. Complete payment to activate your FluxyOS plan." with a "View QRIS payment" CTA; trial write/AI/upload access is retained while awaiting payment.
- **`QRIS_PAYMENT_INFO` constant** (`assets/js/billing-config.js`) — static merchant/bank display values (not persisted per user).
- **5 new `billing_payment_requests` fields** — `user_confirmed_payment_at`, `submitted_for_verification_at`, `proof_document_id`, `proof_file_name`, `proof_uploaded_at` (all `null` at create).
- **DataService methods** — `getPaymentRequestById` and `submitPaymentRequestForVerification(uid, requestId, { proofDocumentId, proofFileName })` (batched request update + subscription transition + `billing.payment_confirmation_submitted` audit).

### Changed (Manual QRIS payment step)
- **`firestore.rules`** — `isValidBillingPaymentRequest` allows `payment_status in [awaiting_payment, pending_verification]` at create and the 5 new fields (`null` at create); new `isValidPaymentRequestVerificationSubmit` permits the owner-driven `awaiting_payment → pending_verification` update (lifecycle + proof fields only; `verified`/`failed`/`expired` stay server-owned). Subscription `status` enum gains `awaiting_payment`; new `isCheckoutAwaitingPaymentWrite` wired into the subscription create + update branches.
- **`payment-pending.html` / `assets/css/payment-pending.css`** — split into a QR view and the existing status card; centering moved to a `.status-view` wrapper.

### Added (Budget Phase 2 — record-level control)
- **Allocation detail drawer** on `/budget` — click any allocation row to open a right-side drawer showing the allocation's stat strip, deterministic variance explanation, related transactions, and related bills. Each related-record row carries Change/Exclude actions.
- **Unallocated records queue** — new section on `/budget` lists every in-period spend record with no matching allocation. Per-row Assign and Exclude actions.
- **Excluded records section** — collapsible card listing records the user manually excluded from this budget, with the exclusion reason and a Restore action.
- **Budget activity timeline** — collapsible audit log of `budget_assignment.update` / `.exclude` / `.restore` actions scoped to the current budget (filtered by `after.budget_id`).
- **Shared `FluxyBudgetAssignment` drawer** (assets/js/shared-dashboard.js) — lazy-injected mini-form drives all three actions (assign / exclude / restore) with a required-reason field. Reused by `/budget`, `/ledger`, and `/bill`.
- **Budget chip + Assign action on every Ledger and Bills row** — small badge under the Category cell shows `Marketing Budget` / `Auto · Marketing` / `Unallocated` / `Excluded` for in-period spend records. Clicking the link opens the shared assignment drawer.
- **9 new optional transaction fields**: `budget_id`, `budget_allocation_id`, `budget_match_method`, `budget_match_status`, `budget_match_confidence`, `budget_assignment_reason`, `budget_assignment_updated_at`, `budget_assignment_updated_by`, `budget_exclusion_reason`. All optional; legacy transactions keep working via category fallback.
- **4 new optional bill fields**: `budget_assignment_reason`, `budget_assignment_updated_at`, `budget_assignment_updated_by`, `budget_exclusion_reason`. Phase 1.5's 5 bill fields gain `'rule'` and `'excluded'` enum values.
- **DataService methods**: `resolveRecordAssignment`, `getBudgetRelatedRecords`, `getUnallocatedBudgetRecords`, `getBudgetActivityLogs`, `updateTransactionBudgetAssignment`, `updateBillBudgetAssignment`, `excludeTransactionFromBudget`, `excludeBillFromBudget`, `restoreBudgetAssignment`. Every Phase 2 writer commits the record update + audit log in one Firestore `writeBatch`.
- **`docs/QA_CHECKLIST.md` §L** — 15 Phase 2 probes.

### Changed (Budget Phase 2)
- **`firestore.rules`** — additive: `isValidTransactionBudgetFields` validator added and wired into transactions create + update; `isValidBillBudgetFields` extended with 4 new fields and enum expansion; bills/transactions `hasOnly` allowlists extended. All Phase 2 writers must set `budget_assignment_updated_by == request.auth.uid` (rule-pinned).
- **`getBudgetUsage` resolver-based refactor** — totals now route through `resolveRecordAssignment` so manual assignment / exclusion override category matching. Return shape unchanged; existing callers (the Phase 1 Budget page summary) keep working.
- **Allocation rows on `/budget` are clickable** — each row gets an `:hover:bg-orange-50/30` + `cursor-pointer` plus a deterministic variance explanation line under the allocation name.

### Added
- **Budgets app page** (`/budget`) — Phase 1 operating budget control surface. Main budget summary (total / actual / committed / remaining / usage progress), allocation breakdown table with Healthy / Watch / At Risk / Exceeded status, risk panel and unallocated-spend card that only appear when there's real risk. Sidebar Budgets entry promoted from disabled `Soon` to a real link.
- **Create / Edit Budget drawer** — name, total, period (range), monthly/quarterly/yearly type, optional notes, allocation rows (Marketing / Infrastructure / Operations / SaaS — Revenue intentionally excluded). Live "Allocated of Total / Unallocated" totals, over-allocation warning, validation that blocks submit until all fields valid.
- **`users/{userId}/budget_allocations` Firestore collection** — category-scoped sub-budgets (`parent_budget_id`, `name`, `allocated_amount`, `scope_type: "category"`, `scope_values`, optional `alert_threshold_percent` + `hard_limit_enabled`, `status`, timestamps). Owner read/create/update only; delete blocked. Composite index expected on `(parent_budget_id ASC, created_at ASC)` with a fallback path in `DataService.getBudgetAllocations`.
- **Add Bill drawer budget impact preview (Phase 1.5)** — when an active budget exists, the drawer prefetches it (after `auth.authStateReady()`) and reactively renders Matched / Exceeded / Unmatched / Needs-review / Out-of-period / No-active-budget copy as the user changes amount, category, or due date. On save, writes 5 new optional bill fields: `budget_id`, `budget_allocation_id`, `budget_match_method`, `budget_match_status`, `budget_impact_status`.
- **DataService methods** — `getBudgetAllocations`, `addBudgetWithAllocations`, `getBudgetUsage`, `matchBillToAllocation` (pure-JS helper), `_normalizeAllocationInput`, `_budgetAllocationStatus`, `_emptyBudgetUsage`.
- **`tests/budget-verify.spec.js`** — 7-probe Playwright verify spec covering sidebar active state, page render, drawer validation, bill preview reactivity, 8-page regression sweep, and save atomicity.
- **`docs/QA_CHECKLIST.md` §K** — new K1–K7 sections covering page shell/auth, empty state, usage calculation, edit/resave, Add Bill preview, data isolation, and the save-atomicity regression.

### Changed
- **`users/{userId}/budgets` schema** — extended with optional `notes` (≤500 chars). All other fields unchanged. The new Budget page dual-writes a denormalized `category_budgets` map derived from allocations so the dashboard's `OpEx vs Budget` KPI and `settings-budget.html` history table stay coherent. Both pages now operate on the same active budget doc.
- **`firestore.rules`** — additive only. `isValidBudget` accepts optional `notes`; new `isValidBudgetAllocation/Create/Update` validators + `match /budget_allocations/{id}` block; bills `hasOnly` allowlists (create + update) extended with the 5 new optional budget fields and `isValidBillBudgetFields` enum/string checks. Audit-log `target_collection` enum now accepts `"budget_allocations"`. **Rules must deploy before any new-flow save succeeds.**
- **`sidebar-loader.js`** — Budgets is now `<a href="/budget">` instead of a disabled `Soon` button. Page-active-state `pageIdMap` orders `'settings'` before `'budget'` so `/settings-budget.html` still highlights Settings (not Budgets).
- **`shared-dashboard.js`** — Add Bill drawer (only `context: 'bill'`) gains a `#tx-budget-preview` block plus reactive renderer; transaction and subscription paths are unchanged. Bill save payload attaches the 5 budget fields when an active budget exists; omits them entirely when not.
- **`docs/ROADMAP.md`** — Budgets row moved from 📋 Planned → ✅ Shipped Phase 1.

### Fixed
- **`addBudgetWithAllocations` is now atomic.** Previously the budget doc was updated *before* the allocation batch write; if the allocation write was rejected (rules-not-deployed, validation, network), the budget doc was left half-modified. The QA harness reproduced this against live Firebase. The fix folds the budget create/update, prior-allocation archive, and new-allocation creates into a single `writeBatch`. If any row fails, none commits. Audit logs moved post-commit and made non-fatal. Verified by `tests/budget-verify.spec.js` B6.
- **Bill drawer budget preview no longer false-fires "Session expired"** on first open. Auth was being read before Firebase rehydrated `currentUser` from IndexedDB. The preview IIFE now `await`s `auth.authStateReady()` first.
- **Removed duplicate `matchBillToAllocation` logic.** The bill drawer's inline matcher in `shared-dashboard.js` was deleted; both the preview renderer and the bill save payload now route through `DataService.matchBillToAllocation` via a closure stored on `billBudgetContext.match`. Eliminates drift risk between preview and persisted state.
- **`getBudgetUsage` now period-filters bills server-side** via `getBillsForPeriod` instead of `getBills` (which fetched every bill the user had ever created). The Budget page no longer scales linearly with total bill count.
- **`getBudgetAllocations` limits bumped to tolerate edit history.** Primary query goes from `limit(50)` → `limit(500)`; fallback path from `limit(200)` → `limit(1000)`. Because `addBudgetWithAllocations` archives old rows on every save, a user who re-saves their budget many times could previously have lost active allocations if the index-missing fallback was hit. Phase 2 should hard-delete archived rows once audit-log retention covers the history.

---

## 2026-05-08

### Added
- `QA_CHECKLIST.md` — full QA workflow with smoke tests, 9 change-type sections, DB & logic verification, cross-page regression, and final gate
- `PROJECT_BACKGROUND.md` — architecture reference: Firestore schema, field names, function signatures, business logic rules, brand conventions, git workflow
- `CLAUDE.md` — Claude session rules: QA enforcement, project conventions, pointers to background and QA docs
- SVG favicon (`assets/images/favicon.svg`) — black F-logo from navbar, added to all 10 HTML pages

### Changed
- Login page left panel: canvas z-index raised to 2 (above Unsplash image) to remove teal/green tones
- Login "Trusted by 1,200+" section: replaced colored company letter badges with dark gray avatar icons
- `fluxyos.html` bottom CTA section: restored to original `bg-gray-50` light background after dark version rejected

### Fixed
- Login page left panel showing teal/green tones from Unsplash background image bleeding through canvas

---

## 2026-05-07

### Added
- Reusable footer component (`includes/footer.html`) — loaded dynamically on all landing pages via `footer-loader.js`
- `assets/js/universe-canvas.js` — shared starfield canvas animation (220 particles, dark navy + purple glow, no teal)
- `assets/js/footer-loader.js` — dynamically injects footer on landing pages, skips dashboard app pages
- `assets/css/footer.css` — footer dark navy base, purple border, z-index stacking for canvas
- Universe starfield background on login page left panel (`login-universe-canvas`)
- Animated starfield background on footer (same shared canvas utility)

### Changed
- Footer logo updated to match navbar (orange `#EA580C` on dark background)
- Canvas animation colors changed from teal/cyan to dark purple only (`rgba(88,28,135)`, `rgba(109,40,217)`)
- Hamburger menu in `fluxyos.js` fixed with `readyState` guard (replaced fragile `DOMContentLoaded` listener)
- `fluxyos.html` bottom CTA: experimental dark version with purple glow and frosted glass button

### Fixed
- Stray `</a>` closing tag at line 1749 in `fluxyos.html` (should have been `</div>`)
- Hamburger menu not appearing on click due to `DOMContentLoaded` firing before script ran
- Footer not loading on some pages due to timing issue

### Removed
- Inline footer markup from `fluxyos.html` and `budgetlanding.html` (replaced by shared component)
- "Careers" link from footer Company section

---

## 2026-05-06

### Added
- Dynamic budgeting landing page (`budgetlanding.html`) integrated with platform header and footer

### Changed
- Clean URLs enabled: removed `.html` extensions from all internal links
- Netlify `pretty_urls` enabled in `netlify.toml`

---

## Earlier Commits

### Fixes & Stability
- Bills and Subscriptions tables now update correctly — newly added items lacked `dueDate`/`amount` fields for sorting; now sorting by `timestamp`
- `DataService` returns raw numbers to permanently resolve Double Rp bug on Dashboard KPIs
- Safe Firebase init in `dashboard.js`, context-aware modal submit label, full modal removal on close
- Removed duplicate `loadDashboard` call (caused double Rp prefix); fixed stale modal reuse (wrong context on Bills/Subs)
- Resolved Null innerHTML and Firebase initialization errors across platform
- Resolved DataService import path errors on Netlify (absolute root path fix)
- Fixed Firebase initialization timing; updated button labels to "Add Transaction"

### Features
- Real-time Firestore sync activated: Dashboard, Ledger, Bills, Subscriptions
- Context-aware transaction modals: Bills page defaults to "Operations", Subscriptions to "SaaS"
- Toast notification system: top-right slide-in, 4s auto-dismiss, success/error/info types
- Shimmer skeleton loaders while data fetches
- Real-time thousand-separator formatting for amount input (Indonesian Rupiah)
- Premium micro-animations, glassmorphism effects on dashboard

### Brand
- Sidebar logo: restored official FluxyOS Engine geometric F logo
- Sidebar: collapse/expand toggle (260px ↔ 80px)
