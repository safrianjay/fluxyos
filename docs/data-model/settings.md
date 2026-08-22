---
status: current
owns: [settings]
updated: 2026-08-07
source: docs/PROJECT_BACKGROUND.md §4 (sharded 2026-08-07)
---

# Settings

> Workspace-scoping rules for these collections live in
> [`PROJECT_BACKGROUND.md` §4](../PROJECT_BACKGROUND.md#4-firestore-database-schema).
> Read that first — it is always loaded; this shard is not.

### 4e. Settings — `users/{userId}/settings/{settingsDoc}`

Settings are user-scoped workspace preferences. They must never store secrets,
tokens, OTPs, card data, bank credentials, or formatted currency strings.

| Document | Fields |
|----------|--------|
| `company` | `business_name`, `business_type`, `country`, `entity_label`, `updated_at` |
| `finance` | `currency`, `locale` — **read-only mirrors** of `workspaces/{id}.base_currency` and its locale, never a second source of truth. `settings` is user-scoped, so a member's own copy must never be what the UI trusts; read `window.FluxyMoney.baseCurrency()` instead. Both are surfaced read-only in `settings-finance.html` with the support route for changes. Also: `timezone`, `date_format`, `categories`, `updated_at` |
| `import_rules` | `csv_date_behavior`, `unknown_document_route`, `bill_scan_behavior`, `receipt_scan_behavior`, `payment_screenshot_behavior`, `require_confirmation_before_save`, `updated_at` |
| `ai` | `answer_style`, `default_analysis_period`, `show_data_quality_warnings`, `allow_ai_suggestions`, `allow_ai_draft_actions`, `require_confirmation_before_save`, `updated_at` |
| `whatsapp` | `status`, `phone_number`, `business_display_name`, `last_sync_at`, `last_verified_at`, `provider`, `updated_at` |
| `reports` | `arr_source` (`"none"` or `"tagged_income_categories"`), `recurring_revenue_category_ids` (string[] up to 32), `updated_at`. Drives Estimated ARR in Reports & Exports; without tagged categories ARR stays `unavailable`. |
| `email_preferences` | `weekly_digest_enabled` (bool, default true), `language` (**Email Language**, optional `"id"` \| `"en"` — applies to ALL system-generated emails: digest, billing/payment/trial reminders, KYC, welcome; absent = follow `finance.locale`, then `DEFAULT_LOCALE`; resolution seam is `functions/lib/locale.js` `resolveUserLocale`), `delivery_day` (`monday`…`sunday`, default `monday`), `delivery_hour` (int 0–23, default 9), `timezone` (string, user-local with `Asia/Jakarta` fallback), `metrics` (map of 8 bools: `financial_health`, `cash_position`, `bills`, `budgets`, `revenue`, `expenses`, `subscriptions`, `vendors`), `updated_at`. Drives the **Weekly Financial Digest** (`netlify/functions/weekly-digest.js`). AI Insights + Recommended Actions are always-on and not stored as toggles. A missing doc is treated as enabled-with-defaults. |

**Mutation rule:** owner read/create/update only through `DataService`; delete is
blocked. WhatsApp status is configuration metadata only. Real WhatsApp API
tokens must not be stored in Firestore.

**UI surface:** Settings expose this schema through an index page
(`settings.html`) and 9 focused detail pages: `settings-personal.html`,
`settings-business.html`, `settings-finance.html`, `settings-import-rules.html`,
`settings-ai.html`, `settings-whatsapp.html`, `settings-security.html`,
`settings-cash.html` (Cash & Bank Accounts), and `settings-budget.html`
(Budget Settings). Each detail page reads its slice via
`DataService.getUserSettings(uid)` and saves through the matching
`save*Settings` method (or, for the Finance Setup pages, the bank/budget
DataService methods documented in §4e.1–4e.3). `settings-personal.html` and
`settings-security.html` are display-only (Firebase Auth profile + posture
summary); they do not write to Firestore. `settings-notifications.html`
(Notifications & email) reads/writes `email_preferences` via
`DataService.saveEmailPreferences` and configures the Weekly Financial Digest.

**Weekly Financial Digest:** a per-user AI-narrated weekly summary email,
delivered by the Netlify scheduled function `weekly-digest.js` (hourly scan,
per-user delivery day/hour/timezone, ISO-week idempotency via `mail_log`). It
reuses the deterministic finance engine + AI narrator from
`netlify/functions/api.js` (`exports.digest`) — every number is computed there,
OpenAI only narrates — and the shared email pipeline. Audit actions
`weekly_digest.generated` / `.sent` / `.failed` are written server-side. Gated
by a default-off `DIGEST_ENABLED` env. Spec: `netlify/functions/NOTIFICATIONS.md`.
