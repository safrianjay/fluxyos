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
