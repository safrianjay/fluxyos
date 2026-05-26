# FluxyOS Changelog

All notable changes to FluxyOS are recorded here, newest first.

---

## [Unreleased]
> Changes in progress — not yet pushed to main

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
