# FluxyOS QA Checklist — Applied After Every Change

## Context

FluxyOS is a multi-page financial operations platform (static HTML + vanilla JS + Firebase Firestore). Every time a change or new feature is requested, this checklist is run to verify the affected area works correctly and that no other parts of the app have broken. The goal is a fast, consistent QA pass that can be done in the browser after each implementation.

For architecture contracts, page types, module ownership, and extension rules,
read `SYSTEM_DESIGN.md` before planning a new dashboard page, landing page, or
Firestore-backed feature.

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

---

## 1. Smoke Tests — Run After Every Single Change

These 8 checks catch the most common regressions. Run them first, every time.

| # | Check | How to Verify |
|---|-------|---------------|
| 1 | **Homepage loads** | Open `fluxyos.html` — nav, hero, and footer all visible, no console errors |
| 2 | **Login page loads** | Open `login.html` — left panel + form visible, universe canvas animating |
| 3 | **Dashboard loads** | Sign in → `dashboard.html` — KPI cards show, ledger table renders or shows empty state |
| 4 | **Sidebar navigation** | Click each link (Overview, Ledger, Bills, Subscriptions, Integrations) — correct page loads, active item highlighted |
| 5 | **Footer appears** | Scroll to bottom of `fluxyos.html`, `pricing.html`, `budgetlanding.html` — footer renders with starfield animation |
| 6 | **Footer NOT on dashboard pages** | `dashboard.html`, `bill.html`, `subscription.html` — footer must NOT appear |
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

### B. Footer Changes (includes/footer.html, assets/css/footer.css, assets/js/footer-loader.js)

| # | Check |
|---|-------|
| 1 | Footer loads on `fluxyos.html`, `budgetlanding.html`, `pricing.html`, `index.html`, `integration.html`, `ledger.html` |
| 2 | Footer does NOT load on `dashboard.html`, `bill.html`, `subscription.html` |
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

### D. Dashboard / App Page Changes (dashboard.html, bill.html, subscription.html, ledger.html)

| # | Check |
|---|-------|
| 1 | Auth guard active — opening page without login redirects to `/login` within 2s |
| 2 | Sidebar renders with correct active item highlighted (orange accent) |
| 3 | Sidebar collapse/expand toggles correctly (icon-only at 80px, full at 260px) |
| 4 | User display name and avatar appear in sidebar bottom section |
| 5 | Sign Out button logs out and redirects to `/login` |
| 6 | Fluxy AI button in header opens/closes the chat drawer |
| 7 | Dashboard KPI cards load: Revenue, OpEx, Margin (with progress bar), Needs Action |
| 8 | Ledger table renders rows OR shows empty state (never blank/broken) |
| 9 | Bills table renders rows OR shows empty state |
| 10 | Subscriptions table renders rows OR shows empty state |

### E. Add Transaction / Bill / Subscription (shared-dashboard.js, db-service.js)

| # | Check |
|---|-------|
| 1 | Clicking "Add" button opens modal with correct title and submit label |
| 2 | Amount field formats live as Indonesian Rupiah (e.g., `1234567` → `1.234.567`) |
| 3 | Default category is correct: Transactions → none, Bills → "Operations", Subscriptions → "SaaS" |
| 4 | Submitting empty form shows required field validation (browser native) |
| 5 | Submit button disables and shows "Deploying..." while saving |
| 6 | On success: modal closes, correct toast message appears for 4s, then disappears |
| 7 | Data appears in the correct table after modal closes (no manual refresh needed) |
| 8 | On Firebase permission error: toast shows a friendly error message |
| 9 | Closing modal via X or backdrop click removes the modal completely |
| 10 | Re-opening modal after closing starts with a fresh, empty form |

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
| 4 | Each saved doc must have: `amount`, `vendor_name`, `category`, `type`, `status`, `timestamp` fields |
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

### I. Favicon / Meta / Head Changes

| # | Check |
|---|-------|
| 1 | Browser tab shows black F-logo favicon on all pages |
| 2 | Page title is correct per page (`<title>` tag) |
| 3 | Viewport meta tag present (`width=device-width, initial-scale=1`) |

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
| `ledger.html` | Table, Add Transaction modal, sidebar |
| `pricing.html` | Cards, toggle, footer |
| `budgetlanding.html` | Hero, footer |
| `integration.html` | Cards grid, sidebar |

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

---

## Critical Files Reference

| File | Role |
|------|------|
| `assets/js/shared-dashboard.js` | Modal, toast, empty states — used on all dashboard pages |
| `assets/js/sidebar-loader.js` | Sidebar — used on all dashboard pages |
| `assets/js/db-service.js` | All Firebase CRUD — read carefully before modifying |
| `assets/js/footer-loader.js` | Footer injection — skip logic must stay intact |
| `assets/js/universe-canvas.js` | Canvas animation — shared by login and footer |
| `includes/footer.html` | Single source of truth for footer markup |
| `assets/css/shared-dashboard.css` | Shared dashboard styles — affects all app pages |
