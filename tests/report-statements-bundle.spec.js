// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Reports & Exports now ships the Balance Sheet and Cash Flow alongside the P&L.
 *
 * The boundary that matters (docs/ACCOUNTING_CENTER_IA.md §6.2): Reports
 * *packages and sends*; it does not compute a second set of books. These two
 * statements are passed through from the same getFinancialStatements() call the
 * ledger P&L already came from — so the guard here is that the exported figures
 * are the ledger's own, and that the manifest never promises a file the bundle
 * will not deliver.
 *
 * Unlike the P&L there is deliberately NO cash-basis fallback: a balance sheet
 * cannot be honestly approximated from records alone, so absent ledger data must
 * suppress the file rather than emit an empty or invented one.
 */

const PERIOD = { start_date: '2026-07-01', end_date: '2026-07-31' };

const BALANCE_SHEET = {
    hasData: true, balanced: true, tieOutDelta: 0,
    assets: [{ code: '1000', name: 'Cash & Bank', amount: 5000000 }],
    liabilities: [{ code: '2000', name: 'Accounts Payable', amount: 1200000 }],
    equity: [{ code: '3000', name: 'Retained Earnings', amount: 3800000 }],
    totalAssets: 5000000, totalLiabilities: 1200000, totalEquity: 3800000,
    liabilitiesPlusEquity: 5000000
};

const CASH_FLOW = {
    hasData: true, balanced: true, tieOutDelta: 0, netIncome: 900000,
    workingCapital: [{ code: '1100', name: 'Accounts Receivable', amount: -200000 }],
    investing: [], financing: [{ code: '3100', name: 'Owner Capital', amount: 500000 }],
    totalOperating: 700000, totalInvesting: 0, totalFinancing: 500000,
    netChangeInCash: 1200000, cashMovement: 1200000
};

async function buildPack(page, { balanceSheet, cashFlow }) {
    return page.evaluate(async ({ period, bs, cf }) => {
        const m = await import('/assets/js/report-builder.js?v=' + Date.now());
        const scope = m.resolveReportScope({
            reportPeriodMode: 'monthly', comparisonMode: 'none',
            period: { start: period.start_date, end: period.end_date }
        });
        const pack = m.buildMonthlyReportPack({
            userId: 'u1', userDisplayName: 'T', businessName: 'T', scope,
            transactions: [{ type: 'income', amount: 1000, timestamp: period.start_date }],
            bills: [], subscriptions: [],
            ledgerIncomeStatement: { hasData: true, totalRevenue: 1000, totalCogs: 0, totalOpEx: 100, netIncome: 900 },
            ledgerBalanceSheet: bs, ledgerCashFlow: cf
        });
        const bundle = m.buildCsvBundle(pack, { transactions: [], bills: [], subscriptions: [] });
        return {
            sourceFiles: pack.source_files,
            hasBs: !!pack.balance_sheet, hasCf: !!pack.cash_flow,
            bundle: bundle.map(f => ({ filename: f.filename, content: f.content })),
        };
    }, { period: PERIOD, bs: balanceSheet, cf: cashFlow });
}

test('the bundle ships the ledger Balance Sheet and Cash Flow, with the ledger figures', async ({ page }) => {
    await page.goto('/pricing');
    const r = await buildPack(page, { balanceSheet: BALANCE_SHEET, cashFlow: CASH_FLOW });

    expect(r.hasBs, 'the pack must carry the ledger balance sheet').toBe(true);
    expect(r.hasCf, 'the pack must carry the ledger cash flow').toBe(true);

    // The manifest and the bundle must agree — a listed file that never arrives
    // is worse than an absent one, because the manifest is what the audit row cites.
    const names = r.bundle.map(f => f.filename);
    expect(names.sort()).toEqual([...r.sourceFiles].sort());

    const bs = r.bundle.find(f => f.filename.startsWith('balance_sheet_'));
    const cf = r.bundle.find(f => f.filename.startsWith('cash_flow_'));
    expect(bs, 'balance_sheet CSV must be in the bundle').toBeTruthy();
    expect(cf, 'cash_flow CSV must be in the bundle').toBeTruthy();

    // Basis + tie-out must be stated, exactly as the Accounting Center export does.
    for (const f of [bs, cf]) {
        expect(f.content).toContain('Posted ledger (matches Accounting Center / Trial Balance)');
        expect(f.content).toMatch(/Tie-out,/);
        // Raw integers only — a formatted "Rp1.234.567" breaks every spreadsheet.
        expect(f.content).not.toMatch(/Rp[\d.]/);
    }

    // The figures are the ledger's, not a recomputation from records.
    expect(bs.content).toContain('Total liabilities & equity,5000000');
    expect(bs.content).toContain('1000,Cash & Bank,5000000');
    expect(cf.content).toContain('Net change in cash,1200000');
    expect(cf.content).toContain('Movement in cash accounts,1200000');
});

test('no ledger statements means no file — never an empty or invented one', async ({ page }) => {
    await page.goto('/pricing');
    const r = await buildPack(page, {
        balanceSheet: { hasData: false }, cashFlow: null,
    });

    expect(r.hasBs).toBe(false);
    expect(r.hasCf).toBe(false);
    expect(r.sourceFiles.some(f => f.startsWith('balance_sheet_'))).toBe(false);
    expect(r.sourceFiles.some(f => f.startsWith('cash_flow_'))).toBe(false);
    expect(r.bundle.some(f => f.filename.startsWith('balance_sheet_'))).toBe(false);
    expect(r.bundle.some(f => f.filename.startsWith('cash_flow_'))).toBe(false);
    // And nothing else in the bundle became a 0-byte file.
    r.bundle.forEach(f => expect(f.content.length, `${f.filename} is empty`).toBeGreaterThan(0));
});

test('an out-of-balance sheet states it rather than presenting as clean', async ({ page }) => {
    await page.goto('/pricing');
    const r = await buildPack(page, {
        balanceSheet: { ...BALANCE_SHEET, balanced: false, tieOutDelta: -110 },
        cashFlow: CASH_FLOW,
    });
    const bs = r.bundle.find(f => f.filename.startsWith('balance_sheet_'));
    expect(bs.content).toContain('Tie-out,Out by -110');
    expect(bs.content).toContain('Tie-out delta,-110');
});
