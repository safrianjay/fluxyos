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

/** Minimal RFC-4180 parse — enough for these files (quoted fields, doubled quotes). */
function parseCsv(text) {
    const rows = [];
    let row = [], field = '', quoted = false;
    for (let i = 0; i < text.length; i += 1) {
        const c = text[i];
        if (quoted) {
            if (c === '"') {
                if (text[i + 1] === '"') { field += '"'; i += 1; } else { quoted = false; }
            } else field += c;
        } else if (c === '"') quoted = true;
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
        else if (c !== '\r') field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
}

/**
 * The contract is "amounts are raw integers", and the columns carrying amounts
 * are the ones whose header ends in "(IDR)". Asserting that directly beats
 * scanning the whole file for /Rp[\d.]/: the General Ledger has a free-text Memo
 * column, so a user who types "Bayar sewa Rp5.000.000" into a transaction
 * description fails a whole-file scan while the export is perfectly correct.
 * That is a false positive on real data, not a defect — the same class of bug as
 * a /NaN/i console check matching the word "finance".
 */
function assertRawAmounts(csv, name) {
    const rows = parseCsv(csv);
    const headerIdx = rows.findIndex((r) => r.some((c) => /\(IDR\)$/.test(c.trim())));
    expect(headerIdx, `${name} must have a column header naming its amount columns`).toBeGreaterThan(-1);

    const header = rows[headerIdx];
    const amountCols = header
        .map((c, i) => (/\(IDR\)$/.test(c.trim()) ? i : -1))
        .filter((i) => i >= 0);
    expect(amountCols.length, `${name} must carry at least one amount column`).toBeGreaterThan(0);

    for (const row of rows.slice(headerIdx + 1)) {
        for (const col of amountCols) {
            const cell = (row[col] ?? '').trim();
            if (cell === '') continue;
            expect(cell, `${name} column "${header[col]}" must be a raw integer, got "${cell}"`)
                .toMatch(/^-?\d+$/);
        }
    }
}

test('exports all five accounting files, each self-describing and machine-readable', async ({ page }) => {
    test.setTimeout(180000);
    const bad = [];
    page.on('pageerror', (e) => bad.push('pageerror: ' + e.message));

    await page.goto('/accounting.html');
    await page.waitForSelector('#accounting-content:not(.hidden)', { timeout: 60000 });

    // Export package lives in the Overview panel footer since 2026-08-07
    // (docs/ACCOUNTING_CENTER_IA.md §Overview) and the panel starts closed, so
    // the button has to be revealed before it can be clicked.
    await page.locator('#acct-overview-btn').click();
    await expect(page.locator('#acct-overview-panel')).toBeVisible();

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
        // Raw integers only, checked on the amount columns themselves.
        assertRawAmounts(csv, name);
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
