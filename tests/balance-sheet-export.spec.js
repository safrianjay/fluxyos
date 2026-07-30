// @ts-check
const { test, expect } = require('@playwright/test');
const { openAccountingTab } = require('./helpers/accounting-nav');

// The Balance Sheet CSV export was ported into the Accounting Center when the
// standalone /balance-sheet page was retired (docs/ACCOUNTING_CENTER_IA.md Phase 3).
// It is the only Balance Sheet export in the product, so it needs a real guard:
// confirm dialog → report_exports + audit log → CSV download.

test('Balance Sheet exports a CSV from the ledger statement', async ({ page }) => {
    const bad = [];
    page.on('pageerror', (e) => bad.push('pageerror: ' + e.message));

    await page.goto('/accounting.html');
    await expect(page.locator('#sidebar')).toBeVisible({ timeout: 30000 });
    await openAccountingTab(page, 'balance');

    const table = page.locator('#balance-sheet-content table');
    await expect(table.or(page.locator('#balance-sheet-content .fluxy-table-empty')))
        .toHaveCount(1, { timeout: 30000 });
    test.skip(await table.count() === 0, 'no ledger position in this workspace');

    const btn = page.locator('#balance-sheet-export');
    await expect(btn).toBeVisible();
    await btn.click();

    // Shared confirm dialog; the export only proceeds on confirm.
    const confirm = page.getByRole('button', { name: /Export CSV|Ekspor CSV/ }).last();
    const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 30000 }),
        confirm.click()
    ]);

    expect(download.suggestedFilename()).toMatch(/^balance_sheet_\d{4}-\d{2}\.csv$/);

    const stream = await download.createReadStream();
    const csv = await new Promise((resolve, reject) => {
        let out = '';
        stream.on('data', (c) => { out += c; });
        stream.on('end', () => resolve(out));
        stream.on('error', reject);
    });

    expect(csv.split('\n')[0]).toBe('Section,Account code,Account,Amount (IDR)');
    for (const label of ['Total assets', 'Total liabilities', 'Total equity', 'Total liabilities & equity', 'Tie-out delta']) {
        expect(csv, `CSV must contain "${label}"`).toContain(label);
    }
    // Amounts are raw integers — never formatted currency strings.
    expect(csv).not.toContain('Rp');

    expect(bad, `page errors:\n${bad.join('\n')}`).toEqual([]);
});
