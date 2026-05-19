# FluxyOS Entry Point & Settings Plan

## 0. Purpose

This document defines the product and implementation plan for FluxyOS
dashboard entry points, with focus on **Settings** as a Stripe-inspired
admin control area — an index page that helps users find the right setting,
plus focused detail pages that help them safely edit one thing at a time.

Goal: Settings should not behave like one long form. Settings should behave
like an admin area. First screen helps you find the right setting. Detail
screens help you edit one focused setting area. Advanced or rarely used
settings live one level deeper, not all on one screen.

Early-stage product principle: keep the product focused around the core
user loop instead of exposing too many future modules at once.

---

## 1. Strategic Diagnosis

The previous Settings page exposed six forms at once. It was clean visually
but high cognitive load: users had to scan everything to find anything.

The new architecture moves to:

- **Settings index**: one search box, three grouped tile sections
  (Personal, Workspace, Product), each entry a single-line title +
  description with an icon tile.
- **Detail pages**: one focused purpose per page. Forms use a narrow
  content column (`max-w-3xl`), explicit Save/Cancel, status pill, and
  toast feedback. No KPI summary cards.
- **Tabs only where useful**: only `settings-business` uses horizontal
  tabs (Account details + Business details) because the `settings/company`
  doc has two meaningfully distinct sub-sections.
- **Planned tiles, not fake pages**: features without a backend
  (Communication preferences, Data export, Billing) appear as disabled
  tiles with a `Planned` pill on the index, never as broken detail pages.

This preserves the existing Firestore schema and `DataService` API while
reshaping the user experience.

---

## 2. Information Architecture

### Index (`/settings` → `settings.html`)

Search bar + three group sections:

**Personal settings**
- Personal details → `/settings-personal` (live, mostly read-only)
- Communication preferences → disabled tile (Planned)

**Workspace settings**
- Business → `/settings-business` (live, tabs)
- Team and security → `/settings-security` (live, read-only)
- Finance preferences → `/settings-finance` (live)
- Categories and import rules → `/settings-import-rules` (live)
- AI preferences → `/settings-ai` (live)
- WhatsApp connection → `/settings-whatsapp` (live)

**Product settings**
- Integrations → `/integration` (existing page)
- Data export → disabled tile (Planned)
- Billing & plan → disabled tile (Planned)

### Routing

Flat file naming, served by Netlify `pretty_urls`:

| File | URL |
|------|-----|
| `settings.html` | `/settings` |
| `settings-personal.html` | `/settings-personal` |
| `settings-business.html` | `/settings-business` |
| `settings-finance.html` | `/settings-finance` |
| `settings-import-rules.html` | `/settings-import-rules` |
| `settings-ai.html` | `/settings-ai` |
| `settings-whatsapp.html` | `/settings-whatsapp` |
| `settings-security.html` | `/settings-security` |

Sidebar active-state detection in `assets/js/sidebar-loader.js` keys on
`path.includes('settings')`, so the Settings nav item highlights on every
`/settings*` route without map changes.

---

## 3. Per-page contracts

### `/settings` (index)

- Search input (`#settings-search`) filters tiles client-side by
  matching title + description (`data-search` attribute).
- Empty state: a `<p>` reading "No settings found." shown when zero tiles
  visible.
- No save logic. Auth guard redirects to `/login` after 2s grace.

### `/settings-personal`

Read-only display of Firebase Auth profile (name, email, sign-in provider,
avatar). Password / Backup email / Contact phone shown as `Planned`
disabled buttons. Passkeys, 2FA, and Sessions sections rendered as
informational with `Planned` pills. **No "Close account" button** — that
requires a safe backend flow and audit logic that does not exist.

### `/settings-business`

Horizontal tabs:

- **Account details** (active): `business_name`, `entity_label`, `Account
  ID` (read-only Firebase UID). Writes to `settings/company`.
- **Business details**: `business_type`, `country`. Writes to
  `settings/company`.
- **Branding**: disabled tab (no MVP backing).
- **Documents**: disabled tab (no MVP backing).

Phone verification appears as an inline `Planned` panel inside Account
details. Account ID is shown as a read-only field for support reference;
it is the user's Firebase UID, not a sensitive value.

### `/settings-finance`

Form writes to `settings/finance`:

- Currency (`IDR`, locked input) + locale (`id-ID`, locked input).
- Timezone select (`Asia/Jakarta`, `Asia/Makassar`, `Asia/Jayapura`).
- Date format select (`DD MMM YYYY`, `DD/MM/YYYY`, `YYYY-MM-DD`).
- Helper note: amounts display as `Rp` with dot thousand-separators.

Categories are intentionally **not** edited here; they live on
`settings-import-rules` as a read-only chip list (MVP). The save payload
keeps the existing `categories` array so the Firestore schema validator
accepts the write.

### `/settings-import-rules`

- Default categories rendered as read-only chips (Revenue, Marketing,
  Infrastructure, Operations, SaaS).
- CSV date behavior select (`use_row_date` / `use_upload_date`).
- Four informational cards: Bills (`create_bill_draft`), Receipts
  (`create_ledger_draft`), Payment screenshots (`create_review_item`),
  Unknown documents (`ai_review`). These are **policy disclosures**, not
  editable controls.
- Locked-on checkbox: `require_confirmation_before_save`.

### `/settings-ai`

- Answer style select (`concise` / `practical` / `detailed`).
- Default analysis period select (`current_month` / `last_month` /
  `last_90_days`).
- Toggles: `show_data_quality_warnings`, `allow_ai_suggestions`,
  `allow_ai_draft_actions`.
- Locked-on toggle: `require_confirmation_before_save`.
- Visible AI safety rules panel — no auto-save, no marking bills paid,
  no inventing numbers, drafts require explicit confirmation.

### `/settings-whatsapp`

- Status panel reflects saved `status` (Not connected / Pending /
  Connected) with a colored dot. Never shows a fake "Connected" state.
- Editable: `phone_number`, `business_display_name`.
- Read-only: `status`, `last_sync_at`, `last_verified_at` (configuration
  metadata only).
- Architecture explanation panel — WhatsApp Cloud API webhook → FluxyOS
  FastAPI → user mapping → confirmation → Firestore. API tokens stay
  server-side.

### `/settings-security`

Read-only posture summary:

- Current role: Account Owner
- Data scope: User scoped
- AI writes: Confirmation required
- Sign-in security: Managed by Firebase Auth

Team roles and Audit log shown as inline `Planned` panels. No multi-user
permissions, no role editing, no fake invite flow.

---

## 4. Data contract

All settings stay under `users/{userId}/settings/{docName}`.

| Doc | Editing pages |
|-----|---------------|
| `company` | `settings-business` (both tabs write to this doc) |
| `finance` | `settings-finance` |
| `import_rules` | `settings-import-rules` |
| `ai` | `settings-ai` |
| `whatsapp` | `settings-whatsapp` |

`settings-personal` and `settings-security` are display-only; they do not
write to Firestore. `settings.html` (index) is search-only and does not
read or write Firestore settings docs.

`DataService` methods reused as-is from `assets/js/db-service.js`:
`getUserSettings`, `getWhatsAppSettings`, `saveCompanySettings`,
`saveFinanceSettings`, `saveImportRules`, `saveAISettings`,
`saveWhatsAppSettings`.

Firestore rules in `firestore.rules` already validate each doc's schema
and reject deletes. No rules changes required for this IA reshape.

---

## 5. Visual & brand discipline

- App-shell background: `bg-gray-50`. Card backgrounds: `bg-white`.
- Orange `#EA580C` is **accent only**: Fluxy AI badge, active sidebar
  icon, active tab underline, focus ring, breadcrumb link, "Planned" pill
  border. Never as a background.
- Headings: `text-gray-900`. Body: `text-gray-500` / `text-gray-700`.
- No purple, no decorative gradients, no orange backgrounds.
- Detail page content is `max-w-3xl mx-auto` — focused, not full-bleed.
- Tabs (Business page only): `border-b border-gray-200`, active tab
  underline `border-b-2 border-[#EA580C]`.

---

## 6. Security stance

What this PR explicitly does **not** do:

- No password / backup email / contact phone backend (Personal: Planned).
- No passkey enrollment, FluxyOS-managed 2FA, or session management.
- No "Close account" / data reset / dangerous irreversible actions.
- No team roles, multi-user permissions, workspace migration.
- No WhatsApp Cloud API tokens, OTPs, or webhook secrets stored
  client-side. Status fields are configuration metadata only.
- No Communication preferences / Data export / Billing detail pages.

Auth guards on every detail page redirect to `/login` after a 2s grace.
Each save call uses `auth.currentUser.uid` and writes only the user's own
settings doc.

---

## 7. Out of scope

- Data model changes (existing schema is sufficient).
- DataService API changes (existing methods cover everything).
- Firestore rules changes.
- Sidebar-loader changes (active state already keys on `settings`).
- Changes to ledger, bills, subscriptions, revenue sync, or integration
  pages.
- Landing pages or the marketing footer.
- Removal of audit log writes — none exist for settings today; not
  required for MVP per security review.

---

## 8. Follow-ups

- **JS duplication**: each detail page inlines ~80 lines of auth/save
  boilerplate. If we add more detail pages, extract to
  `assets/js/settings-page.js`.
- **Communication preferences**: design an email/notification preferences
  data model + backend before promoting the tile to a real page.
- **Data export**: define accountant-ready export formats and a worker
  flow before promoting the tile.
- **Billing & plan**: needs a payment provider integration plan first.
- **Search ergonomics**: pure substring match across title + description.
  Acceptable for 11 tiles; consider fuzzy/synonym matching if the count
  grows past ~20.
