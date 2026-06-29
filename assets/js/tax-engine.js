// =============================================================================
// FluxyOS — Tax Engine (pure Indonesian tax classification rules)
//
// The tax analogue of accounting-engine.js. It is INTENTIONALLY pure: no
// Firestore, no DOM, no `window`. Given a business document, the workspace tax
// profile, and saved tax mappings it returns the tax LINES that should be
// appended to the journal the accounting engine already built for that document
// (e.g. a PKP sales invoice posts Dr A/R / Cr Revenue, and the tax engine adds
// Cr 2100 PPN Keluaran). The tax engine NEVER creates an independent ledger —
// accounting stays the source of truth. See docs/INDONESIA_TAX_CENTER_ARCHITECTURE.md.
//
// Tax rules are DATA, not code: rates, GL accounts, direction, and rounding live
// in the tables below keyed by `effective_from`, so a regulatory change is a data
// edit, not a logic rewrite. `db-service.js` wraps these outputs with server
// context and writes one tax_transactions row per line in the same writeBatch.
//
// Money is ALWAYS a raw integer Rupiah. `taxable_base` is the pre-tax base (DPP).
//
// Phase 1 scope (see ROADMAP "Tax Center"): PPN output on sales, PPN input on
// purchases, gated by PKP status. Withholding (PPh), periods, and filings land in
// later phases.
// =============================================================================

export const TAX_DIRECTIONS = ['output', 'input', 'withheld_by_us', 'withheld_by_other', 'final'];

// Canonical tax codes the engine can emit. Extended in later phases (PPh 21/23/26,
// 4(2), final UMKM, import, PPnBM).
export const TAX_CODES = {
    PPN_OUT_11: 'PPN_OUT_11',
    PPN_IN_11: 'PPN_IN_11',
    PPN_EXEMPT: 'PPN_EXEMPT',
    PPN_ZERO: 'PPN_ZERO'
};

// Rate table (data, dated). rate is a percent integer; gl_account_code is the
// account the tax line posts to; direction drives period reconciliation buckets.
// effective_from lets a future rate (e.g. a PPN change) coexist with history.
export const TAX_RATES = {
    PPN_OUT_11: { rate: 11, gl_account_code: '2100', gl_account_type: 'liability', direction: 'output', side: 'credit', name: 'PPN Keluaran', effective_from: '2022-04-01' },
    PPN_IN_11: { rate: 11, gl_account_code: '1130', gl_account_type: 'asset', direction: 'input', side: 'debit', name: 'PPN Masukan', effective_from: '2022-04-01' },
    PPN_EXEMPT: { rate: 0, gl_account_code: null, gl_account_type: null, direction: 'output', side: null, name: 'PPN Dibebaskan', effective_from: '2022-04-01' },
    PPN_ZERO: { rate: 0, gl_account_code: null, gl_account_type: null, direction: 'output', side: null, name: 'PPN 0%', effective_from: '2022-04-01' }
};

// Per-code rounding. PPN is rounded to the nearest whole rupiah per DJP practice.
// Centralized so every rule and the reconciliation script agree.
const TAX_ROUNDING = {
    default: (n) => Math.round(n)
};

// --- small pure helpers ---------------------------------------------------

function toInt(value) {
    const n = Math.round(Number(value));
    return Number.isFinite(n) ? n : 0;
}

// Round a raw (possibly fractional) tax amount per the code's rounding rule.
export function roundTax(amount, taxCode) {
    const fn = TAX_ROUNDING[taxCode] || TAX_ROUNDING.default;
    return toInt(fn(Number(amount) || 0));
}

export function rateFor(taxCode) {
    const r = TAX_RATES[taxCode];
    return r ? r.rate : 0;
}

// True when the workspace charges/credits PPN (VAT-registered). A missing profile
// is treated as Non-PKP so the engine never invents output VAT for an unconfigured
// workspace.
function isPKP(profile) {
    return !!profile && String(profile.pkp_status || '').toLowerCase() === 'pkp';
}

// The pre-tax base (DPP) for a document. Phase 1 assumption: stored `amount` /
// `total_amount` is the taxable base. (Tax-inclusive entry — gross-up vs. extract —
// is an open question tracked in the architecture doc; revisit before Phase 3.)
function taxableBaseOf(document) {
    const base = document?.taxable_base ?? document?.amount ?? document?.total_amount;
    return toInt(base);
}

// --- rule selection -------------------------------------------------------

// Decide which tax code(s) a (collection, document) pair triggers, or [] to skip.
// Resolution priority mirrors accounting's resolveExpenseAccount: a saved tax_mapping
// for the category/type wins, then the structural default (sales → output VAT,
// purchase → input VAT), all gated by PKP status. Non-PKP / drafts / transfers skip.
export function selectTaxRules(collection, document, profile, mappings) {
    const doc = document || {};
    const map = mappings || {};
    const category = String(doc.category || '').trim();
    const type = String(doc.type || '').trim().toLowerCase();

    // Explicit per-document override always wins.
    if (doc.tax_code && TAX_RATES[doc.tax_code]) return [doc.tax_code];
    // Saved mapping (category then type).
    if (category && map[`category:${category}`]) return [map[`category:${category}`]];
    if (type && map[`type:${type}`]) return [map[`type:${type}`]];

    if (!isPKP(profile)) return []; // Non-PKP charges/credits no VAT.

    if (collection === 'invoices') {
        const status = String(doc.status || '').trim().toLowerCase();
        return status && status !== 'draft' ? [TAX_CODES.PPN_OUT_11] : [];
    }
    if (collection === 'bills' || collection === 'subscriptions') {
        return [TAX_CODES.PPN_IN_11]; // creditable input VAT on purchases
    }
    if (collection === 'transactions') {
        if (doc.linked_bill_id || doc.linked_invoice_id) return []; // settlement leg — VAT already on the accrual
        switch (type) {
            case 'income':
            case 'revenue':
                return [TAX_CODES.PPN_OUT_11];
            case 'expense':
                return [TAX_CODES.PPN_IN_11];
            default:
                return []; // fee/tax/transfer/adjustment/pending/custom — no VAT in Phase 1
        }
    }
    return [];
}

// --- the tax-line builder -------------------------------------------------

// Build one tax line for a code against a base. The line is an ADDITIONAL journal
// line (not a standalone balanced journal — it pairs with the base posting's
// gross-up of A/R or A/P). Codes with a null GL account (exempt / zero-rated) emit
// no line.
function buildTaxLine(taxCode, base, document) {
    const spec = TAX_RATES[taxCode];
    if (!spec || !spec.gl_account_code) return null;
    const amount = roundTax((base * spec.rate) / 100, taxCode);
    if (amount <= 0) return null;
    return {
        tax_code: taxCode,
        tax_name: spec.name,
        direction: spec.direction,
        tax_rate: spec.rate,
        taxable_base: toInt(base),
        tax_amount: amount,
        gl_account_code: spec.gl_account_code,
        debit_or_credit: spec.side, // 'debit' (input/asset) | 'credit' (output/liability)
        npwp_counterparty: document?.npwp_counterparty || null,
        faktur_number: document?.faktur_number || null
    };
}

// --- public entry ---------------------------------------------------------

// Main entry: classify a business document into tax lines. Returns
// { tax_lines: [...], skipped: bool }. `skipped: true` with an empty array means
// the document legitimately bears no tax (Non-PKP, draft, transfer, exempt) — not
// an error.
export function classifyTax({ collection, document, profile, mappings } = {}) {
    const codes = selectTaxRules(collection, document || {}, profile, mappings);
    if (!codes.length) return { tax_lines: [], skipped: true };
    const base = taxableBaseOf(document);
    const lines = codes
        .map((code) => buildTaxLine(code, base, document || {}))
        .filter(Boolean);
    return { tax_lines: lines, skipped: lines.length === 0 };
}

// --- posting integration (gross-up appendix) ------------------------------

// EXPLICIT-ONLY selection for posting: a tax line posts to the ledger only when the
// document carries a tax_code or a saved tax_mapping names one — never the blanket
// sales/purchase structural default (that drives the read-only summary, not the
// books). This keeps existing postings byte-identical until a workspace opts a
// category/document into a tax treatment. PPN codes still require PKP status.
export function selectExplicitTaxRules(collection, document, profile, mappings) {
    const doc = document || {};
    const map = mappings || {};
    // Settlement legs (a payment linked to a bill/invoice) post Dr A/P-Cr Cash or
    // Dr Cash-Cr A/R — they never carry tax: the PPN rode on the accrual/issue. Tax
    // here would double-count and gross up the settlement. Skip them.
    if (doc.linked_bill_id || doc.linked_invoice_id) return [];
    const category = String(doc.category || '').trim();
    const type = String(doc.type || '').trim().toLowerCase();
    let codes = [];
    if (doc.tax_code && TAX_RATES[doc.tax_code]) codes = [doc.tax_code];
    else if (category && map[`category:${category}`]) codes = [map[`category:${category}`]];
    else if (type && map[`type:${type}`]) codes = [map[`type:${type}`]];
    return codes.filter((c) => {
        const spec = TAX_RATES[c];
        if (!spec || !spec.gl_account_code) return false;
        if (String(c).startsWith('PPN') && !isPKP(profile)) return false; // VAT needs PKP
        return true;
    });
}

function journalLine(accountCode, accountType, accountName, debit, credit, memo) {
    return {
        account_code: accountCode,
        account_type: accountType || 'asset',
        account_name: accountName || accountCode,
        debit: toInt(debit),
        credit: toInt(credit),
        currency: 'IDR',
        fx_rate: 1,
        functional_amount: toInt(debit) || toInt(credit),
        memo: memo || ''
    };
}

// Build the BALANCED tax lines to graft onto a base journal (tax-exclusive /
// gross-up model — the Indonesian faktur convention: stored amount is the DPP base,
// PPN sits on top). Each code appends a matched debit+credit pair so the combined
// journal stays balanced (Σdebit === Σcredit):
//   output: Dr <cash/AR leg> ppn · Cr 2100 PPN Keluaran ppn   (grosses up what's owed to us)
//   input:  Dr 1130 PPN Masukan ppn · Cr <cash/AP leg> ppn    (grosses up what we owe)
// The cash/AR/AP leg is read off the base journal so the gross-up lands on the same
// account the document already moved. Returns { lines, tax_transactions } or null.
export function buildTaxAppendix({ baseJournal, collection, document, profile, mappings } = {}) {
    if (!baseJournal || !Array.isArray(baseJournal.lines)) return null;
    const doc = document || {};

    // Invoices carry their own PPN on the document (tax_rate_percent / tax_amount).
    // INV-ISSUE posts Dr A/R / Cr Revenue for the TOTAL (incl. PPN), so reclass the
    // PPN portion out of Revenue into 2100 PPN Keluaran: Dr <revenue> (tax) / Cr 2100
    // (tax). Net: A/R = total, Revenue = subtotal, 2100 = tax. Only when PKP and the
    // invoice actually has PPN — untaxed invoices post unchanged.
    if (collection === 'invoices') {
        if (!isPKP(profile)) return null;
        const tax = toInt(doc.tax_amount);
        if (tax <= 0) return null;
        const revLeg = baseJournal.lines.find((l) => l.account_type === 'revenue' && toInt(l.credit) > 0)
            || baseJournal.lines.find((l) => toInt(l.credit) > 0);
        if (!revLeg) return null;
        const subtotal = toInt(doc.subtotal_amount) || (toInt(doc.total_amount) - tax);
        return {
            lines: [
                journalLine(revLeg.account_code, revLeg.account_type, revLeg.account_name, tax, 0, 'PPN reclass'),
                journalLine('2100', 'liability', 'PPN Keluaran', 0, tax, 'PPN Keluaran')
            ],
            tax_transactions: [{
                tax_code: 'PPN_OUT_11', tax_name: 'PPN Keluaran', direction: 'output',
                tax_rate_percent: Number(doc.tax_rate_percent) || rateFor('PPN_OUT_11'),
                taxable_base: subtotal, tax_amount: tax, period_key: baseJournal.period_key || null,
                npwp_counterparty: doc.customer_npwp || null, faktur_number: doc.faktur_number || null
            }]
        };
    }

    // Bills carry per-bill PPN and/or PPh withholding. The entered amount is the TOTAL
    // owed (tax-inclusive). BILL-ACCRUE posts Dr Expense / Cr A/P for the total. Two
    // independent, balanced grafts stack onto it (the DPP base is shared):
    //   • PPN (input), PKP only: base = round(total/(1+ppnRate)); ppn = total − base.
    //     Dr 1130 PPN Masukan / Cr Expense (ppn). Net Expense = base, A/P = total.
    //   • PPh withholding (we withhold), any business: pph = round(base × whtRate).
    //     Dr A/P / Cr 2110 PPh Payable (pph). Net A/P = total − pph (vendor gets net),
    //     2110 = pph (we owe DJP). The vendor's PPN is not withheld.
    // Only the grafts whose rate is set are emitted; an untaxed bill posts unchanged.
    if (collection === 'bills') {
        const total = toInt(doc.amount);
        const ppnRate = isPKP(profile) ? (Number(doc.tax_rate_percent) || 0) : 0;
        const whtRate = Number(doc.withholding_rate) || 0;
        if (total <= 0 || (ppnRate <= 0 && whtRate <= 0)) return null;
        const base = ppnRate > 0 ? Math.round(total / (1 + ppnRate / 100)) : total;
        const periodKey = baseJournal.period_key || null;
        const expLeg = baseJournal.lines.find((l) => l.account_type === 'expense' && toInt(l.debit) > 0)
            || baseJournal.lines.find((l) => toInt(l.debit) > 0);
        const apLeg = baseJournal.lines.find((l) => l.account_type === 'liability' && toInt(l.credit) > 0)
            || baseJournal.lines.find((l) => toInt(l.credit) > 0);
        const lines = [];
        const taxTx = [];
        if (ppnRate > 0 && expLeg) {
            const ppn = total - base;
            if (ppn > 0) {
                lines.push(journalLine('1130', 'asset', 'PPN Masukan', ppn, 0, 'PPN Masukan'));
                lines.push(journalLine(expLeg.account_code, expLeg.account_type, expLeg.account_name, 0, ppn, 'PPN extract'));
                taxTx.push({
                    tax_code: 'PPN_IN_11', tax_name: 'PPN Masukan', direction: 'input',
                    tax_rate_percent: ppnRate, taxable_base: base, tax_amount: ppn, period_key: periodKey,
                    npwp_counterparty: doc.vendor_npwp || null, faktur_number: doc.faktur_number || null
                });
            }
        }
        if (whtRate > 0 && apLeg) {
            const pph = Math.round((base * whtRate) / 100);
            if (pph > 0) {
                lines.push(journalLine(apLeg.account_code, apLeg.account_type, apLeg.account_name, pph, 0, 'PPh withheld'));
                lines.push(journalLine('2110', 'liability', 'PPh Payable', 0, pph, doc.withholding_type || 'PPh withheld'));
                taxTx.push({
                    tax_code: doc.withholding_code || 'PPH_WHT', tax_name: doc.withholding_type || 'PPh withholding',
                    direction: 'withheld_by_us', tax_rate_percent: whtRate, taxable_base: base, tax_amount: pph,
                    period_key: periodKey, npwp_counterparty: doc.vendor_npwp || null, bukti_potong_no: doc.bukti_potong_no || null
                });
            }
        }
        if (!lines.length) return null;
        return { lines, tax_transactions: taxTx };
    }

    const codes = selectExplicitTaxRules(collection, document || {}, profile, mappings);
    if (!codes.length) return null;
    const base = taxableBaseOf(document);
    const periodKey = baseJournal.period_key || null;
    const assetDebitLeg = baseJournal.lines.find((l) => toInt(l.debit) > 0 && l.account_type === 'asset')
        || baseJournal.lines.find((l) => toInt(l.debit) > 0);
    const settlementCreditLeg = baseJournal.lines.find((l) => toInt(l.credit) > 0 && (l.account_type === 'liability' || l.account_type === 'asset'))
        || baseJournal.lines.find((l) => toInt(l.credit) > 0);

    const lines = [];
    const taxTx = [];
    for (const code of codes) {
        const spec = TAX_RATES[code];
        const ppn = roundTax((base * spec.rate) / 100, code);
        if (ppn <= 0) continue;
        if (spec.direction === 'output') {
            if (!assetDebitLeg) continue;
            lines.push(journalLine(assetDebitLeg.account_code, assetDebitLeg.account_type, assetDebitLeg.account_name, ppn, 0, 'PPN gross-up'));
            lines.push(journalLine(spec.gl_account_code, spec.gl_account_type, spec.name, 0, ppn, spec.name));
        } else { // input
            if (!settlementCreditLeg) continue;
            lines.push(journalLine(spec.gl_account_code, spec.gl_account_type, spec.name, ppn, 0, spec.name));
            lines.push(journalLine(settlementCreditLeg.account_code, settlementCreditLeg.account_type, settlementCreditLeg.account_name, 0, ppn, 'PPN gross-up'));
        }
        taxTx.push({
            tax_code: code,
            tax_name: spec.name,
            direction: spec.direction,
            tax_rate_percent: spec.rate,
            taxable_base: toInt(base),
            tax_amount: ppn,
            period_key: periodKey,
            npwp_counterparty: document?.npwp_counterparty || null,
            faktur_number: document?.faktur_number || null
        });
    }
    if (!lines.length) return null;
    return { lines, tax_transactions: taxTx };
}
