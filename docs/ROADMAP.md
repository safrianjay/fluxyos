# FluxyOS Roadmap

Tracks what's shipped, what's stubbed (UI exists, no logic), and what's planned.

---

## Status Key

| Status | Meaning |
|--------|---------|
| ✅ Shipped | Fully working, live on main |
| 🔧 Stub | UI/button exists but has no working logic yet |
| 📋 Planned | Not yet built |

---

## Core App Features

### Authentication
| Feature | Status | Notes |
|---------|--------|-------|
| Email/password login via Firebase Auth | ✅ Shipped | |
| Auth guard on all dashboard pages (redirect to `/login`) | ✅ Shipped | 2s timeout |
| Sign out | ✅ Shipped | Sidebar button |
| User display name + avatar in sidebar | ✅ Shipped | |
| Google SSO login | 🔧 Stub | Button exists on login page, no OAuth handler |

### Onboarding (new-user-only)
| Feature | Status | Notes |
|---------|--------|-------|
| 4-step setup flow on `/onboarding` | ✅ Shipped | Business setup → Account owner → Finance setup → Review |
| New-user detection via `ONBOARDING_RELEASE_CUTOFF = 2026-05-19T00:00:00.000Z` | ✅ Shipped | Users created before cutoff are exempt. Self-heals stale `legacy_exemption` markers if the cutoff is moved back. |
| Dashboard gate on app pages for incomplete new users | ✅ Shipped | Contextual copy per page; no impact on legacy users |
| Post-KYC platform learning | ✅ Shipped | Overview quick-start cards plus coachmark tours after completed setup only |
| Optional identity / business document upload | 🔧 Stub | UI present, no Firebase Storage upload yet; status always `not_uploaded` |
| Sample-data mode after onboarding | 📋 Planned | "Explore sample data" routes to dashboard without seeding records |
| "Use sample data" CTA on the dashboard gate | 📋 Planned | Hidden in v1 |

### Internal Operations Console (internal-only)
| Feature | Status | Notes |
|---------|--------|-------|
| Internal console page `internal.html` (Overview, Users, KYC, Payment, Audit tabs) | ✅ Shipped Phase 1 | Reuses dashboard design system; no footer/sidebar; hidden from public nav + sitemap |
| Credential gate (`fluxyos admin`, sessionStorage) | ✅ Shipped Phase 1 | `MVP_INTERNAL_ONLY_TEMPORARY_AUTH` — not production-grade; replace with Firebase custom claims / backend admin session |
| `internal_users` index + self-upsert on login/onboarding | ✅ Shipped Phase 1 | `DataService.syncSelfToInternalIndex`; covers only users who sign in after release |
| KYC / payment / account status actions + `internal_audit_logs` | ✅ Shipped Phase 1 | Confirmation dialogs, reviewer notes, audit log per action |
| Open `internal_*` firestore.rules (field-validated) | ✅ Shipped Phase 1 | Must be **deployed** for the console to load data. Open by design until admin auth exists |
| User-scoped audit mirror (`users/{uid}/audit_logs`) | 📋 Planned | Needs backend/Admin SDK (console is unauthenticated) |
| Customer payment-proof upload + `payment_verifications` | 📋 Planned | Phase 2; Payment Review currently uses denormalized fields on `internal_users` |
| Customer-facing access gates (pending/payment/suspended screens) | 📋 Planned | Phase 3 |
| Real admin auth (Firebase custom claims / backend session) | 📋 Planned | Phase 5; replaces the temporary credential gate |

### Transactions (Ledger)
| Feature | Status | Notes |
|---------|--------|-------|
| Add transaction (modal) | ✅ Shipped | Amount, vendor, category, type |
| Bulk add transactions from CSV | ✅ Shipped | Add Transaction modal imports CSV rows into transactions |
| View ledger table (newest first) | ✅ Shipped | Up to 50 rows |
| Dashboard ledger preview (5 rows) | ✅ Shipped | |
| Empty state when no transactions | ✅ Shipped | |
| Search transactions | 🔧 Stub | Input exists on ledger.html, no handler |
| Filter transactions | 🔧 Stub | "Filter" button on dashboard, no handler |
| Export ledger to CSV | ✅ Shipped | "Download CSV" on ledger.html exports loaded ledger rows |
| Export dashboard ledger preview to CSV | 🔧 Stub | "Export" button on dashboard, no handler |
| Edit transaction | 📋 Planned | No UI yet |
| Delete transaction | 📋 Planned | No UI yet |
| Date range filter | 🔧 Stub | "This Month" button on dashboard, no handler |

### Bills
| Feature | Status | Notes |
|---------|--------|-------|
| Add bill (modal) | ✅ Shipped | Defaults to "Operations" category |
| View bills table (newest first) | ✅ Shipped | |
| Empty state when no bills | ✅ Shipped | |
| Search bills | 🔧 Stub | Input exists on bill.html, no handler |
| Export bills to CSV | 🔧 Stub | "Export CSV" button on bill.html, no handler |
| Pay Now | 🔧 Stub | Button renders per row, no handler |
| Edit bill | 📋 Planned | No UI yet |
| Delete bill | 📋 Planned | No UI yet |
| Overdue bill detection | 📋 Planned | Status logic not implemented |

### Subscriptions
| Feature | Status | Notes |
|---------|--------|-------|
| Add subscription (modal) | ✅ Shipped | Defaults to "SaaS" category |
| View subscriptions table (newest first) | ✅ Shipped | |
| Empty state when no subscriptions | ✅ Shipped | |
| Search subscriptions | 🔧 Stub | Input exists on subscription.html, no handler |
| Manage subscription | 🔧 Stub | "Manage" button renders per row, no handler |
| Cancel subscription | 📋 Planned | Part of "Manage" flow |
| Renewal date alerts | 📋 Planned | |

### Dashboard KPIs
| Feature | Status | Notes |
|---------|--------|-------|
| Live Revenue KPI | ✅ Shipped | Sum of revenue transactions |
| OpEx KPI | ✅ Shipped | Sum of expense transactions |
| Gross Margin KPI + progress bar | ✅ Shipped | `(revenue - opex) / revenue × 100` |
| Needs Action KPI (missing receipts count) | ✅ Shipped | |
| Revenue change % (dynamic) | 📋 Planned | Currently hardcoded `"0%"` |
| "Resolve Now" link | 🔧 Stub | Link exists on Needs Action card, `href="#"` |
| FluxyOS Brain chat widget (dashboard) | 🔧 Stub | Input + button exist, no submit handler |

### Reports & Exports
| Feature | Status | Notes |
|---------|--------|-------|
| Reports & Exports app page (`/reports`) | ✅ Shipped MVP | Auth-guarded, sidebar-active, no marketing footer |
| Period filter (default current month) | ✅ Shipped MVP | Uses shared `FluxyDateRangePicker` |
| Report readiness score + ledger/receipt/bills bars | ✅ Shipped MVP | Computed from real records |
| Data coverage panel | ✅ Shipped MVP | |
| Needs cleanup panel (missing receipts/due dates/renewals) | ✅ Shipped MVP | |
| Preview drawer (financial summary, sources, files, warnings) | ✅ Shipped MVP | |
| CSV export (P&L, expense breakdown, bills, subscriptions, ledger, data quality) | ✅ Shipped MVP | Raw integer amounts in output |
| Monthly Report Pack (bundled CSV download) | ✅ Shipped MVP | Sequential downloads after confirmation |
| `export.create` audit log written before download | ✅ Shipped MVP | Metadata only — no CSV/row content stored |
| Recent exports panel | ✅ Shipped MVP | Filters `audit_logs` for `export.create` |
| Verified-user export gate | 🔧 Stub | UI ready; defaults to verified until a real verification field exists |
| Audit Log app page (`/audit-log`) | 📋 Planned | Topbar "View audit trail" is disabled until shipped |
| **Level 1 full report viewer (`/report-preview`)** | ✅ Shipped MVP | Renders 9 sections from `monthlyReportPack` staged in `sessionStorage`. Toolbar: Back · Print/Save PDF · Download CSV Bundle · Confirm Export |
| **Browser-native PDF save (`window.print()`)** | ✅ Shipped MVP | App cannot verify save, so never logs `downloaded: true` |
| **`report_exports` metadata collection** | ✅ Shipped MVP | Append-only, user-scoped, no row-level data |
| **Period Comparison (vs previous period)** | ✅ Shipped MVP | Falls back to "Unavailable" when previous period has no records |
| **YTD / QTD reports** | ✅ Shipped MVP | "Report period" select on the Reports filter strip; adds Monthly Trend Breakdown + averages + best/worst month |
| **Year-on-Year comparison (Previous YTD or Same period last year)** | ✅ Shipped MVP | YTD P&L comparison + monthly trend comparison; `change_pct` returns N/A when previous is 0 (never NaN/Infinity); margin uses `pts` |
| **Scope-aware CSV filenames** | ✅ Shipped MVP | `ytd_profit_loss_…`, `monthly_trend_…`, `yoy_profit_loss_…`, `monthly_trend_yoy_…` |
| **`report_scope` metadata on `report_exports` + `export.create` audit log** | ✅ Shipped MVP | Mode, comparison mode, current/comparison periods, generated title persisted |
| **Finance Predictability (run rate + ARR + year-end scenarios)** | ✅ Shipped MVP | ARR stays unavailable until recurring revenue classification ships |
| Backend PDF generation (Level 2) | 📋 Planned | Replace browser-print path with stored PDF files |
| ZIP CSV bundle | 📋 Planned | MVP downloads files individually |
| Recurring revenue classification (for ARR — category-level) | ✅ Shipped MVP | `users/{uid}/settings/reports.recurring_revenue_category_ids` drives ARR; Settings → Finance preferences has the picker. Future: per-transaction `is_recurring` flag for higher precision. |
| Bank balance / cash runway | 📋 Planned | Cash pressure stays proxy-only until real balance source exists |

### Integrations
| Feature | Status | Notes |
|---------|--------|-------|
| Integrations grid UI | ✅ Shipped | Cards for BCA, Meta Ads, Stripe, etc. |
| Connect integration | 🔧 Stub | "Connect" button per card, no OAuth handler |
| Disconnect integration | 🔧 Stub | "Disconnect" button on Meta Ads card, no handler |
| Request Connector | 🔧 Stub | Card exists, no form/modal handler |
| Real data sync from any integration | 📋 Planned | All integrations are UI-only mock |

### Dashboard Sidebar Future Domains
| Feature | Status | Notes |
|---------|--------|-------|
| Overview | ✅ Shipped | Dashboard command center at `/dashboard` |
| Fluxy AI sidebar action | ✅ Shipped | Opens the AI drawer; not a route |
| Transactions / Ledger | ✅ Shipped | Working app page at `/ledger` |
| Bills | ✅ Shipped | Working app page at `/bill` |
| Subscriptions | ✅ Shipped | Working app page at `/subscription` |
| Integrations | ✅ Shipped | Working app page at `/integration` |
| Revenue Sync | ✅ Shipped | Working app page at `/revenue-sync` (channels, reconciliation, revenue-only table) |
| Vendor Spend | 📋 Planned | Visible as disabled `Soon`; no app page yet |
| Receipt Capture | 📋 Planned | Visible as disabled `Soon`; no app page yet |
| Budgets | ✅ Shipped Phase 2 | `/budget` — main budget + category allocations, live actual/committed usage, unallocated spend warning, Add Bill drawer budget impact preview. Phase 2 adds record-level control: clickable allocation detail drawer, unallocated records queue, excluded records section, budget activity timeline, deterministic variance explanation, and budget badge + Assign / Restore action on every Ledger and Bills row. Every manual change writes a `budget_assignment.*` audit log. Approvals, hard enforcement, Pay Now, and AI auto-assign remain Phase 3. |
| Approvals | 📋 Planned | Visible as disabled `Soon`; no app page yet |
| Reports & Exports | ✅ Shipped MVP | `/reports` — period filter, readiness score, preview drawer, CSV export, `export.create` audit log |
| Audit Log | 📋 Planned | Visible as disabled `Soon`; no app page yet |
| Settings | ✅ Shipped MVP | Working app page at `/settings` with company, finance, import, WhatsApp, AI, and account basics |

Visible `Soon` entries communicate product direction only. They must stay
disabled until a real authenticated app page and data contract exist.

---

## AI Features

| Feature | Status | Notes |
|---------|--------|-------|
| Fluxy AI chat drawer | ✅ Shipped | Opens/closes, accepts messages |
| AI response via `/api/v1/brain/chat` | ✅ Shipped | Returns mock responses |
| Real AI backend (LLM integration) | 📋 Planned | Currently hardcoded mock replies |
| AI-powered transaction categorization | 📋 Planned | |
| AI spend anomaly detection | 📋 Planned | Shown as static "insight" card on dashboard |

---

## Landing & Marketing Pages

| Feature | Status | Notes |
|---------|--------|-------|
| Homepage (`fluxyos.html`) | ✅ Shipped | Full landing with animations, mega menu, tabs, CTA |
| Budget landing page (`budgetlanding.html`) | ✅ Shipped | |
| Pricing page (`pricing.html`) | ✅ Shipped | Annual/monthly toggle, 3 tiers |
| Reusable footer with starfield animation | ✅ Shipped | |
| "Start Free Trial" button | 🔧 Stub | Pricing page, no handler |
| "Upgrade to Growth" button | 🔧 Stub | Pricing page, no handler |
| "Contact Sales" button | 🔧 Stub | Pricing page, no handler |

---

## Infrastructure & DX

| Feature | Status | Notes |
|---------|--------|-------|
| Firebase Auth + Firestore | ✅ Shipped | |
| Netlify hosting + auto-deploy from main | ✅ Shipped | |
| Clean URLs (no `.html` extensions) | ✅ Shipped | |
| SVG favicon | ✅ Shipped | Black F-logo, all pages |
| `CLAUDE.md` | ✅ Shipped | Claude session rules |
| `PROJECT_BACKGROUND.md` | ✅ Shipped | Architecture reference |
| `QA_CHECKLIST.md` | ✅ Shipped | QA workflow |
| `CHANGELOG.md` | ✅ Shipped | Feature history |
| `ROADMAP.md` | ✅ Shipped | This file |
| `COMPONENT_GUIDE.md` | ✅ Shipped | How to extend the project |

---

## Stub Priority (suggested build order)

When picking up a stub to build, suggested order:

1. **Search** on all tables (high daily use)
2. **Export CSV** for bills and ledger (common business need)
3. **Edit / Delete** for transactions, bills, subscriptions
4. **Pay Now** on bills
5. **Manage** on subscriptions
6. **Date range filter** on dashboard
7. **Revenue change %** calculation
8. **Pricing page CTAs** (free trial, upgrade, contact sales)
9. **Google SSO** on login
10. **Real integration connectors** (BCA, Stripe, Meta Ads)
