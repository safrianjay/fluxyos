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
| Budgets | 📋 Planned | Visible as disabled `Soon`; no app page yet |
| Approvals | 📋 Planned | Visible as disabled `Soon`; no app page yet |
| Reports & Exports | 📋 Planned | Visible as disabled `Soon`; no app page yet |
| Audit Log | 📋 Planned | Visible as disabled `Soon`; no app page yet |
| Settings | 📋 Planned | Visible as disabled `Soon`; no app page yet |

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
