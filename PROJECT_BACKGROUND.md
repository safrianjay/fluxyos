# FluxyOS — Project Background Reference

> Read this before implementing any new feature, page, or logic change.
> This is the single source of truth for architecture, data schema, logic rules, and conventions.
> For extension contracts and module ownership, also read `SYSTEM_DESIGN.md`.

---

## 1. What FluxyOS Is

FluxyOS is a **financial operations platform** for Indonesian businesses. It consolidates multi-entity ledgers, vendor spending, and live revenue feeds into one unified dashboard.

**Target user:** Finance teams managing multiple business entities (e.g. e-commerce brands, agencies).

**Key capabilities:**
- Live transaction ledger (revenue + expenses)
- Bills & payment scheduling
- SaaS subscription tracking
- AI-powered financial analyst chat
- Dashboard KPIs: Revenue, OpEx, Gross Margin, Action Items

---

## 2. Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Static HTML5 + Tailwind CSS CDN + Vanilla JS (ES modules) |
| Animation | Anime.js (landing page only) |
| Auth | Firebase Authentication (email/password) |
| Database | Firebase Firestore (user-scoped collections) |
| Backend | FastAPI (Python) — `main.py` — serves static files + 3 API endpoints |
| Hosting | Netlify (auto-deploys from `main` branch on GitHub) |
| Fonts | Google Fonts — Inter (body), Fira Code (mono) |

**No build step.** Files are served as-is. No npm, no bundler, no framework.

---

## 3. Pages & Their Responsibilities

| Page | File | Type | Auth Required | Footer | Sidebar |
|------|------|------|--------------|--------|---------|
| Homepage | `fluxyos.html` | Landing | No | ✅ | No |
| Budget Feature | `budgetlanding.html` | Landing | No | ✅ | No |
| Pricing | `pricing.html` | Landing | No | ✅ | No |
| Redirect | `index.html` | Redirect | No | ✅ | No |
| Sign In | `login.html` | Auth | No | No | No |
| Dashboard | `dashboard.html` | App | ✅ | **No** | ✅ |
| Ledger | `ledger.html` | App | ✅ | **No** | ✅ |
| Bills | `bill.html` | App | ✅ | **No** | ✅ |
| Subscriptions | `subscription.html` | App | ✅ | **No** | ✅ |
| Integrations | `integration.html` | App | ✅ | **No** | ✅ |

**Rule:** Footer loads on all landing pages, never on app pages. Any page that renders `#sidebar` is an app page and must not load the marketing footer.

---

## 4. Firestore Database Schema

**Auth scope:** All collections are under `users/{userId}/` — each user only sees their own data.

### 4a. Transactions — `users/{userId}/transactions`

| Field | Type | Values / Notes |
|-------|------|----------------|
| `amount` | number | Raw integer (e.g. `1234567`). Never stored with dots. Always positive for revenue, positive for expense (type determines sign in display) |
| `vendor_name` | string | Free text (e.g. `"AWS"`, `"Client Payment"`) |
| `category` | string | `"Revenue"` \| `"Marketing"` \| `"Infrastructure"` \| `"Operations"` \| `"SaaS"` |
| `type` | string | `"revenue"` \| `"expense"` — lowercase always |
| `status` | string | `"Completed"` \| `"Missing Receipt"` |
| `icon` | string | `"💰"` (revenue) \| `"💸"` (expense) |
| `timestamp` | Firestore Timestamp | `serverTimestamp()` — always server-side, never client Date() |

**Ordering:** `timestamp DESC` (newest first). Default limit: 50. Dashboard preview: 5.

### 4b. Bills — `users/{userId}/bills`

Same fields as transactions plus:

| Field | Type | Notes |
|-------|------|-------|
| `due_date` | Firestore Timestamp | Optional. Displayed via `.toDate().toLocaleDateString()`. Falls back to `"Next week"` if missing |
| `category` | string | Defaults to `"Operations"` when created via modal |

**Ordering:** `timestamp DESC`.

### 4c. Subscriptions — `users/{userId}/subscriptions`

Same fields as transactions plus:

| Field | Type | Notes |
|-------|------|-------|
| `renewal_date` | Firestore Timestamp | Optional. Falls back to `"Next month"` if missing |
| `category` | string | Defaults to `"SaaS"` when created via modal |

**Ordering:** `timestamp DESC`.

---

## 5. Business Logic Rules

### Amount Formatting (Critical)

**Input → Display:** Dots as thousands separators (Indonesian format)
- User types: `1234567`
- Displayed in input: `1.234.567`
- Formula: `value.replace(/\D/g, "").replace(/\B(?=(\d{3})+(?!\d))/g, ".")`

**Display → Stored:** Strip dots, convert to float
- `parseFloat("1.234.567".replace(/\./g, ""))` → `1234567`

**Stored → Displayed in tables:** `"Rp " + Math.abs(amount).toLocaleString()`

**Never store a formatted string in Firestore.** Amount must always be a raw number.

### getDashboardStats Calculation

```
revenue = sum of amount WHERE type === 'revenue'
opex    = sum of Math.abs(amount) WHERE type === 'expense'
margin  = ((revenue - opex) / revenue) * 100
```

**Edge cases:**
- If `revenue === 0`: margin returns `NaN` or `-Infinity` — UI must handle gracefully (show `0%`)
- `action_items_count` = count of rows where `status === 'Missing Receipt'`
- `revenue_change` is hardcoded `"0%"` (not yet calculated dynamically)

### Modal Context Rules

| Context | Default Category | Submit Label | Toast Message |
|---------|-----------------|--------------|---------------|
| `'transaction'` | none | `"Add Transaction"` | `"Transaction successfully deployed to your live ledger!"` |
| `'bill'` | `"Operations"` | `"Save Bill"` | `"Bill successfully added to your schedule!"` |
| `'subscription'` | `"SaaS"` | `"Activate Subscription"` | `"Subscription successfully activated!"` |

---

## 6. Shared JS Components & Exact APIs

### `window.showAddTransactionModal(options)`
**File:** `assets/js/shared-dashboard.js`

```javascript
window.showAddTransactionModal({
  title: "Add Transaction",       // modal heading
  submitLabel: "Add Transaction", // submit button text
  defaultType: 'expense',         // pre-selected type dropdown
  defaultCategory: 'Operations',  // pre-selected category dropdown
  context: 'transaction'          // 'transaction' | 'bill' | 'subscription'
})
```

### `window.closeAddTransactionModal()`
Removes `#global-tx-modal` from the DOM entirely. Always safe to call.

### `window.showToast(message, type)`
```javascript
window.showToast("Your message", 'success') // 'success' | 'error' | 'info'
```
Auto-dismisses after 4000ms. Container ID: `#toast-container`.

### `window.renderEmptyState(containerId, config)`
```javascript
window.renderEmptyState('ledger-empty-state', {
  title: "No records",
  description: "Add your first record.",
  buttonText: "Add Now",
  onAction: () => window.showAddTransactionModal()
})
```

### `window.renderShimmer(containerId, rowCount = 5)`
Shows skeleton loading rows inside a container while data loads.

### `initUniverseCanvas(canvasElement)`
**File:** `assets/js/universe-canvas.js`
Starts the starfield animation on any `<canvas>` element. Used on login page and footer. Colors: dark navy `#0B0F19` base, purple glow only — no cyan or teal.

### `loadFooter()`
**File:** `assets/js/footer-loader.js`
Auto-runs on landing pages. Fetches `includes/footer.html`, appends to `<body>`, loads `assets/css/footer.css`, and calls `initUniverseCanvas()`. App pages with `#sidebar` must not load the marketing footer.

---

## 7. Key HTML Element IDs (referenced by JS — do not rename)

| ID | File | Purpose |
|----|------|---------|
| `kpi-revenue` | `dashboard.html` | Revenue KPI display value |
| `kpi-opex` | `dashboard.html` | OpEx KPI display value |
| `kpi-margin` | `dashboard.html` | Margin % display value |
| `kpi-margin-bar` | `dashboard.html` | Margin progress bar (width set as %) |
| `ledger-body` | `dashboard.html`, `ledger.html` | `<tbody>` populated by JS |
| `ledger-table-container` | `dashboard.html` | Shown/hidden based on data presence |
| `ledger-empty-state` | `dashboard.html` | Shown when 0 transactions |
| `ledger-footer` | `dashboard.html` | Hidden when 0 transactions |
| `global-tx-modal` | Injected | Modal wrapper — removed on close |
| `global-tx-form` | Injected | Modal form |
| `tx-amount` | Injected | Amount input in modal |
| `tx-vendor` | Injected | Vendor name input in modal |
| `tx-category` | Injected | Category dropdown in modal |
| `tx-type` | Injected | Type dropdown in modal |
| `tx-submit-btn` | Injected | Submit button in modal |
| `toast-container` | Injected | Toast notification host |
| `sidebar` | All app pages | Sidebar container (populated by sidebar-loader.js) |
| `sidebar-user-name` | Sidebar | User display name |
| `sidebar-user-avatar` | Sidebar | User avatar `<img>` |
| `login-universe-canvas` | `login.html` | Canvas for starfield animation |

---

## 8. Sidebar Navigation (sidebar-loader.js)

Sidebar is injected into every app page at `#sidebar`. Active item is detected by `window.location.pathname`.

| Group | Item | Type | Route / Action | Status |
|-------|------|------|----------------|--------|
| Command | Overview | Link | `/dashboard` | ✅ Shipped |
| Command | Fluxy AI | Button | `window.toggleFluxyAI()` | ✅ Shipped |
| Money Movement | Transactions | Link | `/ledger` | ✅ Shipped |
| Money Movement | Revenue Sync | Disabled button | `Soon` | 📋 Planned |
| Money Movement | Bills | Link | `/bill` | ✅ Shipped |
| Money Movement | Subscriptions | Link | `/subscription` | ✅ Shipped |
| Operations | Vendor Spend | Disabled button | `Soon` | 📋 Planned |
| Operations | Receipt Capture | Disabled button | `Soon` | 📋 Planned |
| Operations | Budgets | Disabled button | `Soon` | 📋 Planned |
| Operations | Approvals | Disabled button | `Soon` | 📋 Planned |
| Reporting | Reports & Exports | Disabled button | `Soon` | 📋 Planned |
| Reporting | Audit Log | Disabled button | `Soon` | 📋 Planned |
| Workspace | Integrations | Link | `/integration` | ✅ Shipped |
| Workspace | Settings | Disabled button | `Soon` | 📋 Planned |

Future sidebar entries stay visible only as disabled `Soon` buttons until a real
authenticated app page exists. Dashboard sidebar entries must never link to
public marketing pages.

Active styles: orange text/icon `#EA580C` on a transparent background.

---

## 9. Backend API Endpoints (main.py)

Base URL (local): `http://localhost:8000/api/v1`
Base URL (Netlify): `/.netlify/functions/api/v1`

| Method | Path | Request | Response |
|--------|------|---------|----------|
| GET | `/dashboard/summary` | — | `{revenue, revenue_change, opex, margin, action_items_count, action_items_details}` |
| GET | `/dashboard/ledger` | — | Array of `{id, vendor_name, amount, status, timestamp, category_name, entity_name, icon}` |
| POST | `/brain/chat` | `{message: string}` | `{response: string, suggested_action?: string}` |

**Note:** The current dashboard uses Firebase Firestore directly (not the API). The API endpoints are legacy/fallback. New features should use Firestore via `db-service.js`.

---

## 10. Brand & Design Conventions

| Token | Value | Usage |
|-------|-------|-------|
| Orange (Primary CTA) | `#EA580C` | Buttons, active sidebar items, logo accent |
| Dark Navy (Background) | `#0B0F19` | Footer, login left panel, sidebar |
| Purple Glow | `rgba(109,40,217,0.4)` | Canvas nebula edges, footer border, subtle accents |
| Gray-50 | `#F9FAFB` | Landing page section backgrounds |
| White | `#FFFFFF` | Main content area, cards |
| Logo | Black square (`#000000`), rx=8, white F path | Navbar (black on light), footer (orange on dark) |
| Favicon | `assets/images/favicon.svg` | Black F-logo, all pages |
| Fonts | Inter (body/UI), Fira Code (mono/code) | Via Google Fonts CDN |
| Icons | Heroicons SVG (stroke, not filled) | All UI icons |
| Amount locale | Indonesian (`id-ID`) | Dot as thousands separator |

Use-case hero product visuals are light-first: use white/off-white surfaces with
gray borders, not black/dark dashboard cards. Use-case hero titles should use
the shared marketing scale `text-[44px] md:text-[56px]`. Non-hero use-case
sections may use the established dark section pattern when it improves contrast
or hierarchy.

---

## 11. Git & Deployment Workflow

```
Work happens in worktree:
  /Users/slumdogmacbookair/Desktop/fluxionos/.claude/worktrees/confident-blackburn-3cefd2
  Branch: claude/confident-blackburn-3cefd2

Merge to main repo:
  git -C /Users/slumdogmacbookair/Desktop/fluxionos merge claude/confident-blackburn-3cefd2 --no-edit

Push to production:
  git -C /Users/slumdogmacbookair/Desktop/fluxionos push origin main

Netlify auto-deploys on main push. No manual deploy step needed.
```

---

## 12. What Does NOT Exist Yet (Avoid Duplicating)

- Edit / delete for transactions, bills, subscriptions (stubs exist but no handler)
- "Pay Now" on bills (button exists, no handler)
- "Manage" on subscriptions (button exists, no handler)
- Real AI backend — `/api/v1/brain/chat` exists but returns mock data
- CSV export for bills (button exists, no handler)
- PDF export for ledger (button exists, no handler)
- Date range filtering on dashboard (button exists, no handler)
- Search on any table (input exists, no handler)

**Before building any of the above: check this list first to avoid rebuilding from scratch.**
