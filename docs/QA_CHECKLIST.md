# FluxyOS QA Checklist — Applied After Every Change

## Context

FluxyOS is a multi-page financial operations platform (static HTML + vanilla JS + Firebase Firestore). Every time a change or new feature is requested, this checklist is run to verify the affected area works correctly and that no other parts of the app have broken. The goal is a fast, consistent QA pass that can be done in the browser after each implementation.

For architecture contracts, page types, module ownership, and extension rules,
read `SYSTEM_DESIGN.md` and `SECURITY_SYSTEM.md` before planning a new dashboard
page, landing page, or Firestore-backed feature.

---

## Workflow — Every Request Follows This Order

```
User Request
    ↓
1. PLAN    — Understand what files are touched, what type of change it is
    ↓
2. BUILD   — Implement the change
    ↓
3. QA      — Run Smoke Tests + relevant Change Type section(s) below
             (+ Cross-Page Regression if shared files were touched)
    ↓
4. FIX     — If any QA check fails, fix before proceeding
    ↓
5. PUSH    — Only after all checks pass: commit + merge to main + push
```

**Rules:**
- Steps 3–5 are never skipped, even for small visual tweaks
- A change is not "done" until QA passes — pushing broken code is not allowed
- If a QA check cannot be verified automatically (e.g. requires Firebase login), it is flagged explicitly to the user

---

## How to Use This Checklist

After implementing any change, identify the **Change Type** below and run:
1. The **Smoke Tests** (always — takes ~2 min)
2. The section(s) matching your change type
3. The **Cross-Page Regression** if you touched shared files

For authenticated manual QA, use the local Firebase QA account described in
`docs/QA_TEST_ACCOUNT.md`. The actual email/password must live only in the
git-ignored `.qa/firebase-test-account.md` file (and the generated
`tests/.auth/storageState.json` session), never in committed docs.

---

## 1. Smoke Tests — Run After Every Single Change

These 8 checks catch the most common regressions. Run them first, every time.

| # | Check | How to Verify |
|---|-------|---------------|
| 1 | **Homepage loads** | Open `fluxyos.html` — nav, hero, and footer all visible, no console errors |
| 2 | **Login page loads** | Open `login.html` — left panel + form visible, universe canvas animating |
| 3 | **Dashboard loads** | Sign in → `dashboard.html` — KPI cards show, ledger table renders or shows empty state |
| 4 | **Sidebar navigation** | Click each working link (Overview, Transactions, Bills, Subscriptions, Integrations, Settings) — correct page loads, active item highlighted; disabled `Soon` entries do not navigate |
| 5 | **Footer appears** | Scroll to bottom of `fluxyos.html`, `pricing.html`, `budgetlanding.html` — footer renders with starfield animation |
| 6 | **Footer NOT on dashboard pages** | `dashboard.html`, `ledger.html`, `bill.html`, `subscription.html`, `integration.html`, and all `settings*.html` pages — footer must NOT appear |
| 7 | **No broken console errors** | Open DevTools Console on every page you changed — zero red errors |
| 8 | **Mobile nav works** | Resize browser to 375px on `fluxyos.html` — hamburger icon visible, click opens menu, Escape closes it |
| 9 | **New nav entry points work** | For any new page/use case, verify the production entry point from BOTH desktop mega-menu and mobile menu. The visible label must be inside an `<a>` whose `href` is the real route, never `#`; click it and confirm the target page loads. |

---

## 2. Change Type Checklists

### A. Landing Page / UI Changes (fluxyos.html, budgetlanding.html, pricing.html)

| # | Check |
|---|-------|
| 1 | Hero section text, buttons, and layout unchanged unless specifically modified |
| 2 | Sticky nav stays on top when scrolling |
| 3 | Mega-menu (Platform dropdown) opens on hover |
| 4 | Feature tabs switch content correctly with animation |
| 5 | Scroll-reveal animations trigger on viewport entry |
| 6 | Animated number counters count up on scroll |
| 7 | CTA buttons link to correct pages (`/pricing`, `/login`) |
| 8 | Bottom CTA section flows into footer without visual gap or hard line |
| 9 | Page is readable at 375px, 768px, 1280px widths |
| 10 | Use-case pages use light hero/product visuals, no dark hero cards, consistent `text-[44px] md:text-[56px]` H1 scale, and no mobile horizontal overflow |
| 11 | Use-case menu entry is clickable from desktop and mobile nav. Search all copied landing-page nav blocks for the new label and confirm every non-active entry uses the real localized route, not `href="#"`. |
| 12 | If the request is only for navbar link/content consistency, preserve the existing navbar layout, spacing, styling, DOM structure, and interaction behavior unless the user explicitly asks for visual or layout changes. |
| 13 | Marketing nav consistency: all public landing/use-case navbars expose consistent working routes; desktop and mobile menus must not include broken `href="#"` links; every navbar URL returns a valid page. |
| 14 | Universal navbar parity: every new or edited public landing/use-case page must copy the full `<nav>...</nav>` structure from `fluxyos.html` unless the task explicitly asks to change navigation. Do not hand-write a simplified navbar. Compare desktop menu columns, mobile menu entries, CTA styling, language dropdown, and DOM hooks (`mobile-menu-toggle`, `mobile-menu`) against `fluxyos.html` before marking QA passed. |
| 15 | **Anti-AI-Slop Gate (Hierarchy):** In a 3-second blur/squint test, primary message, primary action, and primary content priority are obvious. |
| 16 | **Anti-AI-Slop Gate (Actions):** Exactly one visually dominant primary action per viewport zone unless user explicitly requested equal priority actions. |
| 17 | **Anti-AI-Slop Gate (Color Semantics):** Primary, secondary, success, warning, error, and disabled states are visually distinct and used consistently. |
| 18 | **Anti-AI-Slop Gate (Contrast):** Core text, controls, and state labels remain legible in default, hover, focus, and disabled states on desktop and mobile. |
| 19 | **Anti-AI-Slop Gate (Banned Patterns):** No banned patterns from `design_system.md` are present (generic purple-neon default, excessive glass/glow, decorative-first hero, color-only meaning, cloned equal-weight card grids). |
| 20 | **Anti-AI-Slop Gate (Responsive Hierarchy):** Hierarchy and action priority are preserved at both `375px` and `1280px`; key action/data is not displaced by decoration. |

### B. Footer Changes (includes/footer.html, assets/css/footer.css, assets/js/footer-loader.js)

| # | Check |
|---|-------|
| 1 | Footer loads on landing pages: `fluxyos.html`, `budgetlanding.html`, `pricing.html`, `index.html` |
| 2 | Footer does NOT load on app pages: `dashboard.html`, `ledger.html`, `bill.html`, `subscription.html`, `integration.html`, and every `settings*.html` (`settings`, `settings-personal`, `settings-business`, `settings-finance`, `settings-import-rules`, `settings-ai`, `settings-whatsapp`, `settings-security`) |
| 3 | Universe canvas animation plays (starfield moving outward from center) |
| 4 | No teal/green colors — only dark navy (#0B0F19) and purple tones |
| 5 | Logo (orange F icon) visible and links to homepage |
| 6 | All footer link columns render: Platform, Resources, Company |
| 7 | "Careers" link is absent from Company column |
| 8 | Copyright line and Privacy / Terms links in footer bottom row |
| 9 | Footer doesn't cause horizontal scroll on mobile |

### C. Login Page Changes (login.html, assets/css/login.css)

| # | Check |
|---|-------|
| 1 | Left panel (hidden on mobile, visible on lg+) shows dark navy background |
| 2 | Universe starfield canvas plays on left panel — no teal/green tones |
| 3 | Network topology graphic (SVG with 5 nodes) is visible and animated |
| 4 | "All systems operational" green dot visible top-left |
| 5 | "Trusted by 1,200+" section shows 3 dark avatar icons |
| 6 | Right panel: FluxyOS logo, Sign In heading, Google button, email/password fields, Sign In button |
| 7 | Form submits to Firebase Auth — test with valid and invalid credentials |
| 8 | On successful login → redirects to `/dashboard` |
| 9 | On failed login → error message shown near form |
| 10 | Google SSO domains are authorized in Firebase Console: every production/login host used for QA (e.g. `fluxyos.com`, `www.fluxyos.com`, and any preview domain tested) is listed under Authentication → Settings → Authorized domains |
| 11 | Rapid-click guard: repeatedly click Sign In / Continue with Google during auth — only one auth request starts, controls disable, and failed auth re-enables controls |

### D. Dashboard / App Page Changes (dashboard.html, ledger.html, bill.html, subscription.html, integration.html, settings*.html)

| # | Check |
|---|-------|
| 1 | Auth guard active — opening page without login redirects to `/login` within 2s |
| 2 | Sidebar renders with correct active item highlighted (orange accent) |
| 3 | Sidebar groups render in order: Command, Money Movement, Operations, Reporting, Workspace |
| 4 | Future sidebar entries render as disabled `Soon` buttons with `disabled` and `aria-disabled="true"` |
| 5 | Disabled `Soon` entries do not navigate and do not point to public marketing pages |
| 6 | User display name and avatar appear in sidebar bottom section |
| 7 | Sign Out button logs out and redirects to `/login` |
| 8 | Fluxy AI sidebar/header button opens/closes the chat drawer |
| 9 | Dashboard KPI cards load: Revenue, OpEx, Margin (with progress bar), Needs Action |
| 9a | Overview selector defaults to `This Month`; `Last Month`, `YTD`, `All Time`, and `Custom` rescope the full Overview view without a page reload. Revenue shows all-time revenue as secondary context except in All Time mode, where it shows this-month revenue. Scope text and revenue record count stay visible; no `NaN`, `Infinity`, `undefined`, or blank KPI values |
| 9b | Overview Bank Cash Balance card keeps the order: current balance, update source/timestamp, 30-day outlook and coverage, then a bottom sparkline rendered from user-scoped `bank_balance_snapshots`. The sparkline uses the same green area-line treatment as Revenue; one real snapshot renders as a flat baseline, not a lone dot or invented movement. Add two different balance updates on the same day and confirm both real snapshot points remain visible in the trend |
| 10 | Ledger table renders rows OR shows empty state (never blank/broken) |
| 11 | Bills table renders rows OR shows empty state |
| 12 | Subscriptions table renders rows OR shows empty state |
| 13 | Ledger CSV export downloads a `.csv` file with Date, Description, Category, Type, Amount, and Status columns; empty ledgers keep the export button disabled |
| 14 | Ledger date filter uses shared `assets/js/date-range-picker.js`, appears beside Download CSV, defaults to the current month, opens on click, has responsive trigger width, supports single-day and range selection without Day/Month tabs, includes Reset/Cancel/Apply actions, disables future date clicks, and updates ledger cards, activity charts, table rows, pagination, and CSV export scope. Use the outer previous arrow and then next arrow: a monthly filter must return to the current month as a full-month scope and label, not collapse to today's single-day range |
| 15 | Ledger Status and Type filters appear as compact selects in the page controls row (next to the date picker), default to "All", narrow the table when changed, intersect with date range + search + vendor filter, reset pagination to page 1 on change, scope the CSV export, render removable chips above the table when active, and wrap cleanly at 375px without horizontal overflow. Status Breakdown and Type Breakdown panels are no longer rendered on the page |
| 16 | Ledger search filters the selected date-period rows by vendor/description, category, type, status, amount, or visible date; no-match searches show an inline empty row instead of breaking pagination |
| 17 | **Chart hover regression** — on every page with a bar chart (`ledger.html`, `revenue-sync.html`, any future chart), hover the **tallest visible bar** and confirm the tooltip never overlaps the chart's axis labels, date footer, or count captions below the bars. Per [DESIGN_SYSTEM.md §4 Charts](../docs/DESIGN_SYSTEM.md), the shared `attachChartHover` helper clamps to the chart container top — do not reintroduce flip-below behavior at any call site. |
| 17a | **Overview chart range regression** — set the period to **All Time**, then **Last Month**, on Performance Trend **and** Cash Flow. Confirm: (a) the **page never scrolls horizontally** — the sidebar must not overlap content (`document.documentElement.scrollWidth === clientWidth`); wide tracks scroll *inside* the card with a pinned Y-axis; (b) the timeline starts at the first period with data (no empty quarters padded out to today); (c) in **Line** mode on short ranges the line is not horizontally stretched and point markers stay round. See [DESIGN_SYSTEM.md §4a](../docs/DESIGN_SYSTEM.md). |
| 18 | `/settings` (index) renders search + three group sections (Personal, Workspace, Product) with all entry tiles; the active "Billing & plan" tile (Product settings) routes to `/settings-billing`; remaining disabled tiles ("Communication preferences", "Data export") show a `Planned` pill and do not navigate |
| 19 | Index search filters tiles by title + description (e.g., typing "ai" leaves only the AI tile visible; typing "zzz" shows the "No settings found." empty state) |
| 20 | Each live detail page (`settings-personal`, `settings-business`, `settings-finance`, `settings-import-rules`, `settings-ai`, `settings-whatsapp`, `settings-security`) loads with breadcrumb `Settings`, focused max-w-3xl content, and sidebar Settings active state |
| 21 | `settings-business` tabs work: Account details (active) and Business details switch panels; Branding and Documents are visibly disabled and unclickable |
| 22 | Save flow on every editable detail page: change a field → Save → status pill flips to "Saved", success toast appears, reload page → value persists |
| 23 | Settings saves only under `users/{uid}/settings/company`, `finance`, `import_rules`, `ai`, or `whatsapp`; no global settings collections are created |
| 24 | Loading, default/empty, saved, and friendly error states are visible on every detail page; locked AI confirmation and inactive WhatsApp states cannot imply autonomous writes or a fake connection |
| 25 | `settings-personal` and `settings-security` show no save buttons and no fake auth flows (no real passkey/2FA/close-account); all unimplemented controls render as `Planned` |

### D2. Onboarding & Dashboard Gate (onboarding.html, onboarding-gate.js, onboarding.js)

| # | Check |
|---|-------|
| 1 | **Legacy user regression** — log in as a user created before `2026-05-20T00:00:00.000Z`. Landing is `/dashboard`, no redirect to `/onboarding`, no gate card or locked overlay anywhere. Add Transaction, Add Bill, Add Subscription, CSV import, Export, ledger render, bills render, subscriptions render — all still work |
| 2 | Firestore shows `users/{uid}/onboarding/progress.onboarding_exempt: true` for the legacy account; `profile` and `documents` docs are not created |
| 3 | **New user redirect** — create a fresh Google account (or sign in with one created on/after the cutoff). Login lands on `/onboarding` and not `/dashboard` |
| 4 | Onboarding page renders the left progress rail (4 steps, current step highlighted, future steps show "Next / Unlocks after this step") and the right step content |
| 5 | Step 1 requires `business_name`, `role`, `main_goal`, `monthly_revenue_range`, `employee_count_range`. Role dropdown includes `Staff`; all required selects start on disabled placeholders with no preselected real value. Continue without filling shows red invalid borders/errors and does not advance |
| 6 | Step 2 requires `legal_full_name` and normalized `phone_number`. Full legal name accepts letters/spaces only and fails under 4 trimmed characters with `Use letters only, minimum 4 characters.` The phone label is `Preferred WhatsApp number`, helper copy mentions WhatsApp reminders/confirmations, the custom country-code dropdown defaults to Indonesia `+62`, and the prefix cannot be edited inside the local phone input |
| 7 | Step 2 phone normalization strips spaces, dashes, non-digits, and leading local zero before saving. Example: country `+62` plus local `081234567890` saves `phone_country_code: "+62"` and `phone_number: "+6281234567890"` in `users/{uid}/onboarding/profile` |
| 8 | The two document upload fields are optional, render a stub `Choose file` label, and accept files without uploading (file inputs don't actually POST anywhere) |
| 9 | Step 3 is multiple checkbox cards with no default selection. Options are Upload CSV, Add transactions manually, Track upcoming bills, Understand my dashboard, Review revenue performance, Track subscriptions, and Ask Fluxy AI questions. Continue requires at least one selected card |
| 10 | Step 4 shows a read-only review with business details, account owner details, Preferred WhatsApp number, selected onboarding preferences as chips/list items, and document upload statuses. It does not describe a first-action route |
| 11 | Submit saves `users/{uid}/onboarding/profile`, `users/{uid}/onboarding/documents` (status `not_uploaded`), flips `progress.onboarding_completed: true`, writes an `audit_logs` entry with `action: "onboarding.submit"`, stores `selected_first_action`, `selected_first_actions`, `selected_learning_tours`, and `primary_learning_tour` under `users/{uid}/onboarding/progress`, queues `overview` as the first platform learning coachmark in sessionStorage, and routes to `/dashboard` without opening Add Transaction, CSV upload, Add Bill, subscriptions, or sample data |
| 12 | Completed user re-logging-in lands on `/dashboard` directly with no gate |
| 13 | **Skip flow** — reset progress doc, log in as new user, click "Save and finish later" on Step 1. `progress.skipped: true`, `current_step` is set, audit log `onboarding.skip` is written, user lands on `/dashboard` |
| 14 | Gate card with "Secure setup required" pill renders at the top of `/dashboard`, `/ledger`, `/bill`, `/subscription`, `/revenue-sync`, `/integration`, `/ai`. Contextual title/body changes per page |
| 15 | On each gated page, header action buttons (Add record, Export, Filter, AI submit, Connect) are dimmed and pointer-disabled; main data areas are blurred behind a "This area is locked until setup is complete" overlay |
| 16 | Both `Continue setup` CTAs on the gate route to `/onboarding` and resume the user at their saved `current_step` |
| 17 | "Use sample data" CTA is **not** visible in v1 |
| 18 | Console clean across the flow: no `permission-denied`, no CSP/CORS/404, no Firebase error strings shown in alerts |
| 19 | No global onboarding/businesses/KYC collections appear in Firestore; all writes stay under `users/{uid}/onboarding/...` |
| 20 | Responsive — onboarding form fields are single-column at 375px; gate card readable and CTA tappable; no horizontal scroll |

### D3. Post-KYC Platform Learning (platform-learning.js, dashboard app pages)

| # | Check |
|---|-------|
| 1 | New user with incomplete onboarding sees the dashboard gate only; Quick ways to get started does not render |
| 2 | Pending `sessionStorage.fluxy_pending_tour` and `sessionStorage.fluxy_pending_tours` are cleared when the onboarding gate renders |
| 3 | Legacy/exempt users are not forced into platform learning or coachmark tours |
| 4 | New user with `onboarding_completed: true` sees Quick ways to get started near the top of Overview |
| 5 | Dismiss hides the section, writes `users/{uid}/platform_learning/state.dismissed: true`, and stays hidden after refresh |
| 6 | Each card stores the pending tour, navigates to the correct page, and starts after auth, gate check, and page render. After KYC completion, the first pending coachmark is always `overview`; onboarding-selected preference tours may queue after it without opening Add Transaction, CSV, Add Bill, subscriptions, or sample data directly |
| 7 | Coachmarks show overlay, target highlight, step count, Back, Next, Skip, and Done |
| 8 | Next and Back animate without moving the coachmark to a disconnected corner of the viewport |
| 9 | Completed tours show a completed mark on their card, but the card can still restart the guide |
| 10 | When every rendered tour is completed, the dashboard action changes from Dismiss to Completed |
| 11 | Skip and Done write only to `users/{uid}/platform_learning/state`; no financial collections are changed |
| 12 | Missing or hidden tour targets are skipped gracefully; if no targets exist, show "This guide is not available on this page yet." |
| 13 | Mobile at 375px: quick-start cards and coachmark popovers are readable with no horizontal overflow |

### D4. Billing & plan settings (settings-billing.html, db-service.js billing methods, billing-config.js, firestore.rules billing_invoices)

Phase 1 is a **read-only** billing view + **safe** subscription actions. The page
reads the same canonical `users/{uid}/billing_subscription/current` the trial/paywall
system uses (never a divergent source) and normalizes it. The frontend never
mutates subscription status; cancel/reactivate call a backend that is not part of
this build and fail safely. Spec: the Billing & plan Phase 1 task brief.

| # | Check |
|---|-------|
| 1 | Open `/settings-billing` signed out → redirects to `/login` within 2s |
| 2 | After login, shared sidebar renders and **Settings** is the active item (not Bills, even though the slug contains "bill") |
| 3 | Marketing footer does NOT appear |
| 4 | Loading skeleton shows first, then the live content or a friendly error state (with Try again) — never a flash of fake numbers |
| 5 | No billing doc / ineligible user → "No active plan" state with a Choose plan CTA; eligible new user → trialing state (trial created by the shared trial guard) |
| 6 | Trialing doc → blue Trial badge, "Trial ends" summary with days-left, trial-end copy, Choose plan CTA |
| 7 | Active doc renders the real plan name + monthly price; seats/storage limits match the plan tier (basic/core → 5 & 5GB, growth → 10 & 10GB, enterprise → 50 & 50GB) |
| 8 | Active doc shows Upgrade plan (primary) + Cancel renewal (tertiary, red ghost) |
| 9 | cancel_scheduled doc → amber "Renewal canceled", Access-until date, **Reactivate subscription** CTA (Reactivate appears ONLY for cancel_scheduled) |
| 10 | past_due / payment_failed doc → red badge, "Fix payment" CTA |
| 11 | Usage values never render `NaN`, `Infinity`, `undefined`, or invented numbers; storage/seats show real progress bars, metered rows show counts or "being prepared" |
| 12 | Billing history reads `users/{uid}/billing_invoices`, renders rows with `Rp` dot-separated amounts, or the "No billing history yet" empty state |
| 13 | Invoice Action shows View/Download only when `provider_invoice_url` is an https URL (opens in a new tab) |
| 14 | Cancel renewal opens the **shared FluxyOS confirm dialog** (Keep subscription / Cancel renewal, danger tone) — never `window.confirm()` |
| 15 | Confirming cancel with no billing backend → safe error toast, NO status change, NO account lock; reload still shows the same (active) state |
| 16 | Choose plan → `/pricing`; Upgrade/Fix payment → existing `/checkout` (real flow); View payment → `/payment-pending`. No CTA fakes payment success |
| 17 | Firestore: no global billing collections; all reads stay under `users/{uid}/…`; the page never writes subscription status |
| 18 | Trial plan limits show 1 seat, 5 MB storage, and 3 Fluxy AI chats; active paid plans keep their configured seat/storage limits |
| 19 | Trial AI quota: three `/api/v1/brain/chat` submissions succeed, the fourth returns `trial_ai_limit_reached`, and both the Fluxy AI page and sidebar drawer show the subscription activation popup |
| 20 | Trial storage quota: document/bank statement uploads are blocked once the incoming file would exceed 5 MB aggregate usage, but `/payment-pending` payment proof upload still works so the user can activate |
| 21 | Mobile 375px: summary cards stack, main row stacks, billing table scrolls inside its container — no page-level horizontal overflow (`document.documentElement.scrollWidth === clientWidth`) |
| 22 | Browser console clean (no CSP/CORS/404/Firebase/permission errors) — invoice reads degrade to the empty state if the `billing_invoices` rule is not deployed yet |

**Regression (shared files touched):** `sidebar-loader.js`, `db-service.js`, and
`billing-config.js` were modified — run §3 Cross-Page Regression and confirm
Dashboard, Ledger, Bills, Budget, Settings, and `/checkout` + `/payment-pending`
still render with correct sidebar active states.

### D5. Dashboard Table Standard Regression

Run this section whenever an authenticated app table changes, any `fluxy-table*`
class is added/edited, or `assets/css/shared-dashboard.css` table styles change.

| # | Check |
|---|-------|
| 1 | Table card uses `fluxy-table-card` or a documented equivalent standard wrapper |
| 2 | Header title/subtitle use `fluxy-table-title` / `fluxy-table-subtitle` or matching 16px/12px dashboard typography |
| 3 | Header labels are uppercase 12px labels with `0.06em` tracking and slate text |
| 4 | Primary cells use 14px text, 600 weight, and slate-950/near-black color |
| 5 | Money cells use `Fira Code`, tabular numbers, and right alignment via `fluxy-table-money` |
| 6 | Status badges use `fluxy-table-status` plus semantic shared classes (`fluxy-status-success`, `warning`, `danger`, `neutral`, `info`) |
| 7 | Hover states are subtle slate backgrounds; no orange row backgrounds, gradients, or heavy shadows |
| 8 | Clickable rows use `fluxy-table-row-clickable` or equivalent, show a visible affordance, and do not lose existing row open/detail behavior |
| 9 | Summary/total rows are not clickable unless intentionally linked to source records; financial final totals use dark navy only where appropriate |
| 10 | Empty state shows no fake rows, fake money, `NaN`, `Infinity`, or placeholder records |
| 11 | Loading state shows stable shimmer/loading copy and never leaves a blank table body |
| 12 | Pagination appears for data-heavy tables with more than 10 rows where the page uses paging, and resets to page 1 on search/filter changes |
| 13 | Mobile 375px has no page-level horizontal overflow; the table scrolls inside `fluxy-table-scroll` |
| 14 | Existing search, filter, sort, export, row-click, drawer, and pagination behavior still works |
| 15 | Browser console is clean on each changed table page: no CSP, CORS, 404, Firebase, or uncaught JS errors |

### D6. App Page Shell Layout Regression

Run this whenever an authenticated page's shell changes, any `fluxy-app-main` /
`fluxy-page-shell` / `fluxy-page-canvas` / `fluxy-section-stack` /
`fluxy-page-header*` / `fluxy-page-actions` class is added/edited, or the App
Page Shell Standard CSS in `assets/css/shared-dashboard.css` changes. See
[DESIGN_SYSTEM.md → Authenticated App Page Shell Standard](../docs/DESIGN_SYSTEM.md).

| # | Check |
|---|-------|
| 1 | Money Movement (`ledger.html`, `revenue-sync.html`, `bill.html`, `subscription.html`) and Reporting (`accounting.html`, `accounting-records.html`, `reports.html`) pages use the same app shell spacing and density |
| 2 | Financial Ledger content no longer has excessive left/top whitespace — its content width and left edge match Accounting Center (`.fluxy-page-canvas`, 1540px), not the old centered 1280px |
| 3 | Header controls align on one rhythm: title/subtitle on the left, action group on the right, on a single content edge |
| 4 | The date filter appears in the top page control row beside the secondary actions, using the shared `FluxyDateRangePicker`, on every page that supports a period filter |
| 5 | The Fluxy AI / Ask Fluxy AI button sits at the far-right of the page action group where present, and is not styled as the primary action |
| 6 | Balance Sheet's date/period placement and report-tuned shell are intentionally preserved as the documented exception |
| 7 | Mobile 375px has no page-level horizontal overflow; controls wrap cleanly and the title + primary action stay visible |
| 8 | Existing per-page behavior still works: ledger filters, CSV export, scan/import drawer, date filter, table render, pagination, empty states, and Add Transaction/Bill/Subscription drawers |

### D7. Custom Select / Dropdown Regression

Run this whenever `assets/js/fluxy-select.js`, the `.fluxy-select*` CSS, or any
page's `<select>` markup changes. See
[DESIGN_SYSTEM.md → Select / Dropdown](../docs/DESIGN_SYSTEM.md).

| # | Check |
|---|-------|
| 1 | No app page shows the raw browser `<select>` arrow or native option list — every `<select>` renders the custom Fluxy dropdown (trigger + chevron + floating menu) |
| 2 | The chevron is the shared 16px down-chevron, correctly sized/positioned, rotating 180° on open (no squashed/off-center arrow) |
| 3 | Selecting an option updates the underlying value, fires `change`, and any dependent UI (e.g. report scope, modal "Others" field) reacts exactly as before |
| 4 | Programmatic value changes (settings loaded from Firestore, modal defaults) update the trigger label |
| 5 | Dropdowns inside drawers/modals (Add Transaction/Bill/Subscription, tx detail) open with the menu correctly positioned (portaled, not clipped by the slide-in transform) |
| 6 | Menu flips above when near the viewport bottom, clamps horizontally, follows on scroll, and closes on outside-click / Escape / resize |
| 7 | Keyboard works: open, arrow/Home/End navigation, Enter/Space select, Escape close |
| 8 | Forms still submit correct values and `required` selects still validate; no "invalid form control is not focusable" console error |
| 9 | Browser console is clean on each page with selects (no JS errors from enhancement) |
| 10 | `onboarding.html` still uses its own select enhancer and is not double-enhanced |

### D8. Numeric & Currency Format (strict)

Run on any page showing amounts/KPIs, and whenever a currency helper or numeric
CSS changes. See [DESIGN_SYSTEM.md → Numeric & currency format (strict)](../docs/DESIGN_SYSTEM.md).

| # | Check |
|---|-------|
| 1 | Every amount/KPI/number renders a **plain zero** (no slash, no dot) — consistent across KPIs, table money, card amounts, drawers, charts tooltips |
| 2 | No number renders in a monospace face; amounts use Inter `tabular-nums` and digit columns still align in tables |
| 3 | Currency has **no space after `Rp`** everywhere: `Rp1.000`, `Rp0`, `(Rp1.000.000)` — KPIs, tables, cards, drawers, CSV-adjacent labels, empty/zero states |
| 4 | No regression in amount parsing (input still formats with dots; stored value is raw integer) |
| 5 | Marketing/landing prices are out of scope for this app rule unless explicitly swept; note any intentionally-skipped pages |

### E. Add Transaction / Bill / Subscription (shared-dashboard.js, db-service.js)

| # | Check |
|---|-------|
| 1 | Clicking "Add" button opens the right-side entry drawer with black translucent overlay, correct title, and submit label |
| 2 | Amount field formats live as Indonesian Rupiah (e.g., `1234567` → `1.234.567`) |
| 3 | Default category is correct: Transactions → none, Bills → "Operations", Subscriptions → "SaaS" |
| 4 | Submitting empty form shows required field validation (browser native) |
| 5 | Submit button starts disabled, enables only after required fields/file are present, then disables and shows "Deploying..." or "Reading..." while saving |
| 6 | On success: modal closes, correct toast message appears for 4s, then disappears |
| 7 | Data appears in the correct table after modal closes (no manual refresh needed) |
| 8 | On Firebase permission error: toast shows a friendly error message |
| 9 | Closing drawer via X, overlay click, or Escape removes the drawer completely and restores page scroll |
| 10 | Re-opening drawer after closing starts with a fresh, empty form |
| 11 | Add Transaction drawer separates single entry and CSV bulk upload with tabs; bulk mode uses the main submit button as `Upload CSV` with no second upload CTA |
| 12 | Single and CSV transaction entry use shared `FluxyDateRangePicker` single-date pickers with one month, no footer action row, auto-select on day click, default to today, block future dates, save selected previous dates to `timestamp`, and show an info warning above the sticky submit button when dates are not today |
| 13 | Uploading a valid transaction CSV writes every row to `users/{uid}/transactions`, refreshes dashboard/ledger views, and shows a success state/toast |
| 14 | Uploading an invalid CSV keeps the modal open, shows a row-specific validation error, and writes no partial rows |
| 15 | Ledger table starts at 10 rows per page, pagination next/previous works, and Date, Amount, Category, and Status headers toggle ascending/descending sort with up/down icons |

### E2. Receipt & Document Attachment (document-attachment.js, document.rules)

Run this section whenever `document-attachment.js`, `db-service.js` document
methods, `storage.rules`, the documents block in `firestore.rules`, the
shared transaction drawer's receipt section, or the Bill Details drawer
"Attach Invoice" wiring is touched. Spec: `docs/RECEIPT_DOCUMENT_ATTACHMENT_PLAN.md`.

| # | Check |
|---|-------|
| 1 | Add Transaction (expense) with no file → saves; no `attached_documents` field; no doc in `users/{uid}/documents` |
| 2 | Add Transaction (expense) with JPG <5 MB → upload progresses → row appears in ledger with thumbnail (legacy `receipt_url`) AND transaction doc has `attached_documents[0]` |
| 3 | Add Transaction with PDF ≤5 MB → uploads; no thumbnail in ledger (PDFs are not images) but `attached_documents` is set; `receipt_url` is NOT written |
| 4 | Add Transaction with 6 MB image → friendly "too large" error appears inline; form data preserved; no upload to Storage |
| 5 | Add Transaction with `.exe`/`.zip` → friendly "type not supported" error; form data preserved |
| 6 | Add Revenue (income or Revenue category) → attachment label reads "Proof / document (optional)" and helper mentions payment screenshot/payout |
| 7 | Add Revenue with attachment → saved doc has `attached_documents[0].role == 'revenue_proof'`; `receipt_url` set only if image |
| 8 | CSV bulk upload (5 valid rows) → imports clean, no interaction with the attachment block; refresh shows new rows |
| 9 | Close drawer mid-attachment (X / overlay / Escape) → re-open shows empty attachment UI (no leftover filename) |
| 10 | Bill Details drawer → Attach Invoice button is enabled and labeled "Attach Invoice" (or "Replace Invoice" if one is already attached) |
| 11 | Bill Details → click Attach Invoice → pick PDF → toast "Invoice attached to bill"; drawer re-renders with an "Invoice attached" panel; Firestore: bill has `attached_documents[0].role == 'invoice'`, `invoice_status == 'attached'` |
| 12 | Attaching an invoice does **NOT** change `payment_status` and does **NOT** create a transaction (verify in Firestore) |
| 13 | Convert to Transaction button stays disabled with "Coming soon" badge; Mark as Paid stays disabled with "Soon" badge |
| 14 | Document metadata at `users/{uid}/documents/{docId}` has all required fields; `storage_path` matches actual Storage path; `extraction_status == 'not_requested'`, `review_status == 'not_required'` |
| 15 | Document storage path is `users/{uid}/documents/{docId}/{fileName}` (verify in Storage console); files outside this prefix are blocked by `storage.rules` |
| 16 | Sign out → attempting to write to `users/{otherUid}/documents/{x}` is blocked by Firestore Rules (manual emulator check or rules unit test) |
| 17 | Sidebar Receipt Capture entry still appears as a disabled `Soon` button — no new sidebar route was created |
| 18 | Mobile width 375 px: attachment block does not overflow horizontally; filename truncates rather than wrapping past the row |
| 19 | Desktop width 1280 px: attachment row layout matches surrounding form fields |
| 20 | Browser console clean across the full flow (no CSP, CORS, 404, Storage, or Firestore errors) |

### F. Database & Logic Verification (db-service.js, shared-dashboard.js, dashboard.js)

Run this section whenever any data write, read, calculation, or modal logic is changed.

#### F1 — Amount Parsing (Write Integrity)
| # | Check |
|---|-------|
| 1 | Enter `1.234.567` in the amount field → submit → open Firebase Console → verify the stored value is `1234567` (integer, no dots) |
| 2 | Enter a single digit (e.g., `5`) → verify stored as `5`, not `0` or `"5"` |
| 3 | Enter an amount with leading zeros (e.g., `007`) → verify stored correctly |
| 4 | Submit with an empty amount → form must block submission (required validation), nothing written to Firestore |

#### F2 — Correct Collection Written
| # | Check |
|---|-------|
| 1 | Add a **Transaction** → Firebase Console shows new doc in `users/{uid}/transactions` only |
| 2 | Add a **Bill** → new doc in `users/{uid}/bills` only, NOT in transactions |
| 3 | Add a **Subscription** → new doc in `users/{uid}/subscriptions` only, NOT in transactions |
| 4 | Each saved doc must have: `amount`, `vendor_name`, `category`, `type`, `status`, `timestamp` fields; transaction `type` may be income, expense, transfer, refund, adjustment, fee, tax, pending receivable, or pending payable |
| 5 | Subscription saved doc must have `category: "SaaS"` — verify in Firebase Console |
| 6 | Bill saved doc must have `category: "Operations"` — verify in Firebase Console |

#### F3 — Data Display After Write
| # | Check |
|---|-------|
| 1 | After adding a transaction, the new row appears **at the top** of the ledger table (newest first) |
| 2 | After adding a bill, new row appears **at the top** of the bills table |
| 3 | After adding a subscription, new row appears **at the top** of the subscriptions table |
| 4 | Amount displayed in the table matches what was entered (formatted as `Rp X.XXX.XXX`) |
| 5 | Vendor name displayed matches what was typed |
| 6 | Category badge in the table matches the selected category |

#### F4 — getDashboardStats Calculation Logic
| # | Check |
|---|-------|
| 1 | Add a **Revenue** transaction of `Rp 1.000.000` → Dashboard Revenue KPI must increase by exactly `1.000.000` |
| 2 | Add an **Expense** transaction of `Rp 500.000` → Dashboard OpEx KPI must increase by exactly `500.000` |
| 3 | Margin % must equal `(revenue - opex) / revenue × 100` — manually verify the math matches what the KPI card shows |
| 4 | **Edge case**: If there are zero revenue transactions, the margin calculation must not crash (division by zero) — dashboard still loads |
| 5 | **Edge case**: If all transactions are expenses (opex > revenue), margin shows a negative or 0% — not a crash |
| 6 | Refresh the dashboard after adding transactions — KPI values must update to reflect the new totals |

#### F5 — Data Ordering & Limits
| # | Check |
|---|-------|
| 1 | Add two transactions back-to-back — the most recently added one appears first in the table |
| 2 | Bills and subscriptions also appear in newest-first order |
| 3 | Dashboard ledger preview shows at most 5 rows (the latest 5 transactions) |
| 4 | Ledger page (`ledger.html`) shows up to 50 transactions — adding a 51st does not break the page |

#### F6 — Firebase Auth & Data Isolation
| # | Check |
|---|-------|
| 1 | Data added by User A is **not visible** to User B (collections are scoped to `users/{uid}/`) |
| 2 | After logout and log back in as the same user — all previously added data is still there |
| 3 | Session expiry during a form submit → error toast appears, data is NOT silently lost |
| 4 | Firebase permission denied error → toast shows a friendly error message (not a raw Firebase error string) |
| 5 | Firestore rules are versioned in `firestore.rules` and Firebase config points to that file via `firebase.json` |

#### F7 — Toast & UI Feedback Accuracy
| # | Check |
|---|-------|
| 1 | Transaction success toast says: `"Transaction successfully deployed to your live ledger!"` |
| 2 | Bill success toast says: `"Bill successfully added to your schedule!"` |
| 3 | Subscription success toast says: `"Subscription successfully activated!"` |
| 4 | Toast appears within 1 second of submit completing |
| 5 | Toast auto-dismisses after ~4 seconds |
| 6 | Two rapid submissions do not stack duplicate toasts (button disabled on first submit) |

---

### G. JavaScript / Animation Changes (fluxyos.js, universe-canvas.js, ai-chat.js)

| # | Check |
|---|-------|
| 1 | Scroll-reveal elements animate only once (not every scroll pass) |
| 2 | Tab switching on landing page: correct content shows, orange style on active tab |
| 3 | Counter animations trigger when scrolled into view |
| 4 | Universe canvas uses only dark navy and purple tones — no cyan, teal, or bright green |
| 5 | Canvas pauses when scrolled off-screen (no wasted CPU) |
| 6 | AI Chat: opens, accepts a message, shows response (or error), closes cleanly |
| 7 | `prefers-reduced-motion` users: no animations play (verify by enabling in OS) |

### H. Shared Files (sidebar-loader.js, footer-loader.js, assets/css/shared-dashboard.css)

Run the **Cross-Page Regression** section below — changes to shared files affect every page.

### J. Reports & Exports + Report Preview (reports.html, reports.js, report-preview.html, report-preview.js, report-builder.js)

| # | Check |
|---|-------|
| 1 | Open `/reports` logged out → redirects to `/login` within 2s |
| 2 | After login, sidebar renders and "Reports & Exports" is the active item |
| 3 | Marketing footer does NOT appear |
| 4 | Reporting period defaults to current month; switching range refreshes coverage, cleanup, and readiness |
| 5 | With zero records, readiness shows "—" / "Not enough data"; no fake numbers |
| 6 | Data coverage counts match real Firestore records under `users/{uid}/...` |
| 7 | Needs cleanup counts match real Missing Receipt / missing due date / missing renewal date records |
| 8 | Clicking a Preview button on the individual reports table opens the drawer; Escape, overlay click, and Cancel all close it |
| 9 | Confirm export is disabled when there are no records or when the user is not verified, and shows a lock reason |
| 10 | Confirming export downloads CSV file(s) and writes an `export.create` audit log under `users/{uid}/audit_logs` |
| 11 | CSV output contains raw integer amounts (no `Rp ` prefix, no dot separators) |
| 12 | Audit log payload contains report type, period, formats, included sources, `record_counts`, `warning_counts` — and **no row-level financial data** |
| 13 | Recent exports panel refreshes after a successful export; empty state shows otherwise |
| 14 | With `revenue = 0`, the preview Gross margin shows `0%` or "Not available" — never `NaN` / `Infinity` |
| 15 | Mobile width 375px → no horizontal scroll, drawer renders full width |
| 16 | Drawer footer shows three buttons: Cancel / Open Full Report / Confirm export & log action |
| 17 | Open Full Report navigates to `/report-preview` and renders all 9 sections from real `monthlyReportPack` data |
| 18 | `/report-preview` redirects to `/login` when signed out |
| 19 | With no sessionStorage payload, `/report-preview` shows "No report preview found" + Back to Reports |
| 20 | Period Comparison shows "Unavailable" when previous period has no records — never invents numbers |
| 21 | Finance Predictability shows ARR as "Unavailable" because recurring revenue is unclassified |
| 22 | Cash pressure copy never uses the word "runway" or implies bank coverage |
| 23 | Print / Save PDF opens browser print dialog; toolbar is hidden in print preview; report colors preserved |
| 24 | App never claims "PDF downloaded successfully" — only the user knows if they saved |
| 25 | Download CSV Bundle on viewer downloads the 6 expected CSVs with raw integer amounts |
| 26 | Confirm Export on viewer writes a row to `users/{uid}/report_exports` AND an `export.create` audit log with `target_collection: "report_exports"` |
| 27 | Audit log + report_exports rows never contain row-level finance data or CSV content |
| 28 | Recent Exports panel on `/reports` reads from `report_exports` and refreshes after a confirmed export |
| 29 | Filter strip exposes "Report period" + "Compare with" selects; the scope summary line under the strip updates after Apply |
| 30 | YTD mode resolves start to Jan 1 of the current year and end to today (or selected end date); Custom range picker greys out for non-custom modes |
| 31 | YTD + Previous year to date produces a "YYYY YTD Year-on-Year Financial Report" with both periods shown in the drawer and on the viewer cover |
| 32 | YoY change% never renders `NaN`, `Infinity`, or `-Infinity` — previous-zero metrics show `N/A` |
| 33 | Gross margin change in YoY uses `pts` (e.g. `+2.8 pts`), not `%` |
| 34 | Leap-year edge: when current end date is Feb 29 and previous year has no Feb 29, comparison clamps to Feb 28 |
| 35 | Monthly Trend Breakdown renders for YTD; Monthly Trend Comparison renders for YTD YoY when previous-year data exists |
| 36 | CSV filenames adapt: `ytd_profit_loss_2026.csv` for YTD; `yoy_profit_loss_2026_vs_2025_ytd.csv` for YTD YoY |
| 37 | `report_exports` row stores `report_scope` for YTD/YoY runs; audit log `after` mirrors mode + comparison mode + both periods |
| 38 | Settings → Finance preferences shows "Recurring revenue categories" form; saving writes to `users/{uid}/settings/reports` |
| 39 | When no recurring categories tagged: Estimated ARR card on report-preview shows "No recurring revenue category selected." and Export Manifest lists the limitation |
| 40 | When categories tagged + matching income exists: ARR shows the rupiah value with the "(partial)" suffix and the caveat: "ARR excludes untagged revenue and may exclude valid recurring revenue if categories are not configured." |
| 41 | ARR formula: recurring monthly revenue × 12; for YTD periods the monthly baseline is `total recurring income ÷ elapsed months` |

### J2. Balance Sheet (balance-sheet.html, balance-sheet.js, db-service.js, sidebar-loader.js)

| # | Check |
|---|-------|
| 1 | Open `/balance-sheet` logged out → redirects to `/login` within 2s |
| 2 | After login, sidebar renders, "Balance Sheet" appears under Reporting, and it is the active item |
| 3 | Marketing footer does NOT appear |
| 4 | Page title, subtitle, breadcrumb, controls, CSV action, and Print / Save PDF action render in a compact report-first layout |
| 5 | As-of picker uses the shared `FluxyDateRangePicker`; cadence and comparison controls refresh the report |
| 6 | Empty account with no cash, receivables, unpaid bills, or pending payables shows an honest empty state and no fake numbers |
| 7 | No active bank account shows Cash & Bank as `Rp 0` plus the quiet "No active cash or bank balance has been set." warning |
| 8 | Cash & Bank includes active `bank_accounts`; comparison uses the latest `bank_balance_snapshots` row on or before the comparison date when available |
| 9 | Accounts Receivable includes only `pending_receivable` transactions on or before the as-of date |
| 10 | Accounts Payable includes unpaid bills (`payment_status != paid` or missing) using date priority `due_date`, `date`, `timestamp`, `created_at` |
| 11 | Pending Payables includes only `pending_payable` transactions on or before the as-of date |
| 12 | Net Position equals Total Assets minus Total Liabilities; UI labels it **Net Position**, not Equity |
| 13 | Comparison and change columns never render `NaN`, `Infinity`, `-Infinity`, `undefined`, or `null`; unavailable comparison shows `—` |
| 14 | Negative values display with parentheses; zero displays `Rp 0`; all money cells are right-aligned mono |
| 15 | Expand/collapse works for sections and Cash & Bank children; Expand all / Collapse all updates the table without layout shift |
| 16 | Clicking Cash & Bank, Accounts Receivable, Accounts Payable, or Pending Payables opens a right-side read-only drawer with only related records |
| 17 | Drawer closes via X, overlay click, and Escape; page scroll locks while open |
| 18 | CSV export is disabled when no source data exists and explains why |
| 19 | Confirmed CSV export writes `users/{uid}/report_exports` with `report_type = "balance_sheet"` and an `export.create` audit log targeting `report_exports` |
| 20 | CSV output contains raw integer amounts only (no `Rp ` prefix, no dot separators) |
| 21 | Audit log and `report_exports` metadata never contain row-level CSV content or related-record details |
| 22 | Print / Save PDF opens browser print; the app never claims a PDF was downloaded successfully |
| 23 | Mobile width 375px → no page-level horizontal overflow; the report table scrolls inside its container and the drawer is full width |
| 24 | Browser console clean (no CSP/CORS/404/Firebase/permission errors) |

### K. Budget Page (budget.html, budget.js, db-service.js budget methods, firestore.rules budget_allocations + bills)

Run this section whenever `budget.html`, `assets/js/budget.js`, the
budget-related methods in `assets/js/db-service.js`
(`addBudgetWithAllocations`, `getBudgetAllocations`, `getBudgetUsage`,
`matchBillToAllocation`), the firestore rules for `budget_allocations` or
the bill-budget fields, or the Add Bill drawer's budget impact preview are
touched.

#### K1 — Page shell & auth guard
| # | Check |
|---|-------|
| 1 | Hitting `/budget` while signed out redirects to `/login` |
| 2 | After sign-in, `/budget` renders without footer, with the shared sidebar, and with `Budgets` highlighted in the Operations group |
| 3 | Sidebar `Budgets` entry is a real link (not a disabled `Soon` button) and active state uses orange `#EA580C` |
| 4 | `/settings-budget.html` still highlights `Settings` (not Budgets) in the sidebar |
| 5 | No console errors on first load (CSP, CORS, 404, Firestore) |

#### K2 — Empty state & first budget
| # | Check |
|---|-------|
| 1 | Account with no `budgets/{*}` doc shows the empty state with title "Create your first operating budget" and a primary "Create Budget" button |
| 2 | Click "Create Budget" → right-side drawer opens with Budget type, Period type, amount, notes, and allocation controls |
| 3 | Drawer Submit is disabled until: name present, total > 0, period valid, and any entered allocations have a name + amount > 0 with sum(allocations) ≤ total |
| 4 | Entering Allocations > Total shows the "Allocations exceed the main budget by Rp X" warning and keeps Submit disabled |
| 5 | Submitting a valid budget: drawer closes, page reloads, summary card shows the new totals; allocations table lists each row with `Healthy` status |
| 6 | Firestore: a single doc in `users/{uid}/budgets/{id}` with `total_budget`, `period_type`, `currency='IDR'`, `category_budgets` (denormalized map), optional `notes`; raw numbers, no formatted strings |
| 7 | Firestore: N docs in `users/{uid}/budget_allocations/{id}` with `parent_budget_id = budgetId`, `scope_type='category'`, `scope_values=[<category>]`, `status='active'` |
| 8 | Audit log written: `budget.created` (or `budget.updated`) + `budget.allocations_updated` with `target_collection='budget_allocations'` |

#### K2b — Period-based budgets
| # | Check |
|---|-------|
| 1 | Annual envelope card shows real annual data when an annual budget exists; otherwise it shows "No annual budget set yet. You can still manage monthly or quarterly budgets." |
| 2 | Period selector lists real monthly, quarterly, and custom budget records only |
| 3 | Selecting a month/quarter with no budget shows "No budget set for [period label]" with Create Budget and Duplicate Previous Budget actions |
| 4 | Creating June and July budgets creates separate `budgets/{id}` docs and separate `budget_allocations/{id}` rows |
| 5 | Editing July does not archive or modify June allocations |
| 6 | Duplicating a previous period creates a new budget with `created_from_budget_id` and new allocations with `created_from_allocation_id`; transactions, bills, actual usage, committed usage, and activity are not copied |
| 7 | Legacy budgets without `budget_type` or `period_label` still render with fallback labels |

#### K3 — Usage calculation
| # | Check |
|---|-------|
| 1 | Add a transaction in-period with category `Marketing`, type `expense`, amount Rp 5.000.000 → Marketing row shows Actual Used `Rp 5.000.000` |
| 2 | Add a `pending_payable` transaction in-period for `Infrastructure` Rp 3.000.000 → Infrastructure row shows Committed `Rp 3.000.000` (not Actual) |
| 3 | Add an unpaid bill in-period for `Operations` Rp 12.000.000 → Operations Committed includes the bill |
| 4 | Mark a bill `payment_status = 'paid'` (Firebase console) → Committed for that allocation drops; bill no longer counted |
| 5 | Add a transaction with a category not in any allocation (e.g. `Travel`) → Unallocated spend card appears with the right amount |
| 6 | An allocation that hits 92% usage shows `At Risk` badge; one over 100% shows `Exceeded` with a risk-panel line "exceeded by Rp X" |
| 7 | `usage_percent` never displays as `NaN`, `Infinity`, or `-Infinity` (e.g. for an allocation with allocated_amount = 0) |

#### K4 — Edit & resave
| # | Check |
|---|-------|
| 1 | With a budget already active, primary CTA reads "Edit Budget" and the drawer prefills name, period, total, notes, and the existing allocations |
| 2 | Saving a changed budget archives existing allocations (status flips to `archived` in Firestore) and writes the new set with `status='active'` |
| 3 | Dashboard's `OpEx vs Budget` KPI continues to read the same `total_budget` after the new flow saves; settings-budget.html's history table still shows the same active row |

#### K5 — Add Bill drawer budget impact (Phase 1.5)
| # | Check |
|---|-------|
| 1 | Open Add Bill drawer with a period budget containing the bill due date: preview loads, reads "Auto matched to <allocation>. This bill will reserve Rp 0 from <allocation>." (Rp 0 until an amount is entered) |
| 2 | Type an amount within remaining → preview switches to green/Auto matched copy with the right amount |
| 3 | Type an amount that exceeds remaining → preview switches to red/Budget warning copy with the over-by amount |
| 4 | Switch category to one not in any allocation → preview becomes gray "No matching budget allocation found. This bill will be saved as unallocated." |
| 5 | Change due date to another period → preview uses that period's budget if one exists, otherwise shows the no-active-budget copy for that bill period |
| 6 | Account with no active budget: preview shows "No active budget for this bill period. This bill will be saved without budget impact." |
| 7 | Saving a matched bill writes the 5 budget fields (`budget_id`, `budget_allocation_id`, `budget_match_method`, `budget_match_status`, `budget_impact_status`) into `users/{uid}/bills/{id}`; verify in Firestore |
| 8 | Saving with no active budget: bill doc has none of the 5 budget fields present |
| 9 | Add Transaction drawer (from Ledger page) does NOT show the budget preview block; `users/{uid}/transactions/{id}` is unaffected |
| 10 | Add Subscription drawer does NOT show the budget preview block |

#### K6 — Data isolation
| # | Check |
|---|-------|
| 1 | All budget writes are under `users/{uid}/budgets` and `users/{uid}/budget_allocations` — no global collection appears |
| 2 | Sign out → attempted write to `users/{otherUid}/budgets/...` is blocked by Firestore rules |
| 3 | Bills schema accepts the 5 new optional fields without breaking the existing `hasOnly` allowlist (no permission-denied error when omitting them) |
| 4 | Mobile 375px: summary cards stack into a single column; allocation table scrolls horizontally; drawer covers viewport |
| 5 | Desktop 1280px: layout matches `bill.html` rhythm |

#### L — Budget Phase 2 — Record-level control

Run when `assets/js/db-service.js` budget methods, the `budget_allocations`
Firestore rules, the transaction or bill budget fields, `budget.html` /
`budget.js` Phase 2 sections, or the ledger/bills row chips are touched.

| # | Check |
|---|-------|
| 1 | Allocation detail drawer opens when an allocation row on `/budget` is clicked. Header shows name + status badge + stat strip + variance explanation. Related Transactions and Related Bills sections list rows from the current period. |
| 2 | Unallocated records section renders only when records exist. Each row shows date / type / vendor / category / amount / suggested allocation / Assign + Exclude actions. |
| 3 | Excluded records section is collapsed by default; toggling expands it. Each row shows the exclusion reason and a Restore action. |
| 4 | Budget activity section renders only when audit logs exist for this budget. Each row shows timestamp, action label, target collection, and the user-entered reason. |
| 5 | Assign action on a transaction: opens the shared `FluxyBudgetAssignment` drawer with title "Change allocation"; allocation dropdown is populated; submit disabled until reason + allocation; on submit, transaction's `budget_allocation_id` updates AND an audit log with action `budget_assignment.update` is written under `users/{uid}/audit_logs`; Budget page totals refresh. |
| 6 | Exclude action on a bill: requires reason; on submit, bill gains `budget_match_status='excluded'` + `budget_impact_status='released'`; Marketing Committed amount drops by exactly the bill amount; audit action = `budget_assignment.exclude`. |
| 7 | Restore action on an excluded record: requires reason; clears excluded state; record returns to category-match; audit action = `budget_assignment.restore`. |
| 8 | Legacy transactions/bills without the budget fields still render in the allocation detail drawer (via category fallback) and still count in totals. |
| 9 | Add Transaction drawer is unchanged — no budget UI, no auto-tag on save. |
| 10 | Add Bill drawer keeps the Phase 1.5 budget impact preview. New saves continue to write the 5 Phase 1.5 fields. |
| 11 | Ledger page: every in-period spend transaction shows a small budget chip under the Category cell (`Marketing Budget` / `Auto · Marketing` / `Unallocated` / `Excluded`) plus an Assign / Restore link. Clicking the link opens the shared assignment drawer; clicking elsewhere on the row still opens the existing transaction detail drawer. |
| 12 | Bills page: same chip + action pattern. Paid bills and `converted_to_actual` bills don't show a chip. |
| 13 | Firestore writes for assignment / exclusion / restore commit the record update AND audit log atomically (verify in Firebase console: one new bill/transaction revision + one new audit log per action). |
| 14 | `budget_assignment_updated_by` on every Phase 2 write equals `request.auth.uid` (Firestore rule pins it; mismatched UIDs are rejected). |
| 15 | No console errors on `/budget`, `/ledger`, `/bill` after the new sections + chips render. |

#### K7 — Save atomicity (regression)
| # | Check |
|---|-------|
| 1 | Note the active budget's name + total. Open Create / Edit drawer, change name + total + allocations to fresh values, click Save. If the save fails (any reason — rules undeployed, validator reject, network), the error toast appears AND a hard reload of `/budget` shows the **original** name + total — not the attempted values |
| 2 | Inverse: when the save succeeds, the reload shows the new name + total. Allocations table reflects the new rows, archived rows are not visible |
| 3 | Firebase console: every successful save produces one budget doc write (create OR update) plus N allocation doc creates plus K archive updates, all timestamped within the same server tick. A failed save produces zero doc writes |
| 4 | Automated coverage: `npx playwright test tests/budget-verify.spec.js --grep "B6:"` passes — the spec asserts the budget doc is unchanged after a forced-fail save |

### I. Favicon / Meta / Head Changes

| # | Check |
|---|-------|
| 1 | Browser tab shows black F-logo favicon on all pages |
| 2 | Page title is correct per page (`<title>` tag) |
| 3 | Viewport meta tag present (`width=device-width, initial-scale=1`) |

### M. Internal Operations Console (internal.html, internal-dashboard.js, db-service.js internal methods, firestore.rules internal_*, sidebar-loader.js, onboarding.js, functions/index.js)

**Prereq:** the `internal_*` blocks in `firestore.rules` must be **deployed** —
otherwise the console correctly shows the friendly "Could not load internal data"
state and logs a handled warning (not a thrown error). Auth deletion cleanup also
requires a Blaze-plan Firebase project and a deployed
`cleanupInternalUserOnAuthDelete` function.

| # | Check |
|---|-------|
| 1 | Open `/internal` with no session → credential gate shows, console hidden |
| 2 | Sign-in button stays disabled until both username + password are filled |
| 3 | Wrong credentials → inline `Invalid internal credential.`; no console data shown |
| 4 | Correct credentials (`fluxyos admin` / set password) → console shows, gate hidden, sessionStorage `fluxy_internal_admin_session` = `active` |
| 5 | Refresh after sign-in keeps the session in the same tab; new tab/window requires re-auth |
| 6 | Sign out clears sessionStorage and returns to the gate |
| 7 | No marketing footer, no public nav, no customer sidebar; route absent from `sitemap.xml` and all nav |
| 8 | Tabs switch (Overview / Users / KYC Review / Payment Review / Audit); KYC + Payment tab counts reflect queue size |
| 9 | Users table renders rows or a clear empty state; search + account/KYC/payment filters narrow rows |
| 10 | Review drawer opens (X / overlay / Escape close); missing onboarding or payment data shows partial-data fallbacks |
| 11 | Approve KYC / Request revision / Reject KYC update status, write an `internal_audit_logs` entry, refresh, toast; revision + reject require a reviewer note |
| 12 | Verify payment / Reject payment update status + audit; reject requires a note and uses danger confirmation; verify never creates a transaction or marks a bill paid |
| 13 | Activate user is disabled unless KYC approved **and** payment verified; suspend requires a note + danger confirmation |
| 14 | Every action refreshes the visible table + drawer and shows a success/error toast; no raw Firebase error reaches the user |
| 15 | Self-upsert: signing in as a normal user creates `internal_users/{uid}`; completing onboarding sets `kyc_status='submitted'`; a reviewer's status change is not clobbered on the user's next login |
| 16 | Data safety: no transactions/bills/subscriptions fetched; no global financial collections; amounts stored as raw integers |
| 17 | Responsive at 375 / 768 / 1280 — no horizontal overflow; tables scroll within their container |
| 18 | Browser console clean once rules are deployed (no red errors) |
| 19 | Auth deletion cleanup: delete one disposable Firebase Authentication account, refresh `/internal`, and confirm its `internal_users/{uid}` row is gone while owner-scoped finance data is untouched. Do not use Admin SDK bulk deletion for this check because it does not emit per-user Auth deletion events |

**Regression (shared files touched):** `sidebar-loader.js` and `onboarding.js`
were modified for self-upsert — run §3 Cross-Page Regression and confirm
`/login`, `/dashboard`, sidebar load, entity switcher, and onboarding submit still
work and the console stays clean.

### N. Accounting Control Center (accounting.html, accounting.js, db-service.js accounting methods, firestore.rules accounting_mappings, sidebar-loader.js)

**Prereq:** the `accounting_mappings` block in `firestore.rules` must be **deployed**
before the mapping **Save** action works — otherwise the page still loads and reads
correctly, but Save shows the friendly "Could not save the mapping" toast (handled,
not a thrown error). Phase 1 is read-only except for saved mappings: no journal
posting, no period close, no `accounting_periods` collection. The **Income Statement
Preview** is the primary tab; readiness is now a supporting **report confidence**
banner/KPI, not the main card.

| # | Check |
|---|-------|
| 1 | Open `/accounting` signed out → redirects to `/login` |
| 2 | Open `/accounting` signed in → page renders with shared sidebar and **no** marketing footer |
| 3 | Sidebar "Accounting Center" is visible under Reporting and active (orange) on `/accounting` |
| 4 | Page defaults to the current month; period control is the shared `FluxyDateRangePicker` |
| 5 | Loading skeleton shows first, then the real/empty state (no flash of fake numbers) |
| 6 | Account with no finance records → "No income statement data for this period" empty state, **no** fake report rows |
| 7 | First tab is **Income Statement** (not Overview/Readiness); tab list is Income Statement / Cleanup / Account Mapping / Close |
| 8 | Income Statement table renders real data; column headers show the selected period + comparison labels (e.g. "May 2026" / "Apr 2026") |
| 9 | Revenue total matches income/revenue/refund/pending_receivable transactions; OpEx total matches expense/fee/tax/pending_payable; COGS defaults to 0 (Infrastructure stays under OpEx) |
| 10 | Gross Profit = Revenue − COGS; Operating Income = Gross Profit − OpEx; Net Income math is correct; margins show in subtotal status |
| 11 | Change column shows previous-period delta; Change % shows **N/A** when previous is 0 and never `NaN`/`Infinity`; cost increases read red/parentheses, decreases read green |
| 12 | Clicking Revenue, Cost of Revenue, Operating Expenses, Other Income, Other Expense, or a child source line navigates to `/accounting-records` with the selected `section`, `period`, and comparison params |
| 13 | Gross Profit, Operating Income, and Net Income are non-clickable: no pointer cursor, no row `tabindex`, no `role="button"`, no chevron/record navigation, and keyboard Enter/Space does nothing |
| 14 | Report confidence banner shows Ready/Almost ready/Needs cleanup + message; "View blockers" jumps to the Cleanup tab; readiness ring/band KPI matches |
| 15 | `Missing Receipt` transactions, bills without a due date, subscriptions without a renewal date appear in the Cleanup tab |
| 16 | Custom / "Others" categories appear as **Unmapped** in Account Mapping; built-ins show **Suggested**; saving writes `users/{uid}/accounting_mappings` only + audit log; row flips to **Saved** after reload |
| 17 | Changing the period updates KPI strip, Income Statement table, confidence banner, cleanup queue, and mapping preview |
| 18 | Close tab "Close period" is a disabled **Planned** control; Topbar "Export package" is disabled (**Planned**); no period write occurs |
| 19 | AI prompt buttons + "Ask Fluxy AI" only open the Fluxy AI drawer — they never save or mutate data |
| 20 | Firestore shows no global accounting collections; all writes stay under `users/{uid}/…`; no amounts/formatted currency in `accounting_mappings` |
| 21 | Responsive at 375 / 768 / 1280 — KPI strip stacks, the Income Statement table scrolls within its container, **no page horizontal scroll** (`document.documentElement.scrollWidth === clientWidth`) |
| 22 | Browser console clean (no CSP/CORS/404/Firebase/permission errors) |
| 23 | Open `/accounting-records` signed out → redirects to `/login` |
| 24 | Open `/accounting-records?section=revenue&period=YYYY-MM` signed in → page renders with shared sidebar, Accounting Center active, and **no** marketing footer |
| 25 | `/accounting-records` header shows Accounting Center / Income Statement / row breadcrumb, `[Row label] records` title, period subtitle, Back to Accounting Center, and Ask Fluxy AI |
| 26 | Related-records summary cards show current amount, previous amount, change, and status/cleanup count; money uses Rp + dot separators and Fira Code |
| 27 | Related records match the clicked Income Statement section; transaction rows reconcile to the preview line amount, while Bills/Subscriptions appear only as supporting context and never change the P&L total |
| 28 | Search filters vendor/description/category/type/status/amount; Status, Type, Source, and Sort controls intersect correctly and reset pagination to page 1 |
| 29 | More than 10 records paginate at 10 per page; Previous/Next work; summary reads like `Showing 1-10 of 58 records` |
| 30 | Empty state reads "No related records found" with Back to Accounting Center CTA; filtered-empty state says no records match the filters |
| 31 | Loading skeleton appears before data resolves; error state says "Could not load related records. Check your connection and try again." and never shows raw Firebase errors |
| 32 | Source actions link by route/search only (`/ledger?search=...`, `/bill?search=...`, `/subscription?search=...`); raw document IDs are not shown in UI or action hrefs |
| 33 | Mobile 375px: summary cards stack, controls wrap, table scrolls inside its container, pagination remains usable, and there is no page-level horizontal overflow |

**Regression (shared files touched):** `sidebar-loader.js` and `db-service.js` were
modified — run §3 Cross-Page Regression and confirm Dashboard, Ledger, Bills,
Subscriptions, Budget, and Reports still render and their sidebar active states work.

---

## 3. Cross-Page Regression (run when shared files are touched)

Open each page and confirm no visual breakage:

| Page | Key Things to Spot-Check |
|------|--------------------------|
| `fluxyos.html` | Nav, hero, tabs, footer |
| `login.html` | Left panel, form, canvas |
| `dashboard.html` | KPIs, ledger, sidebar |
| `bill.html` | Table, Add Bill modal, sidebar |
| `subscription.html` | Table, Add Subscription modal, sidebar |
| `budget.html` | Summary card, allocations table, Create/Edit drawer, sidebar |
| `ledger.html` | Table, Add Transaction modal, sidebar |
| `pricing.html` | Cards, toggle, footer |
| `budgetlanding.html` | Hero, footer |
| `integration.html` | Cards grid, sidebar |
| `settings.html` | Index page tiles, search, sidebar active state, no footer |
| `settings-personal.html` | User rows, Planned pills, no save button, no footer |
| `settings-business.html` | Tab switching, Account/Business detail forms save, no footer |
| `settings-finance.html` | Locked currency/locale rows, timezone & date format save, no footer |
| `settings-import-rules.html` | Category chips, CSV behavior save, locked confirmation row, no footer |
| `settings-ai.html` | Style/period/toggles save, locked confirmation row, AI safety panel, no footer |
| `settings-whatsapp.html` | Status panel reflects saved state (no fake "Connected"), phone/name save, no footer |
| `settings-security.html` | Read-only posture, Planned team/audit panels, no footer |
| `internal.html` | Credential gate → console, tabs switch, no footer/sidebar/public-nav, friendly load state |

---

## 4. Before Pushing to Main — Final Gate

| # | Gate Check |
|---|------------|
| 1 | Zero red errors in DevTools Console on all modified pages |
| 2 | Smoke Tests (Section 1) all pass |
| 3 | Relevant Change Type checklist(s) complete |
| 4 | Tested at mobile width (375px) — no horizontal scroll, no overlapping elements |
| 5 | Tested at desktop width (1280px) — layout correct |
| 6 | New feature does not break any existing feature on the same page |
| 7 | Shared file changes verified on all pages in Cross-Page Regression table |
| 8 | Anti-AI-Slop Gate checks (Section 2A items 14-19) pass, or a documented exception is recorded per Exception Protocol. |

---

## Anti-AI-Slop Exception Protocol (Mandatory When Waiving a Gate)

Only use this when a user explicitly requests a style direction that conflicts with anti-slop hard rules, or a documented product requirement requires an exception.

When an exception is used, QA output must include:
- The exact waived check id(s) from Section 2A items 14-19
- Why the exception is needed
- Which page/component is impacted
- The tradeoff/risk accepted

If no exception log is provided, anti-slop QA is considered failed.

---

## Change Type — Trial Access & Payment Banner

Run when touching `assets/js/trial-access.js`, checkout/payment-pending pages,
billing methods in `db-service.js`, or canonical billing Firestore rules.

**Trial creation**
- [ ] New user completes onboarding → `users/{uid}/billing_subscription/current`
  exists with `status = trialing`, `plan_id = trial`, `trial_started_at` +
  `trial_ends_at` set; trial did not start before onboarding completion.
- [ ] Frozen legacy billing states translate safely on authenticated load.

**Banner**
- [ ] Trial banner shows on dashboard, ledger, bill, subscription, budget, reports,
  balance-sheet, integration, and settings*; CTA opens `/checkout?plan=growth&billing=annually`.
- [ ] Pending banner CTA opens `/payment-pending`; active user sees no banner.
- [ ] No horizontal overflow at 375px; banner CTA is the only primary action.

**Expiry locks**
- [ ] Set `trial_ends_at` in the past → reload → "Trial ended" banner.
- [ ] Add Transaction / CSV import / report export / Fluxy AI submit / bank-statement
  import are blocked with the canonical expired-trial dialog (no `alert`/`confirm`).
- [ ] Existing records remain readable (not deleted/hidden).

**Checkout and payment status**
- [ ] `/checkout` logged out redirects to `/login`; invalid query values fall back to
  Growth Engine annually.
- [ ] Checkout uses a full-viewport two-column desktop layout without card framing;
  mobile width stacks cleanly without horizontal overflow.
- [ ] Plan and billing switches update URL, benefits, subtotal, 11% estimated PPN,
  total, and CTA links from pricing.
- [ ] QRIS, Virtual Account, Card, and Invoice show metadata-only copy; no sensitive
  inputs are rendered.
- [ ] Submit (non-QRIS) writes one `billing_payment_requests` row + pending subscription
  update + audit log atomically, then redirects to `/payment-pending`.
- [ ] Pending page renders pending, active/verified, failed/expired retry, and empty
  states. `payment.html` redirects to `/pricing`.

**Manual QRIS payment**
- [ ] QRIS submit creates the request as `awaiting_payment` (subscription mirrors it) and
  redirects to `/payment-pending?requestId=...`.
- [ ] QR screen renders the `assets/images/qris-tanda360.png` image, exact total amount,
  plan/billing, request ID, and bank reference (Safrian Jayadi · OCBC Nisp · 6938-1098-7877).
- [ ] Reopening `/payment-pending` while `awaiting_payment` shows the QR again (not the card).
- [ ] "I've completed payment" reveals the optional proof upload + "Submit for verification".
- [ ] Submit without proof → status `pending_verification`, verification-in-progress card shows.
- [ ] Submit with a JPG/PNG/WebP/PDF (≤5 MB) proof → a `documents/` row is created and
  `proof_document_id`/`proof_file_name` are stored on the request; oversized/wrong type rejected inline.
- [ ] App banner shows "QRIS payment waiting" with a working "View QRIS payment" CTA while
  `awaiting_payment`, and trial write/AI access is retained; it becomes the verification banner after submit.
- [ ] QR view stacks cleanly at 375px with no horizontal overflow.

**Internal review reconcile (Verify / Reject reaches the user)**
- [ ] Reject payment in `/internal` (with a reason) → user reloads an app page → banner becomes
  "Payment could not be verified" and `/payment-pending` shows the reason + "Complete payment again"
  + "Back to dashboard".
- [ ] Verify payment in `/internal` → user reloads → banner/paywall clears and `/payment-pending` shows the
  active state.
- [ ] **Verify reaches an already-EXPIRED user:** with a subscription whose `status = expired`
  (trial elapsed), Verify in `/internal` → user reloads → status becomes `active`, the paywall is gone,
  no "Your trial has ended" banner. (Regression: reconcile + `isInternalReviewReconcile` must promote
  `expired`/`trialing` → `active` for a verified user, with no `updated_at` race.)
- [ ] After a reject, user completes payment again → new pending request is NOT re-flipped to failed by
  the stale decision (reconcile only fails in-flight states when the internal decision is newer).

**Hard paywall (trial ended / payment failed)**
- [ ] `status = expired` → every app page (dashboard, ledger, bill, subscription, budget, reports,
  balance-sheet, integration, settings*) shows a full-screen blurred, non-interactive paywall with "Your trial has
  ended" + "Choose a plan" → `/pricing`; the page behind cannot be scrolled or clicked.
- [ ] `status = payment_failed` with the trial window over → paywall shows "Payment couldn't be verified"
  + "Retry payment" → `/checkout?...`.
- [ ] Paywall "Already paid? Check status" → `/payment-pending`; "Sign out" signs out → `/login`.
- [ ] Paywall never appears on `/pricing`, `/checkout`, or `/payment-pending` (the user can always pay).
- [ ] A payment still in review (`pending_verification`/`awaiting_payment`) is NOT hard-blocked — it keeps
  the slim banner and read access.

**Data/security**
- [ ] Amounts stored as raw integers; no formatted currency strings; no card number,
  CVC, OTP, full bank account, NPWP, provider secret, or sensitive payload.
- [ ] No global/financial collections created; no ledger data in `internal_users`.
- [ ] Browser console clean (no CSP/CORS/404/Firebase errors).

---

## Critical Files Reference

| File | Role |
|------|------|
| `assets/js/shared-dashboard.js` | Modal, toast, empty states — used on all dashboard pages |
| `assets/js/sidebar-loader.js` | Sidebar + trial access guard wiring — used on all dashboard pages |
| `assets/js/trial-access.js` | Trial/payment banner + access guard (`window.FluxyAccessGuard`) |
| `assets/js/db-service.js` | All Firebase CRUD — read carefully before modifying |
| `assets/js/footer-loader.js` | Footer injection — skip logic must stay intact |
| `assets/js/universe-canvas.js` | Canvas animation — shared by login and footer |
| `includes/footer.html` | Single source of truth for footer markup |
| `assets/css/shared-dashboard.css` | Shared dashboard styles — affects all app pages |
