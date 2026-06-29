# Indonesia Tax Center — Architecture Specification

> Authoritative design for the FluxyOS **Tax Center** (`/tax-center`). Read
> alongside `PROJECT_BACKGROUND.md` §4 (workspace scoping + schema) and §4m.3
> (Accounting Kernel — the source of truth this module sits on top of),
> `DESIGN_SYSTEM.md`, `SECURITY_SYSTEM.md`, `LOCALIZATION_PLAN.md` §2/§12, and
> `ROADMAP.md` (Tax Center track).
>
> **Status: Phases 1–4 SHIPPED (live on main, rules deployed); Phase 5 planned.**
> Built: `tax-engine.js`, `tax-center.html`/`.js`, the 5 tax collections + rules,
> PPN (output `2100` / input `1130`), withholding (we-withhold `2110` /
> customers-withhold `1150`), tax periods (compute/file/lock), SPT PPN + Bukti Potong
> CSV exports, `tax_filings`, and **corporate tax** (PPh 25 installments → `1140`;
> annual PPh 29 reconciliation → `2200`, UMKM 0.5% / ordinary 22%). Phase 5 (AI Tax
> Assistant + Coretax/e-Faktur/e-Bupot integration) is planned. See `ROADMAP.md` →
> Tax Center for the per-feature status. The sections below are the design of record;
> where the build refined a decision it is noted in §18a (and §18b for corporate tax).
>
> Domain sources: the Indonesia tax deep-research report and the Tax Center product
> brief (both in the planning thread). This doc condenses them into FluxyOS-shaped
> architecture; it is **not** tax advice and is not a substitute for a registered
> consultant (DJP = Direktorat Jenderal Pajak, the tax authority).

---

## 1. Philosophy & non-negotiables

FluxyOS is a Finance Operating System, not tax software. Users interact with
business operations; the **Accounting Engine** turns those into journals/ledger;
the **Tax Engine** turns accounting records + business events into tax
classifications, summaries, reports, and compliance status.

```
Business Event → Accounting Engine → Journal → Ledger → Financial Statements
                                                              ↓
                                       Tax Engine → Tax Summary → Tax Reporting → Government Filing
```

**The Tax Engine is derived, never authoritative.** It must obey:

1. **Accounting stays the source of truth.** Tax never creates an independent
   accounting record. Tax amounts post as **additional lines on the same journal**
   the business document already generates (§4), through the existing kernel — never
   a parallel ledger. The trial balance remains the single balance source.
2. **Workspace scoping (MANDATORY).** Every tax collection is workspace-scoped via
   `DataService._scope(userId)`. Never hardcode `users/${uid}/<taxCollection>`. See
   `PROJECT_BACKGROUND.md` §4 ⚠️ box. New collections are added to the grep guard.
3. **Money is a raw integer Rupiah.** Never a formatted string. Display formats as
   `Rp1.000` (no space after `Rp`), Inter `tabular-nums`. See `DESIGN_SYSTEM.md`.
4. **Tax rules are data, not code.** Rates, thresholds, and rounding live in
   configurable tables in the engine, keyed by effective date — so a regulatory
   change is a data edit, not a logic rewrite (§2, §16).
5. **Audit + RBAC.** Every tax write emits an `audit_logs` entry; roles gate every
   action (§7, §8). Firestore rules are the integrity boundary, deployed separately.
6. **AI never files or mutates tax records.** All actions require explicit user
   confirmation; the assistant gives no tax advice and defers to an accountant (§13).

---

## 2. Engine placement decision (RECOMMENDATION)

**Recommendation: a pure client-side JS tax engine, `assets/js/tax-engine.js`,
mirroring `assets/js/accounting-engine.js`.** No Firestore, no DOM, no `window`;
deterministic; unit-tested in `tests/tax-engine.spec.js` and rule-verified against
the emulator like `tests/accounting-kernel-rules-emulator-test.mjs`.

Shape (parallels the accounting engine's `buildJournal`/`selectRule`/`finalize`):

```
classifyTax({ collection, document, profile, mappings, date })
  → { tax_lines: [ { tax_code, direction, taxable_base, tax_rate, tax_amount,
                     gl_account_code, debit_or_credit } ], skipped: bool }
```

`db-service.js` wraps it with server context (`entity_id`, `posted_by`,
`serverTimestamp`) and **appends the returned tax lines to the journal built by
`buildJournal()` in the same `writeBatch`**, then writes one `tax_transactions` row
per tax line. This reuses `_postSourceJournal` / `_correctSourceJournal` /
`_flushBalanceAcc` exactly as accounting does.

**Why client-side JS:**

- **Architectural fit.** It is the proven pattern of the shipped accounting kernel
  (`PROJECT_BACKGROUND.md` §4m.3): pure → testable → idempotent at the call site.
- **No backend dependency for core tax math.** The FastAPI backend (`api/main.py`)
  is narrow today — AI chat + document detection/extraction only (§9, `PROJECT_BACKGROUND.md`
  §9). Keep it there; do not route core finance/tax CRUD through it.
- **Same integrity boundary.** Firestore rules already enforce raw-integer money,
  append-only logs, and role gates; tax rules extend that boundary (§7).
- **Same compensating control.** A `scripts/reconcile-tax-balances.js` (dry-run
  default, `--commit`) recomputes tax-account balances from journal lines, exactly
  as `scripts/reconcile-ledger-balances.js` does for the GL.

**Where the backend *does* earn its place (Phase 5+, §14):** DJP/Coretax
host-to-host submission, NPWP validation lookups, and OCR-based NPWP/faktur
extraction (the `/api/v1/ai/detect-document` path already pattern-matches
`pajak|tax|pph|ppn`). These are server-to-server integrations, genuinely backend
work — but they are **out of scope until the client-side engine, data model, and UI
exist**.

**Accepted nuance — rounding & rate tables.** PPN is rounded per DJP practice; rates
and thresholds change by regulation. Both live as **data** in `tax-engine.js`
(`TAX_RATES`, `TAX_ROUNDING`), keyed by `effective_from`, never inlined into rule
bodies. A `roundTax(amount, tax_code)` helper centralizes rounding so every rule and
the reconciliation script agree.

---

## 3. Tax types & obligations matrix

The domain the engine's rate tables implement (full scope: PPN + all PPh withholding
+ corporate PPh 25/29 + annual). Rates are current-practice defaults; the engine
stores them as dated data (§2). "Remitter" = who pays/reports to DJP.

| Tax | Object | Rate(s) | Frequency / deadline | Remitter | Filing |
|-----|--------|---------|----------------------|----------|--------|
| **PPh 21** | Employee wages | Progressive 5–35% | Monthly (pay 15th / report 20th) | Employer | SPT Masa PPh 21 (e-Bupot 21/26, PER-02/PJ/2024) |
| **PPh 22** | Imports, govt purchases, certain sales | 2–10% of value | Monthly (15th/20th) | Buyer/Govt | SPT Masa PPh Unifikasi |
| **PPh 23** | Domestic services, rent, royalties, dividends | 2% services/rent; 15% interest/dividends | Monthly (15th/20th) | Payer | SPT Masa Unifikasi (e-Bupot, PER-24/PJ/2021) |
| **PPh 26** | Payments to non-residents | 20% (or treaty) | Monthly (15th/20th) | Payer | SPT Masa Unifikasi |
| **PPh 4(2)** | Final income (rent 10%, construction, prizes) | Varies by object (often 10%) | Monthly (15th/20th) | Payer | SPT Masa Unifikasi |
| **PPh Final UMKM** | Small-biz turnover ≤ IDR 4.8B/yr (PP 23/2018, PP 55/2022) | 0.5% of turnover (≤ IDR 0.5B effectively exempt) | Monthly (15th/20th) | Business (self) | SPT Masa PPh 4(2) |
| **PPh 25** | CIT installments | From prior-year tax | Monthly (15th) | Company | SSP/e-Billing (payment = filing) |
| **PPh 29** | Year-end CIT balancing | CIT due − credits | Annual (by Apr 30) | Company | SPT Tahunan Badan |
| **PPN (VAT)** | Taxable sales/purchases by PKP | 11% standard; 0%/exempt cases | Monthly (file by month-end; e-Faktur upload by 20th, PER-11/PJ/2025) | Seller (PKP) | SPT Masa PPN 1111 (e-Faktur) |
| **PPnBM** | Luxury goods | 15–125% | Monthly | Seller (PKP) | with SPT PPN |
| **Bea Meterai** | Documents above threshold | IDR 10.000 | At issuance | Issuer | n/a |

**PKP threshold:** turnover > IDR 4.8B/yr must register as PKP and charge PPN
(PMK 197/2013). Below it, a business may be Non-PKP (no output PPN) and/or on the
0.5% UMKM final scheme. This is the single most important branch in the engine and is
driven by `company_tax_profile.pkp_status` + `umkm_final` (§6).

---

## 4. Tax Engine architecture

`assets/js/tax-engine.js` mirrors `accounting-engine.js`. All money raw-integer IDR;
all rounding via `roundTax()`.

**Tables (data, dated by `effective_from`):**

- `TAX_CODES` — enum of every code the system emits, e.g. `PPN_OUT_11`, `PPN_IN_11`,
  `PPN_IMPORT_11`, `PPN_EXEMPT`, `PPN_ZERO`, `PPH23_SERVICE_2`, `PPH23_RENT_2`,
  `PPH4_2_RENT_10`, `PPH_FINAL_UMKM_05`, `PPH21_PROGRESSIVE`, `PPH26_20`, `PPH22_*`.
- `TAX_RATES` — `tax_code → { rate, gl_account_code, direction, effective_from }`.
- `TAX_ROUNDING` — per-code rounding rule (PPN nearest rupiah per DJP practice).

**Rule selection — `selectTaxRules(collection, document, profile)`** returns the
applicable tax code(s) for a document, or `[]` to skip (transfers, exempt, Non-PKP
output, draft invoices). Resolution priority for the code, mirroring
`resolveExpenseAccount` in the accounting engine:

```
saved tax_mapping (category/type) → category default → type default → none
```

`profile` gates structural branches: `pkp_status: 'non_pkp'` suppresses all output
PPN; `umkm_final: true` emits `PPH_FINAL_UMKM_05` on revenue instead of ordinary CIT
accrual.

**Rule table — `TAX_RULES`** (each returns balanced **additional** journal lines,
appended to the document's base posting). Representative rules:

| Rule | Trigger | Added journal lines |
|------|---------|---------------------|
| `PPN-OUT-11` | PKP sales invoice / income, taxable | Dr A/R (gross-up) · **Cr `2100` PPN Keluaran** |
| `PPN-IN-11` | PKP purchase/bill, creditable input | **Dr `1130` PPN Masukan** · Cr A/P (gross-up) |
| `PPN-IMPORT-11` | Import of goods/services | Dr `1130` PPN Masukan · Cr Cash/Bank |
| `PPH23-SERVICE-2` | Service bill subject to PPh 23 (we withhold) | Dr Expense (gross) · **Cr `2110` PPh Payable** · Cr A/P (net) |
| `PPH4_2-RENT-10` | Rent/final-object payment we make | Dr Expense (gross) · Cr `2110` PPh Payable · Cr Cash (net) |
| `PPH-FINAL-UMKM-05` | UMKM revenue (final scheme) | Dr `6500` Tax Expense · Cr `2110` PPh Payable |
| `PPH23-CUST-WHHELD` | Customer withholds PPh on our invoice | Dr `1150` PPh withheld-by-customers · Cr A/R (the withheld slice) |

**Worked example — PKP service invoice IDR 10.000.000, PPN 11%, customer withholds
PPh 23 2%.** Base posting `INV-ISSUE` is Dr A/R / Cr Revenue. Tax engine appends:
Cr `2100` PPN Keluaran 1.100.000 (and grosses A/R to 11.100.000); on payment, the
customer remits 11.100.000 − 200.000 = 10.900.000 and the `PPH23-CUST-WHHELD` line
moves 200.000 to `1150` as a creditable prepayment. Net journal stays balanced;
`tax_transactions` records both the PPN output (200.000… 1.100.000) and the PPh-23
credit slices for the period summary.

**Public functions (pure):** `classifyTax(...)`, `selectTaxRules(...)`,
`buildTaxLines(...)`, `roundTax(...)`, `taxPeriodKey(date)` (reuses the Asia/Jakarta
`periodKey` convention from the accounting engine). Reversal/correction reuses
`reverseLines()` semantics so an edited/voided document's tax lines unwind into the
open period exactly like accounting corrections (§9).

---

## 5. Chart-of-accounts extensions

Add to `CHART_OF_ACCOUNTS_SEED` in `accounting-engine.js` (design only; seeded
idempotently by `seedChartOfAccounts()`, archived via `is_active`, never deleted):

| Code | Name | Type | Flow |
|------|------|------|------|
| `1130` | PPN Masukan (Input VAT) | asset | Creditable input VAT on purchases/imports |
| `1140` | Prepaid PPh 25 | asset | CIT installments paid in-year (credit at annual) |
| `1150` | PPh Dipotong Pihak Lain (withheld by customers) | asset | Creditable income-tax prepayments |
| `2100` | PPN Keluaran (Output VAT payable) | liability | Output VAT collected on sales |
| `2110` | PPh Payable (withheld by us, not yet remitted) | liability | PPh 21/23/26/4(2)/final we owe DJP |
| `2200` | PPh 29 Payable | liability | Year-end CIT balancing payable |

VAT payable for a period = `2100` Keluaran − `1130` Masukan (the reconciliation
control in §12). These map directly to the SPT line items in §11.

---

## 6. Data model (Firestore)

All **workspace-scoped** (`${ds._scope(uid)}/…`); add every collection name to the
`PROJECT_BACKGROUND.md` §4 grep guard. Amounts raw integer; append-only collections
soft-archive via `status`, never hard-delete.

### `company_tax_profile/current` (one doc per workspace)
`npwp` (string, 15/16-digit), `nik`, `pkp_status` ('pkp'|'non_pkp'),
`pkp_effective_date`, `umkm_final` (bool), `tax_office_kpp`, `business_classification`
(KLU), `default_ppn_rate` (int %, e.g. 11), `entity_id`, `updated_by`, `updated_at`.
Drives every structural branch in the engine (§4).

### `tax_mappings/{mappingId}` (doc id slug `{source_type}__{source_value}`)
Mirrors `accounting_mappings`. `source_type` ('transaction_category'|'transaction_type'
|'vendor'|'invoice_item'|'bill_item'), `source_value`, `tax_code`, `tax_rate_percent`,
`effective_from`, `effective_until`|null, `status` ('active'|'archived'),
`created_by`, `created_at`, `updated_at`.

### `tax_transactions/{taxTxId}` (append-only)
One row per tax line emitted. `source_collection` ('transactions'|'bills'|'invoices'),
`source_id`, `source_number`, `tax_code`, `tax_name`, `direction`
('output'|'input'|'withheld_by_us'|'withheld_by_other'|'final'), `tax_rate_percent`,
`taxable_base` (int), `tax_amount` (int), `period_key` ('YYYY-MM'),
`journal_ref` (the journal these lines belong to), `npwp_counterparty`,
`faktur_number`|null, `bukti_potong_no`|null, `status`
('draft'|'posted'|'corrected'|'reversed'), `entity_id`, `created_by`, `created_at`.
Corrected/reversed rows link via `reverses_tax_tx_id` / `reversed_by_tax_tx_id`.

### `tax_periods/{periodId}` (id `{period_type}-{period_key}`)
`period_type` ('monthly'|'quarterly'|'annual'), `period_key`, `period_start`,
`period_end`, `filing_deadline`, `status` ('open'|'computed'|'filed'|'amended'|'settled'),
computed totals (all int): `ppn_output`, `ppn_input`, `ppn_payable`, `pph_withheld`,
`pph_credit`, `pph_final`, `entity_id`, `closed_by`, `closed_at`, `updated_at`.
Missing doc = open. Computation is deterministic from `tax_transactions` (never stored
as the source — the rows are; this is a cached summary, like `ledger_balances`).

### `tax_filings/{filingId}` (append-only)
`period_id`, `filing_type` ('SPT_PPN'|'SPT_PPh_Unifikasi'|'SPT_PPh21'|'SPT_Tahunan'
|'Tax_Certificate'), `filing_date`, `reference_number`|null (DJP/e-Faktur receipt),
`status` ('draft'|'filed'|'accepted'|'rejected'|'amended'), `file_path`|null
(Storage path to the signed PDF/export), `external_link`|null, `filed_by`,
`audit_log_id`, `entity_id`, `created_at`, `updated_at`.

### New fields on existing documents (transactions / bills / invoices)
Optional, additive (validators in `firestore.rules` must allow these keys, like
`isValidAccountingLink` does for `journal_ref`): `tax_code`, `taxable_base` (int),
`tax_amount` (int), `npwp_counterparty`, `faktur_number`, `bukti_potong_no`,
`withholding_flag` (bool). Invoice `items` may carry per-line `tax_code` for mixed
taxable/exempt invoices.

**Indexes:** `tax_transactions` by `(period_key, direction)` and by
`(source_collection, source_id)`; `tax_filings` by `(period_id, filing_type)`;
`tax_mappings` by `(status, source_type)`.

---

## 7. Firestore rules design

Per-collection, reusing the existing helpers (`isWorkspaceMember(wsId)`,
`hasRole(wsId, [...])`, the integer/enum validators). **Rules deploy separately:**
`firebase deploy --only firestore:rules` — a git push to `main` does NOT deploy them.

```
match /workspaces/{wsId}/company_tax_profile/{doc} {
  allow read:   if isWorkspaceMember(wsId);
  allow write:  if hasRole(wsId, ['owner','admin','finance','accountant'])
                && isValidTaxProfile();           // npwp shape, ppn rate 0..100
}
match /workspaces/{wsId}/tax_mappings/{id} {
  allow read:   if isWorkspaceMember(wsId);
  allow create, update: if hasRole(wsId, ['finance','accountant']) && isValidTaxMapping();
  allow delete: if hasRole(wsId, ['owner','admin']);   // else soft-archive
}
match /workspaces/{wsId}/tax_transactions/{id} {
  allow read:   if isWorkspaceMember(wsId);
  allow create: if hasRole(wsId, ['finance','accountant']) && isValidTaxTransaction();
  allow update: if hasRole(wsId, ['finance','accountant']) && onlyReversalLinkChanged();
  allow delete: if false;                              // append-only
}
match /workspaces/{wsId}/tax_periods/{id} {
  allow read:   if isWorkspaceMember(wsId);
  allow create, update: if hasRole(wsId, ['finance','accountant']);   // compute/open
  // closing (status → filed/settled) restricted in app + a status-transition guard
  allow delete: if false;
}
match /workspaces/{wsId}/tax_filings/{id} {
  allow read:   if isWorkspaceMember(wsId);
  allow create: if hasRole(wsId, ['owner','admin','finance','accountant']) && isValidFiling();
  allow update: if hasRole(wsId, ['owner','admin']);   // accept/reject/amend
  allow delete: if false;
}
```

Validators assert: amounts are integers ≥ 0, `tax_rate_percent` 0–100, `status`/`tax_code`/
`direction` in their enums, `npwp` matches the 15/16-digit shape. Same known limitation
as the accounting kernel (§4m.3): rules check journal totals, not the `lines[]` array —
`scripts/reconcile-tax-balances.js` is the compensating control.

---

## 8. RBAC / permission matrix

Extend the `perms-service.js` capability list (design only). New capabilities and
their grant per existing role:

| Capability | owner | admin | finance | accountant | viewer |
|------------|:---:|:---:|:---:|:---:|:---:|
| `tax.read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `tax.map` (edit mappings) | ✓ | ✓ | ✓ | ✓ | – |
| `tax.post` (classify/post tax lines) | ✓ | ✓ | ✓ | ✓ | – |
| `tax.period.close` | ✓ | ✓ | ✓ | ✓ | – |
| `tax.file` (mark filed / accept-reject) | ✓ | ✓ | – | – | – |
| `tax.export` | ✓ | ✓ | ✓ | ✓ | – |

Mirrors the accounting split (read for all incl. viewer; post for finance+; the
irreversible/outward step — here `tax.file`, like `period.lock` there — owner/admin
only). **Recommendation: reuse the existing `accountant` role for v1.** Add a
dedicated **Tax Consultant** role only if external accountants need scoped access
without full finance write — defer until that demand is real (listed in §19).

---

## 9. Tax event workflows

Each business event keeps its existing base posting (§4m.3) and the tax engine
appends tax lines + writes `tax_transactions`. All corrections route through the
**correction-in-current-period** rule (reverse + repost into the OPEN period; closed
books never mutated), reusing `_correctSourceJournal`.

- **Sales invoice (PKP).** `INV-ISSUE` + `PPN-OUT-11`. If the customer is a
  withholding agent, the payment leg adds `PPH23-CUST-WHHELD` → `1150`.
- **Purchase bill (PKP, creditable).** `BILL-ACCRUE` + `PPN-IN-11`. If the service is
  PPh-23 object, add `PPH23-SERVICE-2` (we withhold → `2110`, pay vendor net).
- **Payroll / PPh 21.** Dr Payroll Expense · Cr Cash (net) · Cr `2110` PPh Payable.
  (Depends on a payroll module — see §19 open question.)
- **Import VAT.** `PPN-IMPORT-11` against the customs document; input credit to `1130`.
- **Reverse charge** (offshore services). Manual: Dr Expense · Cr output VAT, nets
  against input — flagged, not auto-posted, in v1.
- **Correction / credit note.** Reverse the original tax lines (negative output VAT /
  cancelled bukti potong) and repost; `tax_transactions` gets `reverses_tax_tx_id`.
- **Monthly period close.** Compute `tax_periods` totals from `tax_transactions`,
  compare to expected, lock the period for filing (§12).
- **Annual reconciliation.** Aggregate the year; compute CIT (22%) with fiscal
  adjustments; `1140` Prepaid PPh 25 + `1150` credits reduce the balance to `2200`
  PPh 29 payable (§3, PPh 29).

---

## 10. Information architecture & UX

New app page `tax-center.html` + `assets/js/tax-center.js` + `assets/css/tax-center.css`,
following the Accounting Center pattern (page shell `.fluxy-page-shell` →
`.fluxy-page-canvas`; topbar with title + `FluxyDateRangePicker` + Ask Fluxy AI; tabs
`.acct-tabs`; KPI strip `.acct-kpi-grid`; tables `.fluxy-table-*`).

**Sidebar:** new group **"Tax & Compliance"** in `sidebar-loader.js` (after
Reporting, before Workspace), nav item `/tax-center` `id="nav-tax-center"`, added to
`pageIdMap` and the Lucide icon registry, role-gated `.hidden` via `tax.read` (so
viewer sees it read-only; non-members never).

**Tabs:** Overview (compliance) · Company Tax Profile · PPN (Output / Input /
Reconciliation) · Withholding (PPh) · Corporate Tax · Tax Calendar · Filings · Tax
Documents · Reports · AI Tax Assistant.

**KPI strip (Overview):** PPN Payable (this period) · Withholding Outstanding ·
Upcoming Deadline (days) · Compliance Score (ring, reuses the report-confidence ring
pattern). Below it, a status banner (On track / Action needed / Overdue) with a "View
blockers" CTA jumping to the relevant tab — same idiom as the accounting confidence
banner.

**Interaction patterns (reuse only — no new primitives):** master-detail filter
popover (Journal Register pattern); right-hand drawers for *Compute & close period*
and *Record filing* via `showConfirmDialog` with `tone:'danger'` for the irreversible
close; `showToast` for results; `renderEmptyState` everywhere there is no data — never
invent numbers or show "Coming soon" in a data slot.

**Design-system enforcement:** `Rp` no-space + Inter `tabular-nums`; orange accent
only (no orange backgrounds); 6-step type scale (10/12/14/16/20/24); one primary
action per viewport; no generic eyebrow labels; no `window.confirm`/`alert`.

---

## 11. Reporting & exports

Reuse the `report_exports` collection + the Reports page export idiom (CSV first, PDF
where a signed artifact is needed). Tax exports may be plan-gated (§19).

- **SPT Masa PPN 1111** — output (`2100`) and input (`1130`) detail + payable;
  e-Faktur-ready columns (counterparty NPWP, faktur number, base, PPN).
- **PPh Unifikasi (bukti potong)** — PPh 22/23/26/4(2) slips: payer/payee NPWP, income
  code, base, rate, withheld.
- **SPT Masa PPh 21** — per-employee withheld totals (payroll-dependent).
- **Corporate summary** — CIT, prepaid PPh 25 (`1140`), credits (`1150`), PPh 29 (`2200`).
- **Outstanding tax / reconciliation / government submission history** — derived from
  `tax_periods` + `tax_filings`.

Each export writes a `report_exports` row + an `export.create`-style audit log.

---

## 12. Validation & reconciliation controls

- **VAT balancing:** `2100` output − `1130` input = period `ppn_payable`. Mismatch →
  alert. Net-credit (input > output) flagged for carry-forward/refund handling.
- **Withholding issued vs. payable:** sum of `direction:'withheld_by_us'`
  `tax_transactions` == `2110` movement for the period; flag a payment that looks like
  a PPh object but has no slip (the "missing bukti potong" check).
- **Tax accounts net to zero after filing:** once a period is `settled`, `2100`/`2110`
  for that period should clear; residual → missing SPT/payment.
- **DJP rounding** centralized in `roundTax()`; reconciliation script re-asserts.
- **Negative VAT / credit notes** enter as negative output VAT, never deletions.
- **Period lock:** once `tax_periods.status ∈ {filed, settled}`, edits to source docs
  in that tax period are blocked (or require an explicit amendment that posts into the
  open period). Mirrors accounting period close.
- **Exemptions:** Non-PKP / zero-rated / exempt categories carry `PPN_EXEMPT`/`PPN_ZERO`
  and emit no output PPN — verified against `company_tax_profile`.

`scripts/reconcile-tax-balances.js` (dry-run default, `--commit`) recomputes
`tax_periods` totals from `tax_transactions` and reports drift — the tax analogue of
`reconcile-ledger-balances.js`.

---

## 13. AI Tax Assistant

Reuses the Fluxy AI drawer; **read-only over tax data, never writes or files** (per
`docs/fluxy_ai_financial_analyst_plan.md`: AI gives no tax advice, defers to an
accountant, all actions need user confirmation). Capabilities beyond Q&A:

- Explain *why* PPN payable changed period-over-period (trace `tax_transactions`).
- Detect missing faktur / missing bukti potong (GL output vs. recorded fakturs).
- Suggest deductibility / tax classification for an expense (suggestion only → user
  saves the `tax_mapping`).
- Predict filing risk / flag anomalies (sudden PPN drop, zero-PPN on a taxable sale).
- Summarize a period's obligations and upcoming deadlines.

Every AI suggestion lands as a draft the user must confirm; nothing posts or files
autonomously.

---

## 14. Coretax / DJP readiness (design only — no APIs)

Design the seams so a future integration is additive, not a redesign. **Out of scope
for Phases 1–4.**

- **Auth:** NPWP-KTP SSO / DJP Online token, stored server-side (never client). A
  `tax_integration_credentials` doc is **user/owner-scoped and encrypted**, not a
  finance collection.
- **e-Faktur upload:** map `tax_transactions` (output) → e-Faktur JSON; respect the
  PER-11/PJ/2025 20th-of-next-month deadline (surface in the Tax Calendar). NSFP
  auto-assigned on upload; store the returned `faktur_number`.
- **e-Bupot:** map withholding `tax_transactions` → unified bupot payloads.
- **Submission lifecycle:** `tax_filings.status` already models draft → filed →
  accepted/rejected/amended; add `submission/status/ack/retry` server endpoints in
  the FastAPI backend at integration time. Log every DJP request/response.

The data model (§6) and filing lifecycle (§9) are designed now so this layer only adds
transport, not schema churn.

---

## 15. Compliance & archival

- **10-year retention** (Indonesian tax law): archive all invoices, e-Faktur
  XML/PDF, bukti potong PDFs, SPT receipts, SSP/e-Billing codes. `tax_filings.file_path`
  points at Firebase Storage; provide a ZIP export.
- **Signed artifacts:** store signed SPT/SSP PDFs; log billing code + paid date.
- **Audit trail:** every tax write emits an `audit_logs` row (workspace-scoped),
  `action ∈ { tax_profile.update, tax_mapping.create, tax_mapping.update,
  tax_mapping.archive, tax_transaction.post, tax_transaction.reverse,
  tax_period.compute, tax_period.close, tax_filing.submit, tax_filing.accept,
  tax_filing.reject }`, with `before`/`after`, `reason` (required for archive/reject),
  `source: 'dashboard'|'ai'` (never `integration` for tax — too sensitive).
- **Access logs / integration logs:** record DJP API calls at integration time (§14).

---

## 16. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| **Regulatory change** (rates, thresholds, deadlines) | Rules-as-data, dated by `effective_from`; a rate change is a data edit, not a code change (§2, §4). |
| **Tax ≠ accounting drift** | Tax posts only as journal lines through the kernel; `reconcile-tax-balances.js` re-asserts; trial balance stays authoritative (§1, §12). |
| **Workspace-scoping leak** (members see 0 data) | All tax collections via `_scope`; added to the §4 grep guard; QA tests with a Finance teammate, not the owner. |
| **Lopsided lines** (rules check totals only) | Same accepted limitation + reconciliation script as the accounting kernel (§7, §4m.3). |
| **Filing an unlocked / mis-computed period** | Period lock + status-transition guard; `tax.file` owner/admin only; confirm-with-reason drawer (§8, §12). |
| **Over-promising compliance** | Label as "preview"/"tax-ready export", not "filed"; AI defers to an accountant; no auto-submit in v1 (§13, §14). |
| **Multi-entity / multi-currency** | `entity_id`/`currency`/`fx_rate` foresight fields already on journals; multi-entity UI deferred (§19). |
| **Sensitive data exposure** (NPWP, credentials) | Credentials server-side + encrypted, user-scoped, not a finance collection (§14); rules validate shapes (§7). |

---

## 17. Comparison study (brief)

- **Xero / QuickBooks** — clean tax-rate-per-line + automatic tax summary report.
  *Adopt:* tax code on the line, period summary derived not stored as truth.
  *Avoid:* their generic global tax engine doesn't model Indonesian withholding well.
- **Odoo / NetSuite / SAP B1** — deep, configurable, heavy. *Adopt:* rules-as-data,
  dated rates. *Avoid:* configuration sprawl; FluxyOS keeps a curated default set.
- **Accurate / Jurnal.id / Mekari** — strong local e-Faktur/e-Bupot integration and
  Indonesian defaults. *Adopt:* their faktur/bupot workflows and PKP/UMKM branching as
  the integration target. *Differentiate:* FluxyOS is a finance OS — tax derives from
  already-captured operations + AI, not a separate tax data-entry app.

---

## 18. Phased implementation roadmap

Each phase: effort (L/M/H), risk, acceptance criteria, manual QA. All phases honor the
QA gate (`QA_PASS=1`), the docs-read gate, and the separate `firebase deploy --only
firestore:rules` step. Localization pair-edit (§ LOCALIZATION_PLAN §12) applies from
the first UI phase.

| Phase | Scope | Effort | Risk |
|-------|-------|:---:|:---:|
| **1 — Foundations** | `company_tax_profile`; `tax_mappings`; COA extensions (§5); `tax-engine.js` skeleton + `PPN-OUT-11`/`PPN-IN-11` + `roundTax`; rules + perms; sidebar entry; Tax Profile + PPN summary tabs | H | Med |
| **2 — Withholding** | PPh 23/4(2)/26 (+21 if payroll exists) rules; bukti potong fields; `tax_transactions` posting via kernel; Withholding tab | H | Med |
| **3 — Periods & filings** | `tax_periods` (compute/close/lock); `tax_filings`; reconciliation controls (§12); SPT/bupot CSV exports; Tax Calendar | M | Med |
| **4 — Corporate & annual** | PPh 25 (`1140`), PPh 29 (`2200`), fiscal adjustments, annual reconciliation; Corporate Tax tab | M | Med |
| **5 — AI + Coretax readiness** | AI Tax Assistant (read-only); DJP/e-Faktur/e-Bupot integration seams in FastAPI backend (§14) | H | High |

**Acceptance criteria (per phase, representative):**

- *Phase 1:* A PKP workspace's sales invoice posts a balanced journal including
  `2100` PPN Keluaran; a purchase bill posts `1130` PPN Masukan; a Non-PKP workspace
  posts neither; `tax-engine.spec.js` green; a Finance teammate (not owner) sees the
  same tax data; rules deployed and viewer is read-only.
- *Phase 3:* Computing a month yields `ppn_payable == output − input`; closing locks
  the period; an SPT PPN CSV exports with correct totals; reopening requires an
  amendment that posts into the open period.

**Manual QA checklist (every phase):** new file references exist (`ls`); page
smoke-tested in a real browser; console clean (no CSP/CORS/404/Firebase errors);
workspace-scoping grep returns nothing; amounts raw integers; `Rp` no-space; audit log
written for each sensitive action; EN + ID copy paired.

---

## 18a. Posting integration — decisions (wired in Phase 1)

- **Tax-exclusive / gross-up (DECIDED).** Stored `amount`/`total_amount` is the DPP
  base; PPN sits on top. The tax engine grafts a **balanced pair** onto the base
  journal (`buildTaxAppendix` in `tax-engine.js`): output → `Dr <cash/AR leg> · Cr 2100`;
  input → `Dr 1130 · Cr <cash/AP leg>`. The cash/AR/AP leg is read off the base
  journal so the gross-up lands on the account the document already moved. The
  combined journal stays balanced (proved by `tests/tax-engine.spec.js` + the
  appendix assertions).
- **Explicit-treatment-only posting (DECIDED).** A PPN line posts to the ledger
  **only** when the document carries a `tax_code` or a saved `tax_mapping` names one
  (`selectExplicitTaxRules`). The blanket sales/purchase structural default drives the
  read-only summary, **never** the books. Result: documents with no tax treatment
  post byte-identical to before — zero regression — and tax is opt-in per
  category/document.
- **Wiring.** `db-service._applyTaxAppendix()` grafts the lines in place before
  numbering/attach in `_postSourceJournal` (and writes one `tax_transactions` row per
  PPN line) and in the `_correctSourceJournal` repost (so an edit re-applies tax to
  the ledger — the reversal already unwinds the old tax lines). Guarded: tax never
  blocks the base accounting post.
- **Known limitation (Phase 1).** Corrections keep the **ledger** correct but do not
  rewrite `tax_transactions` detail rows; period summaries should trust the ledger
  (`2100`/`1130`) and the reconcile script. Full tax_transactions correction is a §9
  follow-up.

## 18b. Phase 4 — Corporate income tax (SHIPPED)

Corporate tax differs from the per-transaction PPN/PPh work: it is **periodic/annual
computation + prepayment tracking**, not a gross-up appendix on a business document.
The COA accounts already exist (`1140` Prepaid PPh 25, `2200` PPh 29 Payable). As
built (Corporate Tax tab; `recordCorporateTaxPayment` / `computeAnnualCorporateTax` /
`postAnnualCorporateTax` in `db-service.js`):

- **PPh 25 (monthly installment).** Recording a PPh 25 payment posts `Dr 1140 Prepaid
  PPh 25 / Cr Cash` — a creditable prepaid asset, NOT `6500` Tax Expense. Build a
  dedicated `recordCorporateTaxPayment(userId, { kind:'pph25', amount, date })` that
  posts this via the kernel (a numbered system journal, like `_postSourceJournal` but
  a fixed two-line entry), audited. UI: a **Corporate Tax** tab with a "Record PPh 25
  payment" action + a list of installments and the running `1140` balance.
- **PPh 29 (annual balancing).** At year end: `CIT = 22% × taxable income` (taxable
  income = book net income ± fiscal adjustments). Credit prepayments: `1140` (PPh 25)
  + `1150` (PPh withheld by others). The remainder is `2200` PPh 29 payable (or an
  overpayment/refund). Build `computeAnnualCorporateTax(userId, fiscalYear, { adjustments })`
  reading the closed-year ledger (net income) + `1140`/`1150` balances; persist an
  annual `tax_periods` doc (`period_type:'annual'`) + a `tax_filings` SPT_Tahunan entry.
- **Fiscal adjustments.** Permanent + temporary book-to-tax differences as a small
  editable list feeding the taxable-income figure. Keep them as data (a
  `fiscal_adjustments` subcollection or fields on the annual `tax_periods` doc), never
  hardcoded.
- **UMKM vs ordinary (resolved — both shipped).** The annual reconciliation picks the
  scheme from `company_tax_profile.umkm_final`: true → `0.5% × turnover`; false →
  `22% × taxable income` (book net income ± fiscal adjustment). One Compute/Post flow
  handles both.

**Built as:** PPh 25 installment recording + a Corporate Tax tab, then annual PPh 29
(Compute preview → Post). Verified end-to-end (`tests/tax-corporate.spec.js`,
`tests/tax-annual.spec.js`).

**Not yet built (Phase 4 follow-ups):** UMKM 0.5% posted *monthly* (`Dr 6500 / Cr 2110`)
rather than only at annual reconciliation; a per-year fiscal-adjustments line list (the
current input is a single net adjustment number).

## 19. Open questions & assumptions

- **Multi-entity:** `entity_id` is present on journals/accounts but multi-entity UI is
  deferred. Assume single-entity per workspace for Phases 1–4; confirm before §9
  inter-company handling.
- **UMKM vs ordinary scheme:** `company_tax_profile.umkm_final` toggles the branch;
  assume a workspace is one or the other for a fiscal year. Confirm mid-year switch
  handling.
- **Payroll / PPh 21:** PPh 21 needs gross-pay + PTKP data. **Assumption: PPh 21 is
  deferred until a payroll module exists** (or enters via manual journals). Confirm
  whether a lightweight payroll capture is in scope for Phase 2.
- **Plan gating:** Should tax exports / filings be entitlement-gated (Core/Growth/
  Enterprise)? Default assumption: PPN summary on all paid plans, e-Faktur/Coretax on
  the top tier. Confirm with billing config.
- **Dedicated Tax Consultant role:** reuse `accountant` for v1 (§8); add the role only
  if external-accountant scoped access is requested.
- **Tax rounding edge cases** (PPnBM, partial-exempt invoices): default to per-line
  rounding; confirm against a real e-Faktur sample before Phase 3 exports.
