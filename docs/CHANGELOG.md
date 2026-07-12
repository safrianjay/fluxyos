# FluxyOS Changelog

All notable changes to FluxyOS are recorded here, newest first.

---

## [Unreleased]
> Changes in progress — not yet pushed to main

### Added (Cash Pressure drill-down + all Overview KPIs clickable)
- **Cash Pressure page** (`cash-pressure.html` / `cash-pressure.js`, `/cash-pressure`) — a forward-looking liquidity runway, distinct from Cash Position's realized view: bank cash + receivables due − payables due over a **30/60/90-day horizon toggle**, a cumulative projected-balance runway chart (positive/negative fill + Today at the left edge), Payables/Receivables/Timing breakdowns, and an upcoming-obligations table (open invoices, unpaid bills, subscription renewals, pending payables/receivables) whose rows deep-link to the original record.
- **All six Overview KPI cards now clickable** — Gross margin → `/revenue-overview` (margin is revenue-driven), Cash pressure → `/cash-pressure`, Payables → `/bill` (Bills already lists payables — reuse instead of a duplicate page). Each has the drill affordance + a "?" tooltip.
- **"?" info tooltip on every KPI cell** of the detail pages (reuses the shared delegated `.metric-info` tooltip), with Bahasa translations.

### Added (Member-path QA harness)
- **`tests/member-drilldown.spec.js`** — an invited-team-**member** browser test for the KPI drill-downs: logs in as a separate member account (fresh context, not the owner storageState) and asserts each page resolves the shared owner workspace (`FluxyWorkspace.id !== memberUid`, not the `workspaces/{memberUid}` fallback), renders without permission errors, and that the member sees the workspace's revenue. **Skips entirely** until `.qa/firebase-test-member-account.md` exists (git-ignored). Provisioning steps documented in `docs/QA_TEST_ACCOUNT.md` (create a 2nd account, invite as member, accept, drop creds). This closes the one blind spot in the KPI drill-down QA — the owner harness can't catch member scoping bugs because for an owner `workspaceId === uid`.

### Added (Deep-link parity + QA coverage)
- **Invoice `?record=` deep-link parity** — `invoices.js` now accepts `?record=<id>` as an alias for its native `?invoice=<id>`, so drill-downs link to invoices with the same param the rest of the app uses. Cash Pressure's receivable-invoice rows now open the specific invoice (`/invoices?record=<id>`).
- **QA coverage** — the four KPI detail pages are added to `dashboard-layout-consistency.spec.js` (shared 1540px canvas + no 375px overflow). New `kpi-drilldown.spec.js` checks: workspace resolved before finance reads (the member "0 data" failure mode), no page-level horizontal overflow at 375px on rendered content, and the invoice deep-link. (A full invited-member browser session still needs a provisioned member account — out of scope for the single-account QA harness.)

### Added (Range persists both ways)
- Returning from a KPI drill-down now reopens the Overview on the **same period**. The detail pages' "Back to Overview" + breadcrumb links (`[data-dashboard-back]`) carry `?period&start&end` (`dashboardBackUrl`), and `dashboard.js` `applyDashboardPeriodFromUrl()` restores it on load — closing the round-trip (previously "Back" always reset to This Month).

### Fixed (Paid bills lingering in Upcoming)
- A bill marked **paid** (or voided) still appeared in the Overview **Upcoming** rail and inflated the action-item counts and payables/cash-pressure totals — `getDashboardOverview` filtered upcoming/overdue bills by due date only. It now excludes bills with `payment_status === 'paid'` or `is_voided` (`isOpenBill`) before the due-date windows, so paid bills drop out of Upcoming, action items, and the payables/cash-pressure aggregates.

### Fixed (Trend chart on long ranges)
- **All Time (and any long range) trend chart** no longer overlaps its x-axis labels into an unreadable smear, and no longer dives to Rp0 at the right edge. `bucketSeries` now trims empty leading/trailing month/quarter buckets (anchor to real activity), and `renderTrendChart` thins the axis to ~10 evenly-spaced labels and hides point markers past 16 buckets. Applies everywhere the shared chart is used.

### Fixed (KPI detail Custom date filter)
- The **Custom** period button on the detail pages now works — it previously resolved to `this_month` with no dates and never revealed the range picker. It now switches to custom mode, seeds + shows the `FluxyDateRangePicker`, and reloads on Apply.

### Added (Dashboard KPI drill-down pages)
- **Three new KPI detail pages** — the Overview Revenue, Cash position, and OpEx-vs-budget cards are now clickable and open dedicated drill-down pages: `revenue-overview.html` → `/revenue-overview`, `cash-position.html` → `/cash-position`, `opex-budget.html` → `/opex-budget`. Each answers "where is this number coming from?" with a summary/KPI strip, a larger interactive trend chart, contribution breakdowns, and a searchable/sortable/paginated/exportable records table. Flat routes served by Netlify `pretty_urls` — no `netlify.toml` change.
- **Clickable Overview KPIs** (`dashboard.html` + `dashboard.js`) — the three cards gain `.metric-cell-clickable` (subtle border/shadow lift + drill chevron, keyboard-focusable `role="link"`). A delegated click/Enter/Space handler (`mountKpiDrillNav`) navigates to the matching page, carrying the current dashboard range in the query string (`?period&start&end`) so the detail page opens on the same period. Clicks on the inner "?" info button and the bank/budget CTAs keep their own behavior.
- **Shared scaffold** (`assets/js/kpi-detail-shared.js`) — one reusable toolkit behind all three pages: URL period parse/persist (`resolvePeriodFromUrl` / `writePeriodToUrl`), period-strip + `FluxyDateRangePicker` wiring, `renderKpiStrip`, `renderTrendChart` (area/line with optional zero-baseline positive/negative fill + today marker, wired to the shared `attachChartHover` tooltip), `bucketSeries` (adaptive day/week/month/quarter) + `toCumulative`, `renderBreakdownList`, and `createSupportingTable` (search + sort + `createTablePaginator` + CSV export gated by `FluxyAccessGuard`). Table rows deep-link into the Ledger via the existing `?record=<id>` drawer contract.
- **Breakdowns** — Revenue: by category / channel (`source`) / business (`entity_id`). Cash: by account, in/out, upcoming receivables (open invoices) & payables (unpaid bills). OpEx: by category, budget-vs-actual per allocation, and over-budget categories (from `getBudgetUsage`).
- **Reuse-first & scoped** — all reads route through existing `DataService` methods (`getRevenueTransactionsForDashboardStats`, `getTransactionsForPeriod`, `getLedgerCashPosition`, `getBankAccounts`, `getInvoices`, `getBills`, `getActiveBudget`, `getBudgetUsage`) so finance data stays workspace-scoped (no hardcoded `users/` paths). New shared CSS: `.kpi-detail-*`, `.kpi-period-*`, `.kpi-dim-btn` (shared-dashboard.css) and `.metric-cell-clickable` (dashboard.css). Sidebar highlights Overview on all three routes. Bahasa dictionary + PATTERNS added; pages added to `scripts/i18n-audit.js` scope.

### Added (Voucher codes — checkout discounts + internal Vouchers tab)
- **Checkout voucher input** (`checkout.html` / `checkout.js` / `checkout.css`) — new "Voucher code" section directly under Billing frequency: uppercase-normalized input + Apply, green applied chip (code · percent · −amount · Remove), inline error copy for invalid / expired / disabled / usage-limit / plan-mismatch / frequency-mismatch, and a "Voucher CODE −Rp…" summary row. PPN now applies to the discounted subtotal; switching plan/frequency revalidates (ineligible vouchers auto-remove); Remove restores the original total.
- **Server-enforced redemption** (`firestore.rules`) — `hasValidPaymentRequestVoucher` accepts a discount only when, in the same commit, the canonical `voucher_codes/{CODE}` doc is active/in-window/allowed and still has slots, the discount equals `subtotal * percent / 100` (integer-exact), `redemption_count` bumps exactly +1, and a mirrored `voucher_redemptions/{paymentRequestId}` doc is created (`isValidVoucherRedemptionCreate` cross-checks every amount via `getAfter`). Edited browser JS cannot forge a discount. `billing_payment_requests` gains 4 optional (`hasOnly`) fields: `voucher_id`, `voucher_code`, `voucher_discount_percent`, `voucher_discount_amount` — null/absent means no voucher, so pre-voucher cached clients keep working.
- **New collections** — `voucher_codes/{CODE}` (doc id == normalized code; `get` allowed, `list` denied), `voucher_code_index/registry` (console listing without enumeration queries), `voucher_redemptions/{paymentRequestId}` (`reserved → redeemed|cancelled`; doubles as the redemption audit record). Same `MVP_INTERNAL_ONLY_TEMPORARY` posture as `internal_users` (field-validated, not identity-gated) — documented gaps in PROJECT_BACKGROUND §4l.1.
- **DataService** — `validateVoucherCode`, `getVoucherCode(s)`, `createVoucherCode` (atomic voucher + registry + `voucher.create` audit), `updateVoucherCode`, `disableVoucherCode`, `getVoucherRedemptions`, `getAllVoucherRedemptions`, `markVoucherRedemptionsRedeemed`; `createPaymentRequest` accepts `voucher_code` and routes voucher checkouts through a `runTransaction` (race-safe last-slot handling, typed `voucher-*` errors). `calculateBilling` gains an optional voucher param + `voucherDiscountAmount` (no-voucher output unchanged).
- **Internal console Vouchers tab** (`internal.html` / `internal-dashboard.js`) — between Payment Review and Audit: KPI cards (Active, Total redemptions, Discount given, Expiring soon), voucher table (code in Fira Code, status/usage/validity/plans, Copy / Usage / Disable), create drawer (Generate random code, discount %, max redemptions, FluxyDateRangePicker validity dates, plan + frequency scoping, internal note, >50% and 100% confirmations), danger-confirm Disable, usage drawer with per-redemption rows, and `voucher.*` rows in the Audit tab. `payment.verify` now also settles the user's reserved redemptions to `redeemed` (best-effort).
- **Cancel from the pending-verification card** (`payment-pending.html` / `payment-pending.js`) — the cancel-payment flow was previously reachable only from the QRIS screen, so VA/Card/Invoice requests in `pending_verification` had no way out. The status card now shows "Cancel payment request" (same shared confirm modal → `cancelPaymentRequest`), and canceling a voucher checkout also settles its `voucher_redemptions` doc to `cancelled` (best-effort; the redemption slot itself stays consumed in v1 — rules only allow +1 counter bumps).

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
- **Allocation detail drill-in** from `/budget-period` — click any allocation row to open the allocation detail page showing the allocation's stat strip, deterministic variance explanation, related transactions, and related bills. Each related-record row carries Change/Exclude actions.
- **Unallocated records queue** — section on `/budget-period` lists every in-period spend record with no matching allocation. Per-row Assign and Exclude actions.
- **Excluded records section** — collapsible card listing records the user manually excluded from this budget, with the exclusion reason and a Restore action.
- **Budget activity timeline** — collapsible audit log of `budget_assignment.update` / `.exclude` / `.restore` actions scoped to the current budget (filtered by `after.budget_id`).
- **Shared `FluxyBudgetAssignment` drawer** (assets/js/shared-dashboard.js) — lazy-injected mini-form drives all three actions (assign / exclude / restore) with a required-reason field. Reused by `/budget-period`, `/ledger`, and `/bill`.
- **Budget chip + Assign action on every Ledger and Bills row** — small badge under the Category cell shows `Marketing Budget` / `Auto · Marketing` / `Unallocated` / `Excluded` for in-period spend records. Clicking the link opens the shared assignment drawer.
- **9 new optional transaction fields**: `budget_id`, `budget_allocation_id`, `budget_match_method`, `budget_match_status`, `budget_match_confidence`, `budget_assignment_reason`, `budget_assignment_updated_at`, `budget_assignment_updated_by`, `budget_exclusion_reason`. All optional; legacy transactions keep working via category fallback.
- **4 new optional bill fields**: `budget_assignment_reason`, `budget_assignment_updated_at`, `budget_assignment_updated_by`, `budget_exclusion_reason`. Phase 1.5's 5 bill fields gain `'rule'` and `'excluded'` enum values.
- **DataService methods**: `resolveRecordAssignment`, `getBudgetRelatedRecords`, `getUnallocatedBudgetRecords`, `getBudgetActivityLogs`, `updateTransactionBudgetAssignment`, `updateBillBudgetAssignment`, `excludeTransactionFromBudget`, `excludeBillFromBudget`, `restoreBudgetAssignment`. Every Phase 2 writer commits the record update + audit log in one Firestore `writeBatch`.
- **`docs/QA_CHECKLIST.md` §L** — 15 Phase 2 probes.

### Changed (Budget Phase 2)
- **`firestore.rules`** — additive: `isValidTransactionBudgetFields` validator added and wired into transactions create + update; `isValidBillBudgetFields` extended with 4 new fields and enum expansion; bills/transactions `hasOnly` allowlists extended. All Phase 2 writers must set `budget_assignment_updated_by == request.auth.uid` (rule-pinned).
- **`getBudgetUsage` resolver-based refactor** — totals now route through `resolveRecordAssignment` so manual assignment / exclusion override category matching. Return shape unchanged; existing callers (the Phase 1 Budget page summary) keep working.
- **Allocation rows on `/budget-period` are clickable** — each row routes to `/budget-allocation/{allocationId}` with reloadable allocation context plus a deterministic variance explanation line under the allocation name. Legacy `.html?budgetId=...&periodId=...&allocationId=...` links remain readable.

### Added
- **Budgets app page** (`/budget`) — Main Budget control surface. Annual/main selector, annual total, spent + reserved, not planned yet, planned-into-periods progress, and clickable Period budgets table. Sidebar Budgets entry promoted from disabled `Soon` to a real link.
- **Period Budget Detail flow** (`/budget-period`) — name, total, period (range), monthly/quarterly/yearly type, optional notes, allocation rows (Marketing / Infrastructure / Operations / SaaS — Revenue intentionally excluded). Live "Allocated of Total / Unallocated" totals, over-allocation warning, validation that blocks submit until all fields valid.
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
