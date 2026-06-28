// =============================================================================
// FluxyOS — Accounting Engine (pure double-entry posting rules)
//
// This module is the heart of the accounting kernel. It is INTENTIONALLY pure:
// no Firestore, no DOM, no `window`. Given a business document it returns a
// balanced journal (Σdebit === Σcredit) or `null` when the document does not
// post. `db-service.js` wraps these outputs with server context (entity_id,
// posted_by, serverTimestamp) and writes them atomically alongside the document.
//
// Keeping posting logic here means it is deterministic, idempotent at the call
// site, and unit-testable in isolation (see tests/accounting-engine.spec.js).
//
// Money is ALWAYS a raw integer Rupiah (never a formatted string). Debits and
// credits are non-negative integers; every line carries exactly one non-zero
// side. See docs/PROJECT_BACKGROUND.md §4 for field conventions.
// =============================================================================

export const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'];

// Normal balance side per account type. Drives trial-balance/GL signed display
// and the closing roll-forward. Assets/expenses increase on debit; the rest on
// credit.
export const NORMAL_BALANCE = {
    asset: 'debit',
    expense: 'debit',
    liability: 'credit',
    equity: 'credit',
    revenue: 'credit'
};

// Canonical Chart of Accounts seed. Extends the display catalog in db-service.js
// (ACCOUNTING_ACCOUNT_CATALOG) with the accounts double-entry posting requires
// but that catalog lacks: Cash (1000), Retained Earnings (3000), and Opening
// Balance Equity (3900). This is the single source of truth shared by the seed
// script and db-service so they can never drift.
export const CHART_OF_ACCOUNTS_SEED = [
    { code: '1000', name: 'Cash & Bank', type: 'asset' },
    { code: '1100', name: 'Accounts Receivable', type: 'asset' },
    { code: '2000', name: 'Accounts Payable', type: 'liability' },
    { code: '3000', name: 'Retained Earnings', type: 'equity' },
    { code: '3900', name: 'Opening Balance Equity', type: 'equity' },
    { code: '4000', name: 'Revenue', type: 'revenue' },
    { code: '6100', name: 'Marketing Expense', type: 'expense' },
    { code: '6200', name: 'Software / SaaS Expense', type: 'expense' },
    { code: '6300', name: 'Infrastructure Expense', type: 'expense' },
    { code: '6400', name: 'Operations Expense', type: 'expense' },
    { code: '6500', name: 'Tax Expense', type: 'expense' },
    { code: '6600', name: 'Bank Fees', type: 'expense' },
    { code: '6999', name: 'Other Expense', type: 'expense' },
    // --- Indonesia Tax Center accounts (see docs/INDONESIA_TAX_CENTER_ARCHITECTURE.md
    // §5). Inactive for posting until tax-engine.js emits lines against them; seeded so
    // the chart is complete and tax journals resolve account names without a lookup.
    { code: '1130', name: 'PPN Masukan (Input VAT)', type: 'asset' },
    { code: '1140', name: 'Prepaid PPh 25', type: 'asset' },
    { code: '1150', name: 'PPh Dipotong Pihak Lain', type: 'asset' },
    { code: '2100', name: 'PPN Keluaran (Output VAT)', type: 'liability' },
    { code: '2110', name: 'PPh Payable', type: 'liability' },
    { code: '2200', name: 'PPh 29 Payable', type: 'liability' }
];

// Fast lookup: code -> { name, type }.
const ACCOUNT_INDEX = CHART_OF_ACCOUNTS_SEED.reduce((acc, a) => {
    acc[a.code] = { name: a.name, type: a.type };
    return acc;
}, {});

// Fixed account codes used by the posting rules.
const CASH = '1000';
const AR = '1100';
const AP = '2000';
const RETAINED_EARNINGS = '3000';
const OPENING_EQUITY = '3900';
const REVENUE = '4000';
const FEE_EXPENSE = '6600';
const TAX_EXPENSE = '6500';
const UNMAPPED_EXPENSE = '6999';

// Category/type → expense (or revenue) account. Mirrors ACCOUNTING_CATEGORY_DEFAULTS
// and ACCOUNTING_TYPE_DEFAULTS in db-service.js. Kept here so the engine resolves
// accounts without a Firestore round-trip.
const CATEGORY_DEFAULTS = {
    Revenue: REVENUE,
    Marketing: '6100',
    SaaS: '6200',
    Infrastructure: '6300',
    Operations: '6400'
};
const TYPE_EXPENSE_DEFAULTS = {
    fee: FEE_EXPENSE,
    tax: TAX_EXPENSE
};

// --- small pure helpers ---------------------------------------------------

export function accountByCode(code) {
    return ACCOUNT_INDEX[code] || null;
}

export function normalBalanceOf(type) {
    return NORMAL_BALANCE[type] || 'debit';
}

// Signed running balance for GL/trial-balance display: positive in the account's
// natural direction. An asset with more debits than credits shows positive; a
// liability with more credits than debits shows positive.
export function signedBalance(type, debitTotal, creditTotal) {
    const d = toInt(debitTotal);
    const c = toInt(creditTotal);
    return normalBalanceOf(type) === 'debit' ? d - c : c - d;
}

// Deterministic period key 'YYYY-MM' in Asia/Jakarta (Indonesian business
// reporting timezone) so a transaction near midnight lands in the right month
// regardless of the server's UTC clock. Accepts a JS Date, ms number, or a
// Firestore-Timestamp-like { toDate() } / { seconds }.
export function periodKey(dateInput) {
    const date = coerceDate(dateInput);
    // en-CA gives ISO-style YYYY-MM-DD; slice to YYYY-MM.
    return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }).slice(0, 7);
}

function coerceDate(input) {
    if (!input) return new Date();
    if (input instanceof Date) return input;
    if (typeof input === 'number') return new Date(input);
    if (typeof input?.toDate === 'function') return input.toDate();
    if (typeof input?.seconds === 'number') return new Date(input.seconds * 1000);
    const parsed = new Date(input);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function toInt(value) {
    const n = Math.round(Number(value));
    return Number.isFinite(n) ? n : 0;
}

// Positive integer amount or throw — posting must never silently drop a value.
function requireAmount(value, context) {
    const n = toInt(value);
    if (n <= 0) throw new Error(`accounting-engine: non-positive amount for ${context} (${value})`);
    return n;
}

function line(accountCode, debit, credit, memo) {
    const account = accountByCode(accountCode);
    return {
        account_code: accountCode,
        account_type: account ? account.type : 'expense',
        account_name: account ? account.name : accountCode,
        debit: toInt(debit),
        credit: toInt(credit),
        currency: 'IDR',
        fx_rate: 1,
        functional_amount: toInt(debit) || toInt(credit),
        memo: memo || ''
    };
}

// Resolve the income/expense account for a document, honoring (in priority):
// a saved accounting_mapping for the category, then the type, then category
// defaults, then type defaults, then the unmapped-expense fallback.
function resolveExpenseAccount(document, mappings) {
    const category = String(document?.category || '').trim();
    const type = String(document?.type || '').trim().toLowerCase();
    const map = mappings || {};
    if (category && map[`category:${category}`]) return map[`category:${category}`];
    if (type && map[`type:${type}`]) return map[`type:${type}`];
    if (category && CATEGORY_DEFAULTS[category]) return CATEGORY_DEFAULTS[category];
    if (TYPE_EXPENSE_DEFAULTS[type]) return TYPE_EXPENSE_DEFAULTS[type];
    return UNMAPPED_EXPENSE;
}

// --- rule selection -------------------------------------------------------

// Decide which posting rule a (collection, document) pair triggers, or null to
// skip posting (e.g. transfers, adjustments, free-text "Others" types, or an
// invoice still in draft). Payment transactions that carry a linked_bill_id /
// linked_invoice_id post the *settlement* rule (Dr A/P or Cr A/R) so the accrual
// they settle is not double-counted as a fresh expense/revenue.
export function selectRule(collection, document) {
    const doc = document || {};
    if (collection === 'transactions') {
        if (doc.linked_bill_id) return 'BILL-PAY';
        if (doc.linked_invoice_id) return 'INV-PAY';
        const type = String(doc.type || '').trim().toLowerCase();
        switch (type) {
            case 'income':
            case 'revenue':
            case 'refund':
                return 'TXN-INC-CASH';
            case 'expense':
                return 'TXN-EXP-CASH';
            case 'fee':
            case 'tax':
                return 'TXN-OPEX-CASH';
            case 'pending_receivable':
                return 'TXN-ACCRUE-AR';
            case 'pending_payable':
                return 'TXN-ACCRUE-AP';
            default:
                return null; // transfer / adjustment / custom — no posting
        }
    }
    if (collection === 'bills') return 'BILL-ACCRUE';
    if (collection === 'subscriptions') return 'SUB-ACCRUE';
    if (collection === 'invoices') {
        const status = String(doc.status || '').trim().toLowerCase();
        return status && status !== 'draft' ? 'INV-ISSUE' : null;
    }
    return null;
}

// --- the rule table: rule -> balanced lines -------------------------------

const RULES = {
    'TXN-INC-CASH': (doc) => {
        const amt = requireAmount(doc.amount, 'income');
        return [line(CASH, amt, 0, 'Cash received'), line(REVENUE, 0, amt, doc.category || 'Revenue')];
    },
    'TXN-EXP-CASH': (doc, ctx) => {
        const amt = requireAmount(doc.amount, 'expense');
        const acct = resolveExpenseAccount(doc, ctx.mappings);
        return [line(acct, amt, 0, doc.category || 'Expense'), line(CASH, 0, amt, 'Cash paid')];
    },
    'TXN-OPEX-CASH': (doc) => {
        const amt = requireAmount(doc.amount, 'opex');
        const acct = TYPE_EXPENSE_DEFAULTS[String(doc.type || '').toLowerCase()] || UNMAPPED_EXPENSE;
        return [line(acct, amt, 0, doc.type), line(CASH, 0, amt, 'Cash paid')];
    },
    'TXN-ACCRUE-AR': (doc) => {
        const amt = requireAmount(doc.amount, 'pending receivable');
        return [line(AR, amt, 0, 'Accrued receivable'), line(REVENUE, 0, amt, doc.category || 'Revenue')];
    },
    'TXN-ACCRUE-AP': (doc, ctx) => {
        const amt = requireAmount(doc.amount, 'pending payable');
        const acct = resolveExpenseAccount(doc, ctx.mappings);
        return [line(acct, amt, 0, doc.category || 'Expense'), line(AP, 0, amt, 'Accrued payable')];
    },
    'BILL-ACCRUE': (doc, ctx) => {
        const amt = requireAmount(doc.amount, 'bill');
        const acct = resolveExpenseAccount(doc, ctx.mappings);
        return [line(acct, amt, 0, doc.category || 'Bill'), line(AP, 0, amt, doc.vendor_name || 'Payable')];
    },
    'BILL-PAY': (doc) => {
        const amt = requireAmount(doc.amount, 'bill payment');
        return [line(AP, amt, 0, doc.vendor_name || 'Payable settled'), line(CASH, 0, amt, 'Cash paid')];
    },
    'SUB-ACCRUE': (doc, ctx) => {
        const amt = requireAmount(doc.amount, 'subscription');
        const acct = resolveExpenseAccount(doc, ctx.mappings);
        return [line(acct, amt, 0, doc.category || 'Subscription'), line(AP, 0, amt, doc.vendor_name || 'Payable')];
    },
    'INV-ISSUE': (doc) => {
        const amt = requireAmount(doc.amount ?? doc.total_amount, 'invoice');
        return [line(AR, amt, 0, doc.customer_name || 'Receivable'), line(REVENUE, 0, amt, 'Invoiced revenue')];
    },
    'INV-PAY': (doc) => {
        const amt = requireAmount(doc.amount, 'invoice payment');
        return [line(CASH, amt, 0, 'Cash received'), line(AR, 0, amt, 'Receivable settled')];
    }
};

// Human-readable description per posting rule. Mirrors the register labels but
// lives here so the description is stamped onto the journal at build time and is
// available on every drill-down surface (register, detail, exports) without a
// lookup. Reversals are derived from their `REVERSAL:<rule>` id.
const RULE_DESCRIPTIONS = {
    'TXN-INC-CASH': 'Income received',
    'TXN-EXP-CASH': 'Expense paid',
    'TXN-OPEX-CASH': 'Fee / tax paid',
    'TXN-ACCRUE-AR': 'Accrued receivable',
    'TXN-ACCRUE-AP': 'Accrued payable',
    'BILL-ACCRUE': 'Bill accrued',
    'BILL-PAY': 'Bill paid',
    'SUB-ACCRUE': 'Subscription accrued',
    'INV-ISSUE': 'Invoice issued',
    'INV-PAY': 'Invoice paid',
    'OPENING': 'Opening balance',
    'CLOSE': 'Period close'
};

export function describeRule(id) {
    if (!id) return 'Journal';
    if (String(id).startsWith('REVERSAL')) return 'Reversal';
    return RULE_DESCRIPTIONS[id] || id;
}

// --- public builders ------------------------------------------------------

// Assert balance and assemble totals. Throws on imbalance so a bug can never
// post a lopsided journal.
function finalize(lines, meta) {
    const totalDebit = lines.reduce((s, l) => s + toInt(l.debit), 0);
    const totalCredit = lines.reduce((s, l) => s + toInt(l.credit), 0);
    if (totalDebit !== totalCredit || totalDebit <= 0) {
        throw new Error(`accounting-engine: unbalanced journal (Dr ${totalDebit} / Cr ${totalCredit}) for ${meta.posting_rule_id}`);
    }
    return {
        ...meta,
        lines,
        total_debit: totalDebit,
        total_credit: totalCredit,
        is_balanced: true,
        currency: 'IDR'
    };
}

// Main entry: build a journal for a business document, or return null when the
// document does not post. Output omits server-only fields (entity_id, posted_by,
// posted_at) — db-service supplies those.
export function buildJournal({ collection, id, document, mappings, date } = {}) {
    const ruleId = selectRule(collection, document);
    if (!ruleId) return null;
    const builder = RULES[ruleId];
    if (!builder) return null;
    const lines = builder(document || {}, { mappings: mappings || {} });
    const when = date || document?.timestamp || document?.due_date || document?.date || new Date();
    return finalize(lines, {
        posting_rule_id: ruleId,
        journal_type: 'system',
        generated_by: 'posting_engine',
        description: describeRule(ruleId),
        source: { collection, id: id || null },
        period_key: periodKey(when),
        status: 'posted',
        memo: document?.vendor_name || document?.customer_name || ''
    });
}

// Opening-balance journal at cutover. `entries` are [{ account_code, debit, credit }]
// for the known asset/liability positions; the engine balances the difference to
// Opening Balance Equity (3900) so the entry always posts evenly.
export function buildOpeningJournal({ entries = [], date } = {}) {
    const lines = entries
        .filter((e) => toInt(e.debit) > 0 || toInt(e.credit) > 0)
        .map((e) => line(e.account_code, e.debit, e.credit, 'Opening balance'));
    const debit = lines.reduce((s, l) => s + l.debit, 0);
    const credit = lines.reduce((s, l) => s + l.credit, 0);
    const diff = debit - credit;
    if (diff > 0) lines.push(line(OPENING_EQUITY, 0, diff, 'Opening balance equity'));
    else if (diff < 0) lines.push(line(OPENING_EQUITY, -diff, 0, 'Opening balance equity'));
    return finalize(lines, {
        posting_rule_id: 'OPENING',
        journal_type: 'system',
        generated_by: 'posting_engine',
        description: 'Opening balance',
        source: { collection: null, id: null },
        period_key: periodKey(date || new Date()),
        status: 'posted',
        memo: 'Opening balance'
    });
}

// Period-close journal: roll net income (revenue − expense) into Retained
// Earnings (3000). Revenue and expense totals are positive integers in their
// natural direction. Returns null when there is nothing to close.
export function buildClosingJournal({ revenueTotal = 0, expenseTotal = 0, date, periodKey: pk } = {}) {
    const rev = toInt(revenueTotal);
    const exp = toInt(expenseTotal);
    const net = rev - exp;
    // Debit revenue to zero it out, credit the aggregate expense-clearing line
    // (6999 "Other Expense" as the aggregate expense contra at close — per-account
    // expense clearing is a Should-Have refinement), and post net income/loss to
    // Retained Earnings so the period's P&L rolls into equity.
    const lines = [];
    if (rev > 0) lines.push(line(REVENUE, rev, 0, 'Close revenue to retained earnings'));
    if (exp > 0) lines.push(line(UNMAPPED_EXPENSE, 0, exp, 'Close expenses to retained earnings'));
    if (net > 0) lines.push(line(RETAINED_EARNINGS, 0, net, 'Net income to retained earnings'));
    else if (net < 0) lines.push(line(RETAINED_EARNINGS, -net, 0, 'Net loss to retained earnings'));
    if (!lines.length) return null;
    return finalize(lines, {
        posting_rule_id: 'CLOSE',
        journal_type: 'system',
        generated_by: 'posting_engine',
        description: 'Period close',
        source: { collection: 'periods', id: pk || null },
        period_key: pk || periodKey(date || new Date()),
        status: 'posted',
        memo: `Close period ${pk || ''}`.trim()
    });
}

// Reversal lines: swap debit/credit so the reversal exactly offsets the original
// in ledger_balances. Used by the correction-in-current-period flow.
export function reverseLines(lines = []) {
    return (lines || []).map((l) => ({
        ...l,
        debit: toInt(l.credit),
        credit: toInt(l.debit),
        functional_amount: toInt(l.credit) || toInt(l.debit),
        memo: l.memo ? `Reversal: ${l.memo}` : 'Reversal'
    }));
}

// Build a reversal journal for a previously-posted journal. `targetPeriodKey`
// lets the caller post the reversal into the current OPEN period when the
// original sits in a closed period (the correction-in-current-period rule).
export function buildReversalJournal(original, { targetPeriodKey } = {}) {
    const lines = reverseLines(original.lines);
    return finalize(lines, {
        posting_rule_id: `REVERSAL:${original.posting_rule_id || ''}`,
        journal_type: original.journal_type || 'system',
        generated_by: 'posting_engine',
        description: original.journal_number
            ? `Reversal of ${original.journal_number}`
            : 'Reversal',
        manual_subtype: original.journal_type === 'manual' ? 'correction' : null,
        source: original.source || { collection: null, id: null },
        source_number: original.source_number || null,
        period_key: targetPeriodKey || original.period_key,
        status: 'reversal',
        reverses_journal_id: original.id || original.journal_id || null,
        memo: original.memo ? `Reversal: ${original.memo}` : 'Reversal'
    });
}

// Build a balanced manual journal from accountant-entered lines. Unlike the rule
// builders this carries no posting rule — the accountant chooses every account.
// `accountIndex` (code -> { name, type }) comes from the workspace chart of
// accounts so custom accounts resolve; it falls back to the seed index. Reuses
// finalize(), so an unbalanced manual entry throws and never posts (the draft
// path stores raw lines without calling this; only POST finalizes).
export function buildManualJournal({ lines = [], date, period_key, description, reference, subtype, accountIndex } = {}) {
    const idx = accountIndex || ACCOUNT_INDEX;
    const built = (lines || [])
        .map((l) => {
            const code = String(l.account_code || '').trim();
            const acct = idx[code] || ACCOUNT_INDEX[code] || null;
            const debit = toInt(l.debit);
            const credit = toInt(l.credit);
            return {
                account_code: code,
                account_type: acct ? acct.type : 'expense',
                account_name: acct ? acct.name : code,
                debit,
                credit,
                currency: 'IDR',
                fx_rate: 1,
                functional_amount: debit || credit,
                memo: l.memo || ''
            };
        })
        .filter((l) => l.account_code && (l.debit > 0 || l.credit > 0));
    const pk = period_key || periodKey(date || new Date());
    return finalize(built, {
        posting_rule_id: 'MANUAL',
        journal_type: 'manual',
        manual_subtype: subtype || null,
        generated_by: null, // db-service stamps the posting uid
        source: { collection: null, id: null },
        source_number: null,
        period_key: pk,
        status: 'posted',
        reference: reference || null,
        description: description || 'Manual journal',
        memo: description || ''
    });
}
