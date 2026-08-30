# FluxyOS — Claude Working Rules

## Development Workflow (read first)

**`docs/DEVELOPMENT_WORKFLOW.md` is the lifecycle every change follows.** Two
facts drive it:

1. **Commits are free; pushes cost.** One push builds TWO Netlify sites. August
   2026 spent 306 of 300 build minutes on ~30 single-commit pushes. Commit
   freely, then **push once per finished piece of work** — `npm run ship` reports
   the batch, the build count, and the live quota before you decide.
2. **The failure mode here is a plausible wrong number, not a crash.** Run
   `npm run classify` (also printed in the QA banner) — the change level is
   COMPUTED from the diff, never declared. **L3+ forces every QA lane.** At
   **L4** (money, tax, billing, rules, auth) verify in a **non-IDR workspace**:
   IDR is both the right answer and the fallback, so a currency bug is invisible
   on an Indonesian account.

## QA Enforcement — Hook-Gated

A PreToolUse hook at `.claude/hooks/qa-gate.sh` enforces the workflow at the
harness level:

- **Pushes to `main`/`master` are BLOCKED** unless BOTH hold: the command
  contains `QA_PASS=1`, **and** `.qa/qa-run.json` shows a passing, non-partial
  run whose `head` equals the commit being pushed. `QA_PASS=1` on its own no
  longer works — it must be backed by an actual run.
- **The workspace-scoping invariant hard-blocks even with `QA_PASS=1`**, across
  every workspace-scoped collection in `docs/PROJECT_BACKGROUND.md` §4.
- Edits to `firestore.rules`, `storage.rules`, the dashboard HTML pages, and
  `netlify.toml` print a soft reminder pointing to the docs that matter for
  that change type.

### The workflow

```
git commit …          # commit first — QA stamps the artifact with HEAD
npm run qa            # BE + FE + PRODUCT lanes, selected from the diff
QA_PASS=1 git push origin main
```

`npm run qa` (`scripts/qa-run.js`) runs three lanes and writes
`.qa/qa-run.json` (gitignored):

| Lane | Checks |
|---|---|
| **BE** | `node --check` on changed JS; workspace-scoping invariant; **`check:structure` (structural drift), `check:deploy-stamp` (Firebase deploy preconditions, measuring the comment-stripped size that actually deploys) and `check:feature-category` — all always run**; `check:deploy` / `check:ai-scope` / `check:bank-scope` / `check:ledger-assert` when their inputs change; Firestore rules emulator tests when `*.rules` change |
| **FE** | `scripts/qa/lint-design.js` (design-system rules, **changed lines only**); `tests/zz-console-sweep.spec.js` — loads affected pages in a real browser and fails on CSP/CORS/permission-denied/uncaught errors and same-origin 404s |
| **PRODUCT** | i18n EN↔ID pairing where an `/id/` mirror exists; SEO essentials on changed landing pages; `seo:check-org` (Organization entity in sync — catches running the two SEO generators in the wrong order); `i18n-audit.js` (advisory) |

Flags: `--all` (force every lane), `--lane=be|fe|product`, `--skip-browser`.
The last two mark the artifact `partial`, which **the gate rejects** — they are
for fast iteration, not for shipping.

`check:structure` (`tests/structure-drift.check.js`) is the exception to lane
selection — it runs on **every** invocation, because the file that drifts is
rarely the file you just edited. It verifies claims the repo makes about itself
in more than one place: the three finance-collection registries agreeing, every
workspace collection in `firestore.rules` being registered somewhere, prose
account counts matching `CHART_OF_ACCOUNTS_SEED`, the `docs/data-model/` shard
index matching disk, every seeded asset/liability `sak_category` being explicitly
classified in `statements-engine.js`, and the **canonical positioning** holding
across its six sources (category present, retired strings absent, no SMB-ceiling
phrasing). All seven failure modes are silent at runtime — see
`docs/ERP_ARCHITECTURE_REVIEW.md` §3.5.

`check:deploy-stamp` is the other unconditional check. **`firestore.rules`,
`firestore.indexes.json` and `storage.rules` do not ship with `git push`** — each
is a separate `firebase deploy --only …` command. Code that depends on an
undeployed one does not degrade gracefully: Firestore batch writes are atomic, so
a missing rules block fails *every* posting, not just the new feature. That
nearly shipped on 2026-08-16 with full QA green.

The workflow when you touch one of those three files:

```
npm run rules:deploy                     # 1. deploy (strips comments, then deploys)
                                         # 2. VERIFY — run a spec that exercises
                                         #    the new path; "published" in the
                                         #    console is not the same claim
npm run deploy:stamp                     # 3. record what is now live
git add deploy/deployed-stamps.json      # 4. commit the stamp with the change
```

**Use `npm run rules:deploy`, not a bare `firebase deploy --only firestore:rules`.**
`firestore.rules` is uploaded as source text and the release endpoint refuses it
somewhere near 218,000 bytes — **22.7% of the file is comments**, which are
load-bearing here (they record the production incidents behind each validator).
So they are stripped at deploy time and the repo keeps the commented file:
211,631 → 164,340 bytes, 97% → 75% of ceiling, with **line numbers preserved
exactly** so a rules error at L2749 still points at line 2749 of the file you
read. `scripts/build-rules.js` asserts a line-by-line invariant before writing,
and parity was proven by running all 19 emulator specs (442 assertions) against
the built file with byte-identical verdicts. `npm run rules:test` re-runs that
proof. A bare `firebase deploy` still works today, it just wastes the headroom —
and will start failing once the commented file passes the ceiling.

Lane selection otherwise comes from the git diff, so an accounting-only change
does not pay for a landing-page SEO scan. Commits made *after* a QA run make the
artifact stale and the gate blocks — re-run QA on the commit you are pushing.

### What is still manual

The runner covers the mechanically checkable rules. It does **not** judge the
subjective anti-slop standards in `docs/DESIGN_SYSTEM.md` (one primary action
per zone, sections earning their space, hierarchy at 375px/1280px) or whether a
feature actually solves the user's problem. Read `docs/QA_CHECKLIST.md` sections
matching the change type, and `docs/PROJECT_BACKGROUND.md` when the data layer
is touched.

**A task is not done until QA passes. The hook will not let you forget.**

---

## Pre-Implementation: Read These Files Before Every Feature (MANDATORY)

Before implementing any feature, page, section, component, UI enhancement, business logic change, chart, table change, modal, AI behavior, or workflow — read these files first:

1. **`docs/PROJECT_BACKGROUND.md`** — architecture, database schema, field names, function signatures, and conventions
2. **`docs/DESIGN_SYSTEM.md`** — component reuse rules (shared date picker, dialog, drawer, chart hover), colors, typography, anti-AI-slop standards
3. **`docs/product_ux_feature_intake_framework.md`** — product logic, feature classification, scope, and UX requirements

**What FluxyOS is (canonical, use verbatim):** an **Intelligent Finance
Operating System** that connects financial operations, accounting, business
operations, enterprise workflows, and intelligence into one continuously
connected system. It serves businesses across their growth journey — small,
growing, medium, enterprise, and eventually public/IPO-stage. Indonesia is the
home market and operating context, **not** the product ceiling; Indonesian SMBs
are the current beachhead and remain an important segment.

⚠️ **The vision is not the product.** Multi-entity, inventory, POS, approvals,
enterprise permissions and IPO-grade controls are **not built**. Never write copy
or docs that imply otherwise — `PRODUCT_STRATEGY.md` §3 is the audited truth and
`npm run check:structure` fails the build if positioning drifts.

**Proposing a whole new module** (not a feature inside an existing one)? Read
**`docs/PRODUCT_STRATEGY.md`** first:

- **§1 holds the canonical category and definition sentence.** Every other
  surface restates it rather than inventing its own.
- **§3 is the audited status baseline.** FluxyOS is five layers, and Layers 1–2
  are substantially shipped — the accounting kernel (GL, journals, CoA, trial
  balance, income statement, balance sheet, cash flow, period close, aging, tax)
  is **live, not planned**. Never describe a shipped capability as future work;
  never rebuild one that exists.
- **§5 is the admission test:** does this *create, move, protect, predict, or
  explain* financial performance? Modules failing all five verbs are out of
  scope regardless of demand.
- **§5a is the connection test:** name the operational problem, the financial
  data generated, the accounting records affected, the dependent modules, the
  insight produced, and the AI action enabled. A module that cannot name its
  posting rule is building a parallel set of books.
- **§6 is architecturally binding:** the ledger is the product; everything else
  is a source system or a view. Modules that create or move value post to the
  kernel; modules that predict or explain read derived balances. No module keeps
  its own books.

Evolve the existing product — preserve current schemas, modules, and decisions
unless they conflict with that document.

This is enforced by `.claude/hooks/docs-read-gate.sh`, which is **selective** —
it asks only for what the file being edited actually needs:

| Editing | Must have Read |
|---|---|
| anything (non-doc code) | `docs/PROJECT_BACKGROUND.md` |
| `*.html`, `*.css`, `assets/js/*` | + `docs/DESIGN_SYSTEM.md` |
| a file whose name maps to a collection domain | + `docs/data-model/<shard>.md` |

So a Netlify function change no longer pays for the whole design system, and a
CSS tweak no longer pays for the entire Firestore schema. Exempt paths: anything
under `docs/`, `.claude/`, `.qa/`, `.githooks/`, `cbm-extracted/`, and any `*.md`.

**Collection schemas live in `docs/data-model/`**, not in `PROJECT_BACKGROUND.md`
(sharded 2026-08-07: 2,490 → 854 lines). `PROJECT_BACKGROUND.md` §4 keeps the
workspace-scoping invariant — which applies to every shard — plus the shard
index. Read the one shard your change touches.

If the feature request cannot answer the framework's core questions (user problem, business value, job to be done, scope), it is not ready to build.

Key things docs/PROJECT_BACKGROUND.md covers that prevent mistakes:
- Exact Firestore field names (`vendor_name` not `vendor`, `type` is lowercase `"revenue"`/`"expense"`)
- Amount must be stored as raw integer — never formatted string
- Exact function signatures for `showAddTransactionModal`, `showToast`, `renderEmptyState`
- Which HTML element IDs JS depends on (never rename these)
- Features that already exist as stubs (search, export, edit/delete) — don't rebuild from scratch
- Git workflow for merging worktree to main and pushing

### Codebase knowledge graph (locate code before you grep)

The repo is indexed into `codebase-memory-mcp` under the project name
**`Users-jay-Desktop-fluxyos`**. For any feature or improvement, use it to find
code and callers before broad Grep/Glob sweeps:

- `search_graph` — locate a function/page by keyword
- `trace_path` / `query_graph` — callers, dependencies, impact analysis
- `get_architecture` — structure overview

`.claude/hooks/cbm-feature-gate.sh` (UserPromptSubmit) injects this reminder
when a prompt reads as build/change work, EN or ID. It is **non-blocking** —
unlike `qa-gate.sh` and `docs-read-gate.sh`, it only adds context. It also does
not replace the doc reads above, which stay hard-gated.

Re-index after large changes: `npm run cbm:sync` (extract inline JS, then index).

Two pieces of setup are load-bearing and easy to break:

1. **`.cbmignore`** re-includes `assets/` and `scripts/`, which the indexer
   excludes by default. Without it the graph misses `assets/js/*` — the entire
   client app. Deleting it silently halves the graph.
2. **`cbm-extracted/`** is a generated, line-aligned mirror of the ~9k lines of
   inline `<script>` JS in the root pages (`npm run cbm:extract`). The indexer
   does not parse JS inside HTML, so without it `ledger.html` contributes 2
   graph nodes and zero functions; with it, 281. Line N of
   `cbm-extracted/x.inline.js` **is** line N of `x.html`, so graph hits map back
   directly.

   ⚠️ The ignore for `cbm-extracted/` lives in `.git/info/exclude`, **not**
   `.gitignore`. codebase-memory-mcp honours `.gitignore`, so moving it there
   drops the directory from the graph (6470 nodes → 5540). `npm run cbm:extract`
   re-asserts the exclude entry on every run, including on fresh clones.

Inline JS is only as fresh as the last extract — `npm run cbm:check` reports
staleness. Prefer `npm run cbm:sync` after substantial page edits.

### Browser control (chrome-devtools MCP)

`.mcp.json` registers `chrome-devtools-mcp` **project-scoped** (not global) for
interactive debugging: driving a live page, reading the console and network
panel, and taking screenshots to check the DESIGN_SYSTEM rules a static linter
cannot judge. It runs `--isolated` (throwaway profile) at a 1280x720 viewport.

This is for *investigation*. Automated console/404 verification is `npm run qa`'s
FE lane, which is the thing the push gate actually checks.

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
- For AI Overview eligibility: use the "**Product** is a [category] that [does X]" pattern in the first paragraph. The category is **"Intelligent Finance Operating System"** — `PRODUCT_STRATEGY.md` §1 holds the exact sentence, and the retired strings ("finance operations platform", "Finance Operations System") must not reappear. Add real FAQ sections (visible on page) backed by `FAQPage` schema.
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
  3rd-party brands). The **category** is the exception: "Intelligent Finance
  Operating System" renders in Bahasa as **"Sistem Operasi Keuangan Cerdas"**,
  with the English in parentheses on first mention per page
  (`LOCALIZATION_PLAN.md` §2).
- **Pair edits.** Any change to user-facing copy in an EN page must include the
  matching update to its `/id/` counterpart in the same commit. Don't ship
  English-only copy changes.
- New product term not in the glossary? Add it to docs/LOCALIZATION_PLAN.md §2
  before translating, so future copy stays consistent.

## Key Conventions

- **Multi-market (currency, locale, tax, billing)**: `docs/MULTI_MARKET_ARCHITECTURE.md`
  is required reading before touching money rendering/parsing, number or date
  formatting, tax labels, or FluxyOS's own pricing. The recurring failure mode is
  **silent**: a wrong amount is stored or displayed with no error, because IDR is
  both the correct answer and the fallback. `npm run check:money-seam` (16 guards)
  and `npm run check:price-book` enforce the mechanical parts.
- **Workspace data scoping (MANDATORY)**: Finance/operational collections
  (`transactions`, `bills`, `subscriptions`, `budgets`, `budget_allocations`,
  `invoices`, `audit_logs`, `bank_accounts`, `bank_balance_snapshots`,
  `bank_statement_imports`, `documents`, `report_exports`, `accounting_mappings`,
  `chart_of_accounts`, `business_categories`, `journals`, `counters`,
  `ledger_balances`, `periods`, plus the Tax Center and Commerce collections —
  full list in `docs/PROJECT_BACKGROUND.md` §4)
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
