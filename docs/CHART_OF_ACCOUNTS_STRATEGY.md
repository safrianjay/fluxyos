# FluxyOS Chart of Accounts Strategy

**Purpose:** design the CoA as a core foundation of the Finance Operating System — not a settings page. Companion to [ACCOUNTING_DISCOVERY_STRATEGY.md](ACCOUNTING_DISCOVERY_STRATEGY.md); the expert-markup exercise for this doc is Session 2 of the [interview guide](ACCOUNTING_EXPERT_INTERVIEW_GUIDE.md).

**Implementation status:** Phase 1 shipped (expanded 32-account seed, `business_categories` taxonomy, archive/reactivate, guards) — schema in [data-model/chart-of-accounts.md](data-model/chart-of-accounts.md); market research input in [research/coa-strategy.md](research/coa-strategy.md).

**Where we start from (shipped today):** a 19-account seed (`CHART_OF_ACCOUNTS_SEED` in `assets/js/accounting-engine.js`) wired to real double-entry posting. Users never pick accounts — they pick one of six categories (`Revenue, Marketing, Infrastructure, Operations, SaaS, Others`), and the engine resolves the GL account in priority order: saved `accounting_mappings` doc → category defaults (Marketing→6100, SaaS→6200, Infrastructure→6300, Operations→6400) → type defaults (fee→6600, tax→6500) → **6999 Other Expense fallback**. Tax accounts (1130/1140/1150/2100/2110/2200) are seeded and used by `tax-engine.js`. Normal-balance logic, signed balances, and Jakarta-timezone period keys are in the engine; `ledger_balances` accumulates the trial balance.

---

## A. Accounting Fundamentals

**What a CoA is.** The complete, ordered list of accounts a business posts to — the schema of the books. Every journal line references exactly one account; every statement line aggregates a defined set of accounts. It is simultaneously a *data model* (what can be recorded), a *taxonomy* (how activity is grouped), and a *contract* (what the statements will look like).

**Why every accounting system depends on it.** Double-entry without a CoA is just balanced arithmetic. The CoA is what makes journals *mean* something: it decides whether "server costs" is visible or buried, whether COGS exists so gross margin can be computed, whether PPN payable can be tied out to the SPT. Reporting, tax, budgeting, and analysis are all queries over the CoA.

**How professional accountants structure it.** Five root types in balance-sheet-then-P&L order — Assets, Liabilities, Equity, Revenue, Expenses (with COGS split from operating expenses) — ordered by liquidity within assets and by maturity within liabilities. Two levels deep for SMBs (header account → postable sub-accounts); more only under real pressure. The discipline that matters: **post only to leaf accounts, report on headers.**

**Numbering conventions.** The near-universal SMB scheme (which our seed already follows):

| Range | Type | Normal balance |
|---|---|---|
| 1000–1999 | Assets | Debit |
| 2000–2999 | Liabilities | Credit |
| 3000–3999 | Equity | Credit |
| 4000–4999 | Revenue | Credit |
| 5000–5999 | COGS | Debit |
| 6000–6999 | Operating expenses | Debit |
| 7000–7999 | Other income | Credit |
| 8000–8999 | Other expenses / taxes | Debit |

Gaps are left deliberately (1100, 1110, 1120…) so accounts can be inserted without renumbering — the property our scaling strategy (§F) depends on.

**IFRS vs GAAP.** For an SMB CoA the practical differences are presentational, not structural (current/non-current classification, some recognition differences in revenue and leases). What matters for us: don't hard-code presentation into account codes — keep statement grouping as metadata on the account so the same CoA can render SAK-style or management-style.

**Indonesian standards (SAK).** Three tiers matter: **SAK EMKM** (micro/small — simplified: balance sheet, P&L, notes; largely historical cost), **SAK EP** (private entities without public accountability — replaced SAK ETAP; closer to IFRS-for-SMEs), and full **PSAK** (IFRS-converged, public-interest entities). Our segment lives in EMKM/EP. Design consequences: (1) the default CoA must produce an EMKM-compliant statement set without modification; (2) Indonesian account names matter — the app is Bahasa-first, and accountants expect *Kas, Piutang Usaha, Utang Usaha, Pendapatan, Beban* terminology (account names must go through the i18n layer like all copy, with the English names as the opt-out); (3) tax accounts must map cleanly to SPT lines — already true of our PPN/PPh set.

---

## B. Standard Account Structure (Target Reference CoA)

The full structure FluxyOS should be able to represent. **Bold** = already in the shipped seed; everything else is the expansion target. Per account: purpose · normal balance · typical transactions · related workflow.

### 1000–1999 Assets (Debit)

| Code | Account | Purpose / typical transactions / workflow |
|---|---|---|
| **1000** | **Cash & Bank** (header; split below) | Liquid funds. Today a single account; must become a header over per-account children. |
| 1010 | Cash on Hand (Kas) | Physical cash; petty-cash spend and top-ups. Workflow: petty cash log. |
| 1020–1029 | Bank Accounts (per real account: BCA, Mandiri…) | One child per `bank_accounts` doc so reconciliation certifies a *specific* account's balance. Workflow: bank rec. |
| 1030 | E-Wallets / Payment Gateways (OVO, GoPay, Midtrans, Xendit) | Settlement float. Workflow: commerce settlement recon — money that has left the marketplace but not yet reached the bank. |
| **1100** | **Accounts Receivable (Piutang Usaha)** | What customers owe. Dr on `INV-ISSUE`, Cr on `INV-PAY`. Workflow: invoicing, aging, dunning, cash application. |
| 1110 | Allowance for Doubtful Accounts (contra, Cr) | Expected uncollectible A/R. Workflow: year-end estimate; write-offs. Later-stage. |
| **1130** | **PPN Masukan (Input VAT)** | Creditable VAT paid on purchases. Workflow: Tax Center monthly netting. |
| **1140** | **Prepaid PPh 25** | Monthly corporate tax installments. Workflow: annual SPT reconciliation. |
| **1150** | **PPh Dipotong Pihak Lain** | Tax withheld by customers (bukti potong). Workflow: collecting certificates, annual credit. |
| 1200 | Inventory (Persediaan) | Goods for resale at cost. Dr on purchase, Cr to COGS on sale/period count. Workflow: periodic count → COGS JE (v1), perpetual later. |
| 1300 | Prepaid Expenses (Biaya Dibayar di Muka) | Rent, insurance, annual SaaS paid ahead. Workflow: amortization schedule releases to expense monthly. |
| 1400 | Employee Advances / Other Receivables | Kasbon, deposits. Workflow: advance settlement. |
| 1500 | Fixed Assets (Aset Tetap — header: equipment, vehicles, buildings) | Capitalized purchases at cost. Workflow: asset register, disposal. |
| 1590 | Accumulated Depreciation (contra, Cr) | Depreciation to date. Workflow: monthly depreciation JE. |
| 1900 | Other Assets | Deposits, licenses. Catch-all — monitored like 6999. |

### 2000–2999 Liabilities (Credit)

| Code | Account | Purpose / workflow |
|---|---|---|
| **2000** | **Accounts Payable (Utang Usaha)** | What we owe vendors. Cr on `BILL-ACCRUE`, Dr on `BILL-PAY`. Workflow: bills, aging, payment runs. |
| 2050 | Credit Cards | Card balances as liability per card; statement reconciliation like a bank account (spend = Cr card, not Cr cash). |
| **2100** | **PPN Keluaran (Output VAT)** | VAT collected on sales. Workflow: monthly SPT netting against 1130. |
| **2110** | **PPh Payable** | Withholding we owe DJP (21/23/4(2)). Workflow: monthly remittance. |
| **2200** | **PPh 29 Payable** | Year-end corporate tax true-up. Workflow: annual SPT. |
| 2300 | Payroll Liabilities (header: net wages payable, BPJS payable, PPh 21 payable) | Gross-to-net gap between payroll run and remittances. Workflow: payroll-import summary JE. |
| 2400 | Loans Payable (short/long split later) | Bank/fintech loans; owner loans separated (2450) — critical hygiene for SMBs where owner/business money blurs. |
| 2500 | Deferred Revenue (Pendapatan Diterima di Muka) | Cash received before earning (deposits, annual subscriptions). Cr on receipt, Dr as earned. Workflow: recognition schedule. |
| 2900 | Other Liabilities | Monitored catch-all. |

### 3000–3999 Equity (Credit)

| Code | Account | Purpose / workflow |
|---|---|---|
| 3100 | Owner Capital / Modal Disetor | Contributions in. Workflow: owner top-ups (today these can only be mislabeled as income — a real defect the equity section fixes). |
| 3200 | Owner Drawings / Prive (contra, Dr) | Money taken out that isn't salary. Workflow: the other half of the owner-money hygiene problem. |
| **3000** | **Retained Earnings (Laba Ditahan)** | Accumulated closed-period results. Cr/Dr by `closePeriod()` closing journal. |
| 3500 | Current Year Earnings | Presentation account: YTD net income on the balance sheet before close. Computed, not posted to. |
| **3900** | **Opening Balance Equity** | Onboarding counterweight when importing opening balances; should trend to zero — a nonzero balance is an onboarding-debt signal. |

### 4000–4999 Revenue (Credit)

| Code | Account |
|---|---|
| **4000** | **Revenue** (becomes header) |
| 4100 | Product Revenue — goods/marketplace sales (commerce pipeline's `_rev` entries land here) |
| 4200 | Service Revenue — services/projects (invoice default) |
| 4300 | Subscription Revenue — recurring plans (pairs with 2500 deferral when annual) |
| 4900 | Sales Discounts & Returns (contra, Dr) — commerce refund (`_rf`) entries; keeping gross vs net visible |

### 5000–5999 Cost of Goods Sold (Debit) — entirely missing today

| Code | Account |
|---|---|
| 5100 | Cost of Goods Sold (Harga Pokok Penjualan) — released from 1200 on sale/count |
| 5200 | Marketplace & Payment Fees — commerce `_fee` entries belong here, *above* the gross-margin line, not in 6600: a seller's true margin is after platform take. (Today they post as generic fee expense — a mapping decision to revisit with the expert.) |
| 5300 | Shipping & Fulfillment |
| 5400 | Direct Labor / Direct Costs (services COGS) |

### 6000–6999 Operating Expenses (Debit)

| Code | Account | Today's category mapping |
|---|---|---|
| **6100** | **Marketing & Advertising** | ← Marketing |
| **6200** | **Software / SaaS** | ← SaaS |
| **6300** | **Infrastructure / Cloud** | ← Infrastructure |
| **6400** | **Operations (becomes header)** | ← Operations |
| 6410 | Salaries & Wages (Beban Gaji) | payroll gross |
| 6420 | Rent (Beban Sewa) | pairs with 1300 prepaid |
| 6430 | Utilities | |
| 6440 | Office Supplies | |
| 6450 | Travel & Entertainment | tax-sensitive (deductibility rules) |
| 6460 | Professional Services | accountants, notaris, legal |
| 6470 | Depreciation Expense | pairs with 1590 |
| **6500** | **Tax Expense** | ← type `tax` (final PPh 0.5% UMKM lands here) |
| **6600** | **Bank Fees & Charges** | ← type `fee` |
| **6999** | **Other Expense** | fallback — target: shrink toward zero (§E) |

### 7000+ Other Income & Expenses

| Code | Account |
|---|---|
| 7100 | Interest Income (Cr) |
| 7200 | FX Gain/Loss — realized differences on foreign-invoice settlement (today absorbed into the converted amount; needs its own account for exporters) |
| 8100 | Interest Expense (Dr) — pairs with 2400 loans |
| 8500 | Corporate Income Tax Expense (PPh Badan, ordinary regime) |

---

## C. Default CoA for Indonesian SMEs

Principle: **ship the smallest CoA that produces SAK-EMKM statements and a correct SPT, then grow it by behavior, not by settings.** Three tiers:

**Tier 1 — Exists by default for everyone** (~25 accounts): today's 19 seed accounts *plus* 3100 Owner Capital, 3200 Prive, 2500 Deferred Revenue, 5100 COGS header, 4900 Discounts & Returns, 7200 FX Gain/Loss — the six whose absence forces *mislabeled* entries today (owner top-up recorded as revenue is the canonical Indonesian SMB bookkeeping error).

**Tier 2 — Optional, activated by module/onboarding signal** (never by a settings safari):
- Says "I sell products" → 1200 Inventory, 5200 Marketplace Fees, 5300 Shipping.
- Connects a commerce integration → same, plus 1030 settlement-float account per gateway.
- Adds a bank account → child account under 1000 automatically (one ledger account per `bank_accounts` doc).
- Says "I have employees" / imports payroll → 6410, 2300 family.
- Records a loan → 2400/2450, 8100.
- PKP tax profile → tax accounts activate for posting (already seeded).

**Tier 3 — Created dynamically, with guardrails:** user- or AI-proposed sub-accounts under existing headers only (e.g., 6100 → "6110 Google Ads"), never new root types, never renumbering. Dynamic creation is a *mapping-time* offer ("You've mapped 9 transactions to Marketing → Google Ads pattern — create a sub-account?"), not a blank CRUD form.

What stays out entirely at SMB tier: intercompany accounts, WIP/long-term contracts, capitalized development, lease right-of-use — Phase-4 material.

---

## D. CoA and Product Design

The CoA is the invisible spine; each surface consumes it differently:

- **Transaction categorization:** categories remain the user-facing vocabulary; the CoA is its resolution target. As the CoA grows, categories become a *view over accounts* (each category = a set of accounts), preserving today's simple picker while letting accountants re-map underneath. The current fixed 6-list generalizes to "default category set per business type."
- **Bills:** vendor identity should carry a default account (vendor → account memory, §E); a bill's line items may split across accounts (a supplier invoice with goods + shipping = 1200 + 5300) — the future line-item model should carry `account_code` per line.
- **Invoices:** invoice items map to revenue sub-accounts (4100/4200/4300) so `INV-ISSUE` can credit the right revenue line; tax engine already derives PPN onto the same journal.
- **Expense/revenue tracking pages:** stay category-first for founders; the `accountant` role gets an account-level lens on the same data.
- **Budgeting:** budget allocations are category-scoped today; when categories become account-sets, budgets inherit account-level actuals for free — no schema break, because both route through the same mapping.
- **AI document extraction:** extraction should return a *suggested account* (not just `suggested_category`), sourced from the mapping system in §E, with the category derived from the account — one brain, two vocabularies.
- **Reporting & statements:** statements are queries over CoA metadata (statement section, current/non-current, contra flags). Getting this metadata onto accounts is what lets the kernel-derived P&L/Balance Sheet replace the transaction-based previews.
- **Dashboard KPIs:** gross margin becomes real once 5xxx exists (today "Gross Margin" is actually revenue−opex — an operating-margin mislabel that the CoA expansion quietly fixes); cash position ties to the 10xx family; cash-flow statement derives from CoA type + cash-effect metadata.

**The through-line:** every surface keeps its current UX; the CoA upgrade happens underneath via the `accounting_mappings` seam that already exists. No page needs to teach debits and credits.

---

## E. AI + Chart of Accounts: The Mapping System

Goal: the user (or a connector) supplies a document; the system proposes the full accounting treatment; a human confirms until confidence earns automation. Worked example — user uploads a Google Ads invoice: extraction reads vendor "Google Asia Pacific", amount, date, VAT line → proposal: *Expense · 6100 Marketing (or 6110 Digital Advertising if created) · PPN Masukan 1130 for the VAT line if creditable per tax profile* → shown with evidence and confidence → one tap to accept.

**Resolution ladder** (deterministic before probabilistic — cheapest sufficient tier wins, mirroring and extending the engine's existing order):

1. **Exact vendor memory** (workspace): this vendor's confirmed account, from prior corrections. Highest confidence.
2. **User rules**: explicit "always map X → account" (`accounting_mappings` today, extended with `source_type: 'vendor'`).
3. **Platform vendor knowledge**: anonymized cross-workspace priors ("Google Ads → advertising" is near-universal) via the `platform_learning` seam.
4. **Category/type defaults**: today's `CATEGORY_DEFAULTS`/`TYPE_EXPENSE_DEFAULTS`.
5. **AI classification**: LLM over extracted fields + CoA candidates, only when 1–4 miss. Must cite evidence.
6. **6999 fallback** — now a *queue*, not a destination: an "unmapped" review list with a health metric (% of spend in 6999; target <2%). The dumping-ground risk becomes a visible, workable number.

**Confidence + review flow:** every suggestion carries `{account, confidence, source_tier, evidence}`. High confidence (vendor memory/user rule) → pre-filled, single confirm. Medium (platform/AI) → highlighted, requires explicit tap. Low → lands in the unmapped queue. The existing `confidence` enum (`system_default` / `user_confirmed` / `ai_suggested`) extends to record *which tier* produced the mapping; `ai_suggested` — defined in the schema today but never written — is exactly where AI proposals persist pending confirmation.

**Learning from corrections:** a correction (user changes the suggested account) atomically (a) fixes the document, (b) upserts the vendor-memory mapping (deterministic doc id pattern already used by `accounting_mappings` — `{source_type}__{source_value}` — extends naturally to `vendor__{normalized_vendor}`), (c) optionally emits an anonymized signal to platform learning. Corrections never retroactively re-post history without explicit "apply to past transactions?" consent — reclassification of *posted* journals must go through reversal, not mutation.

**Autonomy:** per the strategy doc's ladder — suggestions first; per-workspace opt-in to auto-accept tier-1/2 matches; nothing auto-posts from tiers 3–5 until measured workspace-level accuracy justifies promotion, and even then with a reviewable digest.

---

## F. Scaling Strategy: Grow Without Rebuilding

The invariant: **account codes are append-only. Accounts are added, deactivated, or re-parented — never renumbered, never deleted with history.** Statement mappings live in metadata, so presentation can change without touching codes. Each stage activates dormant structure; none migrates data:

| Stage | CoA shape | What activates |
|---|---|---|
| **Freelancer** | ~15 visible accounts; categories only; equity = capital + prive | Tier-1 seed; most of it hidden |
| **Small business** | +bank children per account, +bills/invoices A/P–A/R in daily use, +deferred revenue if subscriptions | Tier-2 signals (add bank, sell products, hire) |
| **Growing SME** | +inventory/COGS, +payroll family, +fixed assets & depreciation, +sub-accounts under headers; accountant role active; period close routine | Tier-2/3; the `accountant` lens becomes primary for one user |
| **Multi-company** | Same CoA *template* instantiated per entity (journals already carry `entity_id`); shared vendor memory; intercompany accounts appear | Entity layer over unchanged workspace CoAs; consolidation maps entity CoAs to a group template |
| **Enterprise** | Dimensions (department/project/location) as journal-line metadata — **not** as account-code explosion (the classic ERP mistake: 6100-MKT-JKT-… code mangling); approval and control policies bound to accounts | Dimension fields on lines; CoA itself stays stable |

The multi-company design choice worth locking early: consolidation happens by *mapping entity accounts to a group template*, not by forcing identical CoAs — acquisitions and legacy books never merge cleanly, and mapping is the honest model.

---

## G. Competitive Analysis: CoA Handling

| Product | Approach | Strengths | Weaknesses / lesson |
|---|---|---|---|
| **Xero** | Flat-ish CoA, editable, per-country default templates; bank accounts are first-class ledger accounts; report codes decouple statements from codes | The report-code layer (statement mapping as metadata) is the right pattern — we adopt it in §D | CoA editing still assumes accounting literacy; categories/CoA not layered for non-accountants |
| **QuickBooks** | CoA + user-facing "categories" that *are* accounts with friendly names; auto-created accounts per feature | The friendly-vocabulary instinct matches ours | Auto-created account sprawl; ML mapping overconfidence produced miscategorized books at scale — the cautionary tale for §E autonomy |
| **NetSuite** | Segmented CoA + dimensions (subsidiary, department, class, location) | Dimensions-not-code-explosion is the enterprise-correct model we pre-adopt in §F | Setup requires consultants; nothing here is self-serve |
| **SAP** | CoA at group level + operating/company-code charts + heavy governance | Multi-entity template/mapping discipline (§F borrows it) | Utterly closed to SMB users |
| **Odoo** | Per-country localization packs install a full statutory CoA (incl. Indonesia) + tax grids | Localization-as-content: CoA + tax mapping shipped as data, versioned per jurisdiction — directly applicable to our SAK/SPT needs | Statutory-first CoA overwhelms non-accountants on day one |
| **Zoho Books** | Simple editable CoA, decent defaults, account types drive statements | Low-friction middle ground | No intelligence layer; "Other" accounts accumulate silently |

**FluxyOS opportunity:** nobody offers *progressive CoA* — statutory-correct underneath from day one, invisible until the business's behavior summons each piece, with an AI mapping layer whose confidence is earned and visible. Odoo has the statutory content, Xero has the metadata layer, QuickBooks has the friendly vocabulary; no one has all three plus the autonomy ladder.

---

## H. Product Recommendations

**Should users interact with the CoA directly?** Founders: no — categories remain their entire vocabulary; the CoA manifests only as better reports. Accountants (the `accountant` role that already exists in `perms-service.js`): yes — a real CoA screen (view, activate/deactivate, add sub-accounts, edit mappings, see per-account health) inside the Accounting Center. One product, two lenses, same data.

**Should AI abstract the complexity?** AI abstracts the *decision* (which account), never the *record* (the journal is always real, inspectable, immutable). The abstraction users feel is "I never think about accounts"; the guarantee accountants feel is "every number resolves to a correct account anyway." Both must be true simultaneously — that duality *is* the product thesis.

**How much accounting knowledge should non-accountants see?** Zero required, all available. Every number should answer "why?" through the drill chain (statement line → account → journal → document) in plain narrated language — accounting as explanations-on-demand, not as prerequisite vocabulary. Never show a debit/credit column to a founder by default; never hide it from anyone who opens the journal.

**When should advanced features appear?** By behavioral trigger, not by plan tier or settings page (§C Tier-2 signals): sell products → inventory accounts; connect a gateway → settlement float; invite an accountant → the accountant lens. The CoA grows because the business did something, so every new account arrives with its reason attached.

**Simple for founders, trustworthy for accountants — how both hold:** the founder-facing surface never changes as the CoA deepens (categories in, reports out); the accountant-facing surface exposes full statutory structure, immutable journals, mapping control, and the 6999-health metric. The bridge is the mapping system (§E): founders feed it confirmations, accountants tune it, statements consume it. **Sequencing:** expand the seed (Tier-1 six accounts) and ship the accountant CoA screen in Roadmap Phase 1; vendor memory in Phase 1–2; AI tiers 3–5 in Phase 3 — matching the [strategy doc](ACCOUNTING_DISCOVERY_STRATEGY.md) §8, and validated against the expert's Session-2 markup before any code.


---

## Numbering convention — measured, not assumed (2026-08-07)

Audited across the seed and all 20 production workspaces (182 accounts) before
changing the code-suggestion logic. **This chart is not the textbook 1/2/3/4/5
scheme**, and `type` alone cannot place an account:

| Block | Class | Note |
|---|---|---|
| `1xxx` | Assets | |
| `2xxx` | Liabilities | |
| `3xxx` | Equity | |
| `4xxx` | Revenue | operating |
| `5xxx` | **COGS** | expense, but its own block |
| `6xxx` | **Operating expense** | where most expenses live |
| `7xxx` | **Other income** | revenue, but its own block |
| `8xxx` | reserved: expense | recognised by `accountTypeForCode`, unused |

`sak_category` is the determinant — type spans two blocks for both expense (5/6)
and revenue (4/7). That is why suggestions key on the category; see
`deriveCodeBlock()` in `assets/js/accounting.js`.

**Width:** all 182 codes are exactly 4 digits. The suggester derives width from
the data rather than hard-coding 4, so a workspace numbering differently is
followed rather than corrected.

**Integrity:** 0 invalid-format codes, 0 duplicates within any workspace.

**Capacity / gaps** (union across workspaces):

| Block | Used | Range | Interior gaps | Free above top |
|---|---|---|---|---|
| `1xxx` | 6 | 1000–1150 | 5 (145 codes) | 849 |
| `2xxx` | 7 | 2000–2901 | 6 (895) | 98 |
| `3xxx` | 4 | 3000–3900 | 3 (897) | 99 |
| `4xxx` | 2 | 4000–4900 | 1 (899) | 99 |
| `5xxx` | 1 | 5100 | 0 | 899 |
| `6xxx` | 54 | 6000–6999 | 52 (946) | **0** |
| `7xxx` | 2 | 7100–7200 | 1 (99) | 799 |

No block is close to exhausted. **`6xxx` is the one to watch**: its highest code
is 6999, the top of the block, so "append after the highest" has nowhere to go
and the suggester falls back to the first interior hole. That path is the live
state of the busiest class, not a theoretical branch — which is why it exists
rather than returning an empty suggestion.
