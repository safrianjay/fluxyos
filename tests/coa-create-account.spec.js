// @ts-check
const { test, expect } = require('@playwright/test');

// Authenticated browser check for the "New Account" create drawer on the
// Accounting Center → Chart of Accounts tab. Runs as the QA account against real
// Firestore. Custom accounts cannot be deleted (archive only), so the happy path
// uses the drawer's auto-suggested next-free code (6900, 6910, …) to stay
// re-runnable, mirroring how the manual-journal spec accumulates journals.

const collectErrors = (page) => {
    const bad = [];
    page.on('console', (m) => {
        if (m.type() !== 'error') return;
        const t = m.text();
        if (/permission-denied|Missing or insufficient|CSP|Content Security|404|chart_of_accounts|saveAccount/i.test(t)) bad.push(t);
    });
    page.on('pageerror', (e) => bad.push('pageerror: ' + e.message));
    return bad;
};

async function openCoaDrawer(page) {
    await page.goto('/accounting.html');
    await expect(page.locator('#sidebar')).toBeVisible({ timeout: 30000 });
    await page.locator('[data-acct-tab="coa"]').click();
    const newBtn = page.locator('#coa-new-account');
    await expect(newBtn).toBeVisible({ timeout: 15000 });
    await newBtn.click();
    await expect(page.locator('#ca-drawer-panel')).toBeVisible({ timeout: 10000 });
}

test('New Account drawer creates a custom account; it lands in the CoA table and the manual-journal picker', async ({ page }) => {
    const bad = collectErrors(page);
    await openCoaDrawer(page);

    // Pick an operating-expense category → type expense, auto-suggested 6xxx code.
    await page.locator('#ca-category').selectOption('operating_expense');
    const code = await page.locator('#ca-code').inputValue();
    expect(code).toMatch(/^6\d{3}$/);
    const name = `QA Custom Expense ${Date.now()}`;
    await page.locator('#ca-name').fill(name);
    await page.locator('#ca-save').click();

    // Drawer closes; the new account appears in the CoA table with a detail link.
    await expect(page.locator('#ca-drawer-panel')).toBeHidden({ timeout: 15000 });
    const row = page.locator(`#coa-content a.acct-link[href="/accounting-account?code=${code}"]`);
    await expect(row).toBeVisible({ timeout: 15000 });

    // Available immediately in Manual Journal Entry (reads the live collection).
    await page.goto('/accounting-journal-new.html');
    await expect(page.locator('.mj-acct').first()).toBeVisible({ timeout: 30000 });
    await expect(page.locator(`.mj-acct option[value="${code}"]`).first()).toHaveCount(1);

    expect(bad, `console/page errors: ${bad.join(' | ')}`).toHaveLength(0);
});

test('New Account drawer rejects a duplicate code inline and does not create', async ({ page }) => {
    const bad = collectErrors(page);
    await openCoaDrawer(page);

    // 6100 (Marketing Expense) is a seeded expense account → duplicate.
    await page.locator('#ca-category').selectOption('operating_expense');
    const codeInput = page.locator('#ca-code');
    await codeInput.fill('');
    await codeInput.type('6100');
    await page.locator('#ca-name').fill('Should Not Save');
    await page.locator('#ca-save').click();

    // Inline error shows, drawer stays open, no toast-created row.
    await expect(page.locator('#ca-error')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#ca-error')).toContainText(/already exists/i);
    await expect(page.locator('#ca-drawer-panel')).toBeVisible();

    expect(bad, `console/page errors: ${bad.join(' | ')}`).toHaveLength(0);
});
