// @ts-check
const { test, expect } = require('@playwright/test');

// Authenticated browser check for the Accounting Center Aging tab (A/R + A/P
// aging). Runs as the QA account against real Firestore. Each section renders
// either the bucket summary + table or its empty state — never an error.

test('Aging tab renders receivable and payable aging without errors', async ({ page }) => {
    const bad = [];
    page.on('console', (m) => {
        if (m.type() !== 'error') return;
        const t = m.text();
        if (/permission-denied|Missing or insufficient|CSP|Content Security|aging|invoices|bills|accounting/i.test(t)) bad.push(t);
    });
    page.on('pageerror', (e) => bad.push('pageerror: ' + e.message));

    await page.goto('/accounting.html');
    await expect(page.locator('#sidebar')).toBeVisible({ timeout: 30000 });

    await page.locator('[data-acct-tab="aging"]').click();
    await expect(page.locator('[data-acct-panel="aging"]')).toBeVisible();

    for (const id of ['#aging-receivables-content', '#aging-payables-content']) {
        const section = page.locator(id);
        // Loading resolves into a table or an empty state.
        await expect(section.locator('table, .fluxy-table-empty')).toHaveCount(1, { timeout: 30000 });
        const text = await section.innerText();
        expect(text.length).toBeGreaterThan(0);
        // If a table rendered, the five buckets and the total row are present.
        if (await section.locator('table').count()) {
            await expect(section).toContainText('Total outstanding');
            for (const label of ['1–30 days', '31–60 days', '61–90 days', '90+ days']) {
                await expect(section).toContainText(label);
            }
        }
    }

    expect(bad, `console/page errors:\n${bad.join('\n')}`).toEqual([]);
});
