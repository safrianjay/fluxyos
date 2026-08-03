// =============================================================================
// FluxyOS — Duplicate Detection Engine (pure record-to-record scoring)
//
// Phase 1 of docs/DUPLICATE_PREVENTION.md. INTENTIONALLY pure — no Firestore,
// no DOM, no `window`. Given an incoming record and a bounded set of existing
// candidates it returns scored matches with visible evidence; a human decides
// every outcome (nothing here writes, voids, merges, or auto-rejects).
//
// Deliberately the sibling of recon-engine.js and it REUSES that module's text
// helpers, so "72% similar" means the same thing in the duplicate dialog as it
// does in the bank reconciliation panel.
//
// Tiers (cheapest sufficient wins):
//   D0  an identity key collides — same bank row, same marketplace order, same
//       file hash, or a collision in one of OUR OWN generated number series
//   D1  same counterparty + same counterparty document number
//   D2  same amount + same counterparty + same calendar day
//   D3  same amount + same counterparty, date within NEAR_DATE_WINDOW_DAYS
//   D4  same amount + same day, counterparty names merely SIMILAR
//   D5  same amount, date within WIDE_WINDOW_DAYS, description tokens overlap
//   D6  same amount + same account + same category within WIDE_WINDOW_DAYS
//
// Every rule above D1 requires the date to be within WIDE_WINDOW_DAYS. That is
// what keeps recurring rent/subscription/payroll entries from flagging forever
// — they repeat monthly, far outside every window.
//
// The windows/thresholds/weights are v1 defaults. Tune them HERE only; both the
// pre-save guard and the Accounting Center cleanup scan read from this file, so
// a change stays consistent across the product.
// =============================================================================

import { tokenize, tokenOverlap } from './recon-engine.js';

export const NEAR_DATE_WINDOW_DAYS = 3;
export const WIDE_WINDOW_DAYS = 7;
export const PARTY_MIN_TOKEN_OVERLAP = 0.5;
export const TEXT_MIN_TOKEN_OVERLAP = 0.5;

// Band thresholds. `high` blocks, `medium` asks, `low` is a passive hint.
export const BAND_HIGH_MIN = 85;
export const BAND_MEDIUM_MIN = 55;
export const BAND_LOW_MIN = 30;

// Cadences (in days) that mark a repeat as a RENEWAL rather than a duplicate.
// Monthly and longer only: everything shorter sits inside WIDE_WINDOW_DAYS,
// where suppressing would hide real same-week double entries.
export const RECURRING_CADENCE_DAYS = [30, 31, 90, 91, 182, 365];
export const RECURRING_TOLERANCE_DAYS = 4;

export const DUP_RULES = {
    D0: { id: 'D0', base: 100, blocking: true },
    D1: { id: 'D1', base: 95, blocking: true },
    D2: { id: 'D2', base: 90, blocking: true },
    D3: { id: 'D3', base: 75, blocking: false },
    D4: { id: 'D4', base: 60, blocking: false },
    D5: { id: 'D5', base: 45, blocking: false },
    D6: { id: 'D6', base: 30, blocking: false }
};

const RULE_ORDER = ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6'];

const DAY_MS = 24 * 60 * 60 * 1000;

// Per-collection field mapping. Two distinct kinds of document number:
//   ownNumbers    — series FluxyOS generates (BILL-…, INV-…, JV-…). These are
//                   unique BY CONSTRUCTION, so a collision is an integrity
//                   failure, not a judgement call → D0.
//   partyNumbers  — the counterparty's own reference (a vendor's invoice
//                   number). A repeat is the classic A/P duplicate → D1.
const FIELD_MAP = {
    transactions: {
        amount: ['amount'],
        party: ['vendor_name'],
        dates: ['timestamp', 'cash_effective_at'],
        ownNumbers: [],
        partyNumbers: ['invoice_number', 'payment_reference'],
        text: ['notes', 'raw_text_preview']
    },
    bills: {
        amount: ['amount'],
        party: ['vendor_name'],
        dates: ['invoice_date', 'due_date', 'timestamp'],
        ownNumbers: ['bill_number'],
        partyNumbers: ['invoice_number', 'payment_reference'],
        text: ['notes', 'raw_text_preview']
    },
    subscriptions: {
        amount: ['amount'],
        party: ['vendor_name'],
        dates: ['renewal_date', 'timestamp'],
        ownNumbers: [],
        partyNumbers: ['invoice_number'],
        text: ['notes']
    },
    invoices: {
        amount: ['total_amount', 'amount'],
        party: ['customer_name'],
        dates: ['issue_date', 'due_date', 'created_at'],
        ownNumbers: ['invoice_number'],
        partyNumbers: [],
        text: ['memo']
    },
    journals: {
        amount: ['total_debit', 'amount'],
        party: ['description'],
        dates: ['date', 'created_at'],
        ownNumbers: ['journal_number'],
        partyNumbers: ['reference'],
        text: ['memo', 'description']
    }
};

// Identity keys checked for D0, in the order their evidence reads best.
const IDENTITY_KEYS = [
    { field: 'source_file_hash', label: 'the exact same file was already uploaded' },
    { field: 'bank_statement_row_id', label: 'both come from the same bank statement line' },
    { field: 'recon_row_id', label: 'both come from the same bank statement line' },
    { field: 'commerce_order_id', label: 'both come from the same marketplace order', pairWith: 'commerce_account_id' }
];

// Types that legitimately repeat because they move money between the user's own
// accounts or true up a balance. Never duplicate-flagged.
const NEVER_FLAGGED_TYPES = new Set(['transfer', 'adjustment']);

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

function fieldsFor(kind) {
    return FIELD_MAP[kind] || FIELD_MAP.transactions;
}

function firstValue(record, fields) {
    for (const f of fields) {
        const v = record?.[f];
        if (v !== undefined && v !== null && v !== '') return v;
    }
    return null;
}

function toInt(value) {
    const n = Math.round(Number(value));
    return Number.isFinite(n) ? Math.abs(n) : 0;
}

// Firestore Timestamp | Date | {seconds} | ISO string → epoch ms.
function toMs(value) {
    if (!value) return null;
    if (typeof value.toDate === 'function') { try { return value.toDate().getTime(); } catch { return null; } }
    if (value instanceof Date) return value.getTime();
    if (typeof value.seconds === 'number') return value.seconds * 1000;
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? null : parsed;
}

function dayDiff(aMs, bMs) {
    if (aMs === null || bMs === null) return null;
    return Math.abs(Math.round(aMs / DAY_MS) - Math.round(bMs / DAY_MS));
}

// Counterparty names get their OWN tokenizer rather than recon-engine's.
// recon's `tokenize` drops pure-digit and short tokens, which is right for bank
// statement prose ("TRSF 0812 …") and badly wrong for identity: it collapses
// "Client 1" and "Client 2" — and "Toko 88" and "Toko 99" — into the same name.
// Here every alphanumeric token survives; only legal-form noise is dropped.
const PARTY_STOPWORDS = new Set([
    'pt', 'cv', 'ud', 'pd', 'tbk', 'persero', 'the', 'and', 'dan', 'co', 'ltd', 'llc', 'inc'
]);

export function partyTokens(name) {
    return String(name || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((t) => t && !PARTY_STOPWORDS.has(t));
}

// Counterparty name, comparable. "PT. Sumber Makmur" and "pt sumber makmur,"
// collapse to one key; "Client 1" and "Client 2" deliberately do not.
export function normalizeParty(name) {
    return partyTokens(name).sort().join(' ');
}

// Overlap of the smaller token set found in the larger one (0..1), over
// party tokens. Mirrors recon-engine's tokenOverlap, different vocabulary.
export function partyOverlap(a, b) {
    const ta = partyTokens(a);
    const tb = partyTokens(b);
    if (!ta.length || !tb.length) return 0;
    const [small, large] = ta.length <= tb.length ? [ta, new Set(tb)] : [tb, new Set(ta)];
    return small.filter((t) => large.has(t)).length / small.length;
}

// Digits inside a counterparty name are almost always an identifier — a branch
// number, a unit, a customer code, an invoice-to reference. When BOTH names
// carry digits and those digits differ, they are different counterparties
// however much of the surrounding wording they share. Without this, every
// "Client 1"/"Client 2" pair scores as a near-certain duplicate.
export function partyDigitsConflict(a, b) {
    const digitsOf = (name) => partyTokens(name).filter((t) => /\d/.test(t)).sort().join('|');
    const da = digitsOf(a);
    const db = digitsOf(b);
    return !!da && !!db && da !== db;
}

// Document numbers compare on their significant characters only — vendors write
// the same number as "INV/2026/VIII/119", "INV-2026-VIII-119", "inv2026viii119".
export function normalizeDocNumber(value) {
    return String(value == null ? '' : value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

// A stable key for one unordered pair of records, so a decision recorded from
// the drawer is recognised by the cleanup scan and vice versa.
export function pairKey(idA, idB) {
    return [String(idA || ''), String(idB || '')].sort().join('__');
}

export function normalizeRecord(record = {}, kind = 'transactions') {
    const map = fieldsFor(kind);
    const partyRaw = firstValue(record, map.party);
    return {
        id: record.id || null,
        kind,
        amount: toInt(firstValue(record, map.amount)),
        party: String(partyRaw || ''),
        partyKey: normalizeParty(partyRaw),
        dateMs: toMs(firstValue(record, map.dates)),
        ownNumbers: map.ownNumbers
            .map((f) => normalizeDocNumber(record[f])).filter(Boolean),
        partyNumbers: map.partyNumbers
            .map((f) => ({ field: f, value: normalizeDocNumber(record[f]) })).filter((n) => n.value),
        text: map.text.map((f) => record[f]).filter(Boolean).join(' '),
        type: String(record.type || '').toLowerCase(),
        category: String(record.category || ''),
        accountCode: record.account_code || null,
        identity: IDENTITY_KEYS.reduce((acc, k) => {
            const v = record[k.field];
            if (v) acc[k.field] = k.pairWith ? `${v}::${record[k.pairWith] || ''}` : String(v);
            return acc;
        }, {}),
        linkedBillId: record.linked_bill_id || null,
        linkedTransactionId: record.linked_transaction_id || null,
        voided: record.is_voided === true
            || String(record.status || '').toLowerCase() === 'voided'
            || String(record.status || '').toLowerCase() === 'void',
        // Display-only, carried through so the review UI never re-reads the doc.
        display: {
            party: String(partyRaw || ''),
            amount: toInt(firstValue(record, map.amount)),
            dateMs: toMs(firstValue(record, map.dates)),
            status: record.status || record.payment_status || null,
            number: firstValue(record, [...map.ownNumbers, ...map.partyNumbers]) || null,
            source: record.source || record.created_via || null,
            createdBy: record.created_by || record.updated_by || null,
            currency: record.currency || 'IDR'
        }
    };
}

// ---------------------------------------------------------------------------
// Suppression — checked BEFORE scoring. A suppressed pair is never shown.
// ---------------------------------------------------------------------------

// True when the gap between two dates looks like a subscription renewal rather
// than a re-entry. Monthly and longer only (see RECURRING_CADENCE_DAYS).
export function isRecurringGap(diff) {
    if (diff === null || diff < RECURRING_CADENCE_DAYS[0] - RECURRING_TOLERANCE_DAYS) return false;
    return RECURRING_CADENCE_DAYS.some((c) => Math.abs(diff - c) <= RECURRING_TOLERANCE_DAYS);
}

// Returns a reason string when the pair must not be surfaced, else null.
export function suppressionReason(inc, exi, { decisions = null, includeVoided = false } = {}) {
    if (exi.id && inc.id && exi.id === inc.id) return 'same record';
    if (NEVER_FLAGGED_TYPES.has(inc.type) || NEVER_FLAGGED_TYPES.has(exi.type)) {
        return 'transfers and adjustments repeat by design';
    }
    // Records that already reference each other are two halves of one flow
    // (a bill and the payment that settled it), not two copies of one event.
    if (inc.id && (exi.linkedBillId === inc.id || exi.linkedTransactionId === inc.id)) return 'already linked';
    if (exi.id && (inc.linkedBillId === exi.id || inc.linkedTransactionId === exi.id)) return 'already linked';
    // Two payments against the SAME bill are instalments, not copies — that is
    // what partial payment means. They share vendor, category, and often a date.
    if (inc.linkedBillId && inc.linkedBillId === exi.linkedBillId) return 'both settle the same bill';
    // A voided record is one the user already cancelled. Re-entering a corrected
    // version is the NORMAL next step, so the pre-save guard must stay silent;
    // the cleanup scan opts back in with includeVoided.
    if (exi.voided && !includeVoided) return 'existing record is voided';
    if (decisions) {
        const prior = decisions[pairKey(inc.id, exi.id)];
        if (prior && ['kept_both', 'valid', 'ignored'].includes(prior)) return `already resolved as ${prior}`;
    }
    return null;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function identityHit(inc, exi) {
    for (const key of IDENTITY_KEYS) {
        const a = inc.identity[key.field];
        const b = exi.identity[key.field];
        if (a && b && a === b) return key.label;
    }
    return null;
}

function ownNumberHit(inc, exi) {
    return inc.ownNumbers.find((n) => exi.ownNumbers.includes(n)) || null;
}

function partyNumberHit(inc, exi) {
    for (const n of inc.partyNumbers) {
        const other = exi.partyNumbers.find((m) => m.value === n.value);
        if (other) return n;
    }
    return null;
}

// Pick the highest tier that fires. Returns { rule, evidence[] } or null.
function bestRule(inc, exi, diff) {
    const sameAmount = inc.amount > 0 && inc.amount === exi.amount;
    const sameParty = !!inc.partyKey && inc.partyKey === exi.partyKey;
    const inWide = diff !== null && diff <= WIDE_WINDOW_DAYS;

    const identity = identityHit(inc, exi);
    if (identity) return { rule: 'D0', evidence: [identity] };

    const ownHit = ownNumberHit(inc, exi);
    if (ownHit) return { rule: 'D0', evidence: ['this record number is already in use'] };

    const partyHit = partyNumberHit(inc, exi);
    if (partyHit && sameParty) {
        // A shared document number with DIFFERING amounts means one of two very
        // different things, and the record type tells them apart:
        //
        //   • On an ACCRUAL document (a bill, an invoice) it is a keying error
        //     or a genuine duplicate — a vendor does not issue two invoices
        //     under one number for two different amounts. Flag it.
        //   • On a LEDGER TRANSACTION it is almost always instalments: two
        //     partial payments that each carry the invoice number as
        //     provenance. That is normal, supported behaviour (see
        //     _payBillOnce / isValidInvoicePartialTransition), not a duplicate.
        //
        // Without this split, every partially-paid invoice in the book reports
        // as a near-certain duplicate.
        const accrualKind = inc.kind === 'bills' || inc.kind === 'invoices';
        if (sameAmount || accrualKind) {
            const label = partyHit.field === 'payment_reference' ? 'Payment reference' : 'Document number';
            const shown = exi.display.number || partyHit.value;
            return { rule: 'D1', evidence: [`${label} ${shown} already exists for ${exi.party || 'this counterparty'}`] };
        }
    }

    if (!sameAmount) return null;
    const amountEv = 'amount is identical';

    if (sameParty && diff === 0) {
        return { rule: 'D2', evidence: [amountEv, 'same counterparty', 'dated the same day'] };
    }
    if (sameParty && diff !== null && diff <= NEAR_DATE_WINDOW_DAYS) {
        return { rule: 'D3', evidence: [amountEv, 'same counterparty', `dated ${diff} day${diff === 1 ? '' : 's'} apart`] };
    }
    if (!sameParty && diff === 0 && !partyDigitsConflict(inc.party, exi.party)) {
        const overlap = partyOverlap(inc.party, exi.party);
        if (overlap >= PARTY_MIN_TOKEN_OVERLAP) {
            return {
                rule: 'D4',
                evidence: [amountEv, 'dated the same day', `counterparty name ${Math.round(overlap * 100)}% similar`]
            };
        }
    }
    if (inWide) {
        const overlap = tokenOverlap(inc.text, exi.text);
        if (overlap >= TEXT_MIN_TOKEN_OVERLAP && tokenize(inc.text).length) {
            return {
                rule: 'D5',
                evidence: [amountEv, `dated ${diff} day${diff === 1 ? '' : 's'} apart`, `description ${Math.round(overlap * 100)}% similar`]
            };
        }
        if (inc.accountCode && inc.accountCode === exi.accountCode
            && inc.category && inc.category === exi.category) {
            return {
                rule: 'D6',
                evidence: [amountEv, `dated ${diff} day${diff === 1 ? '' : 's'} apart`, 'same account and category']
            };
        }
    }
    return null;
}

export function classifyBand(score) {
    if (score >= BAND_HIGH_MIN) return 'high';
    if (score >= BAND_MEDIUM_MIN) return 'medium';
    if (score >= BAND_LOW_MIN) return 'low';
    return 'none';
}

// Score one incoming record against one existing record.
// Returns a match object, or null when there is no duplicate signal.
export function scorePair(incoming, existing, opts = {}) {
    const kind = opts.kind || incoming?.kind || 'transactions';
    const inc = incoming && incoming.partyKey !== undefined ? incoming : normalizeRecord(incoming, kind);
    const exi = existing && existing.partyKey !== undefined ? existing : normalizeRecord(existing, kind);

    const suppressed = suppressionReason(inc, exi, opts);
    if (suppressed) return null;

    const diff = dayDiff(inc.dateMs, exi.dateMs);
    const hit = bestRule(inc, exi, diff);
    if (!hit) return null;

    // A monthly-or-longer gap on a document-number match is a vendor reusing a
    // reference across billing periods, not a duplicate bill.
    if (hit.rule === 'D1' && isRecurringGap(diff)) return null;

    const evidence = [...hit.evidence];
    let score = DUP_RULES[hit.rule].base;

    if (hit.rule !== 'D0') {
        if (inc.accountCode && inc.accountCode === exi.accountCode && hit.rule !== 'D6') {
            score += 4;
            evidence.push('posted to the same account');
        }
        if (inc.category && inc.category === exi.category && hit.rule !== 'D6') {
            score += 3;
            evidence.push('same category');
        }
        if (exi.voided) {
            score -= 15;
            evidence.push('the existing record is voided');
        }
        score = Math.max(0, Math.min(99, score));
    }

    return {
        existing_id: exi.id,
        kind,
        rule: hit.rule,
        rules: [hit.rule],
        score,
        band: classifyBand(score),
        blocking: DUP_RULES[hit.rule].blocking,
        day_diff: diff,
        evidence,
        existing: exi.display,
        incoming: inc.display
    };
}

// Score an incoming record against a bounded candidate set.
// Returns matches sorted strongest-first, filtered to `minScore` (default: the
// lowest band we surface at all).
export function findDuplicates({
    incoming, candidates = [], kind = 'transactions',
    decisions = null, includeVoided = false, minScore = BAND_LOW_MIN, limit = 5
} = {}) {
    if (!incoming) return [];
    const inc = normalizeRecord(incoming, kind);
    const matches = [];
    candidates.forEach((candidate) => {
        if (!candidate) return;
        const match = scorePair(inc, normalizeRecord(candidate, kind), { kind, decisions, includeVoided });
        if (match && match.score >= minScore) matches.push(match);
    });
    matches.sort((a, b) =>
        (b.score - a.score)
        || (RULE_ORDER.indexOf(a.rule) - RULE_ORDER.indexOf(b.rule))
        || ((a.day_diff ?? 99) - (b.day_diff ?? 99)));
    return matches.slice(0, limit);
}

// Pairwise scan of an existing record set — powers the Accounting Center
// cleanup review. Returns one group per duplicate pair, strongest first.
// O(n²) by nature, so callers pass a period-scoped set and respect `maxRecords`.
export function scanForDuplicates({
    records = [], kind = 'transactions', decisions = null,
    includeVoided = true, minScore = BAND_MEDIUM_MIN, maxRecords = 2000
} = {}) {
    const capped = records.slice(0, maxRecords);
    const normalized = capped.map((r) => normalizeRecord(r, kind));
    const groups = [];
    const seen = new Set();
    for (let i = 0; i < normalized.length; i += 1) {
        for (let j = i + 1; j < normalized.length; j += 1) {
            const key = pairKey(normalized[i].id, normalized[j].id);
            if (seen.has(key)) continue;
            const match = scorePair(normalized[i], normalized[j], { kind, decisions, includeVoided });
            if (!match || match.score < minScore) continue;
            seen.add(key);
            // The OLDER record is the original; the newer one is the duplicate.
            const iOlder = (normalized[i].dateMs ?? 0) <= (normalized[j].dateMs ?? 0);
            groups.push({
                ...match,
                pair_key: key,
                kind,
                primary_id: iOlder ? normalized[i].id : normalized[j].id,
                duplicate_id: iOlder ? normalized[j].id : normalized[i].id,
                primary: iOlder ? normalized[i].display : normalized[j].display,
                duplicate: iOlder ? normalized[j].display : normalized[i].display
            });
        }
    }
    groups.sort((a, b) => (b.score - a.score) || ((a.day_diff ?? 99) - (b.day_diff ?? 99)));
    return { groups, truncated: records.length > capped.length, scanned: capped.length };
}

// One plain sentence describing a match. Used as the dialog's lead line and as
// the context Fluxy AI is given when a user asks why something was flagged.
export function explain(match) {
    if (!match) return '';
    if (match.rule === 'D0') return `Certain duplicate — ${match.evidence[0]}.`;
    const reasons = match.evidence.slice(0, 3).join(', ');
    return `${match.score}% match — ${reasons}.`;
}
