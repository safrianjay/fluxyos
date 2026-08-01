// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * The exported Profit & Loss must come from the posted ledger, so a P&L sent to
 * an accountant cannot disagree with the Accounting Center or the Trial Balance
 * (docs/ACCOUNTING_CENTER_IA.md — Reports packages and sends; it does not
 * compute a second set of books).
 *
 * Also guards two corrections made at the same time:
 *  - "Gross Margin" previously computed (Revenue − OpEx) / Revenue, which is NET
 *    margin. It now uses COGS, and net margin is reported separately.
 *  - COGS is unknowable on the cash-basis fallback, so gross profit/margin are
 *    reported as unavailable rather than computed from a zero COGS (which would
 *    fabricate a flat 100% gross margin).
 */

test('P&L prefers the ledger and reports gross margin only when COGS is known', async ({ page }) => {
    await page.goto('/pricing');
    const r = await page.evaluate(async () => {
        const { calculateProfitLoss } = await import('/assets/js/report-builder.js?v=' + Date.now());

        const ledger = {
            hasData: true, totalRevenue: 1000, totalCogs: 200, totalOpEx: 300,
            netIncome: 500, revenue: [{}], operatingExpenses: [{}, {}]
        };
        // Deliberately different from the ledger: the ledger must win.
        const txs = [{ type: 'income', amount: 9999 }, { type: 'expense', amount: 7777 }];

        const fromLedger = calculateProfitLoss(txs, ledger);
        const fallback = calculateProfitLoss([{ type: 'income', amount: 1000 }, { type: 'expense', amount: 300 }], null);
        const emptyLedger = calculateProfitLoss([{ type: 'income', amount: 50 }], { hasData: false });

        return {
            fromLedger: {
                basis: fromLedger.basis, revenue: fromLedger.revenue, cogs: fromLedger.cogs,
                grossProfit: fromLedger.grossProfit, grossMargin: fromLedger.grossMargin,
                netMargin: fromLedger.netMargin, net: fromLedger.netResult,
                metrics: fromLedger.rows.map(x => x.metric)
            },
            fallback: {
                basis: fallback.basis, revenue: fallback.revenue, opex: fallback.opex,
                grossProfit: fallback.grossProfit, grossMargin: fallback.grossMargin,
                net: fallback.netResult, metrics: fallback.rows.map(x => x.metric)
            },
            emptyLedgerBasis: emptyLedger.basis
        };
    });

    // Ledger wins over the transactions passed alongside it.
    expect(r.fromLedger.basis).toBe('ledger');
    expect(r.fromLedger.revenue).toBe(1000);
    expect(r.fromLedger.net).toBe(500);
    // Gross margin uses COGS: (1000 − 200) / 1000 = 80%, not the old 70%.
    expect(r.fromLedger.grossProfit).toBe(800);
    expect(r.fromLedger.grossMargin).toBeCloseTo(80, 5);
    expect(r.fromLedger.netMargin).toBeCloseTo(50, 5);
    expect(r.fromLedger.metrics).toContain('Cost of Goods Sold');
    expect(r.fromLedger.metrics).toContain('Gross Profit');

    // Cash-basis fallback: no COGS, so no fabricated gross margin.
    expect(r.fallback.basis).toBe('transactions');
    expect(r.fallback.revenue).toBe(1000);
    expect(r.fallback.grossMargin, 'gross margin must be unavailable without COGS').toBeNull();
    expect(r.fallback.grossProfit).toBeNull();
    expect(r.fallback.metrics).not.toContain('Gross Profit');
    expect(r.fallback.metrics).not.toContain('Gross Margin');

    // An empty ledger result must fall back rather than report zeros as ledger truth.
    expect(r.emptyLedgerBasis).toBe('transactions');
});

test('monthly trend takes financials from the ledger but record quality from records', async ({ page }) => {
    await page.goto('/pricing');
    const r = await page.evaluate(async () => {
        const { calculateMonthlyTrend } = await import('/assets/js/report-builder.js?v=' + Date.now());
        const scope = { current_period: { start_date: '2026-06-01', end_date: '2026-07-31' } };
        // Transactions deliberately disagree with the ledger: the ledger must win
        // for money, the records must win for record quality.
        const txs = [
            { timestamp: new Date('2026-06-15'), type: 'income', amount: 999 },
            { timestamp: new Date('2026-06-16'), type: 'expense', amount: 111, status: 'Missing Receipt' }
        ];
        const series = [
            { period_key: '2026-06', incomeStatement: { hasData: true, totalRevenue: 5000, totalCogs: 1000, totalOpEx: 2000, netIncome: 2000 } },
            { period_key: '2026-07', incomeStatement: { hasData: false } }
        ];
        const withLedger = calculateMonthlyTrend(txs, [], [], scope, series);
        const without = calculateMonthlyTrend(txs, [], [], scope, null);
        return { withLedger, without };
    });

    const jun = r.withLedger.find(m => m.month === '2026-06');
    expect(jun.basis).toBe('ledger');
    expect(jun.revenue, 'money comes from the ledger').toBe(5000);
    expect(jun.netResult).toBe(2000);
    // "Missing receipt" is a document attribute the ledger has no concept of.
    expect(jun.recordCount, 'record quality still comes from records').toBe(2);
    expect(jun.warnings).toBe(1);
    // Gross vs net margin are now named for what they are.
    expect(jun.grossMargin).toBeCloseTo(80, 5);   // (5000 − 1000) / 5000
    expect(jun.netMargin).toBeCloseTo(40, 5);     // 2000 / 5000

    // A month with no ledger activity falls back rather than vanishing.
    const jul = r.withLedger.find(m => m.month === '2026-07');
    expect(jul.basis).toBe('transactions');

    // With no series at all, gross margin is unavailable rather than fabricated.
    expect(r.without.every(m => m.grossMargin === null)).toBe(true);
    expect(r.without.find(m => m.month === '2026-06').revenue).toBe(999);
});

test('report money formatters never render a loss as a profit', async ({ page }) => {
    await page.goto('/pricing');
    const r = await page.evaluate(async () => {
        const { formatRupiah, formatRupiahCompact } = await import('/assets/js/report-builder.js?v=' + Date.now());
        return {
            lossFull: formatRupiah(-37335939),
            profitFull: formatRupiah(37335939),
            zero: formatRupiah(0),
            lossCompact: formatRupiahCompact(-2500000000),
            profitCompact: formatRupiahCompact(2500000000)
        };
    });
    // Both formatters used Math.abs(), so a loss was indistinguishable from a
    // profit in exported reports. Financial-statement convention is parentheses.
    expect(r.lossFull).toBe('(Rp37.335.939)');
    expect(r.profitFull).toBe('Rp37.335.939');
    expect(r.lossFull).not.toBe(r.profitFull);
    expect(r.zero).toBe('Rp0');
    expect(r.lossCompact).toBe('(Rp2.50B)');
    expect(r.profitCompact).toBe('Rp2.50B');
});
