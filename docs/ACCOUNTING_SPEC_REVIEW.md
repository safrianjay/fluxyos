# Review — "Accounting System: Module Map, System Flow & Posting Rules" (Head of Finance, v1.0)

**Reviewed:** 2026-08-02
**Source document:** `accounting-system-flow.md` (v1.0, undated, benchmarked to Xero)
**Reviewed against:** `assets/js/accounting-engine.js`, `assets/js/db-service.js` (ACCOUNTING KERNEL),
`assets/js/statements-engine.js`, `firestore.rules`, `docs/PROJECT_BACKGROUND.md` §4m/§4m.3,
`docs/CHART_OF_ACCOUNTS_STRATEGY.md`, `docs/ACCOUNTING_CENTER_IA.md`, `docs/ROADMAP.md`

---

## 1. What this document actually is

It is a **greenfield functional + accounting specification** for building a full SME cloud
accounting system, using Xero as the benchmark. It is **not** an audit of FluxyOS and not a
gap analysis of what we shipped. Three pieces of internal evidence:

1. **It uses Xero's account numbering** (`200 Sales`, `610 A/R`, `800 A/P`, `960 Retained
   Earnings`), not FluxyOS's Indonesian SAK-style numbering (`4000`, `1100`, `2000`, `3000`).
2. **§10 Build Sequence starts at Sprint 1 = "COA + account flags + period table"** — i.e. it
   assumes nothing exists yet. Sprints 1–8 describe work FluxyOS shipped between 2026-06 and
   2026-08.
3. **§8 Minimum Data Model is written in PostgreSQL** — `JSONB` columns, `CHECK` constraints,
   `REVOKE UPDATE, DELETE`, `UNIQUE (...)`. FluxyOS is Firestore. Several of its "enforce in
   the database, not the application" rules are not literally implementable on our stack.

So the right way to read it: **a target-state blueprint and a shared vocabulary**, written by
someone reasoning from accounting practice rather than from our codebase. Its value is in the
control model (§6), the validation taxonomy (§7), and the nightly reconciliation assertions
(§10) — not in its account codes or its build order.

### Document structure

| § | Content | Value to us |
|---|---|---|
| 0 | Scope & assumptions (accrual, multi-currency, single entity) | Confirms our basis |
| 1 | 16-module map (M1–M16) benchmarked to Xero + where to deliberately diverge | Useful coverage checklist |
| 2 | Master data layer — 5 tables, account-type taxonomy, three permission flags | **High** — the flags are the key idea |
| 3 | Posting engine architecture + 6 non-negotiable engineering rules | **High** — one rule we structurally can't meet |
| 4 | Reference chart of accounts (Xero numbering) | Semantics useful, codes are not adoptable |
| 5 | 11 worked journal-entry cycles (sales, purchases, bank, inventory, fixed assets, payroll, claims, tax, close, FX, dimensions) | **High** — the posting-rule reference |
| 6 | POSSIBLE vs IMPOSSIBLE accounts to journal | **Highest-value section in the doc** |
| 7 | 16 structured validation error codes (`GL_001`–`GL_060`) | Cheap to adopt, worth adopting |
| 8 | Minimum data model (Postgres DDL) | Conceptually useful, not portable as written |
| 9 | Indonesian localisation notes (PPN, e-Faktur/Coretax, PPh, PSAK, rounding) | Mostly already shipped, better than described |
| 10 | 12-sprint build sequence + **five nightly reconciliations** | The five reconciliations are the actionable part |

---

## 2. The one argument the document is making

Everything in it follows from a single thesis, stated in §0:

> Users interact with **documents** (invoices, bills, payments, assets, payslips). The general
> ledger is a **derived artefact** produced by a posting engine. Nobody hand-types a journal to
> Accounts Receivable.

And the enforcement mechanism for that thesis is §6: **every account carries two independent
permission flags** — `allow_manual_journal` (can a human name it on a manual journal line?) and
`allow_direct_transaction` (can a human select it on an invoice/bill/spend-money line?) — kept
separate from `is_system` (can it be renamed/deleted?).

That separation is the doc's real contribution. **FluxyOS already agrees with the thesis but
has not built the enforcement.** See §4 below.

---

## 3. Where FluxyOS already agrees (and in places exceeds it)

| Doc requirement | FluxyOS status |
|---|---|
| Accrual basis, cash basis never a posting mode | ✅ Accrual by construction — bills accrue to `2000`, invoices to `1100` |
| Documents are the entry point; posting is derived | ✅ `addTransaction`/`addBill`/`finalizeInvoice` post silently via `buildJournal()` |
| §3.1 Nothing posts from DRAFT | ✅ Invoice drafts don't post; manual-journal drafts carry no number and no ledger impact |
| §3.2 Journals immutable; edit = reverse + repost | ✅ `_correctSourceJournal`; `firestore.rules` allow only `reversed_by_journal_id` to change, no delete |
| §3.3 Every journal carries source_type + source_id | ✅ `source:{collection,id}` + `source_number` (journal-level, not line-level) |
| §5.1–5.3 Sales/AR, Purchases/AP, Bank cycles | ✅ `INV-ISSUE`/`INV-PAY`, `BILL-ACCRUE`/`BILL-PAY`, `TXN-*`, `SUB-ACCRUE` |
| §5.3 Bank reconciliation with match/create/transfer | ✅ Shipped Phases A+B — `recon-engine.js` tiers R1–R4, certify + un-reconcile |
| §5.9 Period close, hard close blocks posting | ✅ `periods` (open/closed/locked); `closePeriod()` server-enforced; reopen is owner/admin |
| §5.9 JE-Y1 year-end roll | ✅ Implemented — **but see §5, we post it physically where the doc prefers a computed line** |
| §6.2 Advisor-only accounts → role model | ✅ Fifth role `accountant` (`journals.manual`, `accounting.post`, `period.close`) |
| M11 Reporting with drilldown to source | ✅ P&L, Balance Sheet, Cash Flow, Trial Balance, GL, Aged AR/AP — TB → GL → Journal → source, no dead ends |
| M12 Tax engine | ✅ **Ahead of the doc.** Tax Center Phases 1–4 + 5.1: PPN in/out, PPh 23/4(2)/26 withholding both directions, PPh 25/29, SPT + bukti potong CSV, tax period file/lock |
| M14 Document store, M15 audit trail | ✅ Both shipped |
| §9 PPN as configurable rate, not hardcoded | ✅ Per-invoice and per-bill rate, `tax_mappings` |

**Two places we are meaningfully ahead of the spec:** the Indonesian tax engine (§9 treats it as
a to-do list; we have it shipped through annual PPh 29 reconciliation), and the AI/mapping
resolution ladder in `docs/CHART_OF_ACCOUNTS_STRATEGY.md` §E, which the doc doesn't contemplate
at all.

---

## 4. The gaps that matter — ranked

### 4.1 🔴 §6's control layer does not exist. Manual journals can post to any account.

This is the finding worth acting on. `buildManualJournal()`
([accounting-engine.js:567-602](assets/js/accounting-engine.js#L567-L602)) accepts **any**
`account_code` with no permission check. `finalize()` asserts Σdebit == Σcredit and nothing else.

Our two account flags are not the doc's two flags:

| Flag | FluxyOS meaning | Doc's flag it is *not* |
|---|---|---|
| `is_system` | Rename/archive is locked | ≈ the doc's `is_system` ✅ |
| `mappable: false` | Excluded from *auto-mapping* suggestions | **not** `allow_manual_journal` |
| — | *(missing)* | `allow_manual_journal` |
| — | *(missing)* | `allow_direct_transaction` |

Concretely: an `accountant`-role user can post `Dr 1100 Accounts Receivable / Cr 4000 Revenue`
as a manual journal today. Nothing stops it. That breaks the tie between the A/R control account
and the invoice subledger — the exact tie that the shipped Aging tab and the Balance Sheet
A/R line both depend on, since they compose from open invoices rather than from `ledger_balances`.
The drift would be *observable* (Aging vs Balance Sheet disagree) but is not *prevented*, and
there is no audit path from the manual line back to a customer.

Same exposure on `2000` A/P, `1000` Cash & Bank (the doc's bank-account special case — a manual
journal to cash creates a GL movement with no statement counterpart, which sits in the
reconciliation queue forever), and `3000` Retained Earnings.

**Recommended:** add `allow_manual_journal` / `allow_direct_transaction` to
`CHART_OF_ACCOUNTS_SEED`, enforce in `buildManualJournal()` + the account picker + `firestore.rules`.
Seed values, translated to our codes: `1000`/`1100`/`2000`/`3000`/`3900` → `allow_manual_journal:
false`; tax accounts `1130`/`1140`/`1150`/`2100`/`2110`/`2200` → advisor-only (already
`mappable: false`, which gets us halfway).

### 4.2 🔴 The five nightly reconciliations (§10) are not automated — and we already have the failure they'd catch

The doc's closing recommendation is to run five assertions nightly; a failure means a
posting-rule bug. Our equivalents:

| Doc assertion | FluxyOS translation | Status |
|---|---|---|
| `GL 610` = Σ open AR invoices | `GL 1100` = Σ open invoices | ❌ not run |
| `GL 800` = Σ open AP bills | `GL 2000` = Σ unpaid bills | ❌ not run |
| `GL 630` = Σ qty × unit cost | n/a — no inventory | n/a |
| `GL 7x0 − 7x1` = Σ asset NBV | n/a — no fixed asset register | n/a |
| `GL 600/601` = bank statement balance | `GL 1000` = bank statement balance | ⚠️ per-reconciliation only, not asserted |

We have `scripts/reconcile-ledger-balances.js` and `scripts/ledger-coverage-report.js`, but both
are **manual, dry-run-by-default scripts**, not scheduled assertions. This is not hypothetical:
the Accounting Center Phase 2 cutover is currently blocked precisely because journal coverage
silently diverged from the transaction set (QA workspace was at 85.7%; real workspaces are still
at 5.4% and 0% — `docs/LEDGER_BACKFILL_RUNBOOK.md`). Assertions #1 and #2 running nightly would
have surfaced that on day one instead of at cutover.

**Recommended:** wire assertions #1, #2, #5 plus a global Σdebit == Σcredit as a scheduled
function, alerting on drift. Cheapest high-value item in the whole document.

### 4.3 🟠 No Suspense account — and our fallback is an *expense* account

Doc §6.2 puts unidentified amounts in **850 Suspense, a current liability**, requires it to be
zero before hard close, and reports the ageing of items parked there.

FluxyOS's unresolved fallback is **`6999 Other Expense`** — a P&L account. Anything the mapping
ladder can't resolve therefore **understates net income** rather than parking on the balance
sheet, and the close checklist has no "suspense must be zero" gate.
`docs/CHART_OF_ACCOUNTS_STRATEGY.md` §E already anticipates the fix conceptually ("6999 becomes
a *queue*, not a destination; target <2% of spend"), but the account class is still wrong.

**Recommended:** seed a `2900`-family Suspense liability for genuinely unidentifiable items,
keep `6999` for *low-confidence but genuinely expense* items, and add "Suspense = 0" to the
Close checklist.

### 4.4 🟠 No Rounding account — and the doc specifically warns us about this one

§9: *"With no-decimal IDR, the rounding account (860) will be exercised far more than in a
decimal-currency deployment. Test it hard."* We have no rounding account and no `JE-B4`
settlement-rounding rule. A known real Rp110 drift already exists in the QA ledger. With
multi-currency invoices now shipped (USD/SGD converted to IDR at payment via `fx-rate.js`),
rounding residue on settlement is a live source of drift, not a theoretical one.

### 4.5 🟠 FX gain/loss is seeded but never posted

`7200 FX Gain/Loss` exists in `CHART_OF_ACCOUNTS_SEED` and is referenced **nowhere else in the
codebase**. Per `docs/CHART_OF_ACCOUNTS_STRATEGY.md`, FX differences on foreign-invoice
settlement are currently *absorbed into the converted amount*. The doc's §5.10 splits this
correctly into realised (JE-X2) and unrealised (JE-X3, auto-reversing) — worth implementing now
that USD/SGD invoices are live.

### 4.6 🟡 §3.4/§3.5 — the architectural tension we can't fully resolve on this stack

The doc's rules 4 and 5 are *"the posting engine is the only writer to the GL"* and *"balanced or
rejected, enforced at the DB layer, not just the app."* FluxyOS posts **client-side**, with
`firestore.rules` as the integrity boundary — and Firestore rules **cannot sum a `lines[]`
array**, so we verify Σdebit == Σcredit on journal *totals* only. A crafted client could submit
balanced totals over lopsided lines. This is already documented as an accepted limitation with
compensating controls (Trial Balance re-assertion + `reconcile-ledger-balances.js`).

The document does not know this constraint exists. Its recommendation would be server-side
posting. That is a real architectural decision to put in front of the author, not a defect to
quietly fix — but the compensating control in 4.2 above is what makes the current position
defensible, which is another reason to automate it.

Related: §3.6 idempotency wants a DB `UNIQUE (source_type, source_id, event_type, sequence)`.
We guard with `accounting_status`/`journal_ref` + a journals-by-source lookup, which is
application-level and adequate in practice, but it is a convention rather than a constraint.

### 4.7 🟡 Modules genuinely absent

`M6 Inventory` · `M7 Fixed Assets` · `M8 Payroll` · `M9 Expense Claims` · `M10 Projects` ·
`M13 Dimensions/tracking`. Also absent as documents: quotes, sales orders, credit notes,
purchase orders, goods receipts (and therefore **GRNI**), debit notes, and the payment-gateway
clearing account (`640` in the doc; `1030` in our strategy doc) that marketplace settlement
float actually needs given the shipped Commerce Integration Platform.

Two of these are already planned in `docs/CHART_OF_ACCOUNTS_STRATEGY.md` as Tier-2 activations
(inventory/COGS on "I sell products"; payroll family on "I have employees"). The `sak_category`
enum in `accounting-engine.js` already carries `inventory`, `fixed_asset`, and
`accumulated_depreciation` values with no seeded accounts behind them — the seams are cut.

**M2 Contacts is partially there:** we have a Vendors surface (default account, currency, terms)
under Setup, but no unified contact entity carrying both customer and supplier roles.

### 4.8 🟡 Validation errors are unstructured

§7 specifies 16 codes (`GL_001` balance, `GL_010` manual-journal blocked, `GL_020` period closed…).
We throw generic `Error` strings. Adopting the taxonomy is a small change that pays off the
moment 4.1 lands, because every new block needs a distinguishable, translatable message — and
`dashboard-i18n.js` needs stable keys anyway.

---

## 5. Where I'd push back on the document

**Do not adopt its account codes.** The doc's §4 uses Xero's UK/AU numbering. FluxyOS uses
Indonesian SAK-style numbering, and `docs/CHART_OF_ACCOUNTS_STRATEGY.md` §F sets a hard
invariant: *account codes are append-only; accounts are added, deactivated, or re-parented —
never renumbered.* Renumbering to match would break every posting rule, every saved
`accounting_mappings` doc, every existing journal line, and every `ledger_balances` doc id
(`{period_key}__{account_code}`). **Adopt the semantics and the control flags; keep our codes.**
Translation table for the accounts that matter:

| Doc | FluxyOS | | Doc | FluxyOS |
|---|---|---|---|---|
| 610 A/R | `1100` | | 820 VAT Output | `2100` |
| 800 A/P | `2000` | | 821 VAT Input | `1130` |
| 600/601/605 Bank | `1000` (single, no children yet) | | 814/816 Withholding | `2110` / `1150` |
| 200 Sales | `4000` | | 830 CIT Payable | `2200` |
| 960 Retained Earnings | `3000` | | 840 Historical Adjustment | `3900` (Opening Balance Equity) |
| 961 Current Year Earnings | `3500` (planned; computed) | | 850 Suspense / 860 Rounding | **none** |

**§5.9 JE-Y1 conflict — a decision to make, not a bug.** The doc's *preferred* implementation is
to post **no** physical closing journal and compute Current Year Earnings at the reporting layer.
`closePeriod()` does post one (net income → `3000`), and reverses it on reopen. Our Balance Sheet
*also* carries a computed current-period-earnings line, and `docs/ROADMAP.md` notes the Cash Flow
Statement had to be built to "handle closed periods without double-counting net income" — i.e.
the double-count trap the doc is warning about has already cost us work once. Worth a deliberate
answer rather than drift.

**§0's "one legal entity per organisation"** is stricter than where we already are —
`entity_id` is on every journal and account today, so the seam is cut earlier than the doc assumes.

**Bank accounts as first-class ledger accounts.** The doc assumes `600`/`601`/`605` — one GL
account per real bank account. We have a single `1000 Cash & Bank`. This blocks the doc's
reconciliation #5 from being meaningful per-account, and our own strategy doc already calls for
`1020–1029` children (one per `bank_accounts` doc). It should be sequenced with 4.2.

---

## 6. Recommended response

Ordered by value per unit of work:

1. **Automate the reconciliation assertions** (§4.2) — nightly scheduled function on #1, #2, #5
   plus global Σdebit == Σcredit. Directly de-risks the blocked Phase 2 cutover.
2. **Add `allow_manual_journal` / `allow_direct_transaction`** (§4.1) — closes the control gap
   that §6 exists to close, and is the doc's core idea.
3. **Fix the fallback account class** (§4.3) — Suspense as a liability + "Suspense = 0" close gate.
4. **Seed Rounding + wire FX gain/loss** (§4.4, §4.5) — both are live drift sources today given
   IDR no-decimals and shipped multi-currency invoices.
5. **Adopt the `GL_*` error taxonomy** (§4.8) — do it *with* item 2, not after.
6. **Bank accounts as ledger children of `1000`** (§5) — prerequisite for a meaningful #5.
7. Modules M6–M10, M13 stay roadmap items; they already have Tier-2 activation triggers in
   `docs/CHART_OF_ACCOUNTS_STRATEGY.md` and shouldn't be pulled forward by this document alone.

**To send back to the author:** the codebase context they were missing (Firestore not Postgres;
client-side posting; our numbering scheme; the tax engine being further along than §9 assumes),
plus the one open question — server-side posting (§4.6) and physical vs computed year-end roll
(§5) are architectural calls that need their input, not ours alone.

---

## 7. Adoption plan — what fits our architecture

Filtered by whether the seam already exists in our stack, not by what the doc ranks highest.

### 7.0 🔴 Prerequisite defect — `mappable` never reaches Firestore

Found while tracing the §6 gap. **This is a live defect, not a spec gap**, and it must be fixed
before any §6 work lands on top of it.

`fluxy-account-picker.js` already implements a proto-`allow_direct_transaction`:

```js
// fluxy-account-picker.js:52-57 — "not a structural system account
// (Cash, A/P, A/R, Retained Earnings, tax control — marked mappable:false)"
function isSelectable(a) {
    if (a.is_active === false) return false;
    if (a.is_system && a.mappable === false) return false;
    return true;
}
```

But `seedChartOfAccounts` ([db-service.js:3864-3879](assets/js/db-service.js#L3864-L3879)) writes
`is_system` and **never writes `mappable`**. `getChartOfAccounts` returns the Firestore docs
verbatim, so on any seeded workspace `a.mappable` is `undefined`, `undefined === false` is
false, and `isSelectable` returns **true for every structural account**.

`getChartForPicker` synthesizes `mappable` only on its *fallback* path — when the workspace
chart is empty. So **the guard works only on workspaces that have never opened the Accounting
Center**, and silently stops working the moment the chart is seeded.

Net effect on the Add Transaction drawer, given
`DIRECTION_TYPES = { in: [revenue, liability, equity], out: [expense, asset, liability, equity] }`:

| Direction | Structural accounts wrongly selectable |
|---|---|
| Money **out** | `1000` Cash & Bank · `1100` A/R · `2000` A/P · `3000` Retained Earnings · `3900` Opening Balance Equity · `1130`/`1140`/`1150` tax control |
| Money **in** | `2000` A/P · `3000` Retained Earnings · `3900` · `2100`/`2110`/`2200` tax control |

Coding a transaction directly to `1100`/`2000` bypasses the invoice/bill subledger and breaks the
Aging ↔ Balance Sheet tie; coding to `3000`/`3900` lets ordinary spend land in equity.

**Fix (small):** persist `mappable` in `seedChartOfAccounts` (both the create and the
`!current.sak_category` backfill branch, so existing workspaces heal), and add `mappable: false`
to `1100` and `2000` in `CHART_OF_ACCOUNTS_SEED` — the code comment already claims they're
excluded, the data just never said so. *Verified by reading the code path; confirm in a browser
against a seeded workspace before shipping.*

### 7.1 Tier A — adopt now, seam exists

| # | Item | Doc § | Why it fits |
|---|---|---|---|
| A1 | Fix `mappable` persistence (§7.0) | §6 | Restores a guard we already wrote |
| A2 | Split into `allow_manual_journal` + `allow_direct_transaction` | §6.1/6.2 | `mappable` conflates *auto-mapping eligibility* with *human-postability*. Two flags, enforced in `buildManualJournal()`, `isSelectable()`, and the `chart_of_accounts` rules validator. `accounting-journal-new.js:58` reads `getChartOfAccounts` **raw** — no picker, no filter — so the manual-journal editor needs its own enforcement |
| A3 | Nightly reconciliation assertions #1/#2/#5 + global Σdr==Σcr | §10 | Infra exists: `onSchedule` in `functions/index.js` (`sendTrialEndingReminders` is the pattern) and `reconcile-ledger-balances.js` already computes the math. Default-off flag first, per `feedback_email_blast_caution` |
| A4 | `GL_*` structured error codes | §7 | Needed anyway — `dashboard-i18n.js` wants stable keys, and every A2 block needs a distinguishable Bahasa message |
| A5 | Suspense as a **liability** + "Suspense = 0" close gate | §5.3/§6.2 | `closeChecklist` already exists at [db-service.js:5488](assets/js/db-service.js#L5488); adding a gate is additive |
| A6 | Rounding account + FX gain/loss wiring to `7200` | §5.10/§9 | `7200` is already seeded and unused; multi-currency invoices are live |

A3 is the highest value per unit of work: it directly de-risks the blocked Phase 2 cutover, and
it is the compensating control that makes our client-side posting position defensible.

### 7.2 Tier B — adopt the concept, adapt to our stack

- **§8 DB-level constraints** → not portable. Firestore rules can't sum `lines[]`. The honest
  substitute is A3 plus a decision on server-side posting (§4.6).
- **§5.9 soft vs hard close** → we have `open`/`closed`/`locked` already; what's missing is the
  soft-close *semantics* (warn + advisor confirm rather than block).
- **Bank accounts as ledger children** (`1020–1029` per `bank_accounts` doc) → already specified
  in `CHART_OF_ACCOUNTS_STRATEGY.md`; prerequisite for assertion #5 to mean anything per-account.
- **Payment gateway clearing** (doc `640`; our `1030`) → higher priority than the doc implies,
  because the Commerce Integration Platform has shipped and marketplace settlement float has
  nowhere correct to sit today.

### 7.3 Tier C — defer, already has an activation trigger

M6 Inventory · M7 Fixed Assets · M8 Payroll · M9 Expense Claims · M10 Projects · M13 Dimensions ·
GRNI + PO/goods receipt · credit/debit notes · quotes/sales orders. All of these are Tier-2/3
activations in `CHART_OF_ACCOUNTS_STRATEGY.md` §C, gated on real user signals. This document is
not a reason to pull them forward.

### 7.4 Tier D — do not take

- **Xero's account numbering** — violates the append-only invariant; breaks every mapping,
  journal line, and `ledger_balances` doc id.
- **§8 as literal DDL** — Postgres, not Firestore.
- **§10's 12-sprint build order** — assumes greenfield; sprints 1–8 are already shipped.
- **§5.9's computed-only year-end roll** — a genuine decision, not an obvious improvement. We
  post physically and reverse on reopen; changing it is a migration, not a patch.

### 7.4a Status — Tier A SHIPPED 2026-08-02

All of Tier A landed except A6, which was dropped on evidence (below). What
changed against the plan, and why:

| Planned | Actual | Why |
|---|---|---|
| Two flags added alongside `mappable` | Done, and `mappable` **kept as a third, independent** flag | They gate different things. `mappable` = auto-mapping target; `allow_direct_transaction` = human may pick it on a document. `2800 Suspense` is deliberately unmappable *and* hand-codeable, which is why the picker's old `is_system && mappable === false` test was removed rather than kept. |
| Assert Inv-A / Inv-B (`mappable:false ⟹ dtx:false`, etc.) | **Dropped**; the explicit per-account flag matrix is asserted instead | Both "invariants" were generalisations from the then-current seed, and Suspense breaks both. Pinning the actual policy per code is stronger and doesn't encode an accident. |
| A6 Rounding + FX | **Not shipped** | `_postSourceJournal` excludes all non-IDR docs from the kernel, so there is no FX position to revalue and nothing for `7200` to attach to. |
| — | **Added: a build guard for `SCHEDULED_FUNCTIONS`** | The list had no guard, so a new cron silently registered on the marketing site too. `assertScheduledFunctionsClassified()` now fails the build, matching the page-classification guard. |
| — | **Added: per-item try/catch in `_postCollectedSources`** | One malformed source aborted the entire sweep. New engine throws widened that blast radius. |

Two existing tests encoded the **old** contract and were updated deliberately, not
worked around:
- `accounting-engine.spec.js` asserted an explicit `account_code: '2100'` (PPN
  Output) is honoured "regardless of type — the engine trusts a real chosen code".
  That is precisely what §6 argues against; it now asserts `GL_011`.
- `accounting-journal-manual.spec.js` / `coa-create-account.spec.js` balanced a
  manual journal against `1000` Cash. Cash is now closed to manual journals, so
  they use `2500 Deferred Revenue` — an accrual, which is what the workflow is for.

**Known pre-existing failure, unrelated:** `ledger-edit-account.spec.js:99` ("an
account chosen by hand survives a later category edit") fails on a clean tree too —
verified by stashing. Not introduced here.

**Still manual before this is live**, in this order:

1. `node scripts/ledger-assert-report.js` (read-only) — see the findings *before*
   the cron does. Expect `journal_coverage` failures on the workspaces that were
   never backfilled; that is the check working, not a defect.
2. `firebase deploy --only firestore:rules` — the `ledger_integrity_reports` block.
3. `LEDGER_ASSERT_ENABLED=true` on the **app** site only.

### 7.4b 🔴 Commerce revenue debits Cash at order time — account seeded, NOT wired

Found 2026-08-03 while adding the clearing account. **This is a live defect**, not
a latent one: `COMMERCE_ENABLED` and `COMMERCE_SYNC_ENABLED` are both `true` in
production.

`finance-map.js` emits the order-level revenue entry as `type: 'income'`
([finance-map.js:62](netlify/functions/lib/commerce/finance-map.js#L62)), which
selects `TXN-INC-CASH` → **Dr 1000 Cash & Bank / Cr 4000 Revenue**. But at order
time the money is still with the marketplace. The payout arrives later as a
settlement, mapped to `type: 'transfer'` — and transfers **do not post at all**.

Consequences for any workspace with a marketplace connected:
- **Cash is overstated** from order date onward, by the full unsettled balance.
- **The bank reconciliation can never tie** — GL cash includes money that is not
  in any bank account, so assertion #5 in the nightly sweep is structurally
  unsatisfiable for these workspaces.
- Platform fees post as ordinary `fee` expense against cash that was never there.

**`1030 Payment Gateway Clearing` is now seeded for this**, with the spec's §6.1
policy (hand-codeable, closed to manual journals) and `sak_category:
'other_current_asset'` — deliberately not `cash_bank`, or it would re-create the
same overstatement one level down.

**It is seeded only. Wiring is a separate, QA'd change**, because it cannot be
done through the existing seams:

- `account_code` on a document overrides the *categorizing* (revenue) leg, not the
  cash leg, so the debit side cannot be redirected by mapping alone. It needs a new
  posting rule (`TXN-INC-CLEARING`: Dr 1030 / Cr Revenue) selected off a commerce
  marker such as `source: LEDGER_SOURCE`.
- Settlements must start posting `Dr 1000 Bank / Cr 1030` instead of being a
  non-posting `transfer`.
- Fees should clear against 1030, not cash (spec §5.1's two-step gateway example).
- Orders already posted the old way stay Dr Cash, so the change needs a decision
  about backfilling them or accepting a dated cutover.

Until that lands, treat `bank_balance` findings on commerce-connected workspaces as
expected, and do not "fix" them by adjusting the bank snapshot.

### 7.5 What the document has no place for — protect these

The doc is Xero-shaped and has no concept of: the **AI mapping resolution ladder** and vendor
memory (`CHART_OF_ACCOUNTS_STRATEGY.md` §E), **workspace scoping**, **Bahasa-first UX**, the
**readiness/confidence score**, or category-as-user-vocabulary over accounts. Any §6 enforcement
must be additive to these — in particular, `allow_direct_transaction` must not start blocking
accounts the AI ladder legitimately resolves to.
