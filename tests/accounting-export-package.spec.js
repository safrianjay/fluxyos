// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * The accountant hand-off: every statement plus the working papers behind them,
 * in one audited action (docs/ACCOUNTING_CENTER_IA.md Phase 5).
 *
 * This is the export an external accountant reviews, so the guard is strict:
 * all five files must arrive, each must declare its period/basis/tie-out, and
 * amounts must be raw integers — a formatted "Rp1.234.567" would break every
 * spreadsheet it lands in.
 */

const EXPECTED = ['income_statement', 'balance_sheet', 'cash_flow', 'trial_balance', 'general_ledger'];

test('exports all five accounting files, each self-describing and machine-readable', async ({ page }) => {
    test.setTimeout(180000);
    const bad = [];
    page.on('pageerror', (e) => bad.push('pageerror: ' + e.message));

    await page.goto('/accounting.html');
    await page.waitForSelector('#accounting-content:not(.hidden)', { timeout: 60000 });

    const btn = page.locator('#acct-export-package');
    await expect(btn, 'the package button must no longer be disabled').toBeEnabled();

    // Collect every download the click produces.
    const downloads = [];
    page.on('download', (d) => downloads.push(d));

    await btn.click();
    await page.getByRole('button', { name: /Export package|Ekspor paket/ }).last().click();

    await expect.poll(() => downloads.length, { timeout: 60000 }).toBe(EXPECTED.length);

    const seen = {};
    for (const d of downloads) {
        const name = d.suggestedFilename();
        const key = EXPECTED.find(k => name.startsWith(k));
        expect(key, `unexpected file in the package: ${name}`).toBeTruthy();
        expect(name).toMatch(/\.csv$/);

        const stream = await d.createReadStream();
        const csv = await new Promise((resolve, reject) => {
            let out = '';
            stream.on('data', (c) => { out += c; });
            stream.on('end', () => resolve(out));
            stream.on('error', reject);
        });
        seen[key] = csv;

        // Every file must stand on its own for a reviewer.
        for (const field of ['Report,', 'Period,', 'Basis,', 'Trial balance,', 'Balance sheet tie-out,', 'Cash flow tie-out,']) {
            expect(csv, `${name} must declare "${field}"`).toContain(field);
        }
        // Raw integers only — no formatted currency anywhere in the data.
        expect(csv, `${name} must not contain formatted currency`).not.toMatch(/Rp[\d.]/);
    }

    expect(Object.keys(seen).sort()).toEqual([...EXPECTED].sort());

    // Spot-check that each file carries its own substance, not just a header.
    expect(seen.income_statement).toContain('Net income');
    expect(seen.balance_sheet).toContain('Total liabilities & equity');
    expect(seen.cash_flow).toContain('Net change in cash');
    expect(seen.cash_flow).toContain('Movement in cash accounts');
    expect(seen.trial_balance).toContain('TOTAL');
    expect(seen.general_ledger).toContain('Running balance (IDR)');

    // The General Ledger is the audit trail — it must carry journal ids, or the
    // statements above it cannot be traced back to their postings.
    const glLines = seen.general_ledger.split('\n').filter(l => l.trim());
    expect(glLines.length, 'general ledger must contain postings').toBeGreaterThan(2);

    expect(bad, `page errors:\n${bad.join('\n')}`).toEqual([]);
});
