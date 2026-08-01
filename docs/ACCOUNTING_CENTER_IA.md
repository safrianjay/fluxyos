# Accounting Center — Information Architecture

**Status:** Analysis complete, implementation phased and not yet started
**Date:** 2026-07-29
**Owner doc for:** `accounting.html` navigation, statement canonicalisation, and the
Accounting Center ↔ Reports & Exports boundary
**Supersedes the IA sections of:** `docs/ACCOUNTING_CONTROL_CENTER_PLAN_AND_CLAUDE_PROMPT.md`

---

## 1. Why this document exists

The Accounting Center grew feature-by-feature across the Phase 1 accounting roadmap
(`docs/ACCOUNTING_DISCOVERY_STRATEGY.md` §8). Each addition was individually correct
and individually shipped as its own tab. Eleven tabs later, the page has two
structural problems that no single feature owns:

1. **Duplicated statements.** The product computes an Income Statement three
   different ways and a Balance Sheet two different ways, from engines that do not
   share a computation and can disagree with each other.
2. **Unstructured navigation.** Eleven flat, equal-weight tabs mix reports, working
   papers, configuration, and workflow with no grouping, so the page communicates no
   mental model of how accounting actually flows.

The triggering question was narrower — *"is the Statements tab redundant?"* — but the
answer inverts on investigation, and the inversion is the point of this document.

---

## 2. Headline finding

> **The Statements tab is not redundant. It is the correct surface. The things
> around it duplicate it — including the tab that loads by default.**

`assets/js/statements-engine.js:4-9` states the situation in the source itself:

> Builds the Income Statement and Balance Sheet from Chart-of-Accounts-annotated
> `ledger_balances` aggregates — the **SAME source as the Trial Balance, so the
> statements can never disagree with it** (unlike the transactions-only Income
> Statement PREVIEW).

The transactions-only preview it warns about is `accounting.html:117` — the **default
tab**. Every user's first impression of FluxyOS accounting is the P&L the codebase
flags as capable of disagreeing with the Trial Balance.

---

## 3. Current state

### 3.1 Tab inventory (`accounting.html:116-128`)

| # | `data-acct-tab` | Label | Class of object |
|---|---|---|---|
| 1 | `income` | Income Statement *(default)* | Report |
| 2 | `journals` | Journals | Working paper |
| 3 | `ledger` | General Ledger | Working paper |
| 4 | `trial` | Trial Balance | Working paper |
| 5 | `statements` | Statements | Report |
| 6 | `coa` | Chart of Accounts | Configuration |
| 7 | `aging` | Aging | Report |
| 8 | `cleanup` | Cleanup | Workflow |
| 9 | `mapping` | Account Mapping | Configuration |
| 10 | `vendors` | Vendors | Configuration |
| 11 | `close` | Close | Workflow |

Four classes of object, interleaved, at identical visual weight. Reports appear at
positions 1, 5, and 7 with working papers between them.

### 3.2 The duplication map

```
INCOME STATEMENT / P&L — 3 engines
├─ db-service.js:5690  getIncomeStatementPreview        (transactions)
│    ├─ accounting.html:117   "Income Statement" tab  ← DEFAULT
│    ├─ accounting.html:85    KPI strip
│    └─ accounting-records.html  drill-down
├─ statements-engine.js:56  buildIncomeStatement         (ledger_balances)  ** canonical **
│    └─ accounting.html:121   "Statements" tab
└─ report-builder.js:316  calculateProfitLoss            (transactions)
     ├─ reports.html:273        "Profit & Loss" export row
     └─ report-preview.js:384/436/534   P&L · YTD P&L · YoY P&L

BALANCE SHEET — 2 engines
├─ statements-engine.js:92  buildBalanceSheet   (ledger, full equity, tie-out)  ** canonical **
│    └─ accounting.html:121   "Statements" tab
└─ db-service.js:5354/5559  getBalanceSheetReport  (records, NO CoA / equity / retained earnings)
     ├─ balance-sheet.html          sidebar item "Balance Sheet"
     └─ balance-sheet-records.html  drill-down + the only Balance Sheet CSV export

TRIAL BALANCE — 1 engine (db-service.js:4545), shares ledger_balances with statements
GENERAL LEDGER — 1 engine (db-service.js:4588/4738)
AGING — 1 engine (aging-engine.js)
CASH FLOW — does not exist
```

Three of these produce a "P&L"; two produce a "Balance Sheet". None share a
computation. `assets/js/balance-sheet.js:1-3` documents its own limitation: *"No
formal chart of accounts, journal entries, retained earnings, or equity logic."* It
reports **Net Position** where the canonical statement reports **Equity** — a
different concept under a similar-looking total, one sidebar click apart.

### 3.3 The gap nobody has logged

**There is no Cash Flow Statement anywhere in the Accounting Center.**
`dashboard.html:198-214` has a cash-flow *chart*; that is not a statement. A section
labelled "Statements" that omits one of the three primary financial statements reads
as unfinished to any accountant evaluating the product.

---

## 4. Evaluation against accounting practice

### 4.1 The funnel is fixed

```
source documents → journals → general ledger → trial balance → financial statements → close
```

This sequence is universal and non-negotiable; it is how every accountant trained
anywhere reasons about a period. An accounting product's navigation either mirrors it
or fights it. FluxyOS currently has all six stages implemented and none of them
expressed as a sequence.

### 4.2 Trial Balance is not a financial statement

This is the crux of the original question. The Trial Balance is a **working paper** —
the control check that proves the general ledger foots before statements are drawn
from it. It is never distributed to a bank, an investor, or a tax authority. Grouping
it with the Income Statement and Balance Sheet under a "Statements" heading is an
accounting category error.

Its correct neighbours are Journals and General Ledger, because they answer the same
question — *"can I trust these numbers, and where did they come from?"* — and because
FluxyOS already implements the drill path between them
(`drillToLedger`, `accounting.js:1386`: Trial Balance → General Ledger → Journal
Detail → source record).

The current IA is accidentally half-right: Trial Balance *is* separate from
Statements. But it sits between General Ledger and Statements in the tab order with
no signal that it belongs to the ledger cluster rather than the reporting one.

**Conclusion:** Income Statement + Balance Sheet + Cash Flow belong together. Trial
Balance belongs with Journals and General Ledger.

### 4.3 Would accountants expect to find these reports here?

Yes — an Accounting Center is exactly where an accountant looks for statements. The
failure is not location, it is **naming and grouping**. "Statements" as an abstract
container is a bin, not a destination. Accountants navigate to *"the Balance Sheet"*,
not to *"Statements, then the Balance Sheet"*. Every mature competitor names the
report at the point of navigation.

### 4.4 Does the current IA reduce usability?

Three concrete ways:

- **Wrong default.** The first view is the least trustworthy P&L in the product.
- **No prioritisation.** `docs/DESIGN_SYSTEM.md:763-773` prohibits *"repetitive cloned
  card grids with identical visual weight and no clear prioritization"*, and
  :752-761 prohibits *"filler sections that restate or duplicate nearby content with
  alternate phrasing."* Two Income Statements four tabs apart violate both rules this
  project has already committed to.
- **Configuration masquerading as accounting.** Vendors and Account Mapping are master
  data and posting rules — things set up once, not things read monthly. Sitting them
  beside the Balance Sheet flattens a real hierarchy and dilutes the reporting surface.

---

## 5. Competitor patterns

Studied for structural principle, not for imitation.

| Product | Navigation pattern |
|---|---|
| **QuickBooks** | One Reports hub, collapsible categories. *Business overview* = P&L, Balance Sheet, Statement of Cash Flows. **"For my accountant"** = Trial Balance, General Ledger, Journal, Account List. Explicit dual-audience split. |
| **Xero** | Accounting → Reports hub, categorised: *Financial statements*, *Payables & receivables* (aging), *Taxes*, *Reconciliation*. CoA and manual journals live in a separate "Advanced" area, out of the reporting surface. |
| **NetSuite** | Reports menu by function; Financial → Income Statement, Balance Sheet, Cash Flow, Trial Balance. Period close is its own checklist under Setup, deliberately not mixed into reporting. |
| **Jurnal.id** | `Laporan` top-level, categorised. `Laporan Keuangan` = Laba Rugi + Neraca + Arus Kas. `Buku Besar` / `Neraca Saldo` grouped as accounting working papers. `Tutup Buku` separate. |
| **Accurate** | `Laporan` menu with a grouped report list; `Buku Besar` sits under accounts, not reports. |
| **Campfire** | Close-centric and AI-native: Ledger → Reporting → Close. Few surfaces, each deep. |

### What they all agree on

1. **One categorised hub**, never a flat row of peers.
2. **Statements first**, working papers grouped separately for the accountant.
3. **Configuration lives outside the reporting surface.**
4. **Reports are named at the point of navigation** — no abstract "Statements" bin.
5. **Close is its own thing**, not a report.

Not one of them makes "Income Statement" a peer of "Statements."

**QuickBooks' "For my accountant" group is the single most relevant precedent** for
FluxyOS's stated goal of serving professional accountants without alienating
founders: it does not build two products, it builds one product with one clearly
labelled expert shelf.

### Indonesian convention

`Laporan Keuangan` means the formal statement set (Laba Rugi, Neraca, Arus Kas).
`Neraca Saldo` and `Buku Besar` are understood as working papers, not `Laporan
Keuangan`. The existing dictionary already encodes this correctly —
`dashboard-i18n.js:1787` maps "Statements" → "Laporan Keuangan" — which means the
current EN grouping is *more* wrong in Indonesian than in English, since the ID label
makes a formal-statement promise the tab only half keeps (no Arus Kas).

---

## 6. Recommended information architecture

Two-level navigation: **5 primary sections** following the accounting funnel, each
with 2–4 children. The KPI strip and period picker stay in page chrome, global to all
sections.

```
Accounting Center                  [period picker] [Ask Fluxy AI] [Export package]
  Revenue · Gross Profit · OpEx · Net Income · Report confidence    (global KPI strip)

┌ Overview ─ Reports ─ Ledger ─ Setup ─ Close ──────────────────────────────────┐

  Overview   Readiness score · cleanup summary · period status · next actions
  Reports    Income Statement · Balance Sheet · Cash Flow* · Aging (A/R + A/P)
  Ledger     Journals · General Ledger · Trial Balance
  Setup      Chart of Accounts · Account Mapping · Vendors
  Close      Close checklist · Cleanup queue · Period lock / reopen

  * Cash Flow does not exist yet — Phase 4
```

**11 tabs → 5 sections.**

### 6.1 Rationale per group

**Reports** — everything ledger-derived that a human reads and sends out. Aging
belongs here rather than standing alone: it is a receivables/payables report, and
`docs/PROJECT_BACKGROUND.md:1270-1275` already notes its composition mirrors the
Balance Sheet lines so the totals tie. Its as-of-today semantics must stay and be
labelled explicitly, since it deliberately ignores the period picker.

**Ledger** — the accountant's working papers, in aggregation order: Journals →
General Ledger → Trial Balance. This is the QuickBooks "For my accountant" shelf, and
it matches the drill path already implemented in `drillToLedger`
(`accounting.js:1386`).

**Setup** — configuration, entered rarely. Vendors and Account Mapping stay inside
the Accounting Center rather than moving to Settings/Bills, but they stop competing
with reports for attention. (Moving them out entirely was considered and rejected as
disproportionate surface disruption for the benefit.)

**Close** — the workflow. Cleanup folds in here because its only purpose is raising
readiness before closing; it is a pre-close task list, not a standalone view. The
`#tab-cleanup-count` badge moves onto the Close group tab, where it functions as a
"work remaining before you can close" signal.

**Overview** — gives founders a landing that answers *"are my books OK?"* without
requiring them to read a statement. This is the approachability half of the brief;
everything else on the page can then be optimised for the accountant.

### 6.2 Naming decisions

- **The "Statements" label disappears.** It becomes the **Reports** group, whose
  children carry real report names. Users navigate to *Balance Sheet*, never to
  *Statements → Balance Sheet*. This also dissolves the "Income Statement vs
  Statements" peer confusion at the root, without deleting anything.
- **`/reports` ("Reports & Exports") keeps a distinct job: export and distribution.**
  Accounting Center = view and work. Reports & Exports = package and send. This
  boundary is only honest once the Accounting Center's own "Export package" button
  (`accounting.html:41`, currently `disabled`/"Planned") actually works — Phase 5.

### 6.3 What this does not change

Panel IDs, render functions, engines, permissions, deep links, and the lazy
`KERNEL_TABS` loading strategy all survive Phase 1 untouched. The regrouping is a
navigation-layer change.

---

## 7. Implementation phases

Sequenced so the cheap, reversible, high-legibility work lands first and the
number-changing work is isolated behind an explicit gate.

### Phase 0 — Documentation *(this document + stale-doc reconciliation)*

Reconcile docs this audit found drifted from shipped reality:

- `docs/product_ux_feature_intake_framework.md` §5 — **no Accounting Center entry
  exists** in the Page Purpose Framework, while "Reports Page" claims *"formal
  financial reporting and export."* That omission is plausibly how the duplication
  arose: the anti-duplication tool had no entry for the page doing the duplicating.
- `docs/PROJECT_BACKGROUND.md` §4m — documents 10 tabs; live markup has 11 (Vendors
  undocumented). §8 sidebar table omits Accounting Center and Balance Sheet.
- `docs/ROADMAP.md` — still marks Trial Balance, Balance Sheet, posted statements,
  period close, and CoA management as "Planned"; all shipped.
- `docs/ACCOUNTING_CONTROL_CENTER_PLAN_AND_CLAUDE_PROMPT.md` — describes a 4-tab page
  and lists shipped features as out-of-scope.
- `docs/DESIGN_SYSTEM.md` — **no tab component spec exists anywhere.** `.acct-tabs` /
  `.acct-tab` are page-local CSS. A documented two-level section-nav component must
  exist before Phase 1 builds on it.

### Phase 1 — Regroup navigation ✅ SHIPPED 2026-07-29

Landed as **4 groups**; Overview deferred (see below). Structure only — no engine,
math, or panel changes.

- `accounting.html` — flat `<nav class="acct-tabs">` replaced by a primary group row
  plus a `.acct-subtabs` child row. The old `statements` panel was split into two
  named destinations, `statements-income` and `statements-balance`, so no leaf is an
  abstract container.
- `assets/js/accounting.js` — `TAB_GROUPS` / `GROUP_OF_TAB` drive `setTab()`, which
  now resolves `group → child → panel`, hides out-of-group children, and syncs
  `?tab=`. `setGroup()` returns to each group's last-used view. `KERNEL_TABS` lazy
  loading and the period-picker reload hook are intact; `STATEMENT_TABS` replaces the
  old single `'statements'` check. Arrow-key traversal added per the component spec.
- `assets/css/accounting.css` — `.acct-subtabs` / `.acct-subtab`. Active state is an
  orange accent on a **white** surface (orange backgrounds are prohibited).
- `assets/js/dashboard-i18n.js` — added `Reports`, `Setup`, `Close checklist`,
  `Income Statement (Ledger)`. `Ledger` → *Buku Besar* and `Close` → *Tutup* already
  existed. `accounting.html` audits at **0 English gaps**.
- `tests/helpers/accounting-nav.js` — new `openAccountingTab()`; inactive-group
  buttons are `hidden`, so specs can no longer click `[data-acct-tab=…]` directly.
  Nine specs migrated. `tests/accounting-nav.spec.js` guards reachability, group
  isolation, last-view memory, `?tab=` deep links, and 375px overflow.

**Interim state:** Reports has *four* children because both Income Statements still
exist. They are labelled by basis — "Income Statement" (transactions preview, still
the default) and "Income Statement (Ledger)". This is deliberate: it surfaces the
duplication rather than hiding it, and Phase 2 collapses the pair into one leaf.

**Overview — SHIPPED 2026-08-01** (deferred out of Phase 1 because it was the one
genuinely new view, which would have broken that phase's "structure only" property).

It deliberately does **not** restate the KPI strip above it — that would be the
duplicated-content pattern `DESIGN_SYSTEM.md` §6 bans. It answers the one question
nothing else answers in one place: **can I trust these books, and can I close?**

- **Books health** — the three integrity checks (trial balance, balance-sheet
  tie-out, cash-flow tie-out). These live on three separate views today, so
  assembling this picture previously meant visiting Reports, Ledger, and Close.
- **Before you close** — only real blockers, each with somewhere to go: unposted
  entries (blocking), invoice-linked deferrals (non-blocking, labelled as such),
  cleanup count, and period status. Empty state when nothing is outstanding.
- Every row is a shortcut to the view that fixes it.

**Overview is now the default landing**, so founders get "are my books OK?" before a
statement they would have to interpret; accountants deep-link or click through to
Reports. A group holding a single view hides its child row entirely — a one-button
row is filler when the group tab already says where you are.

### Phase 2 — One Income Statement, ledger-derived ⚠️ CODE COMPLETE, CUTOVER BLOCKED

**The code is done and verified. Do not ship it until the data gap below is
resolved** — the numbers are correct, but the underlying ledger is incomplete.

Shipped in code:
- `getFinancialStatements` now also returns `comparisonPeriod` and
  `comparisonIncomeStatement` (equal-length window immediately before the selected
  one, computed in the same `ledger_balances` scan — no extra read).
- The Income Statement is the ledger one: five columns (Line item, current,
  comparison, Change, Change %), account lines clickable through to the General
  Ledger, subtotals deliberately not clickable.
- KPI strip reads the ledger figures, so the strip, the statement, and the Trial
  Balance cannot disagree.
- The transactions-derived preview is gone as a *statement* source; it remains the
  readiness/confidence source (`getAccountingReadiness` still needs it). ~200 lines
  of preview render code removed from `accounting.js`.
- Tab ids: `statements-income` → `income`, `statements-balance` → `balance`.

**Cutover measurement (QA workspace, 2026-07):**

| Line | Ledger (new) | Preview (old) | Delta |
|---|---:|---:|---:|
| Revenue | Rp850.298.952 | Rp5.019.298.952 | −Rp4.169.000.000 |
| Gross profit | Rp850.098.952 | Rp5.019.298.952 | −Rp4.169.200.000 |
| Operating expenses | Rp1.228.483.220 | Rp787.475.220 | +Rp441.008.000 |
| **Net income** | **−Rp378.604.268** | **+Rp4.231.823.732** | **−Rp4.610.428.000** |

The sign flips: the old preview reported a Rp4.2bn profit where the ledger reports a
Rp379m loss.

**Integrity checks all pass** — the new statement is internally correct:
- Income Statement net income == Trial Balance implied net income, **delta Rp0**.
- Trial Balance in balance (debit == credit).
- Balance Sheet tie-out: −Rp110 (the known drift; needs
  `scripts/reconcile-ledger-balances.js --commit`, which requires a service-account
  key).

**Root cause of the divergence — two separate things:**

1. **160 of 182 income transactions in the period have no journal at all**
   (Rp4.97bn), with `pendingPostings = 0` — they are not queued for posting, they
   are simply absent from the ledger. Sample records show `source: null` and
   `cash_impact: null`, i.e. seeded or pre-kernel data written outside the posting
   path. **This is a data-integrity gap, not an engine bug.**
2. Operating expenses are *higher* in the ledger by Rp441m because bills,
   subscriptions, and invoices post there while the preview excluded them by design.
   This part is the ledger being *more* correct.

**The fix already exists.** `scripts/backfill-journals.js` posts journals for
transactions/bills/subscriptions that predate the posting engine — dry-run by
default, idempotent, and it reuses the real posting engine rather than duplicating
rules. The unposted records match its exact target (`source: null`,
`cash_impact: null`, i.e. pre-kernel), and `selectRule` maps `type: 'income'` →
`TXN-INC-CASH`, so they will post.

**Procedure: `docs/LEDGER_BACKFILL_RUNBOOK.md`.** Three scripts in order —
`backfill-journals.js`, then `backfill-journal-numbers.js` (backfilled journals get
**no** `JE-YYYY-NNNNNN`; a batched migration cannot reserve numbers transactionally),
then `reconcile-ledger-balances.js`.

**Backfill RUN on the QA workspace 2026-07-29.** Results:

| | before | after |
|---|---:|---:|
| QA ledger coverage (postable txns) | 85.7% | **100%** |
| July coverage | 80.7% | **100%** |
| Balance Sheet tie-out | −Rp110 | **Rp0, balanced** |
| Ledger revenue (Jul) | Rp850.298.952 | **Rp2.280.298.952** |
| Ledger net income (Jul) | −Rp378.604.268 loss | **+Rp1.046.417.182 profit** |
| Net delta vs retired preview | −Rp4.61bn (sign flip) | −Rp3.19bn (**no sign flip**) |

193 journals posted (transactions + bills + subscriptions), 193 journal numbers
assigned, 2 drifted balance docs corrected. **Zero unposted sources remain** — QA is
at 100% coverage. The 23 that earlier tooling flagged as residual carry
`accounting_status: 'excluded'` (foreign-currency invoice settlements, deliberately
outside the IDR kernel); `'excluded'` is terminal, not a gap. The remaining
preview-vs-ledger difference is the ledger being *more* correct: it includes accrued
bills/subscriptions the preview excluded by design, and excludes foreign-currency
settlements the preview counted as IDR revenue. **The ledger statement is
now the defensible number; the preview's was never correct** (cash-basis, no accruals).

> **Correction:** an earlier revision of this doc reported QA coverage as **16.2%**
> (347 unposted). That was wrong — an artifact of measuring through
> `DataService.listJournals`, which defaults to `max: 200` and filters `periodKey`
> **client-side**, so it saw 170 of July's actual 1014 journals. True pre-backfill
> coverage was 80.7% for July / 85.7% overall. Use
> **`scripts/ledger-coverage-report.js`** (admin-side, reads every journal) as the
> authoritative census; the in-app spec now requests `max: 5000` and asserts the
> journal fetch is non-empty so it cannot silently under-count again.

**GATE STATUS 2026-07-31:** QA 100%, **Beila 100%** (owner reopened 2026-05/06, 746
journals posted, all statements tie, zero drift). Remaining: Get-Pipeline (27) and
Dika Finance (7) — no closed periods, fixable in-product. The blocker that required
a business decision is resolved.

**Original blocking question:** does production have the same unposted
population as QA? If it does, revenue collapses for those users the day this ships.
Backfill must run **before** cutover, not after. Two decisions are not
engineering's to make: whether a restatement of this size needs customer
communication, and whether previously-closed periods may be reopened to correct
them (see the runbook §6).

### Phase 2 — original plan *(retained for reference)*

Retire `getIncomeStatementPreview` as a **statement** source; keep it as a
**readiness** source (`getAccountingReadiness` depends on it for `cleanupItems` /
`mappingPreview` / `closeChecklist`). `buildIncomeStatement`
(`statements-engine.js:56`) becomes the only Income Statement.

Three capabilities must be rebuilt on the ledger source first:

1. **Period comparison + change %** — `getFinancialStatements` (`db-service.js:4412`)
   already takes `{startPeriod, endPeriod}`; add a comparison fetch and diff, reusing
   `_previousPeriodRange`, `_incomeChange`, `_incomeStatementColumnLabel`, and the
   existing `changeDisplay` renderer (`accounting.js:677`).
2. **Drill-down** — the ledger path already exists and is *better* than the preview's:
   account line → General Ledger → Journal Detail → `source.{collection,id}`. Reuse
   `drillToLedger` rather than the `accounting-records.html` deep link
   (`navigateToRelatedRecords`, `:737`). Decide whether `accounting-records.html` is
   retired or repointed.
3. **KPI strip** — `renderKpis` (`accounting.js:634`) currently reads preview data;
   repoint to ledger figures so the strip and the statement cannot disagree.

**Cutover gate.** These numbers change for existing users (ledger basis, not
transaction basis). Requires an in-product explanation and a documented
before/after comparison on the QA workspace. Run
`scripts/reconcile-ledger-balances.js` first — the QA account carries a known Rp110
drift that would otherwise make the tie-out badge untrustworthy during testing.

### Phase 3 — Retire the standalone Balance Sheet page ✅ SHIPPED 2026-07-29

- **CSV export ported first**, so no capability was lost: `exportBalanceSheet()` in
  `accounting.js` sources the ledger statement but keeps the retired page's audited
  flow — confirm dialog → `addReportExport` → `createExportAuditLog` → download. Its
  `limitations` field now states the statement ties to the trial balance, and flags
  the export when the tie-out is non-zero.
- Deleted: `balance-sheet.html`, `balance-sheet-records.html`,
  `assets/js/balance-sheet.js`, `assets/js/balance-sheet-records.js`,
  `tests/balance-sheet-records.spec.js`.
- 301s to `/accounting?tab=balance` in **both** `deploy/_redirects.app` (app site)
  and `netlify.toml` (monolith fallback — local dev, deploy previews, rollback).
- Removed from `APP_PAGES` (`scripts/prepare-deploy.js`) and the page list in
  `scripts/i18n-audit.js`. `node tests/prepare-deploy.check.js` passes for all
  three roles (unset / marketing / app).
- Sidebar: nav item, icon entry, and active-route mapping removed from
  `sidebar-loader.js`.

**Wider blast radius than the plan anticipated** — four extra referrers had to be
updated: `assets/js/onboarding-gate.js` (a `balance-sheet` pageKey gate config),
`scripts/i18n-audit.js`, `tests/dashboard-i18n.spec.js`, `tests/fluxy-ai-button.spec.js`,
plus `tests/sales-deck-shots.spec.js`. Doc exceptions cleared from
`DESIGN_SYSTEM.md` (the `max-w-7xl` carve-out, the page-scoped topbar-class note,
and the print-header reference), `SYSTEM_DESIGN.md`, and `QA_CHECKLIST.md` (§J2 removed).

**Left deliberately:** `getBalanceSheetReport` / `_buildBalanceSheetSnapshot` remain
in `db-service.js` with no caller. Removing them is a data-layer change with its own
risk; they are marked dead in `PROJECT_BACKGROUND.md` §4m instead.

### Phase 3 — original plan *(retained for reference)*

- Port from `balance-sheet.js` into the Accounting Center Balance Sheet: as-of date
  picker, comparison mode, section/source filters, and **CSV export** (`:442-513`).
  The Accounting Center currently has no export on any statement.
- Remove `nav-balance-sheet` (`sidebar-loader.js:240`).
- Redirect `/balance-sheet` and `/balance-sheet-records` → `/accounting` via
  `deploy/_redirects.app` (evaluated before `netlify.toml`).
- Remove both pages from `APP_PAGES` in `scripts/prepare-deploy.js` — **both site
  builds fail on an unclassified page**, so this is not optional. Then run
  `node tests/prepare-deploy.check.js`.
- Retire `tests/balance-sheet-records.spec.js`; check breadcrumb parents at
  `balance-sheet.html:97` and `balance-sheet-records.html:67` for other referrers.
- Remove the sanctioned `max-w-7xl` exception for `balance-sheet.html`
  (`docs/DESIGN_SYSTEM.md:590-593,626`).

### Phase 4 — Cash Flow Statement ✅ SHIPPED 2026-07-31

The statement set is now complete. `buildCashFlow()` in `statements-engine.js`,
surfaced as **Reports → Cash Flow**, sharing the one `getFinancialStatements` fetch.

**Derived from the double-entry identity, not from hand-picked adjustments.** Across
every account Σ(debit − credit) == 0, so Δcash == Σ(credit − debit) over all non-cash
accounts. The three sections partition those accounts, so the statement ties to the
real movement in cash accounts **by construction** — the same property that makes the
Balance Sheet tie out, and a non-zero `tieOutDelta` is likewise a genuine
`ledger_balances` drift signal rather than a presentation bug.

**It survives a closed period.** The closing journal moves the P&L into Retained
Earnings, which would double-count net income; grouping RE with the P&L accounts in
Operating makes the closing entry net to zero, so "Net income" reads identically
whether the period is open or closed. Unit-tested both ways in
`tests/statements-engine.spec.js`.

Classification: `cash_bank` is cash; `accounts_receivable`/`other_current_asset` and
`accounts_payable`/`other_current_liability` are Operating; other assets are
Investing; equity and other liabilities are Financing. Unknown or user-created
categories fall back on account **type**, so a custom account can never silently drop
out and break the tie-out.

Verified on the QA ledger: "Ties to cash ✓", net income matching the Income
Statement, A/R increase shown as cash tied up and A/P increase as cash preserved.

### Phase 4 — original plan *(retained for reference)*

Add `buildCashFlow()` to `statements-engine.js` using the indirect method: net income
from `buildIncomeStatement`, adjusted by period movement in balance-sheet accounts —
all available from the same `ledger_balances` aggregates, so it ties to the Trial
Balance by construction like the other two statements. Third child of Reports. ID
label `Laporan Arus Kas` (`docs/LOCALIZATION_PLAN.md:502-510`).

### Phase 5 — Accounting export package ✅ SHIPPED 2026-08-01

The accountant hand-off, and the last phase. "Export package" is no longer a
disabled Planned pill: it downloads five CSVs for the selected period —
**Income Statement** (with the comparison column), **Balance Sheet**, **Cash Flow**,
**Trial Balance**, and **General Ledger**.

Design points:
- **Every file is self-describing.** Each carries a header block with the period,
  the basis (posted ledger), generation timestamp, and all three integrity results
  — trial balance in/out, balance sheet tie-out, cash flow tie-out. A reviewer can
  tell whether the books foot without opening the other files, and an export taken
  while something is out of balance says so on its face.
- **Statements plus the working papers behind them.** Trial Balance and General
  Ledger are included precisely so an accountant can trace any statement figure to
  its postings — the GL rows carry journal id, posting rule, and source
  collection/id.
- **Raw integers, never formatted currency.** Guarded by the spec; a
  `Rp1.234.567` would break every spreadsheet it lands in.
- The Balance Sheet file reuses `balanceSheetCsv()` from the standalone export, so
  the two cannot diverge.
- One `report_exports` entry (`report_type: 'accounting_package'`) plus one
  `export.create` audit log, recording the file list and the integrity results.
- `getGeneralLedgerAll` is called with `max: 5000` — `listJournals` defaults to
  200, which would silently truncate an accountant's export on a busy period.

This is what `docs/ACCOUNTING_DISCOVERY_STRATEGY.md` §10's definition of done
required: an external accountant signing off a month without exporting to Excel.

Guard: `tests/accounting-export-package.spec.js` (all five files arrive, each
declares period/basis/tie-outs, no formatted currency, GL carries postings).

### Phase 5 — original plan *(retained for reference)*

Enable `#acct-export-package` (`accounting.html:41`). Bundle Income Statement +
Balance Sheet + Cash Flow + Trial Balance + General Ledger as the accountant hand-off
pack, written through the existing `report_exports` path (`db-service.js:1558-1591`)
so it is audit-logged and metered like every other export. This is what makes the
Accounting Center ↔ Reports & Exports boundary real rather than asserted.

---

## 8. Success criteria

Aligned to `docs/ACCOUNTING_DISCOVERY_STRATEGY.md` §10 — *"an external Indonesian
accountant signs off on a month without exporting to Excel."*

- One Income Statement figure in the product, reconcilable to the Trial Balance.
- One Balance Sheet, with a real equity section and a passing tie-out.
- All three primary statements present.
- An accountant can reach any statement in one click and any source record in three.
- A founder can answer "are my books OK?" without opening a statement.
- Navigation holds hierarchy at 375px and 1280px with no horizontal page overflow.

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| **Phase 2 changes numbers users have seen before** | Explicit cutover gate, in-product explanation, documented before/after on the QA workspace, reconcile ledger drift first |
| Losing the preview's drill-down | Ledger drill path (`drillToLedger`) is strictly better; verify coverage before removal |
| Deep links break on regroup | `?tab=` params and all `drillToLedger`/aging row links covered in Phase 1 verification |
| ID copy drifts on rename | Pair-edit rule; `node scripts/i18n-audit.js` at (near-)zero gaps |
| Two-level nav becomes cramped on mobile | Component spec authored in Phase 0 *before* markup, tested at 375px |
| `/balance-sheet` retirement breaks a build | `APP_PAGES` classification is a hard build guard; `tests/prepare-deploy.check.js` for both `SITE_ROLE` values |

---

## 10. Open questions

1. Does `accounting-records.html` survive Phase 2 repointed at ledger sources, or
   retire in favour of the Journal Detail path?
2. ~~The third P&L at `/reports`.~~ **RESOLVED 2026-07-31.** Reading the code
   changed the question: `/reports`' "Profit & Loss" was never a rival statement —
   it is a four-metric summary with no COGS, no gross-profit line and no per-account
   detail. So the fix was not to pick a winner but to stop Reports computing books at
   all: `calculateProfitLoss(transactions, ledgerIncomeStatement)` now prefers the
   ledger statement, and `reports.js` fetches it alongside the period data. The
   exported P&L, the preview drawer, and the full report therefore agree with the
   Accounting Center and the Trial Balance by construction. The CSV states its basis
   explicitly.

   Two defects surfaced and were fixed with it: the "Gross Margin" row computed
   `(Revenue − OpEx) / Revenue` — **net** margin under a gross-margin label — and now
   uses COGS with net margin reported separately; and because COGS is unknowable on
   the cash-basis fallback, gross profit/margin are reported as **unavailable** there
   rather than computed from a zero COGS, which would have fabricated a flat 100%
   gross margin. Guard: `tests/report-profit-loss-basis.spec.js`.

   **YTD / monthly trend re-based 2026-08-01.** `getLedgerMonthlySeries` returns
   per-month ledger Income Statements from a *single* `ledger_balances` read (the
   collection is keyed `{period_key}__{account_code}`, so a series costs the same as
   one period). `calculateMonthlyTrend` and `calculateYtdSummary` now take it.

   The split is deliberate: **financial** fields (revenue, COGS, opex, net, margins)
   come from the ledger; **record-quality** fields (record counts, missing receipts,
   bill/sub counts) still come from the records, because "missing receipt" is a
   document attribute the ledger has no concept of. A month with no ledger activity
   falls back rather than vanishing from the trend.

   Two more defects fixed here:
   - The trend's `grossMargin` column had the same mislabel as `calculateProfitLoss`
     — `(Revenue − OpEx) / Revenue` is **net** margin. Both are now named for what
     they are, and the report-preview column header was corrected to "Net Margin".
   - **`formatRupiah` and `formatRupiahCompact` returned `Math.abs()`**, so a Rp37m
     *loss* rendered identically to a Rp37m profit — in exported reports. Negatives
     now render in parentheses per `DESIGN_SYSTEM.md`. Only genuinely negative values
     change; call sites passing a magnitude are unaffected. This predates the IA work
     but the ledger-derived P&L surfaced it, since ledger figures are legitimately
     negative far more often than the old cash-basis ones were.
3. Does Overview need real estate of its own, or is the existing global KPI strip
   plus a cleanup summary enough to justify the section?

---

## 11. Corrections

**`INV-ISSUE` was never unwired (corrected 2026-08-01).** A comment in
`scripts/backfill-journals.js` stated that invoice issuance "is not wired yet", and
that claim was carried into the close gate, the docs, and memory without being
checked. It is wrong: `INV-ISSUE` posts `Dr A/R / Cr Revenue` on issue and `INV-PAY`
posts `Dr Cash / Cr A/R` on payment — the QA workspace holds 329 and 224 of them
respectively.

Consequences fixed:

- `countUnpostedSources` carved invoice-linked settlements out as `deferred`
  (surfaced, never blocking) on that false premise. Since issuance *does* raise the
  receivable, an unposted `INV-PAY` is an ordinary gap and now **blocks a close**
  like anything else. `deferred` stays in the return shape but is always 0.
- `backfill-journals.js` skipped every `INV-PAY` unconditionally. The risk there is
  real but for a different reason: `invoices` is not in its default `--collections`,
  so a run could post a settlement against a receivable it never raised. The skip is
  now **conditional** — a settlement posts once its invoice has a journal, either
  already or planned earlier in the same run.

Unrelated and still correct: the QA transactions carrying `accounting_status:
'excluded'` are **foreign-currency** invoice payments, deliberately outside the IDR
kernel. That exclusion stands.

**Lesson:** the stale comment was load-bearing for a gate whose whole job is
refusing to close over an incomplete ledger. Verify a claim before building a
carve-out on it.
