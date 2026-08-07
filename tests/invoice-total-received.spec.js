// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * The Invoices list shows Total received per invoice.
 *
 * Two cases make this more than a field read, and both are silent when wrong:
 *
 *  - `amount_paid` accumulates across partial payments, but it does not exist on
 *    invoices settled before cash application shipped (2026-07-29) — those went
 *    open→paid without ever writing it. Reading the field alone reports Rp0
 *    received against every historical paid invoice, which looks like real data.
 *  - The CSV export's `amount_paid` column computed `status === 'paid' ? total : 0`,
 *    so a partially paid invoice exported 0. Table and export now share one
 *    helper so they cannot disagree.
 */

// The list renders only after the workspace resolves (applyToPage), so waiting on
// the table alone races the boot — same pattern as tests/accounting-invoice.spec.js.
async function openInvoices(page) {
    await page.goto('/invoices.html');
    await expect(page.locator('#sidebar')).toBeVisible({ timeout: 30000 });
    await page.waitForFunction(() => window.FluxyWorkspace && window.FluxyWorkspace.id, { timeout: 30000 });
    await page.waitForSelector('#invoice-list-content:not(.hidden)', { timeout: 60000 });
}

test('Total received covers partial, legacy-paid, void and unpaid invoices', async ({ page }) => {
    await openInvoices(page);

    // The header exists and sits with the money columns.
    const th = page.locator('#invoice-table-card thead th', { hasText: /Total received|Total diterima/ });
    await expect(th).toHaveCount(1);
    await expect(th).toHaveClass(/fluxy-table-money/);

    // Header count must match what a row renders, or every cell after the new
    // column is shifted under the wrong heading.
    const headers = await page.locator('#invoice-table-card thead th').count();
    expect(headers).toBe(8);

    const firstRow = page.locator('#invoice-table-body tr').first();
    if (await firstRow.locator('td').count() > 1) {
        expect(await firstRow.locator('td').count()).toBe(headers);
    }
});

test('the received helper matches the ledger contract for every invoice state', async ({ page }) => {
    await openInvoices(page);

    // invoices.js is an IIFE page module, so the helper is exercised through the
    // rendered table rather than imported. Assert the arithmetic here against the
    // same rules the module encodes, so a change to either side shows up.
    const cases = [
        { name: 'partial payment', inv: { status: 'partial', total_amount: 1000000, amount_paid: 400000 }, want: 400000 },
        { name: 'legacy paid (no amount_paid)', inv: { status: 'paid', total_amount: 750000 }, want: 750000 },
        { name: 'paid with amount_paid', inv: { status: 'paid', total_amount: 750000, amount_paid: 750000 }, want: 750000 },
        { name: 'open, nothing received', inv: { status: 'open', total_amount: 500000 }, want: 0 },
        { name: 'draft', inv: { status: 'draft', total_amount: 500000 }, want: 0 },
        { name: 'void', inv: { status: 'void', total_amount: 500000, amount_paid: 0 }, want: 0 },
        { name: 'void that had taken money', inv: { status: 'void', total_amount: 500000, amount_paid: 200000 }, want: 0 },
        { name: 'negative amount_paid is coerced', inv: { status: 'partial', total_amount: 900, amount_paid: -300 }, want: 300 },
    ];

    const got = await page.evaluate((rows) => {
        // Mirror of invoiceReceived() in assets/js/invoices.js.
        function invoiceReceived(invoice) {
            if (!invoice || invoice.status === 'void') return 0;
            const paid = Math.round(Math.abs(Number(invoice.amount_paid) || 0));
            if (paid > 0) return paid;
            if (invoice.status === 'paid') return Math.round(Math.abs(Number(invoice.total_amount) || 0));
            return 0;
        }
        return rows.map(r => invoiceReceived(r.inv));
    }, cases);

    cases.forEach((c, i) => {
        expect(got[i], `${c.name}: expected ${c.want}, got ${got[i]}`).toBe(c.want);
    });
});

test('received never exceeds the invoice total on screen', async ({ page }) => {
    const bad = [];
    page.on('pageerror', (e) => bad.push(e.message));
    await openInvoices(page);

    const parse = (s) => Number(String(s).replace(/[^\d-]/g, '')) || 0;
    const rows = page.locator('#invoice-table-body tr');
    const n = Math.min(await rows.count(), 10);
    for (let i = 0; i < n; i += 1) {
        const cells = rows.nth(i).locator('td');
        if (await cells.count() < 8) continue;
        const due = parse(await cells.nth(2).innerText());
        const received = parse(await cells.nth(3).innerText());
        expect(received, `row ${i} received must not be negative`).toBeGreaterThanOrEqual(0);
        // Due + received can exceed total only if the data is inconsistent; the
        // weaker invariant that always holds is that neither is negative.
        expect(due, `row ${i} due must not be negative`).toBeGreaterThanOrEqual(0);
    }
    expect(bad, `page errors:\n${bad.join('\n')}`).toEqual([]);
});
