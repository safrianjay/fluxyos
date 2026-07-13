# FluxyOS — Claude Working Rules

## QA Enforcement — Hook-Gated

A PreToolUse hook at `.claude/hooks/qa-gate.sh` enforces the workflow at the
harness level:

- **Pushes to `main`/`master` are BLOCKED** unless the command contains
  `QA_PASS=1`. To bypass the gate, prove QA was done and re-run as
  `QA_PASS=1 git ... push origin main`.
- Edits to `firestore.rules`, `storage.rules`, the dashboard HTML pages, and
  `netlify.toml` print a soft reminder pointing to the docs that matter for
  that change type.

This means text-only rules ("MANDATORY") below are now backed by a real gate.
If you ignore the workflow, the push will fail.

### Before adding `QA_PASS=1`, verify:

1. Every new file reference (CSS, JS, image) actually EXISTS — `ls` it.
2. Smoke-tested the affected page in a real browser.
3. Browser console is clean (no CSP, CORS, 404, or Firebase errors).
4. Read `docs/QA_CHECKLIST.md` sections matching the change type.
5. Read `docs/PROJECT_BACKGROUND.md` if data layer or Firestore was touched.

**A task is not done until QA passes. The hook will not let you forget.**

---

## Pre-Implementation: Read These Files Before Every Feature (MANDATORY)

Before implementing any feature, page, section, component, UI enhancement, business logic change, chart, table change, modal, AI behavior, or workflow — read these files first:

1. **`docs/PROJECT_BACKGROUND.md`** — architecture, database schema, field names, function signatures, and conventions
2. **`docs/DESIGN_SYSTEM.md`** — component reuse rules (shared date picker, dialog, drawer, chart hover), colors, typography, anti-AI-slop standards
3. **`docs/product_ux_feature_intake_framework.md`** — product logic, feature classification, scope, and UX requirements

This is enforced by `.claude/hooks/docs-read-gate.sh`: the first Edit/Write to
non-doc code is BLOCKED until both `PROJECT_BACKGROUND.md` and `DESIGN_SYSTEM.md`
have appeared in Read tool calls in the current session. Exempt paths: anything
under `docs/`, `.claude/`, `.qa/`, `.githooks/`, and any `*.md` file.

If the feature request cannot answer the framework's core questions (user problem, business value, job to be done, scope), it is not ready to build.

Key things docs/PROJECT_BACKGROUND.md covers that prevent mistakes:
- Exact Firestore field names (`vendor_name` not `vendor`, `type` is lowercase `"revenue"`/`"expense"`)
- Amount must be stored as raw integer — never formatted string
- Exact function signatures for `showAddTransactionModal`, `showToast`, `renderEmptyState`
- Which HTML element IDs JS depends on (never rename these)
- Features that already exist as stubs (search, export, edit/delete) — don't rebuild from scratch
- Git workflow for merging worktree to main and pushing

---

## Project Stack

- Static HTML + Tailwind CSS + Vanilla JS (no build step)
- Firebase Auth + Firestore (user-scoped collections)
- Netlify hosting (auto-deploys from `main` branch)
- Shared JS: `sidebar-loader.js`, `footer-loader.js`, `shared-dashboard.js`, `universe-canvas.js`
- Shared CSS: `shared-dashboard.css`, `footer.css`

## Two-Site Deploy Model (Stripe split)

Two Netlify sites build from this one repo, selected by a per-site `SITE_ROLE`
env var (Production context only; unset = full monolith — local dev, Playwright,
deploy previews, and rollback all rely on that no-op):

- **fluxyos.com** (`SITE_ROLE=marketing`) — landing pages only.
- **dashboard.fluxyos.com** (`SITE_ROLE=app`) — the logged-in app **including
  `/login`**. Never indexed (disallow-all robots + `X-Robots-Tag: noindex`).

Mechanics (all in `scripts/prepare-deploy.js`, run as the last build step):
- The script prunes the other role's pages and installs the role's `_redirects`
  from `deploy/_redirects.<role>`. `_redirects` rules run BEFORE `netlify.toml`
  rules; the toml keeps the untouched monolith rule set as the fallback.
- Cross-side links stay **relative** (`/login`, `/pricing`, …) — each site 301s
  the other role's paths to the right origin. Don't hardcode the other origin in
  hrefs.
- **Every new root `*.html` MUST be classified** in `MARKETING_PAGES` or
  `APP_PAGES` in `scripts/prepare-deploy.js` — both site builds fail on an
  unclassified page (intentional guard).
- Firebase `authDomain` stays `"fluxyos.com"`; the `/__/auth/*` proxy on the
  apex serves the dashboard origin's login popup iframe (that's why the CSP
  `frame-src` includes `https://fluxyos.com`). Function CORS allowlists and
  `cors.json` must list `https://dashboard.fluxyos.com`.
- Scheduled notification functions are pruned from the marketing deploy;
  `NOTIFY_ENABLED`/`DIGEST_ENABLED` etc. may only ever be enabled on the app
  site. Email links use env `APP_BASE_URL=https://dashboard.fluxyos.com`.
- After touching the split (page lists, `deploy/_redirects.*`,
  `prepare-deploy.js`), run `node tests/prepare-deploy.check.js`.

## SEO & AI Overview Optimization

Full SEO strategy lives in **`docs/SEO_STRATEGY.md`** — read before adding new
landing pages or changing meta/title/heading content.

Quick rules:
- Every new page MUST ship with: unique `<title>` (≤60 chars), `<meta name="description">` (≤160 chars), canonical URL, Open Graph + Twitter Card tags, and branded 1200×630 OG image.
- Every page MUST include relevant Schema.org JSON-LD: at minimum `Organization` + `SoftwareApplication` (or `Product` for pricing). Feature pages should also have `FAQPage` and `BreadcrumbList`.
- Validate schema via [Google Rich Results Test](https://search.google.com/test/rich-results) before pushing — broken JSON-LD silently disqualifies the page from AI Overview.
- **Lighthouse SEO score ≥95 is a deploy gate** for every landing page.
- Add new URLs to `sitemap.xml` and update `lastmod` when content materially changes.
- For AI Overview eligibility: use the "**Product** is a [category] that [does X]" pattern in the first paragraph. Add real FAQ sections (visible on page) backed by `FAQPage` schema.
- Tailwind CDN is **not** allowed in production (kills LCP). Use the built CSS at `assets/css/tailwind.min.css`.

## Localization (Bahasa Indonesia)

Full localization strategy lives in **`docs/LOCALIZATION_PLAN.md`** — read before
making any user-facing copy change.

Quick rules:
- **The dashboard app is Bahasa-first**: Indonesian is the default language
  (`assets/js/dashboard-i18n.js`, ~3,300-key dictionary + PATTERNS); English is
  the opt-out via Settings → Language. Run `node scripts/i18n-audit.js` after
  any app-page copy change — it writes `.qa/i18n-gap-report.md` and must stay at
  (near-)zero English gaps. EN Playwright specs stay green because
  `tests/setup-auth.spec.js` pins `fluxyos-lang='en'` into the shared
  storageState; ID smoke lives in `tests/dashboard-i18n.spec.js`.
- Indonesian translations live at `/id/*.html` (mirror of root structure).
- Tone is **casual professional** for SMB owners — pronoun "Anda", short sentences,
  active verbs, no bureaucratic language. See docs/LOCALIZATION_PLAN.md §2 for the
  glossary and sample translations.
- **Brand & product names stay English** everywhere (FluxyOS, Fluxy AI, Revenue
  Sync, Vendor Spend, Receipt Capture, Dynamic Budgeting, AI Agents, plus all
  3rd-party brands).
- **Pair edits.** Any change to user-facing copy in an EN page must include the
  matching update to its `/id/` counterpart in the same commit. Don't ship
  English-only copy changes.
- New product term not in the glossary? Add it to docs/LOCALIZATION_PLAN.md §2
  before translating, so future copy stays consistent.

## Key Conventions

- **Workspace data scoping (MANDATORY)**: Finance/operational collections
  (`transactions`, `bills`, `subscriptions`, `budgets`, `budget_allocations`,
  `invoices`, `audit_logs`, `bank_accounts`, `bank_balance_snapshots`,
  `bank_statement_imports`, `documents`, `report_exports`, `accounting_mappings`)
  are **workspace-scoped** and shared across team members. **NEVER hardcode
  `users/${userId}/<financeCollection>`** — always route through the seam:
  `${this._scope(userId)}/…` in `db-service.js`, or `${ds._scope(userId)}/…` for
  an inline page query. Pages must resolve the workspace before the first finance
  read (centralized in `applyToPage()`). Identity/billing collections
  (`onboarding`, `platform_learning`, `settings`, `ai_chats`, `billing*`,
  `usage_limits`, `payment_verifications`, `receipts`, `internal_users`) stay
  user-scoped. Hardcoding `users/` for finance silently shows invited members
  **0 data** while owners look fine. Full rule + grep guard in
  `docs/PROJECT_BACKGROUND.md` §4. Background: `docs/TEAM_MANAGEMENT_HANDOFF.md`.
- **Navigation & Footer**: All landing pages MUST use the universal header/navbar from `fluxyos.html` and load footer via `footer-loader.js`. Never create custom header markup — copy nav structure from fluxyos.html and maintain consistency across all pages.
- Footer loads on all **landing pages** only — never on dashboard app pages (`dashboard.html`, `bill.html`, `subscription.html`)
- Amount formatting: Indonesian Rupiah with `.` as thousands separator, displayed with **no space after `Rp`** (e.g. `Rp1.234.567`, never `Rp 1.234.567`)
- Amount stored in Firestore as raw integer (dots stripped before save)
- Brand colors: Orange `#EA580C` (accent only: text, icons, borders, gradients), Dark Navy `#0B0F19` (footer/login bg), Purple glow for canvas animation
  - **DESIGN RULE: Orange backgrounds are PROHIBITED project-wide.** Orange is reserved for accents, CTAs, and visual highlights only. Never use orange as a background color on any page (landing or app).
- **DESIGN RULE: Generic hero eyebrow labels are prohibited.** Do not add labels like "Finance ops, ledger, bills, and AI in one system" or "X, Y, and AI in one system" above a hero headline when the H1 already states the message.
- Currency display: All monetary amounts must use Rp (Indonesian Rupiah) format with dot separators and **no space after `Rp`** (e.g. `Rp1.000`). Never use $ or other currencies.
- Numeric font (strict): amounts, KPIs, and all numbers render in `Inter` with `tabular-nums` (plain zero). **Never** use a monospace face (`Fira Code` / Tailwind `font-mono`) for numbers — it produces a slashed/dotted zero. Enforced in `assets/css/shared-dashboard.css`. See `docs/DESIGN_SYSTEM.md` → "Numeric & currency format (strict)".
- Favicon: black F-logo SVG at `assets/images/favicon.svg`
- Git: commit on worktree branch → merge to `main` in `/Users/slumdogmacbookair/Desktop/fluxionos` → push origin main
