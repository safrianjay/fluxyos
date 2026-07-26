const { test, expect } = require('@playwright/test');

// Pure-logic unit tests for the A/R + A/P aging bucket engine
// (assets/js/aging-engine.js). Same pattern as accounting-engine.spec.js.

test('aging engine buckets records by days overdue', async ({ page }) => {
    await page.goto('/pricing');
    const r = await page.evaluate(async () => {
        const e = await import('/assets/js/aging-engine.js');
        const asOf = new Date('2026-07-26T05:00:00Z');
        const d = (iso) => new Date(iso + 'T05:00:00Z');
        const rec = (id, amount, due, extra = {}) => ({ id, kind: 'invoice', label: id, amount, due_date: due, ...extra });

        const result = e.computeAging([
            rec('future', 100, d('2026-08-10')),          // current (not yet due)
            rec('today', 200, d('2026-07-26')),           // current (due today)
            rec('d1', 300, d('2026-07-25')),              // 1-30
            rec('d30', 400, d('2026-06-26')),             // 1-30 boundary (30)
            rec('d31', 500, d('2026-06-25')),             // 31-60 boundary
            rec('d90', 600, d('2026-04-27')),             // 61-90 boundary (90)
            rec('d91', 700, d('2026-04-26')),             // 90+
            rec('nodue', 800, null, { fallback_date: d('2026-07-10') }), // aged from record date → 16 days
            rec('undatable', 900, null),                  // dropped — cannot age
            rec('zero', 0, d('2026-07-01'))               // dropped — no amount
        ], { asOf });

        const bucket = (id) => result.buckets.find((b) => b.id === id);
        return {
            total: result.total,
            count: result.count,
            current: bucket('current'),
            b1_30: bucket('b1_30'),
            b31_60: bucket('b31_60'),
            b61_90: bucket('b61_90'),
            b90_plus: bucket('b90_plus'),
            firstRow: result.rows[0],
            nodueRow: result.rows.find((x) => x.id === 'nodue'),
            hasUndatable: result.rows.some((x) => x.id === 'undatable'),
            bucketCount: e.AGING_BUCKETS.length
        };
    });

    expect(r.bucketCount).toBe(5);
    // 900 undatable + 0-amount dropped → 8 rows, total = 100+...+800.
    expect(r.count).toBe(8);
    expect(r.total).toBe(100 + 200 + 300 + 400 + 500 + 600 + 700 + 800);
    expect(r.current.amount).toBe(300);   // future + today
    expect(r.current.count).toBe(2);
    expect(r.b1_30.amount).toBe(300 + 400 + 800); // d1 + d30 + nodue(16d)
    expect(r.b31_60.amount).toBe(500);
    expect(r.b61_90.amount).toBe(600);
    expect(r.b90_plus.amount).toBe(700);
    // Sorted most-overdue first.
    expect(r.firstRow.id).toBe('d91');
    expect(r.firstRow.bucketId).toBe('b90_plus');
    // No-due-date rows are flagged for honest display.
    expect(r.nodueRow.no_due_date).toBe(true);
    expect(r.hasUndatable).toBe(false);
});
