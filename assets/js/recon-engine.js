// =============================================================================
// FluxyOS — Bank Reconciliation Engine (pure statement-line matching)
//
// Phase B of docs/BANK_RECONCILIATION_PLAN.md. INTENTIONALLY pure — no
// Firestore, no DOM, no `window`. Given statement rows and candidate ledger
// transactions it proposes row → transaction matches through deterministic
// tiers with visible evidence; a human confirms every match (the acceptance
// ladder — nothing here writes or auto-applies).
//
// Tiers (cheapest sufficient wins):
//   R1  transaction already links this exact row (re-import / idempotency)
//   R2  same amount + direction + same day (+ same account when both set)
//   R3  same amount + direction, date within ±R3_WINDOW_DAYS
//   R4  same amount + direction, date within ±R4_WINDOW_DAYS, description
//       token overlap ≥ R4_MIN_TOKEN_OVERLAP
//
// The windows/thresholds are the plan's defaults, EXPERT-TUNABLE pending
// discovery Session 3 — change them here only.
// =============================================================================

export const R3_WINDOW_DAYS = 3;
export const R4_WINDOW_DAYS = 7;
export const R4_MIN_TOKEN_OVERLAP = 0.5;

export const MATCH_RULES = {
    R1: { id: 'R1', confidence: 'exact' },
    R2: { id: 'R2', confidence: 'exact' },
    R3: { id: 'R3', confidence: 'strong' },
    R4: { id: 'R4', confidence: 'review' }
};

const DAY_MS = 24 * 60 * 60 * 1000;

function toInt(value) {
    const n = Math.round(Number(value));
    return Number.isFinite(n) ? Math.abs(n) : 0;
}

function toMs(value) {
    if (!value) return null;
    if (typeof value.toDate === 'function') { try { return value.toDate().getTime(); } catch { return null; } }
    if (value instanceof Date) return value.getTime();
    if (typeof value.seconds === 'number') return value.seconds * 1000;
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? null : parsed;
}

// Calendar-day distance (not raw ms) so a 23:00 vs 01:00 pair still counts as
// adjacent days rather than "same day" ambiguity.
function dayDiff(aMs, bMs) {
    if (aMs === null || bMs === null) return null;
    return Math.abs(Math.round(aMs / DAY_MS) - Math.round(bMs / DAY_MS));
}

// Direction of a ledger transaction's cash movement. Prefers the explicit
// cash-impact field; falls back to the type. Transfers are ambiguous → 'any'.
export function transactionDirection(tx = {}) {
    if (tx.cash_direction === 'in' || tx.cash_direction === 'out') return tx.cash_direction;
    const type = String(tx.type || '').toLowerCase();
    if (['income', 'revenue', 'refund', 'pending_receivable'].includes(type)) return 'in';
    if (['expense', 'fee', 'tax', 'pending_payable'].includes(type)) return 'out';
    return 'any';
}

const TOKEN_STOPWORDS = new Set(['pt', 'cv', 'tbk', 'the', 'and', 'dan', 'ke', 'dari', 'trf', 'trsf', 'transfer', 'pembayaran', 'payment', 'via']);

export function tokenize(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((t) => t.length >= 3 && !TOKEN_STOPWORDS.has(t) && !/^\d+$/.test(t));
}

// Overlap of the smaller token set found in the larger one (0..1).
export function tokenOverlap(a, b) {
    const ta = tokenize(a);
    const tb = tokenize(b);
    if (!ta.length || !tb.length) return 0;
    const [small, large] = ta.length <= tb.length ? [ta, new Set(tb)] : [tb, new Set(ta)];
    const hits = small.filter((t) => large.has(t)).length;
    return hits / small.length;
}

function normalizeRow(row) {
    const credit = toInt(row.credit);
    const debit = toInt(row.debit);
    return {
        id: row.id,
        amount: credit > 0 ? credit : debit,
        direction: credit > 0 ? 'in' : 'out',
        dateMs: toMs(row.transaction_date) ?? toMs(row.posting_date),
        text: [row.suggested_vendor_name, row.description_raw].filter(Boolean).join(' ')
    };
}

function normalizeTx(tx) {
    return {
        id: tx.id,
        amount: toInt(tx.amount),
        direction: transactionDirection(tx),
        dateMs: toMs(tx.cash_effective_at) ?? toMs(tx.timestamp),
        accountId: tx.cash_account_id || null,
        rowLink: tx.bank_statement_row_id || null,
        text: String(tx.vendor_name || ''),
        reconciled: tx.recon_status === 'reconciled',
        voided: tx.is_voided === true
    };
}

// Evaluate one row against one transaction. Returns { rule, confidence,
// evidence[] } for the best tier that fires, or null.
export function evaluateMatch(rowN, txN, { bankAccountId = null } = {}) {
    if (!rowN.amount || rowN.amount !== txN.amount) return null;
    if (txN.direction !== 'any' && txN.direction !== rowN.direction) return null;
    const diff = dayDiff(rowN.dateMs, txN.dateMs);
    const amountEv = `amount exact (${rowN.amount})`;

    if (txN.rowLink && txN.rowLink === rowN.id) {
        return { rule: 'R1', confidence: MATCH_RULES.R1.confidence, evidence: ['already linked to this statement row'] };
    }
    const accountKnown = bankAccountId && txN.accountId;
    const accountMatches = accountKnown ? txN.accountId === bankAccountId : null;
    if (accountMatches === false) return null; // linked to a DIFFERENT account — never suggest
    if (diff === 0) {
        const evidence = [amountEv, 'same day'];
        if (accountMatches) evidence.push('same bank account');
        return { rule: 'R2', confidence: MATCH_RULES.R2.confidence, evidence };
    }
    if (diff !== null && diff <= R3_WINDOW_DAYS) {
        return { rule: 'R3', confidence: MATCH_RULES.R3.confidence, evidence: [amountEv, `date within ${diff} day${diff === 1 ? '' : 's'}`] };
    }
    if (diff !== null && diff <= R4_WINDOW_DAYS) {
        const overlap = tokenOverlap(rowN.text, txN.text);
        if (overlap >= R4_MIN_TOKEN_OVERLAP) {
            return {
                rule: 'R4',
                confidence: MATCH_RULES.R4.confidence,
                evidence: [amountEv, `date within ${diff} days`, `description ${Math.round(overlap * 100)}% similar`]
            };
        }
    }
    return null;
}

const RULE_ORDER = ['R1', 'R2', 'R3', 'R4'];

// Match statement rows to candidate transactions, one-to-one, greedy by tier
// then by date proximity. Rows that already created/linked a transaction and
// transactions already reconciled or voided are excluded.
// Returns { assignments: { [rowId]: { transaction_id, rule, confidence,
// evidence } }, matchedTransactionIds: Set }.
export function matchStatementRows({ rows = [], transactions = [], bankAccountId = null } = {}) {
    const rowNs = rows
        .filter((r) => r && !r.created_transaction_id && !r.matched_transaction_id)
        .map(normalizeRow)
        .filter((r) => r.amount > 0);
    const txNs = transactions
        .map(normalizeTx)
        .filter((t) => t.amount > 0 && !t.reconciled && !t.voided);

    // Score every viable pair once.
    const pairs = [];
    rowNs.forEach((rowN) => {
        txNs.forEach((txN) => {
            const hit = evaluateMatch(rowN, txN, { bankAccountId });
            if (hit) pairs.push({ rowId: rowN.id, txId: txN.id, dayDist: dayDiff(rowN.dateMs, txN.dateMs) ?? 99, ...hit });
        });
    });

    // Greedy one-to-one: best tier first, then closest date.
    pairs.sort((a, b) => (RULE_ORDER.indexOf(a.rule) - RULE_ORDER.indexOf(b.rule)) || (a.dayDist - b.dayDist));
    const assignments = {};
    const takenTx = new Set();
    pairs.forEach((p) => {
        if (assignments[p.rowId] || takenTx.has(p.txId)) return;
        assignments[p.rowId] = { transaction_id: p.txId, rule: p.rule, confidence: p.confidence, evidence: p.evidence };
        takenTx.add(p.txId);
    });
    return { assignments, matchedTransactionIds: takenTx };
}

// Certification tie-out: opening balance + reconciled movement vs the stated
// closing balance. `resolvedRows` are the rows the user acted on (create or
// reconcile). Returns integers; `delta` of 0 means the statement ties out.
export function computeTieOut({ openingBalance = null, closingBalance = null, rows = [] } = {}) {
    if (openingBalance == null || closingBalance == null) return null;
    let movement = 0;
    rows.forEach((row) => {
        movement += toInt(row.credit) - toInt(row.debit);
    });
    const computedClosing = Math.round(Number(openingBalance)) + movement;
    return {
        openingBalance: Math.round(Number(openingBalance)),
        movement,
        computedClosing,
        closingBalance: Math.round(Number(closingBalance)),
        delta: Math.round(Number(closingBalance)) - computedClosing
    };
}
