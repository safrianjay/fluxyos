// @ts-check
const { test, expect } = require('@playwright/test');

// Account-code suggestion in the New Account drawer.
//
// The suggester used to key off `type` via a hard-coded map
// (expense -> '6', revenue -> '4'). Type is too coarse to place an account in
// this chart: expense spans 5xxx (COGS) and 6xxx (operating), revenue spans
// 4xxx (operating) and 7xxx (other income). So every new COGS account was
// offered a 6xxx code and every other-income account a 4xxx code — the wrong
// block in both cases, and inconsistent with accountTypeForCode() in
// accounting-engine.js, which has always mapped 5/6/8 -> expense and 4/7 ->
// revenue.
//
// The prefix is now derived from the accounts that actually exist, keyed on
// sak_category. These assertions are about the CONVENTION, not fixed numbers,
// so they still hold as the chart grows.

async function openNewAccountDrawer(page) {
    await page.goto('/accounting');
    await page.waitForTimeout(2500);
    await page.locator('[data-acct-group="setup"]').click();
    await page.locator('[data-acct-tab="coa"]').click();
    await page.waitForTimeout(1500);
    const btn = page.locator('#coa-new-account');
    if (!(await btn.isVisible().catch(() => false))) {
        test.skip(true, 'New Account is not available for this role/workspace.');
    }
    await btn.click();
    await expect(page.locator('#ca-code')).toBeVisible({ timeout: 5000 });
}

// Category value -> the first digit the chart uses for it.
const EXPECTED_PREFIX = {
    cogs: '5',
    operating_expense: '6',
    revenue: '4',
    other_income: '7',
    cash_bank: '1',
    accounts_payable: '2',
    equity: '3'
};

test('the suggested code lands in the block its category actually uses', async ({ page }) => {
    await openNewAccountDrawer(page);

    for (const [category, prefix] of Object.entries(EXPECTED_PREFIX)) {
        const select = page.locator('#ca-category');
        if (!(await select.locator(`option[value="${category}"]`).count())) continue;
        await select.selectOption(category);
        await page.waitForTimeout(250);

        const code = await page.locator('#ca-code').inputValue();
        expect(code, `${category} should be suggested a ${prefix}xxx code`).toMatch(new RegExp(`^${prefix}`));
        // The chart is 4-digit throughout; the width is derived, not assumed,
        // so this asserts the derivation picked the house convention up.
        expect(code, `${category} code width`).toMatch(/^\d{4}$/);
    }
});

test('the suggestion is free, and explains where it came from', async ({ page }) => {
    await openNewAccountDrawer(page);
    await page.locator('#ca-category').selectOption('cogs');
    await page.waitForTimeout(300);

    const suggested = await page.locator('#ca-code').inputValue();

    // Not already taken — the whole point of "next available".
    const taken = await page.evaluate(async () => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const DataService = (await import('/assets/js/db-service.js')).default;
        const app = getApps()[0];
        const uid = getAuth(app).currentUser.uid;
        const ds = new DataService(app);
        const coa = await ds.getChartOfAccounts(uid).catch(() => []);
        return (coa || []).map(a => String(a.code));
    });
    expect(taken, 'suggested code must not already exist').not.toContain(suggested);

    // And the drawer says why, so the number is not magic.
    const hint = page.locator('#ca-code-hint');
    await expect(hint).toBeVisible();
    await expect(hint).toContainText(/5x{3}|5xxx/i);
});

test('a hand-edited code is never overwritten by a category change', async ({ page }) => {
    await openNewAccountDrawer(page);
    const code = page.locator('#ca-code');

    await page.locator('#ca-category').selectOption('operating_expense');
    await page.waitForTimeout(250);
    await code.fill('6777');
    await code.dispatchEvent('input');

    await page.locator('#ca-category').selectOption('cogs');
    await page.waitForTimeout(300);
    // Suggestions assist; they must not clobber a deliberate choice.
    await expect(code).toHaveValue('6777');
});
