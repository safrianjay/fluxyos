# FluxyOS Accounting Discovery Strategy

**Status:** Foundational product strategy — guides the accounting discovery phase with the founding finance/accounting expert.
**Companions:** [ACCOUNTING_EXPERT_INTERVIEW_GUIDE.md](ACCOUNTING_EXPERT_INTERVIEW_GUIDE.md) (the working tool for expert sessions) and [CHART_OF_ACCOUNTS_STRATEGY.md](CHART_OF_ACCOUNTS_STRATEGY.md) (the CoA deep-dive).
**Date:** July 2026.

---

## 0. Read This First: FluxyOS Is Not Greenfield

Most "accounting discovery" frameworks assume the team is learning accounting from zero before building. That framing is wrong for us, and adopting it would waste the expert's time.

FluxyOS already ships a working double-entry accounting kernel:

| Capability | Status | Where |
|---|---|---|
| Chart of accounts (19-account IDR seed) | ✅ Shipped | `CHART_OF_ACCOUNTS_SEED`, `assets/js/accounting-engine.js` |
| Immutable journals, `JE-YYYY-NNNNNN` numbering | ✅ Shipped | `journals` + `counters`, kernel section of `assets/js/db-service.js` |
| Trial balance (`ledger_balances`, incremented atomically) | ✅ Shipped | db-service kernel + Accounting Center (`accounting.html`) |
| Fiscal periods with close/reopen (net income → 3000 Retained Earnings) | ✅ Shipped | `periods`, `closePeriod()` / `reopenPeriod()` |
| Manual journal entries (Draft → Posted → Reverse) | ✅ Shipped | `accounting-journal-new.html`, `createManualJournalDraft` / `postManualJournal` / `reverseJournal` |
| Category → GL account mapping | ✅ Shipped | `accounting_mappings` (resolution order: mapping → category default → type default → `6999`) |
| Indonesian Tax Center (PPN in/out, PPh withholding, UMKM 0.5% vs 22%, SPT/Bukti Potong exports) | ✅ Shipped | `assets/js/tax-engine.js`, `tax-center.html` |
| Invoices with accrual posting (finalize = Dr A/R / Cr Revenue; payment = Dr Cash / Cr A/R) | ✅ Shipped | `assets/js/invoices.js`, rules `INV-ISSUE` / `INV-PAY` |
| Bills with accrual posting (Dr Expense / Cr A/P; payment settles A/P) | ✅ Shipped | rules `BILL-ACCRUE` / `BILL-PAY` |
| Multi-currency invoices (USD/SGD, integer minor units, FX conversion at payment) | ✅ Shipped | `money-format.js`, `fx-rate.js` |
| AI receipt/bill/statement extraction (extract-to-review, never auto-save) | ✅ Shipped | `netlify/functions/api.js`, `document-capture.js`, `bank-statement-import.js` |
| Income Statement preview, Phase-1 Balance Sheet, report packs + CSV/PDF export | ✅ Shipped | `report-builder.js`, `balance-sheet.html`, `reports.html` |
| Commerce → ledger pipeline (normalized orders post journals via sweep) | ✅ Shipped (flags off) | `netlify/functions/lib/commerce/`, `postPendingJournals` |
| `accountant` role + accounting capabilities (`accounting.post`, `period.close`, `journals.manual`) | ✅ Shipped | `assets/js/perms-service.js` |

> Note: `docs/PROJECT_BACKGROUND.md` §4m still describes the Accounting Center as "Phase 1, read-only, no journal posting." That is stale — §4m.3 (kernel), §4o (tax), §4p reflect the current state. Update §4m when convenient.

**What this means for discovery:** the question is not "how does accounting work?" It is:

1. **Is what we built correct?** A CPA-grade expert stress-testing our posting rules, period close, tax derivation, and statement construction.
2. **Is what we built trustworthy?** Would an external accountant sign off on books produced by FluxyOS? What's missing before they would?
3. **What did we not build?** The genuine gaps: real bank reconciliation, close checklist, AP/AR aging, COGS/inventory, fixed assets/depreciation, payroll, equity section, multi-entity.
4. **Where does the "Finance OS above accounting software" positioning actually earn its keep?** Which workflows do accountants do *outside* Xero/Jurnal/Accurate today (Excel, WhatsApp, email) that FluxyOS can own?

---

## 1. Discovery Strategy

### 1.1 Objectives

1. **Validate the kernel.** Have the expert audit our posting rules, close logic, tax derivation, and statements against how a practicing Indonesian accountant would keep books for an SMB. Output: a defect/gap list ranked by "blocks accountant sign-off" severity.
2. **Map the real month-end.** Document, step by step, how the expert (and peers) actually close a month for an Indonesian SMB — tools, sequence, checks, time spent, what goes wrong. Output: an as-is close map we design against.
3. **Define the trust bar.** Learn exactly what evidence an accountant needs to trust software-produced books (audit trail, immutability, reconciliation proof, statement tie-outs). Output: a "trust checklist" that becomes product requirements.
4. **Find the OS wedge.** Identify the work accountants do *around* their accounting software — the Excel/WhatsApp/PDF layer — because that is FluxyOS's positioning. Output: 3–5 candidate workflows where FluxyOS replaces the glue, not the ledger.
5. **Scope AI safely.** Determine which accounting judgments can be AI-suggested vs. must remain human-confirmed, and what review UX accountants would accept. Output: an AI autonomy ladder per workflow.

### 1.2 What success looks like

- Every major kernel design decision (see §1.3) has been explicitly confirmed, amended, or rejected by the expert — none remain implicit.
- We have a written as-is month-end close workflow for at least two business archetypes (services SMB, commerce/inventory SMB), with time-per-step estimates.
- A prioritized backlog exists where each item traces to an expert-validated pain point, not a competitor feature list.
- We can answer, in one sentence each: *what makes an accountant trust books*, *what makes a founder understand them*, and *where those two needs conflict in our UX*.
- The 6-month roadmap (§8) survives contact with the expert with at most re-ordering, not re-invention.

### 1.3 The assumptions we must validate (ranked)

These are not hypothetical — each is a design decision already shipped. Discovery must confirm or correct them before we build further on top.

1. **Cash-first UX over a double-entry core is the right abstraction.** Users enter a single "transaction"; `buildJournal()` fans it out into balanced lines invisibly. Assumption: founders never need to see debits/credits, and accountants can live with generated journals plus a manual-JE escape hatch. *Risk if wrong:* accountants reject generated books; founders mistrust numbers they can't trace.
2. **A fixed 6-category list bridged via `accounting_mappings` is enough for SMBs.** (`Revenue, Marketing, Infrastructure, Operations, SaaS, Others` → GL codes.) Assumption: category-level granularity satisfies management reporting and, via mappings, statutory reporting. *Risk if wrong:* "Others"/`6999` becomes a dumping ground and the P&L is useless. This is the central question of [CHART_OF_ACCOUNTS_STRATEGY.md](CHART_OF_ACCOUNTS_STRATEGY.md).
3. **Client-side posting with Firestore rules as the integrity boundary is acceptable.** Rules verify Σdebit == Σcredit on totals but cannot sum `lines[]`; compensating controls are the Trial Balance view and `scripts/reconcile-ledger-balances.js`. Assumption: for the SMB segment, detective controls suffice until posting moves server-side. *Risk if wrong:* a single corrupted journal discovered by an auditor destroys trust permanently. Ask the expert: what integrity evidence would an auditor demand?
4. **Revenue recognition at invoice finalize (accrual) coexisting with cash-flavored dashboard KPIs won't confuse anyone.** `INV-ISSUE` posts Dr A/R / Cr Revenue at finalize, but `getDashboardStats` KPIs are largely cash-based, and the Income Statement preview reads transactions only. Assumption: the accrual/cash split is coherent. *Risk if wrong:* "why doesn't my dashboard match my P&L?" — the single most corrosive question in accounting software.
5. **Foreign-currency invoices can stay outside the kernel.** USD/SGD invoices are `accounting_status: 'excluded'` — no journal, no PPN — and only the IDR payment posts. Assumption: FX-billing SMBs accept this v1. *Risk if wrong:* exporters (a large Indonesian SMB segment) can't close books in FluxyOS at all.
6. **Tax as derived journal lines (never a parallel ledger) matches how Indonesian accountants work.** *Risk if wrong:* rework of the entire Tax Center. Early signal is good (it mirrors standard practice) but PPN edge cases — credit notes, DPP adjustments, e-Faktur mismatches — need expert review.
7. **Extract-to-review is the right AI ceiling for now.** No AI writes to the ledger autonomously. Assumption: review friction is acceptable and the trust dividend is worth it. Validate where accountants would *want* auto-posting (e.g., recurring vendor bills) and what guardrails would make it acceptable.

### 1.4 What we must learn before building more features

- The **complete month-end close checklist** an accountant actually runs (our `closePeriod()` posts one closing journal; a real close is 15–40 checklist items *before* that button is pressed).
- How **bank reconciliation is really done** in Indonesia (BCA/Mandiri/BNI statement formats, e-wallet and payment-gateway settlements, timing differences) — our import exists, but matching statement lines to ledger entries (the actual reconciliation) is explicitly deferred (`bank_account_id` is always null today).
- Whether our **A/R and A/P representations** (invoice docs + `pending_receivable`/`pending_payable` transaction types + unpaid bills) can support real aging reports and collections workflows, or whether we need first-class subledgers.
- **Where COGS comes from** for our target customers: perpetual inventory, periodic counts, or "accountant journal at month-end"? This decides whether inventory is a Phase-2 feature or a Phase-4 module.
- The **actual division of labor** between founder, internal admin, and external accountant/tax consultant in Indonesian SMBs — this decides who our accounting UI is for and what the `accountant` role should see.

---

## 2. Accountant Knowledge Map

Each domain: why it exists → what accountants actually do → pain points → AI opportunity → **FluxyOS status** (✅ shipped / 🟡 partial / ❌ gap).

### 2.1 Bookkeeping
- **Why:** every economic event must be recorded completely, accurately, and timely; everything downstream (statements, tax, decisions) inherits its quality.
- **What accountants do:** collect source documents, enter/import transactions, classify them, chase missing receipts, fix duplicates.
- **Pain:** documents scattered (WhatsApp photos, email PDFs, marketplace dashboards); data entry is 30–60% of SMB accounting time; classification inconsistency between people.
- **AI:** extraction, duplicate detection, suggested classification, missing-document chasing.
- **FluxyOS:** 🟡 Strong capture (AI receipt/bill/statement extraction, commerce auto-ingest, `Missing Receipt` status) but classification is a fixed 6-category list and there's no "unrecorded document inbox" concept.

### 2.2 Journal Entries
- **Why:** the atomic unit of double-entry — every event becomes balanced debit/credit lines, making the books internally consistent and auditable.
- **What accountants do:** mostly rely on system-generated entries; manually book accruals, prepayments, depreciation, corrections, payroll summaries; review the journal register at close.
- **Pain:** manual JEs are error-prone (wrong side, wrong period); recurring JEs re-keyed monthly; correction entries obscure history.
- **AI:** draft recurring/accrual JEs, flag unbalanced or unusual entries, explain any journal in plain language.
- **FluxyOS:** ✅ System journals for every posting flow + manual JE editor with Draft→Posted→Reverse lifecycle. ❌ No recurring JE templates, no accrual/prepayment schedules.

### 2.3 General Ledger
- **Why:** the account-by-account book of record; the trial balance proves Σdebits = Σcredits.
- **What accountants do:** scan GL detail for misclassifications, run trial balance at close, drill from statement line → account → journal → source document.
- **Pain:** drill-down chains break (statement doesn't tie to GL, GL entry has no source doc); noisy accounts (suspense, "misc") hide errors.
- **AI:** anomaly scan of GL activity (new account usage, unusual amounts, wrong-sign balances), narrated variance explanations.
- **FluxyOS:** ✅ `ledger_balances` trial balance + GL views in Accounting Center; journals link back to source docs (`journal_ref`). 🟡 Drill-down exists but the statement→GL→document chain should be a discovery test case with the expert.

### 2.4 Chart of Accounts
See [CHART_OF_ACCOUNTS_STRATEGY.md](CHART_OF_ACCOUNTS_STRATEGY.md) — treated as a first-class foundation with its own document. Summary status: ✅ seeded 19-account CoA wired to posting; ❌ no COGS, inventory, fixed assets, payroll, loans, deferred revenue, or owner equity accounts; ❌ no user-facing CoA editing.

### 2.5 Accounts Payable
- **Why:** track what the business owes, when, to whom — protects cash and vendor relationships.
- **What accountants do:** capture bills, verify against PO/receipt (three-way match at larger firms), schedule payments, take early-payment discounts, reconcile vendor statements, produce A/P aging.
- **Pain:** approval by WhatsApp/email; duplicate payments; missed due dates; vendor statement reconciliation done in Excel.
- **AI:** bill extraction (✅ have), duplicate-bill detection, payment-run suggestions, vendor statement reconciliation.
- **FluxyOS:** 🟡 Bills with due dates, accrual posting to `2000 A/P`, `markBillPaid` settlement, budget-commitment tracking. ❌ No A/P aging report, no approval workflow, no payment runs, no vendor subledger/statement recon.

### 2.6 Accounts Receivable
- **Why:** track what customers owe; A/R quality drives SMB survival (cash dies in receivables).
- **What accountants do:** issue invoices, track aging, chase payment (dunning), apply cash receipts to invoices, assess doubtful debts.
- **Pain:** cash application (which payment settles which invoice, especially partial/combined payments); chasing is manual and awkward; bad-debt judgment.
- **AI:** payment-to-invoice matching, dunning drafts calibrated to customer history, collection-risk scoring.
- **FluxyOS:** 🟡 Invoice lifecycle with proper A/R posting and email delivery. ❌ No partial payments (explicit v1 exclusion), no aging report, no dunning, no cash-application flow (payment marking is manual per invoice).

### 2.7 Revenue Recognition
- **Why:** revenue must be recorded when *earned*, not when cash arrives (PSAK 72 / IFRS 15); the single most manipulated number in accounting.
- **What accountants do:** for SMBs, mostly simple (recognize at invoice/delivery); for subscriptions/projects, deferral schedules and percentage-of-completion in spreadsheets.
- **Pain:** deferred revenue schedules in Excel; marketplace revenue recognized at payout instead of order (wrong period, understated fees).
- **AI:** infer recognition pattern from invoice terms; auto-build deferral schedules; flag revenue posted to wrong period.
- **FluxyOS:** 🟡 Invoice-finalize recognition is correct for services. ✅ Commerce pipeline records order revenue and fees separately (not net payout) — genuinely better than most SMB practice. ❌ No deferred revenue account or schedules (relevant to any customer selling annual plans — including ourselves).

### 2.8 Expense Recognition
- **Why:** matching principle — expenses belong in the period that benefits, driving accruals and prepayments.
- **What accountants do:** book accruals for un-invoiced costs, spread prepaids (rent, insurance, annual SaaS), reverse accruals next period.
- **Pain:** entirely manual, entirely recurring, entirely forgettable — a top source of month-end adjustments.
- **AI:** detect annual-payment patterns ("this Rp24.000.000 hosting invoice covers 12 months — spread it?"), auto-generate accrual/reversal pairs.
- **FluxyOS:** 🟡 Bills give accrual-at-bill; `pending_payable` type exists. ❌ No prepaid asset account, no amortization schedules, no auto-reversing accruals.

### 2.9 Cash vs Accrual Accounting
- **Why:** two answers to "when did this happen?" Cash = survival view; accrual = performance view. Indonesian SMBs live in cash; statutory reporting and any serious analysis need accrual.
- **What accountants do:** keep accrual books, then explain cash to the owner ("profit ≠ bank balance").
- **Pain:** the perennial owner conversation; software that picks one basis and hides the other.
- **AI:** narrated bridge ("Profit Rp120jt but cash down Rp40jt because A/R grew Rp90jt and you paid Rp70jt of old bills").
- **FluxyOS:** 🟡 Architecturally strong — we hold *both* (cash-impact fields `cash_effective`/`cash_status` on transactions AND accrual journals). ❌ The two views aren't presented as a coherent, reconciled pair; dashboard KPIs are cash-flavored while the P&L preview and kernel are accrual-flavored. This is assumption #4 in §1.3 and a priority discovery topic.

### 2.10 Month-End Closing
- **Why:** freezes a period so its numbers are final, comparable, and reportable; the accountant's core recurring deliverable.
- **What accountants do:** a checklist: all documents in → bank/e-wallet recs done → A/R and A/P subledgers tie to GL → accruals/prepaids/depreciation booked → tax computed → statements reviewed → period locked. Typically 3–10 working days for an SMB.
- **Pain:** waiting on missing documents; no single view of "what's left"; late changes reopening finished work.
- **AI:** close orchestration ("7 of 12 steps done; blocked on 3 unreconciled bank lines and 2 missing receipts"), pre-close anomaly review.
- **FluxyOS:** 🟡 We have the *mechanism* (period close/lock, closing journal to Retained Earnings, `_assertEditablePeriod` blocking edits into closed periods — this is ahead of most SMB tools) but not the *process*: no close checklist, no readiness signals, no task assignment. **This is likely our single biggest near-term product opportunity** (§7, §8).

### 2.11 Financial Statements
- **Why:** the standardized outputs — P&L, Balance Sheet, Cash Flow — that owners, banks, investors, and DJP consume.
- **What accountants do:** generate from the trial balance, adjust presentation, verify tie-outs (net income → equity; cash on BS → bank rec), add notes.
- **Pain:** statements that don't tie to each other; SMB tools that produce a P&L but a useless or absent balance sheet; cash-flow statements almost never produced for SMBs despite being the owner's real question.
- **AI:** plain-language statement explanation; automatic tie-out verification; drafting SAK EMKM-format statements for statutory use.
- **FluxyOS:** 🟡 Income Statement preview (transactions-only, explicitly "not GAAP/IFRS-ready") + Phase-1 Balance Sheet ("Net Position", not a real equity section) + report packs. ❌ Kernel-derived statements (from `ledger_balances`, not raw transactions), a true equity section, and a cash flow statement. The gap between "preview" statements and kernel-derived statements is a key expert topic: when do we switch the source of truth?

### 2.12 Bank Reconciliation
- **Why:** the bank statement is the only *external* truth the books can be checked against; reconciliation is the control that catches missing, duplicate, and fraudulent entries.
- **What accountants do:** match statement lines to ledger entries, investigate unmatched items (timing vs error), book adjustments (bank fees, interest), certify the ending balance ties.
- **Pain:** manual matching in Excel; one-to-many matches (one settlement = many orders); e-wallet/payment-gateway accounts that behave like banks but have no statements in bank formats.
- **AI:** auto-matching with confidence tiers (exact → fuzzy amount+date → many-to-one), explanation of unmatched items, learned matching rules.
- **FluxyOS:** 🟡 Statement import with AI extraction, balance-equation checks, duplicate flags, confirm-to-ledger — but **no statement-line ↔ ledger-entry matching** (the actual reconciliation) — explicitly deferred Phase 3; `bank_account_id` on imports is always null; `bank_balance_snapshots` is manual history. **The most important unfinished workflow in the product** — without it, every downstream number is unverified.

### 2.13 Fixed Assets & Depreciation
- **Why:** long-lived purchases are capitalized and expensed over useful life (matching); also tax-relevant (Indonesian fiscal depreciation groups differ from book).
- **What accountants do:** maintain an asset register (cost, date, life, method), book monthly depreciation, handle disposals, track book-vs-fiscal differences.
- **Pain:** the register is almost always Excel; monthly JE forgotten; disposal accounting botched.
- **AI:** detect capitalizable purchases from bills ("Rp35jt laptop purchase — capitalize over 4 years?"), auto-generate depreciation schedules and JEs.
- **FluxyOS:** ❌ Nothing — no asset accounts, register, or depreciation. Everything is expensed. Discovery question: how much does this matter for our segment vs being an accountant-only need?

### 2.14 Inventory Accounting
- **Why:** goods bought for resale are assets until sold; COGS = the cost of what was sold; valuation method (FIFO/average) affects profit.
- **What accountants do:** for SMBs, mostly *periodic*: count stock, compute COGS = opening + purchases − closing, book one JE. Perpetual systems track per-SKU cost continuously.
- **Pain:** counts vs records never match; marketplace sellers rarely know true per-unit cost; landed costs ignored.
- **AI:** COGS estimation from commerce order data, shrinkage anomaly detection, landed-cost allocation.
- **FluxyOS:** ❌ No inventory account or COGS accounts (COGS defaults to 0 in the Income Statement unless a mapping reclassifies a category). Given commerce integrations are our differentiator, **inventory/COGS is a strategic hole, not an edge case** — but the *periodic* method (monthly count + one JE) may be a cheap v1. Ask the expert.

### 2.15 Payroll
- **Why:** usually the biggest expense; heavy compliance (PPh 21, BPJS Kesehatan/Ketenagakerjaan); errors hit both employees and the tax office.
- **What accountants do:** compute gross-to-net, withhold PPh 21, remit BPJS, book the summary JE (gross salary expense, withholding liabilities, net cash).
- **Pain:** PPh 21 TER rate complexity; BPJS tier updates; the summary JE misbooked (net instead of gross).
- **AI:** anomaly checks on payroll runs, JE generation from payroll-provider exports.
- **FluxyOS:** ❌ Nothing. Recommendation: **do not build payroll** in the discovery horizon — integrate/import (Gadjian, Talenta, Catapa exports → summary JE template). Validate with expert.

### 2.16 Taxes (Indonesia)
- **Why:** PPN (11%/12% VAT with input crediting), PPh withholding (21/23/4(2)), corporate PPh (UMKM final 0.5% vs ordinary 22%), monthly + annual SPT cadence; Coretax is the new DJP system.
- **What accountants do:** determine PKP status and obligations, compute monthly PPN (output − creditable input), prepare/file SPT, reconcile e-Faktur data to books, manage bukti potong.
- **Pain:** e-Faktur/Coretax reconciliation to books; withholding certificates from customers arriving late or never; UMKM threshold transitions.
- **AI:** flag transactions with tax anomalies (missing NPWP, wrong rate), draft SPT numbers with full traceability, e-Faktur ↔ ledger recon.
- **FluxyOS:** ✅ Genuinely strong: Tax Center with PPN/PPh accounts on the CoA, tax lines derived onto business-document journals (never a parallel ledger), tax periods with compute/file/lock, SPT PPN + Bukti Potong CSV exports, UMKM vs ordinary regimes. 🟡 Coretax/e-Faktur integration blocked on DJP API access. Expert should stress-test edge cases: credit notes, PPN on FX invoices (currently excluded — a real conflict), PPh 21.

### 2.17 Audit Process
- **Why:** external verification that statements are fairly presented; even unaudited SMBs face lender due diligence and tax audit (pemeriksaan pajak).
- **What accountants do:** prepare schedules that tie every statement line to support; answer sample requests (show me the invoice behind this entry); explain adjustments.
- **Pain:** assembling support is archaeology; entries with no attached document; books modified after the fact.
- **AI:** auto-assembled audit binders (statement line → GL → journal → source document, exported), completeness scoring per account.
- **FluxyOS:** 🟡 Good bones — immutable journals, append-only `audit_logs`, document attachments, period locks. ❌ No "audit pack" export assembling the chain. Cheap to build, high trust value.

### 2.18 Internal Controls
- **Why:** prevent/detect error and fraud — segregation of duties, approvals, access limits, mandatory documentation.
- **What accountants do (SMB reality):** the owner approves everything informally; the accountant is the de facto control.
- **Pain:** one person can create a vendor, book its bill, and pay it; approvals live in chat with no record.
- **AI:** control-exception monitoring ("this user both created and paid 14 bills this month"), unusual-pattern alerts.
- **FluxyOS:** 🟡 Roles/capabilities (incl. `accountant`), audit logs, period locks. ❌ No approval workflows, no threshold rules, no duty-separation checks. Enterprise-phase material, but ask the expert which single control matters most for SMBs.

### 2.19 Multi-Entity Accounting
- **Why:** businesses split into PTs/CVs for tax, licensing, or liability; each needs its own books; owners need a consolidated view with intercompany eliminations.
- **Pain:** intercompany balances never match; consolidation in Excel; the same vendor booked differently per entity.
- **FluxyOS:** ❌ Workspaces are single-entity (journals carry `entity_id` — a useful seam, but no multi-entity product). Phase-4 material; discovery should only size how common multi-entity is in our segment.

### 2.20 Budgeting
- **Why:** the plan the actuals are judged against; for SMBs, mostly spend control.
- **FluxyOS:** ✅ Unusually strong for our stage — annual→period budgets, category allocations, bill *commitment* tracking (committed/released/converted_to_actual — genuinely rare in SMB tools). 🟡 Budgets speak "category" while the kernel speaks "account"; as the CoA grows richer they must stay linked through the same mapping seam.

### 2.21 Forecasting
- **Why:** cash forecasting is the SMB's real survival question ("can I make payroll in 6 weeks?").
- **What accountants do:** 13-week cash flow in Excel from known A/R, A/P, recurring items, plus judgment.
- **FluxyOS:** ❌ No forward view — yet we hold every ingredient: invoice due dates (cash in), bill due dates + subscriptions (cash out), bank balances (position), commerce settlement patterns. **The most differentiating cheap-ish feature available to us** — a data-assembly problem, not an accounting problem, sitting exactly in our "Finance OS" positioning.

### 2.22 Financial Analysis
- **Why:** turning statements into decisions — margins, trends, unit economics, ratios.
- **FluxyOS:** 🟡 Dashboard KPIs, KPI drill-down pages, comparison periods, Fluxy AI narration over a deterministic engine (the right architecture — AI never invents numbers). ❌ Analysis is only as good as classification; today's 6 categories cap its resolution.

---

## 3. Accounting Workflow Mapping: The Lifecycle of Financial Data

The canonical chain, annotated with what implements each step today and where the chain breaks:

```
Business Event → Source Document → Capture → Validation → Classification
   → Journal Entry → General Ledger → Reconciliation → Financial Statements
   → Management Reporting → Tax → Audit
```

**1. Business Event.** A sale, purchase, payment, payroll run, loan drawdown. *FluxyOS entry points:* manual entry modals, invoice/bill creation, commerce order sync, bank statement import. *Break:* events with no capture path (payroll, loans, asset purchases beyond simple expensing) either get shoehorned into "expense" or never recorded.

**2. Source Document.** Invoice, receipt, contract, statement — the audit evidence. *FluxyOS:* `documents` collection + Storage; `Missing Receipt` status; receipts via Receipt Capture. *Break:* no document-first inbox — you can't forward a PDF to FluxyOS and have it wait as an unprocessed item; capture starts from the transaction side.

**3. Data Capture.** Getting the document's facts into the system. *FluxyOS:* AI extraction for receipts/bills (`/api/v1/bills/extract`), statements (PDF via OpenAI, CSV/XLSX deterministic), commerce API sync. All extract-to-review — never auto-saved. *Strength:* this is genuinely competitive already.

**4. Validation.** Is it real, complete, non-duplicate, arithmetically correct? *FluxyOS:* statement imports run balance-equation + running-balance checks and duplicate flags; commerce writes use deterministic IDs (idempotent). *Break:* no duplicate detection on manually entered or receipt-scanned transactions; no vendor-bill duplicate check (same vendor+amount+date).

**5. Classification.** Which account/category, which period, which tax treatment. *FluxyOS:* fixed 6-category list; `suggested_category` from AI extraction; `accounting_mappings` bridges to GL; tax engine derives PPN/PPh treatment. *Break:* the granularity ceiling — see [CHART_OF_ACCOUNTS_STRATEGY.md](CHART_OF_ACCOUNTS_STRATEGY.md).

**6. Journal Entry.** The balanced double-entry record. *FluxyOS:* `buildJournal()` in `accounting-engine.js` — pure rules (`TXN-INC-CASH`, `TXN-EXP-CASH`, `BILL-ACCRUE`, `BILL-PAY`, `INV-ISSUE`, `INV-PAY`, accrual types), written atomically with the source doc; commerce/import rows post later via the `postPendingJournals` sweep; manual JEs for everything else. *Break:* posting is client-side (trust boundary, §9); no recurring/reversing JE automation.

**7. General Ledger.** Balances accumulate per account per period. *FluxyOS:* `ledger_balances` via atomic increments; trial balance in the Accounting Center; `reconcile-ledger-balances.js` as the detective control. *Break:* if a client bypasses the seam, `ledger_balances` and `journals` can drift — the script catches it after the fact, nothing prevents it.

**8. Reconciliation.** Prove internal records against external truth. *FluxyOS:* ❌ **the broken link.** Import exists; matching does not (Phase 3 deferred). No statement-line ↔ ledger-entry matching, no reconciliation status on transactions, no certified ending balances. Until this exists, statements are "what we recorded," not "what we verified."

**9. Financial Statements.** *FluxyOS:* Income Statement preview (transactions-only), Phase-1 Balance Sheet (Net Position), report packs. *Break:* statements don't derive from the kernel (`ledger_balances`) yet, so the trial balance and the P&L can disagree; no equity section; no cash flow statement.

**10. Management Reporting.** The decision layer — KPIs, trends, comparisons. *FluxyOS:* dashboard KPIs, drill-down pages, comparison scopes, Fluxy AI + Weekly Digest. *Strength:* this layer is ahead of the accounting layer — unusual and worth preserving; most accounting tools have it backwards.

**11. Tax.** *FluxyOS:* Tax Center derives obligations from the same journals (compute → file → lock per `tax_periods`). *Break:* FX invoices excluded from PPN; Coretax integration blocked externally.

**12. Audit.** *FluxyOS:* immutable journals, audit logs, attachments, period locks — the raw material. *Break:* no assembled audit-pack export; the chain exists but must be walked by hand.

**The discovery exercise:** walk the expert through this chain for four archetypal events — (a) a cash sale, (b) an invoiced service sale paid 40 days later, (c) a marketplace order with fees settled weekly, (d) an imported bank statement month — and have them mark every step where they would *not yet* sign off.

---

## 4. Interview Framework

The full session-by-session guide, question banks (discovery / workflow / decision-making / validation / pain-point / edge-case / AI), artifact-review exercises, and findings templates live in **[ACCOUNTING_EXPERT_INTERVIEW_GUIDE.md](ACCOUNTING_EXPERT_INTERVIEW_GUIDE.md)** — kept standalone so it can be handed to the expert directly.

Structure summary: six themed sessions — (1) how you actually work + tool landscape, (2) transaction lifecycle & classification, (3) month-end close walkthrough, (4) kernel audit (hands-on with FluxyOS), (5) tax & compliance stress test, (6) AI boundaries & trust. Each session mixes open questions with concrete product artifacts to react to.

---

## 5. Feature Discovery Framework

Rules: nothing enters the backlog without an expert-validated user problem; each capability is written as *problem → existing workflow → desired workflow → opportunity → complexity → impact*. Classification below is a starting hypothesis for the expert to re-rank.

### 5.1 Core (accountants expect these; absence blocks trust)

| Capability | User problem | Existing workflow (today) | Desired workflow | Complexity | Impact |
|---|---|---|---|---|---|
| **Bank reconciliation (matching)** | "I can't prove my books match the bank" | Import creates transactions; matching done nowhere (or Excel) | Statement lines auto-match to ledger entries with confidence tiers; unmatched queue; certified ending balance | High (matching engine + recon state model; import base ✅ exists) | Critical — unlocks trust in every number |
| **Month-end close checklist** | "Closing is a memory game across tools" | `closePeriod()` button with no process around it | Guided checklist w/ auto-detected readiness (unreconciled lines, missing receipts, unposted journals), then close | Medium (orchestration over existing signals) | High — makes the close a product, not a button |
| **A/R + A/P aging** | "Who owes me / whom do I owe, how overdue?" | Invoice list + bill list, no aging buckets | Standard 30/60/90 aging from existing due dates; drill to doc | Low (data exists) | High — the most-requested SMB report |
| **Kernel-derived statements + equity section** | "P&L and trial balance disagree; balance sheet has no equity" | Preview statements from raw transactions | Statements from `ledger_balances`; retained earnings + owner capital/drawings; tie-out checks | Medium | High — accountant sign-off requirement |
| **Richer CoA + user-visible mapping** | "Everything is 'Operations' or 'Others'" | 6 categories → 19 accounts, `6999` fallback | See [CHART_OF_ACCOUNTS_STRATEGY.md](CHART_OF_ACCOUNTS_STRATEGY.md) | Medium | High |

### 5.2 Nice-to-have (differentiating for segments)

- **Recurring/reversing JE templates** (accruals, depreciation) — low complexity, high accountant delight.
- **Prepaid/deferral schedules** — auto-spread annual payments; medium complexity.
- **Cash application for partial/combined invoice payments** — removes the v1 no-partial-payments limit; medium.
- **Duplicate detection on manual/scanned entries** — low; extends the statement-import pattern.
- **Audit pack export** (statement line → journal → document, zipped) — low-medium; outsized trust signal.
- **Periodic inventory + COGS** (monthly count + computed COGS JE) — medium; strategic for commerce sellers.

### 5.3 Enterprise (Phase 4 horizon)

- Approval workflows & spend thresholds; multi-entity + consolidation (the `entity_id` seam exists); fixed-asset register with book/fiscal depreciation; server-side posting authority; accountant-firm multi-client console.

### 5.4 AI-first (where FluxyOS can lead rather than match)

- **Reconciliation matching assistant** — AI proposes matches; human confirms; rules learned from confirmations.
- **Close copilot** — monitors readiness continuously ("you could close today except for 3 items"), drafts standard adjusting entries.
- **13-week cash forecast** — assembled from invoices, bills, subscriptions, commerce settlements, balances; narrated by Fluxy AI.
- **Journal anomaly review** — pre-close scan: unusual amounts, wrong-sign balances, `6999` accumulation, period-boundary entries.
- **Explain-any-number** — every statement line answers "why?" with the deterministic drill-down chain, narrated.

---

## 6. Competitive Analysis

*(CoA-specific comparison lives in [CHART_OF_ACCOUNTS_STRATEGY.md](CHART_OF_ACCOUNTS_STRATEGY.md) §G.)*

### 6.1 Global players

**Xero.** Best-in-class bank feeds and reconciliation UX (the "reconcile" screen with suggested matches and learned rules is the industry benchmark — and the model for our Phase-3 recon). Accountant-channel distribution genius. Weaknesses: reporting customization, no meaningful AI beyond bank-rule suggestions, Indonesia localization absent (no PPN/e-Faktur).

**QuickBooks Online.** The SMB default in the US; strong ecosystem, receipt capture, and ML categorization that learns per-company. Weaknesses: creaking architecture, notorious auto-categorization overconfidence (silently miscategorized books that accountants must un-pick — a cautionary tale for our AI autonomy ladder), poor multi-currency at low tiers, no Indonesian localization.

**NetSuite.** The reference for real financial operations: subledgers, revenue recognition, multi-entity consolidation, role-based close management. Weakness: cost and implementation weight put it out of SMB reach — but its *concepts* (period close management, saved searches as reporting primitives) are worth stealing downmarket.

**SAP (B1/S4).** Deep controls and compliance; irrelevant UX for SMBs. Lesson: the audit-trail and authorization rigor that enterprises demand is what *trust* looks like at scale — we can offer the rigor without the pain.

**Odoo.** Modular ERP with accounting as one app; genuinely good CoA localization packs per country (including Indonesia). Weakness: jack-of-all-trades depth; SMBs without an implementation partner drown. Lesson: localization-as-content (CoA templates, tax rules per jurisdiction) is a scalable asset.

**Zoho Books.** Strong value, decent workflows (approvals at low tiers!), good API. Weakness: little accounting intelligence; reporting shallow. Lesson: approvals aren't inherently "enterprise."

**Wave.** Free, dead simple, founder-friendly. Lesson in radical simplicity — and in its ceiling: businesses graduate out the moment they need an accountant's trust.

**FreshBooks.** Service-business invoicing UX benchmark. Weakness: the accounting under it is thin (double-entry arrived late); accountants distrust it. Cautionary tale: **founder-friendly without accountant-trustworthy is a churn machine at exactly the moment customers grow.**

### 6.2 Indonesian incumbents (omitted from the original brief, but they are the real competition)

**Jurnal.id (Mekari).** The local leader: proper Indonesian CoA out of the box, PPN/e-Faktur workflows, local bank imports, accountant familiarity, and Mekari's ecosystem (Talenta payroll, Klikpajak tax). Weaknesses: dated UX, weak analytics/AI, no marketplace-operations layer.

**Accurate Online.** Deep Indonesian tax compliance, strong inventory; the choice of conservative accountants. Weakness: legacy desktop DNA, minimal automation.

**Kledo, Buku Warung/BukuKas (micro-segment).** Signal where the market's floor is: dead-simple cash recording for micro-merchants.

**The strategic read:** locals own *compliance trust*, globals own *workflow polish*, nobody owns *the operational layer* — marketplace settlements, cash forecasting, AI-assisted close, the Excel/WhatsApp glue. FluxyOS should not out-Jurnal Jurnal on tax filing forms; it should make Jurnal-class correctness a **kernel property** while winning on the operations layer above it. Our commerce → ledger pipeline (order-level revenue and fees, not net payouts) is already something none of them do well.

### 6.3 Differentiation summary

1. **Commerce-native accounting** — marketplace orders, fees, refunds, and settlements land in the ledger correctly and automatically. (Shipped foundation; extend with reconciliation of settlements to payouts.)
2. **AI with deterministic guarantees** — our planner → deterministic engine → narrator architecture means AI never invents a number. QuickBooks' overconfident ML is the anti-pattern; our extract-to-review + confidence-tier model is the trust-preserving path to more autonomy.
3. **The close as a product** — nobody in SMB does guided close well (NetSuite does it for enterprises).
4. **Forward-looking cash** — 13-week forecast from data we already hold; incumbents are all backward-looking.
5. **Bahasa-first, Indonesia-first correctness** — SAK/PPN/PPh built into the kernel, not bolted on.

---

## 7. AI Accounting Strategy

### 7.1 Principles (derived from what already works)

1. **Deterministic core, narrative shell.** Fluxy AI's architecture — LLM plans the question, a deterministic engine computes every number, the LLM only narrates validated results — generalizes to all accounting AI. **No AI-computed number ever reaches the ledger or a statement.**
2. **The autonomy ladder.** Every AI capability starts at *suggest* (human confirms), earns *confirm-by-default* (one-tap accept, per-workspace opt-in) through measured accuracy, and only reaches *auto-with-audit* for closed classes of decisions (e.g., exact-amount+date statement matches). The `confidence` field in `accounting_mappings` (`system_default` / `user_confirmed` / `ai_suggested`) is already the schema for this — `ai_suggested` is defined but unused: the ladder's first rung is sitting there waiting.
3. **Corrections are the moat.** Every human correction (remapped category, rejected match, edited extraction) is training signal scoped to the workspace (vendor → account memory) and, aggregated and anonymized, to the platform (`platform_learning` exists as a seam). Competitors can copy features; they can't copy accumulated correction data.
4. **Explainability is a feature, not documentation.** Every AI suggestion shows its evidence ("matched because: amount exact, date within 2 days, vendor string 91% similar").

### 7.2 Prioritized opportunities (by moat, not by demo value)

| Priority | Capability | Why it wins | Builds on |
|---|---|---|---|
| 1 | **Reconciliation matching** (suggest → confirm → learned rules) | Highest-labor task in bookkeeping; per-workspace learned rules compound; unlocks trust in all numbers | Statement import ✅, duplicate detection ✅ |
| 2 | **Close copilot** (readiness monitoring, blocking-item lists, drafted adjusting entries) | No SMB competitor has it; converts our period-close mechanism into a workflow product | Periods ✅, journals ✅, missing-receipt status ✅ |
| 3 | **Account-mapping intelligence** (vendor→account memory, rules, AI fallback with confidence) | Kills the `6999`/"Others" dumping ground; the correction loop compounds | `accounting_mappings` ✅, extraction `suggested_category` ✅ — design in [CHART_OF_ACCOUNTS_STRATEGY.md](CHART_OF_ACCOUNTS_STRATEGY.md) §E |
| 4 | **Cash forecast + narrated cash/accrual bridge** | The owner's actual question; pure differentiation; uses only data we hold | Invoices, bills, subscriptions, balances, commerce settlements ✅ |
| 5 | **Journal anomaly review** (pre-close scan) | Turns the kernel's rigor into visible safety; cheap on top of `ledger_balances` | Kernel ✅ |
| 6 | **Explain-any-number** (statement line → drill chain, narrated) | Trust and education in one feature; deepens founder/accountant shared understanding | Fluxy AI architecture ✅, `journal_ref` links ✅ |

Deliberately **not** prioritized: AI-generated statutory filings without human review (compliance risk), autonomous ledger posting (trust risk — see QuickBooks lesson), chat-based data entry as a primary flow (novelty, not labor savings).

### 7.3 What discovery must resolve for AI

- Where on the autonomy ladder would the expert place each workflow *today*, and what accuracy evidence would move it up a rung?
- What does an accountant need to see to accept an AI-proposed match/mapping in <2 seconds? (This defines the review UX.)
- Which corrections are safe to learn globally vs must stay workspace-local (e.g., vendor "PT ABC" maps to different accounts in different businesses)?

---

## 8. Product Roadmap

Sequenced by customer value and trust-building; each phase's items assume expert validation first. Engineering estimates deliberately omitted — this orders bets, not sprints.

### Phase 1 — Trustworthy Foundations (the "accountant sign-off" phase)
1. **Bank reconciliation Phase 3**: statement-line ↔ ledger matching, unmatched queue, recon status, `bank_accounts.latest_balance` finally wired. *(Everything else depends on verified numbers.)*
2. **Kernel-derived statements**: P&L and Balance Sheet from `ledger_balances`, real equity section (owner capital, retained earnings, current-year P&L, drawings), automatic tie-outs.
3. **CoA expansion + mapping UX** per [CHART_OF_ACCOUNTS_STRATEGY.md](CHART_OF_ACCOUNTS_STRATEGY.md): COGS, prepaid, fixed asset, payroll-liability, loan, deferred-revenue, equity accounts; vendor→account memory.
4. **A/R + A/P aging** (cheap, expected, high visibility).
5. **Month-end close checklist v1** (readiness signals over existing data; no AI needed yet).

### Phase 2 — Workflow Automation
1. Recurring/reversing JEs, prepaid amortization schedules.
2. Cash application (partial/combined invoice payments) + dunning basics.
3. Duplicate detection everywhere (manual, scan, vendor bills).
4. Periodic inventory + COGS for commerce sellers; commerce settlement ↔ payout reconciliation.
5. Audit pack export.
6. Payroll *import* (provider exports → summary JE template) — not payroll itself.

### Phase 3 — AI-Powered Accounting (the ladder climbs)
1. Reconciliation matching assistant with learned rules.
2. Close copilot (monitoring → drafted adjustments).
3. Mapping intelligence at full depth (workspace + platform learning).
4. 13-week cash forecast + cash/accrual bridge narration.
5. Journal anomaly review; explain-any-number.

### Phase 4 — Enterprise Finance Operations
1. Server-side posting authority (closes the client-side trust boundary — likely pulled earlier if expert flags it as a sign-off blocker).
2. Approval workflows, spend controls, duty-separation checks.
3. Multi-entity on the `entity_id` seam; consolidation + intercompany.
4. Fixed-asset register with book/fiscal depreciation.
5. Accountant-firm console (multi-client), full audit binder automation, Coretax integration when DJP access lands.

**Sequencing rationale:** Phase 1 is deliberately unglamorous — it converts "we have a kernel" into "an accountant will sign off on books from this product." That sign-off is the prerequisite for everything: AI suggestions are only accepted from a system whose arithmetic is trusted; the Finance-OS positioning collapses if the accounting underneath is doubted. Phase 2 automates the workflows Phase 1 made correct; Phase 3 adds intelligence to workflows that now have ground truth to learn from; Phase 4 sells the accumulated trust upmarket.

---

## 9. Risks

### 9.1 Classic startup accounting mistakes — and our exposure

| Mistake | Our status |
|---|---|
| Floating-point money | ✅ Guarded — integer rupiah / minor units everywhere |
| Mutable ledger (edit history silently) | ✅ Guarded — journals immutable once posted; corrections via reversal |
| No period concept (numbers change after reporting) | ✅ Guarded — periods with close/lock, `_assertEditablePeriod` |
| Single-entry masquerading as accounting | ✅ Guarded — real double-entry kernel |
| Categories ≠ accounts confusion | 🟡 Partially — the mapping seam is right, but `6999` accumulation and the 6-category ceiling are live risks |
| Deleting instead of voiding | ✅ Guarded on invoices (void only); verify uniformly for bills/transactions with the expert |
| Recognizing marketplace net payout as revenue | ✅ Guarded — commerce pipeline splits revenue/fees/refunds |

### 9.2 Open risks

- **Client-side posting trust boundary.** Firestore rules verify journal totals but cannot sum `lines[]`; a compromised or buggy client could write an internally inconsistent journal. Compensating controls (trial balance, `reconcile-ledger-balances.js`) are detective, not preventive. *This is our largest structural risk*; discovery should establish whether it blocks accountant sign-off now or at audit time, which sets its roadmap position.
- **Rules evaluation budget.** Firestore rules have already tripped on complex validators in production (invoice open→paid, 2026-07-14). As accounting docs grow richer, every new validated transition risks the expression limit — keep the lean per-transition validator pattern; this constrains how much integrity checking rules can ever do, reinforcing the server-side posting endgame.
- **Two sources of truth during transition.** Until statements derive from the kernel, the transactions-based preview P&L and the trial balance can disagree. Any user who notices loses trust in both. Mitigate by shipping Phase-1 item 2 early and labeling the preview honestly (already done) until then.
- **Accrual/cash presentation confusion** (assumption #4). Mitigate with the explicit bridge view, not by hiding one basis.
- **AI overreach.** One confidently wrong auto-categorization discovered by an accountant costs more trust than a hundred good suggestions earn. The autonomy ladder is the mitigation; never skip rungs for a demo.
- **Compliance surface.** SAK EMKM vs SAK EP presentation differences; PPN edge cases (credit notes, FX invoices currently excluded from tax — a real conflict for exporters); Coretax transition timing; UMKM threshold transitions mid-year. None are blocking today; all need expert-validated positions before we claim statutory outputs.
- **Data integrity at the seams.** The workspace `_scope()` seam has already produced a real incident (members seeing 0 data from a hardcoded `users/` path). Every new accounting surface must route through the seam; the grep guard in PROJECT_BACKGROUND.md §4 stays mandatory.
- **Migration risk.** Existing workspaces have pre-kernel transactions with `accounting_status: 'pending'` or no journals; CoA expansion must not orphan old mappings. Every accounting change needs an explicit backfill story (the `postPendingJournals` sweep is the template).

### 9.3 Features that look useful but create accounting risk

- "Quick edit" of posted amounts (breaks immutability — always reverse-and-repost).
- Auto-categorization defaulting to ON (the QuickBooks trap).
- Cash-basis toggle that silently recomputes statements (produces two versions of the truth; ship the *bridge*, not a toggle, until both bases are kernel-derived).
- Bulk delete of transactions (already avoided; keep it that way).
- "Simple mode" that hides A/P and A/R entirely (invisible obligations are how SMBs die).

---

## 10. Final Recommendations: The Next Six Months

**The question:** *If we want FluxyOS to become the finance operating system businesses trust — not just another accounting application — what should we focus on?*

**The answer: earn the accountant's signature, then own the month.**

FluxyOS's surprising position is that the hard invisible thing — a real double-entry kernel with immutable journals, periods, and Indonesian tax derivation — already exists, while several "table stakes" visible things (reconciliation, aging, equity, close process) do not. Most startups have the opposite problem and can never fix it retroactively. We can fix ours in two quarters.

1. **Month 1: run discovery as a kernel audit, not a listening tour.** Use the [interview guide](ACCOUNTING_EXPERT_INTERVIEW_GUIDE.md); put the expert in front of the actual product; extract the sign-off blocker list. Every subsequent priority call defers to that list.
2. **Months 1–4: close the trust gaps (Roadmap Phase 1).** Reconciliation matching, kernel-derived statements with a real equity section, CoA expansion with mapping intelligence, aging reports, close checklist v1. Definition of done: *an external Indonesian accountant, given a workspace's books, signs off on a month without exporting to Excel.* That sentence is the milestone; put it on the wall.
3. **Months 4–6: make the close the product.** The close copilot and reconciliation assistant (Phase 3 items pulled forward onto Phase 1's foundations) turn correctness into a visible, repeated "aha": FluxyOS tells you what's blocking your close, drafts the fixes, and locks the month. No SMB competitor — global or Indonesian — does this. It is also the natural monthly retention ritual.
4. **Throughout: hold the AI line.** Deterministic numbers, suggested actions, human confirmation, learned corrections. Climb the autonomy ladder only on evidence. Our AI story is *"AI you can audit"* — in accounting, that beats *"AI that does it for you"* every time.
5. **Do not build in the next six months:** payroll (integrate), multi-entity (seam exists, demand unproven), custom report builders (report packs suffice), statutory filing automation beyond exports (Coretax access is blocked anyway), and any feature whose pitch begins with "accountants won't need to…" — our wedge is making accountants *faster and more confident*, because they are the trust channel through which Indonesian SMBs adopt financial software.

The endgame this sets up: FluxyOS as the system where **operations happen** (invoices, bills, marketplace orders, cash) and accounting is a **guaranteed by-product** — books that are always current, always balanced, always one verified click from closed. That — not another chart of accounts editor — is what "Finance Operating System" means.
