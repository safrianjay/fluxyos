const { test, expect } = require('@playwright/test');

// Pure-logic unit tests for the ledger-derived financial statements engine
// (assets/js/statements-engine.js). Same pattern as accounting-engine.spec.js.
// The core invariant: for balanced journals the Balance Sheet always ties out
// (Assets == Liabilities + Equity), because current-period earnings absorb the
// revenue/expense net.

test('statements engine builds a P&L and a balancing Balance Sheet', async ({ page }) => {
    await page.goto('/pricing');
    const r = await page.evaluate(async () => {
        const e = await import('/assets/js/statements-engine.js');
        // account row: { account_code, account_type, account_name, sak_category,
        //                debit_total, credit_total }
        const row = (code, type, sak, debit, credit) => ({
            account_code: code, account_type: type, account_name: code,
            sak_category: sak, debit_total: debit, credit_total: credit
        });

        // A tiny but balanced ledger:
        //   Cash 1000 (asset)     Dr 12,000,000
        //   A/R 1100 (asset)      Dr  3,000,000
        //   A/P 2000 (liability)  Cr  2,000,000
        //   Capital 3100 (equity) Cr 10,000,000
        //   Revenue 4000          Cr  8,000,000
        //   COGS 5100 (expense)   Dr  3,000,000
        //   Marketing 6100 (exp)  Dr  1,500,000
        //   Interest inc 7100     Cr    200,000
        //   Bank fee 6600 (exp)   Dr    100,000  → other_expense? no, operating.
        //   Other exp 6999        Dr    600,000  (other_expense)
        // Debits: 12,000,000+3,000,000+3,000,000+1,500,000+100,000+600,000 = 20,200,000
        // Credits: 2,000,000+10,000,000+8,000,000+200,000 = 20,200,000  → balanced.
        const rows = [
            row('1000', 'asset', 'cash_bank', 12000000, 0),
            row('1100', 'asset', 'accounts_receivable', 3000000, 0),
            row('2000', 'liability', 'accounts_payable', 0, 2000000),
            row('3100', 'equity', 'equity', 0, 10000000),
            row('4000', 'revenue', 'revenue', 0, 8000000),
            row('5100', 'expense', 'cogs', 3000000, 0),
            row('6100', 'expense', 'operating_expense', 1500000, 0),
            row('7100', 'revenue', 'other_income', 0, 200000),
            row('6600', 'expense', 'operating_expense', 100000, 0),
            row('6999', 'expense', 'other_expense', 600000, 0)
        ];

        const is = e.buildIncomeStatement(rows);
        const bs = e.buildBalanceSheet(rows);
        return {
            totalRevenue: is.totalRevenue,
            totalCogs: is.totalCogs,
            grossProfit: is.grossProfit,
            totalOpEx: is.totalOpEx,
            operatingIncome: is.operatingIncome,
            totalOtherIncome: is.totalOtherIncome,
            totalOtherExpense: is.totalOtherExpense,
            netIncome: is.netIncome,
            revenueCount: is.revenue.length,
            otherIncomeCount: is.otherIncome.length,
            cogsCount: is.cogs.length,
            otherExpenseCount: is.otherExpense.length,
            bsTotalAssets: bs.totalAssets,
            bsTotalLiabilities: bs.totalLiabilities,
            bsTotalEquity: bs.totalEquity,
            bsCurrentEarnings: bs.currentEarnings,
            bsBalanced: bs.balanced,
            bsTieDelta: bs.tieOutDelta,
            hasCurrentEarningsLine: bs.equity.some(l => l.code === '3500'),
            emptyBalanced: e.buildBalanceSheet([]).balanced
        };
    });

    // Income statement ladder.
    expect(r.totalRevenue).toBe(8000000);
    expect(r.totalCogs).toBe(3000000);
    expect(r.grossProfit).toBe(5000000);
    expect(r.totalOpEx).toBe(1600000);              // 6100 + 6600
    expect(r.operatingIncome).toBe(3400000);        // 5,000,000 − 1,600,000
    expect(r.totalOtherIncome).toBe(200000);        // 7100
    expect(r.totalOtherExpense).toBe(600000);       // 6999
    expect(r.netIncome).toBe(3000000);              // 3,400,000 + 200,000 − 600,000
    expect(r.revenueCount).toBe(1);                 // 4000 only (7100 is other income)
    expect(r.otherIncomeCount).toBe(1);
    expect(r.cogsCount).toBe(1);
    expect(r.otherExpenseCount).toBe(1);

    // Balance sheet ties out: Assets = Liabilities + Equity.
    expect(r.bsTotalAssets).toBe(15000000);         // 12M + 3M
    expect(r.bsTotalLiabilities).toBe(2000000);
    expect(r.bsCurrentEarnings).toBe(3000000);      // = net income
    expect(r.bsTotalEquity).toBe(13000000);         // capital 10M + earnings 3M
    expect(r.bsBalanced).toBe(true);
    expect(r.bsTieDelta).toBe(0);
    expect(r.hasCurrentEarningsLine).toBe(true);
    // Empty ledger is trivially balanced (0 = 0).
    expect(r.emptyBalanced).toBe(true);
});

// --- Cash Flow (indirect method) -------------------------------------------
// The statement is derived from the double-entry identity: across every account
// Σ(debit − credit) == 0, so Δcash == Σ(credit − debit) over all non-cash
// accounts. The sections partition those accounts, so the statement ties to the
// real movement in cash accounts by construction — for open AND closed periods.

test('cash flow ties to actual cash movement, open and closed periods', async ({ page }) => {
    await page.goto('/pricing');
    const r = await page.evaluate(async () => {
        const e = await import('/assets/js/statements-engine.js');
        const row = (code, type, sak, debit, credit) => ({
            account_code: code, account_type: type, account_name: code,
            sak_category: sak, debit_total: debit, credit_total: credit
        });

        // Rp1,000 cash sale + Rp200 credit sale, Rp300 cash expense,
        // Rp100 owner capital in. Cash moves +1,000 − 300 + 100 = +800.
        const open = [
            row('1000', 'asset', 'cash_bank', 1100, 300),
            row('4000', 'revenue', 'revenue', 0, 1200),
            row('1100', 'asset', 'accounts_receivable', 200, 0),
            row('6300', 'expense', 'operating_expense', 300, 0),
            row('3100', 'equity', 'equity', 0, 100)
        ];

        // Same period after close: the closing journal debits revenue to zero,
        // credits the aggregate expense-clearing line, and credits Retained
        // Earnings with net income. Net income must still read 900.
        const closed = open.map(x => ({ ...x }));
        closed.find(x => x.account_code === '4000').debit_total = 1200;
        closed.push(row('6999', 'expense', 'operating_expense', 0, 300));
        closed.push(row('3000', 'equity', 'equity', 0, 900));

        // Equipment bought for cash is investing, not operating.
        const investing = [
            row('1000', 'asset', 'cash_bank', 0, 500),
            row('1500', 'asset', 'fixed_asset', 500, 0)
        ];
        // A long-term loan drawn in cash is financing.
        const financing = [
            row('1000', 'asset', 'cash_bank', 2000, 0),
            row('2600', 'liability', 'long_term_liability', 0, 2000)
        ];

        const o = e.buildCashFlow(open);
        const c = e.buildCashFlow(closed);
        const i = e.buildCashFlow(investing);
        const f = e.buildCashFlow(financing);
        return {
            o: { ni: o.netIncome, op: o.totalOperating, fin: o.totalFinancing, net: o.netChangeInCash, cash: o.cashMovement, ok: o.balanced },
            c: { ni: c.netIncome, net: c.netChangeInCash, cash: c.cashMovement, ok: c.balanced },
            i: { inv: i.totalInvesting, net: i.netChangeInCash, cash: i.cashMovement, ok: i.balanced },
            f: { fin: f.totalFinancing, net: f.netChangeInCash, cash: f.cashMovement, ok: f.balanced },
            emptyHasData: e.buildCashFlow([]).hasData,
            emptyBalanced: e.buildCashFlow([]).balanced
        };
    });

    // Open period
    expect(r.o.ni).toBe(900);          // 1,200 revenue − 300 expense
    expect(r.o.op).toBe(700);          // 900 earnings − 200 tied up in A/R
    expect(r.o.fin).toBe(100);         // owner capital
    expect(r.o.net).toBe(800);
    expect(r.o.cash).toBe(800);
    expect(r.o.ok).toBe(true);

    // Closed period: the closing journal must not double-count net income.
    expect(r.c.ni, 'net income reads the same after close').toBe(900);
    expect(r.c.net).toBe(800);
    expect(r.c.cash).toBe(800);
    expect(r.c.ok).toBe(true);

    // Classification
    expect(r.i.inv).toBe(-500);
    expect(r.i.ok).toBe(true);
    expect(r.f.fin).toBe(2000);
    expect(r.f.ok).toBe(true);

    expect(r.emptyHasData).toBe(false);
    expect(r.emptyBalanced).toBe(true);
});
