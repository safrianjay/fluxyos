# FluxyOS — AI Agent Working Rules

This file is read by Codex, Aider, and any tool that follows the AGENTS.md
convention. Claude Code reads `CLAUDE.md` (same rules). The full workflow
diagram lives in `docs/WORKFLOW.md`.

## QA Enforcement — Git-Gated (Cross-Agent)

A `pre-push` git hook at `.githooks/pre-push` BLOCKS any push to `main`/`master`
unless the environment contains `QA_PASS=1`. This fires regardless of which
agent or human typed `git push` — it runs at the git layer.

### Pushing to main

```bash
QA_PASS=1 git push origin main
```

Without the prefix the push exits 1 and the gate's checklist is printed.

### What `QA_PASS=1` claims

Setting the variable is an explicit assertion that you did all of these:

1. Every new file reference (CSS, JS, image) was `ls`'d locally — it EXISTS
2. The affected page was opened in a real browser
3. Browser console had no CSP, CORS, 404, or Firebase errors
4. `docs/QA_CHECKLIST.md` sections matching the change type were read
5. `docs/PROJECT_BACKGROUND.md` was read for any Firestore / data change

Lying defeats the gate's purpose. There is no way for the hook to verify.

### Activating the hook on a fresh clone

`npm install` runs `git config core.hooksPath .githooks` via postinstall.
If you skip npm install, run it manually:

```bash
git config core.hooksPath .githooks
```

True-emergency bypass (do not use casually): `git push --no-verify`.

---

## Project Background (Read Before Every Task)

Full architecture, database schema, field names, function signatures, and conventions are in:
**`docs/PROJECT_BACKGROUND.md`** — read this before implementing any new feature, page, or logic.

Key things it covers that prevent mistakes:
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

- **Navigation & Footer**: All landing pages MUST use the universal header/navbar from `fluxyos.html` and load footer via `footer-loader.js`. Never create custom header markup — copy nav structure from fluxyos.html and maintain consistency across all pages.
- Footer loads on all **landing pages** only — never on dashboard app pages (`dashboard.html`, `bill.html`, `subscription.html`)
- Amount formatting: Indonesian Rupiah with `.` as thousands separator (e.g. `1.234.567`)
- Amount stored in Firestore as raw integer (dots stripped before save)
- Brand colors: Orange `#EA580C` (accent only: text, icons, borders, gradients), Dark Navy `#0B0F19` (footer/login bg), Purple glow for canvas animation
  - **DESIGN RULE: Orange backgrounds are PROHIBITED project-wide.** Orange is reserved for accents, CTAs, and visual highlights only. Never use orange as a background color on any page (landing or app).
- **DESIGN RULE: Generic hero eyebrow labels are prohibited.** Do not add labels like "Finance ops, ledger, bills, and AI in one system" or "X, Y, and AI in one system" above a hero headline when the H1 already states the message.
- Currency display: All monetary amounts must use Rp (Indonesian Rupiah) format with dot separators. Never use $ or other currencies.
- Favicon: black F-logo SVG at `assets/images/favicon.svg`
- Git: commit on worktree branch → merge to `main` in `/Users/slumdogmacbookair/Desktop/fluxionos` → push origin main
