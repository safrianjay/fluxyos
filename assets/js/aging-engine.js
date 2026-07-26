// =============================================================================
// FluxyOS — A/R + A/P Aging Engine (pure bucket computation)
//
// INTENTIONALLY pure — no Firestore, no DOM. Given open receivable/payable
// records it buckets them by days overdue against an as-of date. db-service
// fetches the records (open IDR invoices, unpaid bills, pending_* accruals);
// the Accounting Center Aging tab renders the result.
//
// Buckets follow the standard 30/60/90 presentation: Current (not yet due),
// then 1–30 / 31–60 / 61–90 / 90+ days overdue. A record without a due date
// ages from its recorded date (recorded = treated as due immediately) — the
// SMB-honest default; the row is flagged `no_due_date` so the UI can say so.
// =============================================================================

export const AGING_BUCKETS = [
    { id: 'current', label: 'Current', min: -Infinity, max: 0 },
    { id: 'b1_30', label: '1–30 days', min: 1, max: 30 },
    { id: 'b31_60', label: '31–60 days', min: 31, max: 60 },
    { id: 'b61_90', label: '61–90 days', min: 61, max: 90 },
    { id: 'b90_plus', label: '90+ days', min: 91, max: Infinity }
];

const DAY_MS = 24 * 60 * 60 * 1000;

function toMs(value) {
    if (!value) return null;
    if (typeof value.toDate === 'function') { try { return value.toDate().getTime(); } catch { return null; } }
    if (value instanceof Date) return value.getTime();
    if (typeof value.seconds === 'number') return value.seconds * 1000;
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? null : parsed;
}

function toInt(value) {
    const n = Math.round(Number(value));
    return Number.isFinite(n) ? n : 0;
}

export function bucketForDaysOverdue(days) {
    return AGING_BUCKETS.find((b) => days >= b.min && days <= b.max) || AGING_BUCKETS[AGING_BUCKETS.length - 1];
}

// records: [{ id, kind, label, amount, due_date, fallback_date, ref }]
// Returns { asOfMs, total, count, buckets: [{ ...bucket, amount, count }],
//           rows: [{ ...record, daysOverdue, bucketId, no_due_date }] } —
// rows sorted most-overdue first.
export function computeAging(records = [], { asOf = new Date() } = {}) {
    const asOfMs = toMs(asOf) ?? Date.now();
    const asOfDay = Math.floor(asOfMs / DAY_MS);
    const buckets = AGING_BUCKETS.map((b) => ({ ...b, amount: 0, count: 0 }));
    const rows = [];
    let total = 0;

    (records || []).forEach((record) => {
        const amount = toInt(record.amount);
        if (amount <= 0) return;
        const dueMs = toMs(record.due_date);
        const baseMs = dueMs ?? toMs(record.fallback_date);
        if (baseMs === null) return; // undatable — cannot age honestly
        const daysOverdue = asOfDay - Math.floor(baseMs / DAY_MS);
        const bucket = bucketForDaysOverdue(daysOverdue);
        const slot = buckets.find((b) => b.id === bucket.id);
        slot.amount += amount;
        slot.count += 1;
        total += amount;
        rows.push({
            id: record.id,
            kind: record.kind || 'record',
            label: record.label || '',
            ref: record.ref || null,
            amount,
            daysOverdue,
            bucketId: bucket.id,
            no_due_date: dueMs === null
        });
    });

    rows.sort((a, b) => (b.daysOverdue - a.daysOverdue) || (b.amount - a.amount));
    return { asOfMs, total, count: rows.length, buckets, rows };
}
