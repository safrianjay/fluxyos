/**
 * Cost-of-revenue detection from an Accounting UI mapping.
 *
 * Regression guard for a real defect: `saveAccountingMapping` persists the
 * target account's CATALOG type — 'expense' for 5100 Cost of Goods Sold — and
 * nothing writes `statement_section` onto a mapping. The detector previously
 * only matched `statement_section === 'cost_of_revenue'` or
 * `target_account_type === 'cost_of_revenue'`, so a user could map a category to
 * Cost of Goods Sold in Accounting → Setup → Account Mapping and COGS stayed
 * empty forever: the Overview gross-margin chart kept telling them to do the
 * thing they had just done, and the income statement's Gross Profit always
 * equalled Revenue. Detection now keys off the chart's `sak_category === 'cogs'`,
 * matching statements-engine's buildIncomeStatement.
 */
const { test, expect } = require('@playwright/test');

test('a mapping made through the Accounting UI resolves to cost of revenue', async ({ page }) => {
    await page.goto('/dashboard.html');
    const r = await page.evaluate(async () => {
        const mod = await import('/assets/js/db-service.js');
        const DataService = mod.default;
        const ds = Object.create(DataService.prototype);  // the helpers are pure

        // Exactly what saveAccountingMapping() persists when a user picks
        // "5100 Cost of Goods Sold" in Accounting → Setup → Account Mapping.
        const uiMapping = [{
            source_type: 'transaction_category',
            source_value: 'Inventory',
            target_account_code: '5100',
            target_account_name: 'Cost of Goods Sold',
            target_account_type: 'expense',   // catalog type, NOT 'cost_of_revenue'
            confidence: 'user_confirmed',
            status: 'active'
        }];
        const chart = [
            { code: '5100', name: 'Cost of Goods Sold', type: 'expense', sak_category: 'cogs' },
            { code: '6100', name: 'Rent', type: 'expense', sak_category: 'opex' }
        ];

        const withChart = ds._incomeStatementCogsKeys(uiMapping, chart);
        const noChart = ds._incomeStatementCogsKeys(uiMapping);          // seed fallback
        const opexOnly = ds._incomeStatementCogsKeys(
            [{ ...uiMapping[0], target_account_code: '6100', source_value: 'Rent' }], chart);

        return {
            withChart: [...withChart],
            seedFallback: [...noChart],
            opexNotCogs: [...opexOnly],
            // The transaction-level classifier the Overview chart shares with
            // the income statement.
            txIsCogs: ds._isCogsTransaction({ type: 'expense', category: 'Inventory', amount: 500 }, withChart),
            rentIsCogs: ds._isCogsTransaction({ type: 'expense', category: 'Rent', amount: 500 }, withChart),
            // A COGS account the user created themselves must count too, which
            // is why detection reads the live chart rather than only the seed.
            userAccount: [...ds._incomeStatementCogsKeys(
                [{ ...uiMapping[0], target_account_code: '5150', source_value: 'Freight' }],
                [...chart, { code: '5150', name: 'Freight In', type: 'expense', sak_category: 'cogs' }])]
        };
    });
    console.log('COGS', JSON.stringify(r));

    expect(r.withChart, 'UI mapping to 5100 is detected').toContain('transaction_category::inventory');
    expect(r.seedFallback, 'still detected without a live chart (seed fallback)')
        .toContain('transaction_category::inventory');
    expect(r.opexNotCogs, 'an opex account is NOT treated as COGS').toEqual([]);
    expect(r.userAccount, 'a user-created COGS account counts too')
        .toContain('transaction_category::freight');
    expect(r.txIsCogs, 'an Inventory expense counts as COGS').toBe(true);
    expect(r.rentIsCogs, 'a Rent expense does not').toBe(false);
});
