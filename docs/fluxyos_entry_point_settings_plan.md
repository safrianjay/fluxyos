# FluxyOS Entry Point & Settings MVP Plan

## 0. Purpose

This document defines the product and implementation plan for improving the FluxyOS dashboard entry points, with special focus on turning **Settings** from a disabled `Soon` item into a useful MVP workspace control center.

The goal is not to make the sidebar look complete. The goal is to make FluxyOS feel like a finance operating system where users can:

1. Add or import financial data.
2. Review AI/document extraction before saving.
3. Understand business performance.
4. Configure the workspace safely.
5. Connect data sources and WhatsApp when ready.

Early-stage product principle: keep the product focused around the core user loop instead of exposing too many future modules.

---

## 1. Strategic Diagnosis

### Current sidebar problem

The current sidebar exposes a broad roadmap:

- Overview
- Fluxy AI
- Transactions
- Revenue Sync
- Bills
- Subscriptions
- Vendor Spend
- Receipt Capture
- Budgets
- Approvals
- Reports & Exports
- Audit Log
- Integrations
- Settings

This makes FluxyOS look ambitious, but also unfinished. Many entries are disabled with `Soon`, which creates the feeling that users are inside a prototype rather than a reliable finance product.

### Product risk

The risk is that users judge the product by what is missing instead of what works.

For an early-stage finance product, trust matters more than breadth. A smaller product with a strong loop is better than a large navigation system full of future promises.

### Core product loop FluxyOS should optimize

```text
Capture/import data
  → AI detects and structures it
  → user reviews before save
  → data lands in Ledger, Bills, Revenue, or Subscriptions
  → Fluxy AI answers grounded finance questions
  → user acts on risks and next steps
```

Every sidebar entry should support this loop. If it does not, hide it, downgrade it, or keep it outside primary navigation.

---

## 2. Recommended Sidebar Direction

### Recommended MVP sidebar

```text
Command
- Overview
- Fluxy AI
- Inbox / Review

Money
- Ledger
- Revenue
- Bills
- Subscriptions

Connect
- Integrations
- WhatsApp

Workspace
- Settings
```

### Why this is better

This IA organizes the product around the user’s actual job:

- **Command**: understand, ask, review.
- **Money**: inspect financial records.
- **Connect**: bring data into the system.
- **Workspace**: configure the product.

It removes roadmap noise and makes the product feel more coherent.

---

## 3. Settings: Main Recommendation

### Verdict

**Settings should not be disabled.**

Even if advanced settings are not ready, a basic Settings page is necessary because users need a place to configure the business context that finance data depends on.

A finance app without Settings feels incomplete because the user cannot answer basic questions like:

- What company is this workspace for?
- What currency is being used?
- What categories are available?
- How do I connect WhatsApp?
- How does Fluxy AI behave?
- Where can I manage imports or data rules?

### Product role of Settings

Settings should be the **workspace control center**, not a dumping ground.

It should cover configuration that changes how FluxyOS works, not daily finance operations.

---

## 4. Settings MVP Scope

## Feature Name

Workspace Settings MVP

## 1. Feature Type

Page-level feature.

## 2. Context

The sidebar currently shows Settings as a disabled `Soon` entry. This creates friction because users cannot configure basic workspace, company, currency, AI, WhatsApp, or import behavior.

FluxyOS already has financial pages for Transactions, Revenue Sync, Bills, Subscriptions, and Integrations. Settings should support these pages by giving users control over business context and system preferences.

## 3. Main Objective

Give users a basic but real place to configure their FluxyOS workspace without adding risky financial write flows.

## 4. Job To Be Done

When I start using FluxyOS,
I want to configure my business, currency, categories, AI behavior, and connection preferences,
so I can trust that finance data is organized correctly.

## 5. Target User

- Founder
- Business owner
- Finance admin
- Account owner

## 6. User Problem

Users need control over the workspace context, but the current Settings entry is disabled. This makes the product feel unfinished and blocks important setup workflows.

## 7. Business Value

Settings improves trust, onboarding, retention, and product maturity. It also creates a natural home for future paid/admin features such as roles, audit, AI preferences, WhatsApp setup, export rules, and workspace configuration.

---

## 5. Settings Information Architecture

The Settings MVP should use a simple left-side section menu or card-based layout inside the page.

### Recommended sections

```text
Workspace Settings
- Business Profile
- Currency & Locale
- Categories
- AI Preferences
- WhatsApp
- Import Rules
- Account
```

### Section 1: Business Profile

Purpose: define business identity.

Fields:

- Business name
- Business type / industry
- Country: Indonesia by default
- Default entity label: Global HQ / Consolidated

MVP behavior:

- Display current values.
- Allow editing if backend/data model already supports safe save.
- If save is not ready, show disabled fields with `Editable soon` copy, but do not leave the full page disabled.

Recommended Firestore path:

```text
users/{userId}/settings/workspace
```

Example schema:

```json
{
  "business_name": "Global HQ",
  "business_type": "Agency",
  "country": "Indonesia",
  "entity_label": "Consolidated",
  "updated_at": "serverTimestamp"
}
```

### Section 2: Currency & Locale

Purpose: define how money and dates are displayed.

Fields:

- Currency: IDR only for now
- Amount format: Indonesian Rupiah with dot separators
- Timezone: Asia/Jakarta by default
- Date format: DD MMM YYYY or Indonesian-friendly display

MVP behavior:

- IDR should be locked as default.
- Explain that multi-currency is planned.
- Do not introduce multi-currency logic yet.

Recommended Firestore path:

```text
users/{userId}/settings/preferences
```

Example schema:

```json
{
  "currency": "IDR",
  "locale": "id-ID",
  "timezone": "Asia/Jakarta",
  "updated_at": "serverTimestamp"
}
```

### Section 3: Categories

Purpose: make finance data feel controllable.

Default categories:

- Revenue
- Marketing
- Infrastructure
- Operations
- SaaS

MVP behavior:

- Show the current category list.
- Do not allow delete yet if category deletion can break existing records.
- Optional: allow adding custom category only if all affected pages can handle it.
- Safer MVP: read-only list plus `Custom categories coming soon`.

Important guardrail:

Do not change existing transaction category rules unless all ledger, bills, subscriptions, dashboard stats, CSV import, and AI mapping logic are updated together.

### Section 4: AI Preferences

Purpose: control how Fluxy AI behaves.

Fields:

- AI answer style: concise / detailed
- Default analysis period: this month / last month / custom later
- Allow AI suggestions: on/off
- Require confirmation before save: always on and locked

MVP behavior:

- Show clear AI safety rules.
- `Require confirmation before save` must be locked on.
- AI must never auto-save records without user confirmation.

Recommended Firestore path:

```text
users/{userId}/settings/ai
```

Example schema:

```json
{
  "answer_style": "practical",
  "default_period": "current_month",
  "allow_ai_suggestions": true,
  "require_confirmation_before_save": true,
  "updated_at": "serverTimestamp"
}
```

### Section 5: WhatsApp

Purpose: support future WhatsApp finance Q&A and upload flow.

Fields:

- WhatsApp status: Not connected / Pending / Connected
- Phone number
- Last verified at
- Webhook status indicator

MVP behavior:

- If WhatsApp integration is not ready, show a setup placeholder.
- Do not fake connection status.
- If connected data exists, render it.
- Add clear copy: `Upload bills and ask finance questions from WhatsApp after setup.`

Required Firestore path:

```text
users/{userId}/settings/whatsapp
```

Example schema:

```json
{
  "status": "not_connected",
  "phone_number": null,
  "provider": "whatsapp_cloud_api",
  "last_verified_at": null,
  "updated_at": "serverTimestamp"
}
```

### Section 6: Import Rules

Purpose: define how uploaded finance data should be mapped.

Fields:

- Default CSV date behavior: use row date / use upload date
- Unknown document routing: AI Review
- Bill scan behavior: create bill/payable first
- Receipt scan behavior: create ledger transaction draft
- Payment screenshot behavior: create transaction or transfer review

MVP behavior:

- Show rules as locked defaults first.
- Do not let users change rules until the backend supports it.
- Make the rules visible to build trust.

Important finance rule:

A scanned bill creates a bill/payable first. It must not automatically create a ledger transaction or mark itself paid.

### Section 7: Account

Purpose: basic account ownership and session info.

Fields:

- User name
- Email
- Role: Account Owner
- Sign out entry or link to existing sidebar sign out

MVP behavior:

- Display only.
- No role management yet.
- Do not add team invite until workspace permissions exist.

---

## 6. What Settings Must Not Include Yet

Out of scope for Settings MVP:

- Team roles and permissions
- Workspace migration from `users/{userId}` to `workspaces/{workspaceId}`
- Payment methods
- Bank account credentials
- Vendor bank details
- Multi-currency accounting
- Delete account
- Dangerous data reset
- AI autonomous write permissions
- Approval rule builder
- Tax configuration

These require stronger backend, permissions, audit logs, and confirmation flows.

---

## 7. Sidebar Cleanup Plan

### Phase 1: Immediate cleanup

Goal: reduce roadmap noise without removing product ambition.

Actions:

1. Convert Settings from disabled `Soon` to real link:

```text
/settings
```

2. Keep current working pages:

- Overview
- Fluxy AI
- Transactions / Ledger
- Revenue Sync
- Bills
- Subscriptions
- Integrations

3. Hide or downgrade these entries from the visible sidebar:

- Vendor Spend
- Receipt Capture
- Budgets
- Approvals
- Reports & Exports
- Audit Log

If hiding is too aggressive, move them into a collapsed `Coming Soon` group lower in the sidebar. Do not let them dominate the product.

### Phase 2: Add Inbox / Review

Goal: create a home for AI/document/CSV pending review.

Recommended route:

```text
/review
```

Recommended label:

```text
Inbox / Review
```

This should eventually show:

- AI uploads pending review
- CSV imports pending mapping
- WhatsApp pending confirmations
- Extracted bill drafts
- Extracted receipt drafts
- Errors or failed parsing

This page is more important than Receipt Capture as a standalone item because the real user job is review and confirmation, not just uploading.

### Phase 3: Reintroduce advanced modules only when real

Add these back only when they have working pages, data model, empty states, and QA:

- Vendor Spend
- Budgets
- Approvals
- Reports & Exports
- Audit Log

---

## 8. Product Priority Matrix

| Entry Point | Keep Now | Priority | Reason |
|---|---:|---:|---|
| Overview | Yes | P0 | Main business health view |
| Fluxy AI | Yes | P0 | Core differentiation |
| Inbox / Review | Add | P0 | Missing review layer for AI uploads/imports |
| Ledger / Transactions | Yes | P0 | Source of truth |
| Bills | Yes | P0 | Cash pressure and payable workflow |
| Revenue Sync | Yes, if real | P1 | Revenue ingestion and reconciliation |
| Subscriptions | Yes | P1 | Recurring SaaS visibility |
| Integrations | Yes | P1 | Data source setup |
| Settings | Yes, build MVP | P0 | Workspace trust and configuration |
| WhatsApp | Add under Connect or Settings | P1 | Killer channel, but setup-driven |
| Vendor Spend | Hide / later | P2 | Can be derived from ledger first |
| Receipt Capture | Replace with Inbox / Review | P2 | Too narrow as standalone |
| Budgets | Later | P3 | Requires historical data and workflow maturity |
| Approvals | Later | P3 | Requires roles, permissions, audit logs |
| Reports & Exports | Later as page, export actions sooner | P2 | Export needed, full report module later |
| Audit Log | Later | P3 | Only useful after sensitive actions exist |

---

## 9. Implementation Plan for Codex

## Goal

Build a real **Settings** page and update the sidebar so Settings is no longer disabled. Keep the scope small, safe, and aligned with the existing FluxyOS static HTML + Tailwind + Vanilla JS + Firebase architecture.

## Files to read first

Before changing code, read:

- `CLAUDE.md`
- `docs/PROJECT_BACKGROUND.md`
- `docs/product_ux_feature_intake_framework.md`
- `docs/SYSTEM_DESIGN.md`
- `docs/SECURITY_SYSTEM.md`
- `docs/DESIGN_SYSTEM.md`
- `docs/QA_CHECKLIST.md`
- `docs/ROADMAP.md`

## Likely files to modify

- `settings.html` or create a new authenticated app page if it does not exist
- `assets/js/sidebar-loader.js`
- `assets/js/db-service.js` only if safe read/write helpers are needed
- `assets/css/shared-dashboard.css` only if the Settings page needs shared styles
- `docs/PROJECT_BACKGROUND.md` if a new settings data model is added
- `docs/ROADMAP.md` to update Settings status from planned/stub to shipped/MVP
- `docs/QA_CHECKLIST.md` only if new Settings-specific QA checks are needed

## Scope

### In scope

- Create authenticated `settings.html` app page.
- Use existing app layout with `#sidebar`.
- Load `assets/css/shared-dashboard.css`.
- Load `assets/js/sidebar-loader.js`.
- Load `assets/js/shared-dashboard.js`.
- Add Firebase auth guard consistent with other dashboard pages.
- Render Settings page with sections:
  - Business Profile
  - Currency & Locale
  - Categories
  - AI Preferences
  - WhatsApp
  - Import Rules
  - Account
- Make Settings sidebar entry a real link to `/settings`.
- Add active sidebar state for Settings.
- Show safe read-only defaults where write support is not ready.
- If implementing save, only save non-sensitive settings under user-scoped paths.
- Use user-scoped Firestore only.

### Out of scope

- Roles and team management
- Workspace migration
- Payment setup
- Bank account connection
- Vendor bank details
- Multi-currency accounting
- Full WhatsApp onboarding
- AI autonomous save permissions
- Approval rules
- Audit log page
- Dangerous delete/reset actions
- Any React, npm, bundler, or framework migration

---

## 10. Data Model Recommendation

Keep settings user-scoped for now:

```text
users/{userId}/settings/workspace
users/{userId}/settings/preferences
users/{userId}/settings/ai
users/{userId}/settings/whatsapp
users/{userId}/settings/import_rules
```

Do not create global settings collections.

### Minimal schema

```json
{
  "workspace": {
    "business_name": "Global HQ",
    "business_type": "",
    "country": "Indonesia",
    "entity_label": "Consolidated",
    "updated_at": "serverTimestamp"
  },
  "preferences": {
    "currency": "IDR",
    "locale": "id-ID",
    "timezone": "Asia/Jakarta",
    "updated_at": "serverTimestamp"
  },
  "ai": {
    "answer_style": "practical",
    "default_period": "current_month",
    "allow_ai_suggestions": true,
    "require_confirmation_before_save": true,
    "updated_at": "serverTimestamp"
  },
  "whatsapp": {
    "status": "not_connected",
    "phone_number": null,
    "provider": "whatsapp_cloud_api",
    "last_verified_at": null,
    "updated_at": "serverTimestamp"
  },
  "import_rules": {
    "unknown_document_route": "ai_review",
    "bill_scan_behavior": "create_bill_draft",
    "receipt_scan_behavior": "create_ledger_draft",
    "payment_screenshot_behavior": "create_review_item",
    "require_confirmation_before_save": true,
    "updated_at": "serverTimestamp"
  }
}
```

Codex may implement these as separate Firestore docs under `users/{userId}/settings/{docId}`.

Important: store raw values only. Do not store formatted currency display strings.

---

## 11. Frontend UX Requirements

### Layout

- Use the same authenticated app shell as Dashboard, Ledger, Bills, Subscriptions, and Integrations.
- Sidebar width remains fixed.
- Main content uses light gray app background and white cards.
- Page title: `Settings`.
- Subtitle: `Manage workspace, finance preferences, AI behavior, and connection settings.`

### Recommended structure

Top summary cards:

1. Workspace
2. AI Safety
3. WhatsApp

Then section cards:

- Business Profile
- Currency & Locale
- Categories
- AI Preferences
- WhatsApp Setup
- Import Rules
- Account

### Visual behavior

- Use orange only for primary actions and active states.
- Do not use orange backgrounds.
- Use disabled controls clearly when a feature is not editable yet.
- Avoid fake connected or fake saved states.
- Show clear empty/default states.

### Copy guidelines

Use practical product copy:

- `Locked for MVP`
- `Coming after workspace roles are added`
- `Requires confirmation before save`
- `No WhatsApp number connected yet`
- `IDR is the default currency for this workspace`

Avoid vague copy like:

- `Coming soon` everywhere
- `Powered by AI`
- `Advanced configuration`
- `Seamless setup`

---

## 12. Security Requirements

- Settings page must require Firebase Auth.
- All reads/writes must stay under `users/{userId}/settings`.
- Do not read or write global collections.
- Do not expose API keys, webhook secrets, access tokens, bank credentials, or WhatsApp tokens.
- Do not allow AI write permissions to be disabled from confirmation mode.
- Do not add dangerous actions like delete account, reset data, or remove workspace unless audit logs and confirmation flows exist.
- If saving settings, show clear success/error toast.
- Handle Firestore permission errors with friendly UI.

---

## 13. Acceptance Criteria

The implementation is complete when:

1. `/settings` loads as an authenticated dashboard page.
2. Unauthenticated users are redirected to `/login`.
3. Sidebar Settings entry is clickable and active on `/settings`.
4. Settings is no longer disabled or marked `Soon`.
5. The page renders all MVP sections.
6. Currency shows IDR as default and does not introduce multi-currency logic.
7. AI confirmation requirement is shown as enabled and locked.
8. WhatsApp section does not fake a connected state.
9. Import rules clearly state that uploads require review/confirmation before save.
10. No existing pages break: dashboard, ledger, revenue sync, bills, subscriptions, integrations.
11. No new global Firestore collection is introduced.
12. No formatted currency string is stored in Firestore.
13. Browser console has no red errors.
14. Mobile layout works at 375px.
15. Desktop layout works at 1280px.

---

## 14. Manual QA Checklist

Run these checks after implementation:

### Auth and routing

- Open `/settings` while logged out. It should redirect to `/login`.
- Log in and open `/settings`. It should load.
- Click Settings in sidebar. It should navigate to `/settings`.
- Active sidebar style should show orange text/icon.

### Page rendering

- Business Profile section renders.
- Currency & Locale section renders.
- Categories section renders.
- AI Preferences section renders.
- WhatsApp section renders.
- Import Rules section renders.
- Account section renders.

### Data safety

- If saving is implemented, verify Firestore writes under `users/{uid}/settings` only.
- Verify no global collection is created.
- Verify no secrets/tokens are printed to console.
- Verify locked fields cannot be edited.

### Regression

- Dashboard still loads.
- Ledger still loads.
- Add Transaction still works.
- Bills still load.
- Subscriptions still load.
- Integrations still load.
- Fluxy AI sidebar/drawer still opens.
- Disabled future entries still do not navigate.

---

## 15. Final Report Format for Codex

After implementation, return this report:

```md
# Settings MVP Implementation Report

## Summary
- What was built
- What files changed

## Product Logic
- Why Settings is now active
- What remains intentionally locked

## Data Model
- Firestore paths used
- Fields added or read

## Security
- Auth guard status
- User-scoped data confirmation
- Sensitive actions avoided

## QA Results
- Auth/routing
- Sidebar
- Settings page
- Regression pages
- Console status
- Mobile/desktop status

## Known Limitations
- What is still placeholder/read-only
- What should be built next
```

---

## 16. Next Product Step After Settings

After Settings MVP, build **Inbox / Review**.

This is the missing operational layer for Fluxy AI and document upload. It should become the place where uploaded bills, receipts, CSVs, WhatsApp files, and AI-extracted drafts wait for user confirmation.

Do not build Vendor Spend, Budgets, Approvals, or Audit Log before Inbox / Review unless there is strong user evidence that those are more urgent.
