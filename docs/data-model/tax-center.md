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

## PPh withholding on bills — the object picker

`assets/js/pph-objects.js` is a dated rate table of the things a business
actually withholds on. The Add Bill drawer asks **what the payment is**, and the
rate follows.

**It replaced a bare "PPh withholding (%)" number field.** That asked the person
recording a vendor bill to already know whether jasa konsultasi is 2% or 15% —
and a mistyped rate is invisible: it posts a smaller liability to `2110`, the
bill still balances, and nothing anywhere reports that the withholding was short.

**Nothing about the posting changed.** `buildTaxAppendix` already grafted the
2110 line onto `BILL-ACCRUE` from `withholding_rate`, with bukti potong
compliance checks and the Bukti Potong CSV export downstream. The picker writes
the same three fields it always read — `withholding_rate`, `withholding_type`,
`withholding_code` — plus `withholding_object_id` and `withholding_npwp` for
provenance. Renaming any of the first three silently detaches the picker from
the posting; `tests/pph-withholding.spec.js` pins them.

### Rates, and where they come from

| Object | Rate | Source |
|---|---:|---|
| PPh 23 — jasa lainnya, sewa (non tanah/bangunan) | 2% | [Klikpajak, PPh 23](https://klikpajak.id/blog/pajak-pph-23-tarif-pajak-penghasilan-pasal-23/) |
| PPh 23 — dividen, bunga, royalti, hadiah | 15% | same |
| PPh 4(2) — sewa tanah & bangunan | 10% | [Klikpajak, PPh 4(2)](https://klikpajak.id/blog/pph-pasal-4-ayat-2/) |
| PPh 4(2) — konstruksi (kecil / menengah-besar / tanpa sertifikat / perancang) | 1,75% / 2,65% / 4% / 6% | [Klikpajak, jasa konstruksi](https://klikpajak.id/blog/pajak-final-pasal-4-ayat-2/) |
| PPh 21 — bukan pegawai | DPP 50% × Pasal 17 | PMK 168/2023 |
| PPh 26 — penerima luar negeri | 20% | UU PPh Pasal 26 |

Every figure is transcribed, never computed, and carries `effective_from` so a
future change can coexist with history — the same discipline `TAX_RATES` follows.

### Three decisions worth keeping

**The rate stays editable.** Jasa konstruksi is four rates by certification, and
PPh 21 bukan pegawai is progressive — 2,5% is DPP 50% × the 5% first bracket
only, and rises above it. A locked field would be confidently wrong for both, so
the object's rate is a starting point and the hint says so.

**The no-NPWP surcharge is per object, not global.** A vendor without an NPWP is
withheld at **double** for PPh 23 — the most common silent error in Indonesian
withholding, and the company owes the difference at audit. But it does not apply
everywhere: PPh 4(2) is final at a fixed rate, and PPh 21's surcharge is 20%
higher, not 100%. The switch is hidden where it would change nothing, because a
toggle that does nothing teaches people to ignore the one that matters.

**The preview states the arithmetic, in Bahasa.** "2%" is not the number anybody
is about to act on — what the vendor receives is. The box shows dasar pengenaan →
PPh dipotong → dibayar ke vendor, and names the surcharge when it fired. It nets
PPN out of the base the same way `buildTaxAppendix` does, so the preview cannot
disagree with the journal it is previewing.

### Not built

The sheet's construction-services **SK attachment** is noted as nice-to-have and
is not built. Bills already carry document attachments
(`FluxyDocumentAttachment`), so it is a field, not a mechanism.
