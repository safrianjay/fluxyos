---
status: current
owns: [company_tax_profile, tax_mappings, tax_transactions, tax_periods, tax_filings]
updated: 2026-08-07
source: docs/PROJECT_BACKGROUND.md §4 (sharded 2026-08-07)
---

# Tax Center

> Workspace-scoping rules for these collections live in
> [`PROJECT_BACKGROUND.md` §4](../PROJECT_BACKGROUND.md#4-firestore-database-schema).
> Read that first — it is always loaded; this shard is not.

### 4o. Tax Center — Indonesian tax collections (SHIPPED Phases 1–4 + 5.1, workspace-scoped)

**Status: live on main (rules deployed).** PPN (output `2100` / input `1130`),
withholding (`2110` we-withhold / `1150` customers-withhold), tax periods
(compute/file/lock), SPT PPN + Bukti Potong CSV exports, `tax_filings`, corporate
tax (PPh 25 installments → `1140`; annual PPh 29 → `2200`, UMKM 0.5% / ordinary 22%),
and the AI Tax Assistant foundation (deterministic compliance insights +
`FluxyAIContext` drawer context, read-only) are all shipped. Phase 5.2
(Coretax/e-Faktur/e-Bupot) is blocked on real DJP API access. Full spec:
`docs/INDONESIA_TAX_CENTER_ARCHITECTURE.md`. Listed here so the schema reference and
the §4 grep guard cover the collections from day one. The Tax Center is **derived**:
tax amounts post as **additional lines on the journal the business document already
generates** through the existing Accounting Kernel (§4m.3) — never a parallel ledger.
Pure rules live in `assets/js/tax-engine.js` (mirrors `accounting-engine.js`: no
Firestore/DOM, unit-tested). All amounts raw integer Rupiah; route every path through
`_scope()`; append-only collections soft-archive via `status`.

| Collection | Doc id | Key fields |
|---|---|---|
| `company_tax_profile` | `current` | `npwp, nik, pkp_status ('pkp'\|'non_pkp'), pkp_effective_date, umkm_final (bool), tax_office_kpp, business_classification, default_ppn_rate (int %), entity_id, updated_by, updated_at`. One per workspace; drives every engine branch. |
| `tax_mappings` | `{source_type}__{source_value}` | `source_type, source_value, tax_code, tax_rate_percent, effective_from, effective_until, status ('active'\|'archived'), created_by, created_at, updated_at`. Mirrors `accounting_mappings`. |
| `tax_transactions` | auto (append-only) | `source_collection, source_id, source_number, tax_code, tax_name, direction ('output'\|'input'\|'withheld_by_us'\|'withheld_by_other'\|'final'), tax_rate_percent, taxable_base (int), tax_amount (int), period_key 'YYYY-MM', journal_ref, npwp_counterparty, faktur_number, bukti_potong_no, status ('draft'\|'posted'\|'corrected'\|'reversed'), reverses_tax_tx_id, reversed_by_tax_tx_id, entity_id, created_by, created_at`. |
| `tax_periods` | `{period_type}-{period_key}` | `period_type ('monthly'\|'quarterly'\|'annual'), period_key, period_start, period_end, filing_deadline, status ('open'\|'computed'\|'filed'\|'amended'\|'settled'), ppn_output, ppn_input, ppn_payable, pph_withheld, pph_credit, pph_final (all int), entity_id, closed_by, closed_at, updated_at`. Cached summary of `tax_transactions` (the rows are the source), like `ledger_balances`. |
| `tax_filings` | auto (append-only) | `period_id, filing_type ('SPT_PPN'\|'SPT_PPh_Unifikasi'\|'SPT_PPh21'\|'SPT_Tahunan'\|'Tax_Certificate'), filing_date, reference_number, status ('draft'\|'filed'\|'accepted'\|'rejected'\|'amended'), file_path, external_link, filed_by, audit_log_id, entity_id, created_at, updated_at`. |

**New COA accounts** (added to `CHART_OF_ACCOUNTS_SEED`): `1130` PPN Masukan,
`1140` Prepaid PPh 25, `1150` PPh withheld-by-customers, `2100` PPN Keluaran,
`2110` PPh Payable, `2200` PPh 29 Payable.

**New optional fields on transactions/bills/invoices** (additive; validators must
allow them like `isValidAccountingLink`): `tax_code`, `taxable_base` (int),
`tax_amount` (int), `npwp_counterparty`, `faktur_number`, `bukti_potong_no`,
`withholding_flag` (bool).

**Permissions:** `tax.read` (all incl. viewer), `tax.map`/`tax.post`/`tax.period.close`
(finance+/accountant), `tax.file` (owner/admin). **Audit actions** (`target_collection`
the tax collection): `tax_profile.update`, `tax_mapping.create/update/archive`,
`tax_transaction.post/reverse`, `tax_period.compute/close`,
`tax_filing.submit/accept/reject`. Rules deploy separately
(`firebase deploy --only firestore:rules`).
