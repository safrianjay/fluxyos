# FluxyOS — AI Agent Working Rules

This file is read by Codex, Aider, and any tool that follows the AGENTS.md
convention. Claude Code reads `CLAUDE.md` (same rules). The full workflow
diagram lives in `docs/WORKFLOW.md`.

## What FluxyOS Is (canonical — use verbatim)

**FluxyOS is an Intelligent Finance Operating System that connects financial
operations, accounting, business operations, enterprise workflows, and
intelligence into one continuously connected system.**

It serves businesses across their growth journey — small, growing, medium,
enterprise, and eventually public/IPO-stage. **Indonesia is the home market and
operating context, not the product ceiling**; Indonesian SMBs are the current
beachhead and remain an important segment.

It is more than bookkeeping, accounting, financial reporting, ERP, a dashboard,
or an AI chatbot. It may include those; none of them defines it.

⚠️ **The vision is not the product.** Multi-entity, inventory, POS, purchasing,
approvals, enterprise permissions and IPO-grade controls are **not built**.
`docs/PRODUCT_STRATEGY.md` §3 is the audited truth — never write copy or docs
implying otherwise. `npm run check:structure` fails the build if the canonical
positioning drifts or a retired category string reappears.

**Proposing a new module?** Read `docs/PRODUCT_STRATEGY.md` first: §1 (canonical
positioning), §3 (audited status), §5 (admission test — does it create, move,
protect, predict, or explain financial performance?), §5a (connection test), §6
(the ledger is the product; no module keeps its own books).

---

## QA Enforcement — Git-Gated (Cross-Agent)

A `pre-push` git hook at `.githooks/pre-push` BLOCKS any push to `main`/`master`
unless the environment contains `QA_PASS=1`. This fires regardless of which
agent or human typed `git push` — it runs at the git layer.

### Pushing to main

```bash
QA_PASS=1 git push origin main
```

Without the prefix the push exits 1 and the gate's checklist is printed.

### `QA_PASS=1` is no longer an honour-system claim

Run the QA suite; it writes an artifact the gate verifies:

```bash
git commit …          # commit first — QA stamps the artifact with HEAD
npm run qa            # BE + FE + PRODUCT lanes, selected from the diff
QA_PASS=1 git push origin main
```

`npm run qa` (`scripts/qa-run.js`) writes `.qa/qa-run.json`. Claude Code's
PreToolUse hook additionally requires that artifact to show a **passing,
non-partial** run whose `head` equals the commit being pushed — so `QA_PASS=1`
alone does not pass there. The `.githooks/pre-push` hook in this repo still only
checks the variable, which means for Codex/Aider the discipline is yours: run
`npm run qa` and confirm it passed before setting it.

`--skip-browser` and `--lane=…` mark the artifact `partial`, which the Claude
gate rejects. They are for fast iteration, not for shipping.

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
- Firebase Auth + Firestore (finance collections are **workspace-scoped** via the
  `_scope()` seam; identity/billing stays user-scoped — `PROJECT_BACKGROUND.md` §4)
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
- For AI Overview eligibility: use the "**Product** is a [category] that [does X]" pattern in the first paragraph. The category is **"Intelligent Finance Operating System"**; the retired strings ("finance operations platform", "Finance Operations System") must not reappear. Add real FAQ sections (visible on page) backed by `FAQPage` schema.
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
  3rd-party brands). The **category** is the exception: "Intelligent Finance
  Operating System" renders as **"Sistem Operasi Keuangan Cerdas"**, English in
  parentheses on first mention per page.
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
